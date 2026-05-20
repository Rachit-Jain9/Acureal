'use strict';

/**
 * Unit tests for consent.service.js — the DPDP §6 per-purpose consent ledger.
 *
 * The ledger is append-only: every decision is a new row, and a withdrawal is
 * a new granted = false row. These tests pin that contract, plus the graceful
 * degradation when migration 20260607 has not been applied yet (PG 42P01).
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query } = require('../src/config/database');
const consentService = require('../src/services/consent.service');

const USER_ID = '11111111-1111-1111-1111-111111111111';

const missingTableError = () =>
  Object.assign(new Error('relation "public.user_consents" does not exist'), {
    code: '42P01',
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CONSENT_PURPOSES', () => {
  test('is the four optional, withdrawable purposes', () => {
    expect(consentService.CONSENT_PURPOSES).toEqual([
      'product_improvement',
      'anonymized_benchmarking',
      'marketing',
      'ai_processing',
    ]);
  });

  test('does not include essential_service (it is implied, never stored)', () => {
    expect(consentService.CONSENT_PURPOSES).not.toContain('essential_service');
  });
});

describe('recordConsent', () => {
  test('rejects an unknown purpose without touching the database', async () => {
    await expect(
      consentService.recordConsent({ userId: USER_ID, purpose: 'tracking', granted: true })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects a non-boolean granted value', async () => {
    await expect(
      consentService.recordConsent({ userId: USER_ID, purpose: 'marketing', granted: 'yes' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects an unknown source', async () => {
    await expect(
      consentService.recordConsent({
        userId: USER_ID,
        purpose: 'marketing',
        granted: true,
        source: 'spreadsheet',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects a missing userId', async () => {
    await expect(
      consentService.recordConsent({ purpose: 'marketing', granted: true })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('appends a row with the decision and provenance', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, user_id: USER_ID, purpose: 'marketing', granted: true }],
    });
    await consentService.recordConsent({
      userId: USER_ID,
      purpose: 'marketing',
      granted: true,
      policyVersion: 'v3',
      source: 'privacy_centre',
      ipAddress: '203.0.113.7',
      userAgent: 'jest',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO public\.user_consents/i);
    expect(query.mock.calls[0][1]).toEqual([
      USER_ID,
      'marketing',
      true,
      'v3',
      'privacy_centre',
      '203.0.113.7',
      'jest',
    ]);
  });

  test('surfaces a 503 when the ledger table is not yet migrated', async () => {
    query.mockRejectedValueOnce(missingTableError());
    await expect(
      consentService.recordConsent({ userId: USER_ID, purpose: 'marketing', granted: true })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  test('enlists a caller-supplied transaction client', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 9 }] }) };
    await consentService.recordConsent(
      { userId: USER_ID, purpose: 'ai_processing', granted: false },
      client
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('recordConsents', () => {
  test('writes one row per valid decision and returns the count', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    const recorded = await consentService.recordConsents({
      userId: USER_ID,
      decisions: { marketing: true, ai_processing: false },
    });
    expect(recorded).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('silently drops unknown purposes and non-boolean values', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    const recorded = await consentService.recordConsents({
      userId: USER_ID,
      decisions: { marketing: true, tracking: true, ai_processing: 'maybe' },
    });
    expect(recorded).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1][1]).toBe('marketing');
  });

  test('rejects a non-object decisions payload', async () => {
    await expect(
      consentService.recordConsents({ userId: USER_ID, decisions: null })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('getConsentState', () => {
  test('defaults every purpose to false when the user has no rows', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { state, available } = await consentService.getConsentState(USER_ID);
    expect(available).toBe(true);
    expect(state).toEqual({
      product_improvement: false,
      anonymized_benchmarking: false,
      marketing: false,
      ai_processing: false,
    });
  });

  test('overlays the latest decision per purpose', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { purpose: 'marketing', granted: true },
        { purpose: 'anonymized_benchmarking', granted: false },
      ],
    });
    const { state } = await consentService.getConsentState(USER_ID);
    expect(state.marketing).toBe(true);
    expect(state.anonymized_benchmarking).toBe(false);
    expect(state.ai_processing).toBe(false);
  });

  test('reports available: false when the ledger table is missing', async () => {
    query.mockRejectedValueOnce(missingTableError());
    const { state, available } = await consentService.getConsentState(USER_ID);
    expect(available).toBe(false);
    expect(state.marketing).toBe(false);
  });
});

describe('hasConsent', () => {
  test('is true when the purpose is currently granted', async () => {
    query.mockResolvedValueOnce({ rows: [{ purpose: 'ai_processing', granted: true }] });
    await expect(consentService.hasConsent(USER_ID, 'ai_processing')).resolves.toBe(true);
  });

  test('is false when the purpose is not granted', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(consentService.hasConsent(USER_ID, 'marketing')).resolves.toBe(false);
  });

  test('is false for an unknown purpose without touching the database', async () => {
    await expect(consentService.hasConsent(USER_ID, 'tracking')).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('getConsentHistory', () => {
  test('returns the append-only history newest-first', async () => {
    const rows = [
      { id: 2, purpose: 'marketing', granted: false },
      { id: 1, purpose: 'marketing', granted: true },
    ];
    query.mockResolvedValueOnce({ rows });
    await expect(consentService.getConsentHistory(USER_ID)).resolves.toEqual(rows);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/i);
  });

  test('returns an empty array when the ledger table is missing', async () => {
    query.mockRejectedValueOnce(missingTableError());
    await expect(consentService.getConsentHistory(USER_ID)).resolves.toEqual([]);
  });
});
