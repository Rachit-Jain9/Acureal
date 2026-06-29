import { useState, useEffect, Suspense, lazy } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Edit2, Trash2, ArrowRight, ChevronDown, ChevronUp, Share2 } from 'lucide-react';
import {
  useTransitionStage,
  useDeleteDeal,
  useUpdateDeal,
  useDealPeek,
} from '../hooks/useDeals';
import { DealContextProvider, useDealWorkspaceWithLite } from '../hooks/useDealContext';
import { useCanEdit } from '../hooks/useCanEdit';
import useAuthStore from '../store/authStore';
import { roleSatisfies } from '../utils/roles';
import Badge from '../components/common/Badge';
import AmountReadout from '../components/common/AmountReadout';
import { handleNumericPaste } from '../components/common/numericPaste';
import {
  Skeleton, SkeletonKpi, SkeletonCard,
  Button, Modal, Tabs, Field, Input, Select, Textarea,
} from '../design-system';
import ExportMenu from '../components/deal/ExportMenu';
import { recordRecentDeal } from '../components/common/CommandPalette';
import {
  STAGE_CONFIG,
  STAGE_TRANSITIONS,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
} from '../utils/format';
// Shared taxonomy source — values match exactly what the create form in
// DealsPage renders, so a deal edited here can never carry a structure or
// asset-class label that mismatches what was offered at creation.
import { ASSET_CLASS_LABELS } from '../utils/assetClasses';
import { DEAL_STRUCTURE_LABELS } from '../utils/dealStructures';
import { isValidPair as isValidStructurePair } from '../utils/dealStructureMatrix';

// Tab components — OverviewTab stays eager (landing tab on every page load);
// the other nine tabs are lazy so the heavy chart / map / waterfall surfaces
// only download when the operator actually clicks into them.
import OverviewTab from '../components/deal/OverviewTab';
const ParcelTab    = lazy(() => import('../components/deal/ParcelTab'));
const YieldStudioTab = lazy(() => import('../components/deal/YieldStudioTab'));
const DocumentsTab = lazy(() => import('../components/deal/DocumentsTab'));
const ActivityTab  = lazy(() => import('../components/deal/ActivityTab'));
const FinancialTab = lazy(() => import('../components/deal/FinancialTab'));
const DDTab        = lazy(() => import('../components/deal/DDTab'));
const RiskTab      = lazy(() => import('../components/deal/RiskTab'));
const CompsTab     = lazy(() => import('../components/deal/CompsTab'));
const ZoningTab    = lazy(() => import('../components/deal/ZoningTab'));
const AuditTab     = lazy(() => import('../components/deal/AuditTab'));
import ShareDealPanel from '../components/deal/ShareDealPanel';
import DealWorkspaceTour from '../components/onboarding/DealWorkspaceTour';

// Suspense fallback for lazy tabs — a quiet two-line skeleton so the layout
// doesn't jump when the user clicks a tab. Bounded; the next tab download
// is a single ~50–200KB chunk so the visible loading state is brief.
const TabSuspenseFallback = () => (
  <div className="space-y-2 py-6" role="status" aria-live="polite">
    <div className="redip-skeleton h-3 w-3/4 rounded-sm" />
    <div className="redip-skeleton h-3 w-1/2 rounded-sm" />
  </div>
);

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'parcel',     label: 'Parcel / Site' },
  { id: 'site',       label: 'Yield Studio' },
  { id: 'zoning',     label: 'Regulatory / Zoning' },
  { id: 'documents',  label: 'Documents' },
  { id: 'activity',   label: 'Activity' },
  { id: 'financial',  label: 'Financial' },
  { id: 'dd',         label: 'DD & Approvals' },
  { id: 'risk',       label: 'Risk' },
  { id: 'comps',      label: 'Market / Comps' },
  { id: 'audit',      label: 'Audit' },
];

const buildEditForm = (deal) => ({
  name:               deal.name || '',
  dealType:           deal.deal_type || 'acquisition',
  dealStructure:      deal.deal_structure || '',
  assetClass:         deal.asset_class || '',
  priority:           deal.priority || 'medium',
  landAskPriceCr:     deal.land_ask_price_cr ?? '',
  negotiatedPriceCr:  deal.negotiated_price_cr ?? '',
  targetLaunchDate:   deal.target_launch_date ? deal.target_launch_date.slice(0, 10) : '',
  expectedCloseDate:  deal.expected_close_date ? deal.expected_close_date.slice(0, 10) : '',
  reraNumber:         deal.rera_number || '',
  notes:              deal.notes || '',
});

