'use strict';

/**
 * Learning-signal admin report — visualises the data the consumer-side
 * aggregator (PR #618) uses to re-rank recommendation cards.
 *
 * The capture path writes one row to `public.improvement_signals` for every
 * `dismiss` / `snooze` / `acted` verdict (signal_type='recommendation_verdict').
 * The consumer reads those rows back per-(org, rule) over a 90-day window
 * and computes a sort-weight multiplier. This admin report tells the
 * operator the SHAPE of that captured data:
 *
 *   • How many verdicts has the team logged? Trend up or down?
 *   • Which rules does the team consistently dismiss?
 *   • Which rules does the team consistently apply (positive feedback)?
 *   • Which rules are CURRENTLY being de-ranked, and by how much?
 *
 * Read-only, RLS-scoped, no AI, no writes. Migration-tolerant.
 *
 * Architecture mirrors aiUsage.service.js — each public method runs one
 * safeQuery and returns a clean shape. The page composes the four methods
 * client-side.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'learningSignals.adminReport' });
const {
  computeMultiplier,
  LEGAL_CARVE_OUT_TOPICS,
} = require('./learningSignals.aggregator.service');

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const MIN_DAYS = 1;

const clampDays = (d) =>
  Math.max(MIN_DAYS, Math.min(MAX_DAYS, Number(d) || DEFAULT_DAYS));

const safeQuery = async (sql, params, fallback) => {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (err) {
    // Fail-open. The admin page must render even if the table is missing
    // (fresh DB) or briefly unavailable.
    log.warn('learning_signal_admin_query_failed', { error: err.message, code: err.code });
    return fallback;
  }
};

// ─────────────────────────────────────────────────────────────────────────
//  Top-line summary
// ─────────────────────────────────────────────────────────────────────────

/**
 * Total verdicts captured in the window, broken down by kind, plus the
 * consent rate (proportion of rows attributed to a specific user — only
 * filled when the user holds `product_improvement` consent).
 */
