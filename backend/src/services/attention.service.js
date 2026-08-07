'use strict';

/**
 * Today's Attention — the "what should I look at first?" service.
 *
 * The Portfolio Risk Radar (portfolioRiskRadar.service.js) answers
 *   "across my live deals, where is risk concentrated?"  — aggregate counts.
 * This service answers the next question down:
 *   "give me the specific items that need action TODAY."
 *
 * Pulls five disjoint signals across the live portfolio, ranked by urgency,
 * each capped to a small N so the dashboard tile stays fast and scannable:
 *
 *   • overdue_dd_items     — required, still-open DD items past due_date
 *   • expiring_approvals   — required, validated approvals expiring within 30 d
 *   • new_risk_flags       — open flags created in the last 7 days
 *   • stale_deals          — live deals with no activity in 14+ days
 *   • recent_activity      — last 10 audit-log rows across the portfolio
 *
 * Performance: five parallel SELECTs, each LIMIT-bound and scoped to
 * `current_organization_id()` via RLS. For a 200-deal portfolio the total
 * is well under 100 ms in practice.
 *
 * Determinism: no AI; every list is a deterministic projection of the
 * deal / DD / approval / risk_flag / activity tables. Each item carries
 * enough denormalised metadata (deal_name, deal_stage, etc.) that the
 * frontend renders without an N+1 join.
 */

const { query } = require('../config/database');
const { LIVE_DEAL_STAGES } = require('../constants/domain');
const dealVisitsService = require('./dealVisits.service');
const log = require('../lib/logger').child({ module: 'attention' });

const LIMIT_OVERDUE_DD = 10;
const LIMIT_EXPIRING_APPROVALS = 5;
const LIMIT_NEW_RISK = 5;
const LIMIT_STALE_DEALS = 5;
const LIMIT_RECENT_ACTIVITY = 10;
const EXPIRING_WINDOW_DAYS = 30;
const NEW_RISK_WINDOW_DAYS = 7;
const STALE_DEAL_DAYS = 14;

/**
 * Degrade one signal to an empty list rather than fail the whole tile — but
 * NEVER silently.
 *
 * This used to be `.catch(() => [])` with no logger anywhere in the file, which
 * on a surface called "Today's Attention" is the worst available failure mode:
 * a broken query and a genuinely clear portfolio render as the same thing, and
 * the message the user reads is "nothing needs your attention". That is the
 * one sentence this service must never say when it does not know.
 *
 * This repo has shipped that class before — a deal audit trail that had been
 * dead for four months, an invitation loop that never sent — so the rule here
 * is that a swallowed error still costs a log line. Codes and counts only:
 * these rows are customer deal data.
 *
 * The caller also gets the signal names that failed (see `getAttention`, which
 * surfaces them as `unavailable`), so the tile can say "I could not check this"
 * instead of implying an all-clear.
 */
const safeRows = (signal, p, failures) =>
  p
    .then((r) => r.rows)
    .catch((err) => {
      failures.push(signal);
      log.error('attention_signal_failed', err, { signal, code: err?.code || null });
      return [];
    });

/**
 * Overdue required DD items, ordered by most overdue first.
 * Joins deals to filter live + non-archived and to carry deal context.
 */
const getOverdueDdItems = (failures = []) =>
  safeRows('overdue_dd_items', query(
    `SELECT dd.id,
            dd.deal_id,
            dd.item_name,
            dd.category,
            dd.severity,
            dd.due_date,
            dd.status,
            EXTRACT(DAY FROM NOW() - dd.due_date)::INT AS days_overdue,
            d.name  AS deal_name,
            d.stage AS deal_stage
       FROM dd_items dd
       JOIN deals d ON d.id = dd.deal_id
      WHERE dd.organization_id = current_organization_id()
        AND dd.deleted_at IS NULL
        AND d.is_archived = FALSE
        AND d.stage = ANY($1::deal_stage[])
        AND dd.is_required = TRUE
        AND dd.status IN ('pending', 'in_progress')
        AND dd.due_date < NOW()
      ORDER BY dd.due_date ASC
      LIMIT $2`,
    [LIVE_DEAL_STAGES, LIMIT_OVERDUE_DD],
  ), failures);

