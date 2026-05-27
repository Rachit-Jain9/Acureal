'use strict';

/**
 * Learning-signal AGGREGATOR — the read side of Phase 5's learning loop.
 *
 * The writer (`learningSignals.service.js`) appends values-free rows to
 * `public.improvement_signals` every time an operator acts on a
 * recommendation card (dismiss / snooze / acted). This module reads those
 * rows back, aggregated by `(organization_id, rule_id)` over a trailing
 * window, so the Recommendation Engine can let the team's pattern of
 * feedback DE-RANK rules the org has consistently dismissed without
 * blocking new ones outright.
 *
 * Hard rules (mirror docs/DATA_GOVERNANCE.md + CLAUDE.md):
 *   - Read-side only — never writes to `improvement_signals`.
 *   - Values-free aggregation — counts of verdicts grouped by rule_id +
 *     organization, never document VALUES, never PII.
 *   - Per-org scoping via RLS — the `current_organization_id()` GUC
 *     restricts every read to the caller's org.
 *   - Migration-tolerant — if the table is missing (e.g. fresh DB or a
 *     half-applied migration), the aggregator returns an empty Map and
 *     the recommendation engine ranks cards at full severity.
 *   - Never collapses to zero / hides cards — the worst the aggregator
 *     can do is suggest a 0.7× sort weight (the floor enforced by the
 *     downstream consumer). The card itself still renders.
 *
 * Architecture choice (rejected alternatives):
 *
 *   A. Block-list rules after N dismissals → REJECTED. Loses correctness;
 *      a team that dismisses-out-of-fatigue would silently hide critical
 *      findings.
 *   B. Bayesian rule scoring with priors → OVERKILL at current data
 *      volume; the dataset is too small (org-level, not platform-wide)
 *      for the math to do real work. Counts + thresholds are
 *      defensible, explainable, and don't pretend to a precision we
 *      can't justify.
 *   C. ML-learned re-ranker → OUT OF SCOPE. The narrator is the only AI
 *      surface in the recommendation pipeline; ranking stays
 *      deterministic so two runs against the same data produce the
 *      same order (snapshot reproducibility, audit-friendly).
 *
 *   D. CHOSEN: deterministic per-(org, rule) verdict-count aggregation
 *      over a 90-day trailing window, exposed as a Map<rule_id,
 *      counts>. The downstream consumer composes the multiplier with
 *      its own topic-awareness (legal carve-outs stay at 1.0).
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'learningSignals.aggregator' });

const PG_UNDEFINED_TABLE = '42P01';
const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

// 90-day window — long enough to smooth out a single bad week of triage,
// short enough that yesterday's pattern still matters more than a year
// ago. Matches the window the comp-reliance aggregator will use when it
// ships (Workstream C1).
const DEFAULT_WINDOW_DAYS = 90;

/**
 * Empty per-rule counts row. The downstream consumer applies its own
 * multiplier rule on top — this layer only counts.
 */
const emptyCounts = () => ({
  dismiss_count: 0,
  snooze_count: 0,
  acted_count: 0,
  total_count: 0,
  last_verdict_at: null,
});

/**
 * Aggregate recommendation-verdict signals for the caller's org.
 *
 * Returns a Map<rule_id, {dismiss_count, snooze_count, acted_count,
 * total_count, last_verdict_at}>. Only rules with at least one verdict
 * row in the window appear in the Map — callers should treat absence
 * as "no team feedback yet, use base severity".
 *
 * @param {object}   opts
 * @param {string[]?} opts.ruleIds       optional filter — if provided,
 *                                       only counts matching rule_ids
 *                                       are aggregated. Saves a tiny
 *                                       amount of bandwidth when the
 *                                       caller already knows the rules
 *                                       it cares about.
 * @param {number?}  opts.windowDays     trailing window in days.
 *                                       Defaults to 90.
 * @returns {Promise<Map<string, object>>}
 */
