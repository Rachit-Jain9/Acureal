import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ddAPI } from '../services/api';
import { toast } from '../components/common/Toast';
import { invalidateDealPosture } from './dealPostureQueries';

export function useDDItems(dealId) {
  return useQuery({
    queryKey: ['dd-items', dealId],
    queryFn: () => ddAPI.list(dealId).then((r) => r.data.data ?? r.data),
    enabled: !!dealId,
  });
}

export function useDDScore(dealId) {
  return useQuery({
    queryKey: ['dd-score', dealId],
    queryFn: () => ddAPI.score(dealId).then((r) => r.data.data ?? r.data),
    enabled: !!dealId,
  });
}

export function useCreateDDItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => ddAPI.create(dealId, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      // DD items feed the Risk Radar's posture for Title / Approvals /
      // Financial / Physical categories — invalidate the full posture
      // surface so the radar (per-deal AND portfolio) stays in sync.
      invalidateDealPosture(qc, dealId);
      toast.success('DD item added');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add DD item'),
  });
}

export function useUpdateDDItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id, data }) => ddAPI.update(dealId, id, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('DD item updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update DD item'),
  });
}

export function useUpdateDDItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id, status }) => ddAPI.updateStatus(dealId, id, status).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      // Status changes are the primary driver of category posture flips
      // (pending → completed clears a category; pending → flagged flags it).
      // No toast — the checkbox is the affordance, success is already visual.
      invalidateDealPosture(qc, dealId);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update status'),
  });
}

export function useDeleteDDItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id }) => ddAPI.delete(dealId, id),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('DD item removed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove DD item'),
  });
}

export function useSeedDDChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId }) => ddAPI.seed(dealId).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      // The seed creates a fresh checklist — the deal record itself
      // surfaces "has_dd_checklist", so invalidate the legacy deal key too.
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      toast.success('DD checklist seeded');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to seed DD checklist'),
  });
}
