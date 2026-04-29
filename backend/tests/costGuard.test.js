'use strict';

/**
 * Tests for backend/src/lib/costGuard.js — per-org daily AI spend cap.
 *
 * The DB layer is mocked so these tests run with no Postgres dependency.
 * Tests assert: (a) no-op when cap unset, (b) under-cap returns spend
 * snapshot, (c) at/over-cap throws CostCapExceededError, (d) NULL-org
 * (platform curator) gets a 2× cap.
 */

const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({ query: (...args) => mockQuery(...args) }));

const { assertWithinDailyCap, sumDailySpend, getDailyCap, CostCapExceededError } = require('../src/lib/costGuard');

beforeEach(() => {
  mockQuery.mockReset();
  delete process.env.AI_DAILY_COST_CAP_USD;
});

describe('costGuard.getDailyCap', () => {
  test('returns null when env var unset', () => {
    expect(getDailyCap()).toBeNull();
  });

  test('returns parsed number when env var set', () => {
    process.env.AI_DAILY_COST_CAP_USD = '5.50';
    expect(getDailyCap()).toBe(5.5);
  });

  test('returns null on invalid value', () => {
    process.env.AI_DAILY_COST_CAP_USD = 'not-a-number';
    expect(getDailyCap()).toBeNull();
  });

  test('returns null on zero or negative', () => {
    process.env.AI_DAILY_COST_CAP_USD = '0';
    expect(getDailyCap()).toBeNull();
    process.env.AI_DAILY_COST_CAP_USD = '-1';
    expect(getDailyCap()).toBeNull();
  });
});

describe('costGuard.sumDailySpend', () => {
  test('parses cost_usd from query result', async () => {
    mockQuery.mockResolvedValue({ rows: [{ spent_usd: '0.42' }] });
    const spent = await sumDailySpend({ organizationId: 'org-1' });
    expect(spent).toBe(0.42);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['org-1']);
  });

  test('uses IS NULL clause when no organizationId', async () => {
    mockQuery.mockResolvedValue({ rows: [{ spent_usd: 0 }] });
    await sumDailySpend({ organizationId: null });
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/organization_id IS NULL/);
    expect(mockQuery.mock.calls[0][1]).toEqual([]);
  });

  test('returns 0 when no rows', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await sumDailySpend({ organizationId: 'org-1' })).toBe(0);
  });
});

describe('costGuard.assertWithinDailyCap', () => {
  test('no-ops when cap unset (dev/staging)', async () => {
    const result = await assertWithinDailyCap({ organizationId: 'org-1' });
    expect(result).toEqual({ capped: false, spentUsd: null, capUsd: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns snapshot when under cap', async () => {
    process.env.AI_DAILY_COST_CAP_USD = '10';
    mockQuery.mockResolvedValue({ rows: [{ spent_usd: '3.50' }] });
    const result = await assertWithinDailyCap({ organizationId: 'org-1' });
    expect(result).toEqual({ capped: true, spentUsd: 3.5, capUsd: 10 });
  });

  test('throws CostCapExceededError at exact cap', async () => {
    process.env.AI_DAILY_COST_CAP_USD = '5';
    mockQuery.mockResolvedValue({ rows: [{ spent_usd: '5.00' }] });
    await expect(
      assertWithinDailyCap({ organizationId: 'org-1' }),
    ).rejects.toThrow(CostCapExceededError);
  });

  test('throws CostCapExceededError when over cap', async () => {
    process.env.AI_DAILY_COST_CAP_USD = '5';
    mockQuery.mockResolvedValue({ rows: [{ spent_usd: '12.50' }] });
    await expect(
      assertWithinDailyCap({ organizationId: 'org-1' }),
    ).rejects.toMatchObject({
      name: 'CostCapExceededError',
      code: 'AI_COST_CAP_EXCEEDED',
      statusCode: 429,
      organizationId: 'org-1',
      spentUsd: 12.5,
      capUsd: 5,
    });
  });

  test('NULL-org gets a 2x cap (platform curator)', async () => {
    process.env.AI_DAILY_COST_CAP_USD = '5';
    // Spend $9.99 — would trip a 5 cap, but allowed under 10 (2x).
    mockQuery.mockResolvedValue({ rows: [{ spent_usd: '9.99' }] });
    const result = await assertWithinDailyCap({ organizationId: null });
    expect(result).toEqual({ capped: true, spentUsd: 9.99, capUsd: 10 });
  });
});
