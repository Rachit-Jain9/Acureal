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
const { REFRESH_TTL_SECONDS } = require('../lib/cookies');

const TOKEN_BYTES = 32;

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
const issueFamily = async ({ userId, ipAddress = null, userAgent = null }, client = null) => {
  if (!userId) throw createError('userId required to issue refresh family.', 400);

  const exec = client ? client.query.bind(client) : query;
  const rawToken = generateRawToken();
  const tokenHash = sha256Hex(rawToken);
  const familyId = crypto.randomUUID();

  const result = await exec(
    `INSERT INTO public.refresh_token_grants
       (user_id, family_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5::inet, $6)
     RETURNING id`,
    [userId, familyId, tokenHash, REFRESH_TTL_SECONDS, ipAddress, userAgent]
  );

  return { rawToken, familyId, grantId: result.rows[0].id };
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
      `SELECT id, user_id, family_id, expires_at, revoked_at, revoked_reason
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

    // Reuse detection — the dangerous case.
    // If a grant has already been rotated (`revoked_reason='rotated'`) and
    // the same raw token is presented again, an attacker likely captured it
    // between the legitimate rotate and this replay. Burn the entire family
    // so neither side can keep going — legitimate user gets kicked to login,
    // attacker loses access.
    if (grant.revoked_at && grant.revoked_reason === 'rotated') {
      await client.query(
        `UPDATE public.refresh_token_grants
            SET revoked_at = COALESCE(revoked_at, NOW()),
                revoked_reason = COALESCE(revoked_reason, 'reuse')
          WHERE family_id = $1`,
        [grant.family_id]
      );
      throw createError('Session expired. Please sign in again.', 401);
    }

    if (grant.revoked_at) {
      // Logged out, force-revoked, or any other terminal reason.
      throw createError('Invalid or expired refresh token.', 401);
    }

    if (new Date(grant.expires_at).getTime() < Date.now()) {
      throw createError('Invalid or expired refresh token.', 401);
    }

    // Mint the new grant inside the same family.
    const newRawToken = generateRawToken();
    const newTokenHash = sha256Hex(newRawToken);

    const inserted = await client.query(
      `INSERT INTO public.refresh_token_grants
         (user_id, family_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5::inet, $6)
       RETURNING id`,
      [grant.user_id, grant.family_id, newTokenHash, REFRESH_TTL_SECONDS, ipAddress, userAgent]
    );

    // Revoke the source as 'rotated' and link replaced_by.
    await client.query(
      `UPDATE public.refresh_token_grants
          SET revoked_at = NOW(),
              revoked_reason = 'rotated',
              replaced_by = $2
        WHERE id = $1`,
      [grant.id, inserted.rows[0].id]
    );

    return {
      rawToken: newRawToken,
      userId: grant.user_id,
      familyId: grant.family_id,
      grantId: inserted.rows[0].id,
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
