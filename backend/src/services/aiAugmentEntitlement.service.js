'use strict';

/**
 * AI augment entitlement check + usage recording (PR-NX69).
 *
 * BETA stage rule (set by operator 2026-05-19):
 *   - Every user gets ONE free AI-augmented underwriting report.
 *   - Admins (role='admin' or 'owner') get unlimited.
 *   - When a user exhausts their free report, the augment layer is skipped
 *     and the DOCX renderer shows a "Premium AI Insights — Quota Exceeded"
 *     message instead of the generic "Manual input required" placeholder.
 *
 * Counter semantics:
 *   - Persisted as `users.ai_augment_reports_used` (added by migration
 *     20260604_ai_augment_usage_quota.sql).
 *   - Incremented in dealExport.service.getDealExportContext() ONLY after the
 *     augment call returned at least one available:true envelope. If Claude
 *     is down and every section returned unavailable, the user is NOT charged.
 *   - Persisted alongside `users.ai_augment_last_used_at` for the operator
 *     usage dashboard.
 *
 * Future-proofing:
 *   - `BETA_FREE_LIMIT` constant — bumped to 3 / 5 / etc. as we tune.
 *   - The `quota_exceeded` reason string is read by the DOCX renderer to
 *     emit a specific message — don't change without updating the renderer.
 *   - Per-org entitlement / monthly resets / credits — explicitly out of
 *     scope for BETA. When the time comes, swap the counter column for a
 *     dedicated table.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'aiAugmentEntitlement' });

const BETA_FREE_LIMIT = 1;

const ADMIN_ROLES = new Set(['admin', 'owner']);

/**
 * Check whether the supplied user is allowed to consume a fresh AI augment
 * for an underwriting export. Returns:
 *   { allowed: true,  unlimited: true,  reason: 'admin' }              // admin / owner
 *   { allowed: true,  unlimited: false, reason: 'under_limit', remaining }
 *   { allowed: false, unlimited: false, reason: 'quota_exceeded', limit, used }
 *   { allowed: false, unlimited: false, reason: 'unauthenticated' }    // no userId
 *   { allowed: false, unlimited: false, reason: 'user_not_found' }
 *
 * Never throws — every error path returns a deny envelope so the caller
 * (export pipeline) can fall through to the existing placeholder cleanly.
 *
 * The augment layer is a soft enhancement; never block the export itself.
 */
const checkEntitlement = async ({ userId, userRole } = {}) => {
  // Admin / owner bypass — short-circuit before any DB read.
  if (userRole && ADMIN_ROLES.has(String(userRole).toLowerCase())) {
    return { allowed: true, unlimited: true, reason: 'admin', limit: null, used: null };
  }

  if (!userId) {
    return { allowed: false, unlimited: false, reason: 'unauthenticated', limit: BETA_FREE_LIMIT, used: null };
  }

  try {
    const result = await query(
      'SELECT id, role, ai_augment_reports_used FROM users WHERE id = $1 LIMIT 1',
      [userId],
    );
    if (!result.rows.length) {
      return { allowed: false, unlimited: false, reason: 'user_not_found', limit: BETA_FREE_LIMIT, used: null };
    }
    const row = result.rows[0];
    // Defensive admin re-check from DB in case the route-layer role differs
    // (e.g. role was demoted but the JWT hasn't refreshed yet).
    if (row.role && ADMIN_ROLES.has(String(row.role).toLowerCase())) {
      return { allowed: true, unlimited: true, reason: 'admin', limit: null, used: Number(row.ai_augment_reports_used) || 0 };
    }
    const used = Number(row.ai_augment_reports_used) || 0;
    if (used < BETA_FREE_LIMIT) {
      return {
        allowed: true,
        unlimited: false,
        reason: 'under_limit',
        limit: BETA_FREE_LIMIT,
        used,
        remaining: BETA_FREE_LIMIT - used,
      };
    }
    return {
      allowed: false,
      unlimited: false,
      reason: 'quota_exceeded',
      limit: BETA_FREE_LIMIT,
      used,
    };
  } catch (err) {
    // Hot-path failure — never block the export. Log and deny so the
    // augment layer is skipped (falls through to existing placeholder).
    log.warn({ err: err.message, userId }, 'entitlement check failed; denying augment');
    return { allowed: false, unlimited: false, reason: 'check_failed', limit: BETA_FREE_LIMIT, used: null };
  }
};

/**
 * Record a successful AI augment usage. Increments counter + bumps timestamp.
 * Called ONLY when the augment layer produced at least one available:true
 * envelope (so users aren't charged for Claude outages).
 *
 * Admins / owners are NEVER recorded — their usage is unlimited and we don't
 * want their explorations bumping the same counter we use for the BETA limit
 * (if their role is ever flipped to analyst later).
 *
 * Never throws — failure here just means the next export won't see the
 * incremented count. Surface via logs for the operator to investigate.
 */
const recordUsage = async ({ userId, userRole } = {}) => {
  if (userRole && ADMIN_ROLES.has(String(userRole).toLowerCase())) {
    return { recorded: false, reason: 'admin_unlimited' };
  }
  if (!userId) {
    return { recorded: false, reason: 'no_user' };
  }
  try {
    const result = await query(
      `UPDATE users
       SET ai_augment_reports_used = COALESCE(ai_augment_reports_used, 0) + 1,
           ai_augment_last_used_at = NOW()
       WHERE id = $1
       RETURNING ai_augment_reports_used, ai_augment_last_used_at`,
      [userId],
    );
    if (!result.rows.length) {
      return { recorded: false, reason: 'user_not_found' };
    }
    const row = result.rows[0];
    return {
      recorded: true,
      newCount: Number(row.ai_augment_reports_used) || 0,
      lastUsedAt: row.ai_augment_last_used_at,
    };
  } catch (err) {
    log.warn({ err: err.message, userId }, 'recordUsage failed');
    return { recorded: false, reason: 'write_failed', error: err.message };
  }
};

module.exports = {
  checkEntitlement,
  recordUsage,
  BETA_FREE_LIMIT,
  ADMIN_ROLES,
};
