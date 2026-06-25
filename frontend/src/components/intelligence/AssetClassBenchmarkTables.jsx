import { useCallback, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Badge from '../common/Badge';
import DataToolbar from '../common/DataToolbar';
import SortableHeader, { applySort, cycleSort } from '../common/SortableHeader';
import { matchesSearch, buildClusterOptions } from '../../utils/intelligenceTableHelpers';

/**
 * Asset-class benchmark tables for the Intelligence page.
 *
 * Four parallel data-display tables (Office, Retail, Industrial,
 * Hospitality) extracted from IntelligencePage.jsx in the 2026-05-25
 * god-file decomposition (Task #6). They share filtering helpers
 * (matchesSearch, buildClusterOptions) which moved to
 * utils/intelligenceTableHelpers.js so this file stays focused on JSX.
 *
 * No behaviour change. Each table is self-contained — search /
 * cluster-filter / sort state stays local.
 */

// ─── Delta formatting ──────────────────────────────────────────────────────
// YoY / QoQ deltas must read honestly. A bare `+${v}%` renders "+-3%" for a
// decline and paints every cell emerald — wrong for benchmark tables where
// rents and serviced-land values can fall. fmtDelta carries the real sign;
// deltaTone colours up-emerald / down-red / flat-muted.
const fmtDelta = (v, digits) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  const body = digits == null ? `${n}` : n.toFixed(digits);
  return `${n > 0 ? '+' : ''}${body}%`;
};

const deltaTone = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return 'text-content-muted';
  return n > 0 ? 'text-data-positive' : 'text-data-negative';
};

export function OfficeBenchmarksTable({ rows }) {
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
              const vacColor = r.vacancy_pct <= 5 ? 'text-data-positive font-semibold'
                : r.vacancy_pct <= 10 ? 'text-accent font-medium'
                : r.vacancy_pct <= 20 ? 'text-premium font-medium'
                : 'text-data-negative font-semibold';
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
        className="mt-3 text-xs font-medium text-accent hover:text-accent flex items-center gap-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1"
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
                  <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${deltaTone(r.yoy_change_pct)}`}>
                    {fmtDelta(r.yoy_change_pct) ?? '—'}
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

export function RetailBenchmarksTable({ rows }) {
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
                  <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${deltaTone(r.qoq_change_pct)}`}>
                    {fmtDelta(r.qoq_change_pct) ?? '—'}
                  </td>
                  <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${deltaTone(r.yoy_change_pct)}`}>
                    {fmtDelta(r.yoy_change_pct) ?? '—'}
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

export function IndustrialBenchmarksTable({ rows }) {
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
                  <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${deltaTone(r.yoy_change_pct)}`}>
                    {fmtDelta(r.yoy_change_pct, 1) ?? '—'}
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
                    <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${deltaTone(r.yoy_change_pct)}`}>
                      {fmtDelta(r.yoy_change_pct, 1) ?? '—'}
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

export function HospitalityBenchmarksTable({ rows }) {
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
