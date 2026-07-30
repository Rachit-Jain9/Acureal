import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, Briefcase, ChevronLeft, ChevronRight,
  Trash2, Loader2, User, Download,
  Archive, UserPlus, ArrowRight, GitCompare,
} from 'lucide-react';
import { clsx } from 'clsx';
import { ErrorState } from '../design-system';
import {
  useDeals,
  useCreateDeal,
  useBulkArchiveDeals,
  useBulkReassignDeals,
  useBulkTransitionDeals,
  useBulkDeleteDeals,
} from '../hooks/useDeals';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';
import { useProperties } from '../hooks/useProperties';
// Smart Property Capture — inline create-new for the New Deal modal so
// users don't have to save-as-draft, navigate to the deal, and only then
// link a property. Paste a Maps link / Plus Code / address / coords /
// survey number / broker narrative and Acureal creates the parcel inline.
// Lazy-loaded: it (transitively) pulls in the Leaflet map vendor chunk via
// ReadOnlyPropertyMap, and only ever renders inside the New-Deal modal's
// capture branch — so code-splitting it keeps ~150KB of map JS + leaflet.css
// off the frequently-hit /deals route until capture mode is actually opened.
const PropertyCaptureField = lazy(() => import('../components/deal/PropertyCaptureField'));
import LandPricingFields from '../components/deals/LandPricingFields';
import { useSavedDealViews } from '../hooks/useSavedDealViews';
import SavedViewsMenu from '../components/deals/SavedViewsMenu';
// DealCard was extracted from this file (2026-05-25) when DealsPage
// crossed 1,400 lines. Its full state machine (menu / share / delete /
// hover-prefetch / urgency-strip / per-deal export) lives in the
// dedicated component file now.
import DealCard from '../components/deals/DealCard';
import CompareDealsModal from '../components/deals/CompareDealsModal';
import useAuthStore from '../store/authStore';
import { useCanEdit } from '../hooks/useCanEdit';
import EmptyState from '../components/common/EmptyState';
import Badge from '../components/common/Badge';
import PageHeader from '../components/common/PageHeader';
import PageIntro from '../components/guide/PageIntro';
import { SkeletonList, SkeletonKpi, Skeleton, Modal, Button } from '../design-system';
import { toast } from '../components/common/Toast';
import { exportsAPI } from '../services/api';
import { downloadAxiosResponse } from '../utils/download';
import {
  formatCrores,
  formatPct,
  STAGE_CONFIG,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from '../utils/format';
import { buildLandPricingPreview } from '../utils/landPricing';
// PR-NX59 (2026-05-19) — single source of truth for taxonomies shared
// across the create form and the deal detail edit form. The list-chip
// labels (formerly aliased here as ASSET_CLASS_LABELS / DEAL_STRUCTURE_LABELS)
// now live inside DealCard.jsx alongside the card render code.
import { ASSET_CLASS_CONFIG } from '../utils/assetClasses';
import { DEAL_STRUCTURE_CONFIG } from '../utils/dealStructures';
import { isValidPair as isValidStructurePair } from '../utils/dealStructureMatrix';

const INITIAL_FORM = {
  propertyId: '',
  name: '',
  dealType: 'acquisition',
  stage: 'screening',
  priority: 'medium',
  assetClass: 'residential_apartments',
  dealStructure: 'outright',
  landPricingBasis: 'total_cr',
  landPriceRateInr: '',
  landExtentInputValue: '',
  landExtentInputUnit: 'sqft',
  landAskPriceCr: '',
  notes: '',
};

export default function DealsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [stageFilter, setStageFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [page, setPage] = useState(1);
  const currentUser = useAuthStore((s) => s.user);
  const canEdit = useCanEdit();

  // Saved-views store (per-device localStorage). Captures the current
  // filter combination under a name so an analyst can recall "My active
  // sourcing", "Bengaluru office", etc. with one click.
  const savedViews = useSavedDealViews();

  // Sync search param from header navigation
  useEffect(() => {
    const q = searchParams.get('search');
    if (q) setSearch(q);
  }, [searchParams]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  // 'pick'    — choose from existing properties or skip (default)
  // 'capture' — paste-to-create a brand-new property inline before saving the deal
  const [propertyMode, setPropertyMode] = useState('pick');

  // Deep-link target for the Cmd-K "Create new deal" action: when the
  // URL carries ?new=1 (or ?action=create) the create modal opens
  // automatically on mount, and the param is stripped so a back/forward
  // navigation doesn't reopen the modal.
  useEffect(() => {
    if (searchParams.get('new') === '1' || searchParams.get('action') === 'create') {
      setShowModal(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Debounce ONLY the value that feeds the /deals query key. The raw `search`
  // stays bound to the input (instant typing) and to the saved-views detection
  // below; the debounced value gates the network fetch so we don't fire a
  // request + full re-render on every keystroke (FRONTEND_GUIDELINES §3, 250ms).
  const debouncedSearch = useDebouncedValue(search, 250);

  const params = useMemo(() => {
    const p = { page, limit: 12 };
    if (debouncedSearch) p.search = debouncedSearch;
    if (stageFilter) p.stage = stageFilter;
    if (typeFilter) p.dealType = typeFilter;
    if (priorityFilter) p.priority = priorityFilter;
    if (assignedToMe) p.assignedToMe = true;
    return p;
  }, [debouncedSearch, stageFilter, typeFilter, priorityFilter, assignedToMe, page]);

  // Snapshot of the user-controlled filter state — this is what
  // saved views capture and recall. Page intentionally NOT included
  // (a saved view should land you on page 1).
  const currentFilters = useMemo(
    () => ({
      search: search || '',
      stage: stageFilter || '',
      dealType: typeFilter || '',
      priority: priorityFilter || '',
      assignedToMe: !!assignedToMe,
    }),
    [search, stageFilter, typeFilter, priorityFilter, assignedToMe],
  );

  const applySavedView = (view) => {
    const f = view?.filters || {};
    setSearch(f.search || '');
    setStageFilter(f.stage || '');
    setTypeFilter(f.dealType || '');
    setPriorityFilter(f.priority || '');
    setAssignedToMe(!!f.assignedToMe);
    setPage(1);
  };

  const activeView = savedViews.findActive(currentFilters);
  const canSaveCurrentView =
    !!(search || stageFilter || typeFilter || priorityFilter || assignedToMe);

  const { data, isLoading, isError, refetch } = useDeals(params);
  // The property list feeds ONLY the New-Deal modal's picker, so defer the
  // (up-to-200-row) fetch until the modal is open instead of firing it on
  // every visit to the deals list. staleTime keeps it warm if the user opens
  // the modal, closes it, and reopens shortly after.
  const { data: propertiesData } = useProperties({ limit: 200 }, { enabled: showModal, staleTime: 60_000 });
  const createDeal = useCreateDeal();

  const deals = data?.data || [];
  const pagination = data?.pagination || { total: 0, page: 1, totalPages: 1 };

  const properties = propertiesData?.data || [];
  const selectedProperty = properties.find((property) => property.id === form.propertyId);
  const landPricingPreview = buildLandPricingPreview({
    pricingBasis: form.landPricingBasis,
    totalPriceCr: form.landAskPriceCr,
    rateInr: form.landPriceRateInr,
    extentValue: form.landExtentInputValue,
    extentUnit: form.landExtentInputUnit,
    fallbackAreaSqft: selectedProperty?.land_area_sqft,
  });

  // Multi-select for bulk operations on the deals list. Selection
  // clears when filters change so stale ids never carry over.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageTarget, setStageTarget] = useState('');
  const [stageNotes, setStageNotes] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  // Side-by-side deal comparison (2–4 selected). The modal calls the
  // workspace endpoint for each selected deal via useQueries — same cache
  // key as the per-deal route, so cold loads are shared.
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';

  useEffect(() => {
    setSelectedIds(new Set());
    setArchiveModalOpen(false);
    setReassignModalOpen(false);
    setStageModalOpen(false);
    setDeleteModalOpen(false);
    setCompareModalOpen(false);
    setArchiveReason('');
    setReassignTargetId('');
    setStageTarget('');
    setStageNotes('');
    setDeleteConfirmText('');
  }, [search, stageFilter, typeFilter, priorityFilter, assignedToMe]);

  const bulkArchive = useBulkArchiveDeals();
  const bulkReassign = useBulkReassignDeals();
  const bulkTransition = useBulkTransitionDeals();
  const bulkDelete = useBulkDeleteDeals();
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminAPI.listUsers().then((r) => r.data.data),
    enabled: reassignModalOpen,
    staleTime: 5 * 60_000,
  });

  const someSelected = selectedIds.size > 0;
  // useCallback with empty deps keeps this referentially stable for the
  // component's lifetime (it only touches the stable functional setSelectedIds
  // updater), so the memoized DealCard can skip re-rendering when nothing but a
  // sibling card's selection changed.
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = () => setSelectedIds(new Set());
  const bulkBusy =
    bulkArchive.isPending
    || bulkReassign.isPending
    || bulkTransition.isPending
    || bulkDelete.isPending;

  const handleConfirmArchive = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await bulkArchive.mutateAsync({ ids, reason: archiveReason.trim() || null });
      clearSelection();
      setArchiveModalOpen(false);
      setArchiveReason('');
    } catch {
      // toast surfaced by hook
    }
  };

  const handleConfirmReassign = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await bulkReassign.mutateAsync({ ids, assignedTo: reassignTargetId || null });
      clearSelection();
      setReassignModalOpen(false);
      setReassignTargetId('');
    } catch {
      // toast surfaced by hook
    }
  };

  const handleConfirmStage = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || !stageTarget) return;
    try {
      await bulkTransition.mutateAsync({ ids, stage: stageTarget, notes: stageNotes.trim() || null });
      clearSelection();
      setStageModalOpen(false);
      setStageTarget('');
      setStageNotes('');
    } catch {
      // toast surfaced by hook
    }
  };

  // Bulk delete is the most destructive surface we expose. The
  // "type DELETE to confirm" pattern is a deliberate friction gate —
  // clicking through a generic confirm() once was the muscle memory
  // for archive; deletion has to feel different.
  const deleteConfirmReady = deleteConfirmText.trim().toUpperCase() === 'DELETE';
  const handleConfirmDelete = async () => {
    if (!deleteConfirmReady) return;
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await bulkDelete.mutateAsync(ids);
      clearSelection();
      setDeleteModalOpen(false);
      setDeleteConfirmText('');
    } catch {
      // toast surfaced by hook
    }
  };

  const handleFilterReset = () => {
    setSearch('');
    setStageFilter('');
    setTypeFilter('');
    setPriorityFilter('');
    setAssignedToMe(false);
    setPage(1);
  };

  const hasFilters = search || stageFilter || typeFilter || priorityFilter || assignedToMe;

  // CSV export — passes the current filter combo to the backend so the
  // file matches exactly what's on screen. Active saved view → click
  // Export → file rows = filtered rows. Page/limit are stripped because
  // the export is meant to capture the full filtered set, not just the
  // visible page.
  const [exportingCsv, setExportingCsv] = useState(false);
  const handleExportCsv = async () => {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const exportParams = { ...params };
      delete exportParams.page;
      delete exportParams.limit;
      const response = await exportsAPI.dealsCsv(exportParams);
      const today = new Date().toISOString().slice(0, 10);
      const suffix = activeView ? `-${activeView.name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40).toLowerCase()}` : '';
      downloadAxiosResponse(response, `redip-deals${suffix}-${today}.csv`);
      toast.success(`Exported ${pagination.total} deal${pagination.total === 1 ? '' : 's'} to CSV`);
    } catch (error) {
      toast.error(error?.response?.data?.message || 'CSV export failed');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleOpenModal = () => {
    setForm(INITIAL_FORM);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setForm(INITIAL_FORM);
    setPropertyMode('pick');
  };

  // SmartCapture inside the New Deal modal — when a property is captured
  // and saved, attach it to the in-flight deal form and flip back to the
  // picker (which auto-selects the new property because useCaptureProperty
  // invalidates the properties query cache).
  const handlePropertyCaptured = (newPropertyId, newPropertyData) => {
    setForm((prev) => ({
      ...prev,
      propertyId: newPropertyId,
      // Carry the captured name forward as the default deal name when the
      // user hasn't typed one yet — saves an extra keystroke for the most
      // common case (Indian sourcers name the deal after the parcel).
      name: prev.name || (newPropertyData?.name ? newPropertyData.name : prev.name),
    }));
    setPropertyMode('pick');
  };

  const handleFormChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Block the four structurally-incoherent (assetClass, dealStructure) pairs
    // before they hit the API. The inline warning under the Deal Structure
    // select tells the user what to pick instead.
    const pairCheck = isValidStructurePair(form.assetClass, form.dealStructure);
    if (!pairCheck.valid) return;
    const payload = {
      propertyId: form.propertyId || undefined,
      name: form.name,
      dealType: form.dealType,
      stage: form.stage,
      priority: form.priority,
      assetClass: form.assetClass,
      dealStructure: form.dealStructure,
      landPricingBasis: form.landPricingBasis,
      landPriceRateInr: form.landPriceRateInr ? parseFloat(form.landPriceRateInr) : undefined,
      landExtentInputValue: form.landExtentInputValue ? parseFloat(form.landExtentInputValue) : undefined,
      landExtentInputUnit: form.landExtentInputUnit,
      landAskPriceCr: landPricingPreview.totalPriceCr ?? undefined,
      notes: form.notes || undefined,
    };
    try {
      await createDeal.mutateAsync(payload);
      handleCloseModal();
    } catch {
      // error handled by hook
    }
  };

  // Skeleton mirrors the page chrome — header + KPI strip + table — so the
  // layout stays stable when data resolves.
  if (isLoading) {
    return (
      <div aria-busy="true">
        <PageHeader title="Deals" description="Loading pipeline…" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <div className="bg-bg-elevated border border-hairline rounded-editorial p-2">
          <SkeletonList rows={8} columns={5} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12">
        <ErrorState
          title="Couldn't load your deals"
          description="This is usually a transient network hiccup. Retry — your filters are preserved."
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Deals"
        description={`${pagination.total} deal${pagination.total !== 1 ? 's' : ''} in pipeline`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exportingCsv || pagination.total === 0}
              className="btn btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50"
              title={
                pagination.total === 0
                  ? 'Nothing to export — list is empty'
                  : `Download all ${pagination.total} matching deal${pagination.total === 1 ? '' : 's'} as CSV`
              }
            >
              {exportingCsv ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exportingCsv ? 'Exporting…' : 'Export CSV'}
            </button>
            {canEdit && (
              <button onClick={handleOpenModal} className="btn btn-primary flex items-center gap-2">
                <Plus size={16} />
                New Deal
              </button>
            )}
          </div>
        }
      />

      <PageIntro topicId="deals" />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
          <input
            type="text"
            aria-label="Search deals"
            placeholder="Search deals, properties, cities..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-9 w-full"
          />
        </div>

        <select
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
          aria-label="Filter by stage"
          className="input w-auto"
        >
          <option value="">All Stages</option>
          {Object.entries(STAGE_CONFIG).filter(([key]) => key !== 'dead').map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          aria-label="Filter by deal type"
          className="input w-auto"
        >
          <option value="">All Types</option>
          {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
          aria-label="Filter by priority"
          className="input w-auto"
        >
          <option value="">All Priorities</option>
          {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>

        {/* "My Deals" pill — scopes the listing to deals where
            assigned_to = current user. Sits between the dropdown
            filters and the Clear / Saved-views actions because it's
            the most-used filter for any analyst with their own
            book. Disabled until the user record loads (rare). */}
        <button
          type="button"
          onClick={() => { setAssignedToMe((v) => !v); setPage(1); }}
          disabled={!currentUser?.id}
          className={clsx(
            'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors',
            'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'disabled:opacity-50',
            assignedToMe
              ? 'bg-accent text-white border-accent'
              : 'bg-bg-elevated text-content-secondary border-hairline hover:border-content-muted hover:text-content-primary',
          )}
          title="Show only deals assigned to me"
          aria-pressed={assignedToMe}
        >
          <User size={13} />
          My Deals
        </button>

        <SavedViewsMenu
          views={savedViews.views}
          activeView={activeView}
          currentFilters={currentFilters}
          onApply={applySavedView}
          onSave={savedViews.save}
          onRemove={savedViews.remove}
          canSave={canSaveCurrentView}
        />

        {hasFilters && (
          <button onClick={handleFilterReset} className="text-sm text-content-secondary hover:text-content-primary flex items-center gap-1 transition-colors duration-150 ease-out">
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Deal Cards Grid */}
      {deals.length === 0 ? (
        <EmptyState
          title="No deals found"
          description={hasFilters ? 'Try adjusting your filters.' : 'Create your first deal to get started.'}
          icon={Briefcase}
          action={
            !hasFilters && canEdit && (
              <button onClick={handleOpenModal} className="btn btn-primary">
                <Plus size={16} className="mr-1 inline" /> New Deal
              </button>
            )
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {deals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                selected={selectedIds.has(deal.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-content-secondary">
                Showing {(pagination.page - 1) * (params.limit || 12) + 1}
                &ndash;
                {Math.min(pagination.page * (params.limit || 12), pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                  aria-label="Previous page"
                  className="btn btn-secondary p-2 disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-content-secondary">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  aria-label="Next page"
                  className="btn btn-secondary p-2 disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Bulk action bar — slides in when ≥1 deal is selected ───────
            Mirrors the sticky pattern from the Comps Review Queue.
            Each button gates on `bulkBusy` so the user can't fire
            another mutation while one is in flight. */}
      {someSelected && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-bg-elevated border border-hairline shadow-editorial rounded-md px-4 py-2.5"
        >
          <span className="text-sm font-medium text-content-primary tabular-nums">
            {selectedIds.size} selected
          </span>
          <span className="text-content-muted">·</span>
          {/* Compare — visible only when 2–4 deals selected. Fewer than 2 isn't a
              comparison; more than 4 doesn't fit on a laptop without horizontal
              scroll-loss. */}
          {selectedIds.size >= 2 && selectedIds.size <= 4 && (
            <button
              type="button"
              onClick={() => setCompareModalOpen(true)}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-accent bg-accent-soft text-accent hover:bg-accent hover:text-white transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              title="Open side-by-side comparison"
            >
              <GitCompare size={13} />
              Compare
            </button>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setReassignModalOpen(true)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <UserPlus size={13} />
                Reassign
              </button>
              <button
                type="button"
                onClick={() => setStageModalOpen(true)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ArrowRight size={13} />
                Move stage
              </button>
              <button
                type="button"
                onClick={() => setArchiveModalOpen(true)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Archive size={13} />
                Archive
              </button>
            </>
          )}
          {/* Bulk delete — admin-only. Visible only to owner/admin so
              analyst seats can't fat-finger a destructive batch op.
              The single-deal Delete on each card is also admin-gated
              (DealCard renders the menu item conditionally). */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-neg-soft text-data-negative hover:brightness-95 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
              title="Hard-delete the selected deals — irreversible"
            >
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-content-muted hover:text-content-primary transition-colors disabled:opacity-60"
            aria-label="Clear selection"
          >
            <X size={12} />
            Clear
          </button>
        </div>
      )}

      {/* Side-by-side comparison — 2–4 selected deals, side-by-side workspace
          signals (kernel KPIs, IC + Risk + DD, approvals, top blocker). */}
      <CompareDealsModal
        open={compareModalOpen}
        dealIds={[...selectedIds]}
        onClose={() => setCompareModalOpen(false)}
      />

      {/* Bulk archive — optional shared reason applied to every row. */}
      <Modal
        open={archiveModalOpen}
        onClose={() => { if (!bulkBusy) setArchiveModalOpen(false); }}
        title={`Archive ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}`}
        size="md"
        closeOnOverlayClick={!bulkBusy}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setArchiveModalOpen(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmArchive}
              loading={bulkArchive.isPending}
              disabled={bulkBusy}
              leftIcon={<Archive size={13} />}
            >
              {bulkArchive.isPending ? 'Archiving…' : `Archive ${selectedIds.size}`}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-xs text-content-muted">
            Archived deals are removed from active views but kept for audit. They can be restored individually from the deal detail page.
          </p>
          <div>
            <label htmlFor="bulk-archive-reason" className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Reason <span className="text-content-muted normal-case tracking-normal">(optional, applied to all)</span>
            </label>
            <textarea
              id="bulk-archive-reason"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              rows={3}
              placeholder="e.g. Stalled — owner unresponsive for 6 weeks"
              maxLength={1000}
              className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
            />
          </div>
        </div>
      </Modal>

      {/* Bulk reassign — picker for the new owner. */}
      <Modal
        open={reassignModalOpen}
        onClose={() => { if (!bulkBusy) setReassignModalOpen(false); }}
        title={`Reassign ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}`}
        size="md"
        closeOnOverlayClick={!bulkBusy}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setReassignModalOpen(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmReassign}
              loading={bulkReassign.isPending}
              disabled={bulkBusy}
              leftIcon={<UserPlus size={13} />}
            >
              {bulkReassign.isPending
                ? 'Reassigning…'
                : reassignTargetId
                  ? `Reassign ${selectedIds.size}`
                  : `Unassign ${selectedIds.size}`}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-xs text-content-muted">
            Pick a new owner. Choose <span className="font-medium">Unassign</span> to clear ownership. Archived rows are skipped.
          </p>
          <div>
            <label htmlFor="bulk-reassign-target" className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Assign to
            </label>
            {usersQuery.isLoading ? (
              <Skeleton className="h-8 w-full rounded" />
            ) : usersQuery.isError ? (
              <p className="text-sm text-data-negative">Couldn't load users — try closing and re-opening this dialog.</p>
            ) : (
              <select
                id="bulk-reassign-target"
                value={reassignTargetId}
                onChange={(e) => setReassignTargetId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
              >
                <option value="">— Unassign —</option>
                {(usersQuery.data || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}{u.role ? ` · ${u.role}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </Modal>

      {/* Bulk stage transition — pick a target stage. The validator on
          the backend rejects per-deal incompatible transitions; the
          aggregated result lands in the toast. */}
      <Modal
        open={stageModalOpen}
        onClose={() => { if (!bulkBusy) setStageModalOpen(false); }}
        title={`Move ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'} to a new stage`}
        size="md"
        closeOnOverlayClick={!bulkBusy}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setStageModalOpen(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmStage}
              loading={bulkTransition.isPending}
              disabled={bulkBusy || !stageTarget}
              leftIcon={<ArrowRight size={13} />}
            >
              {bulkTransition.isPending ? 'Moving…' : `Move ${selectedIds.size}`}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-xs text-content-muted">
            Each selected deal moves to the chosen target stage. Deals whose current stage doesn't permit this transition are skipped — the toast summarises succeeded vs skipped counts.
          </p>
          <div>
            <label htmlFor="bulk-stage-target" className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Target stage
            </label>
            <select
              id="bulk-stage-target"
              value={stageTarget}
              onChange={(e) => setStageTarget(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
            >
              <option value="">— Select target stage —</option>
              {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bulk-stage-notes" className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Notes <span className="text-content-muted normal-case tracking-normal">(optional, applied to all)</span>
            </label>
            <textarea
              id="bulk-stage-notes"
              value={stageNotes}
              onChange={(e) => setStageNotes(e.target.value)}
              rows={2}
              placeholder="Why is this stage transition happening?"
              maxLength={1000}
              className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
            />
          </div>
        </div>
      </Modal>

      {/* Bulk delete — type-DELETE-to-confirm. Most destructive
          surface we expose; the friction gate is deliberate. The
          confirm input is autoFocused so the keyboard flow is just
          tab → type → Enter. */}
      <Modal
        open={deleteModalOpen}
        onClose={() => { if (!bulkBusy) setDeleteModalOpen(false); }}
        title={(
          <span className="inline-flex items-center gap-2 text-data-negative">
            <Trash2 size={15} className="text-data-negative" />
            Delete {selectedIds.size} deal{selectedIds.size === 1 ? '' : 's'}
          </span>
        )}
        size="md"
        closeOnOverlayClick={!bulkBusy}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteModalOpen(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              loading={bulkDelete.isPending}
              disabled={bulkBusy || !deleteConfirmReady}
              leftIcon={<Trash2 size={13} />}
            >
              {bulkDelete.isPending ? 'Deleting…' : `Delete ${selectedIds.size}`}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <div className="rounded-md border border-hairline bg-neg-soft px-3 py-2.5 text-xs text-data-negative">
            <p className="font-medium">This is irreversible.</p>
            <p className="mt-1">
              Each deal's documents, financials, scenarios, audit events, and DD/risk records will be hard-deleted along with the deal itself. To remove deals from active views without deleting them, use <span className="font-semibold">Archive</span> instead.
            </p>
          </div>
          <div>
            <label htmlFor="bulk-delete-confirm" className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Type <span className="font-mono text-data-negative">DELETE</span> to confirm
            </label>
            <input
              id="bulk-delete-confirm"
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && deleteConfirmReady) handleConfirmDelete();
              }}
              autoFocus
              placeholder="DELETE"
              className="w-full px-2.5 py-1.5 text-sm font-mono border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-data-negative"
            />
          </div>
        </div>
      </Modal>

      {/* New Deal Modal */}
      <Modal
        open={showModal}
        onClose={handleCloseModal}
        title="New Deal"
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button type="submit" form="new-deal-form" variant="primary" loading={createDeal.isPending}>
              {createDeal.isPending ? 'Creating…' : 'Create Deal'}
            </Button>
          </>
        )}
      >
        <form id="new-deal-form" onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-content-secondary">Property</label>
                  {propertyMode === 'pick' ? (
                    <button
                      type="button"
                      onClick={() => setPropertyMode('capture')}
                      className="text-xs text-accent hover:text-accent-hover font-medium transition-colors duration-150 ease-out"
                    >
                      + Create new (paste link / Plus Code / address)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPropertyMode('pick')}
                      className="text-xs text-content-muted hover:text-content-secondary"
                    >
                      ← Pick existing instead
                    </button>
                  )}
                </div>

                {propertyMode === 'pick' ? (
                  <>
                    <select
                      name="propertyId"
                      aria-label="Property"
                      value={form.propertyId}
                      onChange={handleFormChange}
                      className="input w-full"
                    >
                      <option value="">Add later / source first</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {(p.display_name || p.name || 'Untitled property')}
                          {p.city ? ` - ${p.city}` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-content-secondary">
                      You can create the deal now and link a property later if sourcing data is still incomplete.
                    </p>
                    {selectedProperty && (
                      <div className="mt-2 rounded-lg bg-bg-secondary px-3 py-2 text-xs text-content-secondary">
                        {PROPERTY_TYPE_LABELS[selectedProperty.property_type] || selectedProperty.property_type || 'Property'} in {selectedProperty.city || 'unknown city'}
                        {selectedProperty.land_area_sqft ? ` · ${Number(selectedProperty.land_area_sqft).toLocaleString('en-IN')} sqft` : ''}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-lg border border-hairline bg-accent-soft p-3">
                    <Suspense fallback={<div className="h-40 redip-skeleton rounded-lg" />}>
                      <PropertyCaptureField
                        onSaved={handlePropertyCaptured}
                        onCancel={() => setPropertyMode('pick')}
                        compact
                      />
                    </Suspense>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-content-secondary mb-1">Deal Name *</label>
                <input
                  type="text"
                  name="name"
                  aria-label="Deal name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                  placeholder="e.g. Whitefield JV Phase 1"
                  className="input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">Type</label>
                  <select name="dealType" aria-label="Deal type" value={form.dealType} onChange={handleFormChange} className="input w-full">
                    {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">Stage</label>
                  <select name="stage" aria-label="Stage" value={form.stage} onChange={handleFormChange} className="input w-full">
                    {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">Priority</label>
                  <select name="priority" aria-label="Priority" value={form.priority} onChange={handleFormChange} className="input w-full">
                    {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">Asset Class</label>
                  <select name="assetClass" aria-label="Asset class" value={form.assetClass} onChange={handleFormChange} className="input w-full">
                    {/* PR-NX59: render directly from the shared
                        ASSET_CLASS_CONFIG so future ontology updates land
                        in one place. */}
                    {ASSET_CLASS_CONFIG.map((ac) => (
                      <option key={ac.value} value={ac.value}>{ac.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm font-medium text-content-secondary mb-1">Deal Structure</label>
                  <select name="dealStructure" aria-label="Deal structure" value={form.dealStructure} onChange={handleFormChange} className="input w-full">
                    {/* PR-NX59: render directly from the shared
                        DEAL_STRUCTURE_CONFIG so the create form, edit form,
                        and list chips stay in lock-step. */}
                    {DEAL_STRUCTURE_CONFIG.map((ds) => (
                      <option key={ds.value} value={ds.value}>{ds.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Structurally-incoherent (assetClass, dealStructure) pairs are
                  surfaced inline so the user sees WHY a combination is blocked
                  and what to pick instead. The matrix is the single source of
                  truth — see frontend/src/utils/dealStructureMatrix.js. */}
              {(() => {
                const v = isValidStructurePair(form.assetClass, form.dealStructure);
                if (v.valid) return null;
                return (
                  <div
                    role="alert"
                    className="rounded-md border border-hairline bg-premium-soft px-3 py-2 text-sm text-premium"
                  >
                    <span className="font-medium">Incoherent pair:</span> {v.reason}
                  </div>
                );
              })()}

              <LandPricingFields
                values={form}
                onFieldChange={(name, value) => handleFormChange({ target: { name, value } })}
                fallbackAreaSqft={selectedProperty?.land_area_sqft ?? null}
                hasLinkedProperty={Boolean(form.propertyId)}
              />

              <div>
                <label className="block text-sm font-medium text-content-secondary mb-1">Notes</label>
                <textarea
                  name="notes"
                  aria-label="Notes"
                  value={form.notes}
                  onChange={handleFormChange}
                  rows={3}
                  placeholder="Any initial notes..."
                  className="input w-full"
                />
              </div>

        </form>
      </Modal>
    </div>
  );
}
