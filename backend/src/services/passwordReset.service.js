'use strict';

/**
 * Password reset service — the "forgot password" flow.
 *
 * Deliberate structural clone of emailVerification.service.js; that module is
 * the codebase's security-reviewed one-time-token blueprint. Where this file
 * diverges, the divergence is the point:
 *
 *   • 60-MINUTE TTL (not 24h). The link carries the power to take over the
 *     account; it gets a tight window. A user who misses it requests another.
 *   • ENUMERATION-RESISTANT BY CONTRACT. The request leg is called from a
 *     fire-and-forget dispatcher AFTER the route has already answered with the
 *     same generic 200 for every input — existing account, unknown address,
 *     OAuth-only, deactivated, closed, erased. Nothing in here may leak
 *     account existence through an HTTP response, and the confirm leg uses one
 *     identical vague message for unknown/consumed/expired tokens.
 *   • SESSIONS DIE ON RESET. A completed reset revokes every live
 *     refresh-token grant for the user inside the same transaction — if the
 *     reset was triggered because the account was compromised, the attacker's
 *     sessions must not survive the recovery.
 *   • WORKS FOR GOOGLE-ONLY ACCOUNTS. OAuth accounts hold an unusable random
 *     hash with password_set = FALSE (auth.service.js generateUnusablePasswordHash).
 *     A completed reset is functionally "set first password": possession of
 *     the email IS the proof, so we set password_hash AND password_set = TRUE
 *     and leave the Google binding intact — both sign-in methods work after.
 *     (setFirstPassword itself is NOT reused: it 409s when a password already
 *     exists, but reset must overwrite existing passwords too.)
 *
 * Token model (identical to email verification):
 *   • 32 random bytes, base64url. Only the SHA-256 hash is persisted; the raw
 *     token is returned exactly once so the caller can email it. NEVER log it.
 *   • One active token per user — new requests supersede prior unconsumed
 *     tokens (consumed_by = 'superseded').
 *   • One-shot — consumed_at set on success (consumed_by = 'reset').
 *   • 5 issues per user per hour, layered on the /api/auth IP limiter.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { sendMail, redactEmail } = require('../lib/mailer');
const { requireDefinerPath } = require('../lib/authDefiners');
const { emailLookupCandidates, canonicalEmail } = require('../utils/emailDomain');
const { isPasswordBreached } = require('../utils/passwordBreach');
const securityEvents = require('./securityEvents.service');
const log = require('../lib/logger').child({ module: 'password_reset' });

const TOKEN_BYTES = 32;
const TOKEN_TTL_MINUTES = 60;
const MAX_REQUESTS_PER_HOUR = 5;
const SALT_ROUNDS = 12;

// One string for every confirm-leg failure. Distinguishing unknown vs expired
// vs consumed would tell an attacker which guesses land on real tokens.
const INVALID_LINK_MESSAGE = 'Invalid or expired reset link.';

const sha256Hex = (text) =>
  crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const generateRawToken = () =>
  crypto.randomBytes(TOKEN_BYTES).toString('base64url');

// Production OR any Vercel deployment — a preview that emails a localhost link
// is just as broken as production doing it.
const isDeployed = () => process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const buildResetUrl = (rawToken) => {
  // SECURITY/UX: fail CLOSED when deployed — same contract as
  // buildVerificationUrl. A localhost link on a deploy is the worst failure
  // mode: the send succeeds, the email looks right, and the link is dead.
  if (isDeployed() && !process.env.APP_BASE_URL) {
    throw new Error(
      'APP_BASE_URL is not configured — refusing to send a password reset email whose link would point at localhost.'
    );
  }
  const base = process.env.APP_BASE_URL || 'http://localhost:5173';
  const url = new URL('/reset-password', base);
  url.searchParams.set('token', rawToken);
  return url.toString();
};

const renderResetEmail = ({ name, resetUrl, oauthProvider }) => {
  const safeName = (name || 'there').replace(/[<>]/g, '');
  // The Google hint lives in the EMAIL only — the recipient owns the mailbox,
  // so telling them how their own account signs in leaks nothing. The HTTP
  // response never carries it.
  const googleHintHtml = oauthProvider === 'google'
    ? `<p style="font-size: 13px; color: #6b7280;">
        You usually sign in with Google — that keeps working. Setting a
        password here simply adds email + password as a second way in.
      </p>`
    : '';
  const googleHintText = oauthProvider === 'google'
    ? '\n\nYou usually sign in with Google — that keeps working. Setting a password simply adds a second way in.'
    : '';
  const html = `
    <div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h1 style="font-size: 18px; margin-bottom: 16px;">Reset your Acureal password</h1>
      <p>Hi ${safeName},</p>
      <p>Click the button below to choose a new password. The link works once and expires in ${TOKEN_TTL_MINUTES} minutes.</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}"
           style="display: inline-block; padding: 10px 18px; background: #1E6FD0; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          Choose a new password
        </a>
      </p>
      <p style="font-size: 13px; color: #6b7280;">
        If the button doesn't work, paste this URL into your browser:<br/>
        <span style="word-break: break-all;">${resetUrl}</span>
      </p>
      ${googleHintHtml}
      <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
        If you didn't request this, you can safely ignore this message — your
        password stays unchanged and the link expires on its own. For your
        security, completing a reset signs the account out on all devices.
      </p>
    </div>
  `;
  const text = `Reset your Acureal password\n\nHi ${safeName},\n\nOpen this link to choose a new password (works once, expires in ${TOKEN_TTL_MINUTES} minutes):\n${resetUrl}${googleHintText}\n\nIf you didn't request this, ignore this message — your password stays unchanged.`;
  return { html, text };
};

const enforceRequestThrottle = async (userId, client = null) => {
  const exec = client ? client.query.bind(client) : query;
  const result = await exec(
    `SELECT COUNT(*)::int AS recent
       FROM public.password_reset_tokens
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  if (result.rows[0].recent >= MAX_REQUESTS_PER_HOUR) {
    throw createError(
      'Too many password reset emails requested. Please wait an hour before trying again.',
      429
    );
  }
};

/**
 * Issue a fresh reset token for a user, superseding any prior unconsumed one.
 * Returns the raw token so the caller can email it. Never log the raw token.
 *
 * ATOMIC AND SERIALISED PER USER. The throttle count, the supersede, and the
 * insert are one transaction behind a per-user advisory lock. Two reasons,
 * both found in the 2026-08-06 adversarial review:
 *
 *   1. Check-then-act. As three autocommit statements, N concurrent requests
 *      for the same victim all read `recent < 5` before any of them inserted,
 *      all passed, and all sent mail — the 5/hour inbox-bombing cap was
 *      softened by roughly the request parallelism. The IP limiter does not
 *      cover a distributed run, so this DB-level cap is the real defence.
 *   2. Interleaving (A supersede, B supersede, A insert, B insert) left TWO
 *      simultaneously-valid tokens, breaking the documented one-active-token
 *      invariant — the partial index is not UNIQUE, so nothing else enforced it.
 *
 * The transaction also removes a durability hole: as separate statements, a
 * crash (or a serverless freeze) between the supersede and the insert killed
 * the user's previous still-valid link while issuing no replacement.
 *
 * The lock key is the user's UUID hashed into a bigint — advisory locks are
 * transaction-scoped (`_xact_`), so it releases on COMMIT or ROLLBACK with no
 * cleanup path to forget.
 */
