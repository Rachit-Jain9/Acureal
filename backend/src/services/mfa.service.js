'use strict';

/**
 * MFA / TOTP service. RFC 6238 via otplib + QR code via qrcode.
 *
 * Lifecycle:
 *   1. beginEnrollment(userId, email)
 *      • Generates a fresh base32 secret + recovery codes
 *      • Stores secret on the user row but DOES NOT set mfa_enrolled_at
 *        (enrollment is pending until verifyEnrollment succeeds)
 *      • Returns { secret, otpauthUrl, qrDataUrl, recoveryCodes }
 *   2. verifyEnrollment(userId, totpCode)
 *      • Validates the user-entered code against the stored secret
 *      • Sets mfa_enrolled_at = NOW(); MFA is now enforced for this user
 *   3. issueChallenge(userId)
 *      • After password / OAuth success, issues a short-lived (5-min)
 *        challenge ticket. Used so the SPA can carry context between
 *        login and verify-mfa without re-sending the password.
 *   4. verifyChallenge({ challenge, code })
 *      • Validates the TOTP code (or matches a recovery code) against
 *        the user identified by the challenge. Marks the challenge
 *        consumed, updates mfa_last_used_at, returns the user_id.
 *   5. disable(userId)
 *      • Wipes mfa_secret, mfa_enrolled_at, mfa_recovery_codes. Used
 *        from Settings → Security or by an admin recovery flow.
 *
 * Recovery codes:
 *   • 8 codes generated at enrollment, each `xxxx-xxxx-xxxx` (12 chars)
 *   • Stored hashed (sha256) — never readable from the DB
 *   • Single-use: a redeemed code is removed from the array
 */

const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { query } = require('../config/database');
const { setRequestContext } = require('../lib/requestContext');
const { requireDefinerPath } = require('../lib/authDefiners');
const log = require('../lib/logger').child({ module: 'mfa' });

// Standard window (±1 step = ±30s) — covers clock skew without enabling
// brute-force code guessing meaningfully (10⁶ space is the protection).
authenticator.options = { window: 1 };

const ISSUER = 'Acureal';
const CHALLENGE_TTL_MINUTES = 5;
const RECOVERY_CODE_COUNT = 8;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const generateRecoveryCodes = () => {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    // 12 char `xxxx-xxxx-xxxx` — readable but high-entropy (16⁹ = ~6.9×10¹⁰).
    const raw = crypto.randomBytes(6).toString('hex'); // 12 hex chars
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
};

const beginEnrollment = async (userId, email) => {
  if (!userId) throw new Error('beginEnrollment: userId required');

  // If MFA is already enrolled, refuse — the disable+re-enroll flow is
  // explicit so a hostile takeover can't silently rotate the secret.
  const existing = await query(
    'SELECT mfa_enrolled_at FROM users WHERE id = $1',
    [userId],
  );
  if (existing.rows[0]?.mfa_enrolled_at) {
    const err = new Error('MFA is already enabled. Disable it first to re-enroll.');
    err.statusCode = 409;
    throw err;
  }

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email || 'user', ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  const recoveryCodes = generateRecoveryCodes();
  const hashedCodes = recoveryCodes.map(sha256);

  await query(
    `UPDATE users
        SET mfa_secret = $2,
            mfa_recovery_codes = $3,
            mfa_enrolled_at = NULL
      WHERE id = $1`,
    [userId, secret, hashedCodes],
  );

  return { secret, otpauthUrl, qrDataUrl, recoveryCodes };
};

const verifyEnrollment = async (userId, code) => {
  if (!userId || !code) {
    const err = new Error('userId and code are required.');
    err.statusCode = 400;
    throw err;
  }
  const result = await query(
    'SELECT mfa_secret, mfa_enrolled_at FROM users WHERE id = $1',
    [userId],
  );
  const row = result.rows[0];
  if (!row || !row.mfa_secret) {
    const err = new Error('Enrollment not started. Begin enrollment first.');
    err.statusCode = 409;
    throw err;
  }
  if (row.mfa_enrolled_at) {
    return { alreadyEnrolled: true };
  }

  const ok = authenticator.check(String(code).replace(/\s+/g, ''), row.mfa_secret);
  if (!ok) {
    const err = new Error('Invalid authenticator code.');
    err.statusCode = 401;
    throw err;
  }

  await query(
    `UPDATE users SET mfa_enrolled_at = NOW(), mfa_last_used_at = NOW() WHERE id = $1`,
    [userId],
  );
  log.info('mfa_enrolled', { user_id: userId });
  return { enrolledAt: new Date().toISOString() };
};

const isMfaRequired = async (userId) => {
  const result = await query(
    'SELECT mfa_enrolled_at FROM users WHERE id = $1',
    [userId],
  );
  return Boolean(result.rows[0]?.mfa_enrolled_at);
};

