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
const learningSignalsAggregator = require('./learningSignals.aggregator.service');
const microMarketIntelligence = require('./microMarketIntelligence.service');
const bestUseSimulator = require('./bestUseSimulator.service');
const dealStructureRecommender = require('./dealStructureRecommender.service');
const capitalStackOptimizer = require('./capitalStackOptimizer.service');
const karnatakaReraReadiness = require('./karnatakaReraReadiness.service');
const rentRollService = require('./rentRoll.service');
const { buildReraContext } = require('./rera/complianceContext');
const reraConsistency = require('./rera/consistency');
const complianceCalendar = require('./rera/complianceCalendar');
const signoffService = require('./signoff.service');
const icReadiness = require('./icReadiness.service');
const compsService = require('./comps.service');
const guidanceService = require('./guidance.service');
const promoterProfileService = require('./promoterProfile.service');
const toneClassifier = require('./ai/toneClassifier');
const dealWorkspaceCache = require('./dealWorkspaceCache.service');
const log = require('../lib/logger').child({ module: 'dealWorkspace.service' });

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
    log.warn('workspace_slice_failed', { slice: sliceName, error: err.message, code: err.code || null });
    return null;
  }
}

/**
 * Flatten the workspace documents slice into a single array. The documents
 * service returns either a flat array, a `{data: [...]}` envelope, or a
 * `{category: [...]}` grouping; the readiness composers (K-RERA + IC) want
 * one flat list. Previously inlined identically in both slices — hoisted
 * here so the flatten loop runs once per workspace load.
 */
function flattenDocuments(documentsSlice) {
  const byCategory = documentsSlice?.data || documentsSlice || {};
  if (Array.isArray(byCategory)) return byCategory;
  if (byCategory && typeof byCategory === 'object') {
    let flat = [];
    for (const k of Object.keys(byCategory)) {
      if (Array.isArray(byCategory[k])) flat = flat.concat(byCategory[k]);
    }
    return flat;
  }
  return [];
}

/**
 * Get the full workspace payload for a deal.
 *
 * The shape is intentionally flat at the top level — one slice per tab — so
 * the frontend can `useQuery(['deal-workspace', dealId], { select })` and
 * derive tab-specific props without re-shaping.
 *
 * Options:
 *   • `lite` (default `false`) — when true, skip the expensive
 *     surfaces that don't add Q&A value: recommendation + deal-doctor AI
 *     narration, recommendation persistence (fire-and-forget),
 *     activities, audit events. The deterministic recommendation + deal-
 *     doctor cards still ship (with their evidence + signals) so the
 *     Q&A model can cite them; only the AI prose is skipped. Useful for
 *     non-UI callers like Deal Q&A (P7-PR1, 2026-05-27) that want the
 *     full structural payload without re-firing narration on every
 *     question. Lite payloads are NOT cached anywhere — callers should
 *     hold the result themselves if needed.
 */
