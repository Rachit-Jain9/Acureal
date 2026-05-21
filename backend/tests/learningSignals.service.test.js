'use strict';

/**
 * Unit tests for learningSignals.service.js — the Layer-5 signal writer.
 * Pins the values-free, consent-gated, fire-and-forget contract for both
 * signal types: extraction_field_verdict and comp_reliance.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/consent.service', () => ({ hasConsent: jest.fn() }));

const { query } = require('../src/config/database');
const consentService = require('../src/services/consent.service');
const learningSignals = require('../src/services/learningSignals.service');

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const DEAL_ID = '33333333-3333-3333-3333-333333333333';
const COMP_ID = '44444444-4444-4444-4444-444444444444';
const EXT_ID = '55555555-5555-5555-5555-555555555555';

const sampleVerdicts = () => [
  {
    extraction_id: EXT_ID,
    canonical_field: 'survey_number',
    source_field: 'survey_number',
    doc_type: 'sale_deed',
    ai_provider: 'gemini',
    ai_confidence: 1,
    verdict: 'accepted',
  },
  {
    extraction_id: EXT_ID,
    canonical_field: 'consideration_inr',
    source_field: 'consideration_inr',
    doc_type: 'sale_deed',
    ai_provider: 'gemini',
    ai_confidence: 1,
    verdict: 'overridden',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  consentService.hasConsent.mockResolvedValue(true);
});

describe('recordExtractionVerdictSignals', () => {
  test('writes one values-free signal per verdict', async () => {
    const count = await learningSignals.recordExtractionVerdictSignals({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      verdicts: sampleVerdicts(),
      userId: USER_ID,
    });
    expect(count).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO public\.improvement_signals/i);
    expect(sql).toMatch(/extraction_field_verdict/);
    expect(params[0]).toBe(ORG_ID);

    const details = JSON.parse(params[2]);
    expect(details).toHaveLength(2);
    expect(details.find((d) => d.canonical_field === 'consideration_inr').verdict).toBe(
      'overridden',
    );
    expect(details[0].deal_id).toBe(DEAL_ID);

    // Values-free: the detail carries field KEYS + metadata only — never a
    // field value. Pin the exact key set.
    expect(Object.keys(details[0]).sort()).toEqual(
      [
        'ai_confidence',
        'ai_provider',
        'canonical_field',
        'deal_id',
        'doc_type',
        'extraction_id',
        'source_field',
        'verdict',
      ].sort(),
    );
  });

  test('attaches the user id only when product_improvement consent is granted', async () => {
    consentService.hasConsent.mockResolvedValueOnce(true);
    await learningSignals.recordExtractionVerdictSignals({
      verdicts: sampleVerdicts(),
      userId: USER_ID,
    });
    expect(query.mock.calls[0][1][1]).toBe(USER_ID);
    expect(consentService.hasConsent).toHaveBeenCalledWith(USER_ID, 'product_improvement');
  });

  test('records an anonymous (null user) row when consent is withheld', async () => {
    consentService.hasConsent.mockResolvedValueOnce(false);
    await learningSignals.recordExtractionVerdictSignals({
      verdicts: sampleVerdicts(),
      userId: USER_ID,
    });
    expect(query.mock.calls[0][1][1]).toBeNull();
  });

  test('returns 0 and writes nothing for an empty verdict list', async () => {
    const count = await learningSignals.recordExtractionVerdictSignals({ verdicts: [] });
    expect(count).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  test('never throws — a DB failure is swallowed and returns 0', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('relation does not exist'), { code: '42P01' }),
    );
    const count = await learningSignals.recordExtractionVerdictSignals({
      verdicts: sampleVerdicts(),
      userId: USER_ID,
    });
    expect(count).toBe(0);
  });
});

describe('recordCompRelianceSignal', () => {
  test('writes one comp_reliance signal carrying the scorer verdict', async () => {
    const count = await learningSignals.recordCompRelianceSignal({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      compId: COMP_ID,
      relied: true,
      similarityScore: 0.82,
      similarityRank: 3,
      rateDeltaPct: -4.1,
      userId: USER_ID,
    });
    expect(count).toBe(1);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO public\.improvement_signals/i);
    expect(sql).toMatch(/comp_reliance/);

    const detail = JSON.parse(params[2]);
    expect(detail).toMatchObject({
      deal_id: DEAL_ID,
      comp_id: COMP_ID,
      relied_on: true,
      similarity_score: 0.82,
      similarity_rank: 3,
      rate_delta_pct: -4.1,
    });
  });

  test('returns 0 without a deal id or comp id', async () => {
    const count = await learningSignals.recordCompRelianceSignal({ relied: true });
    expect(count).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  test('records an anonymous row when consent is withheld', async () => {
    consentService.hasConsent.mockResolvedValueOnce(false);
    await learningSignals.recordCompRelianceSignal({
      dealId: DEAL_ID,
      compId: COMP_ID,
      relied: false,
      userId: USER_ID,
    });
    expect(query.mock.calls[0][1][1]).toBeNull();
  });

  test('never throws — a DB failure is swallowed and returns 0', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('relation does not exist'), { code: '42P01' }),
    );
    const count = await learningSignals.recordCompRelianceSignal({
      dealId: DEAL_ID,
      compId: COMP_ID,
      relied: true,
      userId: USER_ID,
    });
    expect(count).toBe(0);
  });
});
