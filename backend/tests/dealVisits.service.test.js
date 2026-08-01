'use strict';

/**
 * Deal visit watermarks — "since you last looked" (2026-08-01).
 *
 * Pins the four properties the feature's honesty depends on:
 *   1. the upsert rotates previous_visited_at ONLY across the 30-minute
 *      session gap (tab-hopping must not eat your own news);
 *   2. novelty is measured against the PREVIOUS visit, never the current one;
 *   3. a missing table (migration not yet applied) reads as feature-dark
 *      (null), never as an error into the request path;
 *   4. change counts are plain deterministic numbers per slice.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/requestContext', () => ({
  getRequestContext: jest.fn(() => ({
    userId: 'user-1',
    organizationId: 'org-1',
  })),
}));

const { query } = require('../src/config/database');
const { getRequestContext } = require('../src/lib/requestContext');
const dealVisits = require('../src/services/dealVisits.service');

beforeEach(() => jest.clearAllMocks());

describe('recordVisit', () => {
  test('upserts with the session-gap CASE so rapid re-opens keep the watermark', async () => {
    query.mockResolvedValue({ rows: [{ previous_visited_at: '2026-07-29T10:00:00Z' }] });

    const out = await dealVisits.recordVisit('deal-1');

    expect(out).toEqual({ since: '2026-07-29T10:00:00Z', first_visit: false });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(user_id, deal_id\)/);
    // The rotation is conditional on the session gap — the property that
    // makes tab-hopping harmless. Losing this CASE silently degrades the
    // feature into "everything is always already seen".
    expect(sql).toMatch(/CASE[\s\S]*last_visited_at[\s\S]*make_interval/);
    expect(params).toEqual(['user-1', 'deal-1', 'org-1', dealVisits.SESSION_GAP_MINUTES]);
  });

  test('first visit returns a null watermark, flagged as such', async () => {
    query.mockResolvedValue({ rows: [{ previous_visited_at: null }] });
    const out = await dealVisits.recordVisit('deal-1');
    expect(out).toEqual({ since: null, first_visit: true });
  });

  test('missing table (migration pending) → null, not an error', async () => {
    query.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    await expect(dealVisits.recordVisit('deal-1')).resolves.toBeNull();
  });

  test('no tenant context → null without touching the database', async () => {
    getRequestContext.mockReturnValueOnce({});
    await expect(dealVisits.recordVisit('deal-1')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('any other database failure is absorbed — a watermark must never fail a deal open', async () => {
    query.mockRejectedValue(new Error('connection reset'));
    await expect(dealVisits.recordVisit('deal-1')).resolves.toBeNull();
  });
});

describe('getChangesSince', () => {
  test('aggregates per-slice counts and a total in one round-trip', async () => {
    query.mockResolvedValue({
      rows: [{
        documents_added: '2',
        extractions_completed: '1',
        risks_added: '1',
        risks_updated: '0',
        dd_updated: '3',
        approvals_updated: '0',
        financials_updated: '1',
        activities_added: '4',
      }],
    });

    const out = await dealVisits.getChangesSince('deal-1', '2026-07-29T10:00:00Z');

    expect(query).toHaveBeenCalledTimes(1);
    expect(out.total).toBe(12);
    expect(out.changes.documents_added).toBe(2);
    expect(out.changes.dd_updated).toBe(3);
    // The novelty boundary rides in as the parameter — measured against the
    // PREVIOUS visit the caller got from recordVisit.
    expect(query.mock.calls[0][1]).toEqual(['deal-1', '2026-07-29T10:00:00Z']);
  });

  test('risk queries split newly-added from updated (different severities of news)', async () => {
    query.mockResolvedValue({ rows: [{}] });
    await dealVisits.getChangesSince('deal-1', '2026-07-29T10:00:00Z');
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/rf\.created_at > \$2\) AS risks_added/);
    expect(sql).toMatch(/rf\.updated_at > \$2 AND rf\.created_at <= \$2\) AS risks_updated/);
  });

  test('no watermark → null without a query (first visits have no "since")', async () => {
    await expect(dealVisits.getChangesSince('deal-1', null)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('missing table → null, feature-dark', async () => {
    query.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    await expect(dealVisits.getChangesSince('deal-1', '2026-07-29T10:00:00Z')).resolves.toBeNull();
  });
});
