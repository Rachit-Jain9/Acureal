'use strict';

// We mock aiRouter + providerRegistry BEFORE requiring the service so the
// module-cached require chain picks up the mocks. Provider availability is
// also mocked so the path that bails on "no providers" is exercisable.
jest.mock('../src/services/ai/aiRouter');
jest.mock('../src/services/ai/providerRegistry');

const aiRouter = require('../src/services/ai/aiRouter');
const providerRegistry = require('../src/services/ai/providerRegistry');
const narrative = require('../src/services/exports/narrative/exportNarrative.service');

const mockGeminiResponse = (jsonText) => {
  aiRouter.runAI.mockResolvedValueOnce({ result: jsonText, callId: 'mock-1', status: 'success', latencyMs: 100 });
};

beforeEach(() => {
  jest.clearAllMocks();
  providerRegistry.getProviderAvailability.mockReturnValue({
    gemini: true,
    claude: true,
    gpt_compatible: true,
  });
});

describe('services/exports/narrative/exportNarrative', () => {
  describe('parseJson', () => {
    const { parseJson } = narrative.__internal;
    test('parses straight JSON', () => {
      expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    });
    test('strips ```json fences', () => {
      expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });
    test('extracts first {...} block when surrounded by prose', () => {
      expect(parseJson('Here you go:\n{"a":2}\nThanks.')).toEqual({ a: 2 });
    });
    test('returns null on non-JSON', () => {
      expect(parseJson('not json here')).toBeNull();
    });
    test('returns null on empty / null input', () => {
      expect(parseJson('')).toBeNull();
      expect(parseJson(null)).toBeNull();
    });
  });

  describe('isEnglishOnly', () => {
    const { isEnglishOnly } = narrative.__internal;
    test('accepts plain English text', () => {
      expect(isEnglishOnly('Whitefield is a strong micro-market.')).toBe(true);
    });
    test('rejects Devanagari', () => {
      expect(isEnglishOnly('व्हाइटफील्ड')).toBe(false);
    });
    test('rejects Kannada', () => {
      expect(isEnglishOnly('ವೈಟ್‌ಫೀಲ್ಡ್')).toBe(false);
    });
    test('walks arrays and objects', () => {
      expect(isEnglishOnly(['fine', 'also fine'])).toBe(true);
      expect(isEnglishOnly({ a: 'fine', b: ['ok'] })).toBe(true);
      expect(isEnglishOnly({ a: 'fine', b: 'व्हाइटफील्ड' })).toBe(false);
    });
    test('treats null/undefined as English (no rejection)', () => {
      expect(isEnglishOnly(null)).toBe(true);
      expect(isEnglishOnly(undefined)).toBe(true);
    });
  });

  describe('collectSources / inferConfidence', () => {
    const { collectSources, inferConfidence } = narrative.__internal;
    test('collectSources picks only fields present in payload', () => {
      const sources = collectSources('whyThisArea', {
        locality: 'Whitefield',
        infra_proximity: { metro: '2 km' },
        intelligence_briefs: [],
      });
      expect(sources).toEqual(['locality', 'infra_proximity']);
    });
    test('inferConfidence is low for empty payload, high for 3+ fields', () => {
      expect(inferConfidence('whyThisArea', {})).toBe('low');
      expect(inferConfidence('whyThisArea', {
        locality: 'x', city: 'y', infra_proximity: { a: 1 },
      })).toBe('high');
    });
  });

  describe('generateSection', () => {
    test('returns unavailable when no providers are configured', async () => {
      providerRegistry.getProviderAvailability.mockReturnValueOnce({
        gemini: false, claude: false, gpt_compatible: false,
      });
      const result = await narrative.generateSection({ section: 'whyThisArea', payload: {} });
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/No narrative provider configured/);
    });

    test('returns unavailable for unknown section', async () => {
      const result = await narrative.generateSection({ section: 'whatever', payload: {} });
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/Unknown section/);
    });

    test('whyThisArea returns parsed paragraphs and confidence', async () => {
      mockGeminiResponse('{"paragraphs":["Para 1.","Para 2."],"summary":"Summary line."}');
      const result = await narrative.generateSection({
        section: 'whyThisArea',
        payload: {
          locality: 'Whitefield',
          city: 'Bengaluru',
          infra_proximity: { metro: '2 km' },
        },
      });
      expect(result.available).toBe(true);
      expect(result.paragraphs).toEqual(['Para 1.', 'Para 2.']);
      expect(result.summary).toBe('Summary line.');
      expect(result.confidence).toBe('high');
      expect(result.sources).toContain('locality');
    });

    test('prosCons returns parsed pros/cons trimmed', async () => {
      mockGeminiResponse(JSON.stringify({
        pros: ['Strong location anchor.', 'Approvals largely in place.'],
        cons: ['Thin DSCR cushion.', 'Limited verified comps.'],
      }));
      const result = await narrative.generateSection({
        section: 'prosCons',
        payload: { kpis: { irrPct: 22 } },
      });
      expect(result.available).toBe(true);
      expect(result.pros).toHaveLength(2);
      expect(result.cons).toHaveLength(2);
      expect(result.pros[0]).toBe('Strong location anchor.');
    });

    test('cashflowLevers caps at 5 levers', async () => {
      mockGeminiResponse(JSON.stringify({
        levers: [
          'Tighten construction phasing to defer peak equity.',
          'Layer in mezzanine debt to lift project IRR.',
          'Shift sales launch earlier to accelerate collection.',
          'Renegotiate land terms for deferred consideration.',
          'Stagger marketing spend with sales velocity.',
          'Sixth lever that should be dropped.',
        ],
      }));
      const result = await narrative.generateSection({
        section: 'cashflowLevers',
        payload: { kpis: {} },
      });
      expect(result.available).toBe(true);
      expect(result.levers).toHaveLength(5);
      expect(result.levers).not.toContain('Sixth lever that should be dropped.');
    });

    test('rejects non-English content', async () => {
      mockGeminiResponse(JSON.stringify({
        paragraphs: ['व्हाइटफील्ड एक मजबूत बाजार है।'],
        summary: 'Summary',
      }));
      const result = await narrative.generateSection({
        section: 'whyThisArea',
        payload: { locality: 'Whitefield' },
      });
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/non-English/i);
    });

    test('returns unavailable on unparseable model output', async () => {
      mockGeminiResponse('this is not json at all');
      const result = await narrative.generateSection({
        section: 'whyThisArea',
        payload: { locality: 'Whitefield' },
      });
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/unparseable/i);
    });

    test('falls back to OpenAI when Gemini errors', async () => {
      // Gemini call rejects, OpenAI call resolves with valid JSON.
      aiRouter.runAI.mockRejectedValueOnce(new Error('Gemini quota exhausted'));
      aiRouter.runAI.mockResolvedValueOnce({
        result: JSON.stringify({ paragraphs: ['OpenAI fallback worked.'], summary: 'ok' }),
        callId: 'mock-2',
        status: 'success',
        latencyMs: 150,
      });
      const result = await narrative.generateSection({
        section: 'whyThisArea',
        payload: { locality: 'Whitefield' },
      });
      expect(aiRouter.runAI).toHaveBeenCalledTimes(2);
      expect(result.available).toBe(true);
      expect(result.paragraphs[0]).toBe('OpenAI fallback worked.');
    });

    test('returns unavailable when all providers fail', async () => {
      aiRouter.runAI.mockRejectedValueOnce(new Error('Gemini boom'));
      aiRouter.runAI.mockRejectedValueOnce(new Error('OpenAI also down'));
      const result = await narrative.generateSection({
        section: 'whyThisArea',
        payload: { locality: 'Whitefield' },
      });
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/Provider call failed/);
    });
  });

  describe('SECTION_SCHEMAS shape', () => {
    test('every section has description / schema / instructions', () => {
      Object.entries(narrative.SECTION_SCHEMAS).forEach(([section, def]) => {
        expect(typeof def.description).toBe('string');
        expect(typeof def.instructions).toBe('string');
        expect(def.schema).toBeTruthy();
      });
    });
  });
});
