'use strict';

/**
 * Unit tests for portfolioRiskRadar.service.js — the workspace-level rollup
 * of the per-deal Risk Radar. Pins the aggregation contract so a future
 * refactor can't silently change what the dashboard widget displays.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const portfolioRadar = require('../src/services/portfolioRiskRadar.service');

// Wire each of the five reads by inspecting the SQL. The recent-flags read
// is distinguished from the bulk flags read by its "INTERVAL '7 days'"
// clause.
const wire = ({ deals = [], flags = [], dd = [], approvals = [], recent = [] } = {}) => {
  query.mockImplementation((sql) => {
    if (/FROM deals\s+WHERE/.test(sql)) return Promise.resolve({ rows: deals });
    if (/FROM risk_flags[\s\S]*INTERVAL/.test(sql)) return Promise.resolve({ rows: recent });
    if (/FROM risk_flags/.test(sql)) return Promise.resolve({ rows: flags });
    if (/FROM dd_items/.test(sql)) return Promise.resolve({ rows: dd });
    if (/FROM approval_items/.test(sql)) return Promise.resolve({ rows: approvals });
    return Promise.resolve({ rows: [] });
  });
};

const deal = (overrides = {}) => ({
  id: 'd1',
  name: 'Deal One',
  stage: 'screening',
  is_archived: false,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('getPortfolioRiskRadar', () => {
  test('returns an empty payload when the workspace has no live deals', async () => {
    wire({});
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.empty).toBe(true);
    expect(radar.totals.deals).toBe(0);
    expect(radar.totals.flagged).toBe(0);
    expect(radar.open_severity.total).toBe(0);
    expect(radar.top_deals_at_risk).toEqual([]);
    expect(radar.recently_flagged).toEqual([]);
    // Empty payload still names every failure mode so the UI can render the
    // scaffolding without conditional logic.
    expect(radar.failure_modes).toHaveLength(5);
  });

  test('a portfolio with one deal and no signal is fully unverified', async () => {
    wire({ deals: [deal()] });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.empty).toBe(false);
    expect(radar.totals.deals).toBe(1);
    expect(radar.totals.unverified).toBe(1);
    expect(radar.totals.flagged).toBe(0);
    expect(radar.totals.cleared).toBe(0);
    // No flags → top-at-risk list stays empty.
    expect(radar.top_deals_at_risk).toEqual([]);
  });

  test('open critical flag counts a deal as flagged and surfaces it in top-at-risk', async () => {
    wire({
      deals: [deal({ id: 'd1', name: 'Whitefield Land' })],
      flags: [{ deal_id: 'd1', category: 'title', severity: 'critical', status: 'open' }],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.totals.flagged).toBe(1);
    expect(radar.open_severity.critical).toBe(1);
    expect(radar.open_severity.total).toBe(1);

    expect(radar.top_deals_at_risk).toHaveLength(1);
    const top = radar.top_deals_at_risk[0];
    expect(top.id).toBe('d1');
    expect(top.name).toBe('Whitefield Land');
    expect(top.open_critical).toBe(1);
    expect(top.posture).toBe('flagged');
    expect(top.worst_category).toBe('Title & Ownership');

    // Title & Ownership mode rolls up the flagged-deal count.
    const titleMode = radar.failure_modes.find((m) => m.key === 'title_ownership');
    expect(titleMode.flagged_deals).toBe(1);
    expect(titleMode.open_critical).toBe(1);
  });

  test('resolved flags do not inflate open-severity totals', async () => {
    wire({
      deals: [deal()],
      flags: [{ deal_id: 'd1', category: 'market', severity: 'high', status: 'resolved' }],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.open_severity.total).toBe(0);
    // A resolved flag still marks the mode as assessed → cleared in that
    // category, which (with no required DD anywhere else) leaves the deal
    // unverified overall.
    expect(radar.totals.cleared).toBe(0);
    expect(radar.totals.unverified).toBe(1);
    const market = radar.failure_modes.find((m) => m.key === 'market');
    expect(market.cleared_deals).toBe(1);
  });

  test('ranks top-at-risk by open_critical then score then open_high', async () => {
    wire({
      deals: [
        deal({ id: 'd1', name: 'One critical' }),
        deal({ id: 'd2', name: 'Two highs' }),
        deal({ id: 'd3', name: 'One high' }),
      ],
      flags: [
        { deal_id: 'd1', category: 'title', severity: 'critical', status: 'open' },
        { deal_id: 'd2', category: 'financial', severity: 'high', status: 'open' },
        { deal_id: 'd2', category: 'financial', severity: 'high', status: 'open' },
        { deal_id: 'd3', category: 'market', severity: 'high', status: 'open' },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    const order = radar.top_deals_at_risk.map((d) => d.id);
    // d1 wins on open_critical (1 > 0), d2 beats d3 on score (2 high = 30 vs 1 high = 15).
    expect(order).toEqual(['d1', 'd2', 'd3']);
  });

  test('cleared portfolio shows no deals in top-at-risk', async () => {
    wire({
      deals: [deal({ id: 'd1' })],
      // Every required DD across every category completed.
      dd: [
        { deal_id: 'd1', category: 'title_ownership', status: 'completed', is_required: true },
        { deal_id: 'd1', category: 'seller_validity', status: 'completed', is_required: true },
        { deal_id: 'd1', category: 'statutory', status: 'completed', is_required: true },
        { deal_id: 'd1', category: 'financial_commercial', status: 'completed', is_required: true },
        { deal_id: 'd1', category: 'physical_technical', status: 'completed', is_required: true },
      ],
      // Required approvals all validated.
      approvals: [
        { deal_id: 'd1', is_required: true, is_validated: true, expiry_date: '2030-01-01' },
      ],
      // One closed flag in Market so the failure mode is "assessed".
      flags: [{ deal_id: 'd1', category: 'market', severity: 'low', status: 'resolved' }],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    // The market category was the only one we marked assessed; the others are
    // assessed via completed DD. So every category is cleared → deal cleared.
    expect(radar.totals.cleared).toBe(1);
    expect(radar.totals.flagged).toBe(0);
    expect(radar.top_deals_at_risk).toEqual([]);
  });

  test('expired required approval flags Approvals mode and the deal', async () => {
    wire({
      deals: [deal({ id: 'd1' })],
      approvals: [
        { deal_id: 'd1', is_required: true, is_validated: true, expiry_date: '2020-01-01' },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.totals.flagged).toBe(1);
    const ap = radar.failure_modes.find((m) => m.key === 'approvals_regulatory');
    expect(ap.flagged_deals).toBe(1);
  });

  test('recently-flagged list passes through the most recent open flags', async () => {
    wire({
      deals: [deal()],
      recent: [
        {
          id: 'flag-1',
          deal_id: 'd1',
          deal_name: 'Deal One',
          severity: 'high',
          title: 'Pending RERA registration',
          category: 'regulatory',
          created_at: '2026-05-22T10:00:00Z',
        },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.recently_flagged).toHaveLength(1);
    expect(radar.recently_flagged[0]).toMatchObject({
      flag_id: 'flag-1',
      deal_name: 'Deal One',
      severity: 'high',
      title: 'Pending RERA registration',
    });
  });

  test('portfolio score averages capped per-deal scores', async () => {
    wire({
      deals: [
        deal({ id: 'd1' }),
        deal({ id: 'd2' }),
      ],
      // d1 gets 30 (one critical), d2 gets 15 (one high). Average = 22.5 → 23.
      flags: [
        { deal_id: 'd1', category: 'title', severity: 'critical', status: 'open' },
        { deal_id: 'd2', category: 'financial', severity: 'high', status: 'open' },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.open_severity.portfolio_score).toBe(23);
  });

  test('a single deal pegged at 100 does not pin the portfolio score', async () => {
    wire({
      deals: [
        deal({ id: 'd1' }),
        deal({ id: 'd2' }),
        deal({ id: 'd3' }),
        deal({ id: 'd4' }),
      ],
      // d1 has 5 criticals → raw 150, capped 100. d2/d3/d4 clean.
      flags: Array.from({ length: 5 }, () => ({
        deal_id: 'd1', category: 'title', severity: 'critical', status: 'open',
      })),
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    // Average of [100, 0, 0, 0] = 25.
    expect(radar.open_severity.portfolio_score).toBe(25);
  });

  // ── Overdue DD escalation in the portfolio rollup ───────────────────────

  test('an overdue required DD item flags the deal and rolls up to the mode', async () => {
    wire({
      deals: [deal({ id: 'd1', name: 'Whitefield Land' })],
      dd: [
        {
          deal_id: 'd1',
          category: 'title_ownership',
          status: 'pending',
          is_required: true,
          due_date: '2020-01-01',
        },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.totals.flagged).toBe(1);
    expect(radar.open_severity.overdue_dd).toBe(1);
    expect(radar.open_severity.critical).toBe(0);
    expect(radar.open_severity.high).toBe(0);

    const titleMode = radar.failure_modes.find((m) => m.key === 'title_ownership');
    expect(titleMode.flagged_deals).toBe(1);
    expect(titleMode.overdue_total).toBe(1);

    expect(radar.top_deals_at_risk).toHaveLength(1);
    const top = radar.top_deals_at_risk[0];
    expect(top.id).toBe('d1');
    expect(top.overdue).toBe(1);
    expect(top.posture).toBe('flagged');
    expect(top.worst_category).toBe('Title & Ownership');
    // OVERDUE_DD_WEIGHT (10) is the only score contribution here.
    expect(top.score).toBe(10);
  });

  test('a future-due required pending DD item does NOT count as overdue', async () => {
    wire({
      deals: [deal()],
      dd: [
        {
          deal_id: 'd1',
          category: 'title_ownership',
          status: 'pending',
          is_required: true,
          due_date: '2099-12-31',
        },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.open_severity.overdue_dd).toBe(0);
    expect(radar.totals.flagged).toBe(0);
    // Future-due required item still leaves the category unverified.
    expect(radar.totals.unverified).toBe(1);
  });

  test('overdue counts roll up across multiple deals and categories', async () => {
    wire({
      deals: [
        deal({ id: 'd1', name: 'Deal One' }),
        deal({ id: 'd2', name: 'Deal Two' }),
      ],
      dd: [
        {
          deal_id: 'd1',
          category: 'title_ownership',
          status: 'pending',
          is_required: true,
          due_date: '2020-01-01',
        },
        {
          deal_id: 'd1',
          category: 'financial_commercial',
          status: 'in_progress',
          is_required: true,
          due_date: '2020-06-30',
        },
        {
          deal_id: 'd2',
          category: 'statutory',
          status: 'pending',
          is_required: true,
          due_date: '2019-12-15',
        },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.open_severity.overdue_dd).toBe(3);
    expect(radar.totals.flagged).toBe(2);

    const titleMode = radar.failure_modes.find((m) => m.key === 'title_ownership');
    const financialMode = radar.failure_modes.find((m) => m.key === 'financial');
    const approvalsMode = radar.failure_modes.find((m) => m.key === 'approvals_regulatory');
    expect(titleMode.overdue_total).toBe(1);
    expect(financialMode.overdue_total).toBe(1);
    expect(approvalsMode.overdue_total).toBe(1);
  });

  test('overdue DD does not count when the item is completed or non-required', async () => {
    wire({
      deals: [deal()],
      dd: [
        // Overdue but completed — finished after the deadline, but done.
        {
          deal_id: 'd1',
          category: 'title_ownership',
          status: 'completed',
          is_required: true,
          due_date: '2020-01-01',
        },
        // Overdue but non-required — optional, doesn't escalate.
        {
          deal_id: 'd1',
          category: 'physical_technical',
          status: 'pending',
          is_required: false,
          due_date: '2020-01-01',
        },
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    expect(radar.open_severity.overdue_dd).toBe(0);
    expect(radar.totals.flagged).toBe(0);
  });

  test('overdue DD pushes a deal up the top-at-risk ranking via the score', async () => {
    wire({
      deals: [
        deal({ id: 'd1', name: 'Lots of overdue' }),
        deal({ id: 'd2', name: 'One high flag' }),
      ],
      flags: [{ deal_id: 'd2', category: 'financial', severity: 'high', status: 'open' }],
      dd: [
        // 3 overdue required items on d1 — score contribution 3 × 10 = 30.
        ...['title_ownership', 'statutory', 'physical_technical'].map((c) => ({
          deal_id: 'd1',
          category: c,
          status: 'pending',
          is_required: true,
          due_date: '2020-01-01',
        })),
      ],
    });
    const radar = await portfolioRadar.getPortfolioRiskRadar();
    // d1 score 30 (3 overdue × 10) beats d2 score 15 (one high flag).
    const order = radar.top_deals_at_risk.map((x) => x.id);
    expect(order[0]).toBe('d1');
    expect(radar.top_deals_at_risk[0].overdue).toBe(3);
    expect(radar.top_deals_at_risk[0].score).toBe(30);
  });
});