/**
 * Required approvals whose expiry_date is in (now, now + 30 days],
 * ordered by soonest to expire. Excludes already-expired (those already
 * count as a flagged signal on the Risk Radar).
 */
const getExpiringApprovals = (failures = []) =>
  safeRows('expiring_approvals', query(
    `SELECT ap.id,
            ap.deal_id,
            ap.name,
            ap.approval_type,
            ap.expiry_date,
            ap.is_validated,
            ap.status,
            EXTRACT(DAY FROM ap.expiry_date - NOW())::INT AS days_until_expiry,
            d.name  AS deal_name,
            d.stage AS deal_stage
       FROM approval_items ap
       JOIN deals d ON d.id = ap.deal_id
      WHERE ap.organization_id = current_organization_id()
        AND ap.deleted_at IS NULL
        AND d.is_archived = FALSE
        AND d.stage = ANY($1::deal_stage[])
        AND ap.is_required = TRUE
        AND ap.expiry_date IS NOT NULL
        AND ap.expiry_date > NOW()
        AND ap.expiry_date <= NOW() + ($2 || ' days')::INTERVAL
      ORDER BY ap.expiry_date ASC
      LIMIT $3`,
    [LIVE_DEAL_STAGES, EXPIRING_WINDOW_DAYS, LIMIT_EXPIRING_APPROVALS],
  ), failures);

/**
 * Newly opened risk flags (in the last 7 days), ordered by severity
 * weight then created_at desc. Excludes resolved flags.
 */
const getNewRiskFlags = (failures = []) =>
  safeRows('new_risk_flags', query(
    `SELECT rf.id,
            rf.deal_id,
            rf.title,
            rf.severity,
            rf.category,
            rf.status,
            rf.source,
            rf.created_at,
            d.name  AS deal_name,
            d.stage AS deal_stage
       FROM risk_flags rf
       JOIN deals d ON d.id = rf.deal_id
      WHERE rf.organization_id = current_organization_id()
        AND rf.deleted_at IS NULL
        AND d.is_archived = FALSE
        AND d.stage = ANY($1::deal_stage[])
        AND rf.status IN ('open', 'flagged')
        AND rf.created_at > NOW() - ($2 || ' days')::INTERVAL
      ORDER BY CASE rf.severity
                 WHEN 'critical' THEN 4
                 WHEN 'high'     THEN 3
                 WHEN 'medium'   THEN 2
                 WHEN 'low'      THEN 1
                 ELSE 0
               END DESC,
               rf.created_at DESC
      LIMIT $3`,
    [LIVE_DEAL_STAGES, NEW_RISK_WINDOW_DAYS, LIMIT_NEW_RISK],
  ), failures);

/**
 * Live deals with no activity rows in the last 14 days. Falls back to
 * deals.created_at when a deal has never had any activity (a brand-new
 * sourced deal that hasn't been touched). The HAVING clause keeps the
 * "stale" threshold honest: only deals whose last touch was > 14 days
 * ago are returned.
 */
const getStaleDeals = (failures = []) =>
  safeRows('stale_deals', query(
    `SELECT d.id,
            d.name,
            d.stage,
            COALESCE(MAX(a.created_at), d.created_at) AS last_activity_at,
            EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.created_at))::INT AS days_stale
       FROM deals d
       LEFT JOIN activities a ON a.deal_id = d.id
                              AND a.organization_id = current_organization_id()
      WHERE d.organization_id = current_organization_id()
        AND d.is_archived = FALSE
        AND d.stage = ANY($1::deal_stage[])
      GROUP BY d.id, d.name, d.stage, d.created_at
     HAVING COALESCE(MAX(a.created_at), d.created_at) < NOW() - ($2 || ' days')::INTERVAL
      ORDER BY last_activity_at ASC
      LIMIT $3`,
    [LIVE_DEAL_STAGES, STALE_DEAL_DAYS, LIMIT_STALE_DEALS],
  ), failures);

