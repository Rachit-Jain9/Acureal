const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  assertInvitationUsable,
  consumeInvitation,
  createWorkspaceForUser,
  deriveWorkspaceName,
  hydrateUserAuthContext,
  joinByVerifiedDomain,
  slugifyOrganizationName,
} = require('./organization.service');
const { setRequestContext } = require('../lib/requestContext');
const { requireDefinerPath } = require('../lib/authDefiners');
const {
  normalizeEmailDomain,
  isPublicEmailDomain,
  canonicalEmail,
  isGoogleMailAddress,
  emailLookupCandidates,
} = require('../utils/emailDomain');
const { assertAccountUsable } = require('../utils/accountState');
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
//
// THE ROW IS KEYED ON THE CANONICAL ADDRESS, and the three helpers below
// canonicalise their own argument rather than trusting the caller to have done
// it. That placement is the security control, not a convenience:
//
//   /login no longer applies express-validator's normalizeEmail() — it could
//   not, because that sanitizer strips gmail dots and the Google sign-in path
//   stores addresses dotted, so normalising made password sign-in impossible
//   for every dotted-gmail Google account. But an unnormalised key would have
//   been far worse than the bug it fixed: keyed on the address AS TYPED, an
//   attacker gets a fresh 5-failure budget from every dot variant of the same
//   address (f.irst@, fi.rst@, fir.st@ …), and the per-account lockout stops
//   existing. Canonicalising INSIDE these functions makes that class of mistake
//   unrepresentable — no future caller can re-introduce it by passing a raw
//   address, because there is no parameter that reaches the SQL unprocessed.
//
// Net effect versus the old behaviour: strictly stronger. Every dot and +tag
// variant of one gmail address now shares a single budget, where before
// normalizeEmail() collapsed them only because it also broke the lookup.
const LOGIN_FAIL_THRESHOLD = 5;
const LOGIN_FAIL_WINDOW_MIN = 15;
const LOGIN_LOCK_MINUTES = 15;

const enforceLoginThrottle = async (email) => {
  const result = await query(
    `SELECT locked_until FROM login_attempts
     WHERE email = $1 AND locked_until IS NOT NULL AND locked_until > NOW()`,
    [canonicalEmail(email)]
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
    [canonicalEmail(email), LOGIN_FAIL_WINDOW_MIN, LOGIN_FAIL_THRESHOLD, LOGIN_LOCK_MINUTES]
  );
};

const clearLoginAttempts = async (email) => {
  await query(`DELETE FROM login_attempts WHERE email = $1`, [canonicalEmail(email)]);
};

// Optional signup-profile fields (company / job_title / city). Trim, cap to
// the column width, and collapse blanks to NULL so the DB never stores an
// empty string masquerading as a value. Kept deliberately permissive — these
// are descriptive, never gate signup.
const normalizeProfileField = (value, maxLength) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const extractSignupProfile = (options = {}) => ({
  company: normalizeProfileField(options.company, 255),
  jobTitle: normalizeProfileField(options.jobTitle, 255),
  city: normalizeProfileField(options.city, 120),
});

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

