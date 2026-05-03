const express = require('express');
const { body } = require('express-validator');
const authService = require('../services/auth.service');
const emailVerificationService = require('../services/emailVerification.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const log = require('../lib/logger').child({ module: 'auth.routes' });

const router = express.Router();

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

      res.status(201).json({
        success: true,
        message: 'Account created successfully.',
        data: result,
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

      res.status(status).json({ success: true, message, data: result });
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
      res.json({
        success: true,
        message: 'Login successful.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

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

module.exports = router;
