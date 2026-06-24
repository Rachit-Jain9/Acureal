'use strict';

/**
 * Portfolio Risk Radar — workspace-level rollup of the per-deal Risk Radar.
 *
 * The per-deal radar (riskRadar.service.js) answers "what's clear, what's
 * flagged, what hasn't been verified yet on THIS deal." The portfolio radar
 * is the same view zoomed out one level: "across every live deal in this
 * workspace, where is open critical / high risk concentrated, and which
 * deals need attention before the next IC?"
 *
 * Computed deterministically from the same three tables the per-deal radar
 * reads (risk_flags, dd_items, approval_items), with one extra read against
 * `deals` to filter to live, non-archived rows. No AI — every count and
 * posture is explainable and auditable.
 *
 * Performance: one query per source table (joined to `deals` so RLS + the
 * "live, non-archived" filter applies once). For a 200-deal portfolio that's
 * 5 queries total — small enough to fit comfortably inside a 200ms dashboard
 * tile budget.
 *
 * Scope notes:
 *   • The per-deal radar adds a 6th "Promoter / Execution" category via
 *     promoterProfile.service.js — that's per-deal and requires an extra
 *     fetch per row. The portfolio rollup intentionally omits it for now;
 *     adding it would mean N+1 reads or a separate join, and the five core
 *     failure modes already cover the portfolio signal an IC chair cares
 *     about. Promoter risk continues to surface on each deal's Risk tab.
 *   • Closed and dead deals are excluded — they don't move and shouldn't
 *     inflate "open risks" numbers. The control list is LIVE_DEAL_STAGES.
 *   • Overdue required DD items are auto-escalated to the "flagged" posture,
 *     same as the per-deal radar (PR #517). Each overdue item also adds
 *     OVERDUE_DD_WEIGHT to the deal's portfolio score so it ranks up
 *     toward the top of "deals at risk" — between a high flag and a
 *     medium flag in severity priority.
 */

const { query } = require('../config/database');
const {
  mapRiskCategory,
  mapDdCategory,
  RADAR_CATEGORIES,
} = require('./riskRadar.service');
const { LIVE_DEAL_STAGES } = require('../constants/domain');

// Severity weights — kept aligned with risk.service.js getRiskScore() so a
// deal's portfolio score equals what its Risk tab displays. Critical=30 is
// the only weight above "high" by a real margin, so a single critical flag
// dominates the ranking — intentional: one open critical risk SHOULD push
// the deal to the top of the IC chair's queue.
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 5, low: 1 };
// Overdue weight sits between high (15) and medium (5) — an overdue
// required DD item is roughly as alarming as a high-severity open flag
// when the operator is triaging the portfolio.
const OVERDUE_DD_WEIGHT = 10;
const OPEN_FLAG_STATUSES = new Set(['open', 'flagged']);
const OPEN_DD_STATUSES = new Set(['pending', 'in_progress']);

const emptyMode = (cat) => ({
  key: cat.key,
  label: cat.label,
  flagged_deals: 0,
  unverified_deals: 0,
  cleared_deals: 0,
  open_critical: 0,
  open_high: 0,
  // Number of required, still-open DD items in this category whose due
  // date has passed — summed across every deal in the portfolio. This is
  // the auto-escalation signal from PR #517 surfaced at the portfolio
  // zoom level, so the dashboard tile shows the same "stale diligence"
  // warning the per-deal radar already does.
  overdue_total: 0,
});

const emptyDealCategory = (cat) => ({
  flags_total: 0,
  flags_ever: 0,
  flags_critical: 0,
  flags_high: 0,
  flags_medium: 0,
  flags_low: 0,
  dd_total: 0,
  dd_required_total: 0,
  dd_required_open: 0,
  dd_flagged: 0,
  dd_overdue: 0,
  approvals_required_total: 0,
  approvals_required_pending: 0,
  approvals_expired_required: 0,
  is_approval_cat: cat.approvals,
});

