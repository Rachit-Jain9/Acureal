'use strict';

/**
 * Tests for extractionVerdicts.service — Workstream C, the standing
 * extraction-quality system.
 *
 * The database layer and the learning-signal service are mocked; the mock
 * `query` dispatches by inspecting the SQL. The ontology is REAL so the
 * accepted / overridden classification is genuinely exercised — including
 * the acres→sqft and ₹→₹Cr unit coercion that the verdict comparison must
 * see through.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/learningSignals.service', () => ({
  recordExtractionVerdictSignals: jest.fn(),
}));

const { query } = require('../src/config/database');
const learningSignals = require('../src/services/learningSignals.service');
const service = require('../src/services/extractionVerdicts.service');

const EXT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEAL_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ORG_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const undefinedTable = () =>
  Object.assign(new Error('relation "x" does not exist'), { code: '42P01' });

// A document_extractions row as returned by the verdict service's SELECT.
const extractionRow = (overrides = {}) => ({
  id: EXT_A,
  doc_type: 'sale_deed',
  provider: 'gemini',
  structured_fields: { survey_number: '45/2A', consideration_inr: 180000000 },
  confidence_scores: { survey_number: 1, consideration_inr: 1 },
  ...overrides,
});

// Dispatch query() by SQL: SELECT extractions, INSERT verdicts.
const dispatcher = (rows) => (sql) => {
  if (/FROM public\.document_extractions/.test(sql)) return Promise.resolve({ rows });
  if (/INTO public\.extraction_field_verdicts/.test(sql)) return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [] });
};

beforeEach(() => {
  query.mockReset();
  learningSignals.recordExtractionVerdictSignals.mockReset();
  learningSignals.recordExtractionVerdictSignals.mockResolvedValue(0);
});

let warnSpy;
let errorSpy;
beforeAll(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('classifyVerdict', () => {
  const { classifyVerdict } = service.__internal;

  it('accepts when the applied value equals the AI value', () => {
    expect(classifyVerdict('survey_number', '45/2A', '45/2A')).toBe('accepted');
  });

  it('overrides when the applied value differs from the AI value', () => {
    expect(classifyVerdict('survey_number', '45/2A', '99/3B')).toBe('overridden');
  });

  it('accepts across unit coercion — AI acres kept as the applied sqft', () => {
    // land_area_acres routes through acres_to_sqft: 2.5 acres = 108900 sqft.
    expect(classifyVerdict('land_area_acres', 2.5, 108900)).toBe('accepted');
  });

  it('accepts across the ₹ → ₹Cr coercion', () => {
    // consideration_inr routes through inr_to_cr: ₹18,00,00,000 = ₹18 Cr.
    expect(classifyVerdict('consideration_inr', 180000000, 18)).toBe('accepted');
    expect(classifyVerdict('consideration_inr', 180000000, 20)).toBe('overridden');
  });

  it('overrides when the AI value is missing or unparseable', () => {
    expect(classifyVerdict('survey_number', null, '45/2A')).toBe('overridden');
    expect(classifyVerdict('land_area_sqft', 'not-a-number', 5000)).toBe('overridden');
  });
});

describe('valuesMatch', () => {
  const { valuesMatch } = service.__internal;

  it('matches numbers within a relative epsilon', () => {
    expect(valuesMatch(108900, 108900.00001)).toBe(true);
    expect(valuesMatch(100, 101)).toBe(false);
  });

  it('matches strings case-insensitively and trimmed', () => {
    expect(valuesMatch('  45/2A ', '45/2a')).toBe(true);
    expect(valuesMatch('45/2A', '99/3B')).toBe(false);
  });
});

describe('recordVerdictsForApply', () => {
  it('records a verdict per traceable applied field + emits the learning signal', async () => {
    query.mockImplementation(dispatcher([extractionRow()]));

    const count = await service.recordVerdictsForApply({
      dealId: DEAL_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      applied: [
        {
          canonical_field: 'survey_number',
          value: '45/2A',
          source_extraction_id: EXT_A,
          source_field: 'survey_number',
        },
        {
          // Operator overrode ₹18 Cr → ₹20 Cr.
          canonical_field: 'consideration_inr',
          value: 20,
          source_extraction_id: EXT_A,
          source_field: 'consideration_inr',
        },
      ],
    });

    expect(count).toBe(2);

    const insertCall = query.mock.calls.find((c) =>
      /INTO public\.extraction_field_verdicts/.test(c[0]),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toMatch(/ON CONFLICT/i);

    const verdicts = JSON.parse(insertCall[1][2]);
    expect(verdicts).toHaveLength(2);
    // survey_number untouched → accepted; consideration_inr changed → overridden.
    expect(verdicts.find((v) => v.canonical_field === 'survey_number').verdict).toBe('accepted');
    expect(verdicts.find((v) => v.canonical_field === 'consideration_inr').verdict).toBe('overridden');
    // Metadata rides along, values do not.
    const survey = verdicts.find((v) => v.canonical_field === 'survey_number');
    expect(survey.doc_type).toBe('sale_deed');
    expect(survey.ai_provider).toBe('gemini');
    expect(survey.ai_confidence).toBe(1);

    expect(learningSignals.recordExtractionVerdictSignals).toHaveBeenCalledTimes(1);
    expect(learningSignals.recordExtractionVerdictSignals).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, dealId: DEAL_ID, userId: USER_ID }),
    );
  });

  it('skips applied fields with no traceable AI source', async () => {
    query.mockImplementation(dispatcher([extractionRow()]));
    const count = await service.recordVerdictsForApply({
      dealId: DEAL_ID,
      // No source_extraction_id / source_field — cannot be classified.
      applied: [{ canonical_field: 'survey_number', value: 'X' }],
    });
    expect(count).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(learningSignals.recordExtractionVerdictSignals).not.toHaveBeenCalled();
  });

  it('skips a field whose source extraction is not visible (RLS / deleted)', async () => {
    query.mockImplementation(dispatcher([])); // SELECT returns nothing
    const count = await service.recordVerdictsForApply({
      dealId: DEAL_ID,
      applied: [
        {
          canonical_field: 'survey_number',
          value: '45/2A',
          source_extraction_id: EXT_A,
          source_field: 'survey_number',
        },
      ],
    });
    expect(count).toBe(0);
    expect(
      query.mock.calls.some((c) => /INTO public\.extraction_field_verdicts/.test(c[0])),
    ).toBe(false);
    expect(learningSignals.recordExtractionVerdictSignals).not.toHaveBeenCalled();
  });

  it('de-duplicates verdicts on (extraction, canonical field) — last value wins', async () => {
    query.mockImplementation(dispatcher([extractionRow()]));
    const count = await service.recordVerdictsForApply({
      dealId: DEAL_ID,
      applied: [
        {
          canonical_field: 'survey_number',
          value: '45/2A',
          source_extraction_id: EXT_A,
          source_field: 'survey_number',
        },
        {
          canonical_field: 'survey_number',
          value: '99/9Z',
          source_extraction_id: EXT_A,
          source_field: 'survey_number',
        },
      ],
    });
    expect(count).toBe(1);
    const insertCall = query.mock.calls.find((c) =>
      /INTO public\.extraction_field_verdicts/.test(c[0]),
    );
    const verdicts = JSON.parse(insertCall[1][2]);
    expect(verdicts).toHaveLength(1);
    // The last applied value ('99/9Z') wins → differs from AI '45/2A'.
    expect(verdicts[0].verdict).toBe('overridden');
  });

  it('returns 0 for an empty applied list without touching the DB', async () => {
    const count = await service.recordVerdictsForApply({ dealId: DEAL_ID, applied: [] });
    expect(count).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('never throws — a missing verdicts table is swallowed', async () => {
    query.mockImplementation((sql) => {
      if (/FROM public\.document_extractions/.test(sql)) {
        return Promise.resolve({ rows: [extractionRow()] });
      }
      if (/INTO public\.extraction_field_verdicts/.test(sql)) {
        return Promise.reject(undefinedTable());
      }
      return Promise.resolve({ rows: [] });
    });
    const count = await service.recordVerdictsForApply({
      dealId: DEAL_ID,
      applied: [
        {
          canonical_field: 'survey_number',
          value: '45/2A',
          source_extraction_id: EXT_A,
          source_field: 'survey_number',
        },
      ],
    });
    expect(count).toBe(0);
  });

  it('never throws — a generic DB error is swallowed', async () => {
    query.mockRejectedValue(new Error('connection reset'));
    const count = await service.recordVerdictsForApply({
      dealId: DEAL_ID,
      applied: [
        {
          canonical_field: 'survey_number',
          value: '45/2A',
          source_extraction_id: EXT_A,
          source_field: 'survey_number',
        },
      ],
    });
    expect(count).toBe(0);
  });
});

describe('getExtractionAccuracy', () => {
  it('aggregates verdicts into per-field rates and an overall accuracy', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { doc_type: 'sale_deed', canonical_field: 'consideration_inr', reviewed: 10, corrected: 4 },
        { doc_type: 'sale_deed', canonical_field: 'survey_number', reviewed: 10, corrected: 1 },
      ],
    });
    const result = await service.getExtractionAccuracy({ days: 30 });
    expect(result.available).toBe(true);
    expect(result.window_days).toBe(30);
    expect(result.by_field).toHaveLength(2);
    expect(result.overall.reviewed).toBe(20);
    expect(result.overall.corrected).toBe(5);
    // 15 of 20 applied fields accepted → 75% accuracy.
    expect(result.overall.accuracy_pct).toBe(75);
    expect(
      result.by_field.find((f) => f.field_key === 'consideration_inr').accuracy_pct,
    ).toBe(60);
  });

  it('soft-fails to an empty shape when the table is not yet migrated', async () => {
    query.mockRejectedValueOnce(undefinedTable());
    const result = await service.getExtractionAccuracy({ days: 90 });
    expect(result.available).toBe(false);
    expect(result.by_field).toEqual([]);
    expect(result.overall.accuracy_pct).toBeNull();
  });

  it('clamps the trailing window to a sane range', async () => {
    query.mockResolvedValue({ rows: [] });
    expect((await service.getExtractionAccuracy({ days: 9999 })).window_days).toBe(365);
    expect((await service.getExtractionAccuracy({ days: 0 })).window_days).toBe(90);
  });
});
