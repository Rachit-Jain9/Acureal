import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { riskAPI } from '../services/api';
import { toast } from '../components/common/Toast';

export function useRiskFlags(dealId) {
  return useQuery({
    queryKey: ['risk-flags', dealId],
    queryFn: () => riskAPI.list(dealId).then((r) => r.data.data ?? r.data),
    enabled: !!dealId,
  });
}

export function useRiskScore(dealId) {
  return useQuery({
    queryKey: ['risk-score', dealId],
    queryFn: () => riskAPI.score(dealId).then((r) => r.data.data ?? r.data),
    enabled: !!dealId,
  });
}

export function useCreateRiskFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => riskAPI.create(dealId, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['risk-flags', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-score', dealId] });
      toast.success('Risk flag added');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add risk flag'),
  });
}

export function useUpdateRiskFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id, data }) => riskAPI.update(dealId, id, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['risk-flags', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-score', dealId] });
      toast.success('Risk flag updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update risk flag'),
  });
}

export function useDeleteRiskFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id }) => riskAPI.delete(dealId, id),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['risk-flags', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-score', dealId] });
      toast.success('Risk flag removed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove risk flag'),
  });
}
