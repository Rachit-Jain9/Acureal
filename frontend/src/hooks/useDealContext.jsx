import { createContext, useContext, useMemo } from 'react';
import { useDealWorkspace, useDealWorkspaceLite } from './useDeals';

/**
 * Reactive deal-workspace context (TODO_ARCHITECTURE Phase A).
 *
 * Wraps the existing `useDealWorkspace(dealId)` query and exposes its
 * payload to descendants via React context. Tabs that opt in can call
 * `useDealContext()` instead of receiving 30 props from `DealDetailPage`.
 *
 * Why bother:
 *   - One source of truth for the deal page. A mutation that invalidates
 *     `['deal-workspace', dealId]` flows through every tab automatically.
 *   - Tabs become testable in isolation (mock the context, not props).
 *   - Sets up the count-up cascade, override-history drawer, and
 *     reactive what-if (Phase B–D from `TODO_ARCHITECTURE.md`) without
 *     more prop plumbing.
 *
 * What this PR does:
 *   - Exposes the provider + hook + 5 typed selector hooks.
 *   - Wires the provider into `DealDetailPage`. Existing tab prop
 *     interfaces stay unchanged so this is purely additive — tabs migrate
 *     to `useDealContext` one at a time in follow-up PRs.
 *
 * Selector hooks return stable references via `useMemo` so consumers
 * that only read part of the workspace don't re-render on unrelated
 * changes.
 */

const DealContext = createContext(null);

/**
 * Two-phase deal-workspace read, shared by the DealContextProvider AND
 * DealDetailPage's page-level loading gate so they agree on when to paint.
 * Both subscribe to the same React-Query keys, so there is no double fetch.
 *
 * The fast `lite` payload paints the deterministic deal (financials, tabs,
 * risk, DD, comps, recommendation + deal-doctor cards) in ~1-2s; the `full`
 * payload then upgrades the recommendation + deal-doctor card prose in place.
 * On a revisit within the cache window the full payload is already warm, so the
 * page paints complete instantly and `isAiPending` is never set.
 *
 * Returns { workspace, isLoading, isError, error, isAiPending, refetch }:
 *   - isLoading   — true only until EITHER payload lands.
 *   - isError     — true only if NEITHER payload could load (a full-only failure
 *                   degrades to the lite deterministic deal, not a page error).
 *   - isAiPending — deterministic content is shown but the AI prose is still
 *                   generating; panels show a quiet "refining…" hint.
 */
// KNOWN, MEASURED, DELIBERATELY NOT FIXED HERE — see TODO_ARCHITECTURE.
//
// These two fire concurrently and both miss the server-side workspace cache
// (neither has written it yet), so the backend assembles the entire deal
// workspace TWICE per open: 326 SQL round-trips and two ~190 KB responses that
// are 94% identical.
//
// The obvious fix — gating the full request on `lite.data` — is WRONG ON ITS
// OWN and was reverted after being written: it serialises ~4.2 s + ~3.6 s and
// makes the page slower than the waste it removes. It is only a win alongside
// a backend change letting full mode read the same cache and re-run only what
// lite genuinely omits (activity, deal events, the two narration passes).
// Both halves, one PR, with a before/after query-count probe.
export function useDealWorkspaceWithLite(dealId) {
  const full = useDealWorkspace(dealId);
  const lite = useDealWorkspaceLite(dealId);
  return useMemo(
    () => {
      const workspace = full.data ?? lite.data ?? null;
      return {
        workspace,
        isLoading: !workspace && (full.isLoading || lite.isLoading),
        isError: !workspace && full.isError && lite.isError,
        error: full.error || lite.error || null,
        isAiPending: !!workspace && full.isLoading,
        refetch: full.refetch,
      };
    },
    [
      full.data, lite.data, full.isLoading, lite.isLoading,
      full.isError, lite.isError, full.error, lite.error, full.refetch,
    ],
  );
}

export function DealContextProvider({ dealId, children }) {
  const merged = useDealWorkspaceWithLite(dealId);
  const value = useMemo(() => ({ dealId, ...merged }), [dealId, merged]);
  return <DealContext.Provider value={value}>{children}</DealContext.Provider>;
}

