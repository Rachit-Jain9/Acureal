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

export function useDealRecord() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.deal || null, [workspace?.deal]);
}

export function useDealKpis() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.financials?.kpis || null, [workspace?.financials?.kpis]);
}

export function useDealRedFlags() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.risk_flags || [], [workspace?.risk_flags]);
}

export function useDealEvents() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.events || [], [workspace?.events]);
}

export function useDealDocuments() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.documents || [], [workspace?.documents]);
}

export function useDealActivities() {
  const { workspace } = useDealContext();
  return useMemo(() => workspace?.activities || [], [workspace?.activities]);
}
