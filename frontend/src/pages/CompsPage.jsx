import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Building2,
  Download,
  Loader2,
  Map as MapIcon,
  Table as TableIcon,
} from 'lucide-react';
import { useComps, useCreateComp, useDeleteComp } from '../hooks/useComps';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import DataToolbar from '../components/common/DataToolbar';
import SortableHeader, { applySort, cycleSort } from '../components/common/SortableHeader';
import StalenessBadge from '../components/common/StalenessBadge';
import { SkeletonList } from '../design-system';
import { formatINR } from '../utils/format';
import { exportsAPI } from '../services/api';

// Lazy-load the map so the table-only path doesn't pull leaflet (~155 KB
// gzipped) on first paint. Users land on the table view by default; the map
// chunk only fetches when they toggle to Split.
const CompsMap = lazy(() => import('../components/comps/CompsMap'));

const DATA_TYPE_LABEL = {
  internal_benchmark_apr_2026: { tone: 'success', label: 'Verified · Apr 2026' },
  listing_q1_2026:             { tone: 'info',    label: 'Listing · Q1 2026' },
  ipc_q1_2026:                 { tone: 'premium', label: 'IPC · Q1 2026' },
};

const SOURCE_FILTER_OPTIONS = [
  { value: 'verified', label: 'Verified',   matches: (c) => c.is_verified || c.data_type === 'internal_benchmark_apr_2026' },
  { value: 'listing',  label: 'Listing',    matches: (c) => c.data_type === 'listing_q1_2026' },
  { value: 'ipc',      label: 'IPC',        matches: (c) => c.data_type === 'ipc_q1_2026' },
];

const SORT_OPTIONS = [
  { value: 'created_desc',     label: 'Newest first',     key: 'created_at',     dir: 'desc' },
  { value: 'rate_desc',        label: 'Rate ↓',           key: 'rate_per_sqft',  dir: 'desc' },
  { value: 'rate_asc',         label: 'Rate ↑',           key: 'rate_per_sqft',  dir: 'asc'  },
  { value: 'yoy_desc',         label: 'YoY ↓',            key: 'yoy_change_pct', dir: 'desc' },
  { value: 'units_desc',       label: 'Units ↓',          key: 'total_units',    dir: 'desc' },
  { value: 'launch_desc',      label: 'Launch year ↓',    key: 'launch_year',    dir: 'desc' },
  { value: 'project_asc',      label: 'Project A→Z',      key: 'project_name',   dir: 'asc'  },
  { value: 'locality_asc',     label: 'Locality A→Z',     key: 'locality',       dir: 'asc'  },
];

const PROJECT_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed_use', label: 'Mixed Use' },
];

const EMPTY_COMP = {
  projectName: '',
  developer: '',
  city: '',
  locality: '',
  projectType: 'residential',
  bhkConfig: '',
  carpetAreaSqft: '',
  superBuiltupAreaSqft: '',
  ratePerSqft: '',
  totalUnits: '',
  launchYear: '',
  possessionYear: '',
  reraNumber: '',
  source: '',
};

