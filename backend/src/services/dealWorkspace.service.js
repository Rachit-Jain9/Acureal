/**
 * Deal workspace read-model.
 *
 * Composes existing per-domain service reads (deal, financial, documents,
 * activity, audit, waterfall, DD/risk scores) into one grounded payload so
 * the deal workspace UI can load all four tabs (Overview, Financial, DD/Risk,
 * Activity/Documents) from a single round-trip instead of ~7 parallel module
 * queries.
 *
 * Design rules (Phase A — read consolidation only):
 *  • No new math. Everything is a delegate to a service that already owns the
 *    relevant SQL + RLS check (`buildVisibleDealCondition` / `current_organization_id()`).
 *  • No write path. Mutations keep going through the per-domain routes so
 *    existing validators, audit hooks, and role checks still fire.
 *  • Permissive on optional slices. A deal without financials, waterfall, or
 *    audit events is still a valid deal — return `null` for those slices
 *    instead of 404ing the whole workspace.
 *  • Strict on the core deal. If `getDealById` throws (not found / not visible)
 *    the whole request fails — there is no workspace without a deal.
 */

const dealService = require('./deal.service');
const financialService = require('./financial.service');
const documentService = require('./document.service');
const activityService = require('./activity.service');
const ddService = require('./dd.service');
const riskService = require('./risk.service');
const waterfallService = require('./waterfall.service');
const recommendationEngine = require('./recommendation');
const recommendationPersistence = require('./recommendation/persistence');
const { narrateCard } = require('./recommendation/recommendationNarrator');

const ACTIVITY_LIMIT = 50;
const AUDIT_EVENT_LIMIT = 25;

/**
 * Resolve a promise-returning thunk and swallow the error, returning `null`.
 * Used for optional slices whose absence should not fail the workspace read.
 */
async function optional(thunk, sliceName) {
  try {
    return await thunk();
  } catch (err) {
    // 404s are expected on deals that never had financials / waterfall / etc.
    if (err && (err.statusCode === 404 || err.status === 404)) return null;
    // Anything else is logged but still does not fail the composite request —
    // a degraded workspace is more useful than a hard error.
    console.warn(`[dealWorkspace] ${sliceName} read failed:`, err.message);
    return null;
  }
}

/**
 * Get the full workspace payload for a deal.
 *
 * The shape is intentionally flat at the top level — one slice per tab — so
 * the frontend can `useQuery(['deal-workspace', dealId], { select })` and
 * derive tab-specific props without re-shaping.
 */
async function getDealWorkspace(dealId) {
  // Core — must succeed. Any failure (not found, not visible) short-circuits.
  const deal = await dealService.getDealById(dealId);

  // Parallel fetch of optional slices. Each already enforces RLS via its own
  // query; we do NOT re-check visibility here — the deal fetch above already
  // proved the caller has access, and the sub-queries each re-check.
  const [
    financials,
    scenarios,
    financialGraph,
    auditEvents,
    documents,
    activities,
    ddScore,
    riskScore,
    waterfalls,
  ] = await Promise.all([
    optional(() => financialService.getFinancials(dealId), 'financials'),
    optional(() => financialService.getScenarios(dealId), 'scenarios'),
    optional(() => financialService.getFinancialGraph(dealId), 'financialGraph'),
    optional(() => financialService.listDealEvents(dealId, { limit: AUDIT_EVENT_LIMIT }), 'auditEvents'),
    optional(() => documentService.getDocuments(dealId), 'documents'),
    optional(() => activityService.getActivities(dealId, {}, { limit: ACTIVITY_LIMIT }), 'activities'),
    optional(() => ddService.getDDScore(dealId), 'ddScore'),
    optional(() => riskService.getRiskScore(dealId), 'riskScore'),
    optional(() => waterfallService.getWaterfall(dealId), 'waterfalls'),
  ]);

  const waterfallByKind = Array.isArray(waterfalls)
    ? waterfalls.reduce((acc, row) => {
        if (row && row.kind) acc[row.kind] = row;
        return acc;
      }, {})
    : {};

  // Compose the payload up-front so the recommendation engine can read from
  // the same shape the frontend will see — no risk of the two surfaces
  // diverging on field names.
  const composed = {
    deal,
    financial: {
      summary: financials,
      scenarios,
      graph: financialGraph,
      auditEvents: auditEvents || [],
    },
    dd: {
      items: deal.dd_items || [],
      score: ddScore,
    },
    risk: {
      flags: deal.risk_flags || [],
      score: riskScore,
    },
    approvals: deal.approval_items || [],
    documents: documents || { documents: [], grouped: {} },
    activities: activities || [],
    waterfall: {
      jda: waterfallByKind.jda || null,
      jv: waterfallByKind.jv || null,
    },
    readiness: {
      summary: deal.readiness_summary || null,
      nextSteps: deal.next_steps || [],
    },
  };

  // Recommendations slice — deterministic engine over the composed payload,
  // optionally rephrased by the constrained AI narrator. Persistence is
  // fire-and-forget: a failed insert never blocks the read. The narrator
  // honours `RECOMMENDATION_NARRATOR_ENABLED=false` so the operator can
  // turn AI rephrasing off without a code revert.
  const recommendationsSlice = await optional(async () => {
    const startMs = Date.now();
    const narratorAttempts = { tried: 0, succeeded: 0 };
    const narratorEnabled = process.env.RECOMMENDATION_NARRATOR_ENABLED !== 'false';
    const result = await recommendationEngine.generateForWorkspace(composed, {
      // Narrator is wired here; the orchestrator already bypasses the hook
      // for `ai_narratable: false` cards (the four legal carve-outs).
      narrate: narratorEnabled
        ? async (card) => {
            narratorAttempts.tried += 1;
            const narration = await narrateCard(card, { workspace: composed, attach: { dealId } });
            if (narration) narratorAttempts.succeeded += 1;
            return narration;
          }
        : undefined,
    });
    const latencyMs = Date.now() - startMs;
    const narratorStatus = !narratorEnabled
      ? 'disabled'
      : narratorAttempts.tried === 0
        ? 'skipped'
        : narratorAttempts.succeeded === narratorAttempts.tried
          ? 'success'
          : narratorAttempts.succeeded > 0
            ? 'partial'
            : 'failed';
    // Fire-and-forget persist. Failures land in logs; user still sees the cards.
    recommendationPersistence.recordRun({
      dealId,
      snapshotHash: result.snapshot_hash,
      signalCount: result.signal_count,
      recommendations: result.recommendations,
      signals: result.signals,
      narratorStatus,
      narratorMeta: { tried: narratorAttempts.tried, succeeded: narratorAttempts.succeeded },
      latencyMs,
    }).catch(() => {});
    return {
      recommendations: result.recommendations,
      snapshot_hash: result.snapshot_hash,
      signal_count: result.signal_count,
      generated_at: result.generated_at,
      narrator_status: narratorStatus,
    };
  }, 'recommendations');

  return {
    ...composed,
    recommendations: recommendationsSlice || { recommendations: [], snapshot_hash: null, signal_count: 0, generated_at: null },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getDealWorkspace,
};
