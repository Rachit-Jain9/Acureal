import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { approvalsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

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
      qc.invalidateQueries({ queryKey: ['approvals', dealId] });
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
      qc.invalidateQueries({ queryKey: ['approvals', dealId] });
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
      qc.invalidateQueries({ queryKey: ['approvals', dealId] });
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
      qc.invalidateQueries({ queryKey: ['approvals', dealId] });
      toast.success('Approvals checklist seeded');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to seed approvals'),
  });
}
