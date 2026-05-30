import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dealsAPI } from '../services/api';
import { toast } from '../components/common/Toast';
import { invalidatePortfolioRollups } from './dealPostureQueries';

export function useDeals(params = {}) {
  return useQuery({
    queryKey: ['deals', params],
    queryFn: () => dealsAPI.list(params).then((r) => r.data),
  });
}

export function useDeal(id) {
  return useQuery({
    queryKey: ['deal', id],
    queryFn: () => dealsAPI.get(id).then((r) => r.data.data),
    enabled: !!id,
  });
}

/**
 * Unified deal workspace query.
 *
 * Returns a single grounded payload for the whole deal workspace UI (deal,
 * financials, scenarios, provenance graph, DD/risk, audit events, documents,
 * activities, waterfall). Replaces the old pattern where each tab fired its
 * own query on mount — one round-trip instead of ~7.
 *
 * Mutations that change any slice should invalidate both this key and the
 * legacy `['deal', id]` key so consumers that still use `useDeal` see the
 * update.
 */
// The deal-workspace payload is server-composed and includes AI-narrated
// recommendation/deal-doctor prose. A short staleTime made every route
// remount past the window refire the whole read — re-running server-side
// narration (and, before caching, paying for it again). 5 min matches the
// global default; every workspace-mutating hook below invalidates
// ['deal-workspace', id], so edits still refresh immediately — only passive
// revisits within a working session now reuse the warm cache.
const WORKSPACE_STALE_TIME = 5 * 60_000;

export function useDealWorkspace(id) {
  return useQuery({
    queryKey: ['deal-workspace', id],
    queryFn: () => dealsAPI.getWorkspace(id).then((r) => r.data.data),
    enabled: !!id,
    staleTime: WORKSPACE_STALE_TIME,
  });
}

/**
 * Imperative prefetch for a deal's workspace payload.
 *
 * Returns a function `(dealId) => Promise<void>` that the caller can hook
 * into a link's `onMouseEnter` / `onFocus`. The first hover starts the
 * network request; by the time the user actually clicks the link, the
 * workspace route renders instantly because `useDealWorkspace(id)` finds
 * a fresh cache entry under the shared queryKey.
 *
 * The returned function returns the underlying `prefetchQuery` Promise
 * so tests can `await` it deterministically. Event-handler callers
 * (onMouseEnter / onFocus) discard the promise — fire-and-forget.
 *
 * Important guardrails:
 *   • Only prefetch when the query isn't already in cache (no thrash).
 *   • Caller is expected to debounce / gate per-element so a fast cursor
 *     sweep over a 12-card list doesn't fan out 12 round-trips. The
 *     simplest pattern is `onMouseEnter` only (one event per card).
 *
 * Cache TTL piggybacks on `useDealWorkspace`'s staleTime — a hover that
 * doesn't lead to a click is wasted bandwidth bounded to that window. Sharing
 * WORKSPACE_STALE_TIME also stops a hover from re-firing the (AI-bearing)
 * workspace read for a deal already fetched within the window.
 */
export function usePrefetchDealWorkspace() {
  const qc = useQueryClient();
  return useCallback((id) => {
    if (!id) return Promise.resolve();
    const key = ['deal-workspace', id];
    if (qc.getQueryData(key)) return Promise.resolve(); // already cached, skip
    return qc.prefetchQuery({
      queryKey: key,
      queryFn: () => dealsAPI.getWorkspace(id).then((r) => r.data.data),
      staleTime: WORKSPACE_STALE_TIME,
    });
  }, [qc]);
}

export function usePipeline() {
  return useQuery({
    queryKey: ['pipeline'],
    queryFn: () => dealsAPI.getPipeline().then((r) => r.data.data),
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => dealsAPI.create(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      invalidatePortfolioRollups(qc);
      toast.success('Deal created');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create deal'),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => dealsAPI.update(id, data).then((r) => r.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', id] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', id] });
      invalidatePortfolioRollups(qc);
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      toast.success('Deal updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update deal'),
  });
}

export function useTransitionStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage, notes }) => dealsAPI.transitionStage(id, stage, notes).then((r) => r.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', id] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', id] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      invalidatePortfolioRollups(qc);
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      toast.success('Stage updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Invalid stage transition'),
  });
}

export function useArchiveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => dealsAPI.archive(id, reason).then((r) => r.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', id] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', id] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      invalidatePortfolioRollups(qc);
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      toast.success('Deal removed from active views');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to archive deal'),
  });
}

export function useRestoreDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => dealsAPI.restore(id).then((r) => r.data),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', id] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', id] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      invalidatePortfolioRollups(qc);
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      toast.success('Deal restored');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to restore deal'),
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => dealsAPI.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      invalidatePortfolioRollups(qc);
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      toast.success('Deal deleted');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete deal'),
  });
}

// ── Bulk operations on the Deals list ─────────────────────────────────────
// Each hook accepts a list of ids + the operation-specific argument.
// The toast aggregates succeeded vs failed counts so the analyst doesn't
// need to open the network tab to understand outcomes.

const invalidateDealsQueries = (qc) => {
  qc.invalidateQueries({ queryKey: ['deals'] });
  qc.invalidateQueries({ queryKey: ['pipeline'] });
  qc.invalidateQueries({ queryKey: ['properties'] });
  qc.invalidateQueries({ queryKey: ['activities'] });
  // Includes ['dashboard'] + ['portfolio-risk-radar'] so the new tile and
  // the legacy KPI strip both refresh after a bulk operation.
  invalidatePortfolioRollups(qc);
};

const bulkToast = (verb, data) => {
  const { succeeded_count = 0, failed_count = 0 } = data || {};
  if (failed_count === 0) {
    toast.success(`${verb} ${succeeded_count} deal${succeeded_count === 1 ? '' : 's'}`);
  } else {
    toast.error(`${verb} ${succeeded_count}, ${failed_count} skipped — see deals list for details`);
  }
};

export function useBulkArchiveDeals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, reason }) => dealsAPI.bulkArchive(ids, reason).then((r) => r.data.data),
    onSuccess: (data) => {
      invalidateDealsQueries(qc);
      bulkToast('Archived', data);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Bulk archive failed'),
  });
}

export function useBulkReassignDeals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, assignedTo }) => dealsAPI.bulkReassign(ids, assignedTo).then((r) => r.data.data),
    onSuccess: (data) => {
      invalidateDealsQueries(qc);
      const verb = data?.target_user_id ? 'Reassigned' : 'Unassigned';
      bulkToast(verb, data);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Bulk reassign failed'),
  });
}

export function useBulkTransitionDeals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, stage, notes }) => dealsAPI.bulkTransitionStage(ids, stage, notes).then((r) => r.data.data),
    onSuccess: (data) => {
      invalidateDealsQueries(qc);
      const stageLabel = data?.target_stage ? `→ ${data.target_stage}` : '';
      bulkToast(`Moved ${stageLabel}`.trim(), data);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Bulk stage transition failed'),
  });
}

// Admin-only — same authz gate as the single-row DELETE /deals/:id.
// The component layer additionally requires a "type DELETE to confirm"
// pattern before firing this mutation.
export function useBulkDeleteDeals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => dealsAPI.bulkDelete(ids).then((r) => r.data.data),
    onSuccess: (data) => {
      invalidateDealsQueries(qc);
      bulkToast('Deleted', data);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Bulk delete failed'),
  });
}