const issueToken = async ({ userId, ipAddress = null, userAgent = null }) => {
  if (!userId) throw createError('userId required to issue reset token.', 400);

  const rawToken = generateRawToken();
  const tokenHash = sha256Hex(rawToken);

  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
      `password_reset:${userId}`,
    ]);

    await enforceRequestThrottle(userId, client);

    await client.query(
      `UPDATE public.password_reset_tokens
          SET consumed_at = NOW(), consumed_by = 'superseded'
        WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId]
    );

    await client.query(
      `INSERT INTO public.password_reset_tokens
         (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::INTERVAL, $4::inet, $5)`,
      [userId, tokenHash, TOKEN_TTL_MINUTES, ipAddress, userAgent]
    );
  });

  return rawToken;
};

// Pre-identity lookup — the caller is anonymous, so under the non-BYPASSRLS
// app role a direct `users WHERE email` read returns zero rows (users
// self-read needs current_user_id(), unset here). Route through the SECURITY
// DEFINER helper exactly like login() does; the fallback is byte-compatible
// and correct in tests / any bypass-role environment.
//
// TRIES EVERY STORED SHAPE of the typed address (emailLookupCandidates), most
// literal first. Gmail is stored two ways in this database — dotted by the
// Google sign-in path, dot-stripped by /register — so a single-shape lookup
// silently missed half of them. For every non-gmail address the candidate list
// has exactly one entry, so this is one query as before.
const findUserForReset = async (email) => {
  const useDefiner = await requireDefinerPath();

  for (const candidate of emailLookupCandidates(email)) {
    const result = useDefiner
      ? await query('SELECT * FROM public.auth_find_user_for_login($1)', [candidate])
      : await query(
          `SELECT id, email, name, is_active, account_closed_at, erased_at,
                  oauth_provider, password_set
             FROM users
            WHERE email = $1`,
          [candidate]
        );
    if (result.rows[0]) return result.rows[0];
  }
  return null;
};

/**
 * The "forgot password" request leg. ALWAYS called fire-and-forget from the
 * route — by the time this runs, the generic 200 is already on the wire, so
 * nothing here can leak account existence through status, body, or timing.
 * Every outcome (unknown address, ineligible account, throttled, sent) is a
 * log line, never a response difference.
 *
 * Returns { dispatched, reason } for tests and callers that care.
 */
const requestReset = async ({ email, ipAddress = null, userAgent = null }) => {
  if (!email || typeof email !== 'string') {
    return { dispatched: false, reason: 'no_email' };
  }
  const normalizedEmail = email.toLowerCase().trim();

  const user = await findUserForReset(email);
  if (!user) {
    // Redacted per the DPDP no-PII-in-logs stance; enough to spot abuse waves.
    log.info('password_reset_request_unknown_email', {
      email: redactEmail(normalizedEmail),
    });
    return { dispatched: false, reason: 'unknown_account' };
  }

  if (!user.is_active || user.account_closed_at || user.erased_at) {
    // Closed/erased/deactivated accounts silently receive nothing — a reset
    // link must never be a side door past an access-termination decision.
    log.info('password_reset_request_ineligible_account', { userId: user.id });
    return { dispatched: false, reason: 'ineligible_account' };
  }

  const rawToken = await issueToken({ userId: user.id, ipAddress, userAgent });
  const resetUrl = buildResetUrl(rawToken);
  const { html, text } = renderResetEmail({
    name: user.name,
    resetUrl,
    oauthProvider: user.oauth_provider || null,
  });

  try {
    const result = await sendMail({
      to: user.email,
      subject: 'Reset your Acureal password',
      html,
      text,
    });
    log.info('password_reset_email_dispatched', {
      userId: user.id,
      provider: result.provider,
      messageId: result.id,
    });
  } catch (error) {
    log.error('password_reset_email_failed', error, { userId: user.id });
    throw createError(
      'We could not send the password reset email. Please try again in a moment.',
      502
    );
  }

  // First real caller of the security-event register — fail-open by design.
  securityEvents.recordEvent({
    eventType: 'password_reset_requested',
    severity: 'low',
    summary: 'Password reset link requested and dispatched',
    actorId: user.id,
  });

  return { dispatched: true };
};

/**
 * The confirm leg: consume a raw token + set the new password.
 *
 * Atomic — token consumption, the password write, session revocation, and the
 * lockout clear all commit or roll back together. Errors are intentionally
 * vague (one message for unknown/consumed/expired).
 */
const confirmReset = async (rawToken, newPassword) => {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) {
    throw createError(INVALID_LINK_MESSAGE, 400);
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    // The route validator is the real gate; this is defense in depth.
    throw createError('New password must be at least 8 characters.', 400);
  }

  // Breach check + bcrypt BEFORE the transaction — one is a network call, the
  // other ~100ms of CPU; neither belongs inside an open transaction holding a
  // FOR UPDATE row lock. Same message as every other set-password path.
  const breach = await isPasswordBreached(newPassword);
  if (breach.breached) {
    throw createError(
      'This password has appeared in known data breaches and cannot be used. Please choose a stronger, unique password.',
      400
    );
  }
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const tokenHash = sha256Hex(rawToken);

  const outcome = await transaction(async (client) => {
    const tokenResult = await client.query(
      `SELECT id, user_id, expires_at, consumed_at
         FROM public.password_reset_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash]
    );
    if (tokenResult.rowCount === 0) {
      throw createError(INVALID_LINK_MESSAGE, 400);
    }
    const row = tokenResult.rows[0];
    if (row.consumed_at) {
      throw createError(INVALID_LINK_MESSAGE, 400);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw createError(INVALID_LINK_MESSAGE, 400);
    }

    // M1 Phase 2: this route is PUBLIC (no JWT) — the request context is
    // empty, so under a non-bypass role users_self_update would match zero
    // rows and the reset would silently no-op. The validated token row pins
    // the user; stamp the transaction-local context (SET LOCAL semantics —
    // discarded at COMMIT). Same pattern, same reason, as
    // emailVerification.confirmToken.
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [String(row.user_id)]
    );

    await client.query(
      `UPDATE public.password_reset_tokens
          SET consumed_at = NOW(), consumed_by = 'reset'
        WHERE id = $1`,
      [row.id]
    );

    // password_set = TRUE deliberately: for a Google-only account this IS
    // "set first password" (possession of the inbox is the proof); for a
    // password account it's a plain overwrite. RETURNING + rowCount makes a
    // zero-row RLS miss fail LOUD instead of reporting success.
    //
    // ELIGIBILITY IS RE-ASSERTED HERE, not just at issue time. requestReset
    // refuses to issue for a closed/erased/deactivated account, but a token
    // minted while the account was healthy stayed usable for its full 60-minute
    // window across a closure — rewriting the credentials and wiping the
    // lockout history of an account that access-termination had frozen. This is
    // the #1091 defect class (termination failing to close an auth path), so it
    // is closed read-time and default-deny: an out-of-band closure the write
    // path never saw is still caught. Zero rows → the same vague link error
    // (which also retires the one non-generic 404 on this leg), and because the
    // transaction rolls back, the token is NOT consumed and neither the session
    // revocation nor the lockout wipe below ever runs.
    const userResult = await client.query(
      `UPDATE public.users
          SET password_hash = $2, password_set = TRUE, updated_at = NOW()
        WHERE id = $1
          AND is_active = TRUE
          AND account_closed_at IS NULL
          AND erased_at IS NULL
        RETURNING id, email`,
      [row.user_id, newHash]
    );
    if (userResult.rowCount === 0) {
      throw createError(INVALID_LINK_MESSAGE, 400);
    }
    const userEmail = userResult.rows[0].email;

    // Sign out everywhere, atomically with the password write. If the reset
    // exists because the account was compromised, the attacker's sessions
    // must not outlive it. (The change-password path revokes with a
    // current-session carve-out; here there IS no current session.)
    await client.query(
      `UPDATE public.refresh_token_grants
          SET revoked_at = NOW(), revoked_reason = 'password_reset'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id]
    );

    // Clear any login lockout — the failed attempts that locked the account
    // may well belong to the attacker who forced this reset; the legitimate
    // owner must be able to sign in immediately with the new password.
    //
    // Keyed on BOTH stored shapes: login throttles on the canonical address
    // while users.email may be the dotted gmail form, so clearing only the
    // stored value would leave a dotted-gmail account still locked out
    // immediately after a successful recovery.
    await client.query(
      `DELETE FROM login_attempts WHERE email = ANY($1::text[])`,
      [[...new Set([userEmail, canonicalEmail(userEmail)])]]
    );

    return { userId: row.user_id, email: userEmail };
  });

  log.info('password_reset_completed', { userId: outcome.userId });
  securityEvents.recordEvent({
    eventType: 'password_reset_completed',
    severity: 'low',
    summary: 'Password reset completed via emailed link; all sessions revoked',
    actorId: outcome.userId,
  });

  return outcome;
};

module.exports = {
  TOKEN_TTL_MINUTES,
  MAX_REQUESTS_PER_HOUR,
  sha256Hex,
  generateRawToken,
  buildResetUrl,
  issueToken,
  requestReset,
  confirmReset,
};