const buildEditPayload = (form) => ({
  name:               form.name.trim(),
  dealType:           form.dealType,
  dealStructure:      form.dealStructure || undefined,
  assetClass:         form.assetClass || undefined,
  priority:           form.priority,
  landAskPriceCr:     form.landAskPriceCr === '' ? undefined : Number(form.landAskPriceCr),
  negotiatedPriceCr:  form.negotiatedPriceCr === '' ? undefined : Number(form.negotiatedPriceCr),
  targetLaunchDate:   form.targetLaunchDate || undefined,
  expectedCloseDate:  form.expectedCloseDate || undefined,
  reraNumber:         form.reraNumber.trim() || undefined,
  notes:              form.notes.trim() || undefined,
});

// ── Header identity, factored out so the same markup paints in the loading
// skeleton (from a cached "peek") and in the fully-loaded header — no drift,
// no layout jump when the workspace lands. Presentational only; no hooks.
function DealHeaderIdentity({ deal }) {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-bold text-content-primary truncate">{deal.name}</h1>
      <p className="text-sm text-content-secondary mt-0.5">
        {DEAL_TYPE_LABELS[deal.deal_type] || deal.deal_type || ''}
        {deal.asset_class && (
          <> · {ASSET_CLASS_LABELS[deal.asset_class] || deal.asset_class}</>
        )}
        {deal.deal_structure && (
          <> · {DEAL_STRUCTURE_LABELS[deal.deal_structure] || deal.deal_structure}</>
        )}
        {(deal.city || deal.state) && (
          <> · {[deal.city, deal.state].filter(Boolean).join(', ')}</>
        )}
      </p>
    </div>
  );
}

function DealStageBadges({ deal }) {
  const stageCfg    = STAGE_CONFIG[deal.stage]       || STAGE_CONFIG.screening;
  const priorityCfg = PRIORITY_CONFIG[deal.priority] || PRIORITY_CONFIG.medium;
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      <Badge tone={stageCfg.tone}>{stageCfg.label}</Badge>
      <Badge tone={priorityCfg.tone}>{priorityCfg.label} Priority</Badge>
      {deal.assigned_to_name && (
        <span className="text-sm text-content-muted">Assigned to {deal.assigned_to_name}</span>
      )}
    </div>
  );
}

