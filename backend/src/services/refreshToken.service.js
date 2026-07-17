'use strict';

/**
 * Refresh-token grants — issuance, rotation, family revocation.
 *
 * Token model (see migration 20260507_refresh_tokens.sql for full rationale):
 *   - 32 random bytes; only the SHA-256 hash is stored.
 *   - Each grant belongs to a `family_id`. Login issues a fresh family.
 *     Refresh issues a new grant in the same family + revokes the old.
 *   - Reuse detection: if a presented token is already revoked, that's the
 *     signal that an attacker rotated AFTER the legitimate user — kill the
 *     entire family. The legitimate holder is forced back to the login
 *     screen at their next refresh attempt.
 *   - 30-day TTL. Logout sets `revoked_at` immediately on every grant in
 *     the family.
 *
 * Errors are intentionally vague to avoid leaking which check failed
 * (unknown / expired / already-revoked).
 */

const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { REFRESH_TTL_SECONDS, SESSION_REFRESH_TTL_SECONDS } = require('../lib/cookies');
const log = require('../lib/logger').child({ module: 'refreshToken' });

const TOKEN_BYTES = 32;

/**
 * Concurrent-refresh grace window.
 *
 * Strict reuse detection treats EVERY re-presentation of a rotated token as
 * theft and burns the whole family. In production that fired on the
 * operator's own browser several times a day: access tokens live 15 minutes,
 * so every open tab 401s at the same moment and races POST /auth/refresh with
 * the same cookie — the in-flight dedupe is per-tab, so tab 2's request
 * (sent before tab 1's Set-Cookie landed) presents the just-rotated token and
 * the "attacker!" branch kills the session. Same story when the browser
 * closes mid-rotation and the new cookie is never received: next launch
 * presents the old token once, family burned, "remember me" apparently broken.
 *
 * Within this window, a rotated token re-presented is treated as what it
 * overwhelmingly is — a concurrent refresh from the same client — and a new
 * grant is minted in the same family. AFTER the window, re-presentation still
 * burns the family (the industry-standard "reuse interval" pattern; Auth0
 * ships the same trade-off). Grace rotations are logged distinctly so the
 * audit trail shows every one.
 */
const ROTATION_GRACE_MS = Math.max(
  5_000,
  parseInt(process.env.REFRESH_ROTATION_GRACE_MS, 10) || 60_000,
);

/** Grant TTL by persistence tier: 30 days remembered, 24 h session-only. */
const ttlSecondsFor = (rememberMe) =>
  (rememberMe === false ? SESSION_REFRESH_TTL_SECONDS : REFRESH_TTL_SECONDS);

const sha256Hex = (text) =>
  crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const generateRawToken = () =>
  crypto.randomBytes(TOKEN_BYTES).toString('base64url');

/**
 * Issue a brand-new refresh-token family for `userId`. Returns
 * { rawToken, familyId, grantId }. The raw token is shown to the caller
 * exactly once — it goes into the httpOnly cookie and is never persisted
 * client-side beyond that.
 */
const issueFamily = async (
  { userId, ipAddress = null, userAgent = null, rememberMe = true },
  client = null,
) => {
  if (!userId) throw createError('userId required to issue refresh family.', 400);

  const exec = client ? client.query.bind(client) : query;
  const rawToken = generateRawToken();
  const tokenHash = sha256Hex(rawToken);
  const familyId = crypto.randomUUID();

  // remember_me rides on the FAMILY (every grant carries it) so that /refresh
  // can re-issue the cookie with the persistence the user chose at sign-in.
  // Without this, the first silent refresh would convert a "sign me out when
  // the browser closes" session into a 30-day persistent one — the exact
  // broken promise the operator reported (in the mirror image).
  const result = await exec(
    `INSERT INTO public.refresh_token_grants
       (user_id, family_id, token_hash, expires_at, ip_address, user_agent, remember_me)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5::inet, $6, $7)
     RETURNING id`,
    [userId, familyId, tokenHash, ttlSecondsFor(rememberMe), ipAddress, userAgent, rememberMe !== false]
  );

  return { rawToken, familyId, grantId: result.rows[0].id, rememberMe: rememberMe !== false };
};

/**
 * Rotate a presented raw refresh token. Returns the new raw token and the
 * userId associated with the family. On reuse detection (token presented
 * twice), revokes the entire family and throws 401.
 *
 * The whole flow runs in one transaction with `FOR UPDATE` on the source
 * row, so two parallel rotates of the same token cannot both succeed.
 */
