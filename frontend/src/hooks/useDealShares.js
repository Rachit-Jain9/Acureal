import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dealsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// Deal sharing — "who has access to this deal workspace".
//
// The backend (dealShare.service.js) is OWNER-ONLY: only the deal's
// created_by can list / share / revoke, and the invitee must already be an
// active REDIP user. A non-owner who calls listShares always gets `[]`, so
// callers gate the query with `{ enabled: isOwner }` and render a
// "managed by the owner" note instead of an empty list.
export function useDealShares(dealId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['deal-shares', dealId],
    queryFn: () => dealsAPI.listShares(dealId).then((r) => r.data?.data || []),
    enabled: !!dealId && enabled,
  });
}

export function useShareDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, email, permission }) =>
      dealsAPI.shareDeal(dealId, email, permission).then((r) => r.data),
    onSuccess: (_, { dealId, email }) => {
      qc.invalidateQueries({ queryKey: ['deal-shares', dealId] });
      toast.success(`Deal shared with ${email}`);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to share deal'),
  });
}

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, userId }) => dealsAPI.revokeShare(dealId, userId),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal-shares', dealId] });
      toast.success('Access revoked');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to revoke access'),
  });
}