export default function DealDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);

  // Two-phase workspace read: the deterministic deal paints in ~1-2s while the
  // ~10s AI narration loads in the background and upgrades the recommendation +
  // deal-doctor card prose in place. Shared key with the DealContextProvider
  // below (which the tabs read), so there is no double fetch.
  const { workspace, isLoading, isError } = useDealWorkspaceWithLite(id);
  // Cache-only identity for an instant header paint while the workspace loads.
  // Warm when the user clicked through from the deals list; null on a cold
  // deep-link (page then shows its full skeleton). Never fires a request.
  const peek = useDealPeek(id);
  const deal = workspace?.deal;

  // Drop the freshly-visited deal into the Cmd-K palette's "Recent deals"
  // list so the next press of ⌘K offers it on top. The palette persists
  // the list in localStorage; deduping is handled inside recordRecentDeal.
  useEffect(() => {
    if (deal?.id) recordRecentDeal(deal);
  }, [deal?.id, deal?.name, deal?.city, deal?.stage]);
  const transitionStage = useTransitionStage();
  const deleteDeal = useDeleteDeal();
  const updateDeal = useUpdateDeal();

  const activeTab = searchParams.get('tab') || 'overview';

  const [stageNotes, setStageNotes] = useState('');
  const [stageExpanded, setStageExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [showSharePanel, setShowSharePanel] = useState(false);

  const isAdmin = roleSatisfies(user?.role, ['admin']);
  const canEdit = useCanEdit();

  const setTab = (tabId) => setSearchParams({ tab: tabId });
  const updateField = (key, value) => setEditForm((f) => ({ ...f, [key]: value }));

  const handleStageTransition = async (newStage) => {
    try {
      await transitionStage.mutateAsync({ id, stage: newStage, notes: stageNotes });
      setStageNotes('');
      setStageExpanded(false);
      if (newStage === 'dead') {
        navigate('/dashboard/deals');
      }
    } catch {
      // Mutation hook handles the toast
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDeal.mutateAsync(id);
      navigate('/dashboard/deals');
    } catch {
      // Mutation hook handles the toast
    }
  };

  const handleEditOpen = () => {
    if (!deal) return;
    setEditForm(buildEditForm(deal));
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editForm) return;
    try {
      await updateDeal.mutateAsync({ id, data: buildEditPayload(editForm) });
      setShowEditModal(false);
    } catch {
      // Mutation hook handles the toast
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────
  // Mirrors the deal workspace shape so the layout doesn't reflow when data lands.
  if (isLoading) {
    return (
      <div aria-busy="true">
        {/* Back button is real even while loading — it needs no deal data. */}
        <button
          onClick={() => navigate('/dashboard/deals')}
          className="inline-flex items-center gap-1 text-sm text-content-secondary mb-4 rounded
            transition-colors duration-150 ease-out hover:text-content-primary
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ArrowLeft size={15} /> Back to Deals
        </button>

        {peek ? (
          // Real identity from cache — the user sees the deal's name and stage
          // the instant they land, while KPIs / tabs / body fill in below.
          <>
            <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
              <DealHeaderIdentity deal={peek} />
              <div className="flex items-center gap-2 flex-shrink-0">
                <Skeleton className="h-9 w-24 rounded-md" />
                <Skeleton className="h-9 w-20 rounded-md" />
              </div>
            </div>
            <DealStageBadges deal={peek} />
          </>
        ) : (
          <div className="bg-bg-elevated border border-hairline rounded-editorial p-5 mb-4">
            <Skeleton className="h-3 w-24 mb-2" />
            <Skeleton className="h-7 w-2/3 mb-3" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-md" />
          ))}
        </div>
        <SkeletonCard height="h-96" />
      </div>
    );
  }

  if (isError || !deal) {
    return (
      <div className="text-center py-24">
        <p className="text-data-negative mb-4 text-sm">Failed to load deal details.</p>
        <Button variant="secondary" onClick={() => navigate('/dashboard/deals')}>
          Back to Deals
        </Button>
      </div>
    );
  }

  const stageCfg    = STAGE_CONFIG[deal.stage]       || STAGE_CONFIG.screening;
  const nextStages  = STAGE_TRANSITIONS[deal.stage]  || [];

  // DealContextProvider lets descendant tabs read deal data via useDealContext()
  // instead of prop-drilling; it internally re-uses the same workspace query
  // key, so this adds one render and zero extra network calls.
  return (
    <DealContextProvider dealId={id}>
      <div>
        <button
          onClick={() => navigate('/dashboard/deals')}
          className="inline-flex items-center gap-1 text-sm text-content-secondary mb-4 rounded
            transition-colors duration-150 ease-out hover:text-content-primary
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ArrowLeft size={15} /> Back to Deals
        </button>

        {/* Deal header */}
        <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
          <DealHeaderIdentity deal={deal} />

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {canEdit && <ExportMenu dealId={id} dealName={deal.name} />}
            <Button
              variant="secondary"
              leftIcon={<Share2 size={14} />}
              onClick={() => setShowSharePanel(true)}
            >
              Share
            </Button>
            {canEdit && (
              <Button variant="secondary" leftIcon={<Edit2 size={14} />} onClick={handleEditOpen}>
                Edit
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                leftIcon={<Trash2 size={14} />}
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Badge row */}
        <DealStageBadges deal={deal} />

        {/* Stage transition panel (collapsible, above the tabs) */}
        {nextStages.length > 0 && canEdit && (
          <div className="card-editorial mb-5 p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setStageExpanded((v) => !v)}
              aria-expanded={stageExpanded}
              className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors
                hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:bg-bg-secondary active:scale-[0.99]"
            >
              <div className="flex items-center gap-2">
                <ArrowRight size={15} className="text-content-muted" />
                <span className="text-sm font-medium text-content-secondary">Stage Transition</span>
                <span className="text-xs text-content-muted">
                  Currently: <strong className="font-semibold text-content-primary">{stageCfg.label}</strong>
                </span>
              </div>
              {stageExpanded
                ? <ChevronUp size={15} className="text-content-muted" />
                : <ChevronDown size={15} className="text-content-muted" />}
            </button>
            {stageExpanded && (
              <div className="border-t border-hairline px-4 py-4 space-y-3">
                <Textarea
                  value={stageNotes}
                  onChange={(e) => setStageNotes(e.target.value)}
                  placeholder="Transition notes (optional)…"
                  rows={2}
                  aria-label="Stage transition notes"
                />
                <div className="flex flex-wrap gap-2">
                  {nextStages.map((stage) => {
                    const config = STAGE_CONFIG[stage] || STAGE_CONFIG.screening;
                    return (
                      <Button
                        key={stage}
                        variant={stage === 'dead' ? 'danger' : 'secondary'}
                        onClick={() => handleStageTransition(stage)}
                        disabled={transitionStage.isPending}
                        loading={transitionStage.isPending && transitionStage.variables?.stage === stage}
                      >
                        Move to {config.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab navigation */}
        <Tabs
          items={TABS}
          value={activeTab}
          onChange={setTab}
          ariaLabel="Deal sections"
          className="mb-6"
        />
        {/* First-time deal-workspace orientation — opens once per browser,
            replayable from Settings. Anchored to the tab buttons above. */}
        <DealWorkspaceTour />

        {/* Active tab content. All deal tabs read deal/dealId from useDealContext;
            only auxiliary parent-supplied props remain (ParcelTab.canEdit,
            ZoningTab.setTab). */}
        <div key={activeTab} role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="redip-tab-fade">
          {/* Overview is eager (landing tab); the other nine tabs lazy-load
              via React.lazy so their bundles only download on click. */}
          {activeTab === 'overview' && <OverviewTab setTab={setTab} />}
          <Suspense fallback={<TabSuspenseFallback />}>
            {activeTab === 'parcel' && <ParcelTab canEdit={canEdit} />}
            {activeTab === 'site' && <YieldStudioTab setTab={setTab} />}
            {activeTab === 'zoning' && <ZoningTab setTab={setTab} />}
            {activeTab === 'documents' && <DocumentsTab />}
            {activeTab === 'activity' && <ActivityTab />}
            {activeTab === 'financial' && <FinancialTab />}
            {activeTab === 'dd' && <DDTab />}
            {activeTab === 'risk' && <RiskTab />}
            {activeTab === 'comps' && <CompsTab />}
            {activeTab === 'audit' && <AuditTab />}
          </Suspense>
        </div>

        {/* ── Edit deal modal ──────────────────────────────────────────────── */}
        <Modal
          open={showEditModal}
          onClose={() => setShowEditModal(false)}
          title="Edit deal"
          size="lg"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setShowEditModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                form="edit-deal-form"
                loading={updateDeal.isPending}
              >
                Save changes
              </Button>
            </>
          )}
        >
          {editForm && (
            <form id="edit-deal-form" onSubmit={handleEditSubmit} className="space-y-4">
              <Field label="Deal name" required>
                <Input
                  value={editForm.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  required
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Deal type">
                  <Select
                    value={editForm.dealType}
                    onChange={(e) => updateField('dealType', e.target.value)}
                  >
                    {Object.entries(DEAL_TYPE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Deal structure">
                  <Select
                    value={editForm.dealStructure}
                    onChange={(e) => updateField('dealStructure', e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {Object.entries(DEAL_STRUCTURE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Asset class">
                  <Select
                    value={editForm.assetClass}
                    onChange={(e) => updateField('assetClass', e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {Object.entries(ASSET_CLASS_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {(() => {
                const v = isValidStructurePair(editForm.assetClass, editForm.dealStructure);
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Priority">
                  <Select
                    value={editForm.priority}
                    onChange={(e) => updateField('priority', e.target.value)}
                  >
                    {Object.entries(PRIORITY_CONFIG).map(([v, cfg]) => (
                      <option key={v} value={v}>{cfg.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="RERA number">
                  <Input
                    value={editForm.reraNumber}
                    onChange={(e) => updateField('reraNumber', e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Field label="Land ask price (₹ Cr)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.landAskPriceCr}
                      onChange={(e) => updateField('landAskPriceCr', e.target.value)}
                      onPaste={(e) => handleNumericPaste(e, 'rupeeCrore', (v) => updateField('landAskPriceCr', v))}
                      placeholder="Optional"
                    />
                  </Field>
                  <AmountReadout value={editForm.landAskPriceCr} kind="rupeeCrore" />
                </div>
                <div>
                  <Field label="Negotiated price (₹ Cr)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.negotiatedPriceCr}
                      onChange={(e) => updateField('negotiatedPriceCr', e.target.value)}
                      onPaste={(e) => handleNumericPaste(e, 'rupeeCrore', (v) => updateField('negotiatedPriceCr', v))}
                      placeholder="Optional"
                    />
                  </Field>
                  <AmountReadout value={editForm.negotiatedPriceCr} kind="rupeeCrore" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Target launch date">
                  <Input
                    type="date"
                    value={editForm.targetLaunchDate}
                    onChange={(e) => updateField('targetLaunchDate', e.target.value)}
                  />
                </Field>
                <Field label="Expected close date">
                  <Input
                    type="date"
                    value={editForm.expectedCloseDate}
                    onChange={(e) => updateField('expectedCloseDate', e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Notes">
                <Textarea
                  rows={4}
                  value={editForm.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                  placeholder="Internal notes, context, or instructions…"
                />
              </Field>
            </form>
          )}
        </Modal>

        {/* ── Delete confirmation modal ────────────────────────────────────── */}
        <Modal
          open={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          title="Delete deal"
          size="sm"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete} loading={deleteDeal.isPending}>
                Delete permanently
              </Button>
            </>
          )}
        >
          <p className="text-sm text-content-secondary">
            This permanently deletes the deal and all of its associated data — documents,
            diligence items, risks, financials and activity. This cannot be undone.
          </p>
        </Modal>

        {/* ── Share panel ──────────────────────────────────────────────────── */}
        {showSharePanel && (
          <ShareDealPanel
            dealId={id}
            dealName={deal.name}
            isOwner={deal.created_by === user?.id}
            onClose={() => setShowSharePanel(false)}
          />
        )}
      </div>
    </DealContextProvider>
  );
}