// M1 Phase 2 — the whole signup INSERT chain (users + invitation/domain
// membership + workspace + legal acceptance) via the SECURITY DEFINER
// provisioning function. Shared by register() and the Google cold-signup so
// the two forks cannot drift. The function re-validates the invitation token
// and the verified domain INTERNALLY (it never accepts a caller-resolved org
// id or membership role); the auth_find_invitation pre-check here exists only
// to surface the same friendly 404/409/410 errors as consumeInvitation.
const provisionViaDefiner = async ({
  email, passwordHash, name, legacyRole, phone,
  oauthProvider, oauthSubject, emailVerified, passwordSet,
  profile, invitationToken, hostedDomain, organizationName,
  legalDocumentIds, requestContext, mode = null,
}) => {
  if (invitationToken) {
    const invitationResult = await query(
      'SELECT * FROM public.auth_find_invitation($1)',
      [invitationToken]
    );
    assertInvitationUsable(invitationResult.rows[0] || null, email);
  }

  // Single-candidate contract (byte-parity with joinByVerifiedDomain): the
  // hosted domain wins outright when present — there is deliberately NO
  // fallback to the email domain when the hosted domain has no verified claim.
  const domain = normalizeEmailDomain(hostedDomain) || normalizeEmailDomain(email);
  const domainCandidates =
    !invitationToken && domain && !isPublicEmailDomain(domain) ? [domain] : null;

  const workspaceName = deriveWorkspaceName({ name, email, organizationName });
  // May be '' — the SQL falls back to workspace-<uid8> internally, using the
  // REAL new user id (which does not exist yet on this side of the call).
  const slugBase = slugifyOrganizationName(workspaceName);

  const uid = (await query(
    `SELECT public.auth_provision_signup(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     ) AS id`,
    [
      email, passwordHash, name, legacyRole, phone,
      oauthProvider, oauthSubject, emailVerified, passwordSet,
      profile.company, profile.jobTitle, profile.city,
      invitationToken, domainCandidates, workspaceName, slugBase,
      legalDocumentIds,
      requestContext?.ipAddress || null,
      requestContext?.userAgent || null,
    ]
  )).rows[0].id;

  // Provisioning is committed; stamp the context so hydrate's self-scoped
  // reads resolve under a non-bypass role.
  setRequestContext({ userId: uid });

  // The account exists even if hydrate hiccups — retry once, then hand the
  // user a truthful "sign in normally" instead of a dead-end error.
  let authContext;
  try {
    authContext = await hydrateUserAuthContext(uid, null);
  } catch {
    try {
      authContext = await hydrateUserAuthContext(uid, null);
    } catch {
      throw createError(
        'Your account was created but sign-in could not complete. Please log in with your credentials.',
        500
      );
    }
  }

  const token = generateToken(authContext.user.id, authContext.user.role);
  return mode
    ? { user: authContext.user, token, mode }
    : { user: authContext.user, token };
};

// Registration is open. Anyone who reaches /register and accepts the Terms
// can create an account; without an invitation token they get their own
// brand-new workspace as Owner. With an invitation token they join the
// inviting organization at the role the invite encodes.

