import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { promoterAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// B4 — the promoter / builder track-record profile for a deal. Returns
// { profile, assessment, rera } where:
//   • assessment carries the deterministic execution posture + signals
//   • rera carries the K-RERA cross-check (candidates if unlinked,
//     linked promoter + aggregate stats if linked). Phase 1 / Pillar 6.
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

// Confirm a K-RERA promoter as the canonical match for this deal's profile.
// Phase 1 / Pillar 6. The analyst's recorded findings stay sovereign — the
// link only cross-references the public K-RERA index alongside.
export function useLinkReraPromoter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, reraPromoterName, matchConfidence }) =>
      promoterAPI
        .linkRera(dealId, {
          rera_promoter_name: reraPromoterName,
          match_confidence: matchConfidence ?? null,
        })
        .then((r) => r.data.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['promoter-profile', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-radar', dealId] });
      toast.success('Linked to K-RERA promoter');
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Could not link the K-RERA promoter'),
  });
}

// Clear the K-RERA cross-link. The analyst-recorded findings are untouched.
export function useUnlinkReraPromoter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId }) => promoterAPI.unlinkRera(dealId).then((r) => r.data.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['promoter-profile', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-radar', dealId] });
      toast.success('K-RERA link cleared');
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Could not clear the K-RERA link'),
  });
}
