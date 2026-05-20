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
      qc.invalidateQueries({ queryKey: ['risk-radar', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
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
      qc.invalidateQueries({ queryKey: ['risk-radar', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
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
      qc.invalidateQueries({ queryKey: ['risk-radar', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      toast.success('Risk flag removed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove risk flag'),
  });
}

// Tier-1 #4 — runs the cross-document inconsistency detector for a deal.
// On success the user-facing flags list is re-fetched; AI-detected ones
// are tagged via `source === 'ai_detector'` and rendered with a small
// "AI" badge per row.
export function useRunInconsistencyCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dealId) => riskAPI.runInconsistencyCheck(dealId).then((r) => r.data.data),
    onSuccess: (data, dealId) => {
      qc.invalidateQueries({ queryKey: ['risk-flags', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-score', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-radar', dealId] });
      qc.invalidateQueries({ queryKey: ['risk-brief', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      const flagged = data?.persisted_flag_ids?.length ?? 0;
      const dedup = data?.deduplicated_count ?? 0;
      const total = (data?.findings?.length ?? 0);
      if (total === 0) {
        toast.success('No inconsistencies detected — documents agree.');
      } else if (flagged === 0 && dedup > 0) {
        toast.success(`Re-ran detector — ${dedup} finding${dedup === 1 ? '' : 's'} already on the board.`);
      } else {
        toast.success(`Detector flagged ${flagged} new issue${flagged === 1 ? '' : 's'}${dedup ? ` (${dedup} duplicate)` : ''}.`);
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Inconsistency check failed'),
  });
}

// Returns the most recent risk_brief artifact, or null on miss.
export function useRiskBrief(dealId) {
  return useQuery({
    queryKey: ['risk-brief', dealId],
    queryFn: () => riskAPI.getRiskBrief(dealId).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 60_000,
  });
}

// Workstream B — the Deal Risk Radar: a deterministic per-failure-mode
// pre-mortem. Refetches on mount so DD / approval edits made on other tabs
// are reflected when the analyst returns to the Risk tab.
export function useRiskRadar(dealId) {
  return useQuery({
    queryKey: ['risk-radar', dealId],
    queryFn: () => riskAPI.radar(dealId).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 30_000,
  });
}
