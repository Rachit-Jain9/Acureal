import { useMutation, useQueryClient } from '@tanstack/react-query';
import { extractionAPI } from '../services/api';
import { toast } from '../components/common/Toast';

/**
 * Mutation hook for POST /api/deals/:dealId/apply-extractions (PR-NX25).
 *
 * On success:
 *   - Invalidates the deal query so the Overview tab + everywhere else
 *     re-reads the now-populated fields.
 *   - Invalidates the extractions query so the modal re-opens with the
 *     just-consumed extractions marked as "applied".
 *   - Invalidates the audit-log query so the deal timeline shows the
 *     new "Fields applied from documents" entry.
 *   - Surfaces a success toast summarizing what landed.
 *
 * On error: surfaces a toast with the server-provided message (or a
 * generic fallback) and rejects the promise so the caller can react.
 */
export function useApplyExtractions(dealId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (approved) => {
      const res = await extractionAPI.applyToDeal(dealId, approved);
      return res.data?.data;
    },
    onSuccess: (data) => {
      // Refresh everything that depends on deal state
      queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
      queryClient.invalidateQueries({ queryKey: ['extractions', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-audit-log', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      queryClient.invalidateQueries({ queryKey: ['property', data?.property?.id] });

      const appliedN = data?.applied?.length || 0;
      const skippedN = data?.skipped?.length || 0;
      if (appliedN === 0) {
        toast.error(
          skippedN > 0
            ? `No fields applied — all ${skippedN} rejected by validation. See modal for details.`
            : 'No fields applied.',
        );
      } else {
        const tail = skippedN ? ` (${skippedN} skipped)` : '';
        toast.success(`Applied ${appliedN} field${appliedN === 1 ? '' : 's'} to the deal${tail}.`);
      }
    },
    onError: (err) => {
      const msg = err?.response?.data?.message
        || err?.message
        || 'Failed to apply extractions to the deal.';
      toast.error(msg);
    },
  });
}
