jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

const { query } = require('../src/config/database');
const aiUsage = require('../src/services/aiUsage.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aiUsage.getSummary', () => {
  test('returns zeroed summary when there are no rows', async () => {
    query.mockResolvedValueOnce({ rows: [{
      total_calls: 0, total_cost_usd: 0, total_tokens: 0,
      cache_hits: 0, successes: 0, errors: 0, cost_capped: 0,
      recovered_via_retry: 0, prompt_cache_used: 0,
      avg_latency_ms: null, p95_latency_ms: null,
    }] });
    const out = await aiUsage.getSummary({ days: 7 });
    expect(out.total_calls).toBe(0);
    expect(out.cache_hit_rate_pct).toBe(0);
    expect(out.window_days).toBe(7);
  });

  test('computes cache_hit_rate_pct rounded to one decimal', async () => {
    query.mockResolvedValueOnce({ rows: [{
      total_calls: 1000, total_cost_usd: 12.34, total_tokens: 5_000_000,
      cache_hits: 234, successes: 700, errors: 50, cost_capped: 0,
      recovered_via_retry: 12, prompt_cache_used: 400,
      avg_latency_ms: 850, p95_latency_ms: 1900,
    }] });
    const out = await aiUsage.getSummary({ days: 30 });
    expect(out.total_calls).toBe(1000);
    expect(out.cache_hit_rate_pct).toBe(23.4); // 234/1000 → 23.4%
    expect(out.total_cost_usd).toBe(12.34);
    expect(out.recovered_via_retry).toBe(12);
    expect(out.prompt_cache_used).toBe(400);
  });

  test('fail-open returns zeros when query throws', async () => {
    query.mockRejectedValueOnce(new Error('connection lost'));
    const out = await aiUsage.getSummary({ days: 30 });
    expect(out.total_calls).toBe(0);
    expect(out.total_cost_usd).toBe(0);
  });
});

describe('aiUsage.getDailySeries', () => {
  test('formats Date objects as ISO yyyy-mm-dd strings', async () => {
    query.mockResolvedValueOnce({ rows: [
      { day: new Date('2026-04-15T00:00:00Z'), calls: 10, cost_usd: 1.5, cache_hits: 4, failures: 0 },
      { day: new Date('2026-04-16T00:00:00Z'), calls: 14, cost_usd: 2.2, cache_hits: 6, failures: 1 },
    ] });
    const out = await aiUsage.getDailySeries({ days: 30 });
    expect(out).toHaveLength(2);
    expect(out[0].day).toBe('2026-04-15');
    expect(out[1].calls).toBe(14);
  });

  test('passes string dates through', async () => {
    query.mockResolvedValueOnce({ rows: [
      { day: '2026-05-01', calls: 5, cost_usd: 0.4, cache_hits: 1, failures: 0 },
    ] });
    const out = await aiUsage.getDailySeries({ days: 7 });
    expect(out[0].day).toBe('2026-05-01');
  });

  test('returns [] on query failure', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const out = await aiUsage.getDailySeries({ days: 30 });
    expect(out).toEqual([]);
  });
});

describe('aiUsage.getByTaskProvider', () => {
  test('coerces numeric strings to numbers', async () => {
    query.mockResolvedValueOnce({ rows: [{
      task: 'document_extraction',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      calls: '42',
      cost_usd: '0.50',
      total_tokens: '125000',
      cache_hits: '8',
      avg_latency_ms: '900',
    }] });
    const out = await aiUsage.getByTaskProvider({ days: 30 });
    expect(out[0].calls).toBe(42);
    expect(out[0].cost_usd).toBe(0.5);
    expect(out[0].total_tokens).toBe(125000);
    expect(out[0].cache_hits).toBe(8);
  });
});

describe('aiUsage.getTopCostCalls', () => {
  test('returns rows ordered by cost desc with safe defaults', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'call-1',
          task: 'reasoning',
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          status: 'success',
          cost_usd: '0.42',
          latency_ms: '4200',
          total_tokens: '15000',
          deal_id: 'deal-1',
          document_id: null,
          created_at: new Date('2026-05-09T10:00:00Z'),
        },
      ],
    });
    const rows = await aiUsage.getTopCostCalls({ days: 7, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'call-1',
      cost_usd: 0.42,
      total_tokens: 15000,
      created_at: '2026-05-09T10:00:00.000Z',
    });
  });

  test('caps the limit to 100 even when caller asks for more', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await aiUsage.getTopCostCalls({ limit: 500 });
    // Inspect the LIMIT param — second positional arg.
    const sqlArgs = query.mock.calls[0][1];
    expect(sqlArgs[1]).toBe(100);
  });

  test('fails open: query error returns []', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const rows = await aiUsage.getTopCostCalls({});
    expect(rows).toEqual([]);
  });
});

