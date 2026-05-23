'use strict';

/**
 * Unit tests for attention.service.js — the dashboard "what should I
 * look at today?" rollup. Pins the contract: which tables drive which
 * list, how query failures degrade independently, and what the totals
 * shape returns.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const attention = require('../src/services/attention.service');

// Match queries by the table they hit. attention.service issues five
// distinct SELECTs in parallel; the test wires each by table-fingerprint.
const wire = ({
  overdueDd = [],
  expiringApprovals = [],
  newRisk = [],
  staleDeals = [],
  recentActivity = [],
} = {}) => {
  query.mockImplementation((sql) => {
    if (/FROM dd_items/.test(sql)) return Promise.resolve({ rows: overdueDd });
    if (/FROM approval_items/.test(sql)) return Promise.resolve({ rows: expiringApprovals });
    if (/FROM risk_flags/.test(sql)) return Promise.resolve({ rows: newRisk });
    if (/FROM deals/.test(sql) && /LEFT JOIN activities/.test(sql)) {
      return Promise.resolve({ rows: staleDeals });
    }
    if (/FROM activities/.test(sql)) return Promise.resolve({ rows: recentActivity });
    return Promise.resolve({ rows: [] });
  });
};

beforeEach(() => jest.clearAllMocks());

describe('getAttention', () => {
  test('an empty workspace returns five empty lists and any=false', async () => {
    wire({});
    const out = await attention.getAttention();
    expect(out.overdue_dd_items).toEqual([]);
    expect(out.expiring_approvals).toEqual([]);
    expect(out.new_risk_flags).toEqual([]);
    expect(out.stale_deals).toEqual([]);
    expect(out.recent_activity).toEqual([]);
    expect(out.totals.any).toBe(false);
    expect(out.totals.overdue_dd).toBe(0);
  });

  test('totals.any flips true as soon as any list has rows', async () => {
    wire({
      overdueDd: [{ id: 'dd-1', deal_id: 'd1', item_name: 'Title search', days_overdue: 3 }],
    });
    const out = await attention.getAttention();
    expect(out.totals.any).toBe(true);
    expect(out.totals.overdue_dd).toBe(1);
  });

  test('overdue DD list passes through with denormalised deal context', async () => {
    wire({
      overdueDd: [
        {
          id: 'dd-1', deal_id: 'd1', item_name: 'Title search', category: 'title_ownership',
          severity: 'critical', due_date: '2026-05-01', status: 'pending', days_overdue: 22,
          deal_name: 'Whitefield Land', deal_stage: 'due_diligence',
        },
      ],
    });
    const out = await attention.getAttention();
    expect(out.overdue_dd_items).toHaveLength(1);
    expect(out.overdue_dd_items[0]).toMatchObject({
      item_name: 'Title search',
      deal_name: 'Whitefield Land',
      days_overdue: 22,
    });
  });

  test('expiring approvals list returns rows when the window is in range', async () => {
    wire({
      expiringApprovals: [
        {
          id: 'ap-1', deal_id: 'd1', name: 'RERA approval', expiry_date: '2026-06-15',
          days_until_expiry: 23, status: 'approved', is_validated: true,
          deal_name: 'Whitefield', deal_stage: 'underwriting',
        },
      ],
    });
    const out = await attention.getAttention();
    expect(out.expiring_approvals).toHaveLength(1);
    expect(out.expiring_approvals[0].name).toBe('RERA approval');
    expect(out.expiring_approvals[0].days_until_expiry).toBe(23);
  });

  test('new risk flags pass through with deal context + severity', async () => {
    wire({
      newRisk: [
        {
          id: 'rf-1', deal_id: 'd1', title: 'Title chain gap 1995-1998',
          severity: 'critical', category: 'title', status: 'open', source: 'manual',
          created_at: '2026-05-22T10:00:00Z',
          deal_name: 'Whitefield', deal_stage: 'due_diligence',
        },
      ],
    });
    const out = await attention.getAttention();
    expect(out.new_risk_flags).toHaveLength(1);
    expect(out.new_risk_flags[0].severity).toBe('critical');
  });

  test('stale deals list includes days_stale + last_activity_at', async () => {
    wire({
      staleDeals: [
        {
          id: 'd1', name: 'Old Sourced Lead', stage: 'sourced',
          last_activity_at: '2026-05-01T00:00:00Z', days_stale: 22,
        },
      ],
    });
    const out = await attention.getAttention();
    expect(out.stale_deals).toHaveLength(1);
    expect(out.stale_deals[0].days_stale).toBe(22);
  });

  test('recent activity carries actor name and description verbatim', async () => {
    wire({
      recentActivity: [
        {
          id: 'a1', deal_id: 'd1', type: 'note',
          description: 'Linked a document to a DD item',
          created_at: '2026-05-23T11:30:00Z',
          deal_name: 'Whitefield', deal_stage: 'due_diligence',
          performed_by_name: 'Rachit Jain',
        },
      ],
    });
    const out = await attention.getAttention();
    expect(out.recent_activity).toHaveLength(1);
    expect(out.recent_activity[0]).toMatchObject({
      description: 'Linked a document to a DD item',
      performed_by_name: 'Rachit Jain',
    });
  });

  test('a single failing query does NOT blank the whole tile', async () => {
    // dd_items query rejects; the other four should still resolve.
    query.mockImplementation((sql) => {
      if (/FROM dd_items/.test(sql)) return Promise.reject(new Error('db down'));
      if (/FROM approval_items/.test(sql)) return Promise.resolve({ rows: [{ id: 'ap' }] });
      if (/FROM risk_flags/.test(sql)) return Promise.resolve({ rows: [{ id: 'rf' }] });
      return Promise.resolve({ rows: [] });
    });
    const out = await attention.getAttention();
    expect(out.overdue_dd_items).toEqual([]); // safe-rows fallback
    expect(out.expiring_approvals).toHaveLength(1);
    expect(out.new_risk_flags).toHaveLength(1);
    expect(out.totals.overdue_dd).toBe(0);
    expect(out.totals.any).toBe(true); // still true via the other lists
  });

  test('thresholds are exposed in the payload so the UI can label them', async () => {
    wire({});
    const out = await attention.getAttention();
    expect(out.thresholds.stale_deal_days).toBe(14);
    expect(out.thresholds.new_risk_window_days).toBe(7);
    expect(out.thresholds.expiring_window_days).toBe(30);
  });

  test('generated_at is an ISO timestamp', async () => {
    wire({});
    const out = await attention.getAttention();
    expect(typeof out.generated_at).toBe('string');
    expect(Number.isNaN(Date.parse(out.generated_at))).toBe(false);
  });
});

describe('individual helpers', () => {
  test('getOverdueDdItems uses the live-stages array + organization_id() scope', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await attention.getOverdueDdItems();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/FROM dd_items/);
    expect(sql).toMatch(/current_organization_id/);
    expect(sql).toMatch(/is_required = TRUE/);
    expect(sql).toMatch(/due_date < NOW/);
    expect(Array.isArray(params[0])).toBe(true); // LIVE_DEAL_STAGES
  });

  test('getExpiringApprovals limits to the 30-day window', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await attention.getExpiringApprovals();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/expiry_date > NOW/);
    expect(sql).toMatch(/expiry_date <= NOW/);
    expect(params).toContain(30);
  });

  test('getNewRiskFlags orders by severity-desc then created_at-desc', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await attention.getNewRiskFlags();
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/severity\s*\n?\s*WHEN\s*'critical'\s*THEN\s*4/);
    expect(sql).toMatch(/ORDER BY/);
  });

  test('getStaleDeals filters by inactivity > 14 days', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await attention.getStaleDeals();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN activities/);
    expect(sql).toMatch(/HAVING/);
    expect(params).toContain(14);
  });
});
