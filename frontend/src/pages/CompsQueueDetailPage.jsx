import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import useFocusTrap from '../hooks/useFocusTrap';
import useScrollLock from '../hooks/useScrollLock';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, XCircle, Save, RefreshCw, FileText, Mail,
  AlertTriangle, Download, Plus, Trash2, Info,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonLine, ErrorState } from '../design-system';
import { compsReviewQueueAPI } from '../services/api';
import { downloadAxiosResponse } from '../utils/download';
import { toast } from '../components/common/Toast';
import { handleNumericPaste } from '../components/common/numericPaste';
import {
  useCompsReviewQueueRow,
  useProcessQueueRow,
  useSaveReviewerEdits,
  useApproveQueueRow,
  useRejectQueueRow,
} from '../hooks/useCompsReviewQueue';

// Editable comp row in the right pane. Required fields (project_name, city,
// rate_per_sqft) are highlighted when missing — they block commit.
const REQUIRED_FIELDS = ['project_name', 'city', 'rate_per_sqft'];

const FIELD_LABELS = {
  project_name: 'Project name',
  developer: 'Developer',
  city: 'City',
  locality: 'Locality',
  asset_class: 'Asset class',
  bhk_config: 'BHK',
  carpet_area_sqft: 'Carpet (sqft)',
  super_builtup_area_sqft: 'SBA (sqft)',
  rate_per_sqft: 'Rate (₹/sqft)',
  rate_per_sqft_min: 'Rate min',
  rate_per_sqft_max: 'Rate max',
  total_units: 'Units',
  launch_year: 'Launch yr',
  possession_year: 'Possession yr',
  rera_number: 'RERA',
  source: 'Source label',
};

const NUMERIC_FIELDS = new Set([
  'carpet_area_sqft', 'super_builtup_area_sqft',
  'rate_per_sqft', 'rate_per_sqft_min', 'rate_per_sqft_max',
  'total_units', 'launch_year', 'possession_year', 'lat', 'lng',
]);

// Unit kind per numeric field, so smart-paste can clean a value copied from a
// source email / spreadsheet (e.g. "₹8,500/sqft" → 8500). Fields not listed
// (units, years, coords) fall back to native paste.
const COMP_FIELD_KIND = {
  rate_per_sqft: 'rupeePlain',
  rate_per_sqft_min: 'rupeePlain',
  rate_per_sqft_max: 'rupeePlain',
  carpet_area_sqft: 'count',
  super_builtup_area_sqft: 'count',
};

const ASSET_CLASS_OPTIONS = [
  'residential', 'office', 'retail', 'hospitality', 'industrial',
  'warehouse', 'land', 'mixed_use',
];

const isMissing = (value) => value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));

const sourceLabel = (source) => ({
  email_broker_quote: 'Broker quote',
  email_ipc_report: 'IPC report',
  email_other: 'Email',
  manual_upload: 'Manual upload',
  api_listing_portal: 'Listing portal',
}[source] || source);

const formatDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return '—'; }
};

// ──────────────────────────────────────────────────────────────────────────
// Source preview pane (left)
// ──────────────────────────────────────────────────────────────────────────

// Friendly label for the attachment's type, derived from the stored MIME.
const docKindLabel = (mime) => {
  const m = (mime || '').toLowerCase();
  if (m.includes('pdf')) return 'PDF';
  if (m.startsWith('image/')) return 'Image';
  if (m.includes('word') || m.includes('msword')) return 'Word document';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return 'Spreadsheet';
  return 'Document';
};

