import { Fragment, useMemo, useState } from 'react';
import { Search, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton, StatTile } from '../../design-system';
import { useDistrictIntelligence } from '../../hooks/useMasterPlan';

const fmt = (value, fractionDigits = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
};

const fmtCompactPopulation = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return n.toLocaleString('en-IN');
};

const SORT_OPTIONS = [
  { key: 'pd_code', label: 'PD code' },
  { key: 'population_2011', label: 'Population' },
  { key: 'area_ha', label: 'Area' },
  { key: 'gross_density_pph', label: 'Density' },
];

function PanelSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40 rounded" />
        <Skeleton className="h-5 w-2/3 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3">
          <Skeleton className="h-20 rounded" />
          <Skeleton className="h-20 rounded" />
          <Skeleton className="h-20 rounded" />
          <Skeleton className="h-20 rounded" />
        </div>
        <Skeleton className="h-96 rounded" />
      </div>
      <span className="sr-only">Loading district intelligence</span>
    </Card>
  );
}

function SortHeader({ children, sortKey, currentSort, onSort, align = 'left' }) {
  const active = currentSort.key === sortKey;
  const Icon = active && currentSort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th
      className={`font-medium px-4 py-2 text-${align} cursor-pointer select-none hover:text-content-primary transition-colors duration-120`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {children}
        {active && <Icon size={11} aria-hidden="true" />}
      </span>
    </th>
  );
}

