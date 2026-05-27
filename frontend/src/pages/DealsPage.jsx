import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, Briefcase, ChevronLeft, ChevronRight,
  Trash2, Loader2, User, Download,
  Archive, UserPlus, ArrowRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  useDeals,
  useCreateDeal,
  useBulkArchiveDeals,
  useBulkReassignDeals,
  useBulkTransitionDeals,
  useBulkDeleteDeals,
} from '../hooks/useDeals';
// Phase 4 prologue — per-deal IC + RERA readiness comes from the portfolio
// aggregator on the Dashboard backend. Same hook, same staleTime — the
// dashboard widget + the deals list cards share one cached fetch.
import { usePortfolioReadiness } from '../hooks/useDashboard';
import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';
import { useProperties } from '../hooks/useProperties';
import { useSavedDealViews } from '../hooks/useSavedDealViews';
import SavedViewsMenu from '../components/deals/SavedViewsMenu';
// DealCard was extracted from this file (2026-05-25) when DealsPage
// crossed 1,400 lines. Its full state machine (menu / share / delete /
// hover-prefetch / urgency-strip / per-deal export) lives in the
// dedicated component file now.
import DealCard from '../components/deals/DealCard';
import useAuthStore from '../store/authStore';
import EmptyState from '../components/common/EmptyState';
import Badge from '../components/common/Badge';
import PageHeader from '../components/common/PageHeader';
import { SkeletonList, SkeletonKpi } from '../design-system';
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

  const params = useMemo(() => {
    const p = { page, limit: 12 };
    if (search) p.search = search;
    if (stageFilter) p.stage = stageFilter;
    if (typeFilter) p.dealType = typeFilter;
    if (priorityFilter) p.priority = priorityFilter;
    if (assignedToMe) p.assignedToMe = true;
    return p;
  }, [search, stageFilter, typeFilter, priorityFilter, assignedToMe, page]);

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

  const { data, isLoading, isError } = useDeals(params);
  const { data: propertiesData } = useProperties({ limit: 200 });
  const createDeal = useCreateDeal();

  const deals = data?.data || [];
  const pagination = data?.pagination || { total: 0, page: 1, totalPages: 1 };

  // Phase 4 prologue — index per-deal readiness rows by deal_id so each
  // DealCard can pluck its own readiness without N+1 lookups. The
  // portfolio readiness aggregator returns ALL live deals' readiness in
  // one call; closed / dead / archived deals don't appear in that
  // response and their chips simply hide.
  const { data: portfolioReadiness } = usePortfolioReadiness();
  const readinessByDealId = useMemo(() => {
    const map = new Map();
    const all = portfolioReadiness?.deals || [];
    for (const row of all) {
      if (row && row.deal_id) map.set(row.deal_id, row);
    }
    return map;
  }, [portfolioReadiness]);

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
  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';

  useEffect(() => {
    setSelectedIds(new Set());
    setArchiveModalOpen(false);
    setReassignModalOpen(false);
    setStageModalOpen(false);
    setDeleteModalOpen(false);
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
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
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
      <div className="text-center py-24 text-red-600">
        Failed to load deals. Please try again.
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
            <button onClick={handleOpenModal} className="btn btn-primary flex items-center gap-2">
              <Plus size={16} />
              New Deal
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
          <input
            type="text"
            placeholder="Search deals, properties, cities..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-9 w-full"
          />
        </div>

        <select
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
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
          <button onClick={handleFilterReset} className="text-sm text-content-secondary hover:text-content-secondary flex items-center gap-1">
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
            !hasFilters && (
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
                readiness={readinessByDealId.get(deal.id) || null}
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
          {/* Bulk delete — admin-only. Visible only to owner/admin so
              analyst seats can't fat-finger a destructive batch op.
              The single-deal Delete on each card is also admin-gated
              (DealCard renders the menu item conditionally). */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
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

      {/* Bulk archive — optional shared reason applied to every row. */}
      {archiveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !bulkBusy && setArchiveModalOpen(false)}
        >
          <div
            className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <h3 className="font-display text-base font-semibold text-content-primary">
                Archive {selectedIds.size} deal{selectedIds.size === 1 ? '' : 's'}
              </h3>
              <button
                type="button"
                onClick={() => setArchiveModalOpen(false)}
                disabled={bulkBusy}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-content-muted">
                Archived deals are removed from active views but kept for audit. They can be restored individually from the deal detail page.
              </p>
              <div>
                <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                  Reason <span className="text-content-muted normal-case tracking-normal">(optional, applied to all)</span>
                </label>
                <textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Stalled — owner unresponsive for 6 weeks"
                  maxLength={1000}
                  className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline bg-bg-secondary/40 rounded-b-editorial">
              <button
                type="button"
                onClick={() => setArchiveModalOpen(false)}
                disabled={bulkBusy}
                className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {bulkArchive.isPending ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                {bulkArchive.isPending ? 'Archiving…' : `Archive ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk reassign — picker for the new owner. */}
      {reassignModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !bulkBusy && setReassignModalOpen(false)}
        >
          <div
            className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <h3 className="font-display text-base font-semibold text-content-primary">
                Reassign {selectedIds.size} deal{selectedIds.size === 1 ? '' : 's'}
              </h3>
              <button
                type="button"
                onClick={() => setReassignModalOpen(false)}
                disabled={bulkBusy}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-content-muted">
                Pick a new owner. Choose <span className="font-medium">Unassign</span> to clear ownership. Archived rows are skipped.
              </p>
              <div>
                <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                  Assign to
                </label>
                {usersQuery.isLoading ? (
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                ) : usersQuery.isError ? (
                  <p className="text-sm text-data-negative">Couldn't load users — try closing and re-opening this dialog.</p>
                ) : (
                  <select
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
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline bg-bg-secondary/40 rounded-b-editorial">
              <button
                type="button"
                onClick={() => setReassignModalOpen(false)}
                disabled={bulkBusy}
                className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReassign}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {bulkReassign.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                {bulkReassign.isPending
                  ? 'Reassigning…'
                  : reassignTargetId
                    ? `Reassign ${selectedIds.size}`
                    : `Unassign ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk stage transition — pick a target stage. The validator on
          the backend rejects per-deal incompatible transitions; the
          aggregated result lands in the toast. */}
      {stageModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !bulkBusy && setStageModalOpen(false)}
        >
          <div
            className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <h3 className="font-display text-base font-semibold text-content-primary">
                Move {selectedIds.size} deal{selectedIds.size === 1 ? '' : 's'} to a new stage
              </h3>
              <button
                type="button"
                onClick={() => setStageModalOpen(false)}
                disabled={bulkBusy}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-content-muted">
                Each selected deal moves to the chosen target stage. Deals whose current stage doesn't permit this transition are skipped — the toast summarises succeeded vs skipped counts.
              </p>
              <div>
                <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                  Target stage
                </label>
                <select
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
                <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                  Notes <span className="text-content-muted normal-case tracking-normal">(optional, applied to all)</span>
                </label>
                <textarea
                  value={stageNotes}
                  onChange={(e) => setStageNotes(e.target.value)}
                  rows={2}
                  placeholder="Why is this stage transition happening?"
                  maxLength={1000}
                  className="w-full px-2.5 py-1.5 text-sm border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline bg-bg-secondary/40 rounded-b-editorial">
              <button
                type="button"
                onClick={() => setStageModalOpen(false)}
                disabled={bulkBusy}
                className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStage}
                disabled={bulkBusy || !stageTarget}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {bulkTransition.isPending ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
                {bulkTransition.isPending ? 'Moving…' : `Move ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete — type-DELETE-to-confirm. Most destructive
          surface we expose; the friction gate is deliberate. The
          confirm input is autoFocused so the keyboard flow is just
          tab → type → Enter. */}
      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !bulkBusy && setDeleteModalOpen(false)}
        >
          <div
            className="bg-bg-elevated border border-hairline rounded-editorial shadow-editorial w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <h3 className="font-display text-base font-semibold text-rose-800 flex items-center gap-2">
                <Trash2 size={15} className="text-rose-600" />
                Delete {selectedIds.size} deal{selectedIds.size === 1 ? '' : 's'}
              </h3>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={bulkBusy}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
                <p className="font-medium">This is irreversible.</p>
                <p className="mt-1">
                  Each deal's documents, financials, scenarios, audit events, and DD/risk records will be hard-deleted along with the deal itself. To remove deals from active views without deleting them, use <span className="font-semibold">Archive</span> instead.
                </p>
              </div>
              <div>
                <label className="block text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                  Type <span className="font-mono text-rose-700">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deleteConfirmReady) handleConfirmDelete();
                  }}
                  autoFocus
                  placeholder="DELETE"
                  className="w-full px-2.5 py-1.5 text-sm font-mono border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-rose-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline bg-bg-secondary/40 rounded-b-editorial">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={bulkBusy}
                className="px-3 py-1.5 text-sm text-content-secondary hover:bg-bg-secondary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={bulkBusy || !deleteConfirmReady}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-rose-600 text-white rounded hover:bg-rose-700 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
              >
                {bulkDelete.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {bulkDelete.isPending ? 'Deleting…' : `Delete ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Deal Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-bg-elevated rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-hairline flex-shrink-0">
              <h2 className="text-lg font-bold text-content-primary">New Deal</h2>
              <button onClick={handleCloseModal} className="text-content-muted hover:text-content-secondary">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-content-secondary mb-1">Property</label>
                <select
                  name="propertyId"
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
              </div>

              <div>
                <label className="block text-sm font-medium text-content-secondary mb-1">Deal Name *</label>
                <input
                  type="text"
                  name="name"
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
                  <select name="dealType" value={form.dealType} onChange={handleFormChange} className="input w-full">
                    {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">Stage</label>
                  <select name="stage" value={form.stage} onChange={handleFormChange} className="input w-full">
                    {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">Priority</label>
                  <select name="priority" value={form.priority} onChange={handleFormChange} className="input w-full">
                    {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">Asset Class</label>
                  <select name="assetClass" value={form.assetClass} onChange={handleFormChange} className="input w-full">
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
                  <select name="dealStructure" value={form.dealStructure} onChange={handleFormChange} className="input w-full">
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
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  >
                    <span className="font-medium">Incoherent pair:</span> {v.reason}
                  </div>
                );
              })()}

              <div className="rounded-xl border border-hairline-strong bg-bg-secondary p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-content-primary">Land Pricing</h4>
                    <p className="text-xs text-content-secondary">Quote land cost in crore, per acre, or per sqft. REDIP will normalize the total.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-content-secondary mb-1">Pricing Basis</label>
                    <select
                      name="landPricingBasis"
                      value={form.landPricingBasis}
                      onChange={handleFormChange}
                      className="input w-full"
                    >
                      <option value="total_cr">Total in Cr</option>
                      <option value="per_sqft">INR / sqft</option>
                      <option value="per_acre">INR / acre</option>
                    </select>
                  </div>

                  {form.landPricingBasis === 'total_cr' ? (
                    <div>
                      <label className="block text-sm font-medium text-content-secondary mb-1">Total Land Price (Cr)</label>
                      <input
                        type="number"
                        name="landAskPriceCr"
                        value={form.landAskPriceCr}
                        onChange={handleFormChange}
                        step="0.01"
                        min="0"
                        placeholder="e.g. 25.50"
                        className="input w-full"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-content-secondary mb-1">
                        {form.landPricingBasis === 'per_acre' ? 'Land Rate (INR / acre)' : 'Land Rate (INR / sqft)'}
                      </label>
                      <input
                        type="number"
                        name="landPriceRateInr"
                        value={form.landPriceRateInr}
                        onChange={handleFormChange}
                        step="0.01"
                        min="0"
                        placeholder={form.landPricingBasis === 'per_acre' ? 'e.g. 250000000' : 'e.g. 12000'}
                        className="input w-full"
                      />
                    </div>
                  )}

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-content-secondary mb-1">Land Extent for Pricing</label>
                    <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                      <input
                        type="number"
                        name="landExtentInputValue"
                        value={form.landExtentInputValue}
                        onChange={handleFormChange}
                        step="0.01"
                        min="0"
                        placeholder={selectedProperty?.land_area_sqft ? 'Optional override. Blank uses linked property area.' : 'Enter the deal land extent'}
                        className="input w-full"
                      />
                      <select
                        name="landExtentInputUnit"
                        value={form.landExtentInputUnit}
                        onChange={handleFormChange}
                        className="input w-full"
                      >
                        <option value="sqft">sq ft</option>
                        <option value="acre">acre</option>
                      </select>
                    </div>
                    <p className="mt-2 text-xs text-content-secondary">
                      {selectedProperty?.land_area_sqft
                        ? `Linked property fallback area: ${Number(selectedProperty.land_area_sqft).toLocaleString('en-IN')} sqft`
                        : 'If no linked property exists yet, enter the sourcing extent here so total pricing can still be calculated.'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg bg-bg-elevated px-3 py-2">
                    <p className="text-xs text-content-secondary">Normalized area</p>
                    <p className="text-sm font-semibold text-content-primary">
                      {landPricingPreview.areaSqft ? `${landPricingPreview.areaSqft.toLocaleString('en-IN')} sqft` : '-'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-bg-elevated px-3 py-2">
                    <p className="text-xs text-content-secondary">Equivalent acres</p>
                    <p className="text-sm font-semibold text-content-primary">
                      {landPricingPreview.areaAcres ? landPricingPreview.areaAcres.toFixed(4) : '-'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-bg-primary px-3 py-2 text-white">
                    <p className="text-xs text-content-muted">Computed total land price</p>
                    <p className="text-sm font-semibold">
                      {landPricingPreview.totalPriceCr != null ? `${landPricingPreview.totalPriceCr.toFixed(2)} Cr` : '-'}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-content-secondary mb-1">Notes</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleFormChange}
                  rows={3}
                  placeholder="Any initial notes..."
                  className="input w-full"
                />
              </div>

              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-hairline flex-shrink-0 rounded-b-xl">
                <button type="button" onClick={handleCloseModal} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={createDeal.isPending} className="btn btn-primary">
                  {createDeal.isPending ? 'Creating...' : 'Create Deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
