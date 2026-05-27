'use strict';

/**
 * Recommendation Engine — public entry point.
 *
 * Composes the three layers (signal extractors → rule engine → optional AI
 * narrator) into one `generateForWorkspace(workspace)` call returning the
 * full recommendation set + a snapshot hash that the persistence layer
 * uses to deduplicate runs and link recommendations back to the deal state
 * they were produced from.
 *
 * The AI narrator is shipped in a follow-up PR; this layer's `narrate`
 * argument is a hook the workspace will set to a no-op until the narrator
 * lands.
 */

const crypto = require('crypto');

const { extractAllSignals } = require('./signalExtractors');
const { generateRecommendations, TOPICS, RECOMMENDATION_VERBS } = require('./recommendationRules');
const { composeTeamFeedback } = require('../learningSignals.aggregator.service');

/**
 * Produce a stable hash of the workspace inputs that drove the recommendations.
 * Used for caching + deduplication: re-running the engine against the same
 * snapshot produces the same hash, which means the persistence layer can
 * skip a re-insert.
 *
 * The hash domain is intentionally narrow — only the fields the extractors
 * actually read — so cosmetic changes (e.g. `generated_at`) don't bust the
 * cache.
 */
const computeSnapshotHash = (workspace) => {
  const deal = workspace?.deal || {};
  const subset = {
    deal: {
      asset_class: deal.asset_class,
      deal_structure: deal.deal_structure,
      stage: deal.stage,
      land_ask_price_cr: deal.land_ask_price_cr,
      negotiated_price_cr: deal.negotiated_price_cr,
      saleable_sqft: deal.saleable_sqft,
      extracted_saleable_sqft: deal.extracted_saleable_sqft,
      sales_price_per_sqft: deal.sales_price_per_sqft,
      absorption_units_per_quarter: deal.absorption_units_per_quarter,
      exit_cap_rate_pct: deal.exit_cap_rate_pct,
      hurdle_irr_pct: deal.hurdle_irr_pct,
      target_equity_multiple: deal.target_equity_multiple,
    },
    kpis: workspace?.financial?.summary?.kpis || null,
    n_comps: Array.isArray(workspace?.comps?.entries) ? workspace.comps.entries.length : 0,
    n_dd: Array.isArray(workspace?.dd?.items) ? workspace.dd.items.length : 0,
    n_approvals: Array.isArray(workspace?.approvals) ? workspace.approvals.length : 0,
    n_flags: Array.isArray(workspace?.risk?.flags) ? workspace.risk.flags.length : 0,
  };
  return crypto.createHash('sha256').update(JSON.stringify(subset)).digest('hex');
};

/**
 * Generate recommendations for a workspace payload.
 *
 * @param {object} workspace  the dealWorkspace.service composed payload.
 * @param {object} options
 * @param {function=} options.narrate  optional AI-narrator hook
 *                    `(candidate, ctx) => Promise<{ headline, detail } | null>`.
 *                    Returning null falls back to the deterministic template.
 *                    Cards with `ai_narratable: false` (legal carve-out)
 *                    bypass this hook unconditionally — the deterministic
 *                    template is the ONLY copy the user sees for those.
 * @param {Map<string,object>=} options.teamFeedback
 *                    optional `Map<rule_id, counts>` from
 *                    `learningSignals.aggregator.getTeamFeedbackByRule()`.
 *                    When provided, each emitted card receives a
 *                    `team_feedback` field describing how often the org has
 *                    dismissed/snoozed/acted on this rule in the trailing
 *                    window, and the deterministic sort is re-keyed on
 *                    `severity × multiplier` so frequently-dismissed rules
 *                    de-rank within that org. Legal carve-out topics
 *                    (title / RERA / approvals / encumbrance) always stay
 *                    at multiplier=1.0 regardless of feedback. The card
 *                    itself is never hidden — only the order changes.
 * @returns {Promise<{ recommendations, snapshot_hash, signal_count, generated_at }>}
 */
const generateForWorkspace = async (workspace, options = {}) => {
  const narrate = typeof options.narrate === 'function' ? options.narrate : null;
  const teamFeedback = options.teamFeedback instanceof Map ? options.teamFeedback : null;

  const signals = extractAllSignals(workspace);
  const candidates = generateRecommendations(signals);

  // Apply learning-loop team feedback BEFORE narration. The narrator
  // never sees the multiplier — its job is to rephrase the card text,
  // not to know about sort weights. Cards get a `team_feedback` field
  // and the candidate list is re-sorted by effective severity.
  let withFeedback = candidates;
  if (teamFeedback && teamFeedback.size > 0) {
    withFeedback = candidates.map((card) => {
      const counts = teamFeedback.get(card.id);
      const feedback = composeTeamFeedback(card.topic, counts);
      if (!feedback) return card;
      return {
        ...card,
        team_feedback: feedback,
        // The effective severity is what we sort on — `severity` itself
        // stays untouched so the audit log shows the rule's ORIGINAL
        // assessment, and the persistence layer doesn't have to track
        // a sliding window.
        effective_severity: Number(card.severity) * feedback.multiplier,
      };
    }).sort((a, b) => {
      const eA = Number.isFinite(a.effective_severity) ? a.effective_severity : a.severity;
      const eB = Number.isFinite(b.effective_severity) ? b.effective_severity : b.severity;
      if (eB !== eA) return eB - eA;
      return String(a.topic).localeCompare(String(b.topic));
    });
  }

  let recommendations = withFeedback;
  if (narrate) {
    recommendations = await Promise.all(
      withFeedback.map(async (card) => {
        if (!card.ai_narratable) return card;
        try {
          const narration = await narrate(card, { workspace });
          if (!narration || typeof narration !== 'object') return card;
          return {
            ...card,
            headline: typeof narration.headline === 'string' && narration.headline.length > 0 ? narration.headline : card.headline,
            detail: typeof narration.detail === 'string' && narration.detail.length > 0 ? narration.detail : card.detail,
            narrated: true,
          };
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[recommendation] narrator failed for ${card.id}: ${err.message}`);
          return card;
        }
      }),
    );
  }

  return {
    recommendations,
    snapshot_hash: computeSnapshotHash(workspace),
    signal_count: signals.length,
    signals,
    generated_at: new Date().toISOString(),
  };
};

module.exports = {
  generateForWorkspace,
  computeSnapshotHash,
  TOPICS,
  RECOMMENDATION_VERBS,
};
