const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  consumeInvitation,
  createWorkspaceForUser,
  hydrateUserAuthContext,
} = require('./organization.service');
const legalService = require('./legal.service');
const { mapOrganizationRoleToLegacyUserRole } = require('../constants/roles');
const { isPasswordBreached } = require('../utils/passwordBreach');
const googleOAuth = require('../lib/oauthGoogle');

const SALT_ROUNDS = 12;

// Per-account login throttle. The express-rate-limit middleware caps
// /api/auth at 20 req / 15 min / IP; this guards against distributed
// brute-force across rotating source IPs targeting one email.
//   • 5 failures in a 15-minute sliding window → lock for 15 minutes
//   • Successful login clears the row
//   • Unknown emails are tracked too — leaking lockout-by-existence would
//     defeat the existing "Invalid email or password" generic message.
const LOGIN_FAIL_THRESHOLD = 5;
const LOGIN_FAIL_WINDOW_MIN = 15;
const LOGIN_LOCK_MINUTES = 15;

const enforceLoginThrottle = async (email) => {
  const result = await query(
    `SELECT locked_until FROM login_attempts
     WHERE email = $1 AND locked_until IS NOT NULL AND locked_until > NOW()`,
    [email]
  );
  if (result.rows.length > 0) {
    throw createError(
      'Too many failed sign-in attempts. Please wait a few minutes and try again.',
      429
    );
  }
};

const recordFailedLogin = async (email) => {
  await query(
    `INSERT INTO login_attempts (email, failed_count, last_failed_at, locked_until, updated_at)
     VALUES ($1, 1, NOW(), NULL, NOW())
     ON CONFLICT (email) DO UPDATE SET
       failed_count = CASE
         WHEN login_attempts.last_failed_at < NOW() - ($2 || ' minutes')::INTERVAL THEN 1
         ELSE login_attempts.failed_count + 1
       END,
       last_failed_at = NOW(),
       locked_until = CASE
         WHEN login_attempts.last_failed_at < NOW() - ($2 || ' minutes')::INTERVAL THEN NULL
         WHEN login_attempts.failed_count + 1 >= $3 THEN NOW() + ($4 || ' minutes')::INTERVAL
         ELSE login_attempts.locked_until
       END,
       updated_at = NOW()`,
    [email, LOGIN_FAIL_WINDOW_MIN, LOGIN_FAIL_THRESHOLD, LOGIN_LOCK_MINUTES]
  );
};

const clearLoginAttempts = async (email) => {
  await query(`DELETE FROM login_attempts WHERE email = $1`, [email]);
};

const getJwtSecret = () => {
  const configuredSecret = process.env.JWT_SECRET;

  if (configuredSecret && !/your[_-]/i.test(configuredSecret)) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw createError('JWT_SECRET is not configured.', 500);
  }

  return 'redip-dev-jwt-secret-change-me-please';
};

