import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, FileText, AlertTriangle, BookOpen } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton, StatTile } from '../../design-system';
import { useStreetLookup } from '../../hooks/useMasterPlan';

// 200ms debounce keeps the panel responsive while reducing dead-on-arrival
// queries the user types past in flight.
function useDebounced(value, delayMs = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
};

function PanelSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40 rounded" />
        <Skeleton className="h-5 w-2/3 rounded" />
        <Skeleton className="h-12 rounded" />
        <Skeleton className="h-72 rounded" />
      </div>
      <span className="sr-only">Loading Bengaluru street lookup</span>
    </Card>
  );
}

function HitRow({ row }) {
  const hasZone = !!row.zone_code;
  const hasBand = row.guidance_value_band_min_inr != null
    || row.guidance_value_band_max_inr != null;

  return (
    <li className="px-4 py-2.5 border-b border-hairline last:border-b-0 hover:bg-bg-secondary/40 transition-colors duration-150">
      <div className="flex items-start gap-3">
        <MapPin size={13} className="mt-0.5 text-content-muted shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-content-primary leading-snug">
              {row.street_name_en}
            </span>
            {hasZone && <Badge tone="info">Zone {row.zone_code}</Badge>}
            {row.register && (
              <Badge tone={row.register === 'non_residential' ? 'warn' : 'neutral'}>
                {row.register === 'non_residential' ? 'Non-residential' : 'Residential'}
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-content-muted leading-snug mt-0.5 flex items-center gap-1.5 flex-wrap">
            {row.ward_no != null && (
              <span className="tabular-nums">Ward {row.ward_no}</span>
            )}
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1 tabular-nums">
              <FileText size={10} />PDF p.{row.page_number}
            </span>
            {row.aro_section && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[14rem]" title={row.aro_section}>
                  {row.aro_section}
                </span>
              </>
            )}
          </div>
          {hasBand && (
            <div className="text-[11px] text-content-secondary mt-1 tabular-nums">
              Guidance value: ₹{fmt(row.guidance_value_band_min_inr)}
              {row.guidance_value_band_max_inr != null
                ? ` – ₹${fmt(row.guidance_value_band_max_inr)}`
                : '+'}
              /sqft
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

const ZONE_FILTERS = [
  { key: null, label: 'All zones' },
  { key: 'A', label: 'Zone A' },
  { key: 'B', label: 'Zone B' },
  { key: 'C', label: 'Zone C' },
  { key: 'D', label: 'Zone D' },
  { key: 'E', label: 'Zone E' },
  { key: 'F', label: 'Zone F' },
];

const REGISTER_FILTERS = [
  { key: null, label: 'Both registers' },
  { key: 'residential', label: 'Residential' },
  { key: 'non_residential', label: 'Non-residential' },
];

export default function BengaluruStreetLookupPanel() {
  const [searchInput, setSearchInput] = useState('');
  const [zoneFilter, setZoneFilter] = useState(null);
  const [registerFilter, setRegisterFilter] = useState(null);
  const rootRef = useRef(null);
  const debouncedSearch = useDebounced(searchInput, 200);
  const { data, isLoading, isError, isFetching } = useStreetLookup({
    search: debouncedSearch,
    zone: zoneFilter,
    register: registerFilter,
    limit: 50,
  });

  // Cross-link: when the UAV Benchmark panel fires a 'bbmp:focus-zone'
  // event (clicked zone column header), set our filter to that zone and
  // scroll the panel into view. Window-level event keeps the two panels
  // independent — no shared parent state needed.
  useEffect(() => {
    const handler = (event) => {
      const zone = event?.detail?.zone;
      if (typeof zone !== 'string') return;
      const valid = ZONE_FILTERS.some((opt) => opt.key === zone);
      if (!valid) return;
      setZoneFilter(zone);
      // requestAnimationFrame so the layout settles before we scroll.
      requestAnimationFrame(() => {
        rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    window.addEventListener('bbmp:focus-zone', handler);
    return () => window.removeEventListener('bbmp:focus-zone', handler);
  }, []);

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load street lookup">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const totalIndexed = summary.total ?? 0;
  const distinctStreets = summary.distinct_streets ?? 0;
  const totalWards = summary.wards ?? 0;
  const enrichedCount = summary.enriched ?? 0;
  const enrichedPct = totalIndexed > 0
    ? Math.round((enrichedCount / totalIndexed) * 100)
    : 0;

  return (
    <div ref={rootRef} className="space-y-5">
      <SectionHeader
        eyebrow="Bengaluru street index"
        title="Find a street's BBMP zone + source page"
        sub="Type any area or street from inside BBMP limits. The index covers BOTH registers of the 686-page BBMP Guidance Value gazette (Notification No. 384 dated 09-Mar-2016): residential (pages 17-362) and non-residential (pages 363-686) — the same street can sit in different UAV zones per register. Each hit shows the ward, register, the exact PDF page, and the zone + guidance-value bandwidth read from the gazette's own section headers."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile
          label="Index entries"
          value={fmt(totalIndexed)}
          footnote={distinctStreets > 0
            ? `${fmt(distinctStreets)} unique streets (both registers)`
            : 'From BBMP gazette'}
        />
        <StatTile
          label="BBMP wards covered"
          value={fmt(totalWards)}
          footnote="All wards present"
        />
        <StatTile
          label="With zone enrichment"
          value={`${fmt(enrichedCount)} (${enrichedPct}%)`}
          footnote={enrichedPct < 100
            ? 'LLM pass extends coverage'
            : 'Full coverage'}
        />
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by street or area name (e.g. Whitefield Main Road, Koramangala, M G Road)"
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-bg-elevated border border-hairline rounded-md text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 transition-all duration-120"
          aria-label="Search BBMP streets"
        />
        {isFetching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-content-muted">
            …
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-eyebrow uppercase tracking-[0.08em] text-content-muted font-medium mr-1">
          Filter
        </span>
        {ZONE_FILTERS.map((opt) => {
          const active = zoneFilter === opt.key;
          const count = opt.key ? (summary.by_zone?.[opt.key] ?? 0) : totalIndexed;
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => setZoneFilter(opt.key)}
              className={`px-2.5 py-1 rounded text-xs tabular-nums transition-colors duration-150 border ${
                active
                  ? 'bg-accent-soft text-accent border-accent'
                  : 'bg-bg-secondary text-content-secondary hover:text-content-primary border-transparent'
              }`}
            >
              {opt.label}
              {count > 0 && <span className="ml-1 text-[11px] opacity-70">({fmt(count)})</span>}
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-1 text-content-muted">·</span>
        {REGISTER_FILTERS.map((opt) => {
          const active = registerFilter === opt.key;
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => setRegisterFilter(opt.key)}
              className={`px-2.5 py-1 rounded text-xs transition-colors duration-150 border ${
                active
                  ? 'bg-accent-soft text-accent border-accent'
                  : 'bg-bg-secondary text-content-secondary hover:text-content-primary border-transparent'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <Card elevated className="p-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-content-muted">
            {debouncedSearch || zoneFilter
              ? `No streets match the current filter. ${debouncedSearch ? `Try a shorter or differently-spelled fragment — the gazette uses formal street names (e.g. "MAHATMA GANDHI ROAD" not "MG").` : 'Clear the zone filter to see all results.'}`
              : 'Start typing a street or area name above to search the index.'}
          </div>
        ) : (
          <>
            <div className="px-4 py-2 text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline font-medium flex items-center justify-between">
              <span>
                {debouncedSearch
                  ? `${rows.length} match${rows.length === 1 ? '' : 'es'} for "${debouncedSearch}"`
                  : zoneFilter
                    ? `Showing first ${rows.length} streets in Zone ${zoneFilter}`
                    : `Showing first ${rows.length} streets`}
              </span>
              <span className="flex items-center gap-1 text-[11px] normal-case tracking-normal">
                <BookOpen size={11} />
                {data?.source_document || 'BBMP Guidance Value gazette'}
              </span>
            </div>
            <ul className="max-h-[28rem] overflow-y-auto">
              {rows.map((row) => (
                <HitRow key={row.id} row={row} />
              ))}
            </ul>
          </>
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
