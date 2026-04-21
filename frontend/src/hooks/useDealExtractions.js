import { useQuery } from '@tanstack/react-query';
import { extractionAPI } from '../services/api';

// Deal-scoped extraction roll-up: returns { count, extractions, field_map }.
// Field map is keyed by canonical buildability/underwriting field names —
// land_area_sqft, road_width_m, survey_number, etc. — each pointing to the
// highest-confidence source with a pointer back to the source document.
export function useDealExtractions(dealId) {
  return useQuery({
    queryKey: ['extractions', dealId],
    queryFn: () => extractionAPI.listForDeal(dealId).then((r) => r.data?.data),
    enabled: !!dealId,
    staleTime: 2 * 60 * 1000, // extractions don't change often
  });
}
