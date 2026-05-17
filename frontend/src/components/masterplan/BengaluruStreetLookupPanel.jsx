import { useEffect, useState } from 'react';
import { Search, MapPin, FileText, AlertTriangle, BookOpen } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, StatTile } from '../../design-system';
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
      <div className="space-y-3 animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-40 rounded bg-bg-secondary" />
        <div className="h-5 w-2/3 rounded bg-bg-secondary" />
        <div className="h-12 rounded bg-bg-secondary" />
        <div className="h-72 rounded bg-bg-secondary" />
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

export default function BengaluruStreetLookupPanel() {
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounced(searchInput, 200);
  const { data, isLoading, isError, isFetching } = useStreetLookup({
    search: debouncedSearch,
    limit: 50,
  });

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load street lookup">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  const rows = data?.rows || [];
  const totalIndexed = 9913; // From the seeded BBMP Guidance Value PDF
  const totalWards = 198;
  const enrichedCount = rows.filter((r) => r.zone_code).length;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Bengaluru street index"
        title="Find a street's BBMP zone + source page"
        sub="Type any area or street from inside BBMP limits. The index is built from every street listed in the 686-page BBMP Guidance Value gazette (Notification No. 384 dated 09-Mar-2016). Each hit shows the ward, the exact PDF page so you can verify the zone classification, and — once Phase 2 enrichment lands — the assigned UAV zone + guidance-value bandwidth."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile
          label="Streets indexed"
          value={fmt(totalIndexed)}
          footnote="From BBMP gazette"
        />
        <StatTile
          label="BBMP wards covered"
          value={fmt(totalWards)}
          footnote="All wards present"
        />
        <StatTile
          label="With zone enrichment"
          value={fmt(enrichedCount)}
          footnote="Phase 2 fills the rest"
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

      <Card elevated className="p-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-content-muted">
            {debouncedSearch
              ? `No streets matched "${debouncedSearch}". Try a shorter or differently-spelled fragment — the gazette uses formal street names (e.g. "MAHATMA GANDHI ROAD" not "MG").`
              : 'Start typing a street or area name above to search the index.'}
          </div>
        ) : (
          <>
            <div className="px-4 py-2 text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline font-medium flex items-center justify-between">
              <span>
                {debouncedSearch
                  ? `${rows.length} match${rows.length === 1 ? '' : 'es'} for "${debouncedSearch}"`
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