/**
 * Read the current deal context. Throws if called outside a
 * `<DealContextProvider>` so call sites surface the bug at mount rather
 * than producing silent undefined-deal data downstream.
 */
export function useDealContext() {
  const ctx = useContext(DealContext);
  if (!ctx) {
    throw new Error(
      'useDealContext must be called inside <DealContextProvider>. Ensure the deal page mounts the provider before its children.',
    );
  }
  return ctx;
}

// ── Selector hooks ─────────────────────────────────────────────────────────
// Each returns a stable reference via `useMemo` so a consumer rerenders
// only when its own slice changes.
//
// PR-NX62 (2026-05-19) — CONTRACT ALIGNMENT WITH BACKEND.
// Pre-NX62 the selectors read fields like `workspace.financials.kpis`,
// `workspace.risk_flags`, `workspace.events`, `workspace.documents` (the
// `documents` array directly). NONE of those paths existed on the actual
// `GET /api/deals/:id/workspace` response — the backend returns:
//
//   workspace.financial.summary.model_params.kpis  (NOT workspace.financials.kpis)
//   workspace.risk.flags                            (NOT workspace.risk_flags)
//   workspace.financial.auditEvents                 (NOT workspace.events)
//   workspace.documents.documents                   (an object wrapping the array,
//                                                    NOT a flat array)
//
// As a result, every consumer of these selectors silently received
// `null` or `[]` in production while the tests passed because the test
// mocks used the SAME wrong shape the selectors expected. This PR fixes
// the contract and updates the tests to mock the actual backend shape.
//
// Source of truth for the response shape: `backend/src/services/dealWorkspace.service.js`
// `getDealWorkspace` — keep this comment in sync if that file changes.

export function useDealRecord() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.deal || null, [workspace?.deal]);
}

export function useDealKpis() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.financial?.summary?.model_params?.kpis || null,
    [workspace?.financial?.summary?.model_params?.kpis],
  );
}

// PR-NX74 (2026-05-19) HOTFIX — every array selector below is defensive
// against the SERVICE wrapper shape some backend services return.
// Specifically: `listActivities()` in activity.service.js returns
// `{data: [...], pagination: {...}}`, NOT a flat array. When the workspace
// endpoint passes that through as `workspace.activities`, a consumer doing
// `[...activities].sort()` (ActivityTab line 81) throws "is not iterable"
// in production (minifies to "i is not iterable").
//
// Each array selector now defensively handles all THREE shapes:
//   1. a flat array              [item, item]                    ✓
//   2. a `{data: [...]}` envelope `{data: [item, item], ...}`    ✓ (unwraps)
//   3. null/undefined             — returns []                    ✓
//
// useDealDocuments additionally unwraps the `{documents: [...]}` envelope
// that `documentService.getDocuments()` returns.
const coerceArray = (value, primaryKey = 'data') => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (Array.isArray(value[primaryKey])) return value[primaryKey];
    if (Array.isArray(value.data)) return value.data;
  }
  return [];
};

/**
 * Returns the deal's risk flags array. Source: workspace.risk.flags
 * (composed from `deal.risk_flags` server-side; see dealWorkspace.service.js).
 * Falls back to the legacy `deal.risk_flags` shape for defensive read so a
 * partially-shaped workspace (e.g. error path that filled in only the deal)
 * still surfaces flags.
 */
export function useDealRedFlags() {
  const { workspace } = useDealContext();
  return useMemo(
    () => {
      // Prefer workspace.risk.flags when the risk slice is present (even
      // if empty — `[]` is a legitimate "no flags logged" state). Fall back
      // to deal.risk_flags only when the risk slice itself is absent
      // (partially-shaped workspace from error-path degradation).
      if (workspace?.risk?.flags !== undefined) return coerceArray(workspace.risk.flags);
      return coerceArray(workspace?.deal?.risk_flags);
    },
    [workspace?.risk?.flags, workspace?.deal?.risk_flags],
  );
}

/**
 * Returns the kernel audit-event tail. Source: workspace.financial.auditEvents
 * (server limit ACTIVITY/EVENT cap; see dealWorkspace.service.js).
 */
export function useDealEvents() {
  const { workspace } = useDealContext();
  return useMemo(
    () => coerceArray(workspace?.financial?.auditEvents),
    [workspace?.financial?.auditEvents],
  );
}