const getSummary = async ({ days = DEFAULT_DAYS } = {}) => {
  const windowDays = clampDays(days);
  const rows = await safeQuery(
    `SELECT
       COUNT(*)::int                                                  AS total_verdicts,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'dismissed')::int  AS dismissed,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'snoozed')::int    AS snoozed,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'acted')::int      AS acted,
       COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int               AS attributed,
       COUNT(DISTINCT detail->>'rule_id')::int                        AS distinct_rules,
       MIN(created_at)                                                AS first_verdict_at,
       MAX(created_at)                                                AS last_verdict_at
     FROM public.improvement_signals
     WHERE signal_type = 'recommendation_verdict'
       AND created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    [windowDays],
    [],
  );
  const r = rows[0] || {};
  const total = Number(r.total_verdicts || 0);
  const dismissed = Number(r.dismissed || 0);
  const acted = Number(r.acted || 0);
  return {
    window_days: windowDays,
    total_verdicts: total,
    dismissed,
    snoozed: Number(r.snoozed || 0),
    acted,
    attributed_count: Number(r.attributed || 0),
    attributed_rate_pct: total > 0 ? Math.round((Number(r.attributed || 0) / total) * 1000) / 10 : 0,
    dismissed_rate_pct: total > 0 ? Math.round((dismissed / total) * 1000) / 10 : 0,
    acted_rate_pct: total > 0 ? Math.round((acted / total) * 1000) / 10 : 0,
    distinct_rules: Number(r.distinct_rules || 0),
    first_verdict_at: r.first_verdict_at || null,
    last_verdict_at: r.last_verdict_at || null,
  };
};

// ─────────────────────────────────────────────────────────────────────────
//  Top rules by verdict kind
// ─────────────────────────────────────────────────────────────────────────

/**
 * Top-N rules by a specific verdict kind in the window. Sorted by count
 * descending; ties broken by most-recent activity. Returns one row per
 * rule_id with all three counters so the UI can show "dismissed 8× ·
 * applied 1× · snoozed 0×" per row.
 */
const VALID_KINDS = new Set(['dismissed', 'acted', 'snoozed']);

const getTopRules = async ({
  days = DEFAULT_DAYS,
  kind = 'dismissed',
  limit = 10,
} = {}) => {
  const windowDays = clampDays(days);
  const selectedKind = VALID_KINDS.has(kind) ? kind : 'dismissed';
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));

  const rows = await safeQuery(
    `SELECT
       detail->>'rule_id'                                              AS rule_id,
       detail->>'topic'                                                AS topic,
       MAX(detail->>'verb')                                            AS last_verb,
       MAX((detail->>'severity')::int)                                 AS max_severity,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'dismissed')::int   AS dismiss_count,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'snoozed')::int     AS snooze_count,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'acted')::int       AS acted_count,
       COUNT(*)::int                                                   AS total_count,
       MAX(created_at)                                                 AS last_verdict_at
     FROM public.improvement_signals
     WHERE signal_type = 'recommendation_verdict'
       AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
     GROUP BY detail->>'rule_id', detail->>'topic'
     HAVING COUNT(*) FILTER (WHERE detail->>'verdict' = $2) > 0
     ORDER BY COUNT(*) FILTER (WHERE detail->>'verdict' = $2) DESC,
              MAX(created_at) DESC
     LIMIT $3`,
    [windowDays, selectedKind, safeLimit],
    [],
  );

  return rows.map((r) => ({
    rule_id: r.rule_id,
    topic: r.topic,
    last_verb: r.last_verb,
    max_severity: r.max_severity != null ? Number(r.max_severity) : null,
    dismiss_count: Number(r.dismiss_count || 0),
    snooze_count: Number(r.snooze_count || 0),
    acted_count: Number(r.acted_count || 0),
    total_count: Number(r.total_count || 0),
    last_verdict_at: r.last_verdict_at,
    is_legal_carve_out: LEGAL_CARVE_OUT_TOPICS.has(String(r.topic || '')),
  }));
};

// ─────────────────────────────────────────────────────────────────────────
//  Currently-active adjustments — what the platform IS de-ranking right now
// ─────────────────────────────────────────────────────────────────────────

/**
 * The list of rules where the consumer aggregator would currently apply a
 * multiplier < 1.0 (i.e., the rule is being de-ranked in the operator's
 * org). This is the most-actionable view — it tells the operator EXACTLY
 * which cards their team is seeing in a lower position.
 *
 * Mirrors the consumer's policy ladder via `computeMultiplier()`: legal
 * carve-outs always show 1.0; acted_count >= dismiss_count keeps 1.0;
 * dismiss_count >= 6 → 0.7; ≥3 → 0.85.
 */
const getActiveAdjustments = async ({ days = 90 } = {}) => {
  const windowDays = clampDays(days);
  const rows = await safeQuery(
    `SELECT
       detail->>'rule_id'                                              AS rule_id,
       detail->>'topic'                                                AS topic,
       MAX(detail->>'verb')                                            AS last_verb,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'dismissed')::int   AS dismiss_count,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'snoozed')::int     AS snooze_count,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'acted')::int       AS acted_count,
       MAX(created_at)                                                 AS last_verdict_at
     FROM public.improvement_signals
     WHERE signal_type = 'recommendation_verdict'
       AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
     GROUP BY detail->>'rule_id', detail->>'topic'
     HAVING COUNT(*) FILTER (WHERE detail->>'verdict' = 'dismissed') > 0`,
    [windowDays],
    [],
  );

  // Apply the consumer's multiplier policy in JS so the report exactly
  // matches what the engine does. Then filter to only the rules where
  // multiplier < 1.0 (the actually-de-ranked ones), sorted by impact.
  const adjustments = rows
    .map((r) => {
      const counts = {
        dismiss_count: Number(r.dismiss_count || 0),
        snooze_count: Number(r.snooze_count || 0),
        acted_count: Number(r.acted_count || 0),
        total_count:
          Number(r.dismiss_count || 0)
          + Number(r.snooze_count || 0)
          + Number(r.acted_count || 0),
      };
      const { multiplier, reason } = computeMultiplier(r.topic, counts);
      return {
        rule_id: r.rule_id,
        topic: r.topic,
        last_verb: r.last_verb,
        ...counts,
        last_verdict_at: r.last_verdict_at,
        multiplier,
        reason,
        is_legal_carve_out: LEGAL_CARVE_OUT_TOPICS.has(String(r.topic || '')),
      };
    })
    .filter((row) => row.multiplier < 1.0)
    // Strongest adjustments first (lowest multiplier = most de-ranked);
    // tiebreak by dismiss_count desc.
    .sort((a, b) => {
      if (a.multiplier !== b.multiplier) return a.multiplier - b.multiplier;
      return b.dismiss_count - a.dismiss_count;
    });

  return {
    window_days: windowDays,
    adjustments,
    adjusted_rule_count: adjustments.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────
//  Daily series for the trend chart
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verdict count per day in the window, split by verdict kind. The UI
 * stacks the three series (dismissed / snoozed / acted) for the line/area
 * chart. Days with zero verdicts are filled in by the caller (cleaner SQL
 * here, smaller payload over the wire).
 */
const getDailySeries = async ({ days = DEFAULT_DAYS } = {}) => {
  const windowDays = clampDays(days);
  const rows = await safeQuery(
    `SELECT
       date_trunc('day', created_at)::date                              AS bucket_date,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'dismissed')::int    AS dismissed,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'snoozed')::int      AS snoozed,
       COUNT(*) FILTER (WHERE detail->>'verdict' = 'acted')::int        AS acted,
       COUNT(*)::int                                                    AS total
     FROM public.improvement_signals
     WHERE signal_type = 'recommendation_verdict'
       AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
     GROUP BY 1
     ORDER BY 1 ASC`,
    [windowDays],
    [],
  );
  return rows.map((r) => ({
    date: r.bucket_date instanceof Date ? r.bucket_date.toISOString().slice(0, 10) : r.bucket_date,
    dismissed: Number(r.dismissed || 0),
    snoozed: Number(r.snoozed || 0),
    acted: Number(r.acted || 0),
    total: Number(r.total || 0),
  }));
};

// ─────────────────────────────────────────────────────────────────────────
//  One-shot composite (the page reads this; one round-trip)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Single-call composite — the admin page reads ONE endpoint and gets
 * everything it needs. Mirrors aiUsage.service's getDashboard() pattern.
 */
const getDashboard = async ({ days = DEFAULT_DAYS } = {}) => {
  const windowDays = clampDays(days);
  const [summary, topDismissed, topActed, activeAdjustments, dailySeries] = await Promise.all([
    getSummary({ days: windowDays }),
    getTopRules({ days: windowDays, kind: 'dismissed', limit: 10 }),
    getTopRules({ days: windowDays, kind: 'acted', limit: 10 }),
    getActiveAdjustments({ days: 90 }), // active adjustments always look at the consumer's full 90d window
    getDailySeries({ days: windowDays }),
  ]);
  return {
    window_days: windowDays,
    summary,
    top_dismissed: topDismissed,
    top_acted: topActed,
    active_adjustments: activeAdjustments,
    daily_series: dailySeries,
    generated_at: new Date().toISOString(),
  };
};

module.exports = {
  // Public API — one composite for the admin page, four individual
  // methods exported for tests + future widget reuse.
  getDashboard,
  getSummary,
  getTopRules,
  getActiveAdjustments,
  getDailySeries,
  // Constants exported for tests
  DEFAULT_DAYS,
  MAX_DAYS,
  MIN_DAYS,
};