async function getDealWorkspace(dealId, options = {}) {
  const lite = options.lite === true;
  // Core — must succeed. Any failure (not found, not visible) short-circuits.
  const deal = await dealService.getDealById(dealId);

  // ── Server-side deterministic cache (lite only) ──────────────────────────
  // Checked AFTER getDealById has authorised the caller, so a cache hit can
  // never bypass visibility. Version-keyed (busts on ANY per-deal edit) + TTL
  // (bounds the two non-per-deal inputs). Fully fault-tolerant: a missing table
  // or any error just falls through to a normal recompute. Only the lite path
  // is cached — it is what the deal page paints first; the full (AI-narrated)
  // path keeps its own response-cached narration.
  let liteVersionKey = null;
  if (lite) {
    liteVersionKey = await dealWorkspaceCache.computeVersionKey(dealId);
    if (liteVersionKey) {
      const cached = await dealWorkspaceCache.read(dealId, liteVersionKey);
      if (cached) return cached;
    }
  }

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
    promoterData,
    nearbyComps,
    guidanceMatch,
  ] = await Promise.all([
    // Reuse the financials row getDealById already loaded + authorized — no
    // extra `INNER JOIN deals` re-fetch. The scenarios / graph / audit slices
    // below take the same row so they skip their own redundant re-fetch too,
    // collapsing ~4 reads of one row per deal-page load down to the one
    // getDealById already did. (RLS still guards the table at the DB layer.)
    Promise.resolve(deal.financials || null),
    optional(() => financialService.getScenarios(dealId, { financialsRow: deal.financials ?? null }), 'scenarios'),
    optional(() => financialService.getFinancialGraph(dealId, { financialsRow: deal.financials ?? null }), 'financialGraph'),
    // Audit events + activities don't add Q&A value — skip in lite mode.
    lite
      ? Promise.resolve([])
      : optional(() => financialService.listDealEvents(dealId, { limit: AUDIT_EVENT_LIMIT, financialsRow: deal.financials ?? null }), 'auditEvents'),
    optional(() => documentService.getDocuments(dealId), 'documents'),
    lite
      ? Promise.resolve([])
      : optional(() => activityService.getActivities(dealId, {}, { limit: ACTIVITY_LIMIT }), 'activities'),
    optional(() => ddService.getDDScore(dealId), 'ddScore'),
    optional(() => riskService.getRiskScore(dealId), 'riskScore'),
    optional(() => waterfallService.getWaterfall(dealId), 'waterfalls'),
    // Promoter posture is consumed by the deal-structure + IC-readiness
    // slices — fetch once here in the parallel batch.
    optional(() => promoterProfileService.getProfileWithAssessment(dealId), 'promoterProfile'),
    // Nearby verified comps — needed by the recommendation engine + deal
    // doctor (price / absorption / cap-rate signals) so the LIVE deal page
    // surfaces the same market cards the DOCX/PPTX export already shows, AND
    // reused for the IC-readiness comps count. Comps are location-keyed, so
    // this resolves to [] when the deal has no coordinates.
    optional(async () => {
      const lat = Number(deal.property_lat ?? deal.parcel_lat ?? deal.latitude);
      const lng = Number(deal.property_lng ?? deal.parcel_lng ?? deal.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !compsService.getCompsNearLocation) return [];
      // Map asset_class onto a VALID comps.project_type enum value before
      // filtering. Passing the raw asset_class ('residential_apartments', …)
      // made Postgres reject the enum comparison, so this slice returned 0
      // comps on every deal — silently emptying the recommendation engine,
      // Deal Doctor market cards, and the IC-readiness comp count.
      const projectType = compsService.assetClassToProjectType(deal.asset_class, deal.property_type);
      const nearby = await compsService.getCompsNearLocation(lat, lng, 5, projectType);
      return Array.isArray(nearby) ? nearby : [];
    }, 'nearbyComps'),
    // Official IGR guidance (circle-rate) match for the parcel's locality.
    // Feeds the deterministic land-rate-vs-guidance signal (recommendation +
    // Deal Doctor) so the live deal page flags a land input priced below the
    // State stamp-duty floor. Built from the property fields the deal read-
    // model already exposes (no extra property fetch). Fully migration-
    // tolerant: findGuidanceMatches returns `not_configured` (never throws)
    // when the regulatory_data tables aren't seeded, and `needs_input` when
    // there's no address — both degrade the downstream signal to silent.
    optional(async () => {
      const propertyForGuidance = {
        address: deal.property_address,
        city: deal.city,
        state: deal.state,
        pincode: deal.pincode,
        zoning: deal.zoning,
        property_type: deal.property_type,
      };
      if (!propertyForGuidance.address && !propertyForGuidance.city) return null;
      return guidanceService.findGuidanceMatches(propertyForGuidance);
    }, 'guidance'),
  ]);

  // Normalised, single-source views the slices below read from. Computing
  // these once removes the duplicate flatten loops the K-RERA and IC-readiness
  // slices used to do inline.
  //
  // Approvals come from `deal.approval_items` (already loaded by getDealById),
  // not a second approvalsService.listByDeal round-trip: that not only saved a
  // query but also fixed a cross-org-shared-deal drift — listByDeal layers an
  // explicit `org = current_organization_id()` filter that returned [] for a
  // shared deal, so the K-RERA/IC packs showed zero approvals while the
  // recommendation cards (reading deal.approval_items) showed them. One source
  // now feeds every consumer.
  const approvals = Array.isArray(deal.approval_items) ? deal.approval_items : [];
  const documentsFlat = flattenDocuments(documents);
  const promoterPosture = promoterData?.assessment?.posture || 'unverified';
  const compsEntries = Array.isArray(nearbyComps) ? nearbyComps : [];

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
      // Surface the kernel KPIs at `summary.kpis` (camelCase: irr,
      // equityMultiple, totalRevenueCr, …) where the signal extractors read
      // them. The raw DB row only carries the JSONB `model_params` column +
      // snake_case scalars; the kpis object lives inside model_params. Without
      // this, the recommendation engine + deal doctor saw no financial signals
      // in-app (land-cost-share / IRR-vs-hurdle / equity-multiple never fired),
      // even though the DOCX/PPTX export — which feeds the SAME engines
      // `{ kpis: modelParams.kpis }` — showed them. Spread the row so existing
      // snake_case + `model_params` readers (e.g. the frontend useDealKpis
      // selector) keep working.
      summary: financials ? { ...financials, kpis: financials.model_params?.kpis ?? null } : null,
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
    approvals,
    // Nearby verified comps in the shape the market signal extractors read
    // (`ws.comps.entries`) — parity with the export path so price / absorption
    // / cap-rate recommendation + deal-doctor cards fire on the live page too.
    comps: { entries: compsEntries },
    // Official guidance (circle-rate) match for the parcel — read by the
    // land-rate-vs-guidance signal extractor. `null` when unavailable /
    // unconfigured; the extractor degrades to silent.
    guidance: guidanceMatch || null,
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
  const recommendationsPromise = optional(async () => {
    const startMs = Date.now();
    const narratorAttempts = { tried: 0, succeeded: 0 };
    // Lite-mode callers (e.g. Deal Q&A) want the deterministic cards
    // without paying the narrator/persistence cost — the AI prose is
    // expensive to re-generate on every question and the Q&A model
    // already produces its own narration from the structural signals.
    const narratorEnabled = !lite && process.env.RECOMMENDATION_NARRATOR_ENABLED !== 'false';

    // Phase 5 / P8 — learning loop consumer side. Fetch the per-(org, rule)
    // verdict counts for the trailing window BEFORE generating recommendations
    // so the engine can attach a `team_feedback` field to each card and
    // re-sort by effective severity. Migration-tolerant: the aggregator
    // returns an empty Map if the table is missing, and the engine then
    // ranks at full base severity exactly like before this PR. No new I/O
    // on the critical path when there's no historical feedback.
    const teamFeedback = await learningSignalsAggregator.getTeamFeedbackByRule();

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
      teamFeedback,
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
    // Lite mode (e.g. Deal Q&A reading workspace data) skips persistence to
    // avoid double-logging the same snapshot: the primary workspace fetch
    // for this deal already persisted the run.
    if (!lite) {
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
    }

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
  // Lite mode skips narration here too — the Q&A model produces its own
  // narration from the deterministic findings, and the UI surfaces never
  // call workspace in lite mode.
  const dealDoctorPromise = optional(async () => {
    const narratorEnabled = !lite && process.env.RECOMMENDATION_NARRATOR_ENABLED !== 'false';
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
  // fetch the briefing (benchmarks + demand signals) for that locality.
  // Migration-tolerant — empty shape when the seed isn't applied yet. Built as
  // a promise (not awaited inline) so it overlaps the batch below.
  const microMarketPromise = optional(async () => {
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

  // Karnataka RERA Readiness slice. Derives from the already-loaded deal +
  // approvals + documentsFlat, plus one cheap signoffs fetch (migration-
  // tolerant → [] before the table exists) and the deterministic consistency
  // findings. Built as a promise so it overlaps the batch below.
  const reraReadinessPromise = optional(async () => {
    const signoffs = await signoffService.listByDeal(dealId);
    const reraCtx = buildReraContext(deal, {
      approvals,
      documents: documentsFlat,
      extractedFields: {}, // future hook: structured extracted fields per document
      signoffs,
    });
    const slice = karnatakaReraReadiness.composeReadiness(reraCtx);
    // Co-locate the deterministic cross-document consistency findings (reuses
    // inconsistencyDetector — pure comparators, no persistence here).
    slice.consistency = await reraConsistency.composeReraConsistency(dealId, deal);
    // Deterministic post-registration compliance calendar — pure compute.
    slice.compliance_calendar = complianceCalendar.composeComplianceCalendar(reraCtx, {
      applicabilityStatus: slice.applicability && slice.applicability.status,
    });
    return slice;
  }, 'karnatakaReraReadiness');

  // Overlap the four independent slices instead of summing their latencies:
  // the two narrator-bearing slices (recommendations, deal-doctor — response-
  // cached so unchanged deals resolve with zero SDK round-trips) and the two
  // DB-backed slices (micro-market classify+briefing, K-RERA signoffs+
  // consistency). None share a data dependency — all derive from the read-only
  // `composed`/`deal` inputs — and their consumers (best-use, deal-structure,
  // IC readiness) run after this await. On the app's hottest read (every deal-
  // page open) this overlaps ~4 Supabase round-trips that were serialised.
  const [recommendationsSlice, dealDoctorSlice, microMarketSlice, reraReadinessSlice] = await Promise.all([
    recommendationsPromise,
    dealDoctorPromise,
    microMarketPromise,
    reraReadinessPromise,
  ]);

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
    // promoterPosture is derived once from the batch-fetched promoterData
    // above (degrades to 'unverified' when the promoter table is absent).
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

  // Capital-Stack Optimizer — Phase 2 / Pillar 3 (second half). Pure compute
  // over the deal's asset class + the kernel-computed financial summary that
  // is already on `composed.financial.summary` (no extra DB round-trips).
  // Honest empty states surface as `reason` when the kernel hasn't run yet.
  const capitalStackSlice = (() => {
    if (!deal.asset_class) return { scenarios: [], reason: 'no_asset_class' };
    return capitalStackOptimizer.scoreFromFinancials({
      assetClass: deal.asset_class,
      financials: financials || null,
    });
  })();

  // IC Readiness — Phase 3 / Pillar 5. Pure composer over ALL of the
  // slices we've already loaded above (financial, dd, risk, approvals,
  // documents, micro_market, best_use, rera_readiness, promoter, deal
  // doctor). Plus one cheap query for comps count.
  const icReadinessSlice = await optional(async () => {
    // Verified comps within 5km — reuse the batch-fetched `compsEntries`
    // (no second getCompsNearLocation round-trip). Count only verified ones.
    const compsCount = compsEntries.filter((c) => c.is_verified !== false).length;

    // promoterData, approvals, documentsFlat are all batch-fetched +
    // normalised once above — the IC composer reads the same single-source
    // views the deal-structure and K-RERA slices use.
    return icReadiness.composeReadiness({
      deal,
      financial: composed?.financial || null,
      documents: documentsFlat,
      approvals,
      micro_market: microMarketSlice,
      best_use: bestUseSlice,
      rera_readiness: reraReadinessSlice,
      dd: composed?.dd || null,
      risk: composed?.risk || riskScore,
      deal_doctor: dealDoctorSlice,
      promoter: promoterData,
      comps_count: compsCount,
    });
  }, 'icReadiness');

  const payload = {
    ...composed,
    // Promoter track record + deterministic posture (already batch-fetched for
    // the IC composer). Surfaced on the payload so report packs + future
    // consumers can read it directly. Additive — null when the table is absent.
    promoter: promoterData || null,
    recommendations: recommendationsSlice || { recommendations: [], hidden_by_verdict: [], snapshot_hash: null, signal_count: 0, generated_at: null },
    deal_doctor: dealDoctorSlice || { findings: [], groups: [], finding_count: 0, signal_count: 0, generated_at: null },
    micro_market: microMarketSlice || { classification: { locality_code: null, confidence: null }, locality: null, benchmarks: [], demand_signals: [], reason: 'unavailable' },
    best_use: bestUseSlice,
    deal_structure_recommender: dealStructureSlice || { scores: [], reason: 'unavailable' },
    capital_stack_optimizer: capitalStackSlice,
    karnataka_rera_readiness: reraReadinessSlice || { applicable: false, applicability: null, reason_if_not: 'unavailable', overall: null, buckets: [], gaps: [], fee_estimate: null, milestone: null, conditional_notes: [], consistency: null, compliance_calendar: null },
    ic_readiness: icReadinessSlice || { applicable: true, overall: null, buckets: [], gaps: [] },
    // Deal Register (rent roll / sales & collections / hotel / occupants) —
    // summary + settings only; the tab fetches full rows on demand via
    // GET /deals/:id/rent-roll. Null until the register exists (or before the
    // 20260726 migration is applied) — a valid empty state.
    rent_roll: await rentRollService.getWorkspaceSlice(dealId).catch(() => null),
    generatedAt: new Date().toISOString(),
  };

  // Populate the deterministic cache for the next reader (lite path only).
  // The version key was already computed for the read attempt above, so this
  // adds no extra version query.
  //
  // AWAITED, deliberately. This was `.catch(() => {})` fire-and-forget, which
  // reads as the safe choice and is the opposite: on Vercel the instance
  // FREEZES when the response is sent, so an un-awaited promise is orphaned
  // mid-flight, not backgrounded. `query()` wraps every statement in
  // BEGIN→…→COMMIT, so freezing between the INSERT and the COMMIT stranded an
  // open transaction holding this row's ON CONFLICT lock. The row is keyed per
  // (deal, ORG), so every teammate opening that deal then queued behind it
  // until `statement_timeout` (2 min) cancelled them — which is exactly the
  // "canceling statement due to statement timeout" seen in production. Those
  // errors named the INSERT as the victim of an EARLIER request's orphan.
  //
  // Awaiting guarantees COMMIT or ROLLBACK happens inside the invocation, so
  // the lock is always released. It costs only the upsert latency (single-digit
  // ms for a ~125 KB payload) and only on cache MISSES — hits return earlier
  // and never write. write() bounds itself with SET LOCAL lock_timeout and
  // swallows its own errors, so awaiting can neither block nor fail this
  // response. CLAUDE.md: "No long-lived workers or background assumptions in
  // request handlers" — a dangling promise is a background assumption.
  if (lite && liteVersionKey) {
    await dealWorkspaceCache.write(dealId, liteVersionKey, payload);
  }

  return payload;
}

module.exports = {
  getDealWorkspace,
};
