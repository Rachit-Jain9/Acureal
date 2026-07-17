const jwt = require('jsonwebtoken');
const express = require('express');
const { body } = require('express-validator');
const authService = require('../services/auth.service');
const emailVerificationService = require('../services/emailVerification.service');
const refreshTokenService = require('../services/refreshToken.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const {
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  readRefreshCookie,
} = require('../lib/cookies');
const log = require('../lib/logger').child({ module: 'auth.routes' });

const router = express.Router();

// On every successful auth (login, register, google), issue a fresh
// refresh-token family and set BOTH httpOnly cookies (15-min access +
// 30-day refresh). The access JWT travels ONLY in the cookie — it is
// deliberately never returned in the response body, so no JavaScript
// (and therefore no XSS payload) can read it.
const issueSessionCookies = async (res, { user, token }, requestContext = {}) => {
  setAccessCookie(res, token);
  // rememberMe governs BOTH the grant's server-side TTL (30 d vs 24 h) and
  // the cookie's persistence (Max-Age vs browser-session). Defaults to true
  // when a client omits it — the historical behaviour, so existing sessions
  // and any non-browser client are unaffected.
  const rememberMe = requestContext.rememberMe !== false;
  const { rawToken: refreshToken } = await refreshTokenService.issueFamily({
    userId: user.id,
    ipAddress: requestContext.ipAddress || null,
    userAgent: requestContext.userAgent || null,
    rememberMe,
  });
  setRefreshCookie(res, refreshToken, { persistent: rememberMe });
};

// Response body for a successful auth. Carries the user profile (and, for
// Google, the login/bind/register mode) but never the raw access token —
// that lives only in the httpOnly cookie set by issueSessionCookies().
const sessionResponseData = (result) => {
  const data = { user: result.user };
  if (result.mode) data.mode = result.mode;
  return data;
};

// Fire-and-forget: dispatch the verification email in the background after
// register() commits. We never block the signup response on the mailer; if it
// fails, the user can request another link from the dashboard banner.
const dispatchVerificationEmailAsync = ({ userId, email, name, ipAddress, userAgent }) => {
  setImmediate(async () => {
    try {
      await emailVerificationService.sendVerificationEmail({
        userId,
        email,
        name,
        ipAddress,
        userAgent,
      });
    } catch (error) {
      log.warn('signup_verification_dispatch_failed', { userId, error: error.message });
    }
  });
};

