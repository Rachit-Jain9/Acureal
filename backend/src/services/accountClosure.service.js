'use strict';

/**
 * Account closure + scheduled erasure (DPDP Act 2023 §8(7) enforcement).
 *
 * Two operations:
 *
 *   closeAccount(userId)
 *     • Sets `users.account_closed_at = NOW()` if not already closed.
 *     • Revokes every active refresh-token grant for the user (forced
 *       logout across all devices).
 *     • Returns { closedAt, refreshGrantsRevoked }.
 *     • Access is blocked thereafter by the terminal-state gate in
 *       hydrateUserAuthContext (utils/accountState.js), which sits on EVERY
 *       authenticated path — password login, both Google branches, MFA
 *       completion, refresh-token rotation, and the per-request authenticate
 *       middleware. Closure deliberately does NOT set is_active = false: that
 *       flag means "admin deactivation", a separate and reversible state, and
 *       collapsing the two would let an admin's "reactivate user" click
 *       silently undo a DPDP closure whose erasure clock is still running.
 *       See the header of utils/accountState.js for the full rationale.
 *
 *   eraseClosedAccounts()
 *     • Called by the daily retention sweep cron.
 *     • Finds users with account_closed_at < NOW() - 90 days AND
 *       erased_at IS NULL.
 *     • Anonymizes PII (email, name, phone, password_hash) and sets
 *       erased_at = NOW().
 *     • Row is preserved (not DELETEd) so foreign keys from deals,
 *       deal_events, ai_call_logs, audit log entries, etc. continue to
 *       resolve. This is the standard pseudonymization pattern aligned
 *       with both DPDP §8(7) and GDPR Art. 17.
 *     • Email is replaced with `erased+<userId>@redip.local` so the
 *       UNIQUE index on email keeps holding.
 *     • Returns { rows_erased, errors[] }.
 *
 * The 90-day grace window matches Privacy Policy §7. Override via
 * `ACCOUNT_ERASURE_GRACE_DAYS` env if local dev needs faster turnover.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'account.closure' });

const GRACE_DAYS = Number(process.env.ACCOUNT_ERASURE_GRACE_DAYS || 90);

const closeAccount = async (userId) => {
  if (!userId) throw new Error('closeAccount: userId required');

  // Set the closure timestamp idempotently — re-closing a closed account is
  // a no-op (the timestamp doesn't refresh). This matches the spec: 90-day
  // window starts at the FIRST close, not whichever was most recent.
  const result = await query(
    `UPDATE users
        SET account_closed_at = COALESCE(account_closed_at, NOW())
      WHERE id = $1
        AND erased_at IS NULL
      RETURNING id, account_closed_at, email`,
    [userId],
  );

  if (result.rowCount === 0) {
    // Either user doesn't exist or already erased. Treat as terminal —
    // erased accounts cannot be re-closed.
    throw new Error('Account not found or already erased.');
  }

  // Revoke all active refresh tokens so every device is forced to log out
  // immediately. The login block in auth.service prevents re-auth.
  let revoked = 0;
  try {
    const revokeResult = await query(
      `UPDATE refresh_token_grants
          SET revoked_at = NOW(), revoked_reason = 'account_closure'
        WHERE user_id = $1
          AND revoked_at IS NULL`,
      [userId],
    );
    revoked = revokeResult.rowCount || 0;
  } catch (err) {
    // Refresh-token table is non-critical to closure. Log + continue —
    // session JWT (15-min expiry) drops the user anyway.
    log.warn('refresh_grants_revoke_failed_on_closure', { user_id: userId, error: err.message });
  }

  log.info('account_closed', {
    user_id: userId,
    closed_at: result.rows[0].account_closed_at,
    refresh_grants_revoked: revoked,
  });

  return {
    closedAt: result.rows[0].account_closed_at,
    refreshGrantsRevoked: revoked,
  };
};

// Erasure replaces PII fields with stable, non-identifying placeholders.
// Email is keyed on user id to keep the UNIQUE constraint intact even with
// many erased users. Password hash is set to NULL so the row cannot
// authenticate even if the closure block is bypassed somehow.
const eraseClosedAccounts = async () => {
  try {
    // NOTE (2026-07-17): `email_normalized` was removed from this UPDATE. That
    // column exists NOWHERE — no migration creates it, no code path reads it
    // (login normalises `email.toLowerCase()` inline against the plain `email`
    // column; DSAR export never touches it). The write therefore threw
    // "column email_normalized does not exist" on EVERY run since this service
    // shipped, logging a red Database-query-error to the dashboard and burning
    // a doomed transaction before the try/catch fallback re-ran the correct
    // query. Erasure still completed via that fallback, so no obligation was
    // missed — but the primary path was dead on arrival. This IS that
    // fallback, promoted to the only query. If a normalized-email column is
    // ever introduced, add it back here AND ship the migration in the same PR.
    const result = await query(
      `UPDATE users
          SET email = 'erased+' || id::text || '@redip.local',
              name = 'Erased User',
              phone = NULL,
              password_hash = NULL,
              erased_at = NOW()
        WHERE account_closed_at IS NOT NULL
          AND erased_at IS NULL
          AND account_closed_at < NOW() - ($1 || ' days')::interval
        RETURNING id`,
      [GRACE_DAYS],
    );
    const rowsErased = result.rowCount || 0;
    if (rowsErased > 0) {
      // Belt-and-braces: closure already revoked every grant 90 days ago, and
      // no path can mint a new one for a closed account. This sweeps grants
      // that predate the closure revocation or were created out-of-band (an
      // operator SQL closure that skipped closeAccount(), a restored backup).
      // Erasure is the terminal state — nothing may hold a live grant past it.
      try {
        const revoked = await query(
          `UPDATE refresh_token_grants
              SET revoked_at = NOW(), revoked_reason = 'account_erasure'
            WHERE user_id = ANY($1::uuid[])
              AND revoked_at IS NULL`,
          [result.rows.map((r) => r.id)],
        );
        if (revoked.rowCount > 0) {
          // Non-zero here means a grant survived closure — worth knowing about,
          // because it implies a closure that bypassed closeAccount().
          log.warn('erasure_revoked_surviving_grants', { count: revoked.rowCount });
        }
      } catch (err) {
        log.warn('erasure_grant_revoke_failed', { error: err.message });
      }

      log.info('accounts_erased', {
        rows_erased: rowsErased,
        grace_days: GRACE_DAYS,
        ids: result.rows.map((r) => r.id),
      });
    }
    return { rows_erased: rowsErased, grace_days: GRACE_DAYS };
  } catch (err) {
    // A real erasure failure (not the phantom column) must be loud but must
    // not crash the retention cron — it retries on the next run.
    log.warn('account_erasure_failed', { error: err.message });
    return { rows_erased: 0, error: err.message };
  }
};

const getClosureStatus = async (userId) => {
  if (!userId) return null;
  try {
    const result = await query(
      `SELECT account_closed_at, erased_at FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0] || null;
  } catch (err) {
    log.warn('closure_status_fetch_failed', { error: err.message });
    return null;
  }
};

module.exports = {
  closeAccount,
  eraseClosedAccounts,
  getClosureStatus,
  GRACE_DAYS,
};
