import { useEffect, useMemo, useState } from 'react';
import {
  Search, RefreshCw, Loader2, Database, AlertTriangle, CheckCircle2, Clock, XCircle,
} from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton, StatTile } from '../../design-system';
import { useBbmpUavEntries } from '../../hooks/useMasterPlan';

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const STATUS_BADGE = {
  pending: { tone: 'warn', icon: Clock, label: 'Pending' },
  approved: { tone: 'success', icon: CheckCircle2, label: 'Approved' },
  rejected: { tone: 'danger', icon: XCircle, label: 'Rejected' },
  needs_review: { tone: 'warn', icon: AlertTriangle, label: 'Needs review' },
};

function formatRupees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₹${new Intl.NumberFormat('en-IN').format(n)}`;
}

function formatPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
}

function StatusBadge({ status }) {
  const cfg = STATUS_BADGE[status] || { tone: 'neutral', icon: Clock, label: status || '—' };
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone} className="gap-1">
      <Icon size={11} />
      {cfg.label}
    </Badge>
  );
}

function PanelSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40 rounded" />
        <Skeleton className="h-5 w-2/3 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
          <Skeleton className="h-16 w-full rounded" />
          <Skeleton className="h-16 w-full rounded" />
          <Skeleton className="h-16 w-full rounded" />
        </div>
        <div className="space-y-2 pt-2">
          <Skeleton className="h-10 w-full rounded" />
          <Skeleton className="h-10 w-full rounded" />
          <Skeleton className="h-10 w-full rounded" />
        </div>
      </div>
      <span className="sr-only">Loading BBMP UAV entries</span>
    </Card>
  );
}

export default function MasterPlanBbmpUavPanel() {
  // Default to 'all' so the panel never opens empty: every seeded BBMP UAV
  // row is already 'approved', so a 'pending' default showed a misleading
  // "no entries yet" state despite 108 live rows. Reviewers can still narrow
  // to 'pending' via the filter chips.
  const [status, setStatus] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const params = useMemo(() => {
    const next = { status };
    if (debouncedSearch) next.search = debouncedSearch;
    return next;
  }, [status, debouncedSearch]);

  const { data, isLoading, isError, isFetching, refetch } = useBbmpUavEntries(params);

  if (isLoading) return <PanelSkeleton />;

  if (isError) {
    return (
      <ErrorState
        tone="warn"
        title="Could not load BBMP UAV entries"
        action={(
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-2 py-1"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      >
        Acureal could not reach the BBMP UAV endpoint. Try again or check the master-plan service.
      </ErrorState>
    );
  }

  if (data?.schema_ready === false) {
    return (
      <ErrorState tone="warn" title="BBMP UAV storage not applied yet">
        {data.message || 'The page-ledger and BBMP UAV migration has not been applied to this database. Apply it before reviewing UAV rows.'}
      </ErrorState>
    );
  }

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const summary = {
    total: rows.length,
    pending: rows.filter((r) => r.review_status === 'pending').length,
    approved: rows.filter((r) => r.review_status === 'approved').length,
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="BBMP property tax"
        title="Unit Area Value (UAV) review queue"
        sub="BBMP property-tax zoning rows extracted from the official Guidance Value PDF. Kept strictly separate from IGR sale guidance values — these numbers are tax UAV, not market price."
        action={(
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-2 py-1"
          >
            {isFetching ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" /> : <RefreshCw size={12} />}
            Refresh
          </button>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile label="Rows in view" value={summary.total} footnote={`status filter: ${status}`} />
        <StatTile label="Pending" value={summary.pending} footnote="awaiting reviewer" />
        <StatTile label="Approved" value={summary.approved} footnote="ready to use" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" aria-hidden="true" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search zone code, ward, road, or area"
            className="w-full pl-9 pr-3 py-2 text-sm border border-hairline rounded-md bg-surface text-content-primary placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Search BBMP UAV entries"
          />
        </div>
        <div className="flex items-center gap-1 border border-hairline rounded-md p-0.5 bg-surface">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setStatus(filter.key)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors duration-150 ${
                status === filter.key
                  ? 'bg-bg-secondary text-content-primary'
                  : 'text-content-secondary hover:text-content-primary'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <ErrorState tone="info" title="No BBMP UAV entries">
          {debouncedSearch
            ? `No entries match "${debouncedSearch}" in this status.`
            : 'No entries in this view yet. BBMP UAV rows will appear here after the Guidance Value PDF is uploaded and reviewed.'}
        </ErrorState>
      ) : (
        <Card elevated className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Zone</th>
                  <th className="text-left font-medium px-4 py-2">Ward</th>
                  <th className="text-left font-medium px-4 py-2">Road / Area</th>
                  <th className="text-left font-medium px-4 py-2">Use</th>
                  <th className="text-right font-medium px-4 py-2">UAV (₹/sqft)</th>
                  <th className="text-left font-medium px-4 py-2">Page</th>
                  <th className="text-left font-medium px-4 py-2">Confidence</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="transition-colors duration-150 hover:bg-bg-secondary/60"
                  >
                    <td className="px-4 py-3 align-top text-content-primary leading-snug">
                      <div className="font-medium">{row.uav_zone_code || '—'}</div>
                      {row.uav_zone_name && (
                        <div className="text-content-muted text-xs">{row.uav_zone_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-content-secondary">
                      {row.ward_number ? `Ward ${row.ward_number}` : '—'}
                      {row.ward_name && (
                        <div className="text-content-muted text-xs">{row.ward_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-content-secondary">
                      {row.road_name || row.area_name || '—'}
                    </td>
                    <td className="px-4 py-3 align-top text-content-secondary capitalize">
                      {row.property_use || '—'}
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums text-content-primary text-right">
                      {formatRupees(row.unit_area_value_inr)}
                      {row.unit_label && (
                        <div className="text-content-muted text-xs font-normal">{row.unit_label}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums text-content-secondary">
                      {row.source_page ?? '—'}
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums text-content-secondary">
                      {formatPercent(row.confidence_score)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusBadge status={row.review_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-content-muted">
        <Database size={11} />
        Source: BBMP Unit Area Value · Bruhat Bengaluru Mahanagara Palike. Not IGR sale guidance.
      </div>
    </div>
  );
}