function SourcePreview({ row }) {
  const meta = row.source_meta || {};
  // SECURITY (red-team 2026-05-30): the raw storage URL is no longer sent to
  // the browser, and the source document is NEVER embedded in an
  // <iframe>/<img>. The email-ingest attachment path is attacker-controlled,
  // so we fetch the bytes through the guarded backend proxy (nosniff +
  // Content-Disposition: attachment) and save them — matching how deal
  // documents are served. `has_raw_doc` is the server's existence flag; we
  // fall back to a raw_doc_url presence check only for pre-deploy payloads.
  const hasRawDoc = row.has_raw_doc ?? Boolean(row.raw_doc_url);
  const docKind = docKindLabel(row.raw_doc_mime);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await compsReviewQueueAPI.downloadRawDoc(row.id);
      downloadAxiosResponse(res, meta.attachment_name || `source-${row.id}`);
    } catch {
      toast.error('Could not download the source document');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-[100px,1fr] gap-x-3 gap-y-1.5">
          <span className="text-content-muted text-xs uppercase tracking-wider">From</span>
          <span className="text-content-primary truncate">{meta.from || '—'}</span>
          <span className="text-content-muted text-xs uppercase tracking-wider">Subject</span>
          <span className="text-content-primary truncate">{meta.subject || '—'}</span>
          <span className="text-content-muted text-xs uppercase tracking-wider">Received</span>
          <span className="text-content-primary tabular-nums">{formatDate(meta.received_at || row.created_at)}</span>
          {meta.attachment_name && (
            <>
              <span className="text-content-muted text-xs uppercase tracking-wider">File</span>
              <span className="text-content-primary truncate flex items-center gap-1.5">
                <FileText size={13} className="text-content-muted shrink-0" />
                {meta.attachment_name}
                {row.raw_doc_size_bytes && (
                  <span className="text-content-muted text-xs">
                    ({Math.round(row.raw_doc_size_bytes / 1024)} KB)
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Body preview if no attachment OR alongside */}
      {meta.body_preview && (
        <div>
          <div className="text-eyebrow uppercase text-content-muted mb-1.5 font-medium">Email body</div>
          <pre className="text-xs text-content-secondary whitespace-pre-wrap font-sans bg-bg-secondary border border-hairline rounded-md p-3 max-h-60 overflow-auto">
            {meta.body_preview}
          </pre>
        </div>
      )}

      {/* Source document — download-only. Never embedded inline; the bytes
          are streamed through the guarded backend proxy as an attachment. */}
      {hasRawDoc && (
        <div>
          <div className="text-eyebrow uppercase text-content-muted mb-1.5 font-medium">Source document</div>
          <div className="border border-hairline rounded-md bg-bg-secondary p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileText size={18} className="text-content-muted shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-content-primary truncate">
                  {meta.attachment_name || `${docKind} attachment`}
                </div>
                <div className="text-xs text-content-muted">
                  {docKind}
                  {row.raw_doc_size_bytes ? ` · ${Math.round(row.raw_doc_size_bytes / 1024)} KB` : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-hairline rounded text-content-primary bg-bg-elevated hover:bg-bg-secondary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 shrink-0"
            >
              <Download size={13} className={downloading ? 'animate-pulse' : ''} />
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-content-muted">
            Opens in your computer's viewer. Served as a download — never rendered in-app — for security.
          </p>
        </div>
      )}

      {!hasRawDoc && !meta.body_preview && (
        <ErrorState tone="info" title="No raw content">
          This queue row has no attachment or body preview to show.
        </ErrorState>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Editable comp row + table (right pane)
// ──────────────────────────────────────────────────────────────────────────

function CompField({ comp, setComp, field }) {
  const value = comp[field];
  const required = REQUIRED_FIELDS.includes(field);
  const missing = required && isMissing(value);

  if (field === 'asset_class') {
    return (
      <select
        value={value || ''}
        onChange={(e) => setComp({ ...comp, asset_class: e.target.value })}
        className={clsx(
          'w-full px-2 py-1 text-xs border rounded bg-bg-elevated text-content-primary',
          'focus-visible:outline-none focus-visible:border-accent transition-colors',
          missing ? 'border-premium' : 'border-hairline'
        )}
      >
        <option value="">—</option>
        {ASSET_CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }

  const isNumeric = NUMERIC_FIELDS.has(field);
  return (
    <input
      type={isNumeric ? 'number' : 'text'}
      step={isNumeric ? 'any' : undefined}
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        const next = isNumeric && v !== '' ? Number(v) : v === '' ? null : v;
        setComp({ ...comp, [field]: next });
      }}
      onPaste={
        isNumeric
          ? (e) =>
              handleNumericPaste(e, COMP_FIELD_KIND[field] || 'none', (v) =>
                setComp({ ...comp, [field]: v === '' ? null : Number(v) })
              )
          : undefined
      }
      placeholder={required ? 'required' : '—'}
      className={clsx(
        'w-full px-2 py-1 text-xs border rounded bg-bg-elevated text-content-primary',
        'focus-visible:outline-none focus-visible:border-accent transition-colors',
        isNumeric && 'tabular-nums text-right',
        missing ? 'border-premium bg-premium-soft' : 'border-hairline'
      )}
    />
  );
}

const COL_GROUPS = [
  { name: 'Identity',     fields: ['project_name', 'developer', 'city', 'locality'] },
  { name: 'Class',        fields: ['asset_class', 'bhk_config'] },
  { name: 'Areas',        fields: ['carpet_area_sqft', 'super_builtup_area_sqft'] },
  { name: 'Pricing',      fields: ['rate_per_sqft', 'rate_per_sqft_min', 'rate_per_sqft_max'] },
  { name: 'Lifecycle',    fields: ['total_units', 'launch_year', 'possession_year'] },
  { name: 'Provenance',   fields: ['rera_number', 'source'] },
];

function CompsTable({ comps, setComps }) {
  const setComp = (i, next) => {
    const arr = [...comps];
    arr[i] = next;
    setComps(arr);
  };
  const removeComp = (i) => setComps(comps.filter((_, idx) => idx !== i));
  const addComp = () => setComps([...comps, { project_name: '', city: '', rate_per_sqft: null }]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-hairline">
              <th className="px-2 py-2 text-left text-content-muted text-[10px] uppercase tracking-wider font-medium w-10">#</th>
              {COL_GROUPS.flatMap((g) => g.fields).map((f) => (
                <th key={f} className="px-2 py-2 text-left text-content-muted text-[10px] uppercase tracking-wider font-medium whitespace-nowrap">
                  {FIELD_LABELS[f] || f}
                  {REQUIRED_FIELDS.includes(f) && <span className="ml-0.5 text-premium">*</span>}
                </th>
              ))}
              <th className="px-2 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {comps.map((comp, i) => (
              <tr key={i} className="border-b border-hairline hover:bg-bg-secondary/40">
                <td className="px-2 py-1.5 text-content-muted tabular-nums">{i + 1}</td>
                {COL_GROUPS.flatMap((g) => g.fields).map((f) => (
                  <td key={f} className="px-1 py-1.5 align-top min-w-[120px]">
                    <CompField comp={comp} setComp={(next) => setComp(i, next)} field={f} />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeComp(i)}
                    className="p-1 rounded text-content-muted hover:text-data-negative hover:bg-neg-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-data-negative/40"
                    title="Remove this comp from the commit batch"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {comps.length === 0 && (
              <tr>
                <td colSpan={COL_GROUPS.flatMap((g) => g.fields).length + 2} className="px-3 py-6 text-center text-xs text-content-muted">
                  No comps to commit. Add one manually if the document has data not auto-extracted.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addComp}
        className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline focus-visible:outline-none focus-visible:underline"
      >
        <Plus size={12} /> Add comp manually
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Reject confirm modal
// ──────────────────────────────────────────────────────────────────────────

function RejectModal({ open, onClose, onConfirm, isSubmitting }) {
  const [reason, setReason] = useState('');

  // Trap focus + lock body scroll while open; onClose stabilised so a re-render
  // doesn't re-arm the trap. Hooks run before the early return below.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const handleClose = useCallback(() => onCloseRef.current?.(), []);
  const trapRef = useFocusTrap(open, { onEscape: handleClose });
  useScrollLock(open);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-batch-dialog-title"
    >
      <div
        ref={trapRef}
        className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial p-5 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="reject-batch-dialog-title" className="font-display text-base font-semibold text-content-primary mb-2">Reject this batch?</h3>
        <p className="text-sm text-content-secondary mb-4">
          The queue row will be marked rejected. Optional: leave a reason for audit.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. duplicate of last week's batch, low quality scan"
          rows={3}
          className="w-full px-3 py-2 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim() || null)}
            disabled={isSubmitting}
            className="px-3 py-1.5 text-sm bg-data-negative text-white rounded hover:bg-data-negative disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-data-negative/40"
          >
            {isSubmitting ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Main detail page
// ──────────────────────────────────────────────────────────────────────────

export default function CompsQueueDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: row, isLoading, isError, error } = useCompsReviewQueueRow(id);

  const processMut = useProcessQueueRow();
  const saveMut = useSaveReviewerEdits();
  const approveMut = useApproveQueueRow();
  const rejectMut = useRejectQueueRow();

  // Local editable state. Initialised once the row loads; reviewer_edits.comps
  // wins, falling back to structured_payload.comps, falling back to empty.
  const [comps, setComps] = useState([]);
  const [notes, setNotes] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (!row || initRef.current) return;
    const fromEdits = row.reviewer_edits?.comps;
    const fromPayload = row.structured_payload?.comps;
    const initial = Array.isArray(fromEdits) && fromEdits.length > 0
      ? fromEdits
      : Array.isArray(fromPayload) ? fromPayload : [];
    setComps(initial);
    setNotes(row.reviewer_notes || '');
    initRef.current = true;
  }, [row]);

  const isReviewable = row?.status === 'pending_review';
  const overallConf = row?.confidence_scores?._overall;
  const overallPct = typeof overallConf === 'number' ? Math.round(overallConf * 100) : null;

  const validComps = useMemo(
    () => comps.filter((c) => REQUIRED_FIELDS.every((f) => !isMissing(c[f]))),
    [comps]
  );

  // Keyboard shortcuts: Esc back, S save, A approve, R reject.
  useEffect(() => {
    if (!row) return;
    const handler = (e) => {
      if (rejectOpen) return;
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA' || e.target?.tagName === 'SELECT') return;
      if (e.key === 'Escape') {
        navigate('/dashboard/admin/comps-queue');
      } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveMut.mutate({ id, payload: { comps }, notes });
      } else if (e.key === 'a' && isReviewable) {
        e.preventDefault();
        approveMut.mutate(id);
      } else if (e.key === 'r' && isReviewable) {
        e.preventDefault();
        setRejectOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [row, isReviewable, id, comps, notes, navigate, rejectOpen, approveMut, saveMut]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Comps queue" title="Loading…" />
        <Card className="p-6"><SkeletonLine width="60%" /><div className="mt-3"><SkeletonLine width="80%" /></div></Card>
      </div>
    );
  }

  if (isError || !row) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Comps queue" title="Queue row" />
        <ErrorState tone="danger" title="Couldn't load this row">
          {error?.response?.data?.message || error?.message || 'Not found.'}
        </ErrorState>
      </div>
    );
  }

  const statusBadgeTone = ({
    pending_review: 'warn',
    pending_extraction: 'info',
    extracting: 'info',
    failed: 'danger',
    rejected: 'neutral',
    approved: 'info',
    committed: 'success',
  }[row.status]) || 'neutral';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/dashboard/admin/comps-queue"
          className="inline-flex items-center gap-1.5 text-sm text-content-secondary hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:underline"
        >
          <ArrowLeft size={14} /> Back to queue
        </Link>
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-hairline rounded text-[10px]">Esc</kbd> back
          {isReviewable && (
            <>
              <kbd className="ml-2 px-1.5 py-0.5 bg-bg-secondary border border-hairline rounded text-[10px]">A</kbd> approve
              <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-hairline rounded text-[10px]">R</kbd> reject
            </>
          )}
          <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-hairline rounded text-[10px]">⌘S</kbd> save
        </div>
      </div>

      <PageHeader
        eyebrow={`${sourceLabel(row.source)} · ${row.status.replace('_', ' ')}`}
        title={row.source_meta?.subject || row.source_meta?.attachment_name || 'Queue row'}
        description={row.source_meta?.from ? `From ${row.source_meta.from}` : null}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={statusBadgeTone}>{row.status.replace('_', ' ')}</Badge>
            {overallPct !== null && (
              <span className="text-xs text-content-muted">
                Confidence{' '}
                <span className={clsx(
                  'font-medium tabular-nums',
                  overallPct >= 80 ? 'text-data-positive' : overallPct >= 50 ? 'text-content-primary' : 'text-data-negative'
                )}>
                  {overallPct}%
                </span>
              </span>
            )}
            {(row.status === 'pending_extraction' || row.status === 'failed') && (
              <button
                type="button"
                onClick={() => processMut.mutate(id)}
                disabled={processMut.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded transition-colors hover:bg-accent/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <RefreshCw size={13} className={processMut.isPending ? 'animate-spin' : ''} />
                {processMut.isPending ? 'Extracting…' : row.status === 'failed' ? 'Retry extraction' : 'Run extraction'}
              </button>
            )}
          </div>
        }
      />

      {row.status === 'committed' && row.committed_comp_ids?.length > 0 && (
        <Card className="p-4 bg-pos-soft border-hairline">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-data-positive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-content-primary">
                Committed {row.committed_comp_ids.length} comp{row.committed_comp_ids.length === 1 ? '' : 's'} on {formatDate(row.committed_at)}
              </p>
              <p className="text-content-secondary text-xs mt-0.5">
                Visible on the Comps page going forward.{' '}
                <Link to="/dashboard/comps" className="text-accent hover:underline">View comps →</Link>
              </p>
            </div>
          </div>
        </Card>
      )}

      {row.status === 'failed' && row.failure_reason && (
        <ErrorState tone="danger" title="Extraction failed">
          {row.failure_reason}
        </ErrorState>
      )}

      {row.status === 'rejected' && row.rejection_reason && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <XCircle size={18} className="text-content-muted shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-content-primary">Rejected on {formatDate(row.reviewed_at)}</p>
              <p className="text-content-secondary text-xs mt-0.5">{row.rejection_reason}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Split-pane: source preview left, edit table right */}
      <div className="grid grid-cols-1 xl:grid-cols-[440px,1fr] gap-4">
        <Card className="p-4">
          <SectionHeader size="sm" eyebrow="Source" title="Original" icon={row.source.startsWith('email') ? Mail : FileText} />
          <SourcePreview row={row} />
        </Card>

        <Card className="p-4">
          <SectionHeader
            size="sm"
            eyebrow="Comps to commit"
            title={`${comps.length} extracted${validComps.length !== comps.length ? ` · ${validComps.length} valid` : ''}`}
            sub={
              row.status === 'pending_extraction'
                ? 'Extraction has not run yet. Use Run extraction above.'
                : row.status === 'extracting'
                ? 'Extraction in flight…'
                : 'Edit any field. Required: project name, city, rate per sqft. Rows missing required fields are skipped at commit.'
            }
          />

          {row.status === 'pending_extraction' || row.status === 'extracting' ? (
            <ErrorState tone="info" title="Awaiting extraction">
              Click Run extraction or wait for the cron worker (every 15 min) to pick this up.
            </ErrorState>
          ) : (
            <CompsTable comps={comps} setComps={setComps} />
          )}

          {/* Reviewer notes */}
          <div className="mt-4">
            <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Reviewer notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional context, follow-ups, or quality flags"
              className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
            />
          </div>

          {/* Action bar */}
          {isReviewable && (
            <div className="mt-5 pt-4 border-t border-hairline flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => saveMut.mutate({ id, payload: { comps }, notes })}
                disabled={saveMut.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-hairline rounded text-content-primary bg-bg-elevated hover:bg-bg-secondary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Save size={13} />
                {saveMut.isPending ? 'Saving…' : 'Save edits'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRejectOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-hairline rounded text-content-secondary hover:text-data-negative hover:border-data-negative transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-data-negative/40"
                >
                  <XCircle size={13} />
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => approveMut.mutate(id)}
                  disabled={approveMut.isPending || validComps.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-data-positive text-white rounded hover:bg-data-positive transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                  title={validComps.length === 0 ? 'No valid comps to commit (required: project name, city, rate per sqft)' : `Commit ${validComps.length} comps to the database`}
                >
                  <CheckCircle2 size={13} />
                  {approveMut.isPending ? 'Approving…' : `Approve & commit (${validComps.length})`}
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Provenance footer */}
      {row.structured_payload?.report_metadata && (
        <Card className="p-4">
          <SectionHeader size="sm" eyebrow="Report metadata" title="Extracted context" icon={Info} />
          <pre className="text-xs text-content-secondary whitespace-pre-wrap font-mono bg-bg-secondary border border-hairline rounded-md p-3 max-h-48 overflow-auto">
            {JSON.stringify(row.structured_payload.report_metadata, null, 2)}
          </pre>
        </Card>
      )}

      {(row.confidence_scores && Object.keys(row.confidence_scores).length > 1) && (
        <Card className="p-4">
          <SectionHeader size="sm" eyebrow="Quality" title="Per-field confidence" icon={AlertTriangle} sub="From the extraction call. Low values flag fields the analyst should double-check." />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(row.confidence_scores)
              .filter(([k]) => k !== '_overall')
              .map(([field, score]) => {
                const pct = Math.round((score || 0) * 100);
                return (
                  <div key={field} className="text-xs">
                    <div className="text-content-muted truncate">{field}</div>
                    <div className={clsx(
                      'font-medium tabular-nums',
                      pct >= 80 ? 'text-data-positive' : pct >= 50 ? 'text-content-primary' : 'text-data-negative'
                    )}>
                      {pct}%
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      <RejectModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onConfirm={(reason) => {
          rejectMut.mutate({ id, reason });
          setRejectOpen(false);
        }}
        isSubmitting={rejectMut.isPending}
      />
    </div>
  );
}
