import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compsReviewQueueAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const QUEUE_KEY = 'comps-review-queue';

const errMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

export function useCompsReviewQueueList({ status, source, limit = 50, offset = 0, assignedToMe = false } = {}) {
  return useQuery({
    queryKey: [QUEUE_KEY, 'list', { status, source, limit, offset, assignedToMe }],
    queryFn: () =>
      compsReviewQueueAPI
        .list({ status, source, limit, offset, assignedToMe: assignedToMe || undefined })
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

// Manual batch trigger for the entire pending_extraction backlog.
// The cron worker only runs once-daily on Vercel Hobby, so this button
// is the reviewer's escape hatch when fresh items have just landed.
export function useProcessPendingBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (limit = 25) =>
      compsReviewQueueAPI.processPending(limit).then((r) => r.data.data),
    onSuccess: (summary) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      const { picked = 0, processed = 0, failed = 0, skipped = 0 } = summary || {};
      if (picked === 0) {
        toast.success('No pending items to process');
      } else {
        const parts = [`${processed} extracted`];
        if (failed) parts.push(`${failed} failed`);
        if (skipped) parts.push(`${skipped} skipped`);
        toast.success(`Processed ${picked} item${picked === 1 ? '' : 's'} — ${parts.join(', ')}`);
      }
    },
    onError: (err) => toast.error(errMessage(err, 'Batch process failed')),
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

// Bulk approve — accepts an array of queue ids. Per-id failures land in
// `data.failed`; the toast summarises succeeded vs failed counts so the
// analyst doesn't need to open the network tab to understand outcomes.
export function useBulkApproveQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => compsReviewQueueAPI.bulkApprove(ids).then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      qc.invalidateQueries({ queryKey: ['comps'] });
      const { succeeded_count = 0, failed_count = 0 } = data || {};
      if (failed_count === 0) {
        toast.success(`Approved ${succeeded_count} item${succeeded_count === 1 ? '' : 's'}`);
      } else {
        toast.error(`Approved ${succeeded_count}, ${failed_count} failed — see queue for details`);
      }
    },
    onError: (err) => toast.error(errMessage(err, 'Bulk approve failed')),
  });
}

export function useBulkRejectQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, reason }) =>
      compsReviewQueueAPI.bulkReject(ids, reason).then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      const { succeeded_count = 0, failed_count = 0 } = data || {};
      if (failed_count === 0) {
        toast.success(`Rejected ${succeeded_count} item${succeeded_count === 1 ? '' : 's'}`);
      } else {
        toast.error(`Rejected ${succeeded_count}, ${failed_count} failed — see queue for details`);
      }
    },
    onError: (err) => toast.error(errMessage(err, 'Bulk reject failed')),
  });
}

// Bulk reassign — sets assigned_to on each row (or null to unassign).
// Surfaces the migration-pending 503 (queue_assignment_column_missing) as
// a clear toast so the operator knows what to apply.
export function useBulkReassignQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, assignedTo }) =>
      compsReviewQueueAPI.bulkReassign(ids, assignedTo).then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      const { succeeded_count = 0, failed_count = 0, target_user_id } = data || {};
      const verb = target_user_id ? 'Reassigned' : 'Unassigned';
      if (failed_count === 0) {
        toast.success(`${verb} ${succeeded_count} item${succeeded_count === 1 ? '' : 's'}`);
      } else {
        toast.error(`${verb} ${succeeded_count}, ${failed_count} skipped (terminal status or not in this org)`);
      }
    },
    onError: (err) => toast.error(errMessage(err, 'Bulk reassign failed')),
  });
}

// Analyst-driven upload — drops a PDF / image / spreadsheet directly into
// the queue without going through email. Useful pre-domain or whenever
// the analyst already has the source document in hand.
export function useManualUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, sender, subject, notes }) =>
      compsReviewQueueAPI
        .manualUpload(file, { sender, subject, notes })
        .then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      if (data?.deduplicated) {
        toast.success('Already in the queue — same file was uploaded earlier');
      } else {
        toast.success('Uploaded — pending extraction');
      }
    },
    onError: (err) => toast.error(errMessage(err, 'Upload failed')),
  });
}
