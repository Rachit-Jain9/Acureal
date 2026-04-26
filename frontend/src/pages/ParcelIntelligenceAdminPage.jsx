import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Database, FileSearch, RefreshCw, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import {
  useParcelIntelligenceReviewQueue,
  useParcelIntelligenceStatus,
  usePromoteEvidenceFactToProperty,
  usePromoteEvidenceFactsToProperty,
  useReviewParcelIntelligenceItem,
} from '../hooks/useParcelIntelligenceAdmin';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'evidence_source', label: 'Sources' },
  { value: 'evidence_fact', label: 'Facts' },
  { value: 'guidance_value', label: 'Guidance Values' },
  { value: 'far_rule', label: 'FAR Rules' },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All Statuses' },
];

function statusTone(status) {
  if (status === 'approved' || status === 'configured' || status === 'parser_available') return 'text-emerald-700 bg-emerald-50';
  if (status === 'rejected' || status === 'error') return 'text-rose-700 bg-rose-50';
  if (status === 'not_configured') return 'text-amber-800 bg-amber-50';
  return 'text-content-secondary bg-bg-secondary';
}

function StatusBadge({ status }) {
  const Icon = status === 'approved' || status === 'configured' ? CheckCircle2 : status === 'rejected' ? XCircle : Clock;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', statusTone(status))}>
      <Icon size={11} />
      {String(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

function StatCard({ label, value, sub, icon: Icon = Database }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-content-muted">{label}</div>
          <div className="mt-2 font-display text-2xl font-semibold text-content-primary tabular-nums">{value}</div>
          {sub && <div className="mt-1 text-xs text-content-secondary">{sub}</div>}
        </div>
        <div className="rounded-lg bg-primary-50 p-2 text-primary-600">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ label, provider }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-content-primary">{label}</div>
          <p className="mt-1 text-xs leading-relaxed text-content-secondary">{provider?.message || 'No status message.'}</p>
        </div>
        <StatusBadge status={provider?.status} />
      </div>
    </div>
  );
}

function payloadSummary(payload = {}) {
  const keys = [
    'source_title',
    'city',
    'locality',
    'road_name',
    'sro_name',
    'value_inr_per_sqft',
    'zone_code',
    'planning_zone',
    'base_far',
    'max_far',
    'effective_from',
    'plan_version',
  ];
  return keys
    .filter((key) => payload[key] !== null && payload[key] !== undefined && payload[key] !== '')
    .map((key) => `${key.replace(/_/g, ' ')}: ${payload[key]}`)
    .slice(0, 4)
    .join(' | ');
}

function formatFactValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.map((item) => formatFactValue(item)).join(', ');
  if (typeof value === 'number') return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function promotionReason(promotion) {
  if (!promotion?.supported) return null;
  if (promotion.reason === 'approval_required') return 'Approve before promoting';
  if (promotion.reason === 'already_populated') return `Already set: ${formatFactValue(promotion.current_value)}`;
  if (promotion.reason === 'no_linked_property') return 'No linked property';
  return null;
}

function ReviewQueueRow({ item, onReview, onPromote, pending, promotePending }) {
  const summary = payloadSummary(item.payload);
  const factValue = item.payload?.fact_value;
  const promotion = item.promotion;
  const reason = promotionReason(promotion);

  return (
    <tr className="border-b border-hairline align-top hover:bg-bg-secondary/70">
      <td className="px-3 py-3">
        <div className="font-medium text-content-primary">{item.title || item.category || item.type}</div>
        <div className="mt-1 text-xs text-content-muted">{item.type.replace(/_/g, ' ')}</div>
      </td>
      <td className="px-3 py-3 text-xs text-content-secondary">
        <div>{item.category || '-'}</div>
        {factValue !== undefined && (
          <div className="mt-1 max-w-md font-medium text-content-primary">
            {formatFactValue(factValue)}
          </div>
        )}
        {summary && <div className="mt-1 max-w-md leading-relaxed">{summary}</div>}
        {promotion?.supported && (
          <div className="mt-2 max-w-md rounded bg-bg-secondary px-2 py-1 text-[11px] text-content-secondary">
            Property target: {promotion.label} = {formatFactValue(promotion.value)}
            {promotion.property_name ? ` on ${promotion.property_name}` : ''}
            {reason ? ` (${reason})` : ''}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={item.review_status} />
        {item.confidence_score !== null && item.confidence_score !== undefined && (
          <div className="mt-1 text-xs text-content-muted">{Math.round(Number(item.confidence_score) * 100)}% confidence</div>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-content-secondary">
        {item.source_page ? `p. ${item.source_page}` : '-'}
        {item.source_section && <div className="mt-1 max-w-[180px] truncate">{item.source_section}</div>}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            ['approved', 'Approve', 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'],
            ['needs_review', 'Needs Review', 'bg-amber-50 text-amber-800 hover:bg-amber-100'],
            ['rejected', 'Reject', 'bg-rose-50 text-rose-700 hover:bg-rose-100'],
          ].map(([status, label, klass]) => (
            <button
              key={status}
              type="button"
              disabled={pending || item.review_status === status}
              onClick={() => onReview({ type: item.type, id: item.id, status })}
              className={clsx('rounded px-2 py-1 text-xs font-medium disabled:opacity-45', klass)}
            >
              {label}
            </button>
          ))}
          {promotion?.supported && item.review_status === 'approved' && (
            <button
              type="button"
              disabled={pending || promotePending || !promotion.promotable}
              onClick={() => onPromote({ id: item.id })}
              className="inline-flex items-center gap-1 rounded bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-45"
              title={reason || 'Promote reviewed fact to linked property'}
            >
              <ArrowRight size={12} />
              Promote
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function ParcelIntelligenceAdminPage() {
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('pending');
  const params = useMemo(() => ({ type, status, limit: 80 }), [type, status]);
  const { data: ops, isLoading: statusLoading } = useParcelIntelligenceStatus();
  const { data: queue = [], isLoading: queueLoading, refetch } = useParcelIntelligenceReviewQueue(params);
  const reviewMutation = useReviewParcelIntelligenceItem();
  const promoteMutation = usePromoteEvidenceFactToProperty();
  const promoteBatchMutation = usePromoteEvidenceFactsToProperty();

  const pendingCount = ops?.review_queue?.pending_or_needs_review ?? '-';
  const guidanceApproved = ops?.review_queue?.guidance_values?.approved || 0;
  const farApproved = ops?.review_queue?.far_rules?.approved || 0;
  const eligiblePromotionIds = useMemo(
    () => queue
      .filter((item) => item.type === 'evidence_fact' && item.review_status === 'approved' && item.promotion?.promotable)
      .map((item) => item.id),
    [queue]
  );
  const isDecisionPending = reviewMutation.isPending || promoteMutation.isPending || promoteBatchMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parcel Intelligence Operations"
        description="Review evidence, monitor provider readiness, and keep regulatory intelligence honest before it appears as verified."
      />

      {statusLoading ? (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard label="Open Review" value={pendingCount} sub="Pending or needs review" icon={Clock} />
            <StatCard label="Guidance Rows" value={guidanceApproved} sub="Approved reference rows" icon={FileSearch} />
            <StatCard label="FAR Rules" value={farApproved} sub="Approved buildability rules" icon={Database} />
            <StatCard label="K-GIS Cache" value={ops?.cache?.kgis_fresh_rows || 0} sub={`${ops?.cache?.kgis_rows || 0} total rows`} icon={RefreshCw} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ProviderCard label="Landeed" provider={ops?.providers?.landeed} />
            <ProviderCard label="IGR PDF Parser" provider={ops?.providers?.igr_pdf} />
            <ProviderCard label="K-GIS" provider={ops?.providers?.kgis} />
          </div>
        </>
      )}

      <div className="rounded-xl border border-hairline-strong bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-hairline-strong p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-content-primary">Evidence Review Queue</h2>
            <p className="mt-1 text-xs text-content-secondary">
              Approval promotes extracted or curated facts into verified decision support. Rejected rows remain auditable but should not drive parcel outputs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="input max-w-[180px]" value={type} onChange={(event) => setType(event.target.value)}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="input max-w-[170px]" value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-2 text-sm font-medium text-content-secondary hover:bg-bg-secondary"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              disabled={eligiblePromotionIds.length === 0 || isDecisionPending}
              onClick={() => promoteBatchMutation.mutate({ ids: eligiblePromotionIds })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-45"
              title={eligiblePromotionIds.length ? 'Promote approved visible facts into blank linked property inputs' : 'No eligible approved facts in this view'}
            >
              <ArrowRight size={14} />
              Promote Eligible
              {eligiblePromotionIds.length > 0 && (
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-xs tabular-nums">{eligiblePromotionIds.length}</span>
              )}
            </button>
          </div>
        </div>

        {queueLoading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : queue.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={AlertTriangle}
              title="No review items found"
              description="Change filters or ingest reviewed source material. REDIP will not create placeholder regulatory facts."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-hairline-strong bg-bg-secondary text-xs uppercase tracking-[0.08em] text-content-muted">
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 font-semibold">Extract</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Decision</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <ReviewQueueRow
                    key={`${item.type}-${item.id}`}
                    item={item}
                    pending={isDecisionPending}
                    promotePending={isDecisionPending}
                    onReview={reviewMutation.mutate}
                    onPromote={promoteMutation.mutate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
