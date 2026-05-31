import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Calendar,
  MapPin,
  BarChart2,
  ChevronDown,
  RefreshCw,
  ArrowUpRight,
  Building2,
  DollarSign,
  Download,
  Loader2,
} from 'lucide-react';
import { exportsAPI } from '../services/api';
import {
  useDailyBrief,
  useMarketTransactions,
  useMicroMarketBenchmarks,
  useOfficeBenchmarks,
  useRetailBenchmarks,
  useIndustrialBenchmarks,
  useHospitalityBenchmarks,
  useResidentialSegmentedBenchmarks,
  useNicheAssetClassBenchmarks,
  useMacroKpis,
} from '../hooks/useIntelligence';
import AdminNotesPanel from '../components/intelligence/AdminNotesPanel';
import MacroKpiTile from '../components/intelligence/MacroKpiTile';
import {
  OfficeBenchmarksTable,
  RetailBenchmarksTable,
  IndustrialBenchmarksTable,
  HospitalityBenchmarksTable,
} from '../components/intelligence/AssetClassBenchmarkTables';
import {
  AssetClassSummaryTile,
  ResidentialSegmentedBenchmarksTable,
  NicheAssetClassBenchmarksTable,
} from '../components/intelligence/SegmentedBenchmarkTables';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import DataToolbar from '../components/common/DataToolbar';
import SortableHeader, { applySort, cycleSort } from '../components/common/SortableHeader';
import { toast } from '../components/common/Toast';
import { SkeletonKpi, SkeletonCard, Skeleton } from '../design-system';
import { formatPct, formatCrores, formatDate, STAGE_CONFIG } from '../utils/format';
import {
  buildClusterOptions,
  matchesSearch,
} from '../utils/intelligenceTableHelpers';
import useAuthStore from '../store/authStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionCard({ icon: Icon, title, children, action, className = '' }) {
  return (
    <div className={`bg-bg-elevated rounded-xl border border-hairline-strong shadow-editorial overflow-hidden transition-shadow duration-200 ease-out hover:shadow-md ${className}`}>
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-hairline bg-bg-secondary/60">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-elevated border border-hairline shrink-0">
          <Icon size={13} className="text-content-secondary" />
        </span>
        <h3 className="text-sm font-semibold tracking-tight text-content-primary min-w-0 truncate">{title}</h3>
        {action && <div className="ml-auto shrink-0 flex items-center gap-2">{action}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}


// ─── Formatting helpers ────────────────────────────────────────────────────────

const formatQuantum = (mn) => {
  if (!mn) return '—';
  const cr = mn / 100;
  return cr >= 1000
    ? `₹${(cr / 1000).toFixed(2)} TCr`
    : `₹${cr.toFixed(0)} Cr`;
};

const formatLandSize = (acres, note) => {
  if (!acres && !note) return '—';
  if (note && !acres) return note;
  if (acres && note) return `${acres} ac · ${note}`;
  return `${acres} ac`;
};

const DEAL_TYPE_BADGE = {
  'Land deal':        'bg-blue-100 text-blue-700',
  'Equity investment':'bg-emerald-100 text-emerald-700',
  'Debt':             'bg-amber-100 text-amber-700',
};

// ─── Admin Market Notes Editor — extracted to ../components/intelligence/AdminNotesPanel.jsx (2026-05-25, Task #6)

// ─── Market Transaction Table ──────────────────────────────────────────────────

function TransactionTable({ rows }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 10);

  return (
    <div>
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-xs border-collapse min-w-[800px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">FY / Q</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Type</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Buyer / Borrower</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Seller / Lender</th>
              <th className="text-right py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Quantum</th>
              <th className="text-right py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Land / Size</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary">Locality</th>
              <th className="text-left py-2 px-3 font-semibold text-content-secondary max-w-[200px]">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.id || i} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                <td className="py-2 px-3 font-mono text-content-secondary whitespace-nowrap">
                  {row.fiscal_year} {row.quarter}
                </td>
                <td className="py-2 px-3 whitespace-nowrap">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DEAL_TYPE_BADGE[row.deal_type] || 'bg-bg-secondary text-content-secondary'}`}>
                    {row.deal_type}
                  </span>
                </td>
                <td className="py-2 px-3 text-content-primary max-w-[180px]">
                  <span className="line-clamp-2">{row.buyer || '—'}</span>
                </td>
                <td className="py-2 px-3 text-content-secondary max-w-[160px]">
                  <span className="line-clamp-2">{row.investor_lender || row.seller || '—'}</span>
                </td>
                <td className="py-2 px-3 text-right font-semibold text-content-primary whitespace-nowrap">
                  {formatQuantum(row.quantum_inr_mn)}
                </td>
                <td className="py-2 px-3 text-right text-content-secondary whitespace-nowrap">
                  {formatLandSize(row.land_size_acres, row.project_size_note)}
                </td>
                <td className="py-2 px-3 text-content-secondary whitespace-nowrap">{row.locality || '—'}</td>
                <td className="py-2 px-3 text-content-secondary max-w-[200px]">
                  <span className="line-clamp-2">{row.notes || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Show less' : `Show all ${rows.length} transactions`}
        </button>
      )}

      <p className="mt-3 text-xs text-content-muted">
        Source: Economic Times, Business Standard, Hindustan Times, Moneycontrol, company press releases.
        All transactions verified from public disclosures. Quantum in ₹ Cr.
      </p>
    </div>
  );
}

// ─── Micro-Market Benchmarks Table ────────────────────────────────────────────

// Classify a row's data_type into one of three top-level layers per the
// methodology doc: "Create separate tabs/layers in the REDIP UI: Listing
// Benchmarks, IPC Benchmarks, Guidance Value, Internal Deals." Tagging
// rows by prefix means new v0.x cohorts auto-roll up without a code edit.
const layerForDataType = (dt) => {
  if (!dt) return 'other';
  if (dt.startsWith('listing_'))               return 'listing';
  if (dt.startsWith('ipc_'))                   return 'ipc';
  if (dt.startsWith('internal_') ||
      dt.startsWith('verified_'))              return 'internal';
  return 'other';
};

// Per-row pill label. Walks the prefix table so v0.2 sub-segments
// (high_end, mid_segment) get their own readable badge instead of an
// opaque slug.
const dataTypeBadge = (dt) => {
  if (!dt) return { tone: 'neutral', label: '—' };
  if (dt === 'listing_q1_2026' || dt === 'listing_q1_2026_v0_2') return { tone: 'info',    label: 'Listing Q1 2026' };
  if (dt === 'ipc_q1_2026'     || dt === 'ipc_q1_2026_v0_2')     return { tone: 'premium', label: 'IPC Q1 2026' };
  if (dt === 'ipc_q1_2026_v0_2_high_end')                        return { tone: 'premium', label: 'IPC · High-end' };
  if (dt === 'ipc_q1_2026_v0_2_mid_segment')                     return { tone: 'premium', label: 'IPC · Mid-segment' };
  if (dt.startsWith('internal_benchmark'))                       return { tone: 'success', label: 'Internal · Verified' };
  return { tone: 'neutral', label: dt };
};

function BenchmarksTable({ rows }) {
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | listing | ipc | internal
  const [sort, setSort] = useState({ key: 'avg_price_max_per_sqft', dir: 'desc' });

  const onSort = useCallback((k) => setSort((p) => cycleSort(k, p)), []);

  const filteredRows = useMemo(() => rows.filter((r) => {
    const layer = layerForDataType(r.data_type);
    if (filter !== 'all' && layer !== filter) return false;
    return matchesSearch(r, search, ['micro_market', 'anchor_hub', 'data_period']);
  }), [rows, filter, search]);

  const sortedRows = useMemo(() => applySort(filteredRows, sort, {
    yoy_change: (r) => Number(r.yoy_growth_max_pct ?? r.yoy_growth_min_pct ?? 0),
    avg_price_max_per_sqft: (r) => Number(r.avg_price_max_per_sqft ?? 0),
    avg_price_min_per_sqft: (r) => Number(r.avg_price_min_per_sqft ?? 0),
    sro_rate_per_sqft: (r) => Number(r.sro_rate_per_sqft ?? 0),
    micro_market: (r) => r.micro_market || '',
  }), [filteredRows, sort]);

  const visible = showAll ? sortedRows : sortedRows.slice(0, 12);
  const maxPrice = Math.max(...sortedRows.map((r) => r.avg_price_max_per_sqft || 0));

  // Live counts for the layer chips. Rebuilds whenever rows change so the
  // UI never lies about cohort sizes.
  const layerCounts = useMemo(() => {
    const c = { listing: 0, ipc: 0, internal: 0, other: 0 };
    for (const r of rows) c[layerForDataType(r.data_type)] += 1;
    return c;
  }, [rows]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <DataToolbar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search micro-market or anchor hub…"
          ariaLabel="Search residential micro-markets"
        />
        {/* Source-layer toggle. Listing (99acres/MagicBricks asking-prices)
            vs. IPC (C&W/JLL/KF benchmarks) vs. Internal (REDIP-verified
            comps). Methodology doc explicitly demands this separation;
            blending them silently destroys credibility. Hide a chip if
            its count is zero so the UI doesn't surface empty buckets. */}
        <DataToolbar.Chips
          value={filter === 'all' ? null : filter}
          onChange={(v) => { setFilter(v || 'all'); setShowAll(false); }}
          options={[
            layerCounts.listing  > 0 && { value: 'listing',  label: 'Listing portals', count: layerCounts.listing },
            layerCounts.ipc      > 0 && { value: 'ipc',      label: 'IPC benchmarks',  count: layerCounts.ipc },
            layerCounts.internal > 0 && { value: 'internal', label: 'Internal',        count: layerCounts.internal },
          ].filter(Boolean)}
          allowAll
          allLabel="All sources"
        />
      </div>
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-xs border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <SortableHeader sortKey="micro_market" sort={sort} onSort={onSort} className="py-2 px-3">Micro-Market</SortableHeader>
              <SortableHeader sortKey="avg_price_max_per_sqft" sort={sort} onSort={onSort} className="py-2 px-3">Range (₹/sqft)</SortableHeader>
              <SortableHeader sortKey="yoy_change" sort={sort} onSort={onSort} align="right" className="py-2 px-3">YoY</SortableHeader>
              <SortableHeader sortKey="sro_rate_per_sqft" sort={sort} onSort={onSort} align="right" className="py-2 px-3">SRO ₹/sf</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Anchor Hub</th>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary whitespace-nowrap">Source</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const barPct = maxPrice > 0 ? Math.round((row.avg_price_max_per_sqft / maxPrice) * 100) : 0;
              const yLow  = row.yoy_growth_min_pct != null ? Number(row.yoy_growth_min_pct) : null;
              const yHigh = row.yoy_growth_max_pct != null ? Number(row.yoy_growth_max_pct) : null;
              const growthLabel = yLow == null && yHigh == null ? '—'
                : yLow === yHigh ? `${yLow > 0 ? '+' : ''}${yLow}%`
                : `${yLow}–${yHigh}%`;
              const priceLabel = `₹${(Number(row.avg_price_min_per_sqft) / 1000).toFixed(1)}k–${(Number(row.avg_price_max_per_sqft) / 1000).toFixed(1)}k`;
              const growthVal = yHigh ?? yLow ?? 0;
              const growthColor = growthVal >= 20 ? 'text-emerald-600 font-semibold'
                : growthVal >= 10 ? 'text-emerald-600 font-medium'
                : growthVal >= 5 ? 'text-blue-600 font-medium'
                : growthVal < 0 ? 'text-red-500 font-medium'
                : 'text-content-secondary';
              const dt = dataTypeBadge(row.data_type);

              return (
                <tr key={row.id || i} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                  <td className="py-2.5 px-3 font-medium text-content-primary">
                    <div className="flex items-center gap-2">
                      <span>{row.micro_market}</span>
                      <Badge tone={dt.tone} className="text-[9px]">{dt.label}</Badge>
                    </div>
                    <div className="w-32 mt-1 bg-bg-secondary rounded-full h-1">
                      <div className="bg-primary-500 h-1 rounded-full" style={{ width: `${barPct}%` }} />
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-mono tabular-nums text-content-primary whitespace-nowrap">{priceLabel}</td>
                  <td className={`py-2.5 px-3 text-right tabular-nums whitespace-nowrap ${growthColor}`}>{growthLabel}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-secondary">
                    {row.sro_rate_per_sqft != null ? `₹${Number(row.sro_rate_per_sqft).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-content-secondary">{row.anchor_hub || '—'}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {row.source_url ? (
                      <a href={row.source_url} target="_blank" rel="noopener noreferrer"
                         className="text-primary-600 hover:text-primary-700 underline-offset-2 hover:underline text-[11px]"
                         title={row.source}>
                        {row.source?.split(' ').slice(0, 3).join(' ') || 'Link'}
                      </a>
                    ) : (
                      <span className="text-content-muted text-[11px]">{row.source || '—'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sortedRows.length > 12 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs font-medium text-primary-500 hover:text-primary-600 flex items-center gap-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded px-1 -mx-1"
        >
          <ChevronDown size={13} className={`transition-transform duration-150 ${showAll ? 'rotate-180' : ''}`} />
          {showAll ? 'Show less' : `Show all ${sortedRows.length} rows`}
        </button>
      )}
      <p className="mt-3 text-xs text-content-muted">
        Period: {rows[0]?.data_period || '2026Q1'} · Listing benchmarks from 99acres / Magicbricks; IPC calibration from Cushman &amp; Wakefield Q1 2026. SRO = Karnataka Sub-Registrar Office transaction rate.
      </p>
    </div>
  );
}

