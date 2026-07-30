import { useQuery } from '@tanstack/react-query';
import { intelligenceAPI } from '../services/api';

/**
 * The deterministic evidence ledger for a deal — every material figure the IC
 * decision rests on, each tagged with an honest typed source (kernel-computed /
 * analyst-set / Acureal benchmark / deal records / verified feed). Backs the
 * Provenance tab.
 *
 * Composed entirely server-side (icEvidence.service.getEvidenceLedger); the
 * client is a pure renderer. Soft-fails to `{ available: false }` for an
 * un-computed / unreadable deal so the tab shows an honest empty state.
 */
export function useDealEvidenceLedger(dealId) {
  return useQuery({
    queryKey: ['deal-evidence-ledger', dealId],
    queryFn: () => intelligenceAPI.getIcMemoEvidence(dealId).then((r) => r.data?.data ?? { available: false }),
    enabled: !!dealId,
    staleTime: 60_000,
  });
}
