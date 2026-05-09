import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Mail, FileText, Globe, Upload, ArrowRight, Clock, AlertTriangle, CheckCircle2, XCircle, Database, Hourglass, RefreshCw, X, Check, Loader2, UserPlus, User, Download } from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../design-system';
import {
  useCompsReviewQueueList,
  useProcessPendingBatch,
  useManualUpload,
  useBulkApproveQueue,
  useBulkRejectQueue,
  useBulkReassignQueue,
} from '../hooks/useCompsReviewQueue';
import { adminAPI, compsReviewQueueAPI } from '../services/api';
import useAuthStore from '../store/authStore';
import { useSavedViews } from '../hooks/useSavedViews';
import SavedViewsMenu from '../components/deals/SavedViewsMenu';
import { downloadAxiosResponse } from '../utils/download';
import { toast } from '../components/common/Toast';

// Queue surface for the analyst — top-level list of ingested comps awaiting
// review, grouped by status (Pending review prioritized).
//
// Per UI/UX standards: skeletons for >100ms loads, status pills cross-fade,
// tabular numerals on every number, semantic tokens only.

const STATUS_FILTERS = [
  { id: 'pending_review',     label: 'Pending review',     tone: 'warn' },
  { id: 'pending_extraction', label: 'Pending extraction', tone: 'info' },
  { id: 'failed',             label: 'Failed',             tone: 'danger' },
  { id: 'rejected',           label: 'Rejected',           tone: 'neutral' },
  { id: 'committed',          label: 'Committed',          tone: 'success' },
];

const SOURCE_FILTERS = [
  { id: null,                  label: 'All sources',  icon: Inbox },
  { id: 'email_broker_quote',  label: 'Broker',       icon: Mail },
  { id: 'email_ipc_report',    label: 'IPC report',   icon: FileText },
  { id: 'email_other',         label: 'Other email',  icon: Mail },
  { id: 'manual_upload',       label: 'Manual',       icon: Upload },
  { id: 'api_listing_portal',  label: 'Listing API',  icon: Globe },
];

// Status icon + tone mapping for individual rows in the list.
const statusVisual = (status) => {
  switch (status) {
    case 'pending_review':     return { icon: AlertTriangle, tone: 'warn',    label: 'Pending review' };
    case 'pending_extraction': return { icon: Hourglass,     tone: 'info',    label: 'Pending extraction' };
    case 'extracting':         return { icon: Clock,         tone: 'info',    label: 'Extracting…' };
    case 'approved':           return { icon: CheckCircle2,  tone: 'info',    label: 'Approved' };
    case 'committed':          return { icon: Database,      tone: 'success', label: 'Committed' };
    case 'failed':             return { icon: AlertTriangle, tone: 'danger',  label: 'Failed' };
    case 'rejected':           return { icon: XCircle,       tone: 'neutral', label: 'Rejected' };
    default:                   return { icon: Clock,         tone: 'neutral', label: status };
  }
};

const sourceShortLabel = (source) => {
  const f = SOURCE_FILTERS.find((s) => s.id === source);
  return f ? f.label : source;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
};

const Pill = ({ active, onClick, children, tone }) => (
  <button
    type="button"
    onClick={onClick}
    className={clsx(
      'px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-150',
      'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      active
        ? 'bg-accent text-white border-accent'
        : 'bg-bg-elevated text-content-secondary border-hairline hover:border-content-muted hover:text-content-primary'
    )}
    data-tone={tone}
  >
    {children}
  </button>
);

