'use strict';

/**
 * Closure / erasure must terminate access on EVERY sign-in entry point.
 *
 * The defect (found 2026-08-08): accountClosure.service sets account_closed_at
 * — and erasure additionally sets erased_at and anonymises the email — but
 * neither sets is_active = false. Password login checked account_closed_at, so
 * it was safe. BOTH Google sign-in branches gated only on is_active. A closed,
 * even a fully ERASED, account could therefore still authenticate via "Sign in
 * with Google" and kept whatever is_platform_admin it held.
 *
 * The fix is a read-time guard (utils/accountState.js) enforced at
 * hydrateUserAuthContext — the one function every entry point funnels through.
 * THIS file pins the *early* checks that sit in auth.service ahead of it, with
 * organization.service mocked out, so a regression that removes them is caught
 * even though hydrate would also refuse. Two reasons those early checks are
 * load-bearing rather than decorative:
 *
 *   • Google Path B WRITES a fresh OAuth binding onto the matched row before
 *     hydrate ever runs. The check has to precede that UPDATE.
 *   • Password login otherwise runs bcrypt.compare against an erased row whose
 *     password_hash erasure set to NULL.
 *
 * The gate itself is pinned in accountClosure.hydrateGate.test.js; the
 * refresh-token path in accountClosure.refreshGate.test.js.
 */

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-unusable'),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed-token'),
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/services/organization.service', () => ({
  consumeInvitation: jest.fn(),
  createWorkspaceForUser: jest.fn(),
  hydrateUserAuthContext: jest.fn(),
  joinByVerifiedDomain: jest.fn(),
  assertInvitationUsable: jest.fn(),
  deriveWorkspaceName: jest.fn(),
  slugifyOrganizationName: jest.fn(),
}));

