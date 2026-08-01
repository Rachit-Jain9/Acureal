'use strict';

/**
 * POST /auth/refresh — the context-stamp regression pins (2026-08-01).
 *
 * The defect class: refresh is a PUBLIC route, so the per-request context is
 * empty when it runs. hydrateUserAuthContext's users read sits behind the
 * self-scoped RLS policy (id = current_user_id()), so under the
 * non-BYPASSRLS production role an unstamped context returns ZERO rows and
 * the route 404s — after rotate() has already consumed the presented grant.
 * Result in production: every silent renewal 07-28→08-01 died, forcing the
 * manual sign-ins the operator kept reporting.
 *
 * A mocked query can never reproduce the RLS zero-row behavior (the exact
 * lesson of the 42P08 postmortem), so these tests pin the MECHANISM:
 *   1. the rotation-verified user id is in the request context BY THE TIME
 *      hydrate runs (captured inside the hydrate mock, not after the fact);
 *   2. a 404 out of hydration sweeps both auth cookies (the client must
 *      never re-present a grant that rotate() already revoked);
 *   3. a 403 (deactivated account) revokes the just-rotated family —
 *      hydrate throws before the route's own is_active branch can.
 */

jest.mock('../src/services/refreshToken.service', () => ({
  rotate: jest.fn(),
  revokeFamily: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/organization.service', () => ({
  hydrateUserAuthContext: jest.fn(),
}));
jest.mock('../src/services/auth.service', () => ({
  getJwtSecret: () => 'test-secret',
}));
jest.mock('../src/services/emailVerification.service', () => ({}));
jest.mock('../src/services/signupNotification.service', () => ({}));
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const refreshTokenService = require('../src/services/refreshToken.service');
const { hydrateUserAuthContext } = require('../src/services/organization.service');
const { runWithRequestContext, getRequestContext } = require('../src/lib/requestContext');
const { REFRESH_COOKIE_NAME } = require('../src/lib/cookies');

const router = require('../src/routes/auth.routes');

// The route handler, extracted from the express router stack. If the route
// is ever renamed or removed this fails loudly instead of testing nothing.
const refreshLayer = router.stack.find(
  (layer) => layer.route && layer.route.path === '/refresh' && layer.route.methods.post,
);
if (!refreshLayer) throw new Error('POST /refresh route not found on auth router');
const refreshHandler = refreshLayer.route.stack[refreshLayer.route.stack.length - 1].handle;

const buildReq = () => ({
  cookies: { [REFRESH_COOKIE_NAME]: 'r'.repeat(64) },
  ip: '10.0.0.1',
  headers: { 'user-agent': 'jest' },
});

const buildRes = () => {
  const res = {
    statusCode: 200,
    cookie: jest.fn(() => res),
    clearCookie: jest.fn(() => res),
    status: jest.fn((code) => { res.statusCode = code; return res; }),
    json: jest.fn(() => res),
  };
  return res;
};

// Runs the handler the way server.js does: inside a fresh (EMPTY) request
// context — the exact precondition of the production failure.
const invoke = (req, res) => new Promise((resolve) => {
  runWithRequestContext({}, () => {
    Promise.resolve(refreshHandler(req, res, resolve)).then(() => resolve(undefined));
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  refreshTokenService.rotate.mockResolvedValue({
    userId: 'user-rotated-1',
    familyId: 'family-1',
    rawToken: 'new-raw-token',
    rememberMe: true,
  });
});

describe('POST /auth/refresh — context stamp before hydration', () => {
  test('hydrate observes the rotation-verified userId in the request context', async () => {
    let userIdSeenByHydrate = null;
    hydrateUserAuthContext.mockImplementation(async () => {
      userIdSeenByHydrate = getRequestContext().userId;
      return { user: { id: 'user-rotated-1', is_active: true, role: 'analyst', organization_id: 'org-1' } };
    });

    const res = buildRes();
    await invoke(buildReq(), res);

    expect(userIdSeenByHydrate).toBe('user-rotated-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    // Both cookies re-issued on the success path.
    expect(res.cookie).toHaveBeenCalledTimes(2);
  });

  test('after successful hydration the full identity is stamped (org + role)', async () => {
    hydrateUserAuthContext.mockResolvedValue({
      user: { id: 'user-rotated-1', is_active: true, role: 'admin', organization_id: 'org-9' },
    });

    let finalContext = null;
    const res = buildRes();
    await new Promise((resolve) => {
      runWithRequestContext({}, () => {
        Promise.resolve(refreshHandler(buildReq(), res, resolve)).then(() => {
          finalContext = { ...getRequestContext() };
          resolve(undefined);
        });
      });
    });

    expect(finalContext).toMatchObject({
      userId: 'user-rotated-1',
      organizationId: 'org-9',
      role: 'admin',
    });
  });
});

describe('POST /auth/refresh — failure hygiene', () => {
  test('404 from hydration sweeps BOTH auth cookies (grant is already consumed)', async () => {
    hydrateUserAuthContext.mockRejectedValue(
      Object.assign(new Error('User not found.'), { statusCode: 404 }),
    );

    const res = buildRes();
    await invoke(buildReq(), res);

    const clearedNames = res.clearCookie.mock.calls.map((c) => c[0]).sort();
    expect(clearedNames).toHaveLength(2);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('403 (deactivated) revokes the just-rotated family before rethrowing', async () => {
    hydrateUserAuthContext.mockRejectedValue(
      Object.assign(new Error('Account deactivated.'), { statusCode: 403 }),
    );

    const res = buildRes();
    await invoke(buildReq(), res);

    expect(refreshTokenService.revokeFamily).toHaveBeenCalledWith('family-1', 'security');
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });

  test('401 from rotate (dead token) sweeps cookies and never hydrates', async () => {
    refreshTokenService.rotate.mockRejectedValue(
      Object.assign(new Error('Invalid or expired refresh token.'), { statusCode: 401 }),
    );

    const res = buildRes();
    await invoke(buildReq(), res);

    expect(hydrateUserAuthContext).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });
});
