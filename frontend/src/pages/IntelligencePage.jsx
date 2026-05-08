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
  Lightbulb,
  ChevronDown,
  RefreshCw,
  Save,
  PlusCircle,
  Trash2,
  Lock,
  ArrowUpRight,
  Building2,
  DollarSign,
  Download,
  Loader2,
} from 'lucide-react';
import { exportsAPI } from '../services/api';
import {
  useDailyBrief,
  useMarketNotes,
  useSaveMarketNotes,
  useMarketTransactions,
  useMicroMarketBenchmarks,
  useOfficeBenchmarks,
  useRetailBenchmarks,
  useIndustrialBenchmarks,
  useHospitalityBenchmarks,
  useResidentialSegmentedBenchmarks,
  useMacroKpis,
} from '../hooks/useIntelligence';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import DataToolbar from '../components/common/DataToolbar';
import SortableHeader, { applySort, cycleSort } from '../components/common/SortableHeader';
import { SkeletonKpi, SkeletonCard, Skeleton } from '../design-system';
import { formatPct, formatCrores, formatDate, STAGE_CONFIG } from '../utils/format';
import useAuthStore from '../store/authStore';

// Helper: build cluster filter options from a row set with `cluster` field.
const buildClusterOptions = (rows) => {
  const counts = {};
  for (const r of rows) {
    const c = r.cluster || 'Other';
    counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count);
};

// Helper: filter a set of rows by a search term across the given keys.
const matchesSearch = (row, term, keys) => {
  if (!term) return true;
  const t = term.toLowerCase();
  return keys.some((k) => String(row[k] ?? '').toLowerCase().includes(t));
};

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

