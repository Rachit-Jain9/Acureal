import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Edit2, Trash2, ArrowRight, ChevronDown, ChevronUp, Share2 } from 'lucide-react';
import {
  useDealWorkspace,
  useTransitionStage,
  useDeleteDeal,
  useUpdateDeal,
} from '../hooks/useDeals';
import { DealContextProvider } from '../hooks/useDealContext';
import useAuthStore from '../store/authStore';
import Badge from '../components/common/Badge';
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

// Tab components
import OverviewTab from '../components/deal/OverviewTab';
import ParcelTab from '../components/deal/ParcelTab';
import DocumentsTab from '../components/deal/DocumentsTab';
import ActivityTab from '../components/deal/ActivityTab';
import FinancialTab from '../components/deal/FinancialTab';
import DDTab from '../components/deal/DDTab';
import RiskTab from '../components/deal/RiskTab';
import CompsTab from '../components/deal/CompsTab';
import ZoningTab from '../components/deal/ZoningTab';
import AuditTab from '../components/deal/AuditTab';
import ShareDealPanel from '../components/deal/ShareDealPanel';
import DealWorkspaceTour from '../components/onboarding/DealWorkspaceTour';

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'parcel',     label: 'Parcel / Site' },
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

export default function DealDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);

  // One unified workspace read feeds the whole deal page; tabs that want
  // pre-fetched slices call the workspace hook directly and the shared
  // query key de-dupes.
  const { data: workspace, isLoading, isError } = useDealWorkspace(id);
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

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const canEdit = ['owner', 'admin', 'editor'].includes(user?.role);

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
        <Skeleton className="h-4 w-28 mb-4" />
        <div className="bg-bg-elevated border border-hairline rounded-editorial p-5 mb-4">
          <Skeleton className="h-3 w-24 mb-2" />
          <Skeleton className="h-7 w-2/3 mb-3" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>
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
  const priorityCfg = PRIORITY_CONFIG[deal.priority] || PRIORITY_CONFIG.medium;
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
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <Badge tone={stageCfg.tone}>{stageCfg.label}</Badge>
          <Badge tone={priorityCfg.tone}>{priorityCfg.label} Priority</Badge>
          {deal.assigned_to_name && (
            <span className="text-sm text-content-muted">Assigned to {deal.assigned_to_name}</span>
          )}
        </div>

        {/* Stage transition panel (collapsible, above the tabs) */}
        {nextStages.length > 0 && canEdit && (
          <div className="card-editorial mb-5 p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setStageExpanded((v) => !v)}
              aria-expanded={stageExpanded}
              className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors
                hover:bg-bg-secondary focus-visible:outline-none focus-visible:bg-bg-secondary"
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
        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'parcel' && <ParcelTab canEdit={canEdit} />}
          {activeTab === 'zoning' && <ZoningTab setTab={setTab} />}
          {activeTab === 'documents' && <DocumentsTab />}
          {activeTab === 'activity' && <ActivityTab />}
          {activeTab === 'financial' && <FinancialTab />}
          {activeTab === 'dd' && <DDTab />}
          {activeTab === 'risk' && <RiskTab />}
          {activeTab === 'comps' && <CompsTab />}
          {activeTab === 'audit' && <AuditTab />}
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
                <Field label="Land ask price (₹ Cr)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.landAskPriceCr}
                    onChange={(e) => updateField('landAskPriceCr', e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Negotiated price (₹ Cr)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.negotiatedPriceCr}
                    onChange={(e) => updateField('negotiatedPriceCr', e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
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
