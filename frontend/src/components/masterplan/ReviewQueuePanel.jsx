import { useMemo, useState } from 'react';
import { ShieldCheck, AlertTriangle, Search, CheckCircle2 } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton, StatTile } from '../../design-system';
import { useReviewQueue } from '../../hooks/useMasterPlan';

const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
};

const BUCKET_LABEL = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  unscored: 'Unscored',
};

const BUCKET_TONE = {
  high: 'success',
  medium: 'info',
  low: 'warn',
  unscored: 'neutral',
};

const STATUS_TONE = {
  approved: 'success',
  pending: 'warn',
  rejected: 'danger',
};

function shortValue(value) {
  if (value == null) return '—';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') {
    const scalar = ['value', 'name', 'label', 'count'].find((k) => value[k] != null);
    if (scalar) return String(value[scalar]);
    return `${Object.keys(value).length} fields`;
  }
  const str = String(value);
  return str.length > 80 ? `${str.slice(0, 77)}…` : str;
}

function PanelSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40 rounded" />
        <Skeleton className="h-5 w-2/3 rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
          <Skeleton className="h-20 w-full rounded" />
          <Skeleton className="h-20 w-full rounded" />
          <Skeleton className="h-20 w-full rounded" />
          <Skeleton className="h-20 w-full rounded" />
        </div>
        <Skeleton className="h-72 w-full rounded" />
      </div>
      <span className="sr-only">Loading review queue</span>
    </Card>
  );
}

export default function ReviewQueuePanel() {
  const { data, isLoading, isError } = useReviewQueue();
  const [search, setSearch] = useState('');

  const filteredRows = useMemo(() => {
    const rows = data?.needs_review || [];
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.fact_key || '').toLowerCase().includes(s)
        || (r.fact_type || '').toLowerCase().includes(s)
        || (r.source_title || '').toLowerCase().includes(s)
        || (r.source_section || '').toLowerCase().includes(s),
    );
  }, [data, search]);

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load review queue">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  const summary = data?.summary || {};
  const counts = data?.counts || { high: {}, medium: {}, low: {}, unscored: {} };
  const allClear = (summary.fact_count || 0) > 0 && (summary.needs_review_count || 0) === 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Confidence audit"
        title="Review Queue — facts that still need human verification"
        sub="Every AI-extracted fact is bucketed by confidence (high ≥ 0.9, medium 0.7–0.9, low < 0.7, or unscored). Anything that is not both high-confidence and reviewer-approved appears below — work the queue down before quoting any of these numbers in IC memos."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="High confidence"
          value={fmt(counts.high?.total || 0)}
          footnote={`${counts.high?.approved || 0} approved · ${counts.high?.pending || 0} pending`}
        />
        <StatTile
          label="Medium confidence"
          value={fmt(counts.medium?.total || 0)}
          footnote={`${counts.medium?.approved || 0} approved · ${counts.medium?.pending || 0} pending`}
        />
        <StatTile
          label="Low confidence"
          value={fmt(counts.low?.total || 0)}
          footnote={`${counts.low?.approved || 0} approved · ${counts.low?.pending || 0} pending`}
          negative={(counts.low?.total || 0) > 0}
        />
        <StatTile
          label="Unscored"
          value={fmt(counts.unscored?.total || 0)}
          footnote={`${counts.unscored?.approved || 0} approved · ${counts.unscored?.pending || 0} pending`}
        />
      </div>

      {allClear ? (
        <Card elevated className="p-6 flex items-start gap-3">
          <CheckCircle2 size={18} className="mt-0.5 text-data-positive shrink-0" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium text-content-primary">All clear — every fact is high-confidence and approved.</div>
            <p className="text-[12px] text-content-muted mt-1">
              {summary.fact_count} fact{summary.fact_count === 1 ? '' : 's'} reviewed across the corpus. New uploads will appear here automatically when they fall below the threshold or land in pending review.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by fact key, type, or source"
                className="w-full pl-9 pr-3 py-2 text-sm bg-bg-elevated border border-hairline rounded-md text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 transition-all duration-120"
                aria-label="Search review queue"
              />
            </div>
            <div className="text-xs text-content-muted tabular-nums">
              {filteredRows.length} of {summary.needs_review_count || 0} needing review
            </div>
          </div>

          <Card elevated className="p-0 overflow-hidden">
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Fact</th>
                    <th className="text-left font-medium px-4 py-2">Source</th>
                    <th className="text-right font-medium px-4 py-2">Page</th>
                    <th className="text-right font-medium px-4 py-2">Confidence</th>
                    <th className="text-right font-medium px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-content-muted text-sm">
                        No facts match this search.
                      </td>
                    </tr>
                  ) : filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-bg-secondary/40 transition-colors duration-150">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={BUCKET_TONE[row.bucket] || 'neutral'}>{row.fact_type}</Badge>
                          <span className="text-content-primary font-medium">{row.fact_key}</span>
                        </div>
                        <div className="text-[11px] text-content-secondary mt-0.5 leading-snug">
                          {shortValue(row.fact_value)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-content-primary text-sm leading-snug truncate max-w-xs" title={row.source_title}>
                          {row.source_title || '—'}
                        </div>
                        {row.source_section && (
                          <div className="text-[11px] text-content-muted mt-0.5">§{row.source_section}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary text-xs">
                        {row.page_number ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary">
                        {row.confidence_score == null ? '—' : Number(row.confidence_score).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge tone={STATUS_TONE[row.review_status] || 'neutral'}>
                          {row.review_status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {data?.disclaimer && (
        <div className="text-[11px] text-content-muted flex items-start gap-1.5">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{data.disclaimer}</span>
        </div>
      )}
    </div>
  );
}
