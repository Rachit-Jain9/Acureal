'use strict';

/**
 * Contract pin for the dashboard `stats` object.
 *
 * WHY THIS EXISTS — a real production defect. The KPI strip read
 * `stats.ic_ready_count` and `stats.deals_with_open_risks`; the API produced
 * NEITHER. The "Investor-Grade" tile therefore rendered 0 on every dashboard
 * in every organization, and the "N with open risk" delta never appeared —
 * silently, for months. Both suites stayed green because the FRONTEND test
 * fixtures fabricated the two missing keys, so nothing anywhere compared what
 * the API sends against what the UI reads.
 *
 * This test is that comparison. `CONSUMED_BY_DASHBOARD_UI` is the list of stat
 * keys the frontend actually destructures; if a key is renamed or dropped here
 * without the UI being updated in the same change, this fails and names it.
 * Keep the list in sync with frontend/src/components/dashboard/DashboardWidgets.jsx
 * and frontend/src/pages/DashboardPage.jsx.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const dashboardService = require('../src/services/dashboard.service');

// Every stats key the dashboard UI reads. Adding a tile that reads a new key
// means adding it here — and that is the point.
const CONSUMED_BY_DASHBOARD_UI = [
  'active_deals_count',
  'total_pipeline_value_cr',
  'avg_irr_pct',
  'at_ic_or_beyond_count',
  'deals_with_open_risks',
  'total_deals',
  'has_linked_parcel',
  'has_document',
  'has_model',
  'comps_queue_pending_review',
  'comps_queue_pending_extraction',
  'comps_queue_failed',
];

// One aggregate row shaped like the real query's output.
const statsRow = {
  total_deals: '12',
  active_deals_count: '7',
  deals_closed_this_month: '1',
  dead_deals: '2',
  archived_deals: '1',
  total_pipeline_value_cr: '812.5',
  avg_irr_pct: '22.4',
  has_linked_parcel: true,
  has_document: true,
  has_model: true,
  at_ic_or_beyond_count: '3',
  deals_with_open_risks: '4',
};

beforeEach(() => {
  jest.clearAllMocks();
  // getDashboardStats fans out several queries in one Promise.all; route by SQL
  // shape so ordering changes don't break the test.
  query.mockImplementation((sql) => {
    if (/as total_deals|FILTER \(WHERE d\.is_archived/i.test(sql)) {
      return Promise.resolve({ rows: [statsRow] });
    }
    if (/FROM comps_review_queue/i.test(sql)) {
      return Promise.resolve({ rows: [{ pending_review: '2', pending_extraction: '1', failed: '0' }] });
    }
    if (/COUNT\(\*\) as total\s+FROM properties/i.test(sql)) {
      return Promise.resolve({ rows: [{ total: '5' }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('dashboard stats — API/UI contract', () => {
  test('produces every stat key the dashboard UI consumes', async () => {
    const { stats } = await dashboardService.getDashboardStats();
    const missing = CONSUMED_BY_DASHBOARD_UI.filter((key) => !(key in stats));
    expect(missing).toEqual([]);
  });

  test('the two previously-absent KPI fields are real numbers, not undefined', async () => {
    const { stats } = await dashboardService.getDashboardStats();
    expect(stats.at_ic_or_beyond_count).toBe(3);
    expect(stats.deals_with_open_risks).toBe(4);
    expect(typeof stats.at_ic_or_beyond_count).toBe('number');
    expect(typeof stats.deals_with_open_risks).toBe('number');
  });

  test('the dead field names are gone — nothing should resurrect them', async () => {
    const { stats } = await dashboardService.getDashboardStats();
    expect(stats).not.toHaveProperty('ic_ready_count');
  });

  test('counts degrade to 0 rather than NaN when the aggregate returns nulls', async () => {
    query.mockImplementation((sql) => {
      if (/as total_deals|FILTER \(WHERE d\.is_archived/i.test(sql)) {
        return Promise.resolve({ rows: [{ ...statsRow, at_ic_or_beyond_count: null, deals_with_open_risks: null }] });
      }
      if (/COUNT\(\*\) as total\s+FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [{ total: '5' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { stats } = await dashboardService.getDashboardStats();
    expect(stats.at_ic_or_beyond_count).toBe(0);
    expect(stats.deals_with_open_risks).toBe(0);
  });

  test('the at-IC count is stage-scoped and excludes archived deals', async () => {
    await dashboardService.getDashboardStats();
    const aggregateSql = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => /at_ic_or_beyond_count/i.test(sql));
    expect(aggregateSql).toBeDefined();
    expect(aggregateSql).toMatch(/'ic_review',\s*'negotiation',\s*'active'/);
    expect(aggregateSql).toMatch(/at_ic_or_beyond_count/);
    // Open-risk count must look at open flags only.
    expect(aggregateSql).toMatch(/rf\.status = 'open'/);
  });
});