const issueChallenge = async (userId) => {
  // 32 bytes of entropy → 64 hex chars; opaque to the SPA. Stored hashed at
  // rest (same pattern as refresh/email-verification tokens) so a DB read
  // can't be replayed into a session; the raw value goes to the SPA once.
  const challenge = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000);
  await query(
    `INSERT INTO mfa_challenges (user_id, challenge, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, sha256(challenge), expiresAt],
  );
  return { challenge, expiresAt: expiresAt.toISOString() };
};

const tryRecoveryCode = async (userId, code) => {
  const cleaned = String(code).trim().toLowerCase();
  if (!cleaned) return false;
  const hashed = sha256(cleaned);
  const result = await query(
    `UPDATE users
        SET mfa_recovery_codes = array_remove(mfa_recovery_codes, $2),
            mfa_last_used_at = NOW()
      WHERE id = $1
        AND $2 = ANY(mfa_recovery_codes)
      RETURNING id`,
    [userId, hashed],
  );
  return result.rowCount > 0;
};

const verifyChallenge = async ({ challenge, code }) => {
  if (!challenge || !code) {
    const err = new Error('challenge and code are required.');
    err.statusCode = 400;
    throw err;
  }
  // M1 Phase 2: the caller holds only a challenge string — no user identity
  // yet, so the JOIN to users (for mfa_secret) is exactly what RLS blocks
  // under a non-bypass role. Definer-routed when available; the fallback is
  // the byte-identical original query. The column stores sha256(challenge),
  // so both branches look up by hash — the definer's plain text-equality
  // WHERE needs no change.
  const challengeHash = sha256(challenge);
  const ticketResult = (await requireDefinerPath())
    ? await query('SELECT * FROM public.auth_find_mfa_challenge($1)', [challengeHash])
    : await query(
        `SELECT mc.id, mc.user_id, mc.expires_at, mc.consumed_at, u.mfa_secret
           FROM mfa_challenges mc
           JOIN users u ON u.id = mc.user_id
          WHERE mc.challenge = $1`,
        [challengeHash],
      );
  const ticket = ticketResult.rows[0];
  if (!ticket) {
    const err = new Error('Invalid or expired challenge.');
    err.statusCode = 401;
    throw err;
  }
  if (ticket.consumed_at) {
    const err = new Error('Challenge already used.');
    err.statusCode = 401;
    throw err;
  }
  if (new Date(ticket.expires_at).getTime() < Date.now()) {
    const err = new Error('Challenge expired. Sign in again.');
    err.statusCode = 401;
    throw err;
  }
  if (!ticket.mfa_secret) {
    const err = new Error('MFA not configured for this account.');
    err.statusCode = 409;
    throw err;
  }

  // M1 Phase 2: the ticket pins the user — stamp the context so the recovery-
  // code reads/writes and the mfa_last_used_at UPDATE below survive a
  // non-bypass role (all guarded by self-scoped users policies).
  setRequestContext({ userId: ticket.user_id });

  const cleaned = String(code).replace(/\s+/g, '');
  const isTotp = /^\d{6}$/.test(cleaned);
  let ok = false;
  if (isTotp) {
    ok = authenticator.check(cleaned, ticket.mfa_secret);
  } else {
    ok = await tryRecoveryCode(ticket.user_id, cleaned);
  }

  if (!ok) {
    const err = new Error('Invalid authenticator code.');
    err.statusCode = 401;
    throw err;
  }

  await query(
    `UPDATE mfa_challenges SET consumed_at = NOW() WHERE id = $1`,
    [ticket.id],
  );
  if (isTotp) {
    await query(
      `UPDATE users SET mfa_last_used_at = NOW() WHERE id = $1`,
      [ticket.user_id],
    );
  }

  return { userId: ticket.user_id, usedRecoveryCode: !isTotp };
};

const disable = async (userId) => {
  await query(
    `UPDATE users
        SET mfa_secret = NULL,
            mfa_enrolled_at = NULL,
            mfa_recovery_codes = NULL,
            mfa_last_used_at = NULL
      WHERE id = $1`,
    [userId],
  );
  await query(
    `UPDATE mfa_challenges
        SET consumed_at = COALESCE(consumed_at, NOW())
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
  log.info('mfa_disabled', { user_id: userId });
  return { disabled: true };
};

const purgeExpiredChallenges = async () => {
  try {
    const result = await query(
      `DELETE FROM mfa_challenges
        WHERE consumed_at IS NOT NULL
           OR expires_at < NOW() - INTERVAL '1 hour'
        RETURNING id`,
    );
    return { rows_purged: result.rowCount || 0 };
  } catch (err) {
    return { rows_purged: 0, error: err.message };
  }
};

module.exports = {
  beginEnrollment,
  verifyEnrollment,
  isMfaRequired,
  issueChallenge,
  verifyChallenge,
  disable,
  purgeExpiredChallenges,
  // Exported for tests
  generateRecoveryCodes,
  RECOVERY_CODE_COUNT,
  CHALLENGE_TTL_MINUTES,
};
