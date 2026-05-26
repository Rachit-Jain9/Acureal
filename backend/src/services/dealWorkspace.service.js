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
const verdictsService = require('./recommendation/verdicts.service');
const { narrateCard } = require('./recommendation/recommendationNarrator');
const dealDoctor = require('./recommendation/dealDoctor');
const microMarketIntelligence = require('./microMarketIntelligence.service');
const bestUseSimulator = require('./bestUseSimulator.service');
const dealStructureRecommender = require('./dealStructureRecommender.service');
const promoterProfileService = require('./promoterProfile.service');
const toneClassifier = require('./ai/toneClassifier');

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

    // PR-C — apply operator verdicts: hide cards the operator has dismissed
    // or snoozed. The hidden cards still travel in `hidden_by_verdict` so
    // the UI can render a "show dismissed" toggle.
    const activeVerdicts = await verdictsService.getActiveByDeal(dealId, {
      currentSnapshotHash: result.snapshot_hash,
    });
    const { visible, hidden } = verdictsService.applyVerdictsToCards(
      result.recommendations,
      activeVerdicts,
    );

    return {
      recommendations: visible,
      hidden_by_verdict: hidden,
      snapshot_hash: result.snapshot_hash,
      signal_count: result.signal_count,
      generated_at: result.generated_at,
      narrator_status: narratorStatus,
    };
  }, 'recommendations');

  // Deal Doctor slice — diagnostic view over the same signal set as the
  // recommendation engine. Different verbs, grouped by diagnostic theme.
  // Legal-carve-out findings bypass the narrator + tone classifier.
  const dealDoctorSlice = await optional(async () => {
    const narratorEnabled = process.env.RECOMMENDATION_NARRATOR_ENABLED !== 'false';
    const result = await dealDoctor.generateForWorkspace(composed, {
      narrate: narratorEnabled
        ? async (card) => {
            // The Deal Doctor narrator reuses the recommendation narrator under
            // the hood — same defensibility stack — but maps diagnosis verbs
            // → recommendation verbs ONLY for the constrained model call.
            // The card's verb is restored before return so the UI never sees
            // a drift.
            const proxy = {
              ...card,
              verb: 'Re-examine', // safe stand-in inside the narrator schema
              topic_label: 'Diagnostic finding',
              headline: card.finding,
              detail: card.why_it_matters,
            };
            const narration = await narrateCard(proxy, { workspace: composed, attach: { dealId } });
            if (!narration) return null;
            return {
              finding: narration.headline,
              why_it_matters: narration.detail,
            };
          }
        : undefined,
      toneGate: narratorEnabled ? toneClassifier.isAcceptable : undefined,
    });
    return {
      findings: result.findings,
      groups: result.groups,
      finding_count: result.finding_count,
      signal_count: result.signal_count,
      generated_at: result.generated_at,
    };
  }, 'dealDoctor');

  // PR P1-PR2 — Micro-Market Intelligence slice. Classify the deal's parcel
  // (via lat/lng if present) into one of the 20 Bengaluru micro-markets, then
  // fetch the briefing (benchmarks + demand signals) for that locality. The
  // panel on the Overview tab renders this; the deal-create form pre-fills
  // defaults from `getDefaultsForDealCreate`. Migration-tolerant — empty
  // shape when the seed isn't applied yet.
  const microMarketSlice = await optional(async () => {
    const lat = Number(deal.property_lat ?? deal.parcel_lat ?? deal.latitude);
    const lng = Number(deal.property_lng ?? deal.parcel_lng ?? deal.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      // No coordinates yet — return the empty shape with a hint for the UI.
      return {
        classification: { locality_code: null, name: null, distance_km: null, tier: null, confidence: null },
        locality: null,
        benchmarks: [],
        demand_signals: [],
        reason: 'no_parcel_coordinates',
      };
    }
    const classification = await microMarketIntelligence.classifyParcel(lat, lng);
    if (!classification.locality_code) {
      return { classification, locality: null, benchmarks: [], demand_signals: [], reason: 'no_match' };
    }
    const briefing = await microMarketIntelligence.getBriefing(classification.locality_code, {
      assetClass: deal.asset_class || null,
    });
    return {
      classification,
      locality: briefing.locality,
      benchmarks: briefing.benchmarks,
      demand_signals: briefing.demand_signals,
      reason: null,
    };
  }, 'microMarket');

  // Best Use Simulator — Phase 2 / Pillar 2. Pure compute over the
  // micro-market slice's already-fetched briefing — no extra DB round-trips.
  // Surfaces ranked asset-class scores on the Overview tab.
  const bestUseSlice = (() => {
    if (!microMarketSlice || !microMarketSlice.locality) {
      return {
        classification: microMarketSlice?.classification || { locality_code: null, confidence: null },
        locality: null,
        scores: [],
        reason: microMarketSlice?.reason || 'no_briefing_data',
      };
    }
    const { scores, reason } = bestUseSimulator.scoreFromBriefing({
      locality: microMarketSlice.locality,
      benchmarks: microMarketSlice.benchmarks,
      demand_signals: microMarketSlice.demand_signals,
    });
    return {
      classification: microMarketSlice.classification,
      locality: microMarketSlice.locality,
      scores,
      reason,
    };
  })();

  // Deal-Structure Recommender — Phase 2 / Pillar 3. Pure compute over the
  // deal's asset class + promoter posture + micro-market briefing. No extra
  // DB round-trips beyond the promoter posture (which is itself migration-
  // tolerant and degrades to 'unverified' silently).
  const dealStructureSlice = await optional(async () => {
    if (!deal.asset_class) return { scores: [], reason: 'no_asset_class' };
    let promoterPosture = 'unverified';
    try {
      const promoterData = await promoterProfileService.getProfileWithAssessment(deal.id);
      promoterPosture = promoterData?.assessment?.posture || 'unverified';
    } catch {
      // Migration-tolerant: degrade silently.
    }
    return dealStructureRecommender.scoreFromContext({
      assetClass: deal.asset_class,
      promoterPosture,
      microMarket: microMarketSlice && microMarketSlice.locality ? {
        locality: microMarketSlice.locality,
        benchmarks: microMarketSlice.benchmarks,
        demand_signals: microMarketSlice.demand_signals,
      } : null,
    });
  }, 'dealStructure');

  return {
    ...composed,
    recommendations: recommendationsSlice || { recommendations: [], hidden_by_verdict: [], snapshot_hash: null, signal_count: 0, generated_at: null },
    deal_doctor: dealDoctorSlice || { findings: [], groups: [], finding_count: 0, signal_count: 0, generated_at: null },
    micro_market: microMarketSlice || { classification: { locality_code: null, confidence: null }, locality: null, benchmarks: [], demand_signals: [], reason: 'unavailable' },
    best_use: bestUseSlice,
    deal_structure_recommender: dealStructureSlice || { scores: [], reason: 'unavailable' },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getDealWorkspace,
};
