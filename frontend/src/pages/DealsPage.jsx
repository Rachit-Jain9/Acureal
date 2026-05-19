import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, Briefcase, ChevronLeft, ChevronRight,
  MoreVertical, Presentation, Share2, Trash2, Loader2, User, Download,
  Check, Archive, UserPlus, ArrowRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  useDeals,
  useCreateDeal,
  useDeleteDeal,
  useBulkArchiveDeals,
  useBulkReassignDeals,
  useBulkTransitionDeals,
  useBulkDeleteDeals,
} from '../hooks/useDeals';
import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';
import { useProperties } from '../hooks/useProperties';
import { useSavedDealViews } from '../hooks/useSavedDealViews';
import SavedViewsMenu from '../components/deals/SavedViewsMenu';
import useAuthStore from '../store/authStore';
import EmptyState from '../components/common/EmptyState';
import Badge from '../components/common/Badge';
import PageHeader from '../components/common/PageHeader';
import { SkeletonList, SkeletonKpi } from '../design-system';
import ShareDealPanel from '../components/deal/ShareDealPanel';
import { toast } from '../components/common/Toast';
import { exportsAPI } from '../services/api';
import { downloadAxiosResponse } from '../utils/download';
import {
  formatCrores,
  formatPct,
  formatRelativeTime,
  STAGE_CONFIG,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from '../utils/format';
import { buildLandPricingPreview } from '../utils/landPricing';
// PR-NX59 (2026-05-19) — single source of truth for taxonomies shared
// across the create form, the deals list chip column, and the deal
// detail edit form. Removes 4 duplicate copies (asset_class in DealsPage
// + DealDetailPage, deal_structure in DealsPage + DealDetailPage) and
// guarantees the create-form <option> list stays in lock-step with the
// list-chip labels. Foundation for future @redip/real-estate-ontology
// adoption (Strategic Review §VI top-1).
import { ASSET_CLASS_CONFIG, ASSET_CLASS_LABELS as SHARED_ASSET_CLASS_LABELS } from '../utils/assetClasses';
import { DEAL_STRUCTURE_CONFIG, DEAL_STRUCTURE_LABELS_COMPACT } from '../utils/dealStructures';

// Local aliases preserve readability at the existing call sites; both
// values come from the shared utility files.
const ASSET_CLASS_LABELS = SHARED_ASSET_CLASS_LABELS;
const DEAL_STRUCTURE_LABELS = DEAL_STRUCTURE_LABELS_COMPACT;

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
  const [searchParams] = useSearchParams();

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
              <button onClick={handleOpenModal} className="btn btn-primary mt-2">
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
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
                  <div className="rounded-lg bg-white px-3 py-2">
                    <p className="text-xs text-content-secondary">Normalized area</p>
                    <p className="text-sm font-semibold text-content-primary">
                      {landPricingPreview.areaSqft ? `${landPricingPreview.areaSqft.toLocaleString('en-IN')} sqft` : '-'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2">
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

function DealCard({ deal, selected = false, onToggleSelect }) {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const deleteDeal = useDeleteDeal();

  const [menuOpen, setMenuOpen] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef(null);

  const stageCfg = STAGE_CONFIG[deal.stage] || STAGE_CONFIG.screening;
  const priorityCfg = PRIORITY_CONFIG[deal.priority] || PRIORITY_CONFIG.medium;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const stopAll = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleExport = async (e) => {
    stopAll(e);
    setMenuOpen(false);
    setExporting(true);
    try {
      const response = await exportsAPI.dealPptx(deal.id);
      const safe = (deal.name || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      downloadAxiosResponse(response, `redip-${safe}.pptx`);
      toast.success('PPTX deck downloaded');
    } catch (err) {
      toast.error(err.response?.data?.message || 'PPTX export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleShare = (e) => {
    stopAll(e);
    setMenuOpen(false);
    setShowShare(true);
  };

  const handleDelete = (e) => {
    stopAll(e);
    setMenuOpen(false);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    try {
      await deleteDeal.mutateAsync(deal.id);
      setShowDeleteConfirm(false);
    } catch {
      // toast handled by hook
    }
  };

  const handleCheckboxClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleSelect?.(deal.id);
  };

  return (
    <>
      <Link
        to={`/dashboard/deals/${deal.id}`}
        className={clsx(
          'card-editorial hover:shadow-md transition-all cursor-pointer relative group',
          selected && 'ring-1 ring-accent/50 bg-accent-soft/20',
        )}
      >
        {/* Multi-select checkbox — visible on hover or when this card is
            already part of the active selection. Click stops propagation
            so it doesn't navigate to the deal detail page. Mirrors the
            comps queue pattern (PR #208). */}
        {onToggleSelect && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            aria-pressed={selected}
            aria-label={selected ? 'Deselect deal' : 'Select deal'}
            className={clsx(
              'absolute top-3 left-3 z-10 w-5 h-5 rounded border flex items-center justify-center',
              'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              selected
                ? 'bg-accent border-accent text-white opacity-100'
                : 'bg-bg-elevated border-hairline text-transparent opacity-0 group-hover:opacity-100 hover:border-accent',
            )}
          >
            {selected && <Check size={12} strokeWidth={3} />}
          </button>
        )}
        <div className={clsx('flex items-start justify-between mb-3 gap-2', selected && 'pl-7')}>
          <h3 className="font-semibold text-content-primary truncate pr-2">{deal.name}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge tone={stageCfg.tone}>{stageCfg.label}</Badge>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => { stopAll(e); setMenuOpen((v) => !v); }}
                aria-label="Deal actions"
                className="p-1 rounded hover:bg-bg-secondary text-content-secondary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-md border border-hairline-strong bg-white shadow-lg z-20"
                  onClick={stopAll}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
                  >
                    {exporting ? <Loader2 size={14} className="animate-spin" /> : <Presentation size={14} />}
                    Export Deck
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary"
                  >
                    <Share2 size={14} />
                    Share
                  </button>
                  {isAdmin && (
                    <>
                      <div className="border-t border-hairline" />
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-sm text-content-secondary mb-1">{deal.property_name || 'Unlinked property'}</p>
        <p className="text-xs text-content-muted mb-3">{deal.city}{deal.state ? `, ${deal.state}` : ''}</p>

        <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
          <div>
            <p className="text-xs text-content-muted">Land Area</p>
            <p className="font-medium text-content-primary">
              {deal.land_area_acres
                ? `${Number(deal.land_area_acres).toFixed(2)} acres`
                : deal.land_area_sqft
                  ? `${Number(deal.land_area_sqft).toLocaleString('en-IN')} sqft`
                  : 'Pending'}
            </p>
          </div>
          <div>
            <p className="text-xs text-content-muted">Headline Economics</p>
            <p className="font-medium text-content-primary">
              {deal.land_ask_price_cr ? formatCrores(deal.land_ask_price_cr) : formatCrores(deal.total_revenue_cr)}
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 mb-3">
          <Badge tone={priorityCfg.tone}>{priorityCfg.label}</Badge>
          <span className="text-xs text-content-secondary">{DEAL_TYPE_LABELS[deal.deal_type] || deal.deal_type}</span>
          {deal.asset_class && (
            <span className="text-xs text-content-secondary">
              {ASSET_CLASS_LABELS[deal.asset_class] || deal.asset_class}
            </span>
          )}
          {deal.deal_structure && (
            <span className="text-xs text-content-secondary">
              {DEAL_STRUCTURE_LABELS[deal.deal_structure] || deal.deal_structure}
            </span>
          )}
        </div>

        {Array.isArray(deal.key_risks) && deal.key_risks.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {deal.key_risks.slice(0, 2).map((risk) => (
              <span
                key={risk}
                className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
              >
                {risk}
              </span>
            ))}
            {deal.open_high_risk_count > 2 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                +{deal.open_high_risk_count - 2} more
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-sm border-t pt-3">
          <div>
            <span className="text-content-muted text-xs">IRR</span>
            <p className="font-medium">{formatPct(deal.irr_pct)}</p>
          </div>
          <div className="text-right">
            <span className="text-content-muted text-xs">Revenue</span>
            <p className="font-medium">{formatCrores(deal.total_revenue_cr)}</p>
          </div>
        </div>

        {(deal.last_activity_date || deal.updated_at) && (
          <p className="text-xs text-content-muted mt-2">
            Updated {formatRelativeTime(deal.last_activity_date || deal.updated_at)}
          </p>
        )}
      </Link>

      {showShare && (
        <ShareDealPanel
          dealId={deal.id}
          dealName={deal.name}
          isOwner={deal.created_by === user?.id}
          onClose={() => setShowShare(false)}
        />
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-content-primary mb-2">Delete Deal</h3>
            <p className="text-sm text-content-secondary mb-5">
              Permanently delete <strong>{deal.name}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteDeal.isPending}
                className="btn btn-primary bg-red-600 hover:bg-red-700 border-red-600"
              >
                {deleteDeal.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