// Access tokens are short-lived (15 min) and rotated via refresh-token
// cookies. The 7-day fallback is kept ONLY for the JWT_EXPIRES_IN env
// override — if an operator pins a longer expiry, refresh-token rotation
// becomes meaningless but the system still works (back-compat).
//
// Tokens issued before this default flipped from '7d' → '15m' continue to
// validate against their original `exp` claim until that claim passes;
// JWT verification is self-describing and indifferent to the default.
const generateToken = (userId, role) =>
  jwt.sign(
    { userId, role },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

const isOrganizationAccessDenied = (error) =>
  error?.statusCode === 403 && error?.message === 'Organization access denied.';

const resolveLoginAuthContext = async (userId, requestedOrganizationId, defaultOrganizationId) => {
  try {
    return await hydrateUserAuthContext(userId, requestedOrganizationId);
  } catch (error) {
    if (!isOrganizationAccessDenied(error)) {
      throw error;
    }

    if (requestedOrganizationId) {
      try {
        return await hydrateUserAuthContext(userId, null);
      } catch (retryError) {
        if (!isOrganizationAccessDenied(retryError) || !defaultOrganizationId) {
          throw retryError;
        }
      }
    } else if (!defaultOrganizationId) {
      throw error;
    }

    await query(
      'UPDATE users SET default_organization_id = NULL, updated_at = NOW() WHERE id = $1',
      [userId]
    );

    return hydrateUserAuthContext(userId, null);
  }
};

// Cold signup (no invitation token) creates a brand-new workspace and grants
// the registrant Owner role on it. Without a gate, anyone who finds the
// /register URL can stand up their own workspace — fine for solo tenancy but
// risks brand-spoofed invites and quota abuse if the URL leaks.
//
// Default-deny: cold signup is blocked unless ALLOW_COLD_SIGNUP=true. Invite-
// based registration is always allowed regardless of this flag.
const isColdSignupAllowed = () => {
  const value = String(process.env.ALLOW_COLD_SIGNUP || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
};

const register = async (name, email, password, phone = null, options = {}) => {
  const normalizedEmail = email.toLowerCase();
  const existingUser = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

  if (existingUser.rows.length > 0) {
    throw createError('An account with this email already exists.', 409);
  }

  // Cold-signup gate first — cheap env check, fails fast for anonymous
  // arrivals at /register. Invitation-token registrations are always allowed
  // regardless of the env flag.
  if (!options.invitationToken && !isColdSignupAllowed()) {
    throw createError(
      'Sign-up is by invitation only. Please ask your workspace admin to invite you.',
      403
    );
  }

  // Validate the legal-document acceptance BEFORE hashing the password.
  // Throws 400 if the client did not echo back current versions, 409 if
  // the published version moved between page-load and submit.
  const legalDocumentIds = await legalService.resolveSignupAcceptance({
    acceptedTermsVersion: options.acceptedTermsVersion,
    acceptedPrivacyVersion: options.acceptedPrivacyVersion,
  });

  // Reject passwords that have appeared in known data breaches. Uses
  // HIBP's k-anonymity API — only the first 5 hex chars of the SHA-1
  // are sent. Fails open on connectivity errors; bcrypt + throttle still
  // in force in that case.
  const breach = await isPasswordBreached(password);
  if (breach.breached) {
    throw createError(
      'This password has appeared in known data breaches and cannot be used. Please choose a stronger, unique password.',
      400
    );
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  return transaction(async (client) => {
    const defaultLegacyRole = options.invitationToken
      ? mapOrganizationRoleToLegacyUserRole(options.invitedRole || 'viewer')
      : 'admin';

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, phone, is_active, default_organization_id`,
      [normalizedEmail, passwordHash, name, defaultLegacyRole, phone]
    );

    const user = userResult.rows[0];

    if (options.invitationToken) {
      await consumeInvitation(client, {
        userId: user.id,
        email: normalizedEmail,
        invitationToken: options.invitationToken,
      });
    } else {
      await createWorkspaceForUser(client, {
        userId: user.id,
        name,
        email: normalizedEmail,
        organizationName: options.organizationName,
      });
    }

    // Record legal acceptance inside the same transaction. If the user row
    // commits, the acceptance row commits — never one without the other.
    await legalService.recordAcceptance(
      {
        userId: user.id,
        documentIds: legalDocumentIds,
        ipAddress: options.requestContext?.ipAddress || null,
        userAgent: options.requestContext?.userAgent || null,
      },
      client
    );

    const authContext = await hydrateUserAuthContext(user.id, null, client);
    const token = generateToken(authContext.user.id, authContext.user.role);

    return { user: authContext.user, token };
  });
};

const login = async (email, password, requestedOrganizationId = null) => {
  const normalizedEmail = email.toLowerCase();

  await enforceLoginThrottle(normalizedEmail);

  const result = await query(
    `SELECT id, email, password_hash, name, phone, is_active, last_login_at, default_organization_id
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    await recordFailedLogin(normalizedEmail);
    throw createError('Invalid email or password.', 401);
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw createError('Your account has been deactivated. Please contact the administrator.', 403);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    await recordFailedLogin(normalizedEmail);
    throw createError('Invalid email or password.', 401);
  }

  await clearLoginAttempts(normalizedEmail);
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const authContext = await resolveLoginAuthContext(
    user.id,
    requestedOrganizationId,
    user.default_organization_id
  );
  const token = generateToken(authContext.user.id, authContext.user.role);

  return { user: authContext.user, token };
};

const getUserById = async (id, requestedOrganizationId = null) => {
  const authContext = await hydrateUserAuthContext(id, requestedOrganizationId);

  const result = await query(
    `SELECT id, email, name, phone, is_active, last_login_at, created_at, updated_at, default_organization_id
     FROM users
     WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  return {
    ...authContext.user,
    last_login_at: result.rows[0].last_login_at,
    created_at: result.rows[0].created_at,
    updated_at: result.rows[0].updated_at,
  };
};

const updateUser = async (id, data, requestedOrganizationId = null) => {
  const allowedFields = ['name', 'phone'];
  const updates = [];
  const values = [];
  let paramCount = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramCount}`);
      values.push(data[field]);
      paramCount++;
    }
  }

  if (data.newPassword && data.currentPassword) {
    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      throw createError('User not found.', 404);
    }

    const isValid = await bcrypt.compare(data.currentPassword, userResult.rows[0].password_hash);
    if (!isValid) {
      throw createError('Current password is incorrect.', 400);
    }

    const breach = await isPasswordBreached(data.newPassword);
    if (breach.breached) {
      throw createError(
        'This password has appeared in known data breaches and cannot be used. Please choose a stronger, unique password.',
        400
      );
    }

    const newHash = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
    updates.push(`password_hash = $${paramCount}`);
    values.push(newHash);
    paramCount++;
  }

  if (updates.length === 0) {
    throw createError('No valid fields to update.', 400);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const result = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
     RETURNING id`,
    values
  );

  if (result.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  return getUserById(id, requestedOrganizationId);
};

// ============================================================================
// Google OAuth — sign-in / sign-up via federated identity (raw OIDC).
// ============================================================================
//
// Flow:
//   1. Frontend obtains a Google ID token via Google Identity Services.
//   2. POST /api/auth/google { idToken, acceptedTermsVersion?, ... }
//   3. Backend verifies the ID token (signature, audience, issuer, expiry).
//   4. Resolve the user:
//        a. (provider, subject) match → log in.
//        b. email match AND existing user has NULL oauth_provider → bind +
//           log in. Safe: Google's email_verified=true claim guarantees the
//           OAuth user controls the email; the existing account also proved
//           email control at signup (or via /verify-email).
//        c. email match AND existing user has a different oauth_provider →
//           reject (do not silently rebind a different identity).
//        d. No match → cold-signup path. Cold-signup gate applies; legal
//           acceptance is required for the new user.
//   5. Mark email_verified_at = NOW() (Google asserts email_verified for
//      consumer accounts and Workspace tenants alike).
//   6. Issue our standard JWT and return the same { user, token } shape as
//      password login so the frontend treats both identically.
//
// Security notes:
//   - We never trust the email alone. Account linking requires the existing
//     row to have NO oauth binding yet. A user who signed up with password
//     and never bound Google can be bound on first Google sign-in; thereafter
//     they're tied to that subject.
//   - We never accept email_verified=false. Google can return false for
//     newly-created accounts and we refuse to create or bind on those.
//   - Login throttle is bypassed for OAuth (no password to brute-force) but
//     the IP-level rate limiter on /api/auth still applies.
//   - The OAuth-only user gets a random 64-byte bcrypt hash they cannot
//     possibly know. They cannot log in with password until a future
//     "set password" flow exists. This is a feature, not a bug — one auth
//     factor per account is simpler to reason about.

const generateUnusablePasswordHash = async () => {
  const random = crypto.randomBytes(64).toString('base64url');
  return bcrypt.hash(random, SALT_ROUNDS);
};

const findUserByOAuthIdentity = async (provider, subject, client = null) => {
  const exec = client ? client.query.bind(client) : query;
  const result = await exec(
    `SELECT id, email, name, phone, is_active, default_organization_id,
            oauth_provider, oauth_subject, email_verified_at
       FROM users
      WHERE oauth_provider = $1 AND oauth_subject = $2
      LIMIT 1`,
    [provider, subject]
  );
  return result.rows[0] || null;
};

const findUserByEmail = async (email, client = null) => {
  const exec = client ? client.query.bind(client) : query;
  const result = await exec(
    `SELECT id, email, name, phone, is_active, default_organization_id,
            oauth_provider, oauth_subject, email_verified_at
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
};

const loginOrRegisterWithGoogle = async (idToken, options = {}) => {
  const claims = await googleOAuth.verifyIdToken(idToken);

  if (!claims.email) {
    throw createError(
      'Google did not return an email for this account. Please use a Google account with an email on file.',
      400
    );
  }
  if (!claims.emailVerified) {
    throw createError(
      'Your Google account email is not verified. Please verify it with Google and try again.',
      400
    );
  }

  const normalizedEmail = claims.email.toLowerCase();

  // Path A — exact (provider, subject) match. Returning user signs in.
  const byIdentity = await findUserByOAuthIdentity(claims.provider, claims.subject);
  if (byIdentity) {
    if (!byIdentity.is_active) {
      throw createError(
        'Your account has been deactivated. Please contact the administrator.',
        403
      );
    }
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [byIdentity.id]);
    const authContext = await hydrateUserAuthContext(
      byIdentity.id,
      options.requestedOrganizationId || null
    );
    const token = generateToken(authContext.user.id, authContext.user.role);
    return { user: authContext.user, token, mode: 'login' };
  }

  // Path B — email match. Bind on first sign-in if no prior OAuth binding.
  const byEmail = await findUserByEmail(normalizedEmail);
  if (byEmail) {
    if (byEmail.oauth_provider && byEmail.oauth_provider !== claims.provider) {
      throw createError(
        'This email is already registered with a different sign-in method. Use that method to sign in.',
        409
      );
    }
    if (byEmail.oauth_provider === claims.provider && byEmail.oauth_subject !== claims.subject) {
      // Unusual: same provider, different subject for same email. Refuse —
      // this happens if a Google Workspace account was deleted and recreated;
      // owner must contact support to rebind explicitly.
      throw createError(
        'This email is bound to a different Google identity. Contact support to update the binding.',
        409
      );
    }
    if (!byEmail.is_active) {
      throw createError(
        'Your account has been deactivated. Please contact the administrator.',
        403
      );
    }

    // Bind + verify email + log in.
    await query(
      `UPDATE users
          SET oauth_provider = $2,
              oauth_subject  = $3,
              email_verified_at = COALESCE(email_verified_at, NOW()),
              last_login_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [byEmail.id, claims.provider, claims.subject]
    );
    const authContext = await hydrateUserAuthContext(
      byEmail.id,
      options.requestedOrganizationId || null
    );
    const token = generateToken(authContext.user.id, authContext.user.role);
    return { user: authContext.user, token, mode: 'bound' };
  }

  // Path C — cold signup via Google. Cold-signup gate applies; legal
  // acceptance is required (collected on the frontend before button click).
  if (!options.invitationToken && !isColdSignupAllowed()) {
    throw createError(
      'Sign-up is by invitation only. Please ask your workspace admin to invite you.',
      403
    );
  }

  const legalDocumentIds = await legalService.resolveSignupAcceptance({
    acceptedTermsVersion: options.acceptedTermsVersion,
    acceptedPrivacyVersion: options.acceptedPrivacyVersion,
  });

  const passwordHash = await generateUnusablePasswordHash();
  const displayName = (claims.name || normalizedEmail.split('@')[0] || 'User').slice(0, 200);

  return transaction(async (client) => {
    const defaultLegacyRole = options.invitationToken
      ? mapOrganizationRoleToLegacyUserRole(options.invitedRole || 'viewer')
      : 'admin';

    const userResult = await client.query(
      `INSERT INTO users
         (email, password_hash, name, role, oauth_provider, oauth_subject, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, email, name, phone, is_active, default_organization_id`,
      [
        normalizedEmail,
        passwordHash,
        displayName,
        defaultLegacyRole,
        claims.provider,
        claims.subject,
      ]
    );

    const user = userResult.rows[0];

    if (options.invitationToken) {
      await consumeInvitation(client, {
        userId: user.id,
        email: normalizedEmail,
        invitationToken: options.invitationToken,
      });
    } else {
      await createWorkspaceForUser(client, {
        userId: user.id,
        name: displayName,
        email: normalizedEmail,
        organizationName: options.organizationName,
      });
    }

    await legalService.recordAcceptance(
      {
        userId: user.id,
        documentIds: legalDocumentIds,
        ipAddress: options.requestContext?.ipAddress || null,
        userAgent: options.requestContext?.userAgent || null,
      },
      client
    );

    const authContext = await hydrateUserAuthContext(user.id, null, client);
    const token = generateToken(authContext.user.id, authContext.user.role);
    return { user: authContext.user, token, mode: 'register' };
  });
};

module.exports = {
  register,
  login,
  loginOrRegisterWithGoogle,
  getUserById,
  updateUser,
  getJwtSecret,
};