const rotate = async ({ rawToken, ipAddress = null, userAgent = null }) => {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) {
    throw createError('Invalid or expired refresh token.', 401);
  }
  const tokenHash = sha256Hex(rawToken);

  return transaction(async (client) => {
    const lookup = await client.query(
      `SELECT id, user_id, family_id, expires_at, revoked_at, revoked_reason, remember_me
         FROM public.refresh_token_grants
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash]
    );

    if (lookup.rowCount === 0) {
      // Unknown token — could be tampered, could be very old + cleaned up.
      // Either way, treat as invalid; nothing to revoke.
      throw createError('Invalid or expired refresh token.', 401);
    }

    const grant = lookup.rows[0];
    const rememberMe = grant.remember_me !== false;

    // Mints a fresh grant in this family, carrying the family's persistence
    // tier. Shared by the normal rotation below and the grace branch.
    const mintGrant = async () => {
      const newRawToken = generateRawToken();
      const inserted = await client.query(
        `INSERT INTO public.refresh_token_grants
           (user_id, family_id, token_hash, expires_at, ip_address, user_agent, remember_me)
         VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5::inet, $6, $7)
         RETURNING id`,
        [grant.user_id, grant.family_id, sha256Hex(newRawToken), ttlSecondsFor(rememberMe), ipAddress, userAgent, rememberMe]
      );
      return { newRawToken, newGrantId: inserted.rows[0].id };
    };

    // Re-presentation of an already-rotated token — two very different worlds.
    if (grant.revoked_at && grant.revoked_reason === 'rotated') {
      const rotatedAgoMs = Date.now() - new Date(grant.revoked_at).getTime();

      if (rotatedAgoMs >= 0 && rotatedAgoMs <= ROTATION_GRACE_MS) {
        // CONCURRENT REFRESH, not theft: a second tab racing the same 401
        // storm, or a client that never received the previous rotation's
        // Set-Cookie (browser closed mid-refresh). Mint it a grant of its own
        // in the same family instead of burning the session. Logged
        // distinctly so the audit trail shows every grace rotation.
        const { newRawToken, newGrantId } = await mintGrant();
        log.info('refresh_rotation_grace', {
          family_id: grant.family_id,
          rotated_ago_ms: rotatedAgoMs,
          grace_window_ms: ROTATION_GRACE_MS,
        });
        return {
          rawToken: newRawToken,
          userId: grant.user_id,
          familyId: grant.family_id,
          grantId: newGrantId,
          rememberMe,
        };
      }

      // OUTSIDE the window the original reasoning stands: a long-dead token
      // re-presented is the replay signature. Burn the entire family so
      // neither side can continue — the legitimate user re-authenticates,
      // the holder of the stolen token loses access.
      await client.query(
        `UPDATE public.refresh_token_grants
            SET revoked_at = COALESCE(revoked_at, NOW()),
                revoked_reason = COALESCE(revoked_reason, 'reuse')
          WHERE family_id = $1`,
        [grant.family_id]
      );
      log.warn('refresh_reuse_family_burned', {
        family_id: grant.family_id,
        rotated_ago_ms: rotatedAgoMs,
      });
      throw createError('Session expired. Please sign in again.', 401);
    }

    if (grant.revoked_at) {
      // Logged out, force-revoked, or any other terminal reason.
      throw createError('Invalid or expired refresh token.', 401);
    }

    if (new Date(grant.expires_at).getTime() < Date.now()) {
      throw createError('Invalid or expired refresh token.', 401);
    }

    // Normal rotation: mint the successor, then retire the source.
    const { newRawToken, newGrantId } = await mintGrant();

    await client.query(
      `UPDATE public.refresh_token_grants
          SET revoked_at = NOW(),
              revoked_reason = 'rotated',
              replaced_by = $2
        WHERE id = $1`,
      [grant.id, newGrantId]
    );

    return {
      rawToken: newRawToken,
      userId: grant.user_id,
      familyId: grant.family_id,
      grantId: newGrantId,
      rememberMe,
    };
  });
};

/**
 * Revoke an entire family — used by /logout and by security events
 * (deactivation, password change). Idempotent.
 */
const revokeFamily = async (familyId, reason = 'logout') => {
  if (!familyId) return { revokedCount: 0 };
  const result = await query(
    `UPDATE public.refresh_token_grants
        SET revoked_at = COALESCE(revoked_at, NOW()),
            revoked_reason = COALESCE(revoked_reason, $2)
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason]
  );
  return { revokedCount: result.rowCount };
};

/**
 * Revoke EVERY active grant for a user — used when a user changes
 * password, is deactivated, or requests "sign me out everywhere".
 */
const revokeAllForUser = async (userId, reason = 'security') => {
  if (!userId) return { revokedCount: 0 };
  const result = await query(
    `UPDATE public.refresh_token_grants
        SET revoked_at = NOW(),
            revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason]
  );
  return { revokedCount: result.rowCount };
};

/**
 * Look up the family of a presented raw token without rotating it. Used
 * by /logout so we can revoke the family the cookie belongs to.
 */
const findFamilyByToken = async (rawToken) => {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) {
    return null;
  }
  const tokenHash = sha256Hex(rawToken);
  const result = await query(
    `SELECT family_id, user_id FROM public.refresh_token_grants
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
};

module.exports = {
  sha256Hex,
  generateRawToken,
  issueFamily,
  rotate,
  revokeFamily,
  revokeAllForUser,
  findFamilyByToken,
};
