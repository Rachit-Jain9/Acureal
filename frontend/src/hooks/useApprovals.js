import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { approvalsAPI } from '../services/api';
import { toast } from '../components/common/Toast';
import { invalidateDealPosture } from './dealPostureQueries';

export function useApprovals(dealId) {
  return useQuery({
    queryKey: ['approvals', dealId],
    queryFn: () => approvalsAPI.list(dealId).then((r) => r.data.data ?? r.data),
    enabled: !!dealId,
  });
}

export function useCreateApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => approvalsAPI.create(dealId, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      // Approvals feed the Approvals & Regulatory radar category — invalidate
      // the full posture surface so per-deal and portfolio rollups stay in
      // sync.
      invalidateDealPosture(qc, dealId);
      toast.success('Approval item added');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add approval item'),
  });
}

export function useUpdateApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id, data }) => approvalsAPI.update(dealId, id, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('Approval item updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update approval item'),
  });
}

export function useDeleteApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id }) => approvalsAPI.delete(dealId, id),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('Approval item removed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove approval item'),
  });
}

export function useSeedApprovals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId }) => approvalsAPI.seed(dealId).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('Approvals checklist seeded');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to seed approvals'),
  });
}
