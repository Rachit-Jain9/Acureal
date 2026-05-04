'use strict';

/**
 * Retention sweep — daily housekeeping that enforces the data-retention
 * promises made in Privacy Policy §7 and DPDP Act 2023 §8(7) ("erase
 * personal data once the purpose is fulfilled and no statutory retention
 * applies").
 *
 * Runs once per day via Vercel cron (see vercel.json). All deletes are
 * idempotent — if a sweep is missed, the next day's run picks up the
 * accumulated backlog. None of these operations touch user-authored content
 * (deal documents, evidence facts, deal_events). Those are user-controlled
 * and live by deal lifecycle, not by a cron.
 *
 * Tables swept:
 *   1. ai_response_cache         — TTL is on `expires_at` (90-day default
 *                                  set by 20260509 migration). Purge once
 *                                  expired; the row is no longer servable.
 *   2. refresh_token_grants      — Forensic window of 90 days past
 *                                  `expires_at` per the 20260507 migration's
 *                                  comment. Beyond that the row is unusable
 *                                  AND too stale to investigate.
 *   3. login_attempts            — Used by the throttle middleware. Rows
 *                                  older than 30 days with no active lock
 *                                  carry no signal — drop them so the table
 *                                  stays small.
 *   4. ai_call_logs              — Privacy Policy §7 commits to 12-month
 *                                  retention. The `cost_usd` rollup tables
 *                                  (when added) take over the long-term
 *                                  cost-history role.
 *
 * Each step is wrapped in its own try/catch so a single failing query does
 * NOT abort the rest of the sweep. The summary returned to the cron caller
 * (and emitted to logs) reports per-table counts plus errors per table, so
 * a quietly-failing cleanup is visible in Vercel logs without spelunking.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'retention.sweep' });

// Configurable per env so we can shorten in dev / lengthen for an
// enterprise contract that requires 24-month AI logs.
const AI_CALL_LOGS_RETENTION_DAYS = Number(
  process.env.AI_CALL_LOGS_RETENTION_DAYS || 365,
);
const REFRESH_TOKEN_FORENSIC_DAYS = Number(
  process.env.REFRESH_TOKEN_FORENSIC_DAYS || 90,
);
const LOGIN_ATTEMPTS_RETENTION_DAYS = Number(
  process.env.LOGIN_ATTEMPTS_RETENTION_DAYS || 30,
);

const purgeAiResponseCache = async () => {
  try {
    const result = await query(
      `DELETE FROM public.ai_response_cache
        WHERE expires_at < NOW()
        RETURNING id`,
    );
    return { rows_purged: result.rowCount || 0 };
  } catch (error) {
    log.warn('ai_response_cache_purge_failed', { error: error.message });
    return { rows_purged: 0, error: error.message };
  }
};

const purgeRefreshTokenGrants = async () => {
  try {
    // Past expiry + forensic window. Family-revocation forensics need the
    // ability to walk the `replaced_by` chain back to the original login;
    // 90 days past expiry is more than enough for any plausible incident
    // post-mortem. After that the rows are dead weight.
    const result = await query(
      `DELETE FROM public.refresh_token_grants
        WHERE expires_at < NOW() - ($1 || ' days')::interval
        RETURNING id`,
      [REFRESH_TOKEN_FORENSIC_DAYS],
    );
    return {
      rows_purged: result.rowCount || 0,
      forensic_window_days: REFRESH_TOKEN_FORENSIC_DAYS,
    };
  } catch (error) {
    log.warn('refresh_token_grants_purge_failed', { error: error.message });
    return { rows_purged: 0, error: error.message };
  }
};

const purgeLoginAttempts = async () => {
  try {
    // Drop rows where the last failure is old AND there is no active lock.
    // Active locks are kept regardless of age — they're operational state,
    // not history.
    const result = await query(
      `DELETE FROM public.login_attempts
        WHERE last_failed_at < NOW() - ($1 || ' days')::interval
          AND (locked_until IS NULL OR locked_until < NOW())
        RETURNING email`,
      [LOGIN_ATTEMPTS_RETENTION_DAYS],
    );
    return {
      rows_purged: result.rowCount || 0,
      retention_days: LOGIN_ATTEMPTS_RETENTION_DAYS,
    };
  } catch (error) {
    log.warn('login_attempts_purge_failed', { error: error.message });
    return { rows_purged: 0, error: error.message };
  }
};

const purgeAiCallLogs = async () => {
  try {
    // Privacy Policy §7 — "AI call logs: 12 months for cost reconciliation
    // and audit." Deletes on a rolling window. Rolled-up cost summaries
    // (when introduced) live elsewhere and survive this sweep.
    const result = await query(
      `DELETE FROM public.ai_call_logs
        WHERE created_at < NOW() - ($1 || ' days')::interval
        RETURNING id`,
      [AI_CALL_LOGS_RETENTION_DAYS],
    );
    return {
      rows_purged: result.rowCount || 0,
      retention_days: AI_CALL_LOGS_RETENTION_DAYS,
    };
  } catch (error) {
    log.warn('ai_call_logs_purge_failed', { error: error.message });
    return { rows_purged: 0, error: error.message };
  }
};

const runSweep = async () => {
  const start = Date.now();
  const [aiCache, refreshTokens, loginAttempts, aiCallLogs] = await Promise.all([
    purgeAiResponseCache(),
    purgeRefreshTokenGrants(),
    purgeLoginAttempts(),
    purgeAiCallLogs(),
  ]);

  const summary = {
    ai_response_cache: aiCache,
    refresh_token_grants: refreshTokens,
    login_attempts: loginAttempts,
    ai_call_logs: aiCallLogs,
    total_rows_purged:
      (aiCache.rows_purged || 0) +
      (refreshTokens.rows_purged || 0) +
      (loginAttempts.rows_purged || 0) +
      (aiCallLogs.rows_purged || 0),
    duration_ms: Date.now() - start,
  };

  // Surface anything that errored so a quiet cron failure isn't invisible.
  const errors = [aiCache, refreshTokens, loginAttempts, aiCallLogs]
    .filter((r) => r.error)
    .map((r) => r.error);

  if (errors.length > 0) {
    log.warn('retention_sweep_partial', { ...summary, errors });
  } else {
    log.info('retention_sweep_completed', summary);
  }

  return summary;
};

module.exports = {
  runSweep,
  // Exported for tests
  purgeAiResponseCache,
  purgeRefreshTokenGrants,
  purgeLoginAttempts,
  purgeAiCallLogs,
};
