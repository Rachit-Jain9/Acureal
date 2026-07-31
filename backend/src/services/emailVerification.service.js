'use strict';

/**
 * Email verification service.
 *
 * Token model:
 *   - 32 random bytes encoded base64url. The raw token is returned to the
 *     caller exactly once (so the route handler can email it). Only the
 *     SHA-256 hash is persisted; an attacker with read access to the DB
 *     cannot impersonate a verification.
 *   - One active token per user. Re-requesting verification supersedes any
 *     prior unconsumed tokens (consumed_by = 'superseded').
 *   - 24-hour expiry. Hard-coded; if a user delays past that, they request
 *     a fresh link.
 *   - One-shot. Once consumed_at is set, the token cannot be reused.
 *
 * Throttle:
 *   - At most 5 active+pending tokens issued in a 60-minute window per user.
 *     Beyond that, returns 429. This is layered on top of the existing
 *     express-rate-limit (20 req / 15 min / IP) so a single attacker IP
 *     cannot drown the user's inbox even across rotating accounts.
 */

const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { sendMail } = require('../lib/mailer');
const log = require('../lib/logger').child({ module: 'email_verification' });

const TOKEN_BYTES = 32;
const TOKEN_TTL_HOURS = 24;
const MAX_REQUESTS_PER_HOUR = 5;

const sha256Hex = (text) =>
  crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const generateRawToken = () =>
  crypto.randomBytes(TOKEN_BYTES).toString('base64url');

// Production OR any Vercel deployment — a preview that emails a localhost link
// is just as broken as production doing it.
const isDeployed = () => process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const buildVerificationUrl = (rawToken) => {
  // SECURITY/UX: fail CLOSED when deployed. The localhost default is a dev
  // convenience, but on a deploy it produces the worst kind of failure — the
  // send SUCCEEDS, the user receives a well-formed email, and the link is dead
  // (ERR_CONNECTION_REFUSED). Nothing errors, nothing is logged, and the
  // account can never be verified. Refuse to build the link instead; the
  // caller surfaces a retryable failure and the operator sees a real error.
  if (isDeployed() && !process.env.APP_BASE_URL) {
    throw new Error(
      'APP_BASE_URL is not configured — refusing to send a verification email whose link would point at localhost.'
    );
  }
  const base = process.env.APP_BASE_URL || 'http://localhost:5173';
  const url = new URL('/verify-email', base);
  url.searchParams.set('token', rawToken);
  return url.toString();
};

const renderVerificationEmail = ({ name, verificationUrl }) => {
  const safeName = (name || 'there').replace(/[<>]/g, '');
  const html = `
    <div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h1 style="font-size: 18px; margin-bottom: 16px;">Verify your Acureal email</h1>
      <p>Hi ${safeName},</p>
      <p>Click the button below to confirm this is your email address. The link expires in 24 hours.</p>
      <p style="margin: 24px 0;">
        <a href="${verificationUrl}"
           style="display: inline-block; padding: 10px 18px; background: #1E6FD0; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          Verify email
        </a>
      </p>
      <p style="font-size: 13px; color: #6b7280;">
        If the button doesn't work, paste this URL into your browser:<br/>
        <span style="word-break: break-all;">${verificationUrl}</span>
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
        You're receiving this because someone — likely you — created an Acureal account
        with this email. If you didn't, ignore this message; the link is unusable
        without your password.
      </p>
    </div>
  `;
  const text = `Verify your Acureal email\n\nHi ${safeName},\n\nOpen this link to confirm your email (expires in 24 hours):\n${verificationUrl}\n\nIf you didn't sign up for Acureal, ignore this message.`;
  return { html, text };
};

const enforceRequestThrottle = async (userId, client = null) => {
  const exec = client ? client.query.bind(client) : query;
  const result = await exec(
    `SELECT COUNT(*)::int AS recent
       FROM public.email_verification_tokens
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  if (result.rows[0].recent >= MAX_REQUESTS_PER_HOUR) {
    throw createError(
      'Too many verification emails requested. Please wait an hour before trying again.',
      429
    );
  }
};

/**
 * Issue a fresh verification token for a user. Idempotent in the sense that
 * any prior unconsumed token for the same user is marked superseded; only
 * the newly-returned raw token is valid afterwards.
 *
 * Returns the raw token so the caller can email it. Never log the raw token.
 */
const issueToken = async (
  { userId, ipAddress = null, userAgent = null },
  client = null
) => {
  if (!userId) throw createError('userId required to issue verification token.', 400);

  const exec = client ? client.query.bind(client) : query;

  await enforceRequestThrottle(userId, client);

  const rawToken = generateRawToken();
  const tokenHash = sha256Hex(rawToken);

  // Supersede any prior unconsumed tokens for this user.
  await exec(
    `UPDATE public.email_verification_tokens
        SET consumed_at = NOW(), consumed_by = 'superseded'
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId]
  );

  await exec(
    `INSERT INTO public.email_verification_tokens
       (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, NOW() + ($3 || ' hours')::INTERVAL, $4::inet, $5)`,
    [userId, tokenHash, TOKEN_TTL_HOURS, ipAddress, userAgent]
  );

  return rawToken;
};

