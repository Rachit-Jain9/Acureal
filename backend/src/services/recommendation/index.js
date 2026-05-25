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
 * @returns {Promise<{ recommendations, snapshot_hash, signal_count, generated_at }>}
 */
const generateForWorkspace = async (workspace, options = {}) => {
  const narrate = typeof options.narrate === 'function' ? options.narrate : null;

  const signals = extractAllSignals(workspace);
  const candidates = generateRecommendations(signals);

  let recommendations = candidates;
  if (narrate) {
    recommendations = await Promise.all(
      candidates.map(async (card) => {
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