function AddCompModal({ isOpen, onClose, onSubmit, isLoading }) {
  const [form, setForm] = useState(EMPTY_COMP);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    onSubmit({
      ...form,
      carpetAreaSqft: form.carpetAreaSqft ? Number(form.carpetAreaSqft) : undefined,
      superBuiltupAreaSqft: form.superBuiltupAreaSqft ? Number(form.superBuiltupAreaSqft) : undefined,
      ratePerSqft: form.ratePerSqft ? Number(form.ratePerSqft) : undefined,
      totalUnits: form.totalUnits ? Number(form.totalUnits) : undefined,
      launchYear: form.launchYear ? Number(form.launchYear) : undefined,
      possessionYear: form.possessionYear ? Number(form.possessionYear) : undefined,
      developer: form.developer || undefined,
      locality: form.locality || undefined,
      bhkConfig: form.bhkConfig || undefined,
      reraNumber: form.reraNumber || undefined,
      source: form.source || undefined,
    });
    setForm(EMPTY_COMP);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content-primary">Add Comparable</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-secondary text-content-muted hover:text-content-secondary transition"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Project Name *</label>
              <input
                name="projectName"
                required
                value={form.projectName}
                onChange={handleChange}
                placeholder="e.g. Lodha Palava"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Developer</label>
              <input
                name="developer"
                value={form.developer}
                onChange={handleChange}
                placeholder="e.g. Lodha Group"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">City *</label>
              <input
                name="city"
                required
                value={form.city}
                onChange={handleChange}
                placeholder="e.g. Mumbai"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Locality</label>
              <input
                name="locality"
                value={form.locality}
                onChange={handleChange}
                placeholder="e.g. Dombivli"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Type</label>
              <select
                name="projectType"
                value={form.projectType}
                onChange={handleChange}
                className="input"
              >
                {PROJECT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">BHK Config</label>
              <input
                name="bhkConfig"
                value={form.bhkConfig}
                onChange={handleChange}
                placeholder="e.g. 2BHK, 3BHK"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Carpet Area (sqft)</label>
              <input
                name="carpetAreaSqft"
                type="number"
                value={form.carpetAreaSqft}
                onChange={handleChange}
                placeholder="e.g. 650"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Super Built-Up (sqft)</label>
              <input
                name="superBuiltupAreaSqft"
                type="number"
                value={form.superBuiltupAreaSqft}
                onChange={handleChange}
                placeholder="e.g. 900"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Rate per sqft *</label>
              <input
                name="ratePerSqft"
                type="number"
                required
                value={form.ratePerSqft}
                onChange={handleChange}
                placeholder="e.g. 8500"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Total Units</label>
              <input
                name="totalUnits"
                type="number"
                value={form.totalUnits}
                onChange={handleChange}
                placeholder="e.g. 500"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Launch Year</label>
              <input
                name="launchYear"
                type="number"
                value={form.launchYear}
                onChange={handleChange}
                placeholder="e.g. 2024"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Possession Year</label>
              <input
                name="possessionYear"
                type="number"
                value={form.possessionYear}
                onChange={handleChange}
                placeholder="e.g. 2027"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">RERA Number</label>
              <input
                name="reraNumber"
                value={form.reraNumber}
                onChange={handleChange}
                placeholder="e.g. P52100012345"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-secondary mb-1">Source</label>
              <input
                name="source"
                value={form.source}
                onChange={handleChange}
                placeholder="e.g. Broker, Broker report"
                className="input"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={isLoading} className="btn btn-primary">
              {isLoading ? 'Adding...' : 'Add Comparable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CompsPage() {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    city: '',
    projectType: '',
    sourceType: null,
    minRate: '',
    maxRate: '',
  });
  // Inline column-sort state. `key` matches the comp field name; `dir`
  // is 'asc' | 'desc'. Default: newest first (created_at desc).
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  // View mode: 'table' (default — fast first-paint, no leaflet) | 'split'
  // (table left, map right; lazy-loads the leaflet chunk on switch).
  // Persisted in localStorage so power users don't toggle on every visit.
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'table';
    return window.localStorage.getItem('comps:viewMode') === 'split' ? 'split' : 'table';
  });
  // Selected-comp id is lifted here so the table and map can synchronise:
  // click a marker → row highlights + scrolls into view; click a row → map
  // flies to the marker. `null` = nothing pinned.
  const [selectedCompId, setSelectedCompId] = useState(null);
  const rowRefs = useRef({});

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('comps:viewMode', viewMode);
    }
  }, [viewMode]);

  const pageSize = 15;

  // API request — server-side filters only. We fetch the API's max page size
  // (200) and rely on client-side pagination for the visible 15-row slice.
  //
  // Why one big fetch instead of paginated server requests:
  //   - The comps table has ~29 rows today, low hundreds at scale. The API
  //     limit caps at 200; below that, server pagination just adds latency.
  //   - The map view needs ALL filtered rows simultaneously (markers come
  //     from `sortedRows`, not `visible`). Server-paginating the table while
  //     the map needs everything would either drop markers or double-fetch.
  //   - Critical bug previously: `page` was sent to the API as `?page=N`
  //     with `limit=60`, but `page` was simultaneously used for the 15-row
  //     client-side slice. Click-to-jump on a marker for a row at idx ≥ 15
  //     would set `page=2`, which fetched API rows 61-120 — empty when
  //     totalCount < 60 — collapsing the table to "No comparables found"
  //     while the header still showed "29 in the database." Fixed by
  //     decoupling: API is always page=1, `page` state is display-only.
  const queryParams = useMemo(() => {
    const params = { page: 1, limit: 200 };
    if (search) params.search = search;
    if (filters.city) params.city = filters.city;
    if (filters.projectType) params.projectType = filters.projectType;
    if (filters.minRate) params.minRate = Number(filters.minRate);
    if (filters.maxRate) params.maxRate = Number(filters.maxRate);
    return params;
  }, [filters.city, filters.maxRate, filters.minRate, filters.projectType, search]);

  const { data, isLoading } = useComps(queryParams);
  const createMutation = useCreateComp();
  const deleteMutation = useDeleteComp();

  const rawRows = data?.data || [];
  const totalCount = data?.pagination?.total || rawRows.length;

  // Client-side filter — source type and full-text safety net.
  const filteredRows = useMemo(() => {
    let rows = rawRows;
    if (filters.sourceType) {
      const opt = SOURCE_FILTER_OPTIONS.find((o) => o.value === filters.sourceType);
      if (opt) rows = rows.filter(opt.matches);
    }
    return rows;
  }, [rawRows, filters.sourceType]);

  // Client-side sort using the SortableHeader helper.
  const sortedRows = useMemo(
    () => applySort(filteredRows, sort, {
      created_at: (r) => (r.created_at ? new Date(r.created_at).getTime() : 0),
    }),
    [filteredRows, sort],
  );

  // Local pagination on the post-sort, post-filter set.
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Per-source-type counts for the chip group (uses the API-filtered rows
  // — i.e. respects city/projectType/search but not source-type itself).
  const sourceCounts = useMemo(() => {
    const c = { verified: 0, listing: 0, ipc: 0 };
    for (const r of rawRows) {
      for (const o of SOURCE_FILTER_OPTIONS) if (o.matches(r)) c[o.value]++;
    }
    return c;
  }, [rawRows]);

  // Per-asset-class counts — fixes the misleading "All asset classes 0" chip
  // by attaching real counts. The `allowAll` chip then sums to the total
  // automatically (DataToolbar.Chips reduces over `count` for the synthetic
  // All chip).
  const projectTypeCounts = useMemo(() => {
    const c = { residential: 0, commercial: 0, mixed_use: 0 };
    for (const r of rawRows) {
      const t = r.project_type;
      if (c[t] != null) c[t] += 1;
    }
    return c;
  }, [rawRows]);

  const handleCreate = (compData) => {
    createMutation.mutate(compData, {
      onSuccess: () => setShowModal(false),
    });
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this comparable? This cannot be undone.')) return;
    deleteMutation.mutate(id);
  };

  // CSV export of the org's comp library. Hits the existing /exports/comps
  // route — the endpoint was wired server-side and orphaned in the UI; we just
  // bring it forward. Triggers a browser download named with the export date
  // so reviewers can keep multiple snapshots side-by-side.
  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await exportsAPI.comps();
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      link.download = `redip-comps-${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      // Use alert here rather than a toast to avoid wiring a separate UX
      // surface for a single rare failure path. Users see a clear message,
      // and the call is idempotent — they can just retry.
      // eslint-disable-next-line no-alert
      window.alert('Failed to export comps. Please try again.');
      // eslint-disable-next-line no-console
      console.error('Comps export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const updateFilter = useCallback((patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ city: '', projectType: '', sourceType: null, minRate: '', maxRate: '' });
    setSearch('');
    setSort({ key: 'created_at', dir: 'desc' });
    setPage(1);
  }, []);

  const onSort = useCallback((key) => setSort((prev) => cycleSort(key, prev)), []);

  // Active filter pill model — only includes things actually applied.
  const activeFilters = useMemo(() => [
    search && { id: 'search', label: 'Search', value: search, displayValue: `"${search}"` },
    filters.city && { id: 'city', label: 'City', value: filters.city },
    filters.projectType && {
      id: 'projectType', label: 'Type',
      value: filters.projectType,
      displayValue: PROJECT_TYPES.find((p) => p.value === filters.projectType)?.label || filters.projectType,
    },
    filters.sourceType && {
      id: 'sourceType', label: 'Source',
      value: filters.sourceType,
      displayValue: SOURCE_FILTER_OPTIONS.find((s) => s.value === filters.sourceType)?.label || filters.sourceType,
    },
    filters.minRate && { id: 'minRate', label: 'Min ₹/sqft', value: filters.minRate, displayValue: `≥ ₹${Number(filters.minRate).toLocaleString('en-IN')}` },
    filters.maxRate && { id: 'maxRate', label: 'Max ₹/sqft', value: filters.maxRate, displayValue: `≤ ₹${Number(filters.maxRate).toLocaleString('en-IN')}` },
  ].filter(Boolean), [search, filters]);

  const removeFilter = useCallback((id) => {
    if (id === 'search') setSearch('');
    else if (id === 'sourceType') updateFilter({ sourceType: null });
    else updateFilter({ [id]: '' });
  }, [updateFilter]);

  const hasActiveFilters = activeFilters.length > 0;

  // Selecting a row from the map. If the comp lives on a different page than
  // the visible slice, jump to that page so the row scrolls into view. The
  // row-ref scroll happens in the effect below once the page state settles.
  const handleSelectComp = useCallback(
    (compId) => {
      if (compId == null) {
        setSelectedCompId(null);
        return;
      }
      setSelectedCompId(compId);
      const idx = sortedRows.findIndex((r) => r.id === compId);
      if (idx >= 0) {
        const targetPage = Math.floor(idx / pageSize) + 1;
        if (targetPage !== safePage) setPage(targetPage);
      }
    },
    [sortedRows, safePage, pageSize],
  );

  // Scroll the selected row into view after page transitions finish. Uses
  // {block: 'nearest'} so the page doesn't yank if the row is already in view.
  useEffect(() => {
    if (!selectedCompId) return;
    const el = rowRefs.current[selectedCompId];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedCompId, safePage]);

  return (
    <div className="space-y-5">
      {/* Sticky page header — pins the Map | Table toggle, Export CSV, and
          Add Comp to the top of the viewport so they stay reachable while
          scrolling through long result sets. Backdrop blur keeps the band
          readable over content scrolling beneath. The negative inline
          margins extend the band to the layout shell's natural gutter so
          there's no awkward inner-edge break. */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-1 bg-bg-primary/85 backdrop-blur-md">
      <PageHeader
        title="Comparables"
        description={`${totalCount} verified ${totalCount === 1 ? 'comparable' : 'comparables'} in the database`}
        actions={
          <div className="flex items-center gap-2">
            {/* View toggle — segmented, two-state. Stable chrome (border +
                bg) with a soft accent on the active segment. Lazy-loads
                the leaflet chunk only when Split is selected. */}
            <div
              className="inline-flex items-center rounded-lg border border-hairline-strong bg-bg-elevated p-0.5"
              role="group"
              aria-label="Comps view mode"
            >
              {[
                { value: 'table', label: 'Table', icon: TableIcon },
                { value: 'split', label: 'Split',  icon: MapIcon },
              ].map(({ value, label, icon: Icon }) => {
                const active = viewMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setViewMode(value)}
                    className={
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-out ' +
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] ' +
                      (active
                        ? 'bg-primary-50 text-primary-700 shadow-sm'
                        : 'text-content-secondary hover:bg-bg-secondary hover:text-content-primary')
                    }
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || rawRows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-content-secondary transition-colors duration-150 ease-out hover:border-primary-300 hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-hairline-strong"
              title={rawRows.length === 0 ? 'Nothing to export' : 'Download all comps as CSV'}
            >
              {exporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button onClick={() => setShowModal(true)} className="btn btn-primary">
              <Plus size={16} />
              Add Comp
            </button>
          </div>
        }
      />
      </div>

      <DataToolbar>
        <div className="flex flex-wrap items-center gap-3">
          <DataToolbar.Search
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Search project, developer, RERA…"
            ariaLabel="Search comparables"
          />
          <input
            value={filters.city}
            onChange={(e) => updateFilter({ city: e.target.value })}
            placeholder="City"
            aria-label="Filter by city"
            className="w-32 px-3 py-2 rounded-lg text-sm bg-bg-elevated text-content-primary placeholder:text-content-muted border border-hairline-strong transition-colors duration-150 hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:border-primary-400"
          />
          <input
            type="number"
            value={filters.minRate}
            onChange={(e) => updateFilter({ minRate: e.target.value })}
            placeholder="Min ₹/sqft"
            aria-label="Minimum rate per sqft"
            className="w-28 px-3 py-2 rounded-lg text-sm tabular-nums bg-bg-elevated text-content-primary placeholder:text-content-muted border border-hairline-strong transition-colors duration-150 hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:border-primary-400"
          />
          <input
            type="number"
            value={filters.maxRate}
            onChange={(e) => updateFilter({ maxRate: e.target.value })}
            placeholder="Max ₹/sqft"
            aria-label="Maximum rate per sqft"
            className="w-28 px-3 py-2 rounded-lg text-sm tabular-nums bg-bg-elevated text-content-primary placeholder:text-content-muted border border-hairline-strong transition-colors duration-150 hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:border-primary-400"
          />
          <DataToolbar.Sort
            value={sort.key === 'created_at' && sort.dir === 'desc' ? 'created_desc'
              : sort.key === 'rate_per_sqft' && sort.dir === 'desc' ? 'rate_desc'
              : sort.key === 'rate_per_sqft' && sort.dir === 'asc'  ? 'rate_asc'
              : sort.key === 'yoy_change_pct' && sort.dir === 'desc' ? 'yoy_desc'
              : sort.key === 'total_units' && sort.dir === 'desc' ? 'units_desc'
              : sort.key === 'launch_year' && sort.dir === 'desc' ? 'launch_desc'
              : sort.key === 'project_name' && sort.dir === 'asc' ? 'project_asc'
              : sort.key === 'locality' && sort.dir === 'asc' ? 'locality_asc'
              : 'created_desc'}
            onChange={(v) => {
              const opt = SORT_OPTIONS.find((o) => o.value === v);
              if (opt) setSort({ key: opt.key, dir: opt.dir });
            }}
            options={SORT_OPTIONS}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <DataToolbar.Chips
            label="Asset class"
            value={filters.projectType || null}
            onChange={(v) => updateFilter({ projectType: v || '' })}
            options={PROJECT_TYPES.map((p) => ({ value: p.value, label: p.label, count: projectTypeCounts[p.value] }))}
            allowAll
            allLabel="All asset classes"
          />
          <DataToolbar.Chips
            label="Source"
            value={filters.sourceType}
            onChange={(v) => updateFilter({ sourceType: v })}
            options={SOURCE_FILTER_OPTIONS.map((s) => ({ value: s.value, label: s.label, count: sourceCounts[s.value] }))}
            allowAll
            allLabel="All sources"
          />
        </div>
        <DataToolbar.ActiveFilters
          filters={activeFilters}
          onRemove={removeFilter}
          onClearAll={clearFilters}
          resultCount={sortedRows.length}
          totalCount={rawRows.length}
        />
      </DataToolbar>

      {isLoading ? (
        <div className="bg-bg-elevated border border-hairline rounded-editorial p-2">
          <SkeletonList rows={6} columns={6} />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No comparables found"
          description={
            hasActiveFilters
              ? 'Try adjusting your filters or search terms.'
              : 'Add your first comparable to get started.'
          }
          icon={Building2}
          action={
            !hasActiveFilters && (
              <button onClick={() => setShowModal(true)} className="btn btn-primary">
                <Plus size={16} />
                Add Comparable
              </button>
            )
          }
        />
      ) : (
        <div
          className={
            viewMode === 'split'
              ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start'
              : ''
          }
        >
          {viewMode === 'split' && (
            <div className="lg:order-last lg:sticky lg:top-4 self-start">
              <Suspense
                fallback={
                  <div
                    className="bg-bg-secondary border border-hairline rounded-editorial flex items-center justify-center text-sm text-content-muted"
                    style={{ height: 520 }}
                  >
                    <Loader2 size={16} className="animate-spin mr-2" /> Loading map…
                  </div>
                }
              >
                <CompsMap
                  comps={sortedRows}
                  selectedCompId={selectedCompId}
                  onSelectComp={handleSelectComp}
                  height={520}
                />
              </Suspense>
            </div>
          )}
          <div className="bg-bg-elevated rounded-editorial border border-hairline-strong overflow-hidden shadow-editorial">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-secondary/70 border-b border-hairline-strong">
                  <SortableHeader sortKey="project_name" sort={sort} onSort={onSort} className="px-4 py-3">Project</SortableHeader>
                  <SortableHeader sortKey="developer" sort={sort} onSort={onSort} className="px-4 py-3">Developer</SortableHeader>
                  <SortableHeader sortKey="locality" sort={sort} onSort={onSort} className="px-4 py-3">Locality</SortableHeader>
                  <th className="px-4 py-3 text-left font-semibold text-[10px] tracking-[0.08em] uppercase text-content-muted">Type</th>
                  <SortableHeader sortKey="rate_per_sqft" sort={sort} onSort={onSort} align="right" className="px-4 py-3">Rate ₹/sqft</SortableHeader>
                  <th className="px-4 py-3 text-right font-semibold text-[10px] tracking-[0.08em] uppercase text-content-muted">Range</th>
                  <SortableHeader sortKey="yoy_change_pct" sort={sort} onSort={onSort} align="right" className="px-4 py-3">YoY</SortableHeader>
                  <SortableHeader sortKey="total_units" sort={sort} onSort={onSort} align="right" className="px-4 py-3">Units</SortableHeader>
                  <SortableHeader sortKey="launch_year" sort={sort} onSort={onSort} align="center" className="px-4 py-3">Launch</SortableHeader>
                  <th className="px-4 py-3 text-left font-semibold text-[10px] tracking-[0.08em] uppercase text-content-muted">Source</th>
                  <th className="px-4 py-3 text-center font-semibold text-[10px] tracking-[0.08em] uppercase text-content-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visible.map((comp) => {
                  const dt = DATA_TYPE_LABEL[comp.data_type] || (comp.is_verified
                    ? { tone: 'success', label: 'Verified' }
                    : { tone: 'neutral', label: 'Internal' });
                  const yoy = comp.yoy_change_pct;
                  const yoyColor = yoy == null ? 'text-content-muted'
                    : yoy >= 20 ? 'text-emerald-600 font-semibold'
                    : yoy >= 5  ? 'text-emerald-600'
                    : yoy < 0   ? 'text-red-500' : 'text-content-secondary';
                  const rangeLow  = comp.rate_per_sqft_min;
                  const rangeHigh = comp.rate_per_sqft_max;
                  const hasRange = rangeLow != null && rangeHigh != null && Number(rangeLow) !== Number(rangeHigh);
                  const isSelected = selectedCompId === comp.id;
                  return (
                    <tr
                      key={comp.id}
                      ref={(el) => { rowRefs.current[comp.id] = el; }}
                      onClick={() => handleSelectComp(isSelected ? null : comp.id)}
                      className={
                        'cursor-pointer transition-colors duration-150 ease-out ' +
                        (isSelected
                          ? 'bg-primary-50/60 ring-1 ring-inset ring-primary-200'
                          : 'hover:bg-bg-secondary')
                      }
                    >
                      <td className="px-4 py-3 font-medium text-content-primary whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{comp.project_name}</span>
                          {comp.rera_number && (
                            <span className="text-[10px] text-content-muted font-mono" title={`RERA ${comp.rera_number}`}>
                              {comp.rera_number}
                            </span>
                          )}
                        </div>
                        {comp.city && (
                          <span className="text-[10px] text-content-muted">{comp.city}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-content-secondary whitespace-nowrap">{comp.developer || '—'}</td>
                      <td className="px-4 py-3 text-content-secondary">{comp.locality || '—'}</td>
                      <td className="px-4 py-3">
                        {/* Type pill — neutral chrome + accent stripe per the
                            editorial-not-tacky rule. Replaces the prior
                            saturated blue tile that read as chip-soup. */}
                        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-secondary px-2 py-0.5 text-[11px] font-medium text-content-secondary uppercase tracking-wide">
                          <span className="w-1 h-1 rounded-full bg-primary-500" aria-hidden="true" />
                          {comp.project_type?.replace(/_/g, ' ') || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-content-primary tabular-nums">
                        {comp.rate_per_sqft ? formatINR(comp.rate_per_sqft, 0) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-content-secondary text-xs tabular-nums whitespace-nowrap">
                        {hasRange ? `${formatINR(rangeLow, 0)}–${formatINR(rangeHigh, 0)}` : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs tabular-nums whitespace-nowrap ${yoyColor}`}>
                        {yoy != null ? `${yoy > 0 ? '+' : ''}${yoy}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-content-secondary tabular-nums">
                        {comp.total_units?.toLocaleString('en-IN') || '—'}
                      </td>
                      <td className="px-4 py-3 text-center text-content-secondary">{comp.launch_year || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {comp.source_url ? (
                            <a
                              href={comp.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-block transition-opacity duration-150 ease-out hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded-full"
                              title={comp.source || 'Open source'}
                            >
                              <Badge tone={dt.tone}>{dt.label}</Badge>
                            </a>
                          ) : (
                            <Badge tone={dt.tone} title={comp.source || comp.data_type}>{dt.label}</Badge>
                          )}
                          {comp.as_of_date && (
                            <StalenessBadge
                              asOfDate={comp.as_of_date}
                              dataType={comp.data_type}
                              fallback="residential_listing"
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(comp.id); }}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 rounded-lg text-content-muted transition-colors duration-150 ease-out hover:text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 active:scale-[0.95] disabled:opacity-50"
                          title="Delete comparable"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-hairline-strong bg-bg-secondary">
              <p className="text-xs tabular-nums text-content-secondary">
                Page <span className="font-semibold text-content-primary">{safePage}</span> of {totalPages}
                <span className="mx-2 text-content-muted">·</span>
                <span className="text-content-muted">{sortedRows.length.toLocaleString()} {sortedRows.length === 1 ? 'result' : 'results'}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  aria-label="Previous page"
                  className="p-1.5 rounded-lg border border-hairline-strong text-content-secondary transition-colors duration-150 hover:bg-bg-elevated hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  aria-label="Next page"
                  className="p-1.5 rounded-lg border border-hairline-strong text-content-secondary transition-colors duration-150 hover:bg-bg-elevated hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      <AddCompModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
      />
    </div>
  );
}
