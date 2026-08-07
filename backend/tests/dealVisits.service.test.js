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

// ──────────────────────────────────────────────────────────────────────────
// The portfolio rollup — the dashboard half of the same question.
// ──────────────────────────────────────────────────────────────────────────

describe('getPortfolioChangesSinceVisit', () => {
  const row = (over = {}) => ({
    deal_id: 'deal-1', name: 'Hopefarm Junction', stage: 'screening',
    last_visited_at: '2026-08-01T10:00:00.000Z',
    documents_added: '2', extractions_completed: '0',
    risks_added: '1', risks_updated: '0',
    dd_updated: '3', approvals_updated: '0',
    financials_updated: '0', activities_added: '0',
    ...over,
  });

  test('anchors on last_visited_at, NOT the rotated previous_visited_at', async () => {
    // The per-deal banner must look one watermark back because opening the
    // deal stamps a visit. Nothing stamps a visit at portfolio level, so the
    // last recorded look is the honest baseline — measuring against
    // previous_visited_at here would replay news the user already read.
    query.mockResolvedValueOnce({ rows: [{ never_opened: 0, rows: [] }] });
    await dealVisits.getPortfolioChangesSinceVisit();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/v\.last_visited_at/);
    expect(sql).not.toMatch(/previous_visited_at/);
  });

  test('excludes archived and non-live deals, and scopes to the caller', async () => {
    query.mockResolvedValueOnce({ rows: [{ never_opened: 0, rows: [] }] });
    await dealVisits.getPortfolioChangesSinceVisit();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/d\.is_archived = FALSE/);
    expect(sql).toMatch(/d\.stage = ANY\(\$3::deal_stage\[\]\)/);
    expect(params[0]).toBe('user-1');
    expect(params[1]).toBe('org-1');
    expect(params[2]).toEqual(expect.arrayContaining(['screening', 'loi']));
    // closed/dead are not "live" — they must not appear in the strip.
    expect(params[2]).not.toContain('closed');
    expect(params[2]).not.toContain('dead');
  });

  test('totals the eight slices and coerces bigint strings to numbers', async () => {
    query.mockResolvedValueOnce({ rows: [{ never_opened: 4, rows: [row()] }] });
    const result = await dealVisits.getPortfolioChangesSinceVisit();
    expect(result.moved_count).toBe(1);
    expect(result.never_opened).toBe(4);
    const deal = result.deals[0];
    expect(deal.total).toBe(6); // 2 documents + 1 risk + 3 DD
    expect(deal.changes.documents_added).toBe(2);
    expect(deal.changes.risks_added).toBe(1);
    expect(typeof deal.changes.dd_updated).toBe('number');
  });

  test('ranks risk arrivals above raw volume, then oldest visit', async () => {
    query.mockResolvedValueOnce({ rows: [{ never_opened: 0, rows: [] }] });
    await dealVisits.getPortfolioChangesSinceVisit();
    expect(query.mock.calls[0][0])
      .toMatch(/ORDER BY risks_added DESC, total DESC, last_visited_at ASC/);
  });

  test('deals never opened are counted, never listed', async () => {
    // "Since you looked" is undefined when you never looked. A new user should
    // see "9 not yet opened", not nine rows of noise.
    query.mockResolvedValueOnce({ rows: [{ never_opened: 9, rows: [] }] });
    const result = await dealVisits.getPortfolioChangesSinceVisit();
    expect(result.deals).toEqual([]);
    expect(result.never_opened).toBe(9);
    expect(query.mock.calls[0][0]).toMatch(/NOT EXISTS/);
  });

  test('a failure degrades to NULL, never an empty strip', async () => {
    // An empty strip renders "nothing has moved" — a claim we cannot make if
    // the query never answered. null renders nothing at all.
    query.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '57014' }));
    await expect(dealVisits.getPortfolioChangesSinceVisit()).resolves.toBeNull();
  });

  test('an unmigrated visits table is feature-dark, not an error', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    await expect(dealVisits.getPortfolioChangesSinceVisit()).resolves.toBeNull();
  });

  test('no request context means no answer', async () => {
    getRequestContext.mockReturnValueOnce({});
    await expect(dealVisits.getPortfolioChangesSinceVisit()).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('both surfaces read ONE slice definition, so they cannot drift', async () => {
    // The per-deal banner and this rollup render the same chips. If the two
    // SQL builders ever diverge, a deal row on the dashboard and the banner on
    // that deal would disagree, and the user cannot tell which is lying.
    const keys = dealVisits.CHANGE_SLICES.map((s) => s.key);
    expect(keys).toHaveLength(8);

    query.mockResolvedValueOnce({ rows: [{ never_opened: 0, rows: [row()] }] });
    const portfolio = await dealVisits.getPortfolioChangesSinceVisit();
    query.mockResolvedValueOnce({ rows: [row()] });
    const perDeal = await dealVisits.getChangesSince('deal-1', '2026-08-01T10:00:00.000Z');

    expect(Object.keys(portfolio.deals[0].changes).sort()).toEqual(keys.slice().sort());
    expect(Object.keys(perDeal.changes).sort()).toEqual(keys.slice().sort());
    expect(portfolio.deals[0].total).toBe(perDeal.total);
  });
});