// ─── Macro KPI strip — MacroKpiTile extracted to ../components/intelligence/MacroKpiTile.jsx (2026-05-25, Task #6)

// ─── Asset-class benchmark tables ────────────────────────────────────────────

// ─── Asset-class benchmark tables — extracted to ../components/intelligence/AssetClassBenchmarkTables.jsx (2026-05-25, Task #6)


// ─── Residential Segmented + Niche tables — extracted to ../components/intelligence/SegmentedBenchmarkTables.jsx (2026-05-25, Task #6)


// ─── Niche Asset Class Benchmarks — extracted to ../components/intelligence/SegmentedBenchmarkTables.jsx (2026-05-25, Task #6)


// ─── Main Page ─────────────────────────────────────────────────────────────────

// Asset-class filter — Bengaluru is the only city we have data for, so the
// page is locked to Bengaluru. The top-right toggle filters benchmark
// sections by asset class instead, which matches how a Bengaluru deal
// professional actually thinks: "show me the office market" or "show me
// land prices", not "show me Hyderabad".
//
// 6 buckets + an All view, chosen to match institutional deal taxonomy:
//   - Residential       — apartments, builder floor, villa/house. The thickest
//                         dataset; everything where a homebuyer is the end-tenant.
//   - Land & Plotted    — plotted dev, raw residential land, guidance/circle
//                         rate. Different deal type from apartment underwriting.
//   - Office            — commercial Grade A by submarket. The deepest
//                         institutional-asset dataset.
//   - Retail & Hospitality — high-street vanilla retail + hotels. Both consumer-
//                         demand correlated; hospitality alone is too thin (5 rows)
//                         to deserve a separate pill.
//   - Industrial & Warehouse — manufacturing + logistics + serviced industrial
//                         land. Logistics-led demand, distinct underwriting.
//   - Niche & Alternatives — co-working / managed office, student housing /
//                         co-living, senior living, data centers. Operator-
//                         seeded asset classes where per-unit metrics differ
//                         (per-seat, per-bed, entry capital + monthly fee,
//                         MW capacity). Hidden when empty.
const ASSET_CLASS_FILTERS = [
  { value: 'all',            label: 'All' },
  { value: 'residential',    label: 'Residential' },
  { value: 'land',           label: 'Land & Plotted' },
  { value: 'office',         label: 'Office' },
  { value: 'retail_hosp',    label: 'Retail & Hospitality' },
  { value: 'industrial',     label: 'Industrial & Warehouse' },
  { value: 'niche',          label: 'Niche & Alternatives' },
];
const ASSET_CLASS_VALUES = ASSET_CLASS_FILTERS.map((f) => f.value);

