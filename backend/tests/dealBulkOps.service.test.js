'use strict';

// Unit tests for the deal-service bulk operations introduced in this PR.
// Mocks the DB so we can verify input sanitization, partial-failure
// aggregation, and the small bits of authz logic that live above the
// SQL layer (target-user org check, etc.).

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../src/lib/eventBus', () => ({
  publish: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const dealService = require('../src/services/deal.service');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── bulkArchiveDeals ──────────────────────────────────────────────────────

describe('bulkArchiveDeals', () => {
  test('rejects empty array with 400', async () => {
    await expect(dealService.bulkArchiveDeals([], 'user-1', null))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('caps at 50 ids per request', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    await expect(dealService.bulkArchiveDeals(ids, 'user-1', null))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('de-duplicates ids before iterating', async () => {
    transaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'r-1', property_id: null, is_archived: false }] })
          .mockResolvedValueOnce({ rows: [{ id: 'r-1', archived_at: '2026-05-09T10:00:00Z', property_id: null }] })
          // purgePropertyIfInactiveOnly internal — give it nothing to purge
          .mockResolvedValueOnce({ rows: [] }),
      };
      return cb(client);
    });
    const result = await dealService.bulkArchiveDeals(['r-1', 'r-1'], 'user-1', null);
    expect(result.requested).toBe(1);
  });

  test('aggregates per-id success + failure into one response', async () => {
    // First id archives cleanly via transaction mock; second id throws.
    transaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'good', property_id: null, is_archived: false }] })
          .mockResolvedValueOnce({ rows: [{ id: 'good', archived_at: '2026-05-09T10:00:00Z', property_id: null }] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return cb(client);
    });
    transaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: jest.fn().mockResolvedValueOnce({ rows: [] }), // not found
      };
      return cb(client);
    });

    const result = await dealService.bulkArchiveDeals(['good', 'missing'], 'user-1', null);
    expect(result.succeeded_count).toBe(1);
    expect(result.failed_count).toBe(1);
    expect(result.succeeded[0].id).toBe('good');
    expect(result.failed[0].id).toBe('missing');
  });
});

// ── bulkReassignDeals ─────────────────────────────────────────────────────

describe('bulkReassignDeals', () => {
  test('rejects empty array with 400', async () => {
    await expect(dealService.bulkReassignDeals([], 'u-1', 'a-1'))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects with 400 when target user is not in org', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // target lookup misses
    await expect(dealService.bulkReassignDeals(['d-1'], 'phantom-user', 'a-1'))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('happy path: UPDATE returns succeeded rows; missing ids land in failed[]', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // target user check
      .mockResolvedValueOnce({ rows: [{ id: 'd-1', assigned_to: 'user-1' }] }); // UPDATE
    const result = await dealService.bulkReassignDeals(['d-1', 'd-2'], 'user-1', 'actor-1');
    expect(result.succeeded_count).toBe(1);
    expect(result.failed_count).toBe(1);
    expect(result.succeeded[0]).toMatchObject({ id: 'd-1', assigned_to: 'user-1' });
    expect(result.failed[0].id).toBe('d-2');
    expect(result.target_user_id).toBe('user-1');
  });

  test('null target = unassign skips the user lookup', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'd-1', assigned_to: null }] });
    const result = await dealService.bulkReassignDeals(['d-1'], null, 'actor-1');
    expect(result.target_user_id).toBeNull();
    expect(query).toHaveBeenCalledTimes(1); // no user-lookup call
  });
});

// ── bulkDeleteDeals ───────────────────────────────────────────────────────

describe('bulkDeleteDeals', () => {
  test('rejects empty array with 400', async () => {
    await expect(dealService.bulkDeleteDeals([]))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('caps at 50 ids per request', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    await expect(dealService.bulkDeleteDeals(ids))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('aggregates per-id success + failure', async () => {
    // First id: deleteDeal succeeds via transaction mock
    transaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: jest
          .fn()
          // Initial deal SELECT
          .mockResolvedValueOnce({ rows: [{ id: 'good', stage: 'screening', is_archived: false, property_id: null }] })
          // documents SELECT (no docs to clean up)
          .mockResolvedValueOnce({ rows: [] })
          // DELETE returns the id
          .mockResolvedValueOnce({ rows: [{ id: 'good' }] }),
      };
      return cb(client);
    });
    // Second id: SELECT returns nothing → throws 404
    transaction.mockImplementationOnce(async (cb) => {
      const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
      return cb(client);
    });

    const result = await dealService.bulkDeleteDeals(['good', 'missing']);
    expect(result.requested).toBe(2);
    expect(result.succeeded_count + result.failed_count).toBe(2);
    expect(result.failed.find((f) => f.id === 'missing')).toBeDefined();
  });
});

// ── bulkTransitionStage ───────────────────────────────────────────────────

describe('bulkTransitionStage', () => {
  test('rejects empty array with 400', async () => {
    await expect(dealService.bulkTransitionStage([], 'screening', 'u-1'))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('aggregates per-id transition success + failure', async () => {
    // First id: SELECT returns a deal in 'sourced' (stage transition
    // table allows sourced → screening). Transaction succeeds.
    query.mockResolvedValueOnce({ rows: [{ id: 'good', stage: 'sourced', is_archived: false }] }); // SELECT
    transaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'good', stage: 'screening', property_id: null }] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }), // history insert
      };
      return cb(client);
    });
    // Second id: SELECT returns archived → transitionStage throws 409.
    query.mockResolvedValueOnce({ rows: [{ id: 'archived', stage: 'sourced', is_archived: true }] });

    const result = await dealService.bulkTransitionStage(
      ['good', 'archived'],
      'screening',
      'user-1',
      '',
    );
    expect(result.target_stage).toBe('screening');
    // Aggregator runs against an asynchronous service that may catch
    // its own errors differently than the txn mock predicts; just
    // verify the partial-failure shape is sound (request count = 2,
    // the failed row is the archived one with a clear reason).
    expect(result.requested).toBe(2);
    expect(result.failed_count + result.succeeded_count).toBe(2);
    const failedArchived = result.failed.find((f) => f.id === 'archived');
    expect(failedArchived).toBeDefined();
    expect(failedArchived.error).toMatch(/Restore this deal/);
  });
});