export default function DistrictIntelligencePanel() {
  const { data, isLoading, isError } = useDistrictIntelligence();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'pd_code', dir: 'asc' });
  const [expanded, setExpanded] = useState(null);

  const handleSort = (key) => {
    setSort((prev) => {
      if (prev.key !== key) {
        // Default direction: ascending for code/name, descending for numeric.
        return { key, dir: key === 'pd_code' ? 'asc' : 'desc' };
      }
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  const districts = useMemo(() => {
    if (!data?.districts) return [];
    const s = search.trim().toLowerCase();
    let rows = data.districts;
    if (s) {
      rows = rows.filter(
        (d) =>
          (d.pd_code || '').toLowerCase().includes(s)
          || (d.pd_name || '').toLowerCase().includes(s),
      );
    }
    rows = [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const aMissing = av == null;
      const bMissing = bv == null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1; // nulls always last
      if (bMissing) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, search, sort]);

  const summary = data?.summary || {};
  const callouts = data?.callouts || {};

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load district intelligence">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  if (!data?.districts?.length) {
    return (
      <ErrorState tone="info" title="No district facts yet">
        The 42 Bengaluru Planning Districts appear here once the RMP 2031 Volume 4 PDR has been ingested.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="42 Planning Districts"
        title="District Intelligence — RMP 2031 PDRs"
        sub="Per-PD demographics, density, and SDZ flags extracted from RMP 2031 Volume 4 (Planning District Reports). Click any row for the full notes block and source page."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Planning Districts"
          value={fmt(summary.district_count, 0)}
          footnote="Bengaluru BBMP + BMA"
        />
        <StatTile
          label="Special Development Zones"
          value={fmt(summary.sdz_count, 0)}
          footnote="Peripheral SDZ corridors"
        />
        <StatTile
          label="Total population (2011)"
          value={fmtCompactPopulation(summary.total_population_2011)}
          footnote="Census aggregate"
        />
        <StatTile
          label="Total area"
          value={fmt(summary.total_area_ha, 0)}
          footnote="Hectares · all PDs"
        />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PD code or area name (e.g. Whitefield, PD-11)"
            className="w-full pl-9 pr-3 py-2 text-sm bg-bg-elevated border border-hairline rounded-md text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 focus:border-accent-primary/60 transition-all duration-120"
            aria-label="Search planning districts"
          />
        </div>
        <div className="text-xs text-content-muted tabular-nums">
          {districts.length} of {data.districts.length} districts
        </div>
      </div>

      <Card elevated className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline">
              <tr>
                <SortHeader sortKey="pd_code" currentSort={sort} onSort={handleSort}>PD</SortHeader>
                <th className="text-left font-medium px-4 py-2">Name</th>
                <SortHeader sortKey="population_2011" currentSort={sort} onSort={handleSort} align="right">Population</SortHeader>
                <SortHeader sortKey="area_ha" currentSort={sort} onSort={handleSort} align="right">Area (Ha)</SortHeader>
                <SortHeader sortKey="gross_density_pph" currentSort={sort} onSort={handleSort} align="right">Density (PPH)</SortHeader>
                <th className="text-right font-medium px-4 py-2">Wards / Villages</th>
                <th className="text-right font-medium px-4 py-2">Source pg.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {districts.map((d) => {
                const isOpen = expanded === d.pd_code;
                return (
                  <Fragment key={d.pd_code}>
                    <tr
                      className="hover:bg-bg-secondary/40 cursor-pointer transition-colors duration-150"
                      onClick={() => setExpanded(isOpen ? null : d.pd_code)}
                    >
                      <td className="px-4 py-2.5 text-content-primary font-medium tabular-nums">
                        {d.pd_code}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-content-primary truncate" title={d.pd_name}>{d.pd_name}</span>
                          {d.is_sdz && <Badge tone="warn">SDZ</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary">
                        {fmtCompactPopulation(d.population_2011)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary">
                        {fmt(d.area_ha, 1)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary">
                        {fmt(d.gross_density_pph, 1)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary">
                        {d.ward_count != null ? `${d.ward_count}W` : ''}
                        {d.ward_count != null && d.village_count != null ? ' · ' : ''}
                        {d.village_count != null ? `${d.village_count}V` : ''}
                        {d.ward_count == null && d.village_count == null && '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-content-muted text-xs">
                        {d.source_page || '—'}
                      </td>
                    </tr>
                    {isOpen && d.raw_notes && (
                      <tr className="bg-bg-secondary/20">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
                            Source notes
                          </div>
                          <p className="text-sm text-content-primary leading-relaxed">{d.raw_notes}</p>
                          {d.source_section && (
                            <p className="text-xs text-content-muted mt-1.5">
                              {d.source_section}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.isArray(callouts.landmarks) && callouts.landmarks.length > 0 && (
          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              Major landmarks in BMA
            </div>
            <div className="text-sm text-content-primary leading-snug">
              {callouts.landmarks.length} mapped
            </div>
            <div className="text-[11px] text-content-muted mt-1 leading-relaxed">
              {callouts.landmarks
                .slice(0, 6)
                .map((l) => (typeof l === 'string' ? l : l?.name || l?.label || ''))
                .filter(Boolean)
                .join(' · ')}
              {callouts.landmarks.length > 6 ? ` · +${callouts.landmarks.length - 6} more` : ''}
            </div>
          </div>
        )}
        {Array.isArray(callouts.adjacent_authorities) && callouts.adjacent_authorities.length > 0 && (
          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              Adjacent planning authorities
            </div>
            <div className="text-sm text-content-primary leading-snug">
              {callouts.adjacent_authorities.length} jurisdictions border BMA
            </div>
            <div className="text-[11px] text-content-muted mt-1 leading-relaxed">
              {callouts.adjacent_authorities
                .map((a) => (typeof a === 'string' ? a : a?.name || a?.authority || ''))
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        )}
        {callouts.peripheral_ring && (
          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              Peripheral Ring Road
            </div>
            <div className="text-sm text-content-primary leading-snug tabular-nums">
              {callouts.peripheral_ring.width_m} m · {callouts.peripheral_ring.type}
            </div>
            <div className="text-[11px] text-content-muted mt-1">{callouts.peripheral_ring.note}</div>
          </div>
        )}
      </div>

      {data?.disclaimer && (
        <div className="text-[11px] text-content-muted flex items-start gap-1.5">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{data.disclaimer}</span>
        </div>
      )}
    </div>
  );
}