// Maps an asset-class filter to the segmented-benchmarks rows it includes.
// Used by Section 5e to subset its row list when a residential or land
// filter is active.
const SEGMENTED_ASSET_CLASS_BUCKETS = {
  residential: new Set(['builder_floor', 'villa_house']),
  land:        new Set(['plotted_development', 'land_residential_plotted', 'guidance_value']),
};

const useAssetClassPreference = () => {
  const [assetClass, setAssetClass] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = window.localStorage.getItem('intelligence:assetClass');
    return ASSET_CLASS_VALUES.includes(stored) ? stored : 'all';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('intelligence:assetClass', assetClass);
    }
  }, [assetClass]);
  return [assetClass, setAssetClass];
};

// Compact asset-class selector — segmented chips. Mirrors the View toggle
// on the Comps page so the visual register stays consistent.
function AssetClassSelector({ value, onChange, options }) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-hairline-strong bg-bg-elevated p-0.5"
      role="group"
      aria-label="Asset class"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-out whitespace-nowrap ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] ' +
              (active
                ? 'bg-primary-50 text-primary-700 shadow-sm'
                : 'text-content-secondary hover:bg-bg-secondary hover:text-content-primary')
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function IntelligencePage() {
  const today = new Date().toISOString().slice(0, 10);
  // Bengaluru-locked: REDIP is Bengaluru-priority and Bengaluru is the only
  // city with seeded data. Multi-city navigation was removed — see asset-
  // class filter below for the replacement.
  const city = 'Bengaluru';
  const [assetClass, setAssetClass] = useAssetClassPreference();
  const { data: brief, isLoading, isError, refetch, isFetching } = useDailyBrief();
  const { data: transactions, isLoading: txLoading } = useMarketTransactions({ city });
  const { data: benchmarks, isLoading: bmLoading } = useMicroMarketBenchmarks({ city });
  const { data: officeBenchmarks } = useOfficeBenchmarks({ city });
  const { data: retailBenchmarks } = useRetailBenchmarks({ city });
  const { data: industrialBenchmarks } = useIndustrialBenchmarks({ city });
  const { data: hospitalityBenchmarks } = useHospitalityBenchmarks({ city });
  const { data: residentialSegmented } = useResidentialSegmentedBenchmarks({ city });
  const { data: nicheAssetBenchmarks } = useNicheAssetClassBenchmarks({ city });
  const { data: macroKpis } = useMacroKpis({ city });
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  // Section visibility per asset-class filter.
  const showSection = useCallback((bucket) => {
    if (assetClass === 'all') return true;
    return bucket === assetClass;
  }, [assetClass]);

  // Subset Section 5e rows based on which residential/land sub-classes
  // belong to the active filter. "All" shows everything; "Residential"
  // shows builder_floor + villa_house; "Land & Plotted" shows plotted_dev
  // + land_residential_plotted + guidance_value.
  const segmentedRowsForFilter = useMemo(() => {
    if (!Array.isArray(residentialSegmented)) return [];
    if (assetClass === 'all') return residentialSegmented;
    const allowed = SEGMENTED_ASSET_CLASS_BUCKETS[assetClass];
    if (!allowed) return [];
    return residentialSegmented.filter((r) => allowed.has(r.asset_class));
  }, [residentialSegmented, assetClass]);

  // Tear-sheet export — pulls a multi-page PDF snapshot of the current
  // city's verified macro KPIs, residential / office / retail / industrial
  // / hospitality benchmarks, and market transactions. Backend builds it
  // off the same service functions the page renders, so the PDF ties out
  // to the on-screen numbers exactly.
  const [exportingTearSheet, setExportingTearSheet] = useState(false);
  const handleExportTearSheet = useCallback(async () => {
    if (exportingTearSheet) return;
    setExportingTearSheet(true);
    try {
      const response = await exportsAPI.intelligenceTearSheet({ city });
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      link.download = `redip-${city.toLowerCase()}-market-tearsheet-${stamp}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Failed to generate tear-sheet PDF. Please try again.');
      // eslint-disable-next-line no-console
      console.error('Intelligence tear-sheet export failed:', err);
    } finally {
      setExportingTearSheet(false);
    }
  }, [exportingTearSheet, city]);

  // Skeleton: page header + 4 KPI tiles + 2 chart cards + briefing card. The
  // brief itself is a multi-section narrative, so the body skeleton is one
  // tall card to set expectation rather than fake the inner sections.
  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Market Intelligence" description="Live city benchmarks, transactions, and macro signals" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonCard height="h-64" />
          <SkeletonCard height="h-64" />
        </div>
        <SkeletonCard height="h-72" titleWidth="w-1/4" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 font-medium">Failed to load intelligence brief</p>
        <button onClick={() => refetch()} className="mt-3 btn btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader
        title="Market Intelligence"
        description={`Bengaluru real estate intelligence — ${today}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AssetClassSelector value={assetClass} onChange={setAssetClass} options={ASSET_CLASS_FILTERS} />
            <button
              onClick={handleExportTearSheet}
              disabled={exportingTearSheet}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-content-secondary transition-colors duration-150 ease-out hover:border-primary-300 hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-hairline-strong"
              title="Download Bengaluru Q1 2026 tear-sheet PDF"
            >
              {exportingTearSheet ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {exportingTearSheet ? 'Generating…' : 'Tear-Sheet'}
            </button>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      {/* "Internal pipeline data — external inventory feeds not yet configured"
          banner intentionally removed (per 2026-05-08 cleanup). The page now
          hides empty sections via section-level `notConfigured` checks rather
          than carrying a top-of-page disclaimer. The verified KPI strip and
          per-section copy already make data provenance clear. */}

      {/* Bengaluru Macro KPI strip — Q1 2026 verified */}
      {macroKpis?.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
              Bengaluru Q1 2026 — Verified Macro Indicators
            </p>
            <p className="text-[10px] text-content-muted tabular-nums">{macroKpis.length} metrics</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {macroKpis.map((k) => <MacroKpiTile key={k.id} kpi={k} />)}
          </div>
        </div>
      )}

      {/* Claude AI Brief — editorial chrome (neutral surface + accent stripe
          on the left) replacing the indigo-tinted tile. Carries the mandated
          AI-assisted disclaimer per CLAUDE.md hard rule. */}
      {brief?.claudeBrief && (
        <div className="relative rounded-xl border border-hairline-strong bg-bg-elevated shadow-editorial overflow-hidden">
          <span
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-500 via-indigo-400 to-violet-500"
            aria-hidden="true"
          />
          <div className="px-6 py-5 pl-7">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mb-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700">
                <Brain size={13} />
              </span>
              <p className="text-eyebrow uppercase tracking-[0.12em] font-semibold text-content-muted">AI Brief</p>
              <span className="text-sm font-semibold text-content-primary">Claude · Daily Synthesis</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                AI-assisted · review before relying
              </span>
              <span className="ml-auto text-[11px] text-content-muted">Generated from internal pipeline data only</span>
            </div>
            <p className="text-sm text-content-primary whitespace-pre-line leading-relaxed">{brief.claudeBrief}</p>
          </div>
        </div>
      )}

      {/* Row 1: Deal of Day + Key Developments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard icon={TrendingUp} title="1. Deal of the Day">
          {brief?.dealOfDay ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-content-primary">{brief.dealOfDay.headline}</h4>
                {brief.dealOfDay.stage && (
                  <Badge tone={STAGE_CONFIG[brief.dealOfDay.stage]?.tone}>
                    {STAGE_CONFIG[brief.dealOfDay.stage]?.label || brief.dealOfDay.stage}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {brief.dealOfDay.city && (
                  <div className="flex items-center gap-1 text-sm text-content-secondary">
                    <MapPin size={13} /><span>{brief.dealOfDay.city}</span>
                  </div>
                )}
                {brief.dealOfDay.assetClass && (
                  <span className="text-xs rounded-full bg-bg-secondary px-2 py-0.5 text-content-secondary capitalize">
                    {brief.dealOfDay.assetClass.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {brief.dealOfDay.irrPct != null && (
                  <div className="rounded-lg bg-bg-secondary px-3 py-2">
                    <p className="text-xs text-content-secondary">Modeled IRR</p>
                    <p className="text-base font-bold text-content-primary">{formatPct(brief.dealOfDay.irrPct)}</p>
                  </div>
                )}
                {brief.dealOfDay.totalRevenueCr != null && (
                  <div className="rounded-lg bg-bg-secondary px-3 py-2">
                    <p className="text-xs text-content-secondary">Total Revenue</p>
                    <p className="text-base font-bold text-content-primary">{formatCrores(brief.dealOfDay.totalRevenueCr)}</p>
                  </div>
                )}
              </div>
              {brief.dealOfDay.whyItMatters && (
                <p className="text-xs text-content-secondary italic border-l-2 border-primary-300 pl-3">
                  {brief.dealOfDay.whyItMatters}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-content-secondary">No deals in pipeline yet. Add a deal to see it surface here.</p>
          )}
        </SectionCard>

        <SectionCard icon={Calendar} title="2. Key Developments">
          {brief?.keyDevelopments?.length > 0 ? (
            <ul className="space-y-3">
              {brief.keyDevelopments.map((dev, i) => (
                <li key={i} className="border-b border-hairline last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-content-primary">{dev.headline}</span>
                    {dev.city && <span className="text-xs text-content-muted flex-shrink-0">{dev.city}</span>}
                  </div>
                  {dev.whyItMatters && <p className="text-xs text-content-secondary mt-1">{dev.whyItMatters}</p>}
                  {dev.date && <p className="text-xs text-content-muted mt-0.5">{formatDate(dev.date)}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">No pipeline activity recorded yet.</p>
          )}
        </SectionCard>
      </div>

      {/* Row 2: Market Signals + Micro-Market Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard icon={BarChart2} title="3. Market Signals">
          {brief?.marketSignals ? (
            <div className="space-y-3">
              {brief.marketSignals.bullish?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-emerald-700 mb-1 flex items-center gap-1">
                    <TrendingUp size={12} /> Bullish signals
                  </p>
                  <ul className="space-y-1">
                    {brief.marketSignals.bullish.map((s, i) => (
                      <li key={i} className="text-xs text-content-secondary flex gap-2">
                        <CheckCircle size={11} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {brief.marketSignals.risk?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                    <AlertTriangle size={12} /> Risk signals
                  </p>
                  <ul className="space-y-1">
                    {brief.marketSignals.risk.map((s, i) => (
                      <li key={i} className="text-xs text-content-secondary flex gap-2">
                        <TrendingDown size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {brief.marketSignals.sourceType === 'internal_pipeline_only' && (
                <p className="text-xs text-content-muted italic mt-2">Source: internal pipeline data only</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-content-secondary">No market signals available.</p>
          )}
        </SectionCard>

        {/* Section 4 (Bengaluru Micro-Market Intelligence) was a 0-row admin-
            notes surface gated on `market_notes WHERE section='micro_market'`
            with no rows in production. The actual 38 rows of verified
            micro-market data render below in Section 7 (Demand Heatmap).
            Removed per the "hide empty sections cleanly" pattern from
            PRs #173/#174 — only re-render this surface when admin notes
            actually exist. */}
        {brief?.bengaluruMicroMarketIntelligence?.length > 0 && (
          <SectionCard icon={MapPin} title="4. Bengaluru Micro-Market Intelligence">
            <ul className="space-y-2">
              {brief.bengaluruMicroMarketIntelligence.map((item, i) => (
                <li key={i} className="text-xs text-content-secondary border-l-2 border-primary-200 pl-3">{item}</li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      {/* Section 5: Residential Micro-Market Benchmark Summary.
          Hidden entirely when empty — same as Sections 5a–5e — so users
          never see the operator-y "apply migration X.sql" empty state. */}
      {showSection('residential') && (bmLoading || benchmarks?.length > 0) && (
        <SectionCard
          icon={DollarSign}
          title="5. Residential Micro-Market Benchmarks — Bengaluru Q1 2026"
        >
          {bmLoading ? (
            <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
              <RefreshCw size={14} className="animate-spin" /> Loading benchmarks…
            </div>
          ) : (
            <BenchmarksTable rows={benchmarks} />
          )}
        </SectionCard>
      )}

      {/* Section 5a: Commercial Office — Vacancy + Rent (IPC zones + 30 submarkets) */}
      {showSection('office') && officeBenchmarks?.length > 0 && (
        <SectionCard
          icon={Building2}
          title="5a. Commercial Office — Vacancy + Rent, Q1 2026"
        >
          <OfficeBenchmarksTable rows={officeBenchmarks} />
        </SectionCard>
      )}

      {/* Section 5b: Retail — High-street + Mall Grade A */}
      {showSection('retail_hosp') && retailBenchmarks?.length > 0 && (
        <SectionCard
          icon={DollarSign}
          title="5b. Retail — High-Street + Mall Grade A, Q1 2026"
        >
          <RetailBenchmarksTable rows={retailBenchmarks} />
        </SectionCard>
      )}

      {/* Section 5c: Industrial / Warehouse — H2 2025 */}
      {showSection('industrial') && industrialBenchmarks?.length > 0 && (
        <SectionCard
          icon={Building2}
          title="5c. Industrial / Warehouse / Serviced Land — H2 2025"
        >
          <IndustrialBenchmarksTable rows={industrialBenchmarks} />
        </SectionCard>
      )}

      {/* Section 5d: Hospitality — ADR / Occupancy / RevPAR */}
      {showSection('retail_hosp') && hospitalityBenchmarks?.length > 0 && (
        <SectionCard
          icon={Building2}
          title="5d. Hospitality — ADR / Occupancy / RevPAR"
        >
          <HospitalityBenchmarksTable rows={hospitalityBenchmarks} />
        </SectionCard>
      )}

      {/* Section 5e: Residential segmented — Builder floor / Plotted dev / Land plotted / Villa-house / Guidance value */}
      {(showSection('residential') || showSection('land')) && segmentedRowsForFilter.length > 0 && (
        <SectionCard
          icon={DollarSign}
          title={
            assetClass === 'land'
              ? '5e. Plotted Development · Land · Guidance Value — Bengaluru Q1 2026'
              : assetClass === 'residential'
              ? '5e. Builder Floor · Villa / House — Bengaluru Q1 2026'
              : '5e. Residential by Asset Class — Builder Floor · Plotted · Land · Villa · Guidance — Bengaluru Q1 2026'
          }
        >
          <ResidentialSegmentedBenchmarksTable rows={segmentedRowsForFilter} />
        </SectionCard>
      )}

      {/* Section 5g: Niche & Alternatives — Co-working / Student housing /
          Senior living / Data centers. Hidden when empty per the "no
          operator-y migration prompts" rule — the data flywheel populates
          the table when the operator drops an IPC report or broker quote
          into the Comps Review Queue. */}
      {showSection('niche') && Array.isArray(nicheAssetBenchmarks) && nicheAssetBenchmarks.length > 0 && (
        <SectionCard
          icon={Building2}
          title="5g. Niche & Alternatives — Co-working · Student housing · Senior living · Data centers"
        >
          <NicheAssetClassBenchmarksTable rows={nicheAssetBenchmarks} />
        </SectionCard>
      )}

      {/* Section 6: Market Transaction Flow.
          Always visible regardless of asset-class filter (transactions
          don't carry per-row `asset_class`, only `deal_type`), but
          hidden entirely when empty — no operator-y migration prompts. */}
      {(txLoading || transactions?.length > 0) && (
        <SectionCard
          icon={ArrowUpRight}
          title="6. Market Transaction Flow — Bengaluru (FY2025–FY2027)"
        >
          {txLoading ? (
            <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
              <RefreshCw size={14} className="animate-spin" /> Loading transactions…
            </div>
          ) : (
            <TransactionTable rows={transactions} />
          )}
        </SectionCard>
      )}

      {/* Section 7: Demand Heatmap — Bengaluru micro-markets are residential-
          focused. Hide in non-residential filters (office/retail/etc). */}
      {showSection('residential') && brief?.bengaluruDemandHeatmap?.length > 0 && (
        <SectionCard icon={BarChart2} title="7. Demand Heatmap — Bengaluru Micro-Markets">
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary">Micro-Market</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Avg Price (₹/sqft)</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">YoY Growth</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary whitespace-nowrap">Demand Signal</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary">Anchor Hub</th>
                  <th className="text-left py-2 px-3 font-semibold text-content-secondary max-w-[220px]">Insight</th>
                </tr>
              </thead>
              <tbody>
                {brief.bengaluruDemandHeatmap.map((row, i) => {
                  const signalColor =
                    row.demandSignal === 'Strong'          ? 'bg-emerald-100 text-emerald-700' :
                    row.demandSignal === 'Moderate-High'   ? 'bg-blue-100 text-blue-700' :
                    row.demandSignal === 'Moderate'        ? 'bg-amber-100 text-amber-700' :
                    row.demandSignal === 'Soft'            ? 'bg-red-100 text-red-700' :
                                                             'bg-bg-secondary text-content-secondary';
                  // pricingTrend is a YoY price-growth string ("+8–10% YoY") —
                  // a proxy, not a measured demand feed (see caveat below).
                  // Colour by the real sign so a decline never reads green.
                  const hasTrend = row.pricingTrend && row.pricingTrend !== 'Not available';
                  const trendNeg = hasTrend && String(row.pricingTrend).replace(/^\+/, '').trim().startsWith('-');
                  const trendColor = !hasTrend
                    ? 'text-content-muted'
                    : trendNeg ? 'text-red-500 font-medium' : 'text-emerald-600 font-medium';
                  return (
                    <tr key={i} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                      <td className="py-2.5 px-3 font-medium text-content-primary">{row.microMarket}</td>
                      <td className="py-2.5 px-3 font-mono text-content-primary whitespace-nowrap">
                        {row.avgPriceRange || <span className="text-content-muted">—</span>}
                      </td>
                      <td className={`py-2.5 px-3 whitespace-nowrap ${trendColor}`}>
                        {row.pricingTrend || '—'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${signalColor}`}>
                          {row.demandSignal}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-content-secondary">{row.anchorHub || '—'}</td>
                      <td className="py-2.5 px-3 text-content-secondary max-w-[220px]">
                        <span className="line-clamp-2">{row.insight}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-content-muted">
            Pricing from verified internal benchmarks (2025–2026). <span className="font-medium text-content-secondary">Demand Signal</span> is derived from YoY price growth — a momentum proxy, not a measured absorption or demand feed. Absorption &amp; inventory data awaiting verified external feed.
          </p>
        </SectionCard>
      )}

      {/* Sections 8 (Demand Slowdown Indicators) and 9 (Strategic
          Takeaways) were retired on 2026-05-23. They produced generic
          copy that didn't earn their place on the page; the same
          context now reads cleaner inside the AI Brief above (Risk
          Signals + Market Signals already cover what the operator
          wants from those surfaces). Leaving an explicit note here
          rather than re-adding empty cards. */}

      {/* Admin: Market Notes Editor */}
      {isAdmin && (
        <div className="pt-2">
          <AdminNotesPanel />
        </div>
      )}

      <p className="text-xs text-content-muted text-center pb-4">
        Brief generated {today} · Internal pipeline data
        {transactions?.length > 0 ? ` · ${transactions.length} verified market transactions` : ''}
        {benchmarks?.length > 0 ? ` · ${benchmarks.length} micro-market benchmarks` : ''}
        {brief?.claudeBrief ? ' · AI-enhanced' : ''}
      </p>
    </div>
  );
}