/**
 * Returns the documents array. Source: workspace.documents.documents
 * (server wraps the array in `{documents, grouped}` for easy access to
 * both views — this selector returns the flat array only).
 */
export function useDealDocuments() {
  const { workspace } = useDealContext();
  return useMemo(
    () => coerceArray(workspace?.documents, 'documents'),
    [workspace?.documents],
  );
}

export function useDealActivities() {
  const { workspace } = useDealContext();
  return useMemo(() => coerceArray(workspace?.activities), [workspace?.activities]);
}

// PR-NX62 — additional Phase A selectors that round out the workspace
// payload. These mirror the backend shape exactly so future tab migrations
// (Phase A1 — DocumentsTab, DDTab, RiskTab, ActivityTab) can drop their
// per-domain useQuery hooks in favor of these.

/**
 * Returns the DD items array + the score envelope. Source:
 * workspace.dd.items + workspace.dd.score.
 */
export function useDealDDItems() {
  const { workspace } = useDealContext();
  return useMemo(() => coerceArray(workspace?.dd?.items), [workspace?.dd?.items]);
}

export function useDealDDScore() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.dd?.score || null, [workspace?.dd?.score]);
}

export function useDealRiskScore() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.risk?.score || null, [workspace?.risk?.score]);
}

export function useDealApprovals() {
  const { workspace } = useDealContext();
  return useMemo(() => coerceArray(workspace?.approvals), [workspace?.approvals]);
}

export function useDealFinancialSummary() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.financial?.summary || null,
    [workspace?.financial?.summary],
  );
}

export function useDealReadiness() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.readiness || { summary: null, nextSteps: [] },
    [workspace?.readiness],
  );
}

/**
 * Returns the recommendation-engine slice for the deal.
 * Shape: `{ recommendations, snapshot_hash, signal_count, generated_at }`.
 *
 * Source: workspace.recommendations (composed server-side in
 * dealWorkspace.service.js via the recommendation engine).
 *
 * Cards in the array carry `ai_narratable: false` on the four legal-carve-out
 * topics (legal_title, legal_rera, legal_approvals, legal_encumbrance) and
 * the AI narrator (when it lands) MUST NOT rephrase those cards. The
 * frontend renders `verb`, `topic_label`, `headline`, `detail`, and the
 * `evidence` array as a click-through chain.
 */
export function useDealRecommendations() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.recommendations || { recommendations: [], snapshot_hash: null, signal_count: 0, generated_at: null },
    [workspace?.recommendations],
  );
}

/**
 * Returns the AI Deal Doctor slice: diagnostic findings grouped by theme.
 * Same signal layer as recommendations but with diagnostic verbs and a
 * tone-classifier gate on any AI-narrated copy. Legal-carve-out findings
 * (RERA, approvals, title, encumbrance) ship as deterministic templates.
 *
 * Source: workspace.deal_doctor (composed server-side in dealWorkspace.service.js).
 */
export function useDealDoctor() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.deal_doctor || { findings: [], groups: [], finding_count: 0, signal_count: 0, generated_at: null },
    [workspace?.deal_doctor],
  );
}

/**
 * Returns the Micro-Market Intelligence slice: classification of the deal's
 * parcel into one of the 20 Bengaluru micro-markets + per-locality benchmarks
 * (price/rent/yield/cap rate percentile bands) + demand drivers (transit,
 * supply pressure, infra triggers, buyer-segment mix). All numbers carry an
 * explicit `confidence` field — 'low' must never be silently dressed up.
 *
 * Source: workspace.micro_market (composed server-side in dealWorkspace.service.js
 * via `microMarketIntelligence.classifyParcel` + `getBriefing`).
 */
export function useDealMicroMarket() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.micro_market || { classification: { locality_code: null, confidence: null }, locality: null, benchmarks: [], demand_signals: [], reason: 'unavailable' },
    [workspace?.micro_market],
  );
}

/**
 * Returns the Best Use Simulator slice — Phase 2 / Pillar 2. For the deal's
 * micro-market, scores the seven core asset classes (residential apartments,
 * plotted, commercial office, retail, industrial / warehousing, hospitality,
 * mixed-use) on fitness to monetise the site. Output is ranked desc with
 * per-class score, band, verdict (closed dictionary), 3-line rationale, and
 * five sub-factor scores.
 *
 * Source: workspace.best_use (composed server-side in dealWorkspace.service.js
 * via `bestUseSimulator.scoreFromBriefing` — no extra DB round-trip; pure
 * compute over the already-fetched micro-market briefing).
 */
