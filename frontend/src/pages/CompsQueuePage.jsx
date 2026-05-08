import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Mail, FileText, Globe, Upload, ArrowRight, Clock, AlertTriangle, CheckCircle2, XCircle, Database, Hourglass } from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../design-system';
import { useCompsReviewQueueList } from '../hooks/useCompsReviewQueue';

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

const QueueRow = ({ row }) => {
  const visual = statusVisual(row.status);
  const Icon = visual.icon;
  const subject = row.source_meta?.subject || row.source_meta?.attachment_name || '(no subject)';
  const from = row.source_meta?.from || row.source_meta?.from_name || '—';
  const overall = row.confidence_scores?._overall;
  const overallPct = typeof overall === 'number' ? Math.round(overall * 100) : null;

  return (
    <Link
      to={`/dashboard/admin/comps-queue/${row.id}`}
      className={clsx(
        'group flex items-center gap-4 px-4 py-3.5',
        'border-b border-hairline last:border-b-0',
        'hover:bg-bg-secondary transition-colors duration-100',
        'focus-visible:outline-none focus-visible:bg-bg-secondary'
      )}
    >
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
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-content-primary truncate">{subject}</span>
          <Badge tone="neutral" className="shrink-0 text-[10px]">{sourceShortLabel(row.source)}</Badge>
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

export default function CompsQueuePage() {
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [sourceFilter, setSourceFilter] = useState(null);

  const { data, isLoading, isError, error, refetch } = useCompsReviewQueueList({
    status: statusFilter,
    source: sourceFilter,
    limit: 100,
  });

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tier-0 ingestion"
        title="Comps review queue"
        description="Forwarded broker quotes and IPC reports land here for human review before committing to the comps database. Approve, edit, or reject each batch."
      />

      {/* Filter bar */}
      <Card className="p-4 space-y-3">
        <div>
          <div className="text-eyebrow uppercase text-content-muted mb-2 font-medium">Status</div>
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
            sub={isLoading ? null : `${total} item${total === 1 ? '' : 's'}${sourceFilter ? ` · filtered to ${sourceShortLabel(sourceFilter)}` : ''}`}
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
          <div className="p-12 text-center">
            <Inbox size={32} className="mx-auto text-content-muted mb-3" />
            <p className="text-sm font-medium text-content-primary">Nothing here yet</p>
            <p className="text-xs text-content-muted mt-1 max-w-md mx-auto">
              {statusFilter === 'pending_review'
                ? 'No items are waiting on a reviewer. Forward a broker quote or market report to the inbound address to get started.'
                : 'No items in this status.'}
            </p>
          </div>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <div>
            {rows.map((row) => <QueueRow key={row.id} row={row} />)}
          </div>
        )}
      </Card>
    </div>
  );
}
