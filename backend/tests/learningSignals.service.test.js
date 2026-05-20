'use strict';

/**
 * Unit tests for learningSignals.service.js — Phase 5.1 of the learning loop.
 * Pins the values-free, consent-gated, fire-and-forget contract.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/consent.service', () => ({ hasConsent: jest.fn() }));

const { query } = require('../src/config/database');
const consentService = require('../src/services/consent.service');
const learningSignals = require('../src/services/learningSignals.service');

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';

const sampleExtraction = (overrides = {}) => ({
  id: 'ext-1',
  organization_id: ORG_ID,
  doc_type: 'sale_deed',
  provider: 'gemini',
  structured_fields: { survey_number: '12/3', owner_name: 'A B', consideration_inr: 5000000 },
  confidence_scores: { survey_number: 1, owner_name: 1, consideration_inr: 0, _overall: 0.67 },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  consentService.hasConsent.mockResolvedValue(true);
});

describe('recordExtractionReviewSignals', () => {
  test('writes one values-free signal per field with the corrected flag', async () => {
    const count = await learningSignals.recordExtractionReviewSignals({
      extraction: sampleExtraction(),
      corrections: { owner_name: 'Corrected Name' },
      userId: USER_ID,
    });
    expect(count).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO public\.improvement_signals/i);
    expect(params[0]).toBe(ORG_ID);

    const details = JSON.parse(params[2]);
    expect(details).toHaveLength(3);
    expect(details.find((d) => d.field_key === 'owner_name').was_corrected).toBe(true);
    expect(details.find((d) => d.field_key === 'survey_number').was_corrected).toBe(false);

    // Values-free: no field VALUE may appear anywhere in the captured detail.
    const serialized = JSON.stringify(details);
    expect(serialized).not.toMatch(/Corrected Name/);
    expect(serialized).not.toMatch(/12\/3/);
    expect(serialized).not.toMatch(/5000000/);
  });

  test('attaches the user id only when product_improvement consent is granted', async () => {
    consentService.hasConsent.mockResolvedValueOnce(true);
    await learningSignals.recordExtractionReviewSignals({
      extraction: sampleExtraction(),
      corrections: {},
      userId: USER_ID,
    });
    expect(query.mock.calls[0][1][1]).toBe(USER_ID);
    expect(consentService.hasConsent).toHaveBeenCalledWith(USER_ID, 'product_improvement');
  });

  test('records an anonymous (null user) row when consent is withheld', async () => {
    consentService.hasConsent.mockResolvedValueOnce(false);
    await learningSignals.recordExtractionReviewSignals({
      extraction: sampleExtraction(),
      corrections: {},
      userId: USER_ID,
    });
    expect(query.mock.calls[0][1][1]).toBeNull();
  });

  test('counts a human-added field the AI missed as corrected', async () => {
    await learningSignals.recordExtractionReviewSignals({
      extraction: sampleExtraction({ structured_fields: { survey_number: '1' } }),
      corrections: { khata_number: '42' },
      userId: USER_ID,
    });
    const details = JSON.parse(query.mock.calls[0][1][2]);
    expect(details.find((d) => d.field_key === 'khata_number').was_corrected).toBe(true);
  });

  test('returns 0 and writes nothing for an extraction with no fields', async () => {
    const count = await learningSignals.recordExtractionReviewSignals({
      extraction: sampleExtraction({ structured_fields: {} }),
      corrections: {},
      userId: USER_ID,
    });
    expect(count).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  test('never throws — a DB failure is swallowed and returns 0', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('relation does not exist'), { code: '42P01' })
    );
    const count = await learningSignals.recordExtractionReviewSignals({
      extraction: sampleExtraction(),
      corrections: { owner_name: 'x' },
      userId: USER_ID,
    });
    expect(count).toBe(0);
  });
});

describe('getExtractionAccuracy', () => {
  test('aggregates signals into per-field rates and an overall accuracy', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { doc_type: 'sale_deed', field_key: 'consideration_inr', reviewed: 10, corrected: 4 },
        { doc_type: 'sale_deed', field_key: 'survey_number', reviewed: 10, corrected: 1 },
      ],
    });
    const result = await learningSignals.getExtractionAccuracy({ days: 30 });
    expect(result.available).toBe(true);
    expect(result.window_days).toBe(30);
    expect(result.by_field).toHaveLength(2);
    expect(result.overall.reviewed).toBe(20);
    expect(result.overall.corrected).toBe(5);
    // 15 of 20 fields accepted → 75% accuracy.
    expect(result.overall.accuracy_pct).toBe(75);
    expect(result.by_field.find((f) => f.field_key === 'consideration_inr').accuracy_pct).toBe(60);
  });

  test('soft-fails to an empty shape when the table is not yet migrated', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    const result = await learningSignals.getExtractionAccuracy({ days: 90 });
    expect(result.available).toBe(false);
    expect(result.by_field).toEqual([]);
    expect(result.overall.accuracy_pct).toBeNull();
  });
});
