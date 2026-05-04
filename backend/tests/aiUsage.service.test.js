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

describe('aiUsage.getUsageDashboard', () => {
  test('clamps days to [1, 365] and parallelizes child queries', async () => {
    query.mockResolvedValue({ rows: [{}] });
    const out = await aiUsage.getUsageDashboard({ days: 9999 });
    expect(out.summary.window_days).toBe(365);
    // 4 parallel queries: summary, daily, by_task_provider, by_doctype
    expect(query).toHaveBeenCalledTimes(4);
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