/**
 * Last 10 activity rows across the live portfolio, denormalised with
 * deal name and performer name for one-shot rendering.
 */
const getRecentActivity = (failures = []) =>
  safeRows('recent_activity', query(
    `SELECT a.id,
            a.deal_id,
            a.activity_type AS type,
            a.description,
            a.created_at,
            d.name  AS deal_name,
            d.stage AS deal_stage,
            u.name  AS performed_by_name
       FROM activities a
       JOIN deals d ON d.id = a.deal_id
       LEFT JOIN users u ON u.id = a.performed_by
      WHERE a.organization_id = current_organization_id()
        AND d.is_archived = FALSE
        AND d.stage = ANY($1::deal_stage[])
      ORDER BY a.created_at DESC
      LIMIT $2`,
    [LIVE_DEAL_STAGES, LIMIT_RECENT_ACTIVITY],
  ), failures);

/**
 * Build the full Today's Attention payload. Returns:
 *
 *   {
 *     generated_at,
 *     totals: {
 *       overdue_dd, expiring_approvals, new_risk_flags, stale_deals,
 *       any: true | false   // true iff at least one signal has items
 *     },
 *     overdue_dd_items, expiring_approvals, new_risk_flags,
 *     stale_deals, recent_activity,
 *     thresholds: { stale_deal_days, new_risk_window_days, expiring_window_days }
 *   }
 *
 * Fan-out happens in parallel; each list is independently degraded to an
 * empty array on query error (via `safeRows`) so a single broken read
 * never blanks the whole tile.
 */
const getAttention = async () => {
  // Collects the names of any signal whose query failed, so the response can
  // say "I could not check this" instead of returning an empty list that reads
  // as "nothing to worry about".
  const failures = [];
  const [
    overdueDd,
    expiringApprovals,
    newRiskFlags,
    staleDeals,
    recentActivity,
    sinceYouLooked,
  ] = await Promise.all([
    getOverdueDdItems(failures),
    getExpiringApprovals(failures),
    getNewRiskFlags(failures),
    getStaleDeals(failures),
    getRecentActivity(failures),
    // Per-USER, not per-org: the four signals above ask "what crossed an
    // absolute threshold?", this asks "what changed since *I* last looked?".
    // Carries its own null-on-failure contract (null ≠ empty), so it is not
    // routed through safeRows.
    dealVisitsService.getPortfolioChangesSinceVisit(),
  ]);

  return {
    generated_at: new Date().toISOString(),
    totals: {
      overdue_dd: overdueDd.length,
      expiring_approvals: expiringApprovals.length,
      new_risk_flags: newRiskFlags.length,
      stale_deals: staleDeals.length,
      any:
        overdueDd.length
        + expiringApprovals.length
        + newRiskFlags.length
        + staleDeals.length > 0,
    },
    overdue_dd_items: overdueDd,
    expiring_approvals: expiringApprovals,
    new_risk_flags: newRiskFlags,
    stale_deals: staleDeals,
    recent_activity: recentActivity,
    // null = could not be computed (query failed, or the visits table is not
    // migrated yet). The strip renders nothing on null and says "nothing has
    // moved" only on a real, empty answer — the two must not look alike.
    since_you_looked: sinceYouLooked,
    // Empty array = every signal ran. Non-empty = these lists are EMPTY BECAUSE
    // THEY FAILED, not because there is nothing in them; the tile must not
    // present that as an all-clear.
    unavailable: failures.slice().sort(),
    thresholds: {
      stale_deal_days: STALE_DEAL_DAYS,
      new_risk_window_days: NEW_RISK_WINDOW_DAYS,
      expiring_window_days: EXPIRING_WINDOW_DAYS,
    },
  };
};

module.exports = {
  getAttention,
  // Exported for tests / future composition.
  getOverdueDdItems,
  getExpiringApprovals,
  getNewRiskFlags,
  getStaleDeals,
  getRecentActivity,
};
