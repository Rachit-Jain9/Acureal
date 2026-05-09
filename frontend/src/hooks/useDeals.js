import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dealsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

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
export function useDealWorkspace(id) {
  return useQuery({
    queryKey: ['deal-workspace', id],
    queryFn: () => dealsAPI.getWorkspace(id).then((r) => r.data.data),
    enabled: !!id,
    staleTime: 30_000,
  });
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
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['properties'] });
  qc.invalidateQueries({ queryKey: ['activities'] });
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