// Same posture logic as the per-deal radar (assessCategory) — kept inline so
// the portfolio rollup matches what each deal's Risk tab shows.
const assessCategoryPosture = (c) => {
  const hasProblem =
    c.flags_total > 0
    || c.dd_flagged > 0
    || c.dd_overdue > 0
    || (c.is_approval_cat && c.approvals_expired_required > 0);
  const openWork =
    c.dd_required_open > 0
    || (c.is_approval_cat && c.approvals_required_pending > 0);
  const assessed =
    c.dd_total > 0
    || c.flags_ever > 0
    || (c.is_approval_cat && c.approvals_required_total > 0);
  if (hasProblem) return 'flagged';
  if (assessed && !openWork) return 'cleared';
  return 'unverified';
};

const emptyResponse = () => ({
  generated_at: new Date().toISOString(),
  empty: true,
  totals: { deals: 0, flagged: 0, unverified: 0, cleared: 0 },
  open_severity: {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: 0,
    overdue_dd: 0,
    portfolio_score: 0,
  },
  failure_modes: RADAR_CATEGORIES.map(emptyMode),
  top_deals_at_risk: [],
  recently_flagged: [],
});

/**
 * Build the Portfolio Risk Radar for the current workspace.
 *
 * Returns:
 *   {
 *     generated_at,
 *     empty,                      // true when the workspace has no live deals
 *     totals:        { deals, flagged, unverified, cleared },
 *     open_severity: { critical, high, medium, low, total, overdue_dd, portfolio_score },
 *     failure_modes: [{ key, label, flagged_deals, unverified_deals, cleared_deals,
 *                       open_critical, open_high, overdue_total }],
 *     top_deals_at_risk: [{ id, name, stage, posture, open_critical, open_high,
 *                            overdue, score, worst_category }],
 *     recently_flagged:  [{ flag_id, deal_id, deal_name, severity, title, category, created_at }],
 *   }
 *
 * All counts respect RLS via current_organization_id().
 */
// Helper: resolve a query promise to its rows, returning [] on failure
// instead of throwing. The portfolio radar's five reads are independent —
// a broken risk_flags index shouldn't blank the deals + DD + approvals
// rollup. Same defence-in-depth pattern as attention.service.js.
const safeRows = (p, label) => p.then((r) => r.rows).catch((err) => {
  // Log a tagged message so the operator can correlate the empty section
  // to the offending query without losing user context.
  // eslint-disable-next-line no-console
  console.warn(`[portfolio-risk-radar] ${label} query failed:`, err.message);
  return [];
});

