jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

const { query } = require('../src/config/database');
const accountClosure = require('../src/services/accountClosure.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('accountClosure.closeAccount', () => {
  test('sets account_closed_at and revokes refresh tokens', async () => {
    query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'u-1', account_closed_at: '2026-05-04T00:00:00Z', email: 'rachit@example.com' }],
      })
      .mockResolvedValueOnce({ rowCount: 3 });

    const result = await accountClosure.closeAccount('u-1');

    expect(result.refreshGrantsRevoked).toBe(3);
    expect(query.mock.calls[0][0]).toMatch(/UPDATE users[\s\S]+account_closed_at = COALESCE/);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE refresh_token_grants/);
    expect(query.mock.calls[1][0]).toMatch(/revoked_reason = 'account_closure'/);
  });

  test('throws if user does not exist or already erased', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(accountClosure.closeAccount('u-missing')).rejects.toThrow(/not found or already erased/i);
  });

  test('throws if userId is missing', async () => {
    await expect(accountClosure.closeAccount()).rejects.toThrow(/userId required/);
  });

  test('survives refresh-token revoke failure (non-critical)', async () => {
    query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'u-2', account_closed_at: '2026-05-04T00:00:00Z' }],
      })
      .mockRejectedValueOnce(new Error('refresh table down'));

    const result = await accountClosure.closeAccount('u-2');
    expect(result.refreshGrantsRevoked).toBe(0);
    expect(result.closedAt).toBeTruthy();
  });

  test('idempotent: re-closing keeps the original timestamp via COALESCE', async () => {
    // The SQL uses COALESCE(account_closed_at, NOW()) — simulate by returning
    // the existing original timestamp. The service doesn't enforce idempotence
    // in JS; the DB does. Test that the service relays whatever the DB says.
    query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'u-3', account_closed_at: '2026-04-01T00:00:00Z' }],
      })
      .mockResolvedValueOnce({ rowCount: 0 });

    const result = await accountClosure.closeAccount('u-3');
    expect(new Date(result.closedAt).getTime()).toBe(new Date('2026-04-01T00:00:00Z').getTime());
  });
});

describe('accountClosure.eraseClosedAccounts', () => {
  test('anonymizes users past the grace window', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'u-1' }, { id: 'u-2' }] })
      .mockResolvedValueOnce({ rowCount: 0 }); // surviving-grant sweep

    const result = await accountClosure.eraseClosedAccounts();

    expect(result.rows_erased).toBe(2);
    expect(result.grace_days).toBeGreaterThan(0);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE users/);
    expect(sql).toMatch(/account_closed_at < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(sql).toMatch(/erased_at = NOW\(\)/);
    expect(sql).toMatch(/email = 'erased\+' \|\| id::text/);
    expect(sql).toMatch(/password_hash = NULL/);
  });

  test('never references email_normalized — a column that exists nowhere', async () => {
    // Regression for the production error "column email_normalized does not
    // exist", which threw on EVERY erasure run since this service shipped. No
    // migration creates that column and nothing reads it; the write was dead.
    // Erasure ran in ONE query now, not a doomed primary + a fallback retry.
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'u-9' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const result = await accountClosure.eraseClosedAccounts();

    expect(result.rows_erased).toBe(1);
    // Exactly ONE erasure statement — no wasted doomed attempt, no fallback
    // retry. (The second call is the surviving-grant sweep, not a re-run.)
    const erasureStatements = query.mock.calls.filter(([sql]) => /UPDATE users/.test(sql));
    expect(erasureStatements).toHaveLength(1);
    expect(query.mock.calls[0][0]).not.toMatch(/email_normalized/);
  });

  test('returns zero on transient DB error (fail-open)', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const result = await accountClosure.eraseClosedAccounts();
    expect(result.rows_erased).toBe(0);
    expect(result.error).toMatch(/connection refused/);
  });

  test('revokes any refresh grant that survived to erasure', async () => {
    // Closure revoked every grant 90 days earlier and nothing can mint a new
    // one for a closed account, so this should normally sweep zero rows. It
    // exists for the closure that never went through closeAccount() — an
    // operator UPDATE straight in SQL, or a restored backup. Erasure is the
    // terminal state; nothing may hold a live credential past it.
    query
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'u-1' }, { id: 'u-2' }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await accountClosure.eraseClosedAccounts();

    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/UPDATE refresh_token_grants/);
    expect(sql).toMatch(/revoked_reason = 'account_erasure'/);
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(params[0]).toEqual(['u-1', 'u-2']);
  });

  test('skips the grant sweep entirely when nothing was erased', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await accountClosure.eraseClosedAccounts();

    expect(result.rows_erased).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('a failed grant sweep does not fail the erasure', async () => {
    // Erasure is a statutory obligation on a 90-day clock; it must report
    // success once the PII is gone even if the follow-up sweep errors. The
    // cron retries the sweep on its next run.
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'u-1' }] })
      .mockRejectedValueOnce(new Error('refresh table down'));

    const result = await accountClosure.eraseClosedAccounts();

    expect(result.rows_erased).toBe(1);
    expect(result.error).toBeUndefined();
  });
});

describe('accountClosure.getClosureStatus', () => {
  test('returns the row when user exists', async () => {
    query.mockResolvedValueOnce({
      rows: [{ account_closed_at: '2026-05-04T00:00:00Z', erased_at: null }],
    });
    const status = await accountClosure.getClosureStatus('u-1');
    expect(status.account_closed_at).toBe('2026-05-04T00:00:00Z');
    expect(status.erased_at).toBeNull();
  });

  test('returns null on query failure', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    expect(await accountClosure.getClosureStatus('u-1')).toBeNull();
  });

  test('returns null on missing userId', async () => {
    expect(await accountClosure.getClosureStatus()).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