const register = async (name, email, password, phone = null, options = {}) => {
  const normalizedEmail = email.toLowerCase();
  // M1 Phase 2: pre-identity duplicate-email guard — definer-routed so the
  // friendly 409 survives the role flip (RLS would hide the existing row and
  // demote this to a raw UNIQUE-constraint failure).
  const existingUser = (await requireDefinerPath())
    ? await query('SELECT * FROM public.auth_find_user_for_login($1)', [normalizedEmail])
    : await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

  if (existingUser.rows.length > 0) {
    throw createError('An account with this email already exists.', 409);
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
  const profile = extractSignupProfile(options);

  const defaultLegacyRole = options.invitationToken
    ? mapOrganizationRoleToLegacyUserRole(options.invitedRole || 'viewer')
    : 'admin';

  // M1 Phase 2 fork: the users INSERT has NO RLS policy (deliberately — a
  // permissive one would leak), so under a non-bypass role signup must run
  // through the SECURITY DEFINER provisioning function. The fallback branch
  // below is the original transaction chain, byte-for-byte, and remains the
  // only path exercised under the current bypass role until the migration is
  // applied.
  if (await requireDefinerPath()) {
    return provisionViaDefiner({
      email: normalizedEmail,
      passwordHash,
      name,
      legacyRole: defaultLegacyRole,
      phone,
      oauthProvider: null,
      oauthSubject: null,
      emailVerified: false,
      passwordSet: true,
      profile,
      invitationToken: options.invitationToken || null,
      hostedDomain: null,
      organizationName: options.organizationName,
      legalDocumentIds,
      requestContext: options.requestContext,
    });
  }

  return transaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name, role, phone, company, job_title, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, name, phone, is_active, default_organization_id`,
      [normalizedEmail, passwordHash, name, defaultLegacyRole, phone,
       profile.company, profile.jobTitle, profile.city]
    );

    const user = userResult.rows[0];

    if (options.invitationToken) {
      await consumeInvitation(client, {
        userId: user.id,
        email: normalizedEmail,
        invitationToken: options.invitationToken,
      });
    } else {
      // Domain-based onboarding: if the email's domain is a verified, auto-join
      // org domain, place the user there. Only falls back to a fresh personal
      // workspace when no verified domain claims this address.
      const joinedOrgId = await joinByVerifiedDomain(client, {
        userId: user.id,
        email: normalizedEmail,
      });
      if (!joinedOrgId) {
        await createWorkspaceForUser(client, {
          userId: user.id,
          name,
          email: normalizedEmail,
          organizationName: options.organizationName,
        });
      }
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

// Pre-identity lookup for sign-in. Mirrors findUserForReset in
// passwordReset.service.js, and diverges from it in one way: it returns EVERY
// stored shape that resolves, not just the first.
//
// M1 Phase 2: the lookup is PRE-IDENTITY — under a non-BYPASSRLS role no users
// policy can match it (self-read needs current_user_id(), unset here). Route
// through the SECURITY DEFINER helper when it exists; the fallback is the
// byte-identical original query, fully correct under the current bypass role
// (authDefiners fails loud, never silent, post-flip).
//
// Why a LIST and not the first hit. Gmail lives in this database in two shapes,
// so `first.last@gmail.com` and `firstlast@gmail.com` can be two DISTINCT rows
// — and routinely are, because the duplicate-email guard in register() has
// never been able to see across the two shapes. For such a pair, stopping at
// the first hit would resolve the typed address to the Google row (which holds
// an unusable random hash) and reject a password that is perfectly valid on the
// other row — turning today's working sign-in into a 401. Returning both lets
// the caller try the password against each.
const findUsersForLogin = async (email) => {
  const useDefiner = await requireDefinerPath();
  const rows = [];
  const seenIds = new Set();

  for (const candidate of emailLookupCandidates(email)) {
    const result = useDefiner
      ? await query('SELECT * FROM public.auth_find_user_for_login($1)', [candidate])
      : await query(
          `SELECT id, email, password_hash, name, phone, is_active, last_login_at, default_organization_id,
                  account_closed_at, erased_at
           FROM users
           WHERE email = $1`,
          [candidate]
        );
    for (const row of result.rows) {
      if (row && !seenIds.has(row.id)) {
        seenIds.add(row.id);
        rows.push(row);
      }
    }
  }

  return rows;
};

const login = async (email, password, requestedOrganizationId = null) => {
  // Throttle FIRST, on the canonical address — see the helpers' header comment.
  // The route no longer normalises, so `email` here is exactly what was typed.
  await enforceLoginThrottle(email);

  const candidates = await findUsersForLogin(email);

  if (candidates.length === 0) {
    await recordFailedLogin(email);
    throw createError('Invalid email or password.', 401);
  }

  // Try each stored shape of the typed address. For every non-gmail address —
  // and for every gmail typed in the shape it is stored in — there is exactly
  // one candidate and this loop is the old straight-line path, decision for
  // decision. The loop only does more work when the duplicate-row case above
  // is actually present.
  let user = null;
  let terminalError = null; // closure / erasure / deactivation we had to skip
  let checkedAPassword = false;

  for (const row of candidates) {
    // Account closure block (PR #158), routed through the shared guard so
    // password login, Google, MFA completion and refresh cannot drift apart.
    //
    // Two behaviour changes vs. the hand-rolled pair this replaced. (1) erased_at
    // is honoured here, not just account_closed_at — erasure NULLs
    // password_hash, so an erased row previously fell through to bcrypt.compare
    // against NULL rather than being refused outright. (2) Terminal state is
    // checked ahead of is_active, so a closed account that an admin also
    // deactivated reports closure — the truer, more actionable reason.
    //
    // The message still names the closure openly rather than hiding behind
    // "invalid email or password": a closed user is the legitimate owner of the
    // account, not an attacker. That reasoning is unchanged from PR #158.
    try {
      assertAccountUsable(row, createError);
    } catch (error) {
      // Only a deliberate, classified refusal is a candidate-level outcome. A
      // programming fault or a driver error must surface as itself, never be
      // laundered into "invalid email or password".
      if (!error?.statusCode) throw error;
      if (!terminalError) terminalError = error;
      // A closed row must not mask a live one: if the other stored shape of
      // this address is a healthy account, that account can still sign in.
      continue;
    }

    // Belt-and-braces: assertAccountUsable already refuses erased rows (the
    // only ones with a NULL hash), but bcrypt.compare throws on a non-string
    // second argument, and a 500 on the sign-in path would be a far worse
    // failure than a 401.
    if (!row.password_hash) continue;

    checkedAPassword = true;
    if (await bcrypt.compare(password, row.password_hash)) {
      user = row;
      break;
    }
  }

  if (!user) {
    // Nothing accepted this password. If NO candidate was even usable, the
    // honest answer is the closure/deactivation reason — and, exactly as
    // before, that outcome does not spend lockout budget: it is the legitimate
    // owner of a frozen account, not a guess at a password.
    if (!checkedAPassword && terminalError) throw terminalError;
    await recordFailedLogin(email);
    throw createError('Invalid email or password.', 401);
  }

  // Clear the lockout row only when this success PROVES the row belongs to the
  // account that just authenticated.
  //
  // The canonical key is many-to-one for gmail, so one lockout row can serve two
  // distinct accounts (see findUsersForLogin). Clearing it unconditionally hands
  // an attacker an unlimited-guess machine: register firstlast@gmail.com — which
  // register()'s single-shape duplicate guard permits even when the victim's
  // Google account already exists as first.last@gmail.com — then loop {four wrong
  // guesses at the victim's row, one real sign-in to your own}, refunding the
  // shared budget forever. Only the per-IP limiter would remain, which is exactly
  // the gap this per-account throttle exists to close.
  //
  // When we can be sure the row is unshared, the old behaviour is kept:
  //
  //   • Not a gmail-family address → canonicalisation is the identity, the key
  //     names exactly one address. Nothing can share it. (Every corporate
  //     domain, i.e. most of this product's users.)
  //   • Gmail typed in a NON-canonical shape → findUsersForLogin probed the
  //     canonical spelling too and it held no row. That matters because an
  //     attacker-controlled sibling is ALWAYS at the canonical spelling:
  //     /register normalises before storing, and the only path that stores a
  //     dotted address is Google sign-in, which requires the mailbox. One row
  //     back from both probes therefore means no sibling exists.
  //
  // The remaining case — gmail typed in canonical form — is the one we cannot
  // clear safely, because a dotted sibling we never probed may exist. Those
  // users keep a counter that ages out on its own once their last failure
  // passes the 15-minute window (see recordFailedLogin); it is simply not
  // wiped early.
  const keyNamesOneAccount =
    !isGoogleMailAddress(email) || emailLookupCandidates(email).length > 1;
  if (keyNamesOneAccount && candidates.length === 1) {
    await clearLoginAttempts(email);
  }

  // M1 Phase 2: credentials are validated — stamp the user id into the
  // request context NOW. Everything below (the MFA-enrollment self-read, the
  // last_login_at UPDATE, hydrate's users/org_members reads) is guarded by
  // self-scoped RLS policies matching current_user_id(). Without this stamp a
  // non-bypass role would see zero rows — which would SILENTLY skip the MFA
  // challenge for enrolled users. No-op under the current bypass role.
  setRequestContext({ userId: user.id });

  // MFA gate: if the user has enrolled in TOTP, hand back a short-lived
  // challenge ticket instead of an access token. The SPA prompts for the
  // 6-digit code; POST /auth/mfa/verify completes the login by minting
  // the regular cookies.
  const mfaService = require('./mfa.service');
  if (await mfaService.isMfaRequired(user.id)) {
    const { challenge, expiresAt } = await mfaService.issueChallenge(user.id);
    return { mfaRequired: true, challenge, expiresAt };
  }

  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const authContext = await resolveLoginAuthContext(
    user.id,
    requestedOrganizationId,
    user.default_organization_id
  );
  const token = generateToken(authContext.user.id, authContext.user.role);

  return { user: authContext.user, token };
};

// Completes MFA login. Verifies the user's TOTP/recovery code, mints the
// access JWT, and returns the same shape as the normal password login
// path so the calling route can issue cookies the same way.
const completeMfaLogin = async ({ challenge, code, requestedOrganizationId }) => {
  const mfaService = require('./mfa.service');
  const { userId } = await mfaService.verifyChallenge({ challenge, code });

  // M1 Phase 2: the challenge proved this user's identity — stamp the context
  // so the self-scoped reads/updates below survive a non-bypass role.
  setRequestContext({ userId });

  const userResult = await query(
    `SELECT id, default_organization_id FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw createError('User not found after MFA verification.', 401);
  }

  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
  const authContext = await resolveLoginAuthContext(
    userId,
    requestedOrganizationId,
    user.default_organization_id,
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
  // M1 Phase 2: pre-identity lookup — definer-routed when no transaction
  // client is supplied (in-transaction callers keep the direct path; they run
  // under an established context or the fallback register chain).
  if (!client && (await requireDefinerPath())) {
    const result = await query('SELECT * FROM public.auth_find_user_by_oauth($1, $2)', [provider, subject]);
    return result.rows[0] || null;
  }
  const exec = client ? client.query.bind(client) : query;
  const result = await exec(
    `SELECT id, email, name, phone, is_active, default_organization_id,
            account_closed_at, erased_at,
            oauth_provider, oauth_subject, email_verified_at
       FROM users
      WHERE oauth_provider = $1 AND oauth_subject = $2
      LIMIT 1`,
    [provider, subject]
  );
  return result.rows[0] || null;
};

const findUserByEmail = async (email, client = null) => {
  // M1 Phase 2: pre-identity lookup — definer-routed when no transaction
  // client is supplied. auth_find_user_for_login's column list is a superset
  // of this SELECT (never MFA secrets), so callers read identical fields.
  if (!client && (await requireDefinerPath())) {
    const result = await query('SELECT * FROM public.auth_find_user_for_login($1)', [email]);
    return result.rows[0] || null;
  }
  const exec = client ? client.query.bind(client) : query;
  const result = await exec(
    `SELECT id, email, name, phone, is_active, default_organization_id,
            account_closed_at, erased_at,
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
    // Terminal-state gate: closed and erased accounts cannot sign in with
    // Google any more than they can with a password. Before this check, a
    // closed — even an ERASED — row still held a live Google binding and
    // authenticated straight through, keeping whatever is_platform_admin it had.
    //
    // On the SECURITY DEFINER route this is belt-and-braces until migration
    // 20260808 lands: auth_find_user_by_oauth's older signature does not return
    // the closure columns, so they read undefined and this call is a no-op
    // there. The hydrateUserAuthContext call a few lines below reads `users`
    // directly and refuses regardless, so the path is closed either way — the only
    // pre-migration side effect reaching a closed row is the harmless
    // last_login_at stamp.
    assertAccountUsable(byIdentity, createError);
    // M1 Phase 2: Google verified this identity — stamp the context so the
    // self-scoped UPDATE + hydrate reads survive a non-bypass role.
    setRequestContext({ userId: byIdentity.id });
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
    // Terminal-state gate FIRST — ahead of the binding-conflict checks below.
    //
    // Two reasons for that ordering. (1) Side effect: this branch's whole job
    // is to WRITE a fresh Google binding onto the matched row. Without a gate
    // here, signing in with Google would bind a live identity onto a closed or
    // erased account and then mint a session — the bind happens before
    // hydrateUserAuthContext gets a chance to refuse. The check has to precede
    // the UPDATE, not merely exist somewhere on the path. (2) Erasure NULLs
    // password_hash but leaves oauth_provider/oauth_subject intact, so an
    // erased Google-bound row would otherwise fall into the "bound to a
    // different Google identity — contact support" 409, which both misdescribes
    // the situation and invites support to rebind an erased account.
    assertAccountUsable(byEmail, createError);

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

    // M1 Phase 2: bind-eligibility is proven (email match + no conflicting
    // OAuth binding + active) — stamp the context so the bind UPDATE below
    // actually persists under a non-bypass role (users_self_update matches on
    // current_user_id(); without this it would silently update zero rows).
    setRequestContext({ userId: byEmail.id });

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

  // Path C — first-time signup via Google. Legal acceptance is required
  // (collected on the frontend before the button click).

  const legalDocumentIds = await legalService.resolveSignupAcceptance({
    acceptedTermsVersion: options.acceptedTermsVersion,
    acceptedPrivacyVersion: options.acceptedPrivacyVersion,
  });

  const passwordHash = await generateUnusablePasswordHash();
  const displayName = (claims.name || normalizedEmail.split('@')[0] || 'User').slice(0, 200);
  const profile = extractSignupProfile(options);

  const defaultLegacyRole = options.invitationToken
    ? mapOrganizationRoleToLegacyUserRole(options.invitedRole || 'viewer')
    : 'admin';

  // M1 Phase 2 fork — see register(). Google's hosted-domain (hd) claim wins
  // outright over the email domain inside provisionViaDefiner, mirroring
  // joinByVerifiedDomain's preference.
  if (await requireDefinerPath()) {
    return provisionViaDefiner({
      email: normalizedEmail,
      passwordHash,
      name: displayName,
      legacyRole: defaultLegacyRole,
      phone: null,
      oauthProvider: claims.provider,
      oauthSubject: claims.subject,
      emailVerified: true,
      passwordSet: false,
      profile,
      invitationToken: options.invitationToken || null,
      hostedDomain: claims.hostedDomain || null,
      organizationName: options.organizationName,
      legalDocumentIds,
      requestContext: options.requestContext,
      mode: 'register',
    });
  }

  return transaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO users
         (email, password_hash, name, role, oauth_provider, oauth_subject,
          email_verified_at, password_set, company, job_title, city)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), FALSE, $7, $8, $9)
       RETURNING id, email, name, phone, is_active, default_organization_id`,
      [
        normalizedEmail,
        passwordHash,
        displayName,
        defaultLegacyRole,
        claims.provider,
        claims.subject,
        profile.company,
        profile.jobTitle,
        profile.city,
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
      // Domain-based onboarding. Google's hosted-domain (hd) claim, when present,
      // is a stronger signal than the email domain (it proves a Workspace tenant),
      // so prefer it; joinByVerifiedDomain falls back to the email domain.
      const joinedOrgId = await joinByVerifiedDomain(client, {
        userId: user.id,
        email: normalizedEmail,
        hostedDomain: claims.hostedDomain || null,
      });
      if (!joinedOrgId) {
        await createWorkspaceForUser(client, {
          userId: user.id,
          name: displayName,
          email: normalizedEmail,
          organizationName: options.organizationName,
        });
      }
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

// ============================================================================
// Set first password — for OAuth-only users who have never picked a password.
// ============================================================================
//
// Background: Google cold-signup (loginOrRegisterWithGoogle, path C) creates
// a user row with a 64-byte random unusable bcrypt and `password_set = false`.
// That's intentional — one auth factor per account is simpler. The downside
// is the user is locked out if Google ever revokes their account or they
// delete the linked Google identity.
//
// This endpoint lets such a user attach a password to their existing account
// without the operator-support escape hatch. The session itself is the proof
// of possession (JWT < 15 min old, refresh-token rotated, originally issued
// via Google sign-in) — re-prompting Google in-app would be redundant.
//
// Hard rules:
//   - 409 if the user already has password_set=true. They must use the
//     standard change-password flow (PUT /me with currentPassword + newPassword).
//   - HIBP breach check on the new password.
//   - Password complexity is enforced by the route validator.
//
const setFirstPassword = async (userId, newPassword) => {
  if (!userId) throw createError('User context missing.', 401);
  if (!newPassword || typeof newPassword !== 'string') {
    throw createError('A new password is required.', 400);
  }

  const userRow = await query(
    'SELECT id, password_set FROM users WHERE id = $1',
    [userId]
  );
  if (userRow.rows.length === 0) {
    throw createError('User not found.', 404);
  }
  if (userRow.rows[0].password_set !== false) {
    throw createError(
      'A password is already set for this account. Use the change-password flow to update it.',
      409
    );
  }

  const breach = await isPasswordBreached(newPassword);
  if (breach.breached) {
    throw createError(
      'This password has appeared in known data breaches and cannot be used. Please choose a stronger, unique password.',
      400
    );
  }

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query(
    `UPDATE users
        SET password_hash = $2,
            password_set  = TRUE,
            updated_at    = NOW()
      WHERE id = $1`,
    [userId, newHash]
  );

  return { passwordSet: true };
};

module.exports = {
  register,
  login,
  completeMfaLogin,
  loginOrRegisterWithGoogle,
  getUserById,
  updateUser,
  setFirstPassword,
  getJwtSecret,
};
