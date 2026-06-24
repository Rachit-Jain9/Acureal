'use strict';

/**
 * Tests for `requirePlatformAdmin` in backend/src/middleware/auth.js.
 *
 * This middleware is the server-side fence around REDIP's operator-only
 * endpoints: AI provider-routing config (GLOBAL, mutating), A/B eval (spends
 * shared platform AI budget), and the operator analytics surfaces. Before this
 * guard, those `/api/admin/*` routes were gated only by `requireRole('admin')`,
 * which every signup satisfies for their own workspace — so any customer could
 * reach platform-operator tooling. A regression here re-opens that hole, so the
 * contract is asserted directly rather than only via route integration.
 *
 * The allowlist source of truth is `PLATFORM_ADMIN_EMAILS` (shared with
 * `platformOrg`), falling back to the founding operator when unset — the same
 * value the frontend mirrors via `VITE_PLATFORM_ADMIN_EMAILS` / isPlatformAdmin.
 */

// `requirePlatformAdmin` never touches the database, but importing auth.js pulls
// in auth.service → organization.service → config/database transitively. Neutralize
// it (mirrors platformOrg.test.js) so the unit test stays DB-free and fast.
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { requirePlatformAdmin } = require('../src/middleware/auth');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const FOUNDING_OPERATOR = 'rachitj579@gmail.com';

beforeEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
});

describe('middleware/auth.requirePlatformAdmin', () => {
  test('401s when there is no authenticated user', () => {
    const res = buildRes();
    const next = jest.fn();
    requirePlatformAdmin({}, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows the founding operator when the env var is unset (fallback)', () => {
    const res = buildRes();
    const next = jest.fn();
    requirePlatformAdmin({ user: { email: FOUNDING_OPERATOR } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('matches case-insensitively and trims surrounding whitespace', () => {
    const res = buildRes();
    const next = jest.fn();
    requirePlatformAdmin({ user: { email: '  RachitJ579@Gmail.com  ' } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('403s an ordinary org admin who is not on the allowlist', () => {
    const res = buildRes();
    const next = jest.fn();
    requirePlatformAdmin({ user: { email: 'customer@acme.com', role: 'admin' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('403s a user with no email (fail-closed)', () => {
    const res = buildRes();
    const next = jest.fn();
    requirePlatformAdmin({ user: { role: 'admin' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('honors a custom PLATFORM_ADMIN_EMAILS allowlist and excludes the fallback', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'ops@redip.in, founder@redip.in';

    const res = buildRes();
    const next = jest.fn();
    requirePlatformAdmin({ user: { email: 'founder@redip.in' } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Once a custom list is configured, the built-in fallback no longer passes.
    const res2 = buildRes();
    const next2 = jest.fn();
    requirePlatformAdmin({ user: { email: FOUNDING_OPERATOR } }, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(403);
    expect(next2).not.toHaveBeenCalled();
  });
});
