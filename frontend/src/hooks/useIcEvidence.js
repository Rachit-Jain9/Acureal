import { useQuery } from '@tanstack/react-query';
import { intelligenceAPI } from '../services/api';

// Workstream A (Provenance Spine) — the deterministic evidence ledger beneath
// the IC memo: every material number with its typed, traceable source.
// Read-only display; the panel hides itself when the payload is unavailable.
export function useIcEvidence(dealId) {
  return useQuery({
    queryKey: ['ic-memo-evidence', dealId],
    queryFn: () => intelligenceAPI.getIcMemoEvidence(dealId).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