const QueueRow = ({ row, selectable, selected, onToggleSelect }) => {
  const visual = statusVisual(row.status);
  const Icon = visual.icon;
  const subject = row.source_meta?.subject || row.source_meta?.attachment_name || '(no subject)';
  const from = row.source_meta?.from || row.source_meta?.from_name || '—';
  const overall = row.confidence_scores?._overall;
  const overallPct = typeof overall === 'number' ? Math.round(overall * 100) : null;

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onToggleSelect?.(row.id);
  };

  return (
    <Link
      to={`/dashboard/admin/comps-queue/${row.id}`}
      className={clsx(
        'group flex items-center gap-4 px-4 py-3.5',
        'border-b border-hairline last:border-b-0',
        'transition-colors duration-100',
        selected ? 'bg-accent-soft/30' : 'hover:bg-bg-secondary',
        'focus-visible:outline-none focus-visible:bg-bg-secondary'
      )}
    >
      {/* Multi-select checkbox — only renders when the current status
          filter supports bulk operations (pending_review). Click is
          stopPropagation'd so it doesn't navigate to the detail page. */}
      {selectable && (
        <button
          type="button"
          onClick={handleCheckboxClick}
          className={clsx(
            'shrink-0 w-4 h-4 rounded border flex items-center justify-center',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            selected
              ? 'bg-accent border-accent text-white'
              : 'bg-bg-elevated border-hairline hover:border-content-muted',
          )}
          aria-pressed={selected}
          aria-label={selected ? 'Deselect row' : 'Select row'}
        >
          {selected && <Check size={11} strokeWidth={3} />}
        </button>
      )}
      {/* Status icon column */}
      <div
        className={clsx(
          'shrink-0 w-9 h-9 rounded-md flex items-center justify-center',
          visual.tone === 'warn'    && 'bg-amber-50 text-amber-700',
          visual.tone === 'info'    && 'bg-sky-50 text-sky-700',
          visual.tone === 'danger'  && 'bg-rose-50 text-rose-700',
          visual.tone === 'success' && 'bg-emerald-50 text-emerald-700',
          visual.tone === 'neutral' && 'bg-bg-secondary text-content-muted'
        )}
      >
        <Icon size={16} />
      </div>

      {/* Identity column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium text-content-primary truncate">{subject}</span>
          <Badge tone="neutral" className="shrink-0 text-[10px]">{sourceShortLabel(row.source)}</Badge>
          {/* Assignee badge — surfaces who picked up this row. Hidden when
              unassigned to keep the row clean. Hydrated server-side by
              listQueue with a single bulk users lookup. */}
          {row.assignee && (
            <Badge tone="info" className="shrink-0 text-[10px] inline-flex items-center gap-1">
              <User size={9} />
              {row.assignee.name || row.assignee.email}
            </Badge>
          )}
        </div>
        <div className="text-xs text-content-muted truncate mt-0.5">
          {from}
          {row.source_meta?.attachment_name && row.source_meta.attachment_name !== subject && (
            <> · <span className="text-content-secondary">{row.source_meta.attachment_name}</span></>
          )}
        </div>
      </div>

      {/* Confidence column (only when extracted) */}
      <div className="shrink-0 w-20 text-right tabular-nums">
        {overallPct !== null ? (
          <span
            className={clsx(
              'text-sm font-medium',
              overallPct >= 80 ? 'text-data-positive' : overallPct >= 50 ? 'text-content-primary' : 'text-data-negative'
            )}
          >
            {overallPct}%
          </span>
        ) : (
          <span className="text-xs text-content-muted">—</span>
        )}
        <div className="text-[10px] uppercase tracking-wider text-content-muted">conf</div>
      </div>

      {/* Status pill column */}
      <div className="shrink-0 w-32 text-right">
        <Badge tone={visual.tone === 'warn' ? 'warn' : visual.tone === 'danger' ? 'danger' : visual.tone === 'success' ? 'success' : visual.tone === 'info' ? 'info' : 'neutral'}>
          {visual.label}
        </Badge>
      </div>

      {/* Time column */}
      <div className="shrink-0 w-24 text-right text-xs text-content-muted tabular-nums">
        {formatDate(row.created_at)}
      </div>

      <ArrowRight
        size={14}
        className="shrink-0 text-content-muted opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </Link>
  );
};

const sourceCount = (rows, sourceId) =>
  sourceId ? rows.filter((r) => r.source === sourceId).length : rows.length;

