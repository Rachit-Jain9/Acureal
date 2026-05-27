'use strict';

/**
 * Unit tests for learningSignals.adminReport.service (E7-PR1).
 *
 * Covers each public method's SQL shape + the policy alignment with the
 * consumer aggregator (computeMultiplier is the source of truth — these
 * tests assert the admin report's "active adjustments" view matches what
 * the recommendation engine ACTUALLY does).
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const svc = require('../src/services/learningSignals.adminReport.service');

beforeEach(() => jest.clearAllMocks());

// ───── getSummary ──────────────────────────────────────────────────────────

describe('getSummary', () => {
  test('returns zero-baseline when no verdicts exist in the window', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await svc.getSummary({ days: 30 });
    expect(out).toMatchObject({
      window_days: 30,
      total_verdicts: 0,
      dismissed: 0,
      acted: 0,
      attributed_rate_pct: 0,
      dismissed_rate_pct: 0,
      acted_rate_pct: 0,
    });
  });

  test('returns empty shape when query fails (table missing)', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const out = await svc.getSummary();
    expect(out.total_verdicts).toBe(0);
    expect(out.window_days).toBe(30);
  });

  test('computes percentage rates from raw counts', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        total_verdicts: 20, dismissed: 14, snoozed: 4, acted: 2,
        attributed: 10, distinct_rules: 5,
        first_verdict_at: '2026-05-01T00:00:00Z',
        last_verdict_at: '2026-05-27T00:00:00Z',
      }],
    });
    const out = await svc.getSummary({ days: 30 });
    expect(out.total_verdicts).toBe(20);
    expect(out.dismissed_rate_pct).toBe(70);  // 14/20
    expect(out.acted_rate_pct).toBe(10);      // 2/20
    expect(out.attributed_rate_pct).toBe(50); // 10/20
    expect(out.distinct_rules).toBe(5);
  });

  test('clamps days to [1, 365]', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.getSummary({ days: 10000 });
    expect(query.mock.calls[0][1][0]).toBe(365);
    query.mockResolvedValueOnce({ rows: [] });
    await svc.getSummary({ days: -5 });
    expect(query.mock.calls[1][1][0]).toBe(1);
  });
});

// ───── getTopRules ────────────────────────────────────────────────────────

describe('getTopRules', () => {
  test('returns empty array when nothing matches', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await svc.getTopRules({ kind: 'dismissed' });
    expect(out).toEqual([]);
  });

  test('returns shaped rows with all three counters per rule', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          rule_id: 'land-cost-share-high', topic: 'land_price', last_verb: 'Recommend', max_severity: 4,
          dismiss_count: 8, snooze_count: 1, acted_count: 0, total_count: 9,
          last_verdict_at: '2026-05-27T00:00:00Z',
        },
        {
          rule_id: 'absorption-unrealistic', topic: 'absorption', last_verb: 'Re-examine', max_severity: 3,
          dismiss_count: 4, snooze_count: 0, acted_count: 1, total_count: 5,
          last_verdict_at: '2026-05-26T00:00:00Z',
        },
      ],
    });
    const out = await svc.getTopRules({ kind: 'dismissed', days: 30, limit: 5 });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      rule_id: 'land-cost-share-high', dismiss_count: 8, acted_count: 0, is_legal_carve_out: false,
    });
    expect(out[1].dismiss_count).toBe(4);
  });

  test('flags legal-carve-out topics', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        rule_id: 'rera-registration-missing', topic: 'legal_rera', last_verb: 'Flag', max_severity: 5,
        dismiss_count: 3, snooze_count: 0, acted_count: 0, total_count: 3,
        last_verdict_at: '2026-05-26T00:00:00Z',
      }],
    });
    const out = await svc.getTopRules();
    expect(out[0].is_legal_carve_out).toBe(true);
  });

  test('clamps the limit and falls back to dismissed for an unknown kind', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.getTopRules({ kind: 'nonsense', limit: 9999 });
    const [, params] = query.mock.calls[0];
    expect(params[1]).toBe('dismissed');
    expect(params[2]).toBe(50); // clamped from 9999
  });
});

// ───── getActiveAdjustments — the actually-de-ranked rules ────────────────

describe('getActiveAdjustments', () => {
  test('returns empty list when no rules cross the threshold', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        rule_id: 'x', topic: 'land_price', last_verb: 'Recommend',
        dismiss_count: 1, snooze_count: 0, acted_count: 0,
        last_verdict_at: '2026-05-26T00:00:00Z',
      }],
    });
    const out = await svc.getActiveAdjustments();
    expect(out.adjusted_rule_count).toBe(0);
    expect(out.adjustments).toEqual([]);
    expect(out.window_days).toBe(90);
  });

  test('lists exactly the rules where multiplier < 1.0 (mirrors consumer policy)', async () => {
    query.mockResolvedValueOnce({
      rows: [
        // ≥6 dismissals → 0.7 floor
        { rule_id: 'r1', topic: 'land_price', last_verb: 'Recommend',
          dismiss_count: 8, snooze_count: 0, acted_count: 0, last_verdict_at: '2026-05-26T00:00:00Z' },
        // ≥3 dismissals → 0.85
        { rule_id: 'r2', topic: 'pricing', last_verb: 'Re-examine',
          dismiss_count: 4, snooze_count: 0, acted_count: 0, last_verdict_at: '2026-05-26T00:00:00Z' },
        // 2 dismissals < threshold → 1.0 (filtered out)
        { rule_id: 'r3', topic: 'absorption', last_verb: 'Re-examine',
          dismiss_count: 2, snooze_count: 0, acted_count: 0, last_verdict_at: '2026-05-26T00:00:00Z' },
        // Legal carve-out — even with 99 dismissals stays at 1.0 (filtered out)
        { rule_id: 'r4', topic: 'legal_title', last_verb: 'Flag',
          dismiss_count: 99, snooze_count: 0, acted_count: 0, last_verdict_at: '2026-05-26T00:00:00Z' },
        // acted >= dismissed → stays at 1.0 (filtered out)
        { rule_id: 'r5', topic: 'land_price', last_verb: 'Recommend',
          dismiss_count: 3, snooze_count: 0, acted_count: 5, last_verdict_at: '2026-05-26T00:00:00Z' },
      ],
    });
    const out = await svc.getActiveAdjustments();
    expect(out.adjusted_rule_count).toBe(2);
    expect(out.adjustments.map((a) => a.rule_id)).toEqual(['r1', 'r2']); // strongest first
    expect(out.adjustments[0].multiplier).toBe(0.7);
    expect(out.adjustments[1].multiplier).toBe(0.85);
  });

  test('orders adjustments by multiplier ascending (strongest first), tiebreak by dismiss_count desc', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { rule_id: 'a', topic: 'land_price', dismiss_count: 6, snooze_count: 0, acted_count: 0, last_verdict_at: 'x' },
        { rule_id: 'b', topic: 'pricing',    dismiss_count: 10, snooze_count: 0, acted_count: 0, last_verdict_at: 'x' },
      ],
    });
    const out = await svc.getActiveAdjustments();
    // Both 0.7 floor; b has more dismissals → comes first
    expect(out.adjustments[0].rule_id).toBe('b');
    expect(out.adjustments[1].rule_id).toBe('a');
  });

  test('handles missing-table by returning empty', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: '42P01' }));
    const out = await svc.getActiveAdjustments();
    expect(out.adjusted_rule_count).toBe(0);
  });
});

// ───── getDailySeries ─────────────────────────────────────────────────────

describe('getDailySeries', () => {
  test('returns one row per day with the three verdict-kind counters', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { bucket_date: '2026-05-26', dismissed: 3, snoozed: 1, acted: 0, total: 4 },
        { bucket_date: '2026-05-27', dismissed: 5, snoozed: 0, acted: 2, total: 7 },
      ],
    });
    const out = await svc.getDailySeries({ days: 7 });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ date: '2026-05-26', dismissed: 3, snoozed: 1, acted: 0, total: 4 });
    expect(out[1].total).toBe(7);
  });

  test('coerces Date objects from pg to ISO yyyy-MM-dd strings', async () => {
    const dt = new Date('2026-05-26T00:00:00Z');
    query.mockResolvedValueOnce({
      rows: [{ bucket_date: dt, dismissed: 1, snoozed: 0, acted: 0, total: 1 }],
    });
    const out = await svc.getDailySeries();
    expect(out[0].date).toBe('2026-05-26');
  });
});

// ───── getDashboard — one-shot composite ──────────────────────────────────

describe('getDashboard', () => {
  test('runs all 5 queries in parallel and returns one composite payload', async () => {
    // summary
    query.mockResolvedValueOnce({ rows: [{ total_verdicts: 10, dismissed: 6, snoozed: 1, acted: 3, attributed: 7, distinct_rules: 4 }] });
    // top dismissed
    query.mockResolvedValueOnce({ rows: [{ rule_id: 'r1', topic: 'land_price', dismiss_count: 6, snooze_count: 0, acted_count: 0, total_count: 6, last_verdict_at: 'x' }] });
    // top acted
    query.mockResolvedValueOnce({ rows: [{ rule_id: 'r2', topic: 'pricing', dismiss_count: 0, snooze_count: 0, acted_count: 3, total_count: 3, last_verdict_at: 'x' }] });
    // active adjustments
    query.mockResolvedValueOnce({ rows: [{ rule_id: 'r1', topic: 'land_price', dismiss_count: 6, snooze_count: 0, acted_count: 0, last_verdict_at: 'x' }] });
    // daily series
    query.mockResolvedValueOnce({ rows: [{ bucket_date: '2026-05-27', dismissed: 6, snoozed: 1, acted: 3, total: 10 }] });

    const out = await svc.getDashboard({ days: 30 });
    expect(out.window_days).toBe(30);
    expect(out.summary.total_verdicts).toBe(10);
    expect(out.top_dismissed[0].rule_id).toBe('r1');
    expect(out.top_acted[0].acted_count).toBe(3);
    expect(out.active_adjustments.adjustments[0].multiplier).toBe(0.7);
    expect(out.daily_series).toHaveLength(1);
    expect(out.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
