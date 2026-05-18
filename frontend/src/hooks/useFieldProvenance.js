import { useQuery } from '@tanstack/react-query';
import { dealsAPI } from '../services/api';

/**
 * Live field-provenance map fetch (PR-NX50 — 2026-05-19).
 *
 * Returns the per-field provenance map for a deal — every deal/property
 * field that was auto-applied via document_extraction (PR-NX25 apply-
 * extractions endpoint). Consumed by `<ProvenanceChip>` components to
 * render inline (i) chips next to auto-filled values.
 *
 * Returned data shape (when query resolves):
 *   {
 *     field_provenance: {
 *       'land_area_sqft': {
 *         source: 'document_extraction',
 *         applied_at: ISO string,
 *         applied_by: 'user-uuid',
 *         applied_by_name: 'Rachit Jain',
 *         applied_value: <whatever was applied>,
 *         source_extraction_ids: string[],
 *         source_document_names: ['sale-deed.pdf'],
 *         source_document_types: ['sale_deed'],
 *         target_table: 'deals' | 'properties',
 *         ontology_version: '1.0.0'
 *       },
 *       ...
 *     },
 *     generated_at: ISO string
 *   }
 *
 * Empty map (`{}`) when no auto-fill events exist — chips simply
 * don't render in that case.
 *
 * Stale time: 2 minutes — provenance is moderately stable but mutations
 * via `apply-extractions` should invalidate this query (the
 * useApplyExtractions hook in PR-NX26 already does that).
 */
export function useFieldProvenance(dealId) {
  return useQuery({
    queryKey: ['field-provenance', dealId],
    queryFn: () => dealsAPI.fieldProvenance(dealId).then((r) => r.data?.data),
    enabled: !!dealId,
    staleTime: 2 * 60 * 1000,
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}
