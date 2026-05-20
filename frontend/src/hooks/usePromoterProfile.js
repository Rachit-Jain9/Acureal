import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { promoterAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// B4 — the promoter / builder track-record profile for a deal. Returns
// { profile, assessment } where assessment carries the deterministic
// execution posture + signals.
export function usePromoterProfile(dealId) {
  return useQuery({
    queryKey: ['promoter-profile', dealId],
    queryFn: () => promoterAPI.get(dealId).then((r) => r.data.data),
    enabled: !!dealId,
  });
}

// Full-document upsert of the promoter profile. Invalidates the profile and
// the Risk Radar (the promoter posture is one of its six failure modes).
export function useUpsertPromoterProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => promoterAPI.upsert(dealId, data).then((r) => r.data.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['promoter-profile', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-radar', dealId] });
      toast.success('Promoter track record saved');
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Could not save the promoter track record'),
  });
}
