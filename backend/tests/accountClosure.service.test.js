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
    query.mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'u-1' }, { id: 'u-2' }] });

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
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'u-9' }] });

    const result = await accountClosure.eraseClosedAccounts();

    expect(result.rows_erased).toBe(1);
    expect(query).toHaveBeenCalledTimes(1); // no wasted doomed attempt
    expect(query.mock.calls[0][0]).not.toMatch(/email_normalized/);
  });

  test('returns zero on transient DB error (fail-open)', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const result = await accountClosure.eraseClosedAccounts();
    expect(result.rows_erased).toBe(0);
    expect(result.error).toMatch(/connection refused/);
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
