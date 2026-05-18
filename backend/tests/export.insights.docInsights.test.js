'use strict';

// PR-NX45 (2026-05-18) — Document-Derived Insights tests.
//
// Cross-document reasoning via Claude (primary) → OpenAI (secondary).
// Auto-no-op fast paths when no extractions have structured_fields.

jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(),
}));

jest.mock('../src/services/ai/aiRouter', () => ({
  runClaudeReasoning: jest.fn(),
  runAI: jest.fn(),
}));

const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
const { runClaudeReasoning, runAI } = require('../src/services/ai/aiRouter');
const { generateDocumentInsights, buildDocInsightsPayload } = require('../src/services/export.insights.service');

const fixture = ({ extractions = [] } = {}) => ({
  deal: {
    id: 'd-1', organization_id: 'o-1',
    name: 'Test Deal',
    asset_class: 'residential_apartments',
    city: 'Bengaluru',
    owner_name: 'Stated Owner Pvt Ltd',
    survey_number: '12/2A',
  },
  extractions,
});

const sampleExtractions = [
  {
    id: 'ext-1', document_id: 'doc-1', doc_type: 'sale_deed', provider: 'gemini',
    structured_fields: { owner_name: 'Real Owner Pvt Ltd', survey_number: '12/2A', consideration: '50000000', sale_date: '2024-06-15' },
  },
  {
    id: 'ext-2', document_id: 'doc-2', doc_type: 'ec', provider: 'gemini',
    structured_fields: { ec_period: '2014-2024', encumbrance_status: 'no_encumbrance', lien_holders: [] },
  },
  {
    id: 'ext-3', document_id: 'doc-3', doc_type: 'rtc', provider: 'gemini',
    structured_fields: { owner_name: 'Different Owner Realty', survey_number: '12/2', area_acres: '0.85' },
  },
];

beforeEach(() => {
  getProviderAvailability.mockReset();
  runClaudeReasoning.mockReset();
  runAI.mockReset();
});

