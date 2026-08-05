'use strict';

/**
 * POST /auth/refresh — closure and erasure must terminate a LIVE session, not
 * merely block the next sign-in.
 *
 * Refresh is the entry point where "block it" is not enough. A closed account
 * may hold a refresh grant with up to 30 days of life on it, and the SPA
 * renews silently in the background. Refusing the exchange while leaving the
 * grant valid would let the holder keep retrying — and would leave a live
 * credential attached to an account that is 90 days from erasure.
 *
 * Two mechanisms have to hold together, which is why both are pinned here:
 *
 *   1. closeAccount() revokes every active grant at closure time (covered in
 *      accountClosure.service.test.js), so the window is normally empty.
 *   2. If a grant somehow survives — an operator closure applied straight in
 *      SQL, a restored backup, a grant minted in the same instant closure ran
 *      — presenting it must revoke the whole family, not just fail the call.
 *
 * The route already had (2) for deactivated accounts: hydrate throws 403 and
 * the catch revokes the family. Because the terminal-state gate lives inside
 * hydrate and throws the same 403, closed and erased accounts inherit it. That
 * inheritance is the thing under test — it is easy to break by "tidying" the
 * catch into an is_active-specific branch.
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
jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));

const refreshTokenService = require('../src/services/refreshToken.service');
const { hydrateUserAuthContext } = require('../src/services/organization.service');
const { runWithRequestContext } = require('../src/lib/requestContext');
const { REFRESH_COOKIE_NAME } = require('../src/lib/cookies');
const { CLOSED_MESSAGE } = require('../src/utils/accountState');

const router = require('../src/routes/auth.routes');

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
    json: jest.fn(() => res),
  };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  return res;
};

const invoke = (req, res) => new Promise((resolve) => {
  runWithRequestContext({}, () => {
    Promise.resolve(refreshHandler(req, res, resolve)).then(() => resolve(undefined));
  });
});

// Exactly what the real gate throws for a closed or erased account.
const terminalStateError = () =>
  Object.assign(new Error(CLOSED_MESSAGE), { statusCode: 403 });

beforeEach(() => {
  jest.clearAllMocks();
  refreshTokenService.rotate.mockResolvedValue({
    userId: 'user-closed-1',
    familyId: 'family-1',
    rawToken: 'new-raw-token',
    rememberMe: true,
  });
});

describe('POST /auth/refresh — closed / erased accounts', () => {
  test('revokes the rotated family when the gate refuses', async () => {
    hydrateUserAuthContext.mockRejectedValue(terminalStateError());

    const res = buildRes();
    await invoke(buildReq(), res);

    expect(refreshTokenService.revokeFamily).toHaveBeenCalledWith('family-1', 'security');
  });

  test('issues no access cookie and no new refresh cookie', async () => {
    // The failure that would matter most: rotate() has already minted a fresh
    // grant by this point. If the handler set the cookie before refusing, the
    // holder would walk away with a NEWER credential than they arrived with.
    hydrateUserAuthContext.mockRejectedValue(terminalStateError());

    const res = buildRes();
    await invoke(buildReq(), res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('does not fall through to the is_active branch and mint a token', async () => {
    // The gate throws before the route's own `if (!authContext.user.is_active)`
    // check can run — and a terminated account has is_active = true anyway, so
    // that branch would have passed it through. Assert no success payload.
    hydrateUserAuthContext.mockRejectedValue(terminalStateError());

    const res = buildRes();
    await invoke(buildReq(), res);

    const succeeded = res.json.mock.calls.some(([body]) => body && body.success === true);
    expect(succeeded).toBe(false);
  });

  test('an active account still refreshes normally', async () => {
    hydrateUserAuthContext.mockResolvedValue({
      user: { id: 'user-1', is_active: true, role: 'admin', organization_id: 'org-1' },
    });

    const res = buildRes();
    await invoke(buildReq(), res);

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(refreshTokenService.revokeFamily).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
