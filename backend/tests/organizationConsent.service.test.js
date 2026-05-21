'use strict';

/**
 * Tests for organizationConsent.service — Workstream C2.
 *
 * Pins the append-only, migration-tolerant contract of the org-level
 * data-governance ledger. The database layer is mocked.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const service = require('../src/services/organizationConsent.service');

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const undefinedTable = () =>
  Object.assign(new Error('relation "organization_consents" does not exist'), {
    code: '42P01',
  });

beforeEach(() => {
  query.mockReset();
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

describe('recordOrgConsent', () => {
  test('appends a governance decision row and returns it', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, organization_id: ORG_ID, purpose: 'benchmark_opt_out', granted: true }],
    });
    const row = await service.recordOrgConsent({
      organizationId: ORG_ID,
      purpose: 'benchmark_opt_out',
      granted: true,
      changedBy: USER_ID,
    });
    expect(row.purpose).toBe('benchmark_opt_out');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO public\.organization_consents/i);
    expect(params[0]).toBe(ORG_ID);
    expect(params[2]).toBe(true);
    expect(params[3]).toBe(USER_ID);
  });

  test('rejects a missing organizationId', async () => {
    await expect(
      service.recordOrgConsent({ purpose: 'benchmark_opt_out', granted: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects an unknown purpose', async () => {
    await expect(
      service.recordOrgConsent({ organizationId: ORG_ID, purpose: 'nope', granted: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a non-boolean decision', async () => {
    await expect(
      service.recordOrgConsent({
        organizationId: ORG_ID,
        purpose: 'benchmark_opt_out',
        granted: 'yes',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an unknown source', async () => {
    await expect(
      service.recordOrgConsent({
        organizationId: ORG_ID,
        purpose: 'benchmark_opt_out',
        granted: true,
        source: 'hacker',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('surfaces a 503 when the ledger table is not yet migrated', async () => {
    query.mockRejectedValueOnce(undefinedTable());
    await expect(
      service.recordOrgConsent({
        organizationId: ORG_ID,
        purpose: 'benchmark_opt_out',
        granted: true,
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('getOrgConsentState', () => {
  test('defaults benchmark_opt_out to false when there is no decision', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { state, available } = await service.getOrgConsentState(ORG_ID);
    expect(state).toEqual({ benchmark_opt_out: false });
    expect(available).toBe(true);
  });

  test('reflects the newest decision per purpose', async () => {
    query.mockResolvedValueOnce({ rows: [{ purpose: 'benchmark_opt_out', granted: true }] });
    const { state } = await service.getOrgConsentState(ORG_ID);
    expect(state.benchmark_opt_out).toBe(true);
  });

  test('reports available: false when the table is missing', async () => {
    query.mockRejectedValueOnce(undefinedTable());
    const { state, available } = await service.getOrgConsentState(ORG_ID);
    expect(available).toBe(false);
    expect(state.benchmark_opt_out).toBe(false);
  });
});

describe('isBenchmarkingOptedOut', () => {
  test('true when the current decision is granted', async () => {
    query.mockResolvedValueOnce({ rows: [{ purpose: 'benchmark_opt_out', granted: true }] });
    expect(await service.isBenchmarkingOptedOut(ORG_ID)).toBe(true);
  });

  test('false when there is no decision', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await service.isBenchmarkingOptedOut(ORG_ID)).toBe(false);
  });

  test('false (the safe default) when the table is not yet migrated', async () => {
    query.mockRejectedValueOnce(undefinedTable());
    expect(await service.isBenchmarkingOptedOut(ORG_ID)).toBe(false);
  });
});

describe('getOrgConsentHistory', () => {
  test('returns the append-only history newest first', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 2, purpose: 'benchmark_opt_out', granted: true, changed_by_name: 'A' },
        { id: 1, purpose: 'benchmark_opt_out', granted: false, changed_by_name: 'A' },
      ],
    });
    const history = await service.getOrgConsentHistory(ORG_ID);
    expect(history).toHaveLength(2);
    expect(query.mock.calls[0][0]).toMatch(/LEFT JOIN public\.users/i);
  });

  test('degrades to an empty list when the table is missing', async () => {
    query.mockRejectedValueOnce(undefinedTable());
    expect(await service.getOrgConsentHistory(ORG_ID)).toEqual([]);
  });
});
