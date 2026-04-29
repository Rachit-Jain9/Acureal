'use strict';

/**
 * Per-org daily AI spend guard.
 *
 * Today every AI call lands in `ai_call_logs` with a `cost_usd` estimate.
 * Cost is *logged* but never *blocked*. A misbehaving extraction loop on a
 * 200-page PDF can burn $10+ silently before anyone notices. This module
 * draws a fence in front of the call.
 *
 * Public surface
 * ──────────────
 *   assertWithinDailyCap({ organizationId })
 *     → throws CostCapExceededError if today's cumulative spend ≥ cap
 *     → no-op when cap unset (dev / staging)
 *
 *   sumDailySpend({ organizationId })
 *     → returns USD spent so far today (UTC midnight window)
 *
 * The cap comes from `AI_DAILY_COST_CAP_USD`. We deliberately don't expose
 * a per-task cap — the failure mode that costs real money is an extraction
 * loop, and the user's operational constraint is a daily envelope, not a
 * per-call one. A future `AI_DAILY_COST_CAP_BY_TASK_JSON` could split if
 * needed.
 *
 * Intentional choices:
 *   - Window is calendar-day UTC, not rolling 24h. Operators reason about
 *     "today" not "the last 24 hours" — calendar-day matches mental model
 *     and resets at a predictable time.
 *   - Org-scoped, not tenant-wide. NULL-org rows (platform-curator calls)
 *     have their own implicit cap of `AI_DAILY_COST_CAP_USD * 2` because
 *     curator workflows touch many orgs at once.
 *   - We read cost from logged rows, not estimated mid-call. A previously
 *     failed call that completed before erroring still counts.
 */

const { query } = require('../config/database');
const log = require('./logger').child({ module: 'cost-guard' });

class CostCapExceededError extends Error {
  constructor({ organizationId, spentUsd, capUsd }) {
    super(
      `Daily AI spend cap reached for organization ${organizationId || 'platform'}: `
      + `$${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}. Calls blocked until UTC midnight.`,
    );
    this.name = 'CostCapExceededError';
    this.code = 'AI_COST_CAP_EXCEEDED';
    this.statusCode = 429;
    this.organizationId = organizationId;
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}

const getDailyCap = () => {
  const raw = process.env.AI_DAILY_COST_CAP_USD;
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log.warn('cost_cap_invalid_env', { value: raw });
    return null;
  }
  return parsed;
};

/**
 * Sum cost_usd on `ai_call_logs` rows created since UTC midnight for the
 * given organization. NULL-org calls (platform curator) are summed against
 * `organization_id IS NULL` when `organizationId` is null/undefined.
 */
const sumDailySpend = async ({ organizationId }) => {
  const result = await query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS spent_usd
       FROM ai_call_logs
      WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
        AND ${organizationId ? 'organization_id = $1' : 'organization_id IS NULL'}`,
    organizationId ? [organizationId] : [],
  );
  return Number(result.rows[0]?.spent_usd || 0);
};

/**
 * Reject the next call when this org's daily spend has already crossed the
 * configured cap. Returns the spend snapshot so callers can log it; throws
 * `CostCapExceededError` (HTTP 429-shaped) when over.
 *
 * No-ops when the cap is unset — that's how dev/staging stay frictionless.
 */
const assertWithinDailyCap = async ({ organizationId } = {}) => {
  const capUsd = getDailyCap();
  if (capUsd == null) return { capped: false, spentUsd: null, capUsd: null };

  const effectiveCap = organizationId ? capUsd : capUsd * 2;
  const spentUsd = await sumDailySpend({ organizationId });
  if (spentUsd >= effectiveCap) {
    throw new CostCapExceededError({ organizationId, spentUsd, capUsd: effectiveCap });
  }
  return { capped: true, spentUsd, capUsd: effectiveCap };
};

module.exports = {
  CostCapExceededError,
  assertWithinDailyCap,
  sumDailySpend,
  getDailyCap,
};
