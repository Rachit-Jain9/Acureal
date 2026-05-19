import { createContext, useContext, useMemo } from 'react';
import { useDealWorkspace } from './useDeals';

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

export function DealContextProvider({ dealId, children }) {
  const query = useDealWorkspace(dealId);

  const value = useMemo(
    () => ({
      dealId,
      workspace: query.data || null,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error || null,
      refetch: query.refetch,
    }),
    [dealId, query.data, query.isLoading, query.isError, query.error, query.refetch],
  );

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
