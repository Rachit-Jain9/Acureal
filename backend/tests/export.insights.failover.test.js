'use strict';

// PR-NX40 (2026-05-18) — IC opinion failover cascade tests.
//
// Pre-NX40: generateDealInsights did ONE Claude call. If Claude failed
// (timeout / rate-limit / malformed JSON / outage) the function returned
// { available: false, ic_opinion: null } and the DOCX silently rendered
// the "AI-generated investor-grade opinion is not available" placeholder.
//
// Post-NX40: Claude → OpenAI failover, with fallbackReason surfaced to
// the caller so the DOCX footer can show WHY when the secondary rescued
// the call. These tests pin every branch of the cascade.

jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(),
}));

jest.mock('../src/services/ai/aiRouter', () => ({
  runClaudeReasoning: jest.fn(),
  runAI: jest.fn(),
}));

const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
const { runClaudeReasoning, runAI } = require('../src/services/ai/aiRouter');
const { generateDealInsights } = require('../src/services/export.insights.service');

const fixture = () => ({
  deal: { id: 'deal-1', organization_id: 'org-1', name: 'Test', asset_class: 'residential_apartments' },
  ddCounts: { completed: 4, total: 10 },
  riskCounts: { total: 3, deal_breaker: 1 },
  financials: { irr_pct: 18.5, npv_cr: 12.3 },
  benchmarks: { median_rate_per_sqft: 7500 },
  topRiskFlags: [],
  topDdItems: [],
  cashFlowSummary: null,
});

beforeEach(() => {
  getProviderAvailability.mockReset();
  runClaudeReasoning.mockReset();
  runAI.mockReset();
});

describe('export.insights.service — IC opinion failover (PR-NX40)', () => {
  describe('happy paths', () => {
    test('Claude succeeds → returns provider=claude-sonnet-4-6 with no fallbackReason', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        ic_opinion: 'Strong yield profile, manageable approvals risk.',
        top_risks: [{ title: 'RERA delay', detail: 'phase-2 cert pending' }],
        next_steps: ['Verify EC', 'Order title search'],
        confidence: 'high',
      }));

      const out = await generateDealInsights(fixture());
      expect(out.available).toBe(true);
      expect(out.ic_opinion).toMatch(/Strong yield profile/);
      expect(out.provider).toBe('claude-sonnet-4-6');
      expect(out.fallbackReason).toBeNull();
      expect(out.top_risks).toHaveLength(1);
      expect(out.next_steps).toHaveLength(2);
      expect(runClaudeReasoning).toHaveBeenCalledTimes(1);
      expect(runAI).not.toHaveBeenCalled();
    });

    test('Claude fails → OpenAI rescues → returns provider=gpt-5.4 with fallbackReason citing Claude error', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      const err429 = Object.assign(new Error('rate_limited'), { status: 429 });
      runClaudeReasoning.mockRejectedValueOnce(err429);
      runAI.mockResolvedValueOnce({
        result: JSON.stringify({
          ic_opinion: 'OpenAI rescue opinion.',
          top_risks: [],
          next_steps: [],
          confidence: 'medium',
        }),
        model: 'gpt-5.4',
      });

      const out = await generateDealInsights(fixture());
      expect(out.available).toBe(true);
      expect(out.ic_opinion).toBe('OpenAI rescue opinion.');
      expect(out.provider).toBe('gpt-5.4');
      expect(out.fallbackReason).toMatch(/Claude 429 rate_limited/);
      expect(out.fallbackReason).toMatch(/auto-failover succeeded on openai/);
    });

    test('Claude returns malformed JSON → OpenAI rescues with malformed-JSON in fallbackReason', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce('not even json{');
      runAI.mockResolvedValueOnce({
        result: JSON.stringify({ ic_opinion: 'Recovered.', top_risks: [], next_steps: [], confidence: 'low' }),
        model: 'gpt-5.4',
      });

      const out = await generateDealInsights(fixture());
      expect(out.available).toBe(true);
      expect(out.ic_opinion).toBe('Recovered.');
      expect(out.fallbackReason).toMatch(/Claude returned unparseable JSON/);
    });
  });

  describe('not-available paths (both providers down)', () => {
    test('both providers unconfigured → unavailable with clear reason', async () => {
      getProviderAvailability.mockReturnValue({ claude: false, gpt_compatible: false });
      const out = await generateDealInsights(fixture());
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/No AI provider configured/);
      expect(out.ic_opinion).toBeNull();
      expect(runClaudeReasoning).not.toHaveBeenCalled();
      expect(runAI).not.toHaveBeenCalled();
    });

    test('Claude configured + fails, OpenAI not configured → unavailable with Claude error + "OpenAI not configured"', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: false });
      runClaudeReasoning.mockRejectedValueOnce(new Error('boom'));
      const out = await generateDealInsights(fixture());
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/Claude boom/);
      expect(out.reason).toMatch(/OpenAI not configured/);
    });

    test('both providers configured + both fail → unavailable with BOTH error diagnostics in reason', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockRejectedValueOnce(Object.assign(new Error('invalid_api_key'), { status: 401 }));
      runAI.mockRejectedValueOnce(Object.assign(new Error('rate_limited'), { status: 429 }));
      const out = await generateDealInsights(fixture());
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/Claude 401 invalid_api_key/);
      expect(out.reason).toMatch(/OpenAI 429 rate_limited/);
    });
  });

  describe('edge cases', () => {
    test('Claude returns valid JSON missing ic_opinion key → coerced envelope has null ic_opinion (no crash)', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({ top_risks: [], next_steps: [] }));
      const out = await generateDealInsights(fixture());
      // available: true (we got parseable JSON) but ic_opinion null (key missing).
      // The DOCX builder treats null ic_opinion as "fall through to placeholder" —
      // operator still sees structured KPIs.
      expect(out.available).toBe(true);
      expect(out.ic_opinion).toBeNull();
    });

    test('confidence coerces to "medium" when model returns unknown value', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        ic_opinion: 'ok',
        confidence: 'extremely high', // invalid
      }));
      const out = await generateDealInsights(fixture());
      expect(out.confidence).toBe('medium');
    });

    test('top_risks defensively coerces malformed entries (no crash)', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        ic_opinion: 'ok',
        top_risks: [
          { title: 'Valid' },
          null,
          { detail: 'no title still rendered' },
          'string instead of object',
          { /* empty */ },
        ],
        confidence: 'high',
      }));
      const out = await generateDealInsights(fixture());
      // Defensive filter drops the null and the bare-string and the empty
      // object; keeps the 2 with at least a title or detail.
      expect(out.top_risks).toHaveLength(2);
      expect(out.top_risks[0].title).toBe('Valid');
      expect(out.top_risks[1].detail).toMatch(/no title still rendered/);
    });
  });
});
