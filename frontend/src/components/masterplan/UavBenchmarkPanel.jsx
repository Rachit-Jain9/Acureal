import { useMemo, useState } from 'react';
import { Search, AlertTriangle, BarChart3 } from 'lucide-react';
import { Card, ErrorState, SectionHeader, StatTile } from '../../design-system';
import { useUavBenchmark } from '../../hooks/useMasterPlan';

const fmt = (value, fractionDigits = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
};

// Group property_use labels into broad families so reviewers can filter
// the matrix by intent (residential vs non-residential vs vacant land vs
// hospitality / kalyana mantapa). Heuristic — mirrors the actual label
// vocabulary in the seeded BBMP UAV rate card.
const classifyUse = (use) => {
  const lower = (use || '').toLowerCase();
  // Non-residential must be checked before "residential" because "non-residential"
  // contains the substring "residential".
  if (lower.includes('non-residential')) return 'non_residential';
  if (lower.includes('residential')) return 'residential';
  if (lower.includes('vacant land') || lower.includes('not built')) return 'vacant_land';
  if (lower.includes('paying guest')) return 'pg';
  if (lower.includes('kalyana') || lower.includes('convention')) return 'hospitality';
  return 'other';
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'All uses' },
  { key: 'residential', label: 'Residential' },
  { key: 'non_residential', label: 'Non-residential' },
  { key: 'vacant_land', label: 'Vacant land' },
  { key: 'hospitality', label: 'Hospitality / PG' },
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
      <span className="sr-only">Loading UAV benchmark</span>
    </Card>
  );
}

// Sequential heat ramp: highest rate → mist; lowest → off-white. Returns
// inline style so the cells stay theme-tokenised on the borders/text but
// the heat colour is a deterministic mix.
const heatStyle = (rate, maxRate) => {
  if (!Number.isFinite(rate) || !Number.isFinite(maxRate) || maxRate === 0) {
    return {};
  }
  const t = Math.max(0, Math.min(1, rate / maxRate));
  // Off-white (low) → primary-300 tint (high) using HSL on the editorial palette.
  // 230° is a calm slate hue; alpha ramp keeps the light theme readable.
  const alpha = (0.06 + 0.30 * t).toFixed(2);
  return { backgroundColor: `rgba(45, 64, 89, ${alpha})` };
};

export default function UavBenchmarkPanel() {
  const { data, isLoading, isError } = useUavBenchmark();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const matrix = data?.matrix || [];
  const zones = data?.zones || [];
  const ratios = data?.ratios || {};
  const summary = data?.summary || {};

  const filteredMatrix = useMemo(() => {
    const s = search.trim().toLowerCase();
    return matrix.filter((row) => {
      if (filter !== 'all' && classifyUse(row.use) !== filter) return false;
      if (s && !row.use.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [matrix, search, filter]);

  const maxRate = useMemo(() => {
    let m = 0;
    for (const row of filteredMatrix) {
      for (const cell of row.cells) {
        if (Number.isFinite(cell.rate) && cell.rate > m) m = cell.rate;
      }
    }
    return m;
  }, [filteredMatrix]);

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load UAV benchmark">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  if (!matrix.length) {
    return (
      <ErrorState tone="info" title="No BBMP UAV rate card ingested yet">
        Once the BBMP property-tax UAV rate card has been ingested, this panel will surface zone × use rates with comparison ratios.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Property-tax tiers"
        title="BBMP UAV Benchmark — zone × use rate matrix"
        sub="The BBMP property-tax Unit Area Values pivoted into a (zone × property_use) matrix. Use the ratio strip to read how rates discount from CBD outward — Zone A is the anchor at 1.00x, every other zone is the average of its rate vs Zone A across all use categories."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="UAV zones" value={fmt(summary.zone_count)} footnote="A through F (Zone A = CBD)" />
        <StatTile label="Property uses" value={fmt(summary.use_count)} footnote="Distinct rate categories" />
        <StatTile label="Rate-card rows" value={fmt(summary.row_count)} footnote="Zone × use combinations" />
        <StatTile
          label="Outer-zone discount"
          value={ratios?.F ? `${(ratios.F * 100).toFixed(0)}%` : '—'}
          footnote={ratios?.F ? 'Zone F vs Zone A' : 'Awaiting Zone F data'}
          negative={Number(ratios?.F) < 1}
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search property use (e.g. residential, IT, kalyana mantapa)"
            className="w-full pl-9 pr-3 py-2 text-sm bg-bg-elevated border border-hairline rounded-md text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 transition-all duration-120"
            aria-label="Search property uses"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilter(opt.key)}
              className={`px-2.5 py-1 rounded text-xs tabular-nums transition-colors duration-150 border ${
                filter === opt.key
                  ? 'bg-accent-soft text-accent border-accent'
                  : 'bg-bg-secondary text-content-secondary hover:text-content-primary border-transparent'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <Card elevated className="p-0 overflow-hidden">
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline sticky top-0 z-10">
              <tr>
                <th className="text-left font-medium px-4 py-2">Property use</th>
                {zones.map((z) => (
                  <th key={z} className="text-right font-medium px-3 py-2">
                    {/* Each zone header is a click-through into the Bengaluru
                        Street Lookup pre-filtered to this zone. We fire a
                        window-level CustomEvent the lookup panel listens on
                        — keeps both panels independent (no shared parent
                        state) while still wiring the navigation. */}
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('bbmp:focus-zone', { detail: { zone: z } }));
                      }}
                      className="text-right hover:text-accent hover:underline transition-colors duration-120 cursor-pointer"
                      title={`Filter the Bengaluru Street Lookup to Zone ${z}`}
                    >
                      Zone {z}
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="border-t border-hairline bg-bg-elevated">
                <td className="text-eyebrow uppercase tracking-[0.08em] text-content-muted px-4 py-1 text-left">
                  Avg ratio vs Zone A
                </td>
                {zones.map((z) => (
                  <td key={z} className="text-right tabular-nums text-content-secondary px-3 py-1">
                    {ratios[z] != null ? `${ratios[z].toFixed(2)}x` : '—'}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filteredMatrix.length === 0 ? (
                <tr>
                  <td colSpan={zones.length + 1} className="px-4 py-6 text-center text-content-muted text-sm">
                    No uses match this filter.
                  </td>
                </tr>
              ) : filteredMatrix.map((row) => (
                <tr key={row.use} className="hover:bg-bg-secondary/40 transition-colors duration-150">
                  <td className="px-4 py-2 text-content-primary leading-snug" title={row.use}>
                    {row.use}
                  </td>
                  {row.cells.map((cell) => (
                    <td
                      key={`${row.use}-${cell.zone}`}
                      className="text-right tabular-nums px-3 py-2 text-content-primary"
                      style={heatStyle(cell.rate, maxRate)}
                    >
                      {cell.rate == null ? '—' : `₹${fmt(cell.rate, 2)}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[11px] text-content-muted border-t border-hairline flex items-center gap-1.5">
          <BarChart3 size={11} />
          Rates in {data.unit_label || 'INR per sqft per month'}.
          {summary.source_pages?.length ? ` Source pages: ${summary.source_pages.join(', ')}.` : ''}
        </div>
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