/**
 * Send a verification email for the given user. Wraps issueToken + mailer.
 * Returns { delivered: boolean, provider: string, messageId: string|null }.
 */
const sendVerificationEmail = async ({ userId, email, name, ipAddress, userAgent }) => {
  if (!email) throw createError('email required to send verification email.', 400);

  const rawToken = await issueToken({ userId, ipAddress, userAgent });
  const verificationUrl = buildVerificationUrl(rawToken);
  const { html, text } = renderVerificationEmail({ name, verificationUrl });

  try {
    const result = await sendMail({
      to: email,
      subject: 'Verify your Acureal email',
      html,
      text,
    });
    log.info('verification_email_dispatched', {
      userId,
      provider: result.provider,
      messageId: result.id,
    });
    return { delivered: true, provider: result.provider, messageId: result.id };
  } catch (error) {
    log.error('verification_email_failed', error, { userId });
    throw createError(
      'We could not send the verification email. Please try again in a moment.',
      502
    );
  }
};

/**
 * Confirm a raw verification token. On success: marks the token consumed and
 * sets users.email_verified_at = NOW(). Returns { userId, alreadyVerified }.
 *
 * Errors are intentionally vague ("Invalid or expired") to avoid revealing
 * which side of the check failed (token unknown vs expired vs consumed).
 */
const confirmToken = async (rawToken) => {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) {
    throw createError('Invalid or expired verification link.', 400);
  }
  const tokenHash = sha256Hex(rawToken);

  return transaction(async (client) => {
    const tokenResult = await client.query(
      `SELECT id, user_id, expires_at, consumed_at
         FROM public.email_verification_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash]
    );
    if (tokenResult.rowCount === 0) {
      throw createError('Invalid or expired verification link.', 400);
    }
    const row = tokenResult.rows[0];
    if (row.consumed_at) {
      throw createError('Invalid or expired verification link.', 400);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw createError('Invalid or expired verification link.', 400);
    }

    // M1 Phase 2: this route is PUBLIC (no JWT) — the request context is
    // empty, so under a non-bypass role users_self_update would match zero
    // rows and the verification would silently no-op. The validated token row
    // pins the user; stamp the transaction-local context (SET LOCAL semantics
    // — discarded at COMMIT, and the AsyncLocalStorage path can't help here
    // because this transaction's set_config already ran at BEGIN). A pure
    // no-op under the current bypass role.
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [String(row.user_id)]
    );

    await client.query(
      `UPDATE public.email_verification_tokens
          SET consumed_at = NOW(), consumed_by = 'verified'
        WHERE id = $1`,
      [row.id]
    );

    const userResult = await client.query(
      `UPDATE public.users
          SET email_verified_at = COALESCE(email_verified_at, NOW()),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, email_verified_at`,
      [row.user_id]
    );
    if (userResult.rowCount === 0) {
      throw createError('Account not found.', 404);
    }

    return {
      userId: row.user_id,
      alreadyVerified: false,
      email: userResult.rows[0].email,
      verifiedAt: userResult.rows[0].email_verified_at,
    };
  });
};

const getVerificationStatus = async (userId) => {
  const result = await query(
    `SELECT email, email_verified_at FROM public.users WHERE id = $1`,
    [userId]
  );
  if (result.rowCount === 0) {
    throw createError('Account not found.', 404);
  }
  return {
    email: result.rows[0].email,
    verified: Boolean(result.rows[0].email_verified_at),
    verifiedAt: result.rows[0].email_verified_at,
  };
};

module.exports = {
  TOKEN_TTL_HOURS,
  MAX_REQUESTS_PER_HOUR,
  sha256Hex,
  generateRawToken,
  buildVerificationUrl,
  issueToken,
  sendVerificationEmail,
  confirmToken,
  getVerificationStatus,
};
