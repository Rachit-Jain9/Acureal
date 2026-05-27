'use strict';

/**
 * Unit tests for the learning-loop consumer-side aggregator (P8-PR1).
 *
 * Covers:
 *   - getTeamFeedbackByRule — SQL execution, grouping, optional ruleIds filter,
 *     missing-table tolerance, default 90-day window
 *   - computeMultiplier — the policy ladder (legal carve-out, acted ≥ dismiss,
 *     6+ dismissals → 0.7, 3+ → 0.85, otherwise 1.0)
 *   - composeTeamFeedback — null vs payload behaviour
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const svc = require('../src/services/learningSignals.aggregator.service');

beforeEach(() => jest.clearAllMocks());

// ───── getTeamFeedbackByRule ────────────────────────────────────────────────

describe('getTeamFeedbackByRule', () => {
  test('returns empty Map when the table is missing (migration not applied)', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const out = await svc.getTeamFeedbackByRule();
    expect(out).toBeInstanceOf(Map);
    expect(out.size).toBe(0);
  });

  test('returns empty Map when query throws an unexpected error', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '42P99' }));
    const out = await svc.getTeamFeedbackByRule();
    expect(out).toBeInstanceOf(Map);
    expect(out.size).toBe(0);
  });

  test('groups verdict counts by rule_id from the detail JSON', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          rule_id: 'land_cost_share_high',
          dismiss_count: 5,
          snooze_count: 1,
          acted_count: 0,
          total_count: 6,
          last_verdict_at: '2026-05-26T00:00:00Z',
        },
        {
          rule_id: 'absorption_unrealistic',
          dismiss_count: 1,
          snooze_count: 0,
          acted_count: 3,
          total_count: 4,
          last_verdict_at: '2026-05-25T00:00:00Z',
        },
      ],
    });
    const out = await svc.getTeamFeedbackByRule();
    expect(out.size).toBe(2);
    expect(out.get('land_cost_share_high')).toEqual({
      dismiss_count: 5,
      snooze_count: 1,
      acted_count: 0,
      total_count: 6,
      last_verdict_at: '2026-05-26T00:00:00Z',
    });
    expect(out.get('absorption_unrealistic').acted_count).toBe(3);
  });

  test('coerces non-numeric count rows to 0 instead of NaN', async () => {
    query.mockResolvedValueOnce({
      rows: [{ rule_id: 'x', dismiss_count: null, snooze_count: undefined, acted_count: 'NaN', total_count: 0, last_verdict_at: null }],
    });
    const out = await svc.getTeamFeedbackByRule();
    expect(out.get('x')).toEqual({
      dismiss_count: 0, snooze_count: 0, acted_count: 0, total_count: 0, last_verdict_at: null,
    });
  });

  test('drops rows with empty rule_id (defensive)', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { rule_id: null, dismiss_count: 3, snooze_count: 0, acted_count: 0, total_count: 3, last_verdict_at: '2026-05-26T00:00:00Z' },
        { rule_id: 'real_rule', dismiss_count: 2, snooze_count: 0, acted_count: 0, total_count: 2, last_verdict_at: '2026-05-26T00:00:00Z' },
      ],
    });
    const out = await svc.getTeamFeedbackByRule();
    expect(out.size).toBe(1);
    expect(out.has('real_rule')).toBe(true);
  });

  test('passes a ruleIds filter into the SQL when provided', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.getTeamFeedbackByRule({ ruleIds: ['rule_a', 'rule_b'] });
    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([90, ['rule_a', 'rule_b']]);
  });

  test('does NOT add the ruleIds clause when the array is empty', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.getTeamFeedbackByRule({ ruleIds: [] });
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([90]);
    expect(sql).not.toMatch(/ruleIds/i);
    expect(sql).not.toMatch(/ANY\(\$2/);
  });

  test('clamps windowDays to a sane range', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.getTeamFeedbackByRule({ windowDays: 10000 });
    expect(query.mock.calls[0][1][0]).toBe(365);
    query.mockResolvedValueOnce({ rows: [] });
    await svc.getTeamFeedbackByRule({ windowDays: -5 });
    expect(query.mock.calls[1][1][0]).toBe(1);
  });
});

// ───── computeMultiplier — the policy ladder ────────────────────────────────

describe('computeMultiplier', () => {
  test('legal carve-out topics always return 1.0 regardless of dismissals', () => {
    const counts = { dismiss_count: 100, snooze_count: 0, acted_count: 0, total_count: 100 };
    for (const topic of svc.LEGAL_CARVE_OUT_TOPICS) {
      const { multiplier, reason } = svc.computeMultiplier(topic, counts);
      expect(multiplier).toBe(1.0);
      expect(reason).toBeNull();
    }
  });

  test('returns 1.0 when counts are null (no feedback yet)', () => {
    expect(svc.computeMultiplier('land_price', null).multiplier).toBe(1.0);
  });

  test('returns 1.0 when acted_count >= dismiss_count and acted > 0', () => {
    const { multiplier, reason } = svc.computeMultiplier('land_price', {
      dismiss_count: 3, snooze_count: 0, acted_count: 3, total_count: 6,
    });
    expect(multiplier).toBe(1.0);
    expect(reason).toBeNull();
  });

  test('applies the 0.7 floor when dismissals reach the strong threshold', () => {
    const { multiplier, reason } = svc.computeMultiplier('land_price', {
      dismiss_count: 7, snooze_count: 0, acted_count: 0, total_count: 7,
    });
    expect(multiplier).toBe(0.7);
    expect(reason).toMatch(/7×/);
    expect(reason).toMatch(/90 days/);
  });

  test('applies the mild 0.85 multiplier between the two thresholds', () => {
    const { multiplier, reason } = svc.computeMultiplier('land_price', {
      dismiss_count: 4, snooze_count: 1, acted_count: 0, total_count: 5,
    });
    expect(multiplier).toBe(0.85);
    expect(reason).toMatch(/4×/);
  });

  test('stays at 1.0 below the mild threshold', () => {
    const { multiplier, reason } = svc.computeMultiplier('land_price', {
      dismiss_count: 2, snooze_count: 5, acted_count: 0, total_count: 7,
    });
    expect(multiplier).toBe(1.0);
    expect(reason).toBeNull();
  });
});

// ───── composeTeamFeedback ─────────────────────────────────────────────────

describe('composeTeamFeedback', () => {
  test('returns null when counts are absent', () => {
    expect(svc.composeTeamFeedback('land_price', null)).toBeNull();
  });

  test('returns null when total_count is 0', () => {
    expect(svc.composeTeamFeedback('land_price', svc.emptyCounts())).toBeNull();
  });

  test('returns a payload when there is any verdict in the window', () => {
    const out = svc.composeTeamFeedback('land_price', {
      dismiss_count: 4, snooze_count: 0, acted_count: 0, total_count: 4, last_verdict_at: '2026-05-26T00:00:00Z',
    });
    expect(out).toMatchObject({
      multiplier: 0.85,
      dismiss_count: 4,
      total_count: 4,
    });
    expect(out.reason).toMatch(/4×/);
  });

  test('surfaces counts even when the multiplier is 1.0 (positive feedback)', () => {
    const out = svc.composeTeamFeedback('land_price', {
      dismiss_count: 0, snooze_count: 0, acted_count: 5, total_count: 5, last_verdict_at: '2026-05-26T00:00:00Z',
    });
    expect(out.multiplier).toBe(1.0);
    expect(out.reason).toBeNull();
    expect(out.acted_count).toBe(5);
  });

  test('legal carve-out topic still surfaces counts but with multiplier=1.0', () => {
    const out = svc.composeTeamFeedback('legal_title', {
      dismiss_count: 10, snooze_count: 0, acted_count: 0, total_count: 10, last_verdict_at: '2026-05-26T00:00:00Z',
    });
    expect(out.multiplier).toBe(1.0);
    expect(out.reason).toBeNull();
    expect(out.dismiss_count).toBe(10);
  });
});