describe('PR-NX45 — generateDocumentInsights', () => {
  describe('no-op fast paths', () => {
    test('empty extractions array → unavailable', async () => {
      const out = await generateDocumentInsights(fixture({ extractions: [] }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/no extractions with structured_fields/);
      expect(runClaudeReasoning).not.toHaveBeenCalled();
      expect(runAI).not.toHaveBeenCalled();
    });

    test('extractions with empty structured_fields → unavailable', async () => {
      const empty = [
        { id: 'ext-1', doc_type: 'sale_deed', structured_fields: {} },
        { id: 'ext-2', doc_type: 'ec', structured_fields: null },
      ];
      const out = await generateDocumentInsights(fixture({ extractions: empty }));
      expect(out.available).toBe(false);
      expect(runClaudeReasoning).not.toHaveBeenCalled();
    });
  });

  describe('happy paths (Claude primary)', () => {
    test('Claude succeeds → provider=claude-sonnet-4-6 + findings parsed', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        summary_paragraph: '3 documents on file: sale deed, EC, RTC. Coverage adequate for title diligence.',
        findings: [
          {
            title: 'Owner name mismatch — sale deed vs RTC',
            severity: 'critical',
            description: 'Sale deed shows "Real Owner Pvt Ltd" but RTC shows "Different Owner Realty". Survey number also differs (12/2A vs 12/2).',
            recommendation: 'Order updated mutation/khata before proceeding.',
          },
        ],
        confidence: 'high',
      }));
      const out = await generateDocumentInsights(fixture({ extractions: sampleExtractions }));
      expect(out.available).toBe(true);
      expect(out.summary_paragraph).toMatch(/3 documents/);
      expect(out.findings).toHaveLength(1);
      expect(out.findings[0].severity).toBe('critical');
      expect(out.findings[0].recommendation).toMatch(/Order updated mutation/);
      expect(out.provider).toBe('claude-sonnet-4-6');
      expect(out.fallbackReason).toBeNull();
    });

    test('Claude returns zero findings → renders successfully (positive signal)', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        summary_paragraph: 'Documents corroborate one another.',
        findings: [],
        confidence: 'high',
      }));
      const out = await generateDocumentInsights(fixture({ extractions: sampleExtractions }));
      expect(out.available).toBe(true);
      expect(out.findings).toEqual([]);
      expect(out.confidence).toBe('high');
    });

    test('Claude 429 → OpenAI rescues → fallbackReason cites error', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockRejectedValueOnce(Object.assign(new Error('rate_limited'), { status: 429 }));
      runAI.mockResolvedValueOnce({
        result: JSON.stringify({
          summary_paragraph: 'OpenAI fallback summary.',
          findings: [{ title: 'A finding', severity: 'medium', description: 'detail', recommendation: 'fix' }],
          confidence: 'medium',
        }),
        model: 'gpt-5.4',
      });
      const out = await generateDocumentInsights(fixture({ extractions: sampleExtractions }));
      expect(out.available).toBe(true);
      expect(out.provider).toBe('gpt-5.4');
      expect(out.fallbackReason).toMatch(/Claude 429 rate_limited/);
      expect(out.fallbackReason).toMatch(/auto-failover succeeded on openai/);
    });
  });

  describe('not-available paths', () => {
    test('no providers → unavailable', async () => {
      getProviderAvailability.mockReturnValue({ claude: false, gpt_compatible: false });
      const out = await generateDocumentInsights(fixture({ extractions: sampleExtractions }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/No AI provider configured/);
    });

    test('both providers fail → unavailable with BOTH errors', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: true });
      runClaudeReasoning.mockRejectedValueOnce(new Error('claude_outage'));
      runAI.mockRejectedValueOnce(new Error('openai_outage'));
      const out = await generateDocumentInsights(fixture({ extractions: sampleExtractions }));
      expect(out.available).toBe(false);
      expect(out.reason).toMatch(/Claude claude_outage/);
      expect(out.reason).toMatch(/OpenAI openai_outage/);
    });
  });

  describe('buildDocInsightsPayload', () => {
    test('groups extractions by doctype + caps fields at 30 per doc', () => {
      const manyFields = Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [`field_${i}`, `value_${i}`])
      );
      const ext = [{ id: 'ext-1', doc_type: 'sale_deed', structured_fields: manyFields }];
      const payload = buildDocInsightsPayload(fixture({ extractions: ext }));
      expect(payload.documents_by_type.sale_deed).toHaveLength(1);
      expect(Object.keys(payload.documents_by_type.sale_deed[0].fields)).toHaveLength(30);
    });

    test('drops null/empty field values', () => {
      const ext = [{
        id: 'ext-1', doc_type: 'sale_deed',
        structured_fields: { owner_name: 'X', survey_number: '', consideration: null, sale_date: '2024-01-01' },
      }];
      const payload = buildDocInsightsPayload(fixture({ extractions: ext }));
      const fields = payload.documents_by_type.sale_deed[0].fields;
      expect(fields).toHaveProperty('owner_name', 'X');
      expect(fields).toHaveProperty('sale_date', '2024-01-01');
      expect(fields).not.toHaveProperty('survey_number');
      expect(fields).not.toHaveProperty('consideration');
    });

    test('counts documents per type', () => {
      const ext = [
        { id: 'ext-1', doc_type: 'sale_deed', structured_fields: { x: 'y' } },
        { id: 'ext-2', doc_type: 'sale_deed', structured_fields: { x: 'y' } },
        { id: 'ext-3', doc_type: 'ec', structured_fields: { x: 'y' } },
      ];
      const payload = buildDocInsightsPayload(fixture({ extractions: ext }));
      expect(payload.document_counts).toEqual({ sale_deed: 2, ec: 1 });
    });
  });

  describe('envelope coercion', () => {
    test('findings without title or description filtered out', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: false });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        summary_paragraph: 'ok',
        findings: [
          { title: 'Valid', severity: 'high', description: 'detail' },
          null,
          {}, // empty - dropped
          { severity: 'low', description: 'no title but has detail' }, // kept
        ],
        confidence: 'medium',
      }));
      const out = await generateDocumentInsights(fixture({ extractions: sampleExtractions }));
      expect(out.findings).toHaveLength(2);
    });

    test('invalid severity coerced to "medium"', async () => {
      getProviderAvailability.mockReturnValue({ claude: true, gpt_compatible: false });
      runClaudeReasoning.mockResolvedValueOnce(JSON.stringify({
        summary_paragraph: 'ok',
        findings: [{ title: 'A', severity: 'extreme', description: 'detail' }],
        confidence: 'medium',
      }));
      const out = await generateDocumentInsights(fixture({ extractions: sampleExtractions }));
      expect(out.findings[0].severity).toBe('medium');
    });
  });
});
