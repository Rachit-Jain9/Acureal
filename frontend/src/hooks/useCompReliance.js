import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compSimilarityAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// Workstream C1 (the data-network seed) — the set of comp ids the analyst has
// marked as relied-on for this deal. Read-side; degrades to an empty list when
// the migration is not yet applied (the backend returns []).
export function useCompReliance(dealId) {
  return useQuery({
    queryKey: ['comp-reliance', dealId],
    queryFn: () => compSimilarityAPI.reliance(dealId).then((r) => r.data.data.comp_ids || []),
    enabled: !!dealId,
  });
}

// Toggle one comp's reliance for a deal. The deterministic scorer's verdict at
// toggle time rides along so the learning signal carries real context — only
// finite numbers are sent, so null/undefined scorer fields are simply omitted.
export function useToggleCompReliance(dealId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ compId, relied, similarityScore, similarityRank, rateDeltaPct }) => {
      const body = { relied };
      if (Number.isFinite(similarityScore)) body.similarityScore = similarityScore;
      if (Number.isFinite(similarityRank)) body.similarityRank = similarityRank;
      if (Number.isFinite(rateDeltaPct)) body.rateDeltaPct = rateDeltaPct;
      return compSimilarityAPI.setReliance(dealId, compId, body).then((r) => r.data.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comp-reliance', dealId] });
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Could not update comp reliance'),
  });
}