export function useDealBestUse() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.best_use || { classification: { locality_code: null, confidence: null }, locality: null, scores: [], reason: 'unavailable' },
    [workspace?.best_use],
  );
}

/**
 * Returns the Deal-Structure Recommender slice — Phase 2 / Pillar 3.
 * For the deal's asset class + promoter posture + micro-market context,
 * ranks the eight deal structures (outright, JV, JDA, revenue_share,
 * area_share, profit_share, ground_lease, hybrid) on strategic fit.
 *
 * Source: workspace.deal_structure_recommender (composed server-side via
 * `dealStructureRecommender.scoreFromContext` — no extra DB round-trip;
 * pure compute over the deal + already-loaded promoter posture +
 * micro-market briefing).
 */
export function useDealStructureRecommender() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.deal_structure_recommender || { scores: [], reason: 'unavailable' },
    [workspace?.deal_structure_recommender],
  );
}

/**
 * Returns the Capital-Stack Optimizer slice — Phase 2 / Pillar 3 (second
 * half). For the deal's asset class + kernel-computed financial summary,
 * proposes three capital-stack scenarios (Conservative / Base / Aggressive)
 * with covenant-band checks against Indian-bank lending norms.
 *
 * Source: workspace.capital_stack_optimizer (composed server-side via
 * `capitalStackOptimizer.scoreFromFinancials` — pure compute over the
 * already-loaded financial summary; no extra DB round-trips, no kernel
 * re-run).
 */
export function useDealCapitalStack() {
  const { workspace } = useDealContext();
  return useMemo(
    () => workspace?.capital_stack_optimizer || { scenarios: [], reason: 'unavailable' },
    [workspace?.capital_stack_optimizer],
  );
}

/**
 * Returns the Karnataka RERA Readiness Pack slice — Phase 3 / Pillar 4.
 * For applicable asset classes (residential / plotted / villas / mixed-use /
 * redevelopment), surfaces the K-RERA readiness checklist across 7 buckets
 * with per-item evidence status (verified / uploaded / available / pending
 * / missing), bucket completeness, overall completeness %, and a gap list
 * sorted by severity.
 *
 * Source: workspace.karnataka_rera_readiness (composed server-side via
 * `karnatakaReraReadiness.composeReadiness` reading the existing approvals
 * + documents — no kernel re-run, no extra DB round-trips).
 */
export function useDealReraReadiness() {
  const { workspace } = useDealContext();
  return useMemo(
    () =>
      workspace?.karnataka_rera_readiness || {
        applicable: false,
        applicability: null,
        reason_if_not: 'unavailable',
        overall: null,
        buckets: [],
        gaps: [],
        fee_estimate: null,
        milestone: null,
        conditional_notes: [],
        consistency: null,
        compliance_calendar: null,
      },
    [workspace?.karnataka_rera_readiness],
  );
}

/**
 * Returns the IC Readiness Pack slice — Phase 3 / Pillar 5.
 *
 * Companion to the K-RERA Readiness Pack but oriented around IC handoff
 * instead of RERA filing. Always applicable (every deal needs IC
 * readiness, regardless of asset class).
 *
 * 7 IC-focused buckets — Financial Underwriting / Title & Legal /
 * Statutory Approvals / Market & Comps / Promoter & Execution / Risk &
 * Diagnosis / Document Hygiene — composed server-side from the deal's
 * already-loaded workspace slices (no extra DB round-trips beyond the
 * comps proximity query). Same five-tier evidence model + completeness
 * score (0-100) + readiness tier (ic_ready / pre_ic / diligence / early).
 *
 * Source: workspace.ic_readiness.
 */
export function useDealIcReadiness() {
  const { workspace } = useDealContext();
  return useMemo(
    () =>
      workspace?.ic_readiness || {
        applicable: true,
        overall: null,
        buckets: [],
        gaps: [],
        disclaimer: null,
      },
    [workspace?.ic_readiness],
  );
}
