import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Layers, AlertTriangle, Search } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, StatTile } from '../../design-system';
import { useBbmpWardSummary } from '../../hooks/useMasterPlan';

const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
};

const ZONE_TONE = {
  A: 'success',
  B: 'success',
  C: 'info',
  D: 'warn',
  E: 'warn',
  F: 'danger',
};

const SORT_OPTIONS = [
  { key: 'ward_no', label: 'Ward #', dir: 'asc' },
  { key: 'street_count', label: 'Streets', dir: 'desc' },
  { key: 'enriched_pct', label: 'Enriched %', dir: 'desc' },
  { key: 'median_guidance', label: 'Median ₹/sqft', dir: 'desc' },
];

function PanelSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3 animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-40 rounded bg-bg-secondary" />
        <div className="h-5 w-2/3 rounded bg-bg-secondary" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
        </div>
        <div className="h-72 rounded bg-bg-secondary" />
      </div>
      <span className="sr-only">Loading BBMP ward summary</span>
    </Card>
  );
}

// Computes the "enriched %" derived field so the user can sort the table by
// completeness without making it a backend column.
const withDerived = (rows) => rows.map((r) => ({
  ...r,
  enriched_pct: r.street_count > 0
    ? Math.round((r.enriched_count / r.street_count) * 1000) / 10
    : 0,
  median_guidance: r.median_guidance_mid_inr,
}));

const sortRows = (rows, sortKey, sortDir) => {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    // null-last regardless of direction
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (av === bv) return a.ward_no - b.ward_no;
    return av < bv ? -1 * dir : 1 * dir;
  });
};

export default function BbmpWardSummaryPanel() {
  const { data, isLoading, isError } = useBbmpWardSummary();
  const [searchInput, setSearchInput] = useState('');
  const [sortKey, setSortKey] = useState('ward_no');
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      const def = SORT_OPTIONS.find((o) => o.key === key)?.dir || 'asc';
      setSortDir(def);
    }
  };

  const rows = useMemo(() => {
    const base = withDerived(data?.wards || []);
    const q = searchInput.trim();
    if (!q) return sortRows(base, sortKey, sortDir);

    // Single letter A–F → exact zone-code match only (avoids noisy ARO
    // substring hits like "RESIDENTIAL" matching the letter "A"). Anything
    // longer falls through to the multi-field substring matcher.
    const lower = q.toLowerCase();
    const isZoneCode = /^[a-f]$/.test(lower);
    const filtered = isZoneCode
      ? base.filter((r) => (r.dominant_zone || '').toLowerCase() === lower)
      : base.filter((r) => String(r.ward_no).includes(q)
          || (r.sample_aro_section || '').toLowerCase().includes(lower)
          || (r.dominant_zone || '').toLowerCase() === lower);
    return sortRows(filtered, sortKey, sortDir);
  }, [data, searchInput, sortKey, sortDir]);

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load ward summary">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  const summary = data?.summary || {};

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="BBMP wards"
        title="Ward Summary — 198 BBMP wards rolled up by street index"
        sub="One row per ward, sorted by ward number by default. Click any column header to sort. The dominant zone is the UAV zone (A–F) that wins the plurality of enriched streets in that ward; the median guidance value is the midpoint of the bandwidth across enriched rows."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Wards covered"
          value={fmt(summary.ward_count)}
          footnote="From BBMP gazette"
        />
        <StatTile
          label="Streets indexed"
          value={fmt(summary.total_streets)}
          footnote="All wards combined"
        />
        <StatTile
          label="Enriched"
          value={summary.enriched_pct != null ? `${summary.enriched_pct}%` : '—'}
          footnote={`${fmt(summary.total_enriched)} of ${fmt(summary.total_streets)} have a zone`}
        />
        <StatTile
          label="Wards with multiple zones"
          value={fmt(summary.wards_with_multiple_zones)}
          footnote={`${fmt(summary.wards_fully_enriched)} wards fully enriched`}
        />
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Filter by ward number, ARO area name, or zone code (A–F)"
          className="w-full pl-9 pr-3 py-2 text-sm bg-bg-elevated border border-hairline rounded-md text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 transition-all duration-120"
          aria-label="Filter wards"
        />
      </div>

      <Card elevated className="p-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-content-muted">
            No wards match the current filter.
          </div>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline sticky top-0 z-10">
                <tr>
                  {SORT_OPTIONS.map((opt) => {
                    const active = sortKey === opt.key;
                    const Icon = active && sortDir === 'desc' ? ChevronDown : ChevronUp;
                    return (
                      <th
                        key={opt.key}
                        className="px-4 py-2 cursor-pointer select-none hover:text-content-primary transition-colors duration-120 text-left"
                        onClick={() => handleSort(opt.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {opt.label}
                          {active && <Icon size={11} aria-hidden="true" />}
                        </span>
                      </th>
                    );
                  })}
                  <th className="px-4 py-2 text-left">Dominant zone</th>
                  <th className="px-4 py-2 text-left">Sample ARO area</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <tr
                    key={r.ward_no}
                    className="hover:bg-bg-secondary/40 transition-colors duration-150"
                  >
                    <td className="px-4 py-2 text-content-primary font-medium tabular-nums">
                      Ward {r.ward_no}
                    </td>
                    <td className="px-4 py-2 text-content-primary tabular-nums">
                      {fmt(r.street_count)}
                    </td>
                    <td className="px-4 py-2 text-content-secondary tabular-nums">
                      {r.enriched_pct}%
                      <span className="text-[11px] text-content-muted ml-1">
                        ({fmt(r.enriched_count)}/{fmt(r.street_count)})
                      </span>
                    </td>
                    <td className="px-4 py-2 text-content-secondary tabular-nums">
                      {r.median_guidance_mid_inr != null
                        ? `₹${fmt(r.median_guidance_mid_inr)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {r.dominant_zone ? (
                        <span className="inline-flex items-center gap-1">
                          <Badge tone={ZONE_TONE[r.dominant_zone] || 'neutral'}>
                            Zone {r.dominant_zone}
                          </Badge>
                          {r.dominant_zone_share_pct != null && (
                            <span className="text-[11px] text-content-muted tabular-nums">
                              {r.dominant_zone_share_pct}%
                            </span>
                          )}
                          {r.distinct_zone_count > 1 && (
                            <span className="text-[11px] text-content-muted">
                              · +{r.distinct_zone_count - 1} other
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] text-content-muted italic">
                          no enrichment yet
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-content-muted text-[11px] truncate max-w-[16rem]" title={r.sample_aro_section}>
                      {r.sample_aro_section || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data?.disclaimer && (
        <div className="text-[11px] text-content-muted flex items-start gap-1.5">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{data.disclaimer}</span>
        </div>
      )}
    </div>
  );
}