jest.mock('../src/services/legal.service', () => ({
  resolveSignupAcceptance: jest.fn().mockResolvedValue([1, 2]),
  recordAcceptance: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/oauthGoogle', () => ({
  isConfigured: jest.fn(() => true),
  getClientId: jest.fn(() => 'client-id.apps.googleusercontent.com'),
  verifyIdToken: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const { query, transaction } = require('../src/config/database');
const googleOAuth = require('../src/lib/oauthGoogle');
const { hydrateUserAuthContext } = require('../src/services/organization.service');
const { __forceForTests, __resetForTests } = require('../src/lib/authDefiners');
const accountState = require('../src/utils/accountState');
const authService = require('../src/services/auth.service');

const CLOSED_AT = '2026-05-01T00:00:00.000Z';
const ERASED_AT = '2026-07-30T00:00:00.000Z';

// The message a terminated account gets, whichever door it knocks on.
const TERMINATED = /this account has been closed/i;

const validClaims = {
  provider: 'google',
  subject: 'google-sub-12345',
  email: 'user@example.com',
  emailVerified: true,
  name: 'Real Estate Pro',
  picture: null,
  hostedDomain: null,
};

// A row as each lookup returns it. `is_active` stays TRUE throughout on
// purpose: that is the whole point of the defect — closure never flips it, so
// every one of these rows looks perfectly healthy to an is_active-only check.
const baseRow = {
  id: 'user-1',
  email: 'user@example.com',
  password_hash: 'stored-hash',
  name: 'Real Estate Pro',
  phone: null,
  is_active: true,
  default_organization_id: 'org-1',
  oauth_provider: 'google',
  oauth_subject: 'google-sub-12345',
  email_verified_at: '2026-04-01T00:00:00.000Z',
  account_closed_at: null,
  erased_at: null,
};

const closedRow = (over = {}) => ({ ...baseRow, account_closed_at: CLOSED_AT, ...over });
// Erasure anonymises email/name and NULLs password_hash — model that faithfully,
// because "bcrypt.compare against a NULL hash" is one of the behaviours at issue.
const erasedRow = (over = {}) => ({
  ...baseRow,
  account_closed_at: CLOSED_AT,
  erased_at: ERASED_AT,
  email: 'erased+user-1@redip.local',
  name: 'Erased User',
  password_hash: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
});

// ───────────────────────────────────────────────────────────────────────────
// The guard itself — pure, no DB.
// ───────────────────────────────────────────────────────────────────────────

describe('utils/accountState — terminal-state precedence', () => {
  const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

  test('classifies each state', () => {
    expect(accountState.describeAccountState(baseRow)).toBe('active');
    expect(accountState.describeAccountState(closedRow())).toBe('closed');
    expect(accountState.describeAccountState(erasedRow())).toBe('erased');
    expect(accountState.describeAccountState({ ...baseRow, is_active: false })).toBe('inactive');
    expect(accountState.describeAccountState(null)).toBe('missing');
  });

  test('erasure outranks closure, closure outranks deactivation', () => {
    // A closed account that an admin ALSO deactivated must report closure —
    // the truer and more actionable reason, and the one whose erasure clock
    // is still running. Mirrors dsar.service.js's status precedence so the
    // DSAR export and the login gate can never disagree.
    expect(accountState.describeAccountState({ ...closedRow(), is_active: false })).toBe('closed');
    expect(accountState.describeAccountState({ ...erasedRow(), is_active: false })).toBe('erased');
  });

  test('throws 403 for closed and erased, and does not throw for an active row', () => {
    expect(() => accountState.assertAccountUsable(closedRow(), createError))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(() => accountState.assertAccountUsable(erasedRow(), createError))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(() => accountState.assertAccountUsable(baseRow, createError)).not.toThrow();
  });

  test('erased and closed share one message — it must not confirm erasure', () => {
    // Saying "this account was erased" to whoever holds the credentials
    // confirms the account previously existed. Closed and erased are
    // deliberately indistinguishable from outside.
    const closedErr = (() => { try { accountState.assertAccountUsable(closedRow(), createError); } catch (e) { return e; } })();
    const erasedErr = (() => { try { accountState.assertAccountUsable(erasedRow(), createError); } catch (e) { return e; } })();
    expect(erasedErr.message).toBe(closedErr.message);
    expect(erasedErr.message).not.toMatch(/eras/i);
  });

  test('deactivation keeps its own distinct message', () => {
    const err = (() => {
      try { accountState.assertAccountUsable({ ...baseRow, is_active: false }, createError); } catch (e) { return e; }
    })();
    expect(err.message).toMatch(/deactivated/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Entry point 1 — password login.
// ───────────────────────────────────────────────────────────────────────────

describe('entry point: password login', () => {
  // login() runs the throttle SELECT first, then the user lookup.
  const primeLogin = (row) => {
    query
      .mockResolvedValueOnce({ rows: [] })      // login_attempts — not locked
      .mockResolvedValueOnce({ rows: [row] });  // user lookup
  };

  test.each([
    ['closed', closedRow()],
    ['erased', erasedRow()],
  ])('refuses a %s account with 403', async (_label, row) => {
    primeLogin(row);

    await expect(authService.login('user@example.com', 'Password123'))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(TERMINATED) });
  });

  test('refuses an erased account WITHOUT reaching bcrypt', async () => {
    // Erasure NULLs password_hash. Before the guard covered erased_at, an
    // erased row fell through to bcrypt.compare(password, null) rather than
    // being refused outright — relying on bcrypt to reject a NULL hash is not
    // an access-control decision anyone should be making.
    primeLogin(erasedRow());

    await expect(authService.login('erased+user-1@redip.local', 'Password123'))
      .rejects.toMatchObject({ statusCode: 403 });

    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('a closed account is refused even when its password is correct', async () => {
    primeLogin(closedRow());
    bcrypt.compare.mockResolvedValue(true);

    await expect(authService.login('user@example.com', 'Password123'))
      .rejects.toMatchObject({ statusCode: 403 });

    expect(hydrateUserAuthContext).not.toHaveBeenCalled();
  });

  test('still refuses on the SECURITY DEFINER route (production routing)', async () => {
    // Production runs the definer path post-M1-flip. auth_find_user_for_login
    // has returned account_closed_at/erased_at since 20260801, so the guard has
    // real data to act on here — pin that, because a definer signature that
    // silently drops a column would turn this check into a no-op.
    __forceForTests(true);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [closedRow()] });

    await expect(authService.login('user@example.com', 'Password123'))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(TERMINATED) });

    expect(query.mock.calls[1][0]).toContain('auth_find_user_for_login');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Entry point 2 — Google OAuth, Path A (returning user by provider+subject).
// ───────────────────────────────────────────────────────────────────────────

describe('entry point: Google sign-in, Path A (identity match)', () => {
  test.each([
    ['closed', closedRow()],
    ['erased', erasedRow()],
  ])('refuses a %s account with 403', async (_label, row) => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query.mockResolvedValueOnce({ rows: [row] });

    await expect(authService.loginOrRegisterWithGoogle('id-token', {}))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(TERMINATED) });
  });

  test('mints no session and creates no workspace for a closed account', async () => {
    // The original defect in one assertion: this returned { user, token } and
    // the caller set auth cookies.
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query.mockResolvedValueOnce({ rows: [closedRow()] });

    await expect(authService.loginOrRegisterWithGoogle('id-token', {})).rejects.toThrow();

    expect(hydrateUserAuthContext).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    // Only the lookup ran — no last_login_at stamp on a terminated account.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('the identity lookup actually fetches the closure columns', async () => {
    // A guard cannot enforce on a column the SELECT never asked for. This is
    // the shape of the original bug at the SQL layer, not the JS layer.
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query.mockResolvedValueOnce({ rows: [] });
    hydrateUserAuthContext.mockResolvedValue({ user: { id: 'x', role: 'admin' } });
    query.mockResolvedValueOnce({ rows: [] }); // Path B lookup — also empty
    transaction.mockImplementation(async () => ({ user: {}, token: 't', mode: 'register' }));

    await authService.loginOrRegisterWithGoogle('id-token', {}).catch(() => {});

    expect(query.mock.calls[0][0]).toMatch(/account_closed_at/);
    expect(query.mock.calls[0][0]).toMatch(/erased_at/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Entry point 3 — Google OAuth, Path B (email match → binds an OAuth identity).
// ───────────────────────────────────────────────────────────────────────────

describe('entry point: Google sign-in, Path B (email match + bind)', () => {
  // Path B is reached when no (provider, subject) row exists but the email does.
  const primePathB = (row) => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({ rows: [] })     // Path A — no identity match
      .mockResolvedValueOnce({ rows: [row] }); // Path B — email match
  };

  test.each([
    ['closed', closedRow({ oauth_provider: null, oauth_subject: null })],
    ['erased', erasedRow({ oauth_provider: null, oauth_subject: null })],
  ])('refuses a %s account with 403', async (_label, row) => {
    primePathB(row);

    await expect(authService.loginOrRegisterWithGoogle('id-token', {}))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(TERMINATED) });
  });

  test('does NOT bind a Google identity onto a closed account', async () => {
    // The ordering assertion. This branch's job is to WRITE oauth_provider /
    // oauth_subject onto the matched row; hydrate's refusal comes too late to
    // prevent that. Only the two lookups may have run — no UPDATE.
    primePathB(closedRow({ oauth_provider: null, oauth_subject: null }));

    await expect(authService.loginOrRegisterWithGoogle('id-token', {})).rejects.toThrow();

    expect(query).toHaveBeenCalledTimes(2);
    const statements = query.mock.calls.map(([sql]) => sql).join('\n');
    expect(statements).not.toMatch(/UPDATE\s+users/i);
  });

  test('does NOT bind a Google identity onto an ERASED account', async () => {
    // Worst case: erasure anonymised the email to erased+<id>@redip.local, so
    // this can only fire if that address is presented — but binding a live
    // Google identity onto an erased row would resurrect it outright.
    primePathB(erasedRow({ oauth_provider: null, oauth_subject: null }));

    await expect(authService.loginOrRegisterWithGoogle('id-token', {})).rejects.toThrow();

    const statements = query.mock.calls.map(([sql]) => sql).join('\n');
    expect(statements).not.toMatch(/UPDATE\s+users/i);
    expect(hydrateUserAuthContext).not.toHaveBeenCalled();
  });

  test('terminal state is reported ahead of an OAuth binding conflict', () => {
    // An erased row keeps its old oauth_subject, so it would otherwise fall
    // into the "bound to a different Google identity — contact support" 409.
    // That both misdescribes the situation and invites support to rebind an
    // erased account. Closure must win.
    primePathB(erasedRow({ oauth_subject: 'some-other-subject' }));

    return expect(authService.loginOrRegisterWithGoogle('id-token', {}))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(TERMINATED) });
  });

  test('the email lookup actually fetches the closure columns', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    transaction.mockImplementation(async () => ({ user: {}, token: 't', mode: 'register' }));

    await authService.loginOrRegisterWithGoogle('id-token', {}).catch(() => {});

    expect(query.mock.calls[1][0]).toMatch(/account_closed_at/);
    expect(query.mock.calls[1][0]).toMatch(/erased_at/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Control — the guard must not break ordinary sign-in.
// ───────────────────────────────────────────────────────────────────────────

describe('control: healthy accounts still sign in', () => {
  test('password login succeeds for an active, unclosed account', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [baseRow] })
      .mockResolvedValueOnce({ rows: [] })      // clearLoginAttempts
      .mockResolvedValueOnce({ rows: [] });     // last_login_at
    bcrypt.compare.mockResolvedValue(true);
    hydrateUserAuthContext.mockResolvedValue({ user: { id: 'user-1', role: 'admin' } });

    const result = await authService.login('user@example.com', 'Password123');

    expect(result.token).toBe('signed-token');
  });

  test('Google Path A succeeds for an active, unclosed account', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({ rows: [baseRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    hydrateUserAuthContext.mockResolvedValue({ user: { id: 'user-1', role: 'admin' } });

    const result = await authService.loginOrRegisterWithGoogle('id-token', {});

    expect(result).toMatchObject({ mode: 'login', token: 'signed-token' });
  });
});
