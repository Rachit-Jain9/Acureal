import { useCallback, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Badge from '../common/Badge';
import DataToolbar from '../common/DataToolbar';
import SortableHeader, { applySort, cycleSort } from '../common/SortableHeader';
import { matchesSearch, buildClusterOptions } from '../../utils/intelligenceTableHelpers';

/**
 * Segmented asset-class benchmark tables for the Intelligence page.
 *
 * Two tables that share the "per-asset-class chip + filtered grid"
 * pattern, extracted from IntelligencePage.jsx in the 2026-05-25
 * god-file decomposition (Task #6).
 *
 *   • ResidentialSegmentedBenchmarksTable
 *     Builder floor / plotted development / land plotted / villa /
 *     guidance value. Mixes units (INR/sqft, INR mn/acre, SRO PDF
 *     placeholder) and data sources (listing portals, IPC reports,
 *     SRO guidance).
 *
 *   • NicheAssetClassBenchmarksTable
 *     Co-working / student housing / senior living / data centers.
 *     Each class has different metrics (per-seat / per-bed / capex +
 *     monthly fee / MW capacity).
 *
 *   • AssetClassSummaryTile is a shared visual primitive used by
 *     ResidentialSegmentedBenchmarksTable (and exported in case the
 *     Niche table grows the same affordance later).
 *
 * No behaviour change. Same state machines, same data shapes, same
 * empty/loading paths.
 */

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
export function AssetClassSummaryTile({ assetClassKey, summary, active, onClick }) {
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

export function ResidentialSegmentedBenchmarksTable({ rows }) {
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

// ─── Niche Asset Class Benchmarks (co-working / student housing / senior living / data centers) ───
//
// Same shape as residential_segmented_benchmarks: one table, four sub-classes,
// filtered by an asset_class chip. Hides cleanly when there are no rows so we
// don't surface an "operator-y migration prompt" on the page (per CLAUDE.md
// hard rule). The data flywheel populates this table when the operator drops
// an IPC report / broker quote into the Comps Review Queue.

const NICHE_ASSET_CLASS_META = {
  coworking:        { label: 'Co-working / managed office', tone: 'info',     order: 1 },
  student_housing:  { label: 'Student housing / co-living', tone: 'info',     order: 2 },
  senior_living:    { label: 'Senior living',                tone: 'info',     order: 3 },
  data_center:      { label: 'Data center',                  tone: 'premium',  order: 4 },
};

// Per-row layer badge — same prefix-based routing as the rest of the page.
// New data_type strings can be added here as new IPC reports / broker
// quotes land; unknown values fall back to neutral.
const NICHE_DATA_TYPE_BADGE = {
  ipc_q1_2026:           { tone: 'premium',  label: 'IPC · Q1 2026' },
  ipc_q4_2025:           { tone: 'premium',  label: 'IPC · Q4 2025' },
  listing_q1_2026:       { tone: 'info',     label: 'Listing Q1 2026' },
  verified_internal:     { tone: 'success',  label: 'Internal · verified' },
  broker_quote_q1_2026:  { tone: 'warn',     label: 'Broker quote' },
};

export function NicheAssetClassBenchmarksTable({ rows }) {
  const [search, setSearch] = useState('');
  const [assetClass, setAssetClass] = useState(null);
  const [sort, setSort] = useState({ key: 'value_avg', dir: 'desc' });
  const onSort = useCallback((k) => setSort((p) => cycleSort(k, p)), []);

  const assetClassOptions = useMemo(() => {
    const counts = {};
    for (const r of rows) counts[r.asset_class] = (counts[r.asset_class] || 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => (NICHE_ASSET_CLASS_META[a[0]]?.order ?? 99) - (NICHE_ASSET_CLASS_META[b[0]]?.order ?? 99))
      .map(([value, count]) => ({
        value,
        label: NICHE_ASSET_CLASS_META[value]?.label || value,
        count,
      }));
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) =>
    matchesSearch(r, search, ['micro_market', 'zone_cluster', 'metric', 'operator_name', 'brand_name', 'property_name', 'notes', 'source']) &&
    (!assetClass || r.asset_class === assetClass),
  ), [rows, search, assetClass]);

  const sorted = useMemo(() => applySort(filtered, sort, {
    asset_class: (r) => NICHE_ASSET_CLASS_META[r.asset_class]?.order ?? 99,
    micro_market: (r) => r.micro_market || '',
    value_avg: (r) => Number(r.value_avg ?? r.value_high ?? r.value_low ?? 0),
    value_low: (r) => Number(r.value_low ?? r.value_avg ?? 0),
    value_high: (r) => Number(r.value_high ?? r.value_avg ?? 0),
  }), [filtered, sort]);

  const formatValue = (r) => {
    const v = r.value_avg ?? r.value_high ?? r.value_low;
    if (v == null) return '—';
    const unit = r.unit || '';
    const fmtNum = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    if (r.value_low != null && r.value_high != null && r.value_low !== r.value_high) {
      return `₹${fmtNum(r.value_low)}–${fmtNum(r.value_high)} ${unit}`;
    }
    return `₹${fmtNum(v)} ${unit}`;
  };

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <DataToolbar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search micro-market, operator, brand, property…"
          ariaLabel="Search niche asset class benchmarks"
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
        <table className="w-full text-xs border-collapse min-w-[820px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <SortableHeader sortKey="asset_class" sort={sort} onSort={onSort} className="py-2 px-3">Asset class</SortableHeader>
              <SortableHeader sortKey="micro_market" sort={sort} onSort={onSort} className="py-2 px-3">Micro-market</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Operator / property</th>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Metric</th>
              <SortableHeader sortKey="value_avg" sort={sort} onSort={onSort} align="right" className="py-2 px-3">Value</SortableHeader>
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Layer</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const acMeta = NICHE_ASSET_CLASS_META[r.asset_class] || { label: r.asset_class, tone: 'neutral' };
              const dtMeta = NICHE_DATA_TYPE_BADGE[r.data_type] || { tone: 'neutral', label: r.data_type };
              const propertyLabel = r.operator_name || r.brand_name || r.property_name || '';
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
                  <td className="py-2 px-3 text-content-secondary">
                    {propertyLabel || <span className="text-content-muted">—</span>}
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
        Niche & alternative asset classes — co-working / student housing / senior living / data centers.
        Per-class metrics differ (per-seat / per-bed / entry capital + monthly fee / MW capacity). Layer
        badge marks the source provenance — listing, IPC report, broker quote, or internal verified.
      </p>
    </div>
  );
}
