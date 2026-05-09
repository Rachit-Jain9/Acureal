import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dealQaAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const errMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

// Tier-2 #11 — most-recent N Q&A rows for a deal. Used by the deal
// Overview tab to show conversation history alongside the active input.
export function useDealQaHistory(dealId, { limit = 10 } = {}) {
  return useQuery({
    queryKey: ['deal-qa-history', dealId, limit],
    queryFn: () => dealQaAPI.history(dealId, limit).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 30_000,
  });
}

// Ask a question. Returns the persisted row on success — UI uses it to
// optimistically render the new entry while history refetches.
export function useAskDealQa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, question }) =>
      dealQaAPI.ask(dealId, question).then((r) => r.data.data),
    onSuccess: (row, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal-qa-history', dealId] });
      if (row?.cache_hit) {
        toast.success('Found a previous answer to this question.');
      }
    },
    onError: (err) => {
      // Backend persists failed attempts too (status='failed') so the
      // UI can render them in history. Surface the message; the row
      // itself comes back via err.response.data.data when available.
      toast.error(errMessage(err, 'Q&A request failed.'));
    },
  });
}

// Delete a single history row — used when an analyst wants to clean up
// a failed/wrong answer before sharing the deal page.
export function useDeleteDealQaRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, rowId }) =>
      dealQaAPI.deleteRow(dealId, rowId).then((r) => r.data.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal-qa-history', dealId] });
      toast.success('Q&A entry removed.');
    },
    onError: (err) => toast.error(errMessage(err, 'Failed to remove entry.')),
  });
}
