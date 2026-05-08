import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compsReviewQueueAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const QUEUE_KEY = 'comps-review-queue';

const errMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

export function useCompsReviewQueueList({ status, source, limit = 50, offset = 0 } = {}) {
  return useQuery({
    queryKey: [QUEUE_KEY, 'list', { status, source, limit, offset }],
    queryFn: () =>
      compsReviewQueueAPI
        .list({ status, source, limit, offset })
        .then((r) => ({ data: r.data.data, pagination: r.data.pagination })),
    // Pending items are time-sensitive — refresh on focus, every 60s in background.
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useCompsReviewQueueRow(id) {
  return useQuery({
    queryKey: [QUEUE_KEY, 'row', id],
    queryFn: () => compsReviewQueueAPI.get(id).then((r) => r.data.data),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useProcessQueueRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => compsReviewQueueAPI.process(id).then((r) => r.data.data),
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      qc.invalidateQueries({ queryKey: [QUEUE_KEY, 'row', id] });
      if (data?.status === 'failed') {
        toast.error(`Extraction failed — ${data.error || 'unknown error'}`);
      } else if (data?.reason === 'already_processed') {
        toast.success('Already processed');
      } else if (data?.reason === 'body_only') {
        toast.success('Body-only ingest — no attachment to extract');
      } else {
        toast.success('Extraction complete — review pending');
      }
    },
    onError: (err) => toast.error(errMessage(err, 'Failed to process queue row')),
  });
}

export function useSaveReviewerEdits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, notes }) =>
      compsReviewQueueAPI.edit(id, payload, notes).then((r) => r.data.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY, 'row', id] });
      toast.success('Edits saved');
    },
    onError: (err) => toast.error(errMessage(err, 'Failed to save edits')),
  });
}

export function useApproveQueueRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => compsReviewQueueAPI.approve(id).then((r) => r.data.data),
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      qc.invalidateQueries({ queryKey: [QUEUE_KEY, 'row', id] });
      // Comps changed — refresh the comps page too.
      qc.invalidateQueries({ queryKey: ['comps'] });
      const msg =
        data?.skipped_count > 0
          ? `Committed ${data.committed_count} of ${data.committed_count + data.skipped_count} comps (${data.skipped_count} skipped — see details)`
          : `Committed ${data.committed_count} comp${data.committed_count === 1 ? '' : 's'} to the database`;
      toast.success(msg);
    },
    onError: (err) => toast.error(errMessage(err, 'Approve failed')),
  });
}

export function useRejectQueueRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => compsReviewQueueAPI.reject(id, reason).then((r) => r.data.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      qc.invalidateQueries({ queryKey: [QUEUE_KEY, 'row', id] });
      toast.success('Marked as rejected');
    },
    onError: (err) => toast.error(errMessage(err, 'Reject failed')),
  });
}
