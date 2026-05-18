'use strict';

// PR-NX43 (2026-05-18) — Risk Register narrative synthesis tests.
//
// Pre-NX43 the DOCX Risk Register section showed the structured table
// only. NX43 adds a 2-paragraph Claude-synthesized narrative ABOVE the
// table (overall risk profile + critical-spotlight callout). These tests
// pin the cascade, the no-op fast paths, and the shape contract.

jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(),
}));

jest.mock('../src/services/ai/aiRouter', () => ({
  runClaudeReasoning: jest.fn(),
  runAI: jest.fn(),
}));

const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
const { runClaudeReasoning, runAI } = require('../src/services/ai/aiRouter');
const { generateRiskNarrative } = require('../src/services/export.insights.service');

const fixture = ({ items = [], overrides = {} } = {}) => ({
  deal: { id: 'd-1', organization_id: 'o-1', name: 'Test Deal', asset_class: 'residential_apartments', deal_structure: 'outright_purchase', stage: 'underwriting', city: 'Bengaluru' },
  riskCounts: { critical: 1, high: 2, medium: 1, low: 0 },
  items,
  ...overrides,
});

const sampleRisks = [
  { title: 'Conversion order pending', severity: 'critical', category: 'legal', status: 'open', description: 'Land use conversion from agri to NA still pending with deputy commissioner.', mitigation: 'Track DC office filing weekly.' },
  { title: 'Survey number discrepancy', severity: 'high', category: 'legal', status: 'open', description: 'Sale deed shows 12/2A; RTC shows 12/2.', mitigation: 'Order title search.' },
  { title: 'JDA escalation clause', severity: 'high', category: 'commercial', status: 'open', description: 'Landowner share escalates 2% per delay quarter.', mitigation: null },
  { title: 'BBMP plan sanction pending', severity: 'medium', category: 'approvals', status: 'open', description: 'Filed 6 weeks ago; typical TAT is 12 weeks.', mitigation: 'Follow-up monthly.' },
];

beforeEach(() => {
  getProviderAvailability.mockReset();
  runClaudeReasoning.mockReset();
  runAI.mockReset();
});

describe('PR-NX43 — generateRiskNarrative', () => {
  describe('no-op fast paths (no AI call fired)', () => {
    test('empty items array → unavailable with "no risks logged" reason', async () => {
      const out = await generateRiskNarrative(fixture({ items: [] }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/no risks logged/);
      expect(runClaudeReasoning).not.toHaveBeenCalled();
      expect(runAI).not.toHaveBeenCalled();
    });

    test('all risks closed/resolved/mitigated → unavailable', async () => {
      const closed = sampleRisks.map((r) => ({ ...r, status: 'closed' }));
      const out = await generateRiskNarrative(fixture({ items: closed }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/all logged risks are closed/);
      expect(runClaudeReasoning).not.toHaveBeenCalled();
    });

    test('items with status="resolved" or "mitigated" also count as closed', async () => {
      const mixed = [
        { ...sampleRisks[0], status: 'resolved' },
        { ...sampleRisks[1], status: 'mitigated' },
      ];
      const out = await generateRiskNarrative(fixture({ items: mixed }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/all logged risks are closed/);
    });
  });

  describe('happy paths (cascade)', () => {
    test('Claude succeeds first → provider=claude-sonnet-4-6 with no fallbackReason', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        summary_paragraph: 'High legal exposure dominates the risk picture.',
        critical_spotlight_paragraph: 'Conversion order pending is the single dealbreaker — without DC approval, no sale deed can register.',
        confidence: 'high',
      }));
      const out = await generateRiskNarrative(fixture({ items: sampleRisks }));
      expect(out.available).toBe(true);
      expect(out.summary_paragraph).toMatch(/High legal exposure/);
      expect(out.critical_spotlight_paragraph).toMatch(/Conversion order pending/);
      expect(out.provider).toBe('claude-sonnet-4-6');
      expect(out.fallbackReason).toBeNull();
      expect(out.confidence).toBe('high');
      expect(runClaudeReasoning).toHaveBeenCalledTimes(1);
      expect(runAI).not.toHaveBeenCalled();
    });

    test('Claude 401 → OpenAI rescues → fallbackReason cites Claude error', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockRejectedValueOnce(Object.assign(new Error('invalid_api_key'), { status: 401 }));
      runAI.mockResolvedValueOnce({
        result: JSON.stringify({
          summary_paragraph: 'OpenAI rescue synthesis.',
          critical_spotlight_paragraph: 'Critical items spotlighted.',
          confidence: 'medium',
        }),
        model: 'gpt-5.4',
      });
      const out = await generateRiskNarrative(fixture({ items: sampleRisks }));
      expect(out.available).toBe(true);
      expect(out.provider).toBe('gpt-5.4');
      expect(out.fallbackReason).toMatch(/Claude 401 invalid_api_key/);
      expect(out.fallbackReason).toMatch(/auto-failover succeeded on openai/);
    });
  });

  describe('not-available paths', () => {
    test('both providers unconfigured → unavailable with clear reason', async () => {
      getProviderAvailability.mockReturnValue({ claude: false, gpt_compatible: false });
      const out = await generateRiskNarrative(fixture({ items: sampleRisks }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/No AI provider configured/);
    });

    test('both providers configured but both fail → unavailable with BOTH errors', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockRejectedValueOnce(new Error('claude_outage'));
      runAI.mockRejectedValueOnce(Object.assign(new Error('rate_limited'), { status: 429 }));
      const out = await generateRiskNarrative(fixture({ items: sampleRisks }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/Claude claude_outage/);
      expect(out.reason).toMatch(/OpenAI 429 rate_limited/);
    });
  });

  describe('payload shape (buildRiskNarrativePayload)', () => {
    test('caps risk_flags at 12 and trims description+mitigation to safe lengths', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: false });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        summary_paragraph: 'ok',
        critical_spotlight_paragraph: 'ok',
        confidence: 'medium',
      }));

      // Generate 15 risks with long descriptions
      const longDesc = 'x'.repeat(500);
      const longMitig = 'y'.repeat(400);
      const many = Array.from({ length: 15 }, (_, i) => ({
        title: `Risk ${i}`, severity: 'high', category: 'legal', status: 'open',
        description: longDesc, mitigation: longMitig,
      }));

      await generateRiskNarrative(fixture({ items: many }));
      // Inspect the payload Claude was called with
      const claudeCallArgs = runClaudeReasoning.mock.calls[0][0];
      expect(claudeCallArgs.payload.risk_flags).toHaveLength(12);
      expect(claudeCallArgs.payload.risk_flags[0].description.length).toBeLessThanOrEqual(240);
      expect(claudeCallArgs.payload.risk_flags[0].mitigation.length).toBeLessThanOrEqual(200);
    });
  });

  describe('envelope shape coercion', () => {
    test('valid JSON missing summary_paragraph → coerced to null (no crash)', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: false });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        critical_spotlight_paragraph: 'Only spotlight.',
        confidence: 'medium',
      }));
      const out = await generateRiskNarrative(fixture({ items: sampleRisks }));
      expect(out.available).toBe(true);
      expect(out.summary_paragraph).toBeNull();
      expect(out.critical_spotlight_paragraph).toBe('Only spotlight.');
    });

    test('invalid confidence coerces to "medium"', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: false });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        summary_paragraph: 'ok',
        critical_spotlight_paragraph: 'ok',
        confidence: 'extremely high',
      }));
      const out = await generateRiskNarrative(fixture({ items: sampleRisks }));
      expect(out.confidence).toBe('medium');
    });
  });
});