describe('aiUsage.getSummary p50', () => {
  test('exposes p50 alongside p95 latency', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        total_calls: 100, total_cost_usd: 5, total_tokens: 50000,
        cache_hits: 10, successes: 90, errors: 5, cost_capped: 0,
        recovered_via_retry: 2, prompt_cache_used: 8,
        avg_latency_ms: 800, p50_latency_ms: 600, p95_latency_ms: 2400,
      }],
    });
    const out = await aiUsage.getSummary({ days: 30 });
    expect(out.p50_latency_ms).toBe(600);
    expect(out.p95_latency_ms).toBe(2400);
  });
});

describe('aiUsage.getCostCapStatus', () => {
  // The cost cap check sits behind costGuard's getDailyCap (env) +
  // sumDailySpend (DB). We don't mock costGuard itself — the service
  // composes them through the public surface so the integration is
  // exercised end-to-end.
  const ORIGINAL_CAP = process.env.AI_DAILY_COST_CAP_USD;
  afterEach(() => {
    if (ORIGINAL_CAP === undefined) delete process.env.AI_DAILY_COST_CAP_USD;
    else process.env.AI_DAILY_COST_CAP_USD = ORIGINAL_CAP;
  });

  test('returns enabled=false when AI_DAILY_COST_CAP_USD is unset', async () => {
    delete process.env.AI_DAILY_COST_CAP_USD;
    query.mockResolvedValueOnce({ rows: [{ spent_usd: 0 }] });
    const out = await aiUsage.getCostCapStatus();
    expect(out.enabled).toBe(false);
    expect(out.cap_usd).toBeNull();
    expect(out.blocked).toBe(false);
  });

  test('reports utilization when cap is set and spend < cap', async () => {
    process.env.AI_DAILY_COST_CAP_USD = '50';
    query.mockResolvedValueOnce({ rows: [{ spent_usd: '12.5' }] });
    const out = await aiUsage.getCostCapStatus();
    expect(out.enabled).toBe(true);
    // No org id in test → platform 2× cap = $100
    expect(out.cap_usd).toBe(100);
    expect(out.spent_today_usd).toBe(12.5);
    expect(out.pct_of_cap).toBe(12.5);
    expect(out.blocked).toBe(false);
  });

  test('flags blocked=true when spend ≥ cap', async () => {
    process.env.AI_DAILY_COST_CAP_USD = '20';
    // Platform 2× cap = $40; spend = $42 → over.
    query.mockResolvedValueOnce({ rows: [{ spent_usd: '42' }] });
    const out = await aiUsage.getCostCapStatus();
    expect(out.blocked).toBe(true);
    expect(out.pct_of_cap).toBeGreaterThanOrEqual(100);
  });

  test('fails open: query error returns disabled snapshot', async () => {
    process.env.AI_DAILY_COST_CAP_USD = '50';
    query.mockRejectedValueOnce(new Error('boom'));
    const out = await aiUsage.getCostCapStatus();
    expect(out.enabled).toBe(false);
    expect(out.spent_today_usd).toBe(0);
    expect(out.blocked).toBe(false);
  });
});

describe('aiUsage.getUsageDashboard', () => {
  test('clamps days to [1, 365] and parallelizes child queries', async () => {
    delete process.env.AI_DAILY_COST_CAP_USD;
    query.mockResolvedValue({ rows: [{}] });
    const out = await aiUsage.getUsageDashboard({ days: 9999 });
    expect(out.summary.window_days).toBe(365);
    // 6 parallel queries: summary, daily, by_task_provider, by_doctype,
    // top_cost_calls, cost_cap (sumDailySpend).
    expect(query).toHaveBeenCalledTimes(6);
  });

  test('defaults to 30-day window when days is missing', async () => {
    query.mockResolvedValue({ rows: [{}] });
    const out = await aiUsage.getUsageDashboard({});
    expect(out.summary.window_days).toBe(30);
  });

  test('rejects negative / invalid days by clamping to 1', async () => {
    query.mockResolvedValue({ rows: [{}] });
    const out = await aiUsage.getUsageDashboard({ days: -5 });
    expect(out.summary.window_days).toBe(1);
  });

  test('returns generated_at ISO timestamp', async () => {
    query.mockResolvedValue({ rows: [{}] });
    const out = await aiUsage.getUsageDashboard({});
    expect(out.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
