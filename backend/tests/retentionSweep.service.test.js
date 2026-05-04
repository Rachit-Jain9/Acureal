jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

const { query } = require('../src/config/database');
const sweep = require('../src/services/retentionSweep.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('retentionSweep.purgeAiResponseCache', () => {
  test('deletes rows past expires_at and reports the row count', async () => {
    query.mockResolvedValueOnce({ rowCount: 7 });
    const result = await sweep.purgeAiResponseCache();
    expect(result).toEqual({ rows_purged: 7 });
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM public\.ai_response_cache/);
    expect(query.mock.calls[0][0]).toMatch(/expires_at < NOW\(\)/);
  });

  test('returns zero + error string when the query throws', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const result = await sweep.purgeAiResponseCache();
    expect(result.rows_purged).toBe(0);
    expect(result.error).toBe('boom');
  });
});

describe('retentionSweep.purgeRefreshTokenGrants', () => {
  test('uses configured forensic window past expiry', async () => {
    query.mockResolvedValueOnce({ rowCount: 3 });
    const result = await sweep.purgeRefreshTokenGrants();
    expect(result.rows_purged).toBe(3);
    expect(result.forensic_window_days).toBeGreaterThan(0);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/DELETE FROM public\.refresh_token_grants/);
    expect(sql).toMatch(/expires_at < NOW\(\) -/);
  });
});

describe('retentionSweep.purgeLoginAttempts', () => {
  test('keeps actively-locked rows regardless of age', async () => {
    query.mockResolvedValueOnce({ rowCount: 11 });
    const result = await sweep.purgeLoginAttempts();
    expect(result.rows_purged).toBe(11);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/DELETE FROM public\.login_attempts/);
    // The lock-aware predicate is the core of the contract — assert it's there.
    expect(sql).toMatch(/locked_until IS NULL OR locked_until < NOW\(\)/);
  });
});

describe('retentionSweep.purgeAiCallLogs', () => {
  test('deletes rows past the configured retention window', async () => {
    query.mockResolvedValueOnce({ rowCount: 42 });
    const result = await sweep.purgeAiCallLogs();
    expect(result.rows_purged).toBe(42);
    expect(result.retention_days).toBeGreaterThan(0);
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM public\.ai_call_logs/);
  });
});

describe('retentionSweep.runSweep', () => {
  test('aggregates per-table counts and total + duration', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 })   // ai_response_cache
      .mockResolvedValueOnce({ rowCount: 2 })   // refresh_token_grants
      .mockResolvedValueOnce({ rowCount: 3 })   // login_attempts
      .mockResolvedValueOnce({ rowCount: 4 });  // ai_call_logs

    const summary = await sweep.runSweep();
    expect(summary.ai_response_cache.rows_purged).toBe(1);
    expect(summary.refresh_token_grants.rows_purged).toBe(2);
    expect(summary.login_attempts.rows_purged).toBe(3);
    expect(summary.ai_call_logs.rows_purged).toBe(4);
    expect(summary.total_rows_purged).toBe(10);
    expect(typeof summary.duration_ms).toBe('number');
  });

  test('one failing query does not abort the rest', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 5 })    // ai_response_cache OK
      .mockRejectedValueOnce(new Error('grants down'))  // refresh_token_grants fails
      .mockResolvedValueOnce({ rowCount: 6 })    // login_attempts OK
      .mockResolvedValueOnce({ rowCount: 7 });   // ai_call_logs OK

    const summary = await sweep.runSweep();
    expect(summary.ai_response_cache.rows_purged).toBe(5);
    expect(summary.refresh_token_grants.error).toBe('grants down');
    expect(summary.login_attempts.rows_purged).toBe(6);
    expect(summary.ai_call_logs.rows_purged).toBe(7);
    expect(summary.total_rows_purged).toBe(18);
  });
});