// POST /auth/register
router.post(
  '/register',
  [
    body(['name', 'fullName']).optional().trim().isLength({ max: 255 }),
    body().custom((value) => {
      const resolvedName = value?.name || value?.fullName;
      if (!resolvedName || !String(resolvedName).trim()) {
        throw new Error('Name is required');
      }
      return true;
    }),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase and a number'),
    body('phone').optional().trim(),
    body('organizationName').optional().trim().isLength({ min: 2, max: 255 }),
    body('invitationToken').optional().trim().isLength({ min: 16, max: 255 }),
    body('acceptedTermsVersion')
      .isString()
      .trim()
      .isLength({ min: 1, max: 64 })
      .withMessage('You must accept the current Terms of Service to create an account.'),
    body('acceptedPrivacyVersion')
      .isString()
      .trim()
      .isLength({ min: 1, max: 64 })
      .withMessage('You must accept the current Privacy Policy to create an account.'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const {
        email,
        password,
        phone,
        organizationName,
        invitationToken,
        acceptedTermsVersion,
        acceptedPrivacyVersion,
      } = req.body;
      const name = req.body.name || req.body.fullName;
      const result = await authService.register(name, email, password, phone, {
        organizationName,
        invitationToken,
        acceptedTermsVersion,
        acceptedPrivacyVersion,
        requestContext: {
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });
      // Best-effort: kick off the verification email after the response is
      // queued. Failure here is logged but does not break signup — the user
      // can re-request from the dashboard.
      if (result?.user?.id && result?.user?.email) {
        dispatchVerificationEmailAsync({
          userId: result.user.id,
          email: result.user.email,
          name: result.user.name,
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        });
      }

      await issueSessionCookies(res, result, {
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        // Only an explicit boolean false selects the session-only tier;
        // anything else (absent, junk) keeps the historical persistent tier.
        rememberMe: req.body?.rememberMe === false ? false : true,
      });

      res.status(201).json({
        success: true,
        message: 'Account created successfully.',
        data: sessionResponseData(result),
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/verify-email/request — authenticated; user asks for a fresh link
router.post('/verify-email/request', authenticate, async (req, res, next) => {
  try {
    const status = await emailVerificationService.getVerificationStatus(req.user.id);
    if (status.verified) {
      return res.json({
        success: true,
        message: 'Email is already verified.',
        data: { verified: true, email: status.email },
      });
    }

    const dispatch = await emailVerificationService.sendVerificationEmail({
      userId: req.user.id,
      email: status.email,
      name: req.user.name,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    res.json({
      success: true,
      message: 'Verification email sent. Check your inbox for the link.',
      data: {
        verified: false,
        email: status.email,
        delivered: dispatch.delivered,
        provider: dispatch.provider,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/verify-email/confirm — public; consumes a one-shot token
router.post(
  '/verify-email/confirm',
  [body('token').isString().trim().isLength({ min: 16, max: 256 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const { token } = req.body;
      const result = await emailVerificationService.confirmToken(token);
      res.json({
        success: true,
        message: 'Email verified.',
        data: { userId: result.userId, email: result.email, verifiedAt: result.verifiedAt },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /auth/verify-email/status — authenticated; UI polls this to show the banner
router.get('/verify-email/status', authenticate, async (req, res, next) => {
  try {
    const status = await emailVerificationService.getVerificationStatus(req.user.id);
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

// POST /auth/google — federated sign-in / sign-up via Google ID token.
// Body: { idToken, acceptedTermsVersion?, acceptedPrivacyVersion?, invitationToken? }.
// Acceptance versions are required only on cold signup; existing users
// (matched by oauth identity or email) skip the check because their prior
// acceptance is already on file.
router.post(
  '/google',
  [
    body('idToken').isString().isLength({ min: 20, max: 4096 }).withMessage('Google ID token is required.'),
    body('acceptedTermsVersion').optional().isString().trim().isLength({ min: 1, max: 64 }),
    body('acceptedPrivacyVersion').optional().isString().trim().isLength({ min: 1, max: 64 }),
    body('invitationToken').optional().trim().isLength({ min: 16, max: 255 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { idToken, acceptedTermsVersion, acceptedPrivacyVersion, invitationToken } = req.body;
      const result = await authService.loginOrRegisterWithGoogle(idToken, {
        acceptedTermsVersion,
        acceptedPrivacyVersion,
        invitationToken,
        requestedOrganizationId: req.header('x-organization-id') || null,
        requestContext: {
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      const status = result.mode === 'register' ? 201 : 200;
      const message =
        result.mode === 'register'
          ? 'Account created with Google.'
          : result.mode === 'bound'
          ? 'Google sign-in linked to your existing account.'
          : 'Login successful.';

      await issueSessionCookies(res, result, {
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        // Only an explicit boolean false selects the session-only tier;
        // anything else (absent, junk) keeps the historical persistent tier.
        rememberMe: req.body?.rememberMe === false ? false : true,
      });

      res.status(status).json({ success: true, message, data: sessionResponseData(result) });
    } catch (error) {
      next(error);
    }
  }
);

// GET /auth/google/config — public; tells the frontend whether to render the
// Sign in with Google button and which client ID to use. Avoids embedding the
// client ID in the SPA bundle (it's not secret, but avoiding a redeploy when
// we rotate is cheaper than recompiling).
router.get('/google/config', (req, res) => {
  const googleOAuth = require('../lib/oauthGoogle');
  if (!googleOAuth.isConfigured()) {
    return res.json({ success: true, data: { enabled: false, clientId: null } });
  }
  res.json({
    success: true,
    data: { enabled: true, clientId: googleOAuth.getClientId() },
  });
});

// POST /auth/login
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password, req.header('x-organization-id'));

      // MFA branch — no cookies issued; user must complete /auth/mfa/verify.
      if (result?.mfaRequired) {
        return res.json({
          success: true,
          mfaRequired: true,
          message: 'Enter the 6-digit code from your authenticator app.',
          data: { challenge: result.challenge, expiresAt: result.expiresAt },
        });
      }

      await issueSessionCookies(res, result, {
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        // Only an explicit boolean false selects the session-only tier;
        // anything else (absent, junk) keeps the historical persistent tier.
        rememberMe: req.body?.rememberMe === false ? false : true,
      });

      return res.json({
        success: true,
        message: 'Login successful.',
        data: sessionResponseData(result),
      });
    } catch (error) {
      return next(error);
    }
  }
);

// POST /auth/mfa/verify — completes a login that landed on the MFA branch.
// Body: { challenge, code }. Mints the session cookies on success.
router.post(
  '/mfa/verify',
  [
    body('challenge').isString().isLength({ min: 32, max: 256 }),
    body('code').isString().isLength({ min: 6, max: 32 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await authService.completeMfaLogin({
        challenge: req.body.challenge,
        code: req.body.code,
        requestedOrganizationId: req.header('x-organization-id'),
      });
      await issueSessionCookies(res, result, {
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        // Only an explicit boolean false selects the session-only tier;
        // anything else (absent, junk) keeps the historical persistent tier.
        rememberMe: req.body?.rememberMe === false ? false : true,
      });
      return res.json({ success: true, message: 'MFA verified.', data: sessionResponseData(result) });
    } catch (error) {
      const status = error.statusCode || 401;
      if (status >= 500) return next(error);
      return res.status(status).json({ success: false, message: error.message });
    }
  },
);

// MFA enrollment + management — all under authenticated user.
router.post('/me/mfa/begin', authenticate, async (req, res, next) => {
  try {
    const mfaService = require('../services/mfa.service');
    const data = await mfaService.beginEnrollment(req.user.id, req.user.email);
    // Return secret + QR; recovery codes only shown once.
    return res.json({
      success: true,
      data: {
        otpauthUrl: data.otpauthUrl,
        qrDataUrl: data.qrDataUrl,
        recoveryCodes: data.recoveryCodes,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
});

router.post(
  '/me/mfa/verify-enrollment',
  authenticate,
  [body('code').isString().isLength({ min: 6, max: 8 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const mfaService = require('../services/mfa.service');
      const data = await mfaService.verifyEnrollment(req.user.id, req.body.code);
      return res.json({ success: true, message: 'Two-factor authentication enabled.', data });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return next(error);
    }
  },
);

router.post('/me/mfa/disable', authenticate, async (req, res, next) => {
  try {
    const mfaService = require('../services/mfa.service');
    const data = await mfaService.disable(req.user.id);
    return res.json({ success: true, message: 'Two-factor authentication disabled.', data });
  } catch (error) {
    return next(error);
  }
});

// POST /auth/refresh — rotate the refresh token (cookie-only).
//
// The SPA never sees the refresh token; it sits in a path-scoped httpOnly
// cookie that is only sent to /api/auth/refresh. The client just calls
// this endpoint when an access-cookie request comes back 401.
//
// Reuse detection: if a previously-rotated token is presented, the entire
// family is revoked (handled in refreshTokenService.rotate). The 401
// returned here drops the SPA back to /login with a fresh sign-in.
router.post('/refresh', async (req, res, next) => {
  try {
    const presented = readRefreshCookie(req);
    if (!presented) {
      // Distinguishable from "expired" so the SPA can avoid logging the
      // user out on a transient navigation that happens before the cookie
      // is set (e.g., direct hit to a protected URL on a fresh browser).
      return res.status(401).json({
        success: false,
        message: 'No active session.',
        code: 'NO_REFRESH_TOKEN',
      });
    }

    const rotation = await refreshTokenService.rotate({
      rawToken: presented,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    // Mint a fresh access JWT for the user. We re-fetch role from the DB
    // to pick up any role change that happened mid-session (deactivation,
    // role bump). hydrateUserAuthContext throws on deactivated accounts.
    const { hydrateUserAuthContext } = require('../services/organization.service');
    const authContext = await hydrateUserAuthContext(rotation.userId, null);

    if (!authContext.user.is_active) {
      // Deactivated mid-session — revoke the family we just rotated into,
      // clear cookies, force re-auth.
      await refreshTokenService.revokeFamily(rotation.familyId, 'security');
      clearAuthCookies(res);
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact the administrator.',
      });
    }

    const accessToken = jwt.sign(
      { userId: authContext.user.id, role: authContext.user.role },
      authService.getJwtSecret(),
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    setAccessCookie(res, accessToken);
    // Re-issue with the persistence tier the user chose at SIGN-IN, carried on
    // the grant. Without this, the first silent refresh would upgrade a
    // session-only login to a 30-day persistent cookie — quietly breaking the
    // "signs you out when the browser closes" promise.
    setRefreshCookie(res, rotation.rawToken, { persistent: rotation.rememberMe !== false });

    res.json({
      success: true,
      data: { user: authContext.user },
    });
  } catch (error) {
    // On any rotation failure (unknown token / expired / family killed),
    // sweep the cookies so the SPA does not loop on a dead refresh.
    if (error?.statusCode === 401 || error?.statusCode === 403) {
      clearAuthCookies(res);
    }
    next(error);
  }
});

// POST /auth/logout — revoke the refresh-token family + clear cookies.
//
// Authentication is NOT required here: the canonical case for logout is a
// session that has already gone bad (access expired, refresh refused), and
// we still want to clear server-side state. We use the refresh cookie if
// present, regardless of access-token validity.
router.post('/logout', async (req, res, next) => {
  try {
    const presented = readRefreshCookie(req);
    if (presented) {
      const family = await refreshTokenService.findFamilyByToken(presented);
      if (family?.family_id) {
        await refreshTokenService.revokeFamily(family.family_id, 'logout');
      }
    }
    clearAuthCookies(res);
    res.json({ success: true, message: 'Logged out.' });
  } catch (error) {
    // Logout must never fail visibly — clearing cookies is the user-facing
    // contract. Log the server-side error and return success.
    log.warn('logout_revoke_failed', { error: error?.message });
    clearAuthCookies(res);
    res.json({ success: true, message: 'Logged out.' });
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.user.id, req.user.organization_id);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// PUT /auth/me
router.put(
  '/me',
  authenticate,
  [
    body(['name', 'fullName']).optional().trim().notEmpty().isLength({ max: 255 }),
    body('phone').optional().trim(),
    body('currentPassword').optional().isLength({ min: 8 }),
    body('newPassword')
      .optional()
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('New password must contain uppercase, lowercase and a number'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const payload = {
        ...req.body,
        name: req.body.name || req.body.fullName,
      };
      const updated = await authService.updateUser(req.user.id, payload, req.user.organization_id);
      res.json({ success: true, message: 'Profile updated.', data: updated });
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/me/set-first-password
//
// Lets a user who signed up via Google OAuth attach a password to their
// account so they can sign in via password too. Refused if a real password
// is already set (the standard change-password flow on PUT /me handles
// that case).
//
// The authenticated session itself is the proof of possession — there is no
// separate Google re-verification step inside the request body. Callers must
// hold a valid access cookie (or legacy Bearer header).
router.post(
  '/me/set-first-password',
  authenticate,
  [
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('New password must contain uppercase, lowercase and a number'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      await authService.setFirstPassword(req.user.id, req.body.newPassword);
      // Re-fetch the user so the response carries the new password_set flag.
      const updated = await authService.getUserById(req.user.id, req.user.organization_id);
      res.json({
        success: true,
        message: 'Password set. You can now sign in with email and password too.',
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/me/close-account
//
// User-initiated account closure (DPDP Act 2023 §8(7)). Sets
// account_closed_at, revokes all refresh tokens, and clears auth cookies.
// Login is blocked thereafter; PII is anonymized 90 days later by the
// retention sweep cron.
//
// Idempotent on re-call (closing an already-closed account is a no-op).
// Erased accounts cannot be re-closed; the service returns 404 in that case.
router.post('/me/close-account', authenticate, async (req, res, next) => {
  try {
    const accountClosure = require('../services/accountClosure.service');
    const { clearAuthCookies } = require('../lib/cookies');
    const result = await accountClosure.closeAccount(req.user.id);

    // Match logout(): clear the auth cookies so the SPA's next request goes
    // unauthenticated. The 15-minute access token expires anyway, but
    // dropping the cookies makes the browser state match the server state
    // immediately.
    clearAuthCookies(res);

    res.json({
      success: true,
      message: 'Your account has been closed. Personal data will be erased after the 90-day reconciliation window.',
      data: {
        closedAt: result.closedAt,
        erasureScheduledAfterDays: 90,
      },
    });
  } catch (error) {
    if (/already erased/i.test(error.message)) {
      return res.status(404).json({ success: false, message: error.message });
    }
    return next(error);
  }
});

module.exports = router;