const getTeamFeedbackByRule = async ({ ruleIds = null, windowDays = DEFAULT_WINDOW_DAYS } = {}) => {
  const out = new Map();
  const days = Math.max(1, Math.min(365, Number(windowDays) || DEFAULT_WINDOW_DAYS));

  try {
    // The improvement_signals table is RLS-scoped to the caller's
    // organization (policy `improvement_signals_org_read`), so a bare
    // SELECT already restricts to the right rows. We do NOT need to
    // add `organization_id = current_organization_id()` to the WHERE
    // — the policy enforces it, and double-scoping would mask any
    // future change to the policy.
    //
    // Group by rule_id from the `detail` JSON (set by
    // learningSignals.service.recordRecommendationVerdictSignal). Cast
    // to text so the GROUP BY uses the canonical PG text comparator.
    const sql = `
      SELECT
        detail->>'rule_id'                                                 AS rule_id,
        COUNT(*) FILTER (WHERE detail->>'verdict' = 'dismissed')           AS dismiss_count,
        COUNT(*) FILTER (WHERE detail->>'verdict' = 'snoozed')             AS snooze_count,
        COUNT(*) FILTER (WHERE detail->>'verdict' = 'acted')               AS acted_count,
        COUNT(*)                                                           AS total_count,
        MAX(created_at)                                                    AS last_verdict_at
      FROM public.improvement_signals
      WHERE signal_type = 'recommendation_verdict'
        AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
        ${Array.isArray(ruleIds) && ruleIds.length > 0
          ? "AND detail->>'rule_id' = ANY($2::text[])"
          : ''}
      GROUP BY detail->>'rule_id'
    `;
    const params = Array.isArray(ruleIds) && ruleIds.length > 0 ? [days, ruleIds] : [days];
    const result = await query(sql, params);

    for (const row of result.rows || []) {
      if (!row.rule_id) continue;
      out.set(String(row.rule_id), {
        dismiss_count: Number(row.dismiss_count) || 0,
        snooze_count: Number(row.snooze_count) || 0,
        acted_count: Number(row.acted_count) || 0,
        total_count: Number(row.total_count) || 0,
        last_verdict_at: row.last_verdict_at || null,
      });
    }
    return out;
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('improvement_signals_missing', { error: err.message });
      return out;
    }
    log.warn('team_feedback_aggregate_failed', { error: err.message, code: err.code });
    return out;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  Pure helpers — multiplier policy lives here so it stays deterministic and
//  unit-testable without touching DB. Caller composes counts + topic to get
//  the final card multiplier.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimum number of dismissals in the window before the rule starts
 * to de-rank. Below this we assume noise; above it we treat the pattern
 * as deliberate. 3 is the smallest defensible "trend" — one dismissal is
 * a slip, two is a coincidence, three is a pattern.
 */
const DISMISSAL_THRESHOLD_MILD = 3;
const DISMISSAL_THRESHOLD_STRONG = 6;

/**
 * Floor: the worst sort weight the aggregator can apply. A floor of 0.7
 * means a strongly-dismissed card still ranks above a same-base-severity
 * card with no feedback, by AT MOST 30% of the severity span. The card
 * itself never hides — only the order is adjusted.
 */
const MULTIPLIER_FLOOR = 0.7;
const MULTIPLIER_MILD = 0.85;
const MULTIPLIER_NONE = 1.0;

/**
 * Topics that NEVER de-rank — statutorily significant lanes where a high
 * dismiss rate just means the team is making bad triage choices. Mirrors
 * `recommendationRules.isLegalTopic`. Kept here so the aggregator stays
 * a pure pure-data layer; the consumer can override on demand.
 */
const LEGAL_CARVE_OUT_TOPICS = new Set([
  'legal_title',
  'legal_rera',
  'legal_approvals',
  'legal_encumbrance',
]);

/**
 * Compute the sort-weight multiplier for one card.
 *
 * Inputs are the card's `topic` (string) and `counts` (the row from
 * `getTeamFeedbackByRule()`, or null if the rule has no feedback rows).
 *
 * Policy:
 *   1. Legal carve-out topics → 1.0 always.
 *   2. acted_count >= dismiss_count → 1.0 ("team has used it, leave alone").
 *   3. dismiss_count >= 6 → 0.7 (strong de-rank).
 *   4. dismiss_count >= 3 → 0.85 (mild de-rank).
 *   5. otherwise → 1.0.
 *
 * @returns {{multiplier:number, reason:string|null}}
 */
const computeMultiplier = (topic, counts) => {
  if (LEGAL_CARVE_OUT_TOPICS.has(String(topic || ''))) {
    return { multiplier: MULTIPLIER_NONE, reason: null };
  }
  if (!counts) return { multiplier: MULTIPLIER_NONE, reason: null };
  if (counts.acted_count >= counts.dismiss_count && counts.acted_count > 0) {
    return { multiplier: MULTIPLIER_NONE, reason: null };
  }
  if (counts.dismiss_count >= DISMISSAL_THRESHOLD_STRONG) {
    return {
      multiplier: MULTIPLIER_FLOOR,
      reason: `Dismissed ${counts.dismiss_count}× by your team in the last 90 days.`,
    };
  }
  if (counts.dismiss_count >= DISMISSAL_THRESHOLD_MILD) {
    return {
      multiplier: MULTIPLIER_MILD,
      reason: `Dismissed ${counts.dismiss_count}× by your team in the last 90 days.`,
    };
  }
  return { multiplier: MULTIPLIER_NONE, reason: null };
};

/**
 * Compose `team_feedback` payload to attach to a card.
 *
 * Returns null when there's nothing meaningful to surface — the card
 * renders normally without a chip. Returns a payload only when the
 * thresholds were crossed OR when there's any feedback the operator
 * might want to see (acted_count > 0 surfaces "applied N×" too, since
 * positive feedback is also worth showing).
 *
 * @returns {object|null}  `{multiplier, dismiss_count, snooze_count,
 *                          acted_count, total_count, last_verdict_at,
 *                          reason}` or null.
 */
const composeTeamFeedback = (topic, counts) => {
  if (!counts || counts.total_count === 0) return null;
  const { multiplier, reason } = computeMultiplier(topic, counts);
  // Always surface counts when there's any feedback, so the operator can
  // see what the platform learned even when the multiplier didn't trip.
  return {
    multiplier,
    reason,
    dismiss_count: counts.dismiss_count,
    snooze_count: counts.snooze_count,
    acted_count: counts.acted_count,
    total_count: counts.total_count,
    last_verdict_at: counts.last_verdict_at,
  };
};

module.exports = {
  // Public read API
  getTeamFeedbackByRule,
  // Pure helpers exported for tests + consumer composition
  computeMultiplier,
  composeTeamFeedback,
  // Constants exported for tests and possible UI thresholding
  DEFAULT_WINDOW_DAYS,
  DISMISSAL_THRESHOLD_MILD,
  DISMISSAL_THRESHOLD_STRONG,
  MULTIPLIER_FLOOR,
  MULTIPLIER_MILD,
  MULTIPLIER_NONE,
  LEGAL_CARVE_OUT_TOPICS,
  emptyCounts,
};
