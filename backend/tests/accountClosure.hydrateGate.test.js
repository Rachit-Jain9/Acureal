'use strict';

/**
 * The universal session gate — hydrateUserAuthContext with the REAL
 * organization.service (no hydrate mock).
 *
 * Every authenticated entry point funnels through this one function: the
 * `authenticate` middleware (so every protected request, not only sign-in),
 * password login, MFA completion, all three Google branches, refresh-token
 * rotation, and register. Enforcing terminal state here is what makes closure
 * and erasure actually terminate access rather than merely block the front
 * door — including on entry points added later, which inherit it for free.
 *
 * This file exercises the gate directly and through two callers that have no
 * closure check of their own anywhere else: the per-request middleware and MFA
 * completion. MFA is the sharper of the two — a challenge issued moments BEFORE
 * closure is still redeemable afterwards, and completeMfaLogin never re-reads
 * closure state itself.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/services/organizationAuditLog.service', () => ({ recordAudit: jest.fn() }));
jest.mock('../src/services/mfa.service', () => ({
  isMfaRequired: jest.fn(),
  issueChallenge: jest.fn(),
  verifyChallenge: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(() => 'signed-token'), verify: jest.fn() }));

const jwt = require('jsonwebtoken');
const { query } = require('../src/config/database');
const mfaService = require('../src/services/mfa.service');
const { assertColumnsResolve } = require('./helpers/pgSchemaGuard');
const orgService = require('../src/services/organization.service');
const authService = require('../src/services/auth.service');
const { authenticate } = require('../src/middleware/auth');

const CLOSED_AT = '2026-05-01T00:00:00.000Z';
const ERASED_AT = '2026-07-30T00:00:00.000Z';
const TERMINATED = /this account has been closed/i;

// is_active stays TRUE on every terminated fixture — that is the defect in one
// line. Closure never flips it, so an is_active-only gate waves these through.
const userRow = (over = {}) => ({
  id: 'user-1',
  email: 'user@example.com',
  name: 'Real Estate Pro',
  phone: null,
  is_active: true,
  default_organization_id: 'org-1',
  password_set: true,
  oauth_provider: null,
  mfa_enrolled_at: null,
  is_platform_admin: false,
  account_closed_at: null,
  erased_at: null,
  ...over,
});

const closed = (over = {}) => userRow({ account_closed_at: CLOSED_AT, ...over });
const erased = (over = {}) => userRow({
  account_closed_at: CLOSED_AT,
  erased_at: ERASED_AT,
  email: 'erased+user-1@redip.local',
  name: 'Erased User',
  ...over,
});

const membershipRow = {
  organization_id: 'org-1',
  role: 'admin',
  is_active: true,
  joined_at: '2026-01-01T00:00:00.000Z',
  organization_name: 'Acme Capital',
  organization_slug: 'acme-capital',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// The gate.
// ───────────────────────────────────────────────────────────────────────────

describe('hydrateUserAuthContext — terminal-state gate', () => {
  test.each([
    ['closed', closed()],
    ['erased', erased()],
  ])('refuses a %s account with 403', async (_label, row) => {
    query.mockResolvedValueOnce({ rows: [row] });

    await expect(orgService.hydrateUserAuthContext('user-1'))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(TERMINATED) });
  });

  test('refuses before reading organization membership', async () => {
    // The gate must short-circuit: no membership lookup, no default-org
    // repair UPDATE, no auth payload assembled for a terminated account.
    query.mockResolvedValueOnce({ rows: [erased()] });

    await expect(orgService.hydrateUserAuthContext('user-1')).rejects.toThrow();

    expect(query).toHaveBeenCalledTimes(1);
  });

  test('a closed PLATFORM ADMIN is refused and never has the flag computed', async () => {
    // Named in the original report: a closed account "retains is_platform_admin
    // if it had it". Operator privilege must not survive closure for even one
    // request.
    query.mockResolvedValueOnce({ rows: [closed({ is_platform_admin: true })] });

    await expect(orgService.hydrateUserAuthContext('user-1'))
      .rejects.toMatchObject({ statusCode: 403 });

    expect(query).toHaveBeenCalledTimes(1);
  });

  test('closure outranks deactivation in the reported reason', async () => {
    query.mockResolvedValueOnce({ rows: [closed({ is_active: false })] });

    await expect(orgService.hydrateUserAuthContext('user-1'))
      .rejects.toMatchObject({ message: expect.stringMatching(TERMINATED) });
  });

  test('plain deactivation still reports deactivation (unchanged behaviour)', async () => {
    query.mockResolvedValueOnce({ rows: [userRow({ is_active: false })] });

    await expect(orgService.hydrateUserAuthContext('user-1'))
      .rejects.toMatchObject({ statusCode: 403, message: /deactivated/i });
  });

  test('an active account passes the gate and gets its auth context', async () => {
    query
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [membershipRow] });

    const context = await orgService.hydrateUserAuthContext('user-1');

    expect(context.user).toMatchObject({ id: 'user-1', organization_id: 'org-1', role: 'admin' });
  });
});

describe('hydrateUserAuthContext — the SQL must actually fetch the columns', () => {
  test('selects account_closed_at and erased_at', async () => {
    // A guard cannot enforce on a column the SELECT never asked for. The
    // original bug lived here as much as in the missing JS check.
    query.mockResolvedValueOnce({ rows: [userRow()] }).mockResolvedValueOnce({ rows: [membershipRow] });

    await orgService.hydrateUserAuthContext('user-1');

    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/account_closed_at/);
    expect(sql).toMatch(/erased_at/);
  });

  test('every column it names resolves against the real users table', async () => {
    // Mocked query answers cheerfully no matter what the SQL says; this is the
    // net that catches a 42703 that only production would otherwise find.
    // hydrate runs on EVERY authenticated request, so a bad column here is not
    // a broken endpoint — it is a total outage.
    query.mockResolvedValueOnce({ rows: [userRow()] }).mockResolvedValueOnce({ rows: [membershipRow] });

    await orgService.hydrateUserAuthContext('user-1');

    expect(() => assertColumnsResolve(query.mock.calls[0][0])).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Entry point 4 — the per-request middleware.
// ───────────────────────────────────────────────────────────────────────────

describe('entry point: authenticate middleware (every protected request)', () => {
  const buildRes = () => {
    const res = { statusCode: 200, json: jest.fn(() => res) };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    return res;
  };

  test.each([
    ['closed', closed()],
    ['erased', erased()],
  ])('rejects a live access token belonging to a %s account', async (_label, row) => {
    // The access JWT is short-lived but valid: closure does not and cannot
    // invalidate an already-minted token. Enforcement has to happen on the
    // request, which is exactly why the gate lives in hydrate.
    jwt.verify.mockReturnValueOnce({ userId: 'user-1', role: 'admin' });
    query.mockResolvedValueOnce({ rows: [row] });

    const req = { headers: { authorization: 'Bearer live-token' }, header: () => undefined, cookies: {} };
    const res = buildRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(TERMINATED) }),
    );
  });

  test('lets an active account through', async () => {
    jwt.verify.mockReturnValueOnce({ userId: 'user-1', role: 'admin' });
    query
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [membershipRow] });

    const req = { headers: { authorization: 'Bearer live-token' }, header: () => undefined, cookies: {} };
    const res = buildRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: 'user-1' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Entry point 5 — MFA completion.
// ───────────────────────────────────────────────────────────────────────────

describe('entry point: MFA challenge completion', () => {
  test.each([
    ['closed', closed()],
    ['erased', erased()],
  ])('refuses to complete login for a %s account', async (_label, row) => {
    // The interesting race: a challenge issued seconds BEFORE closure is still
    // redeemable after it. completeMfaLogin performs no closure check of its
    // own — it relies entirely on the gate inside hydrate. If that gate ever
    // moves back out to the individual call sites, this is the path that
    // silently reopens.
    mfaService.verifyChallenge.mockResolvedValueOnce({ userId: 'user-1' });
    query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', default_organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [] })   // last_login_at stamp
      .mockResolvedValueOnce({ rows: [row] }); // hydrate's users read

    await expect(authService.completeMfaLogin({ challenge: 'c'.repeat(32), code: '123456' }))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(TERMINATED) });
  });

  test('completes normally for an active account', async () => {
    mfaService.verifyChallenge.mockResolvedValueOnce({ userId: 'user-1' });
    query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', default_organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [userRow()] })
      .mockResolvedValueOnce({ rows: [membershipRow] });

    const result = await authService.completeMfaLogin({ challenge: 'c'.repeat(32), code: '123456' });

    expect(result.token).toBe('signed-token');
  });
});
