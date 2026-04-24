import { useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  Presentation,
  Share2,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  useDealWorkspace,
  useTransitionStage,
  useDeleteDeal,
  useUpdateDeal,
} from '../hooks/useDeals';
import useAuthStore from '../store/authStore';
import LoadingSpinner from '../components/common/LoadingSpinner';
import Badge from '../components/common/Badge';
import { toast } from '../components/common/Toast';
import { exportsAPI } from '../services/api';
import { downloadAxiosResponse } from '../utils/download';
import {
  STAGE_CONFIG,
  STAGE_TRANSITIONS,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
} from '../utils/format';

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
import ShareDealPanel from '../components/deal/ShareDealPanel';

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
];

const DEAL_STRUCTURE_LABELS = {
  outright:       'Outright Purchase',
  jv:             'JV (Joint Venture)',
  jda:            'JDA (Dev Agreement)',
  revenue_share:  'Revenue Share',
  area_share:     'Area Share',
  profit_share:   'Profit Share',
  ground_lease:   'Ground Lease',
  hybrid:         'Hybrid',
};

const ASSET_CLASS_LABELS = {
  residential_apartments: 'Residential Apts',
  plotted_development:    'Plotted Development',
  villas:                 'Villas',
  commercial_office:      'Commercial Office',
  retail:                 'Retail',
  industrial_warehousing: 'Industrial / WH',
  hospitality:            'Hospitality',
  mixed_use:              'Mixed Use',
  raw_land:               'Raw Land',
  redevelopment:          'Redevelopment',
};

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

  // Unified workspace read — one round-trip feeds the entire deal page
  // (overview, parcel, zoning, financial, DD, risk, documents, activity).
  // Tabs that want pre-fetched slices can still call the workspace hook
  // directly; the shared query key de-dupes.
  const { data: workspace, isLoading, isError } = useDealWorkspace(id);
  const deal = workspace?.deal;
  const transitionStage = useTransitionStage();
  const deleteDeal = useDeleteDeal();
  const updateDeal = useUpdateDeal();

  const activeTab = searchParams.get('tab') || 'overview';

  const [stageNotes, setStageNotes] = useState('');
  const [stageExpanded, setStageExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const canEdit = ['owner', 'admin', 'editor'].includes(user?.role);

  const setTab = (tabId) => {
    setSearchParams({ tab: tabId });
  };

  const handleStageTransition = async (newStage) => {
    try {
      await transitionStage.mutateAsync({ id, stage: newStage, notes: stageNotes });
      setStageNotes('');
      setStageExpanded(false);
      if (newStage === 'dead') {
        navigate('/dashboard/deals');
      }
    } catch {
      // Mutation hook handles toast
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDeal.mutateAsync(id);
      navigate('/dashboard/deals');
    } catch {
      // Mutation hook handles toast
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
      // Mutation hook handles toast
    }
  };

  const handleExportPptx = async () => {
    setExportingPptx(true);
    try {
      const response = await exportsAPI.dealPptx(id);
      const safeName = (deal?.name || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      downloadAxiosResponse(response, `redip-${safeName}.pptx`);
      toast.success('PPTX deck downloaded');
    } catch (error) {
      toast.error(error.response?.data?.message || 'PPTX export failed');
    } finally {
      setExportingPptx(false);
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────
  if (isLoading) {
    return <LoadingSpinner className="py-24" />;
  }

  if (isError || !deal) {
    return (
      <div className="text-center py-24">
        <p className="text-red-600 mb-4 text-sm">Failed to load deal details.</p>
        <button onClick={() => navigate('/dashboard/deals')} className="btn btn-secondary">
          Back to Deals
        </button>
      </div>
    );
  }

  const stageCfg    = STAGE_CONFIG[deal.stage]    || STAGE_CONFIG.screening;
  const priorityCfg = PRIORITY_CONFIG[deal.priority] || PRIORITY_CONFIG.medium;
  const nextStages  = STAGE_TRANSITIONS[deal.stage] || [];

  // ── Page ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Back nav */}
      <button
        onClick={() => navigate('/dashboard/deals')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={15} /> Back to Deals
      </button>

      {/* Deal header */}
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{deal.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
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

        {/* Header action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {canEdit && (
            <button
              onClick={handleExportPptx}
              disabled={exportingPptx}
              className="btn btn-secondary flex items-center gap-1 text-sm"
            >
              {exportingPptx ? <Loader2 size={13} className="animate-spin" /> : <Presentation size={13} />}
              Export Deck
            </button>
          )}
          <button
            onClick={() => setShowSharePanel(true)}
            className="btn btn-secondary flex items-center gap-1 text-sm"
          >
            <Share2 size={13} /> Share
          </button>
          {canEdit && (
            <button
              onClick={handleEditOpen}
              className="btn btn-secondary flex items-center gap-1 text-sm"
            >
              <Edit2 size={13} /> Edit
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-1 text-sm"
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Badge row */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Badge tone={stageCfg.tone}>{stageCfg.label}</Badge>
        <Badge tone={priorityCfg.tone}>{priorityCfg.label} Priority</Badge>
        {deal.assigned_to_name && (
          <span className="text-sm text-gray-400">Assigned to {deal.assigned_to_name}</span>
        )}
      </div>

      {/* Stage Transition Panel (collapsible, always visible above tabs) */}
      {nextStages.length > 0 && canEdit && (
        <div className="card-editorial mb-5 p-0 overflow-hidden">
          <button
            type="button"
            onClick={() => setStageExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ArrowRight size={15} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Stage Transition</span>
              <span className="text-xs text-gray-400">
                Currently: <strong className="font-semibold text-content-primary">{stageCfg.label}</strong>
              </span>
            </div>
            {stageExpanded ? (
              <ChevronUp size={15} className="text-gray-400" />
            ) : (
              <ChevronDown size={15} className="text-gray-400" />
            )}
          </button>
          {stageExpanded && (
            <div className="border-t border-gray-100 px-4 py-4 space-y-3">
              <textarea
                value={stageNotes}
                onChange={(e) => setStageNotes(e.target.value)}
                placeholder="Transition notes (optional)..."
                rows={2}
                className="input text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {nextStages.map((stage) => {
                  const config = STAGE_CONFIG[stage] || STAGE_CONFIG.screening;
                  return (
                    <button
                      key={stage}
                      onClick={() => handleStageTransition(stage)}
                      disabled={transitionStage.isPending}
                      className={clsx(
                        'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50',
                        stage === 'dead'
                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                          : 'bg-primary-50 text-primary-700 hover:bg-primary-100'
                      )}
                    >
                      Move to {config.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab navigation */}
      <div
        className="mb-6 overflow-x-auto"
        style={{ borderBottom: '1px solid var(--color-border-primary)' }}
      >
        <nav className="flex gap-0 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className="px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap"
              style={{
                borderBottom: `2px solid ${
                  activeTab === tab.id ? 'var(--color-brand-accent)' : 'transparent'
                }`,
                color:
                  activeTab === tab.id
                    ? 'var(--color-brand-accent)'
                    : 'var(--color-text-muted)',
                marginBottom: '-1px',
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                  e.currentTarget.style.borderBottomColor = 'var(--color-border-strong)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                  e.currentTarget.style.borderBottomColor = 'transparent';
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Active tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab deal={deal} id={id} />}
        {activeTab === 'parcel' && <ParcelTab deal={deal} dealId={id} canEdit={canEdit} />}
        {activeTab === 'zoning' && <ZoningTab deal={deal} dealId={id} setTab={setTab} />}
        {activeTab === 'documents' && <DocumentsTab dealId={id} />}
        {activeTab === 'activity' && <ActivityTab dealId={id} />}
        {activeTab === 'financial' && <FinancialTab deal={deal} />}
        {activeTab === 'dd' && (
          <DDTab
            dealId={id}
            assetClass={deal.asset_class}
            dealStructure={deal.deal_structure}
          />
        )}
        {activeTab === 'risk' && <RiskTab dealId={id} />}
        {activeTab === 'comps' && <CompsTab deal={deal} />}
      </div>

      {/* ── Edit Modal ───────────────────────────────────────────────────── */}
      {showEditModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 py-8 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 my-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900">Edit Deal</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              {/* Deal Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Deal Name
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="input"
                  required
                />
              </div>

              {/* Type, Structure, Asset Class */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Deal Type
                  </label>
                  <select
                    value={editForm.dealType}
                    onChange={(e) => setEditForm((f) => ({ ...f, dealType: e.target.value }))}
                    className="input"
                  >
                    {Object.entries(DEAL_TYPE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Deal Structure
                  </label>
                  <select
                    value={editForm.dealStructure}
                    onChange={(e) => setEditForm((f) => ({ ...f, dealStructure: e.target.value }))}
                    className="input"
                  >
                    <option value="">— Select —</option>
                    {Object.entries(DEAL_STRUCTURE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Asset Class
                  </label>
                  <select
                    value={editForm.assetClass}
                    onChange={(e) => setEditForm((f) => ({ ...f, assetClass: e.target.value }))}
                    className="input"
                  >
                    <option value="">— Select —</option>
                    {Object.entries(ASSET_CLASS_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                    className="input"
                  >
                    {Object.entries(PRIORITY_CONFIG).map(([v, cfg]) => (
                      <option key={v} value={v}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    RERA Number
                  </label>
                  <input
                    type="text"
                    value={editForm.reraNumber}
                    onChange={(e) => setEditForm((f) => ({ ...f, reraNumber: e.target.value }))}
                    className="input"
                    placeholder="Optional"
                  />
                </div>
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Land Ask Price (₹ Cr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.landAskPriceCr}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, landAskPriceCr: e.target.value }))
                    }
                    className="input"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Negotiated Price (₹ Cr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.negotiatedPriceCr}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, negotiatedPriceCr: e.target.value }))
                    }
                    className="input"
                    placeholder="Optional"
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Target Launch Date
                  </label>
                  <input
                    type="date"
                    value={editForm.targetLaunchDate}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, targetLaunchDate: e.target.value }))
                    }
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expected Close Date
                  </label>
                  <input
                    type="date"
                    value={editForm.expectedCloseDate}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, expectedCloseDate: e.target.value }))
                    }
                    className="input"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={4}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  className="input"
                  placeholder="Internal notes, context, or instructions..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateDeal.isPending}
                  className="btn btn-primary"
                >
                  {updateDeal.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ─────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Deal</h3>
            <p className="text-sm text-gray-600 mb-5">
              This action will permanently delete this deal and its associated data. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteDeal.isPending}
                className="btn btn-danger"
              >
                {deleteDeal.isPending ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share Panel ───────────────────────────────────────────────── */}
      {showSharePanel && (
        <ShareDealPanel
          dealId={id}
          dealName={deal.name}
          isOwner={deal.created_by === user?.id}
          onClose={() => setShowSharePanel(false)}
        />
      )}

    </div>
  );
}