const getPortfolioRiskRadar = async () => {
  // One query per source table. `deals` is joined into each fan-out query so
  // a stale row on an archived or closed deal can't pollute the rollup.
  //
  // The $1::deal_stage[] cast (not ::text[]) matches every other working
  // query in the codebase against this column — Postgres' implicit
  // text→enum cast inside ANY() has historically been fragile on Supabase,
  // surfacing as a 500 on this endpoint. Casting to the enum directly is
  // the conservative path.
  const [dealRows, flagRows, ddRows, approvalRows, recentRows] = await Promise.all([
    safeRows(query(
      `SELECT id, name, stage, is_archived
         FROM deals
        WHERE organization_id = current_organization_id()
          AND is_archived = FALSE
          AND stage = ANY($1::deal_stage[])
        ORDER BY created_at DESC`,
      [LIVE_DEAL_STAGES],
    ), 'deals'),
    safeRows(query(
      `SELECT rf.deal_id, rf.category, rf.severity, rf.status
         FROM risk_flags rf
         JOIN deals d ON d.id = rf.deal_id
        WHERE rf.organization_id = current_organization_id()
          AND rf.deleted_at IS NULL
          AND d.is_archived = FALSE
          AND d.stage = ANY($1::deal_stage[])`,
      [LIVE_DEAL_STAGES],
    ), 'risk_flags'),
    safeRows(query(
      `SELECT dd.deal_id, dd.category, dd.status, dd.is_required, dd.due_date
         FROM dd_items dd
         JOIN deals d ON d.id = dd.deal_id
        WHERE dd.organization_id = current_organization_id()
          AND d.is_archived = FALSE
          AND d.stage = ANY($1::deal_stage[])`,
      [LIVE_DEAL_STAGES],
    ), 'dd_items'),
    safeRows(query(
      `SELECT ap.deal_id, ap.is_required, ap.is_validated, ap.expiry_date
         FROM approval_items ap
         JOIN deals d ON d.id = ap.deal_id
        WHERE ap.organization_id = current_organization_id()
          AND ap.deleted_at IS NULL
          AND d.is_archived = FALSE
          AND d.stage = ANY($1::deal_stage[])`,
      [LIVE_DEAL_STAGES],
    ), 'approval_items'),
    safeRows(query(
      `SELECT rf.id, rf.deal_id, d.name AS deal_name, rf.severity, rf.title,
              rf.category, rf.created_at
         FROM risk_flags rf
         JOIN deals d ON d.id = rf.deal_id
        WHERE rf.organization_id = current_organization_id()
          AND rf.deleted_at IS NULL
          AND d.is_archived = FALSE
          AND d.stage = ANY($1::deal_stage[])
          AND rf.status IN ('open', 'flagged')
          AND rf.created_at >= NOW() - INTERVAL '7 days'
        ORDER BY rf.created_at DESC
        LIMIT 5`,
      [LIVE_DEAL_STAGES],
    ), 'recent_flags'),
  ]);

  const deals = dealRows;
  if (deals.length === 0) return emptyResponse();

  // Build a per-deal bucket of empty category counts. Each category mirrors
  // the per-deal radar's shape so the posture assessment is identical.
  const dealBuckets = new Map();
  for (const d of deals) {
    const byCategory = {};
    for (const cat of RADAR_CATEGORIES) byCategory[cat.key] = emptyDealCategory(cat);
    dealBuckets.set(d.id, {
      deal: d,
      categories: byCategory,
      open_critical: 0,
      open_high: 0,
      open_medium: 0,
      open_low: 0,
      overdue: 0,
      score: 0,
    });
  }

  // Fan out the risk_flags rows. Every flag counts toward "ever" (proves the
  // failure mode was at least looked at); only open/flagged drive posture.
  for (const row of flagRows) {
    const b = dealBuckets.get(row.deal_id);
    if (!b) continue;
    const c = b.categories[mapRiskCategory(row.category)];
    c.flags_ever += 1;
    if (!OPEN_FLAG_STATUSES.has(String(row.status || '').toLowerCase())) continue;
    const sev = String(row.severity || 'medium').toLowerCase();
    c.flags_total += 1;
    if (sev === 'critical') { c.flags_critical += 1; b.open_critical += 1; }
    else if (sev === 'high') { c.flags_high += 1; b.open_high += 1; }
    else if (sev === 'medium') { c.flags_medium += 1; b.open_medium += 1; }
    else if (sev === 'low') { c.flags_low += 1; b.open_low += 1; }
    b.score += SEVERITY_WEIGHTS[sev] || 0;
  }

  // DD items.
  const nowMs = Date.now();
  for (const row of ddRows) {
    const b = dealBuckets.get(row.deal_id);
    if (!b) continue;
    const c = b.categories[mapDdCategory(row.category)];
    const status = String(row.status || 'pending').toLowerCase();
    const required = row.is_required !== false;
    c.dd_total += 1;
    if (required) c.dd_required_total += 1;
    if (status === 'flagged') c.dd_flagged += 1;
    else if (required && OPEN_DD_STATUSES.has(status)) {
      c.dd_required_open += 1;
      // Auto-escalation: a required, still-open DD item whose due_date
      // has passed is treated as a flagged signal. Mirrors PR #517's
      // per-deal radar logic exactly so the two views always agree.
      if (row.due_date && new Date(row.due_date).getTime() < nowMs) {
        c.dd_overdue += 1;
        b.overdue += 1;
        b.score += OVERDUE_DD_WEIGHT;
      }
    }
  }

  // Approvals — all fold into the Approvals & Regulatory category.
  for (const row of approvalRows) {
    const b = dealBuckets.get(row.deal_id);
    if (!b) continue;
    const c = b.categories.approvals_regulatory;
    if (row.is_required === false) continue;
    c.approvals_required_total += 1;
    if (row.expiry_date && new Date(row.expiry_date).getTime() < nowMs) {
      c.approvals_expired_required += 1;
    }
    if (row.is_validated !== true) c.approvals_required_pending += 1;
  }

  // Roll up to per-failure-mode and per-deal posture.
  const modeBuckets = {};
  for (const cat of RADAR_CATEGORIES) modeBuckets[cat.key] = emptyMode(cat);

  const totals = { flagged: 0, unverified: 0, cleared: 0 };
  const totalSeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  let totalOverdueDD = 0;
  const dealsForRanking = [];

  for (const b of dealBuckets.values()) {
    let dealPosture = 'cleared';
    let worstCategoryFlagged = null;

    for (const cat of RADAR_CATEGORIES) {
      const c = b.categories[cat.key];
      const posture = assessCategoryPosture(c);
      const m = modeBuckets[cat.key];
      // Overdue counts roll up to the mode regardless of the deal's
      // overall posture (a deal can be "flagged" because of a different
      // category and still contribute overdue items to this one).
      m.overdue_total += c.dd_overdue;
      if (posture === 'flagged') {
        m.flagged_deals += 1;
        m.open_critical += c.flags_critical;
        m.open_high += c.flags_high;
        dealPosture = 'flagged';
        if (!worstCategoryFlagged) worstCategoryFlagged = cat.label;
      } else if (posture === 'unverified') {
        m.unverified_deals += 1;
        if (dealPosture === 'cleared') dealPosture = 'unverified';
      } else {
        m.cleared_deals += 1;
      }
    }

    totals[dealPosture] += 1;
    totalSeverity.critical += b.open_critical;
    totalSeverity.high += b.open_high;
    totalSeverity.medium += b.open_medium;
    totalSeverity.low += b.open_low;
    totalOverdueDD += b.overdue;

    dealsForRanking.push({
      id: b.deal.id,
      name: b.deal.name,
      stage: b.deal.stage,
      posture: dealPosture,
      open_critical: b.open_critical,
      open_high: b.open_high,
      overdue: b.overdue,
      score: Math.min(b.score, 100),
      worst_category: worstCategoryFlagged,
    });
  }

  // Top deals at risk — ranked by (open_critical desc, score desc,
  // open_high desc, overdue desc). Score now includes overdue weight,
  // so a deal with 3 overdue DD items can rank above a deal with 1
  // medium-severity flag — which is the right call: overdue diligence
  // is a process problem, not an ambient signal. The trailing overdue
  // tiebreaker handles two deals with identical scores.
  const topDealsAtRisk = dealsForRanking
    .filter(
      (d) =>
        d.posture !== 'cleared'
        && (d.open_critical > 0 || d.open_high > 0 || d.overdue > 0 || d.score > 0),
    )
    .sort(
      (a, b) =>
        (b.open_critical - a.open_critical)
        || (b.score - a.score)
        || (b.open_high - a.open_high)
        || (b.overdue - a.overdue),
    )
    .slice(0, 5);

  // Portfolio score: average of per-deal scores (each already capped at 100).
  // Averaging keeps a single wildly flagged deal from pegging the index for
  // the whole portfolio.
  const portfolioScore = dealsForRanking.length > 0
    ? Math.round(dealsForRanking.reduce((sum, d) => sum + d.score, 0) / dealsForRanking.length)
    : 0;

  const totalOpen =
    totalSeverity.critical + totalSeverity.high + totalSeverity.medium + totalSeverity.low;

  return {
    generated_at: new Date().toISOString(),
    empty: false,
    totals: {
      deals: deals.length,
      flagged: totals.flagged,
      unverified: totals.unverified,
      cleared: totals.cleared,
    },
    open_severity: {
      critical: totalSeverity.critical,
      high: totalSeverity.high,
      medium: totalSeverity.medium,
      low: totalSeverity.low,
      total: totalOpen,
      overdue_dd: totalOverdueDD,
      portfolio_score: portfolioScore,
    },
    failure_modes: RADAR_CATEGORIES.map((cat) => modeBuckets[cat.key]),
    top_deals_at_risk: topDealsAtRisk,
    recently_flagged: recentRows.map((r) => ({
      flag_id: r.id,
      deal_id: r.deal_id,
      deal_name: r.deal_name,
      severity: r.severity,
      title: r.title,
      category: r.category,
      created_at: r.created_at,
    })),
  };
};

module.exports = {
  getPortfolioRiskRadar,
  // Exported for tests
  SEVERITY_WEIGHTS,
  OVERDUE_DD_WEIGHT,
  assessCategoryPosture,
};
