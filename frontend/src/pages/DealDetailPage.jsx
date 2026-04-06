import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  FileText,
  Clock,
  MapPin,
  ArrowRight,
  Plus,
  IndianRupee,
  Archive,
  RotateCcw,
  CheckCircle2,
  Brain,
  Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  useDeal,
  useTransitionStage,
  useDeleteDeal,
  useUpdateDeal,
  useArchiveDeal,
  useRestoreDeal,
} from '../hooks/useDeals';
import { useCreateActivity, useDeleteActivity, useUpdateActivityStatus } from '../hooks/useActivities';
import { intelligenceAPI } from '../services/api';
import useAuthStore from '../store/authStore';
import LoadingSpinner from '../components/common/LoadingSpinner';
import Badge from '../components/common/Badge';
import PageHeader from '../components/common/PageHeader';
import {
  formatCrores,
  formatPct,
  formatDate,
  formatRelativeTime,
  formatArea,
  STAGE_CONFIG,
  STAGE_TRANSITIONS,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  ACTIVITY_STATUS_CONFIG,
  ACTIVITY_PRIORITY_CONFIG,
} from '../utils/format';

const ACTIVITY_TYPES = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'email', label: 'Email' },
  { value: 'loi_sent', label: 'LOI Sent' },
  { value: 'offer_received', label: 'Offer Received' },
  { value: 'note', label: 'Note' },
];

const buildActivityForm = () => ({
  type: 'meeting',
  description: '',
  activityDate: new Date().toISOString().slice(0, 10),
  status: 'open',
  priority: 'medium',
});

const buildEditForm = (deal) => ({
  name: deal.name || '',
  dealType: deal.deal_type || 'acquisition',
  priority: deal.priority || 'medium',
  landAskPriceCr: deal.land_ask_price_cr ?? '',
  negotiatedPriceCr: deal.negotiated_price_cr ?? '',
  targetLaunchDate: deal.target_launch_date ? deal.target_launch_date.slice(0, 10) : '',
  expectedCloseDate: deal.expected_close_date ? deal.expected_close_date.slice(0, 10) : '',
  reraNumber: deal.rera_number || '',
  notes: deal.notes || '',
});

const buildEditPayload = (form) => ({
  name: form.name.trim(),
  dealType: form.dealType,
  priority: form.priority,
  landAskPriceCr: form.landAskPriceCr === '' ? undefined : Number(form.landAskPriceCr),
  negotiatedPriceCr: form.negotiatedPriceCr === '' ? undefined : Number(form.negotiatedPriceCr),
  targetLaunchDate: form.targetLaunchDate || undefined,
  expectedCloseDate: form.expectedCloseDate || undefined,
  reraNumber: form.reraNumber.trim() || undefined,
  notes: form.notes.trim() || undefined,
});

