'use strict';

/**
 * httpOnly cookie helpers for access + refresh tokens.
 *
 * Cookie design:
 *   - `redip.access`  — short-lived (15 min) access JWT.
 *                       Path=/, sent on every API call.
 *   - `redip.refresh` — long-lived (30 day) refresh token.
 *                       Path=/api/auth/refresh, sent ONLY when the SPA hits
 *                       the rotate endpoint. Scoping the path means the
 *                       token does not leak through every random API
 *                       request — mitigates accidental log capture.
 *
 * Attributes:
 *   - HttpOnly  always — locks JS out, defeats XSS-based theft.
 *   - Secure    in production — required for SameSite=None and good
 *               hygiene anyway. Skipped in dev because localhost is HTTP.
 *   - SameSite=Lax — blocks CSRF on cross-site POSTs while still allowing
 *               top-level navigation cookies (so /verify-email links work).
 *   - Path     scoped per cookie (see above).
 *
 * Why no `__Host-` prefix:
 *   - `__Host-` requires Path=/ AND no Domain. The refresh cookie is
 *     scoped to /api/auth/refresh, which the prefix forbids. Splitting
 *     prefix policy across two cookies adds complexity without security
 *     gain (Secure + HttpOnly + SameSite already cover the threats).
 */

const ACCESS_COOKIE_NAME = 'redip.access';
const REFRESH_COOKIE_NAME = 'redip.refresh';
const REFRESH_COOKIE_PATH = '/api/auth/refresh';

const ACCESS_TTL_SECONDS = 15 * 60;          // 15 minutes
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const isProd = () => process.env.NODE_ENV === 'production';

const baseAttrs = (maxAgeSec) => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: 'lax',
  maxAge: maxAgeSec * 1000, // express-cookie maxAge is in ms
});

const setAccessCookie = (res, token) => {
  res.cookie(ACCESS_COOKIE_NAME, token, {
    ...baseAttrs(ACCESS_TTL_SECONDS),
    path: '/',
  });
};

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseAttrs(REFRESH_TTL_SECONDS),
    path: REFRESH_COOKIE_PATH,
  });
};

const clearAuthCookies = (res) => {
  // express clearCookie requires the SAME path/secure/sameSite that was
  // used to set the cookie, otherwise the browser ignores the Set-Cookie.
  res.clearCookie(ACCESS_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
};

const readAccessCookie = (req) => req?.cookies?.[ACCESS_COOKIE_NAME] || null;
const readRefreshCookie = (req) => req?.cookies?.[REFRESH_COOKIE_NAME] || null;

module.exports = {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  readAccessCookie,
  readRefreshCookie,
};
