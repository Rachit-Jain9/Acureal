import { useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendationsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

/**
 * PR-C — operator verdict on a recommendation card.
 *
 * Returns a mutation:
 *   mutate({ dealId, ruleId, verdict, reason?, snoozeDays?,
 *            snoozeUntilSnapshotChange?, snapshotHash?,
 *            topic?, verb?, severity? })
 *
 * On success: invalidates the workspace cache so the dismissed / snoozed
 * card disappears from the panel on the next render. Toast confirms the
 * action and tells the operator how to undo (re-open the dismissed list,
 * click "Restore").
 */
export function useRecommendationVerdict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, ruleId, ...payload }) =>
      recommendationsAPI.postVerdict(dealId, ruleId, payload).then((r) => r.data),
    onSuccess: (_data, vars) => {
      // Invalidate the shared workspace query so the panel rerenders
      // without the just-dismissed card.
      queryClient.invalidateQueries({ queryKey: ['deal-workspace', vars.dealId] });
      const verb = vars.verdict;
      if (verb === 'dismissed') {
        toast.success('Recommendation dismissed. Re-open from the panel header to restore.');
      } else if (verb === 'snoozed') {
        toast.success('Recommendation snoozed. It will reappear once the deal state changes (or the snooze expires).');
      } else if (verb === 'acted') {
        toast.success('Marked as acted-on. The card stays visible so the audit trail shows your follow-through.');
      }
    },
    onError: () => {
      toast.error('Could not save the verdict. Please try again.');
    },
  });
}