export default function DealDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const { data: deal, isLoading, isError } = useDeal(id);
  const transitionStage = useTransitionStage();
  const deleteDeal = useDeleteDeal();
  const updateDeal = useUpdateDeal();
  const archiveDeal = useArchiveDeal();
  const restoreDeal = useRestoreDeal();
  const createActivity = useCreateActivity();
  const completeActivity = useUpdateActivityStatus();
  const removeActivity = useDeleteActivity();

  const [stageNotes, setStageNotes] = useState('');
  const [activityForm, setActivityForm] = useState(buildActivityForm());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const isAdmin = user?.role === 'admin';
  const canEdit = user?.role === 'admin' || user?.role === 'analyst';

  const handleStageTransition = async (newStage) => {
    try {
      await transitionStage.mutateAsync({ id, stage: newStage, notes: stageNotes });
      setStageNotes('');
    } catch {
      // Mutation hook handles the toast.
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDeal.mutateAsync(id);
      navigate('/deals');
    } catch {
      // Mutation hook handles the toast.
    }
  };

  const handleArchive = async () => {
    try {
      await archiveDeal.mutateAsync({ id, reason: 'Archived from deal detail page' });
      setShowArchiveConfirm(false);
    } catch {
      // handled by mutation hook
    }
  };

  const handleRestore = async () => {
    try {
      await restoreDeal.mutateAsync(id);
    } catch {
      // handled by mutation hook
    }
  };

  const handleAiAnalysis = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await intelligenceAPI.getDealAnalysis(id);
      setAiAnalysis(res.data.data);
    } catch (err) {
      setAiError(err.response?.data?.message || 'Analysis failed. Check that ANTHROPIC_API_KEY is configured.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleActivitySubmit = async (e) => {
    e.preventDefault();

    try {
      await createActivity.mutateAsync({
        dealId: id,
        data: {
          type: activityForm.type,
          description: activityForm.description,
          activityDate: activityForm.activityDate,
          status: activityForm.status,
          priority: activityForm.priority,
        },
      });
      setActivityForm(buildActivityForm());
      setShowActivityForm(false);
    } catch {
      // Mutation hook handles the toast.
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
      await updateDeal.mutateAsync({
        id,
        data: buildEditPayload(editForm),
      });
      setShowEditModal(false);
    } catch {
      // Mutation hook handles the toast.
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-24" />;
  }

  if (isError || !deal) {
    return (
      <div className="text-center py-24">
        <p className="text-red-600 mb-4">Failed to load deal details.</p>
        <button onClick={() => navigate('/deals')} className="btn btn-secondary">
          Back to Deals
        </button>
      </div>
    );
  }

  const stageCfg = STAGE_CONFIG[deal.stage] || STAGE_CONFIG.screening;
  const priorityCfg = PRIORITY_CONFIG[deal.priority] || PRIORITY_CONFIG.medium;
  const nextStages = STAGE_TRANSITIONS[deal.stage] || [];
  const financials = deal.financials;
  const stageHistory = deal.stage_history || [];
  const recentActivities = deal.recent_activities || [];

  return (
    <div>
      <button
        onClick={() => navigate('/deals')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={16} /> Back to Deals
      </button>

      <PageHeader
        title={deal.name}
        description={DEAL_TYPE_LABELS[deal.deal_type] || deal.deal_type}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                onClick={handleEditOpen}
                className="btn btn-secondary flex items-center gap-1"
                disabled={deal.is_archived}
              >
                <Edit2 size={14} /> Edit
              </button>
            )}
            {canEdit && !deal.is_archived && (
              <button
                onClick={() => setShowArchiveConfirm(true)}
                className="btn btn-secondary flex items-center gap-1"
              >
                <Archive size={14} /> Archive
              </button>
            )}
            {canEdit && deal.is_archived && (
              <button
                onClick={handleRestore}
                className="btn btn-secondary flex items-center gap-1"
                disabled={restoreDeal.isPending}
              >
                <RotateCcw size={14} /> Restore
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="btn btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-1"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-6">
        <Badge className={stageCfg.color}>{stageCfg.label}</Badge>
        <Badge className={priorityCfg.color}>{priorityCfg.label} Priority</Badge>
        {deal.is_archived && <Badge className="bg-slate-200 text-slate-800">Archived</Badge>}
        {deal.assigned_to_name && (
          <span className="text-sm text-gray-500">Assigned to {deal.assigned_to_name}</span>
        )}
      </div>

      {/* Claude AI Analysis Panel */}
      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Brain size={18} className="text-primary-600" />
            AI Deal Analysis
            <span className="text-xs font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Claude</span>
          </h2>
          <button
            onClick={handleAiAnalysis}
            disabled={aiLoading}
            className="btn btn-primary flex items-center gap-1.5 text-sm"
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
            {aiLoading ? 'Analysing…' : aiAnalysis ? 'Refresh Analysis' : 'Generate Analysis'}
          </button>
        </div>
        {aiError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{aiError}</p>
        )}
        {aiAnalysis?.analysis && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{aiAnalysis.analysis}</p>
            <p className="text-xs text-gray-400 mt-2">
              Generated {aiAnalysis.generatedAt ? new Date(aiAnalysis.generatedAt).toLocaleString('en-IN') : ''} · Cross-referenced against internal pipeline, market benchmarks, and verified comps
            </p>
          </div>
        )}
        {!aiAnalysis && !aiLoading && !aiError && (
          <p className="mt-2 text-sm text-gray-500">
            Generate a Claude-powered IC memo cross-referencing this deal's financials against Bengaluru micro-market benchmarks and verified comps.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <MapPin size={18} className="text-gray-400" /> Property Info
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Name</span>
                <p className="font-medium text-gray-900">{deal.property_name || 'Unlinked property'}</p>
              </div>
              <div>
                <span className="text-gray-400">City</span>
                <p className="font-medium text-gray-900">{deal.city || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400">State</span>
                <p className="font-medium text-gray-900">{deal.state || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400">Land Area</span>
                <p className="font-medium text-gray-900">{formatArea(deal.land_area_sqft)}</p>
              </div>
              <div>
                <span className="text-gray-400">Zoning</span>
                <p className="font-medium text-gray-900">{deal.zoning || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400">Property Type</span>
                <p className="font-medium text-gray-900">
                  {deal.property_type ? (PROPERTY_TYPE_LABELS[deal.property_type] || deal.property_type) : '-'}
                </p>
              </div>
              {deal.property_address && (
                <div className="col-span-2 sm:col-span-3">
                  <span className="text-gray-400">Address</span>
                  <p className="font-medium text-gray-900">{deal.property_address}</p>
                </div>
              )}
              {deal.geocode_status && (
                <div>
                  <span className="text-gray-400">Map Sync</span>
                  <p className="font-medium text-gray-900">{deal.geocode_status.replace(/_/g, ' ')}</p>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <IndianRupee size={18} className="text-gray-400" /> Financial Summary
              </h2>
              {financials && (
                <Link
                  to={`/financials/${id}`}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  View Details <ArrowRight size={14} />
                </Link>
              )}
            </div>

            {financials ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Revenue</p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatCrores(financials.total_revenue_cr)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Cost</p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatCrores(financials.total_cost_cr)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Profit</p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatCrores(financials.gross_profit_cr)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">IRR</p>
                  <p
                    className={clsx(
                      'text-lg font-bold',
                      financials.irr_pct >= 20 ? 'text-green-600' : 'text-gray-900'
                    )}
                  >
                    {formatPct(financials.irr_pct)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">NPV</p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatCrores(financials.npv_cr)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Equity Multiple</p>
                  <p className="text-lg font-bold text-gray-900">
                    {financials.equity_multiple != null
                      ? `${Number(financials.equity_multiple).toFixed(2)}x`
                      : '-'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                No financial model yet.{' '}
                <Link to={`/financials/${id}`} className="text-primary-600 hover:underline">
                  Create one
                </Link>
              </p>
            )}
          </section>

          {nextStages.length > 0 && !deal.is_archived && (
            <section className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ArrowRight size={18} className="text-gray-400" /> Stage Transition
              </h2>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Transition notes (optional)"
                  value={stageNotes}
                  onChange={(e) => setStageNotes(e.target.value)}
                  className="input"
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
                          'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
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
            </section>
          )}

          {stageHistory.length > 0 && (
            <section className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Clock size={18} className="text-gray-400" /> Stage History
              </h2>
              <div className="relative">
                <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" />
                <ul className="space-y-4">
                  {stageHistory.map((entry, index) => {
                    const toConfig = STAGE_CONFIG[entry.to_stage] || STAGE_CONFIG.screening;
                    return (
                      <li key={entry.id || index} className="relative pl-8">
                        <div
                          className={clsx(
                            'absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white',
                            index === stageHistory.length - 1 ? 'bg-primary-600' : 'bg-gray-300'
                          )}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            {entry.from_stage && (
                              <>
                                <Badge className={clsx('text-xs', (STAGE_CONFIG[entry.from_stage] || STAGE_CONFIG.screening).color)}>
                                  {(STAGE_CONFIG[entry.from_stage] || STAGE_CONFIG.screening).label}
                                </Badge>
                                <ArrowRight size={12} className="text-gray-400" />
                              </>
                            )}
                            <Badge className={clsx('text-xs', toConfig.color)}>{toConfig.label}</Badge>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {entry.changed_by_name} · {formatDate(entry.changed_at)}
                          </p>
                          {entry.notes && (
                            <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="card">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Deal Details
            </h2>
            <dl className="space-y-3 text-sm">
              {deal.land_ask_price_cr && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Land Ask Price</dt>
                  <dd className="font-medium">{formatCrores(deal.land_ask_price_cr)}</dd>
                </div>
              )}
              {deal.land_pricing_basis && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Pricing Basis</dt>
                  <dd className="font-medium">
                    {deal.land_pricing_basis === 'per_acre'
                      ? 'INR / acre'
                      : deal.land_pricing_basis === 'per_sqft'
                        ? 'INR / sqft'
                        : 'Total in Cr'}
                  </dd>
                </div>
              )}
              {deal.land_price_rate_inr && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Quoted Land Rate</dt>
                  <dd className="font-medium">
                    {deal.land_pricing_basis === 'per_acre'
                      ? `${Number(deal.land_price_rate_inr).toLocaleString('en-IN')} / acre`
                      : `${Number(deal.land_price_rate_inr).toLocaleString('en-IN')} / sqft`}
                  </dd>
                </div>
              )}
              {deal.land_extent_input_value && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Pricing Extent</dt>
                  <dd className="font-medium">
                    {Number(deal.land_extent_input_value).toLocaleString('en-IN')} {deal.land_extent_input_unit || 'sqft'}
                  </dd>
                </div>
              )}
              {deal.negotiated_price_cr && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Negotiated Price</dt>
                  <dd className="font-medium">{formatCrores(deal.negotiated_price_cr)}</dd>
                </div>
              )}
              {deal.target_launch_date && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Target Launch</dt>
                  <dd className="font-medium">{formatDate(deal.target_launch_date)}</dd>
                </div>
              )}
              {deal.expected_close_date && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Expected Close</dt>
                  <dd className="font-medium">{formatDate(deal.expected_close_date)}</dd>
                </div>
              )}
              {deal.rera_number && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">RERA No.</dt>
                  <dd className="font-medium">{deal.rera_number}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-400">Created</dt>
                <dd className="font-medium">{formatDate(deal.created_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Created By</dt>
                <dd className="font-medium">{deal.created_by_name || '-'}</dd>
              </div>
            </dl>
            {deal.notes && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-line">{deal.notes}</p>
              </div>
            )}
          </section>

          <section className="card">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                <FileText size={14} /> Documents
              </h2>
              <span className="text-sm font-medium text-gray-900">{deal.document_count ?? 0}</span>
            </div>
            <Link
              to={`/documents?dealId=${id}`}
              className="text-sm text-primary-600 hover:underline"
            >
              View all documents
            </Link>
          </section>

          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Recent Activity
              </h2>
              {canEdit && (
                <button
                  onClick={() => setShowActivityForm((value) => !value)}
                  className="text-primary-600 hover:text-primary-700"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>

            {showActivityForm && (
              <form onSubmit={handleActivitySubmit} className="mb-4 space-y-2 p-3 bg-gray-50 rounded-lg">
                <select
                  value={activityForm.type}
                  onChange={(e) => setActivityForm((form) => ({ ...form, type: e.target.value }))}
                  className="input text-sm"
                >
                  {ACTIVITY_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <textarea
                  placeholder="Description..."
                  value={activityForm.description}
                  onChange={(e) => setActivityForm((form) => ({ ...form, description: e.target.value }))}
                  required
                  rows={2}
                  className="input text-sm"
                />
                <input
                  type="date"
                  value={activityForm.activityDate}
                  onChange={(e) => setActivityForm((form) => ({ ...form, activityDate: e.target.value }))}
                  className="input text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={activityForm.status}
                    onChange={(e) => setActivityForm((form) => ({ ...form, status: e.target.value }))}
                    className="input text-sm"
                  >
                    {Object.entries(ACTIVITY_STATUS_CONFIG).map(([value, cfg]) => (
                      <option key={value} value={value}>{cfg.label}</option>
                    ))}
                  </select>
                  <select
                    value={activityForm.priority}
                    onChange={(e) => setActivityForm((form) => ({ ...form, priority: e.target.value }))}
                    className="input text-sm"
                  >
                    {Object.entries(ACTIVITY_PRIORITY_CONFIG).map(([value, cfg]) => (
                      <option key={value} value={value}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowActivityForm(false);
                      setActivityForm(buildActivityForm());
                    }}
                    className="btn btn-secondary text-xs flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createActivity.isPending}
                    className="btn btn-primary text-xs flex-1"
                  >
                    {createActivity.isPending ? 'Saving...' : 'Log Activity'}
                  </button>
                </div>
              </form>
            )}

            {recentActivities.length === 0 ? (
              <p className="text-sm text-gray-400">No activities yet.</p>
            ) : (
              <ul className="space-y-3">
                {recentActivities.map((activity) => (
                  <li key={activity.id} className="text-sm border-b last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-gray-100 text-gray-600 text-xs">
                        {activity.activity_type?.replace(/_/g, ' ')}
                      </Badge>
                      {activity.status && (
                        <Badge className={(ACTIVITY_STATUS_CONFIG[activity.status] || ACTIVITY_STATUS_CONFIG.open).color}>
                          {(ACTIVITY_STATUS_CONFIG[activity.status] || ACTIVITY_STATUS_CONFIG.open).label}
                        </Badge>
                      )}
                      {activity.priority && (
                        <Badge className={(ACTIVITY_PRIORITY_CONFIG[activity.priority] || ACTIVITY_PRIORITY_CONFIG.medium).color}>
                          {(ACTIVITY_PRIORITY_CONFIG[activity.priority] || ACTIVITY_PRIORITY_CONFIG.medium).label}
                        </Badge>
                      )}
                      <span className="text-xs text-gray-400">{formatRelativeTime(activity.activity_date)}</span>
                    </div>
                    <p className="text-gray-700 mt-1">{activity.description}</p>
                    {activity.performed_by_name && (
                      <p className="text-xs text-gray-400 mt-0.5">by {activity.performed_by_name}</p>
                    )}
                    {canEdit && (
                      <div className="mt-2 flex items-center gap-2">
                        {activity.status !== 'completed' && (
                          <button
                            type="button"
                            onClick={() => completeActivity.mutate({ activityId: activity.id, status: 'completed' })}
                            className="text-xs text-emerald-700 hover:text-emerald-800"
                          >
                            <CheckCircle2 size={12} className="inline mr-1" />
                            Mark done
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeActivity.mutate(activity.id)}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {showEditModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Edit Deal</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <ArrowLeft size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deal Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((form) => ({ ...form, name: e.target.value }))}
                  className="input"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={editForm.dealType}
                    onChange={(e) => setEditForm((form) => ({ ...form, dealType: e.target.value }))}
                    className="input"
                  >
                    {Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm((form) => ({ ...form, priority: e.target.value }))}
                    className="input"
                  >
                    {Object.entries(PRIORITY_CONFIG).map(([value, config]) => (
                      <option key={value} value={value}>
                        {config.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Land Ask Price (Cr)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.landAskPriceCr}
                    onChange={(e) => setEditForm((form) => ({ ...form, landAskPriceCr: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Negotiated Price (Cr)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.negotiatedPriceCr}
                    onChange={(e) => setEditForm((form) => ({ ...form, negotiatedPriceCr: e.target.value }))}
                    className="input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Launch Date</label>
                  <input
                    type="date"
                    value={editForm.targetLaunchDate}
                    onChange={(e) => setEditForm((form) => ({ ...form, targetLaunchDate: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected Close Date</label>
                  <input
                    type="date"
                    value={editForm.expectedCloseDate}
                    onChange={(e) => setEditForm((form) => ({ ...form, expectedCloseDate: e.target.value }))}
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">RERA Number</label>
                <input
                  type="text"
                  value={editForm.reraNumber}
                  onChange={(e) => setEditForm((form) => ({ ...form, reraNumber: e.target.value }))}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={4}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((form) => ({ ...form, notes: e.target.value }))}
                  className="input"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowEditModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={updateDeal.isPending} className="btn btn-primary">
                  {updateDeal.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Deal</h3>
            <p className="text-sm text-gray-600 mb-4">
              Permanently delete <strong>{deal.name}</strong>? This is only recommended after the deal is archived or marked dead/closed.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteDeal.isPending}
                className="btn btn-danger"
              >
                {deleteDeal.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Archive Deal</h3>
            <p className="text-sm text-gray-600 mb-4">
              Archive <strong>{deal.name}</strong> to remove it from live pipeline views without losing its history, activities, or documents.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowArchiveConfirm(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiveDeal.isPending}
                className="btn btn-primary"
              >
                {archiveDeal.isPending ? 'Archiving...' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