function UnconfiguredNotice({ requirements }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800">Internal pipeline data — external inventory feeds not yet configured</p>
          <p className="text-xs text-amber-700 mt-1">
            REDIP will not generate external absorption/inventory claims until verified live feeds are connected. Verified transaction data from public sources is displayed separately below.
          </p>
          {requirements?.length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-2 flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 font-medium"
            >
              <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              {open ? 'Hide' : 'Show'} required sources
            </button>
          )}
          {open && (
            <ul className="mt-2 space-y-1">
              {requirements.map((req) => (
                <li key={req.key} className="text-xs text-amber-700">
                  <span className="font-medium">{req.label}</span> — {req.purpose}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
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

// ─── Admin Market Notes Editor ─────────────────────────────────────────────────

const SECTION_META = {
  micro_market: { label: 'Micro-Market Intelligence', placeholder: 'e.g. Whitefield absorption strong; 15,000–16,000/sqft bracket holding up.' },
  slowdown:     { label: 'Demand Slowdown Indicators', placeholder: 'e.g. Affordable segment (sub-8,000/sqft) showing 18% longer days-on-market vs Q3.' },
  strategic:    { label: 'Strategic Takeaways', placeholder: 'e.g. Prioritise Sarjapur and Whitefield for residential underwriting; avoid oversupplied ORR mid-market.' },
};

function NotesEditor({ section, initialItems, onSave, saving }) {
  const [items, setItems] = useState(initialItems || []);
  const [newItem, setNewItem] = useState('');

  const add = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    setItems((prev) => [...prev, trimmed]);
    setNewItem('');
  };

  const remove = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 rounded-lg bg-bg-secondary px-3 py-2 text-sm text-content-primary">
            <span className="flex-1">{item}</span>
            <button type="button" onClick={() => remove(idx)} className="text-content-muted hover:text-red-500 flex-shrink-0 mt-0.5">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-xs text-content-muted italic">No items yet. Add your first observation below.</li>
        )}
      </ul>
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={SECTION_META[section]?.placeholder}
          className="flex-1 rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!newItem.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-secondary px-3 py-2 text-sm font-medium text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
        >
          <PlusCircle size={14} />
          Add
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSave(items)}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-bg-primary disabled:opacity-50"
      >
        {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
        Save section
      </button>
    </div>
  );
}

function AdminNotesPanel() {
  const { data: marketNotes, isLoading } = useMarketNotes();
  const saveNotes = useSaveMarketNotes();
  const [openSection, setOpenSection] = useState(null);
  const [savingSection, setSavingSection] = useState(null);

  const handleSave = async (section, items) => {
    setSavingSection(section);
    try { await saveNotes.mutateAsync({ section, items }); }
    finally { setSavingSection(null); }
  };

  if (isLoading) return <p className="text-sm text-content-secondary">Loading notes...</p>;

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Lock size={15} className="text-blue-600" />
        <p className="text-sm font-semibold text-blue-800">Admin — Market Notes Editor</p>
        <span className="ml-auto text-xs text-blue-500">Only admins can edit</span>
      </div>
      <p className="text-xs text-blue-700 mb-4">
        Notes entered here appear in the intelligence brief and are stored in the database. No external data is fabricated — only what you enter here is surfaced.
      </p>
      <div className="space-y-3">
        {Object.entries(SECTION_META).map(([sectionKey, meta]) => (
          <div key={sectionKey} className="rounded-lg bg-white border border-blue-100">
            <button
              type="button"
              onClick={() => setOpenSection(openSection === sectionKey ? null : sectionKey)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-content-primary hover:bg-bg-secondary rounded-lg"
            >
              {meta.label}
              <ChevronDown size={14} className={`text-content-muted transition-transform ${openSection === sectionKey ? 'rotate-180' : ''}`} />
            </button>
            {openSection === sectionKey && (
              <div className="px-4 pb-4">
                <NotesEditor
                  section={sectionKey}
                  initialItems={marketNotes?.[sectionKey] || []}
                  onSave={(items) => handleSave(sectionKey, items)}
                  saving={savingSection === sectionKey}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

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

// ─── Macro KPI strip ──────────────────────────────────────────────────────────

const TREND_TONE = {
  up:   'text-emerald-600',
  down: 'text-red-500',
  flat: 'text-content-muted',
};

const formatYoY = (n) => {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v}% YoY`;
};

function MacroKpiTile({ kpi }) {
  const tone = TREND_TONE[kpi.trend] || 'text-content-muted';
  const yoy = formatYoY(kpi.yoy_change_pct);
  return (
    <div className="rounded-xl border border-hairline-strong bg-white px-4 py-3 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.1em] font-medium text-content-muted">
          {kpi.metric_label}
        </p>
        {yoy && <span className={`text-[10px] font-semibold tabular-nums ${tone}`}>{yoy}</span>}
      </div>
      <p className="mt-1.5 text-lg font-bold text-content-primary tabular-nums leading-tight">
        {kpi.value_text}
      </p>
      {kpi.source && (
        <p className="mt-1 text-[10px] text-content-muted truncate" title={kpi.source}>
          {kpi.source}
        </p>
      )}
    </div>
  );
}

// ─── Asset-class benchmark tables ────────────────────────────────────────────

function OfficeBenchmarksTable({ rows }) {
  const [showSubmarkets, setShowSubmarkets] = useState(false);
  const [search, setSearch] = useState('');
  const [cluster, setCluster] = useState(null);
  const [ipcSort, setIpcSort] = useState({ key: 'vacancy_pct', dir: 'asc' });
  const [subSort, setSubSort] = useState({ key: 'grade_a_rent_high_psf_month', dir: 'desc' });

  const onIpcSort = useCallback((k) => setIpcSort((p) => cycleSort(k, p)), []);
  const onSubSort = useCallback((k) => setSubSort((p) => cycleSort(k, p)), []);

  const allSubRows = rows.filter((r) => r.level_type === 'submarket');
  const ipcRowsAll = rows.filter((r) => r.level_type === 'ipc_zone');

  const filterFn = (r) =>
    matchesSearch(r, search, ['submarket', 'cluster', 'notes']) &&
    (!cluster || r.cluster === cluster);

  const ipcRows = useMemo(() => applySort(ipcRowsAll.filter(filterFn), ipcSort, {
    vacancy_pct: (r) => Number(r.vacancy_pct ?? 999),
    stock_weighted_rent_psf_month: (r) => Number(r.stock_weighted_rent_psf_month ?? 0),
    submarket: (r) => r.submarket || '',
  }), [ipcRowsAll, search, cluster, ipcSort]);

  const subRows = useMemo(() => applySort(allSubRows.filter(filterFn), subSort, {
    grade_a_rent_high_psf_month: (r) => Number(r.grade_a_rent_high_psf_month ?? 0),
    grade_a_rent_low_psf_month: (r) => Number(r.grade_a_rent_low_psf_month ?? 0),
    yoy_change_pct: (r) => Number(r.yoy_change_pct ?? 0),
    submarket: (r) => r.submarket || '',
  }), [allSubRows, search, cluster, subSort]);

  const clusterOptions = useMemo(() => buildClusterOptions(allSubRows), [allSubRows]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <DataToolbar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search submarket, cluster, notes…"
          ariaLabel="Search office benchmarks"
        />
        <DataToolbar.Chips
          label="Cluster"
          value={cluster}
          onChange={setCluster}
          options={clusterOptions}
          allowAll
          allLabel="All clusters"
        />
      </div>
      <p className="text-[11px] text-content-muted mb-2">
        IPC zone-level (Cushman &amp; Wakefield, stock-weighted Grade A)
      </p>
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-xs border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <SortableHeader sortKey="submarket" sort={ipcSort} onSort={onIpcSort} className="py-2 px-3">Zone</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Cluster</th>
              <SortableHeader sortKey="vacancy_pct" sort={ipcSort} onSort={onIpcSort} align="right" className="py-2 px-3">Vacancy</SortableHeader>
              <SortableHeader sortKey="stock_weighted_rent_psf_month" sort={ipcSort} onSort={onIpcSort} align="right" className="py-2 px-3">SW Rent</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary max-w-[260px]">Notes</th>
            </tr>
          </thead>
          <tbody>
            {ipcRows.map((r) => {
              const vacColor = r.vacancy_pct <= 5 ? 'text-emerald-600 font-semibold'
                : r.vacancy_pct <= 10 ? 'text-blue-600 font-medium'
                : r.vacancy_pct <= 20 ? 'text-amber-600 font-medium'
                : 'text-red-500 font-semibold';
              return (
                <tr key={r.id} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                  <td className="py-2 px-3 font-medium text-content-primary">{r.submarket}</td>
                  <td className="py-2 px-3 text-content-secondary">{r.cluster || '—'}</td>
                  <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${vacColor}`}>
                    {r.vacancy_pct != null ? `${Number(r.vacancy_pct).toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                    {r.stock_weighted_rent_psf_month != null ? `₹${Number(r.stock_weighted_rent_psf_month).toFixed(0)}` : '—'}
                  </td>
                  <td className="py-2 px-3 text-content-secondary max-w-[260px]"><span className="line-clamp-2">{r.notes || '—'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setShowSubmarkets((v) => !v)}
        className="mt-3 text-xs font-medium text-primary-500 hover:text-primary-600 flex items-center gap-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded px-1 -mx-1"
      >
        <ChevronDown size={13} className={`transition-transform duration-150 ${showSubmarkets ? 'rotate-180' : ''}`} />
        {showSubmarkets ? 'Hide submarket Grade A range' : `Show ${subRows.length} submarket Grade A range${subRows.length === 1 ? '' : 's'}`}
      </button>

      {showSubmarkets && (
        <div className="mt-3 overflow-x-auto -mx-5">
          <table className="w-full text-xs border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
                <SortableHeader sortKey="submarket" sort={subSort} onSort={onSubSort} className="py-2 px-3">Submarket</SortableHeader>
                <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Cluster</th>
                <SortableHeader sortKey="grade_a_rent_high_psf_month" sort={subSort} onSort={onSubSort} align="right" className="py-2 px-3">Grade A (₹/sf/mo)</SortableHeader>
                <SortableHeader sortKey="grade_a_rent_low_psf_month" sort={subSort} onSort={onSubSort} align="right" className="py-2 px-3">Grade B (₹/sf/mo)</SortableHeader>
                <SortableHeader sortKey="yoy_change_pct" sort={subSort} onSort={onSubSort} align="right" className="py-2 px-3">YoY</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {subRows.map((r) => (
                <tr key={r.id} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                  <td className="py-2 px-3 font-medium text-content-primary">{r.submarket}</td>
                  <td className="py-2 px-3 text-content-secondary">{r.cluster || '—'}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                    {r.grade_a_rent_low_psf_month != null
                      ? `₹${r.grade_a_rent_low_psf_month}–${r.grade_a_rent_high_psf_month}` : '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-secondary">
                    {r.grade_b_rent_low_psf_month != null
                      ? `₹${r.grade_b_rent_low_psf_month}–${r.grade_b_rent_high_psf_month}` : '—'}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-emerald-600 font-medium">
                    {r.yoy_change_pct != null ? `+${r.yoy_change_pct}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-content-muted">
        Source: Cushman &amp; Wakefield Bengaluru Office Q1 2026, JLL India Office Dynamics Q4 2025, Knight Frank APAC Prime Office Q1 2026. Bare-shell warm-shell rents excluding CAM.
      </p>
    </div>
  );
}

function RetailBenchmarksTable({ rows }) {
  const [search, setSearch] = useState('');
  const [format, setFormat] = useState(null); // null = both
  const [hsSort, setHsSort] = useState({ key: 'rent_avg_psf_month', dir: 'desc' });
  const [mallSort, setMallSort] = useState({ key: 'rent_high_psf_month', dir: 'desc' });

  const onHsSort = useCallback((k) => setHsSort((p) => cycleSort(k, p)), []);
  const onMallSort = useCallback((k) => setMallSort((p) => cycleSort(k, p)), []);

  const filterFn = (r) => matchesSearch(r, search, ['corridor', 'cluster', 'notes']);

  const highStreet = useMemo(() => applySort(rows.filter((r) => r.format === 'high_street').filter(filterFn), hsSort, {
    rent_avg_psf_month: (r) => Number(r.rent_avg_psf_month ?? 0),
    yoy_change_pct: (r) => Number(r.yoy_change_pct ?? 0),
    qoq_change_pct: (r) => Number(r.qoq_change_pct ?? 0),
    corridor: (r) => r.corridor || '',
  }), [rows, search, hsSort]);

  const malls = useMemo(() => applySort(rows.filter((r) => r.format === 'mall_grade_a').filter(filterFn), mallSort, {
    rent_high_psf_month: (r) => Number(r.rent_high_psf_month ?? 0),
    rent_low_psf_month: (r) => Number(r.rent_low_psf_month ?? 0),
    corridor: (r) => r.corridor || '',
  }), [rows, search, mallSort]);

  const showHS = format !== 'mall_grade_a';
  const showMalls = format !== 'high_street';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <DataToolbar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search corridor, cluster, mall…"
          ariaLabel="Search retail benchmarks"
        />
        <DataToolbar.Chips
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'high_street',  label: 'High street', count: rows.filter((r) => r.format === 'high_street').length },
            { value: 'mall_grade_a', label: 'Grade A mall', count: rows.filter((r) => r.format === 'mall_grade_a').length },
          ]}
          allowAll
          allLabel="Both"
        />
      </div>
      {showHS && (
      <div>
        <p className="text-[11px] text-content-muted mb-2">High-street vanilla GF (carpet) — Cushman &amp; Wakefield Q1 2026</p>
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-xs border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
                <SortableHeader sortKey="corridor" sort={hsSort} onSort={onHsSort} className="py-2 px-3">Corridor</SortableHeader>
                <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Cluster</th>
                <SortableHeader sortKey="rent_avg_psf_month" sort={hsSort} onSort={onHsSort} align="right" className="py-2 px-3">Avg ₹/sf/mo</SortableHeader>
                <SortableHeader sortKey="qoq_change_pct" sort={hsSort} onSort={onHsSort} align="right" className="py-2 px-3">QoQ</SortableHeader>
                <SortableHeader sortKey="yoy_change_pct" sort={hsSort} onSort={onHsSort} align="right" className="py-2 px-3">YoY</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {highStreet.map((r) => (
                <tr key={r.id} className="border-b border-hairline transition-colors duration-150 ease-out hover:bg-bg-secondary">
                  <td className="py-2 px-3 font-medium text-content-primary">{r.corridor}</td>
                  <td className="py-2 px-3 text-content-secondary">{r.cluster || '—'}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                    ₹{r.rent_avg_psf_month}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-emerald-500">
                    +{r.qoq_change_pct}%
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-emerald-500 font-medium">
                    +{r.yoy_change_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {showMalls && malls.length > 0 && (
        <div>
          <p className="text-[11px] text-content-muted mb-2">Grade A malls — Occupi.in 2025 line-shop range</p>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-xs border-collapse min-w-[560px]">
              <thead>
                <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
                  <SortableHeader sortKey="corridor" sort={mallSort} onSort={onMallSort} className="py-2 px-3">Mall</SortableHeader>
                  <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Cluster</th>
                  <SortableHeader sortKey="rent_high_psf_month" sort={mallSort} onSort={onMallSort} align="right" className="py-2 px-3">Range ₹/sf/mo</SortableHeader>
                  <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary max-w-[240px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {malls.map((r) => (
                  <tr key={r.id} className="border-b border-hairline hover:bg-bg-secondary transition-colors">
                    <td className="py-2 px-3 font-medium text-content-primary">{r.corridor}</td>
                    <td className="py-2 px-3 text-content-secondary">{r.cluster || '—'}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                      ₹{r.rent_low_psf_month}–{r.rent_high_psf_month}
                    </td>
                    <td className="py-2 px-3 text-content-secondary max-w-[240px]"><span className="line-clamp-2">{r.notes || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function IndustrialBenchmarksTable({ rows }) {
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState(null);
  const [rentSort, setRentSort] = useState({ key: 'rent_high_psf_month', dir: 'desc' });
  const [landSort, setLandSort] = useState({ key: 'land_value_high_inr_mn_per_acre', dir: 'desc' });

  const onRentSort = useCallback((k) => setRentSort((p) => cycleSort(k, p)), []);
  const onLandSort = useCallback((k) => setLandSort((p) => cycleSort(k, p)), []);

  const filterFn = (r) => matchesSearch(r, search, ['submarket', 'cluster', 'notes']);

  const sortRent = (items) => applySort(items, rentSort, {
    rent_high_psf_month: (r) => Number(r.rent_high_psf_month ?? 0),
    rent_low_psf_month: (r) => Number(r.rent_low_psf_month ?? 0),
    yoy_change_pct: (r) => Number(r.yoy_change_pct ?? 0),
    submarket: (r) => r.submarket || '',
  });

  const industrial = useMemo(() => sortRent(rows.filter((r) => r.segment === 'industrial').filter(filterFn)), [rows, search, rentSort]);
  const warehouse = useMemo(() => sortRent(rows.filter((r) => r.segment === 'warehouse').filter(filterFn)), [rows, search, rentSort]);
  const land = useMemo(() => applySort(rows.filter((r) => r.segment === 'serviced_land').filter(filterFn), landSort, {
    land_value_high_inr_mn_per_acre: (r) => Number(r.land_value_high_inr_mn_per_acre ?? 0),
    land_value_low_inr_mn_per_acre: (r) => Number(r.land_value_low_inr_mn_per_acre ?? 0),
    yoy_change_pct: (r) => Number(r.yoy_change_pct ?? 0),
    submarket: (r) => r.submarket || '',
  }), [rows, search, landSort]);

  const showIndustrial = segment === null || segment === 'industrial';
  const showWarehouse  = segment === null || segment === 'warehouse';
  const showLand       = segment === null || segment === 'serviced_land';

  const RentTable = ({ title, items }) => (
    items.length > 0 && (
      <div>
        <p className="text-[11px] text-content-muted mb-2">{title}</p>
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-xs border-collapse min-w-[520px]">
            <thead>
              <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
                <SortableHeader sortKey="submarket" sort={rentSort} onSort={onRentSort} className="py-2 px-3">Submarket</SortableHeader>
                <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Cluster</th>
                <SortableHeader sortKey="rent_high_psf_month" sort={rentSort} onSort={onRentSort} align="right" className="py-2 px-3">Rent ₹/sf/mo</SortableHeader>
                <SortableHeader sortKey="yoy_change_pct" sort={rentSort} onSort={onRentSort} align="right" className="py-2 px-3">YoY</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-hairline transition-colors duration-150 ease-out hover:bg-bg-secondary">
                  <td className="py-2 px-3 font-medium text-content-primary">{r.submarket}</td>
                  <td className="py-2 px-3 text-content-secondary">{r.cluster || '—'}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                    ₹{r.rent_low_psf_month}–{r.rent_high_psf_month}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-emerald-500 font-medium">
                    +{Number(r.yoy_change_pct).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <DataToolbar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search submarket, cluster, notes…"
          ariaLabel="Search industrial benchmarks"
        />
        <DataToolbar.Chips
          label="Segment"
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'industrial',     label: 'Industrial', count: rows.filter((r) => r.segment === 'industrial').length },
            { value: 'warehouse',      label: 'Warehouse',  count: rows.filter((r) => r.segment === 'warehouse').length },
            { value: 'serviced_land',  label: 'Serviced land', count: rows.filter((r) => r.segment === 'serviced_land').length },
          ]}
          allowAll
          allLabel="All"
        />
      </div>
      {showIndustrial && <RentTable title="Industrial / manufacturing rents" items={industrial} />}
      {showWarehouse && <RentTable title="Warehouse / 3PL rents" items={warehouse} />}
      {showLand && land.length > 0 && (
        <div>
          <p className="text-[11px] text-content-muted mb-2">Serviced industrial land (₹ million / acre)</p>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-xs border-collapse min-w-[520px]">
              <thead>
                <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
                  <SortableHeader sortKey="submarket" sort={landSort} onSort={onLandSort} className="py-2 px-3">Submarket</SortableHeader>
                  <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Cluster</th>
                  <SortableHeader sortKey="land_value_high_inr_mn_per_acre" sort={landSort} onSort={onLandSort} align="right" className="py-2 px-3">Range ₹ mn/acre</SortableHeader>
                  <SortableHeader sortKey="yoy_change_pct" sort={landSort} onSort={onLandSort} align="right" className="py-2 px-3">YoY</SortableHeader>
                </tr>
              </thead>
              <tbody>
                {land.map((r) => (
                  <tr key={r.id} className="border-b border-hairline transition-colors duration-150 ease-out hover:bg-bg-secondary">
                    <td className="py-2 px-3 font-medium text-content-primary">{r.submarket}</td>
                    <td className="py-2 px-3 text-content-secondary">{r.cluster || '—'}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                      ₹{r.land_value_low_inr_mn_per_acre}–{r.land_value_high_inr_mn_per_acre}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-emerald-500 font-medium">
                      +{Number(r.yoy_change_pct).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-content-muted">
        Source: Cushman &amp; Wakefield Bengaluru Industrial &amp; Logistics H2 2025. Rents +4–5% YoY; serviced land +9–10% YoY.
      </p>
    </div>
  );
}

function HospitalityBenchmarksTable({ rows }) {
  const SEGMENT_LABEL = {
    citywide: 'Citywide / micro-market',
    luxury: 'Luxury (5★)',
    upper_upscale: 'Upper Upscale',
    upscale_upper_mid: 'Upscale / Upper Mid',
    midscale_economy: 'Midscale / Economy',
  };

  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState(null);
  const [sort, setSort] = useState({ key: 'adr_high_inr', dir: 'desc' });
  const onSort = useCallback((k) => setSort((p) => cycleSort(k, p)), []);

  const filtered = useMemo(() => rows.filter((r) =>
    matchesSearch(r, search, ['submarket', 'cluster', 'notes']) &&
    (!segment || r.segment === segment)
  ), [rows, search, segment]);

  const sorted = useMemo(() => applySort(filtered, sort, {
    adr_high_inr: (r) => Number(r.adr_high_inr ?? 0),
    adr_low_inr: (r) => Number(r.adr_low_inr ?? 0),
    occupancy_pct: (r) => Number(r.occupancy_pct ?? 0),
    revpar_inr: (r) => Number(r.revpar_inr ?? 0),
    submarket: (r) => r.submarket || '',
  }), [filtered, sort]);

  const segmentOptions = useMemo(() => {
    const counts = {};
    for (const r of rows) {
      const s = r.segment || 'citywide';
      counts[s] = (counts[s] || 0) + 1;
    }
    return Object.entries(counts).map(([value, count]) => ({
      value, label: SEGMENT_LABEL[value] || value, count,
    }));
  }, [rows]);

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <DataToolbar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search submarket, cluster, brand…"
          ariaLabel="Search hospitality benchmarks"
        />
        <DataToolbar.Chips
          label="Segment"
          value={segment}
          onChange={setSegment}
          options={segmentOptions}
          allowAll
          allLabel="All segments"
        />
      </div>
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-xs border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <SortableHeader sortKey="submarket" sort={sort} onSort={onSort} className="py-2 px-3">Submarket</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Segment</th>
              <SortableHeader sortKey="adr_high_inr" sort={sort} onSort={onSort} align="right" className="py-2 px-3">ADR ₹/key</SortableHeader>
              <SortableHeader sortKey="occupancy_pct" sort={sort} onSort={onSort} align="right" className="py-2 px-3">Occ %</SortableHeader>
              <SortableHeader sortKey="revpar_inr" sort={sort} onSort={onSort} align="right" className="py-2 px-3">RevPAR ₹</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-hairline transition-colors duration-150 ease-out hover:bg-bg-secondary">
                <td className="py-2 px-3 font-medium text-content-primary">{r.submarket}</td>
                <td className="py-2 px-3 text-content-secondary">{SEGMENT_LABEL[r.segment] || r.segment}</td>
                <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                  {r.adr_low_inr === r.adr_high_inr
                    ? `₹${Number(r.adr_low_inr).toLocaleString('en-IN')}`
                    : `₹${Number(r.adr_low_inr).toLocaleString('en-IN')}–${Number(r.adr_high_inr).toLocaleString('en-IN')}`}
                </td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-content-secondary">
                  {r.occupancy_pct != null ? `${r.occupancy_pct}%` : '—'}
                </td>
                <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-secondary">
                  {r.revpar_inr != null ? `₹${Number(r.revpar_inr).toLocaleString('en-IN')}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-content-muted">
        Source: Horwath HTL India Hotel Market Review 2025; ICRA FY25-26 outlook ₹8,200–8,500 premium ADR with +200 bps Occ. Submarket ranges from Marriott/Hyatt/IHG/Taj/Oberoi rack rates and OTA scrapes.
      </p>
    </div>
  );
}

// ─── Residential Segmented Benchmarks (builder floor / plotted / land / villa / guidance) ───
//
// These five asset classes were flagged in TODO_DATA.md as "schema follow-up"
// from the v0.2 rate-pack. They share shape (micro-market × metric × value)
// but mix units (INR/sqft, INR mn/acre, SRO PDF placeholder), which is why
// they live in their own table rather than being shoehorned into
// `micro_market_benchmarks`.
//
// Methodology rule (TODO_DATA.md):
//   "Create separate tabs/layers in the REDIP UI: Listing Benchmarks, IPC
//    Benchmarks, Guidance Value, Internal Deals."
// Honored here via the asset-class chip group + per-row data_type badge.

const ASSET_CLASS_META = {
  builder_floor:            { label: 'Builder floor',         tone: 'info',     order: 1 },
  plotted_development:      { label: 'Plotted development',   tone: 'info',     order: 2 },
  land_residential_plotted: { label: 'Land (plotted)',         tone: 'warn',     order: 3 },
  villa_house:              { label: 'Villa / house',          tone: 'info',     order: 4 },
  guidance_value:           { label: 'Guidance value',         tone: 'neutral',  order: 5 },
};

const SEGMENTED_DATA_TYPE_BADGE = {
  listing_q1_2026_v0_2:           { tone: 'info',     label: 'Listing Q1 2026' },
  listing_q1_2026_v0_2_derived:   { tone: 'warn',     label: 'Listing · Derived' },
  guidance_q1_2026_v0_2_pending:  { tone: 'neutral',  label: 'Guidance · SRO pending' },
  ipc_q4_2025_gba_report:         { tone: 'premium',  label: 'IPC · GBA Q4 2025' },
};

// Per-asset-class summary tile shown above the segmented-benchmarks table.
// Bloomberg-style: count + min/max range + active-state ring. Click to
// toggle the chip filter for that class. Lets users see at a glance which
// asset class has the widest spread and where to drill in.
function AssetClassSummaryTile({ assetClassKey, summary, active, onClick }) {
  const meta = ASSET_CLASS_META[assetClassKey] || { label: assetClassKey, tone: 'neutral' };
  const TONE_RING = {
    info:    'ring-blue-400/40',
    warn:    'ring-amber-400/40',
    success: 'ring-emerald-400/40',
    neutral: 'ring-slate-400/40',
    premium: 'ring-violet-400/40',
  };
  const TONE_DOT = {
    info:    'bg-blue-500',
    warn:    'bg-amber-500',
    success: 'bg-emerald-500',
    neutral: 'bg-slate-500',
    premium: 'bg-violet-500',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'group relative flex flex-col items-start text-left px-3 py-2.5 rounded-editorial border transition-all duration-200 ease-out',
        'hover:border-content-primary/30 hover:-translate-y-px',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60',
        active
          ? `bg-bg-elevated border-content-primary/30 shadow-editorial ring-2 ${TONE_RING[meta.tone] || TONE_RING.neutral}`
          : 'bg-bg-secondary/60 border-hairline',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full ${TONE_DOT[meta.tone] || TONE_DOT.neutral}`} />
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
          {meta.label}
        </span>
      </div>
      <p className="text-base font-semibold text-content-primary tabular-nums leading-tight">
        {summary.count}
        <span className="ml-1 text-[10px] font-medium text-content-muted normal-case tracking-normal">
          {summary.count === 1 ? 'micro-market' : 'micro-markets'}
        </span>
      </p>
      <p className="mt-1 text-[11px] text-content-secondary tabular-nums whitespace-nowrap">
        {summary.range}
      </p>
    </button>
  );
}

function ResidentialSegmentedBenchmarksTable({ rows }) {
  const [search, setSearch] = useState('');
  const [assetClass, setAssetClass] = useState(null);
  const [sort, setSort] = useState({ key: 'value_avg', dir: 'desc' });
  const onSort = useCallback((k) => setSort((p) => cycleSort(k, p)), []);

  // Per-asset-class summary — count + min/max value range. Reused by the
  // summary tile strip and (potentially) by the export. Skips rows whose
  // numeric value is null (e.g. guidance placeholders) so the range is
  // honest about what's actually quantified.
  const assetClassSummary = useMemo(() => {
    const out = {};
    for (const r of rows) {
      const key = r.asset_class;
      if (!out[key]) out[key] = { count: 0, values: [], unit: r.unit };
      out[key].count += 1;
      const v = r.value_avg ?? r.value_high ?? r.value_low;
      if (v != null && Number.isFinite(Number(v))) out[key].values.push(Number(v));
    }
    for (const key of Object.keys(out)) {
      const s = out[key];
      if (key === 'guidance_value') {
        s.range = `${s.count} SRO file${s.count === 1 ? '' : 's'} pending`;
        continue;
      }
      if (s.values.length === 0) {
        s.range = '—';
        continue;
      }
      const min = Math.min(...s.values);
      const max = Math.max(...s.values);
      const isAcre = (s.unit || '').toLowerCase().includes('acre');
      const fmt = (n) => isAcre
        ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })} mn/ac`
        : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/sqft`;
      s.range = min === max ? fmt(min) : `${fmt(min).replace(/(₹[\d,]+)/, '$1')} – ${fmt(max)}`;
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) =>
    matchesSearch(r, search, ['micro_market', 'zone_cluster', 'metric', 'notes', 'source']) &&
    (!assetClass || r.asset_class === assetClass)
  ), [rows, search, assetClass]);

  const sorted = useMemo(() => applySort(filtered, sort, {
    asset_class: (r) => ASSET_CLASS_META[r.asset_class]?.order ?? 99,
    micro_market: (r) => r.micro_market || '',
    value_avg: (r) => Number(r.value_avg ?? r.value_high ?? r.value_low ?? 0),
    value_low: (r) => Number(r.value_low ?? r.value_avg ?? 0),
    value_high: (r) => Number(r.value_high ?? r.value_avg ?? 0),
  }), [filtered, sort]);

  const assetClassOptions = useMemo(() => {
    const counts = {};
    for (const r of rows) counts[r.asset_class] = (counts[r.asset_class] || 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => (ASSET_CLASS_META[a[0]]?.order ?? 99) - (ASSET_CLASS_META[b[0]]?.order ?? 99))
      .map(([value, count]) => ({
        value,
        label: ASSET_CLASS_META[value]?.label || value,
        count,
      }));
  }, [rows]);

  const formatValue = (r) => {
    if (r.asset_class === 'guidance_value') {
      return <span className="text-xs italic text-content-muted">SRO PDF pending</span>;
    }
    const v = r.value_avg ?? r.value_high ?? r.value_low;
    if (v == null) return '—';
    const isAcre = r.unit?.toLowerCase().includes('acre');
    if (r.value_low != null && r.value_high != null && r.value_low !== r.value_high) {
      return isAcre
        ? `₹${Number(r.value_low).toLocaleString('en-IN')}–${Number(r.value_high).toLocaleString('en-IN')} mn/ac`
        : `₹${Number(r.value_low).toLocaleString('en-IN')}–${Number(r.value_high).toLocaleString('en-IN')}/sqft`;
    }
    return isAcre
      ? `₹${Number(v).toLocaleString('en-IN')} mn/ac`
      : `₹${Number(v).toLocaleString('en-IN')}/sqft`;
  };

  return (
    <div>
      {/* Summary tile strip — one per asset class. Click toggles the chip
          filter. Gives users a Bloomberg-style "what's here at a glance"
          before they dive into the table. */}
      {assetClassOptions.length > 0 && (
        <div
          className="grid gap-2 mb-4"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(170px, 1fr))` }}
        >
          {assetClassOptions.map((opt) => (
            <AssetClassSummaryTile
              key={opt.value}
              assetClassKey={opt.value}
              summary={assetClassSummary[opt.value] || { count: opt.count, range: '—' }}
              active={assetClass === opt.value}
              onClick={() => setAssetClass((cur) => (cur === opt.value ? null : opt.value))}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <DataToolbar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search micro-market, metric, source…"
          ariaLabel="Search residential segmented benchmarks"
        />
        <DataToolbar.Chips
          label="Asset class"
          value={assetClass}
          onChange={setAssetClass}
          options={assetClassOptions}
          allowAll
          allLabel="All classes"
        />
      </div>
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-xs border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <SortableHeader sortKey="asset_class" sort={sort} onSort={onSort} className="py-2 px-3">Asset class</SortableHeader>
              <SortableHeader sortKey="micro_market" sort={sort} onSort={onSort} className="py-2 px-3">Micro-market</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Metric</th>
              <SortableHeader sortKey="value_avg" sort={sort} onSort={onSort} align="right" className="py-2 px-3">Value</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Layer</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const acMeta = ASSET_CLASS_META[r.asset_class] || { label: r.asset_class, tone: 'neutral' };
              const dtMeta = SEGMENTED_DATA_TYPE_BADGE[r.data_type] || { tone: 'neutral', label: r.data_type };
              return (
                <tr key={r.id} className="border-b border-hairline transition-colors duration-150 ease-out hover:bg-bg-secondary">
                  <td className="py-2 px-3">
                    <Badge tone={acMeta.tone} variant="soft">{acMeta.label}</Badge>
                  </td>
                  <td className="py-2 px-3">
                    <div className="font-medium text-content-primary">{r.micro_market}</div>
                    {r.zone_cluster && (
                      <div className="text-[10px] text-content-muted">{r.zone_cluster}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-content-secondary">{r.metric}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-content-primary">
                    {formatValue(r)}
                  </td>
                  <td className="py-2 px-3">
                    <Badge tone={dtMeta.tone} variant="soft">{dtMeta.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-content-muted">
        Listing-portal benchmarks (MagicBricks / Housing.com asking prices) are NOT transaction-verified — treat as supply-side signal only. Derived land values use the standard sqyd→acre conversion. Guidance-value rows are SRO-file placeholders — exact rates require Karnataka IGR PDF extraction.
      </p>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

// Asset-class filter — Bengaluru is the only city we have data for, so the
// page is locked to Bengaluru. The top-right toggle filters benchmark
// sections by asset class instead, which matches how a Bengaluru deal
// professional actually thinks: "show me the office market" or "show me
// land prices", not "show me Hyderabad".
//
// 5 buckets + an All view, chosen to match institutional deal taxonomy:
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
const ASSET_CLASS_FILTERS = [
  { value: 'all',            label: 'All' },
  { value: 'residential',    label: 'Residential' },
  { value: 'land',           label: 'Land & Plotted' },
  { value: 'office',         label: 'Office' },
  { value: 'retail_hosp',    label: 'Retail & Hospitality' },
  { value: 'industrial',     label: 'Industrial & Warehouse' },
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
      // eslint-disable-next-line no-alert
      window.alert('Failed to generate tear-sheet PDF. Please try again.');
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

  const notConfigured = brief?.mode === 'verified_data_required';

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

      {notConfigured && <UnconfiguredNotice requirements={brief?.verifiedSourceRequirements} />}

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

        <SectionCard icon={MapPin} title="4. Bengaluru Micro-Market Intelligence">
          {brief?.bengaluruMicroMarketIntelligence?.length > 0 ? (
            <ul className="space-y-2">
              {brief.bengaluruMicroMarketIntelligence.map((item, i) => (
                <li key={i} className="text-xs text-content-secondary border-l-2 border-primary-200 pl-3">{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">
              Micro-market intelligence will appear here once admin notes are entered or verified external data sources are configured.
            </p>
          )}
        </SectionCard>
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
                  const trendColor = row.pricingTrend && row.pricingTrend !== 'Not available'
                    ? 'text-emerald-600 font-medium' : 'text-content-muted';
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
            Pricing data from verified internal benchmarks (2025–2026). Absorption &amp; inventory data awaiting verified external feed.
          </p>
        </SectionCard>
      )}

      {/* Row 3: Slowdown Indicators + Strategic Takeaways */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard icon={TrendingDown} title="8. Demand Slowdown Indicators">
          {brief?.demandSlowdownIndicators?.length > 0 ? (
            <ul className="space-y-2">
              {brief.demandSlowdownIndicators.map((item, i) => (
                <li key={i} className="text-xs text-content-secondary flex gap-2">
                  <AlertTriangle size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">No slowdown indicators.</p>
          )}
        </SectionCard>

        <SectionCard icon={Lightbulb} title="9. Strategic Takeaways">
          {brief?.strategicTakeaways?.length > 0 ? (
            <ul className="space-y-2">
              {brief.strategicTakeaways.map((item, i) => (
                <li key={i} className="text-xs text-content-secondary flex gap-2">
                  <CheckCircle size={11} className="text-primary-500 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-secondary">No strategic takeaways.</p>
          )}
        </SectionCard>
      </div>

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