const ACCEPT_MIME =
  '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.doc,.docx,.xls,.xlsx,.csv,application/pdf,image/*';

// Lightweight upload modal — file picker + optional metadata fields.
// Reuses page-level styling tokens; no decorative chrome.
function UploadModal({ open, onClose, onUploaded }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [sender, setSender] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');

  const upload = useManualUpload();

  if (!open) return null;

  const reset = () => {
    setFile(null);
    setSender('');
    setSubject('');
    setNotes('');
  };

  const close = () => {
    if (upload.isPending) return; // don't allow close mid-upload
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!file) return;
    try {
      const result = await upload.mutateAsync({ file, sender, subject, notes });
      reset();
      onClose();
      if (result?.id) {
        onUploaded?.(result.id);
      }
    } catch {
      // error toast handled in the hook; keep the modal open so the
      // user can retry without re-entering metadata
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={close}
    >
      <div
        className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <h3 className="font-display text-base font-semibold text-content-primary">
            Upload to review queue
          </h3>
          <button
            type="button"
            onClick={close}
            disabled={upload.isPending}
            className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-content-muted">
            Drop a broker quote, IPC report, or rate sheet (PDF / image / Office / CSV, up to 50 MB).
            It lands as <span className="font-mono">pending_extraction</span> — click <span className="font-medium">Process pending now</span> on the queue to extract.
          </p>

          {/* File picker */}
          <div>
            <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              File <span className="text-amber-600">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_MIME}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-content-primary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-hairline file:bg-bg-secondary file:text-content-primary file:text-xs hover:file:bg-bg-elevated cursor-pointer"
            />
            {file && (
              <div className="text-xs text-content-muted mt-1.5 tabular-nums">
                {file.name} · {Math.round(file.size / 1024)} KB
              </div>
            )}
          </div>

          {/* Optional metadata — keeps the source_meta useful even without an email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                Sender <span className="text-content-muted normal-case tracking-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="e.g. analyst@jll.com"
                className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
              />
            </div>
            <div>
              <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                Subject <span className="text-content-muted normal-case tracking-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Q1 2026 Bengaluru office"
                className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Notes <span className="text-content-muted normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Context for the reviewer — provenance, follow-ups, quality flags"
              className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline bg-bg-secondary/40 rounded-b-editorial">
          <button
            type="button"
            onClick={close}
            disabled={upload.isPending}
            className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={upload.isPending || !file}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Upload size={13} />
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompsQueuePage() {
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [sourceFilter, setSourceFilter] = useState(null);
  const [assignedToMe, setAssignedToMe] = useState(false);
  const currentUser = useAuthStore((s) => s.user);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignTargetId, setReassignTargetId] = useState('');

  // Bulk operations only make sense when the status filter is
  // pending_review. Other statuses (committed / rejected) are terminal;
  // the multi-select chrome would be misleading. Selection clears when
  // the filter changes so stale ids never carry over.
  const bulkEligible = statusFilter === 'pending_review';
  useEffect(() => {
    setSelectedIds(new Set());
    setRejectModalOpen(false);
    setRejectReason('');
    setReassignModalOpen(false);
    setReassignTargetId('');
  }, [statusFilter, sourceFilter, assignedToMe]);

  const bulkApprove = useBulkApproveQueue();
  const bulkReject = useBulkRejectQueue();
  const bulkReassign = useBulkReassignQueue();

  // Saved-views store for the queue. Same SavedViewsMenu component as
  // the Deals list (PR #209), pointed at a queue-specific localStorage
  // key so the two pages don't share each other's saved combos.
  const savedViews = useSavedViews({ storageKey: 'redip.compsQueue.savedViews' });

  // Snapshot of the user-controlled filter state — what saved views
  // capture and recall.
  const currentFilters = useMemo(
    () => ({
      status: statusFilter || '',
      source: sourceFilter || '',
      assignedToMe: !!assignedToMe,
    }),
    [statusFilter, sourceFilter, assignedToMe],
  );

  const applySavedView = (view) => {
    const f = view?.filters || {};
    setStatusFilter(f.status || '');
    setSourceFilter(f.source || null);
    setAssignedToMe(!!f.assignedToMe);
  };

  const activeView = savedViews.findActive(currentFilters);
  // Always allow saving — the queue's "default" state (pending_review +
  // no source) is itself a useful named view. Lower bar than DealsPage,
  // which gates save on dirty filters because its empty state shows
  // every active deal.
  const canSaveCurrentView = true;

  // Org users for the reassign user-picker. Only fetched when the modal
  // opens (enabled flag) so the page-load doesn't pay for it. 5-minute
  // staleTime — the org user list barely changes during a session.
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminAPI.listUsers().then((r) => r.data.data),
    enabled: reassignModalOpen,
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, isError, error, refetch } = useCompsReviewQueueList({
    status: statusFilter,
    source: sourceFilter,
    assignedToMe,
    limit: 100,
  });

  // Standalone fetch of the pending_extraction count so the "Process pending
  // now" button can show a live count even when a different status filter
  // is active.
  const { data: pendingData } = useCompsReviewQueueList({
    status: 'pending_extraction',
    limit: 1,
  });
  const pendingTotal = pendingData?.pagination?.total ?? 0;

  const processBatch = useProcessPendingBatch();
  const [uploadOpen, setUploadOpen] = useState(false);

  const rows = data?.data || [];
  const total = data?.pagination?.total ?? 0;

  // Pre-compute counts for the source pills using the *unfiltered* dataset
  // is not possible without a separate fetch, so we compute over the
  // currently-loaded page. This is good-enough — the pills are filters,
  // not totals.
  const counts = useMemo(() => {
    const map = {};
    SOURCE_FILTERS.forEach((s) => { map[s.id ?? 'all'] = sourceCount(rows, s.id); });
    return map;
  }, [rows]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allRowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = bulkEligible && allRowIds.length > 0 && allRowIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allRowIds));
    }
  };

  const handleBulkApprove = async () => {
    if (!someSelected) return;
    const ids = [...selectedIds];
    const ok = window.confirm(`Approve ${ids.length} item${ids.length === 1 ? '' : 's'}? Each will commit its extracted comps to the database.`);
    if (!ok) return;
    try {
      await bulkApprove.mutateAsync(ids);
      setSelectedIds(new Set());
    } catch {
      // hook surfaces toast
    }
  };

  const openBulkReject = () => {
    if (!someSelected) return;
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const handleBulkRejectConfirm = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await bulkReject.mutateAsync({ ids, reason: rejectReason.trim() || null });
      setSelectedIds(new Set());
      setRejectModalOpen(false);
      setRejectReason('');
    } catch {
      // hook surfaces toast — keep modal open so user can retry
    }
  };

  const openBulkReassign = () => {
    if (!someSelected) return;
    setReassignTargetId('');
    setReassignModalOpen(true);
  };

  const handleBulkReassignConfirm = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    // Empty string in the picker means "unassign" — surface as null.
    const assignedTo = reassignTargetId || null;
    try {
      await bulkReassign.mutateAsync({ ids, assignedTo });
      setSelectedIds(new Set());
      setReassignModalOpen(false);
      setReassignTargetId('');
    } catch {
      // toast surfaced by hook
    }
  };

  // CSV export — passes the current filter combination through so the
  // download matches whatever the queue page currently shows. Filename
  // is suffixed with the active saved-view name when one matches so a
  // multi-export workflow ends up with self-describing files.
  const [exportingCsv, setExportingCsv] = useState(false);
  const handleExportCsv = async () => {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (sourceFilter) params.source = sourceFilter;
      if (assignedToMe) params.assignedToMe = true;
      const response = await compsReviewQueueAPI.exportCsv(params);
      const today = new Date().toISOString().slice(0, 10);
      const suffix = activeView ? `-${activeView.name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40).toLowerCase()}` : '';
      downloadAxiosResponse(response, `redip-comps-queue${suffix}-${today}.csv`);
      toast.success(`Exported ${total} item${total === 1 ? '' : 's'} to CSV`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'CSV export failed');
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tier-0 ingestion"
        title="Comps review queue"
        description="Forwarded broker quotes and IPC reports land here for human review before committing to the comps database. Approve, edit, or reject each batch."
        actions={
          <div className="flex items-center gap-2">
            {/* CSV export — respects the current status / source / assigned-to-me
                filter combo. Disabled when the filtered list is empty. */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exportingCsv || total === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              title={
                total === 0
                  ? 'Nothing to export — list is empty'
                  : `Download ${total} matching row${total === 1 ? '' : 's'} as CSV`
              }
            >
              {exportingCsv ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exportingCsv ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              title="Drop a PDF or image directly into the queue (no email needed)"
            >
              <Upload size={14} />
              Upload file
            </button>
            <button
            type="button"
            onClick={() => processBatch.mutate(25)}
            disabled={processBatch.isPending || pendingTotal === 0}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md transition-colors',
              'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              pendingTotal > 0
                ? 'bg-accent text-white border-accent hover:bg-accent/90'
                : 'bg-bg-elevated text-content-muted border-hairline cursor-not-allowed',
              'disabled:opacity-60'
            )}
            title={pendingTotal === 0
              ? 'No pending items'
              : `Run extraction on the ${pendingTotal} pending item${pendingTotal === 1 ? '' : 's'} now`
            }
          >
            <RefreshCw size={14} className={processBatch.isPending ? 'animate-spin' : ''} />
            {processBatch.isPending
              ? 'Processing…'
              : pendingTotal > 0
              ? `Process pending now (${pendingTotal})`
              : 'No pending items'
            }
          </button>
          </div>
        }
      />

      {/* Filter bar */}
      <Card className="p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2 gap-3">
            <div className="text-eyebrow uppercase text-content-muted font-medium">Status</div>
            <div className="flex items-center gap-2">
              {/* "Assigned to me" pill — orthogonal to status/source. Sits in
                  the status row's right side because it's the most-used filter
                  once a team starts dividing up the inbox. Disabled when the
                  user record hasn't loaded yet (rare; the queue page is
                  role-gated). */}
              <button
                type="button"
                onClick={() => setAssignedToMe((v) => !v)}
                disabled={!currentUser?.id}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  'disabled:opacity-50',
                  assignedToMe
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-elevated text-content-secondary border-hairline hover:border-content-muted hover:text-content-primary'
                )}
                title="Show only rows assigned to me"
                aria-pressed={assignedToMe}
              >
                <User size={11} />
                Assigned to me
              </button>
              {/* Saved views — same component as the Deals list. Backed
                  by a queue-specific localStorage key so the two pages'
                  saved combos don't collide. */}
              <SavedViewsMenu
                views={savedViews.views}
                activeView={activeView}
                currentFilters={currentFilters}
                onApply={applySavedView}
                onSave={savedViews.save}
                onRemove={savedViews.remove}
                canSave={canSaveCurrentView}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <Pill
                key={f.id}
                active={statusFilter === f.id}
                onClick={() => setStatusFilter(f.id)}
                tone={f.tone}
              >
                {f.label}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <div className="text-eyebrow uppercase text-content-muted mb-2 font-medium">Source</div>
          <div className="flex flex-wrap gap-2">
            {SOURCE_FILTERS.map((f) => {
              const Icon = f.icon;
              return (
                <button
                  key={f.id ?? 'all'}
                  type="button"
                  onClick={() => setSourceFilter(f.id)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    sourceFilter === f.id
                      ? 'bg-accent-soft text-accent border-accent/30'
                      : 'bg-bg-elevated text-content-secondary border-hairline hover:border-content-muted hover:text-content-primary'
                  )}
                >
                  <Icon size={11} />
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* List */}
      <Card>
        <div className="px-4 pt-4 pb-2 border-b border-hairline">
          <SectionHeader
            size="sm"
            eyebrow="Queue"
            title={statusFilter ? `${STATUS_FILTERS.find((f) => f.id === statusFilter)?.label || statusFilter}` : 'All queue items'}
            sub={
              isLoading
                ? null
                : `${total} item${total === 1 ? '' : 's'}${sourceFilter ? ` · filtered to ${sourceShortLabel(sourceFilter)}` : ''}${assignedToMe ? ' · assigned to me' : ''}`
            }
          />
        </div>

        {isLoading && (
          <div className="p-4">
            <SkeletonList rows={6} />
          </div>
        )}

        {isError && !isLoading && (
          <div className="p-4">
            <ErrorState tone="danger" title="Couldn't load the queue" action={
              <button
                type="button"
                onClick={() => refetch()}
                className="text-sm text-accent hover:underline focus-visible:outline-none focus-visible:underline"
              >
                Try again
              </button>
            }>
              {error?.response?.data?.message || error?.message || 'Network error.'}
            </ErrorState>
          </div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <div className="p-10 text-center">
            <Inbox size={28} className="mx-auto text-content-muted mb-3" />
            <p className="text-sm font-medium text-content-primary">
              {statusFilter === 'pending_review'
                ? 'No items waiting on a reviewer'
                : statusFilter === 'pending_extraction'
                ? 'No items waiting on extraction'
                : statusFilter === 'failed'
                ? 'No failed extractions'
                : statusFilter === 'rejected'
                ? 'Nothing rejected yet'
                : statusFilter === 'committed'
                ? 'No committed batches yet'
                : 'Queue is empty'}
            </p>
            {statusFilter === 'pending_review' ? (
              <>
                <p className="text-xs text-content-muted mt-1 max-w-md mx-auto leading-relaxed">
                  Drag a broker quote, IPC report, or rate-card PDF in to start. The AI extracts the comps; you review and approve before they hit the database.
                </p>
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-accent text-white hover:bg-accent/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <Upload size={14} />
                  Upload your first file
                </button>
                <p className="text-[11px] text-content-muted mt-3">
                  Or forward emails to your Postmark inbound address (configured in admin)
                </p>
              </>
            ) : (
              <p className="text-xs text-content-muted mt-1 max-w-md mx-auto">
                {statusFilter === 'failed'
                  ? 'Healthy state. Extractions that error out land here for retry.'
                  : 'Nothing in this status right now.'}
              </p>
            )}
          </div>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <>
            {/* Select-all header — only renders when bulk operations are
                eligible (pending_review filter). Mirrors the email-client
                pattern: checkbox toggles all on the current page. */}
            {bulkEligible && (
              <div className="flex items-center gap-3 px-4 py-2 border-b border-hairline bg-bg-secondary/40 text-xs">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className={clsx(
                    'shrink-0 w-4 h-4 rounded border flex items-center justify-center',
                    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    allSelected
                      ? 'bg-accent border-accent text-white'
                      : 'bg-bg-elevated border-hairline hover:border-content-muted',
                  )}
                  aria-pressed={allSelected}
                  aria-label={allSelected ? 'Deselect all' : 'Select all'}
                >
                  {allSelected && <Check size={11} strokeWidth={3} />}
                </button>
                <span className="text-content-secondary">
                  {someSelected
                    ? `${selectedIds.size} selected`
                    : 'Select rows for bulk approve / reject'}
                </span>
              </div>
            )}
            <div>
              {rows.map((row) => (
                <QueueRow
                  key={row.id}
                  row={row}
                  selectable={bulkEligible}
                  selected={selectedIds.has(row.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Bulk action bar — sticky at the bottom while ≥1 row is selected.
          Mirrors the Gmail / Linear pattern: the bar slides in only when
          there's something to act on, and clears itself on success. */}
      {bulkEligible && someSelected && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-bg-elevated border border-hairline shadow-editorial rounded-md px-4 py-2.5"
        >
          <span className="text-sm font-medium text-content-primary tabular-nums">
            {selectedIds.size} selected
          </span>
          <span className="text-content-muted">·</span>
          <button
            type="button"
            onClick={handleBulkApprove}
            disabled={bulkApprove.isPending || bulkReject.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            {bulkApprove.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            {bulkApprove.isPending ? 'Approving…' : `Approve ${selectedIds.size}`}
          </button>
          <button
            type="button"
            onClick={openBulkReject}
            disabled={bulkApprove.isPending || bulkReject.isPending || bulkReassign.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <XCircle size={13} />
            Reject {selectedIds.size}
          </button>
          <button
            type="button"
            onClick={openBulkReassign}
            disabled={bulkApprove.isPending || bulkReject.isPending || bulkReassign.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <UserPlus size={13} />
            Reassign
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkApprove.isPending || bulkReject.isPending || bulkReassign.isPending}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs text-content-muted hover:text-content-primary transition-colors disabled:opacity-60"
            aria-label="Clear selection"
          >
            <X size={12} />
            Clear
          </button>
        </div>
      )}

      {/* Bulk reject — optional shared reason applied to every selected
          row. Submit triggers POST /bulk/reject with the id list. */}
      {rejectModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !bulkReject.isPending && setRejectModalOpen(false)}
        >
          <div
            className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <h3 className="font-display text-base font-semibold text-content-primary">
                Reject {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'}
              </h3>
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                disabled={bulkReject.isPending}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-content-muted">
                Each selected row will be marked as rejected with this reason. This is terminal — rejected rows can't be reopened from the queue.
              </p>
              <div>
                <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                  Reason <span className="text-content-muted normal-case tracking-normal">(optional, applied to all)</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Duplicate batch · already covered in the previous quarter's report"
                  maxLength={1000}
                  className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline bg-bg-secondary/40 rounded-b-editorial">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                disabled={bulkReject.isPending}
                className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkRejectConfirm}
                disabled={bulkReject.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-rose-600 text-white rounded hover:bg-rose-700 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
              >
                {bulkReject.isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                {bulkReject.isPending ? 'Rejecting…' : `Reject ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk reassign — picker for the new owner. Empty selection means
          "unassign". Shows a fail-graceful state when the migration
          isn't applied yet (the toast carries the operator instruction). */}
      {reassignModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !bulkReassign.isPending && setReassignModalOpen(false)}
        >
          <div
            className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <h3 className="font-display text-base font-semibold text-content-primary">
                Reassign {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'}
              </h3>
              <button
                type="button"
                onClick={() => setReassignModalOpen(false)}
                disabled={bulkReassign.isPending}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-content-muted">
                Pick a new owner. Choose <span className="font-medium">Unassign</span> to clear ownership. Terminal rows (committed / rejected) are skipped automatically.
              </p>
              <div>
                <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                  Assign to
                </label>
                {usersQuery.isLoading ? (
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                ) : usersQuery.isError ? (
                  <p className="text-sm text-data-negative">Couldn't load users — try closing and re-opening this dialog.</p>
                ) : (
                  <select
                    value={reassignTargetId}
                    onChange={(e) => setReassignTargetId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
                  >
                    <option value="">— Unassign —</option>
                    {(usersQuery.data || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email}{u.role ? ` · ${u.role}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline bg-bg-secondary/40 rounded-b-editorial">
              <button
                type="button"
                onClick={() => setReassignModalOpen(false)}
                disabled={bulkReassign.isPending}
                className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkReassignConfirm}
                disabled={bulkReassign.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {bulkReassign.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                {bulkReassign.isPending
                  ? 'Reassigning…'
                  : reassignTargetId
                  ? `Reassign ${selectedIds.size}`
                  : `Unassign ${selectedIds.size}`
                }
              </button>
            </div>
          </div>
        </div>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
