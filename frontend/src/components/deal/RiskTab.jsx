import { useState } from 'react';
import { ShieldAlert, Plus, Trash2, AlertCircle, Loader2, Edit2, X, Check } from 'lucide-react';
import { clsx } from 'clsx';
import {
  useRiskFlags,
  useRiskScore,
  useCreateRiskFlag,
  useUpdateRiskFlag,
  useDeleteRiskFlag,
} from '../../hooks/useRiskFlags';
import Badge from '../common/Badge';
import LoadingSpinner from '../common/LoadingSpinner';

const RISK_CATEGORIES = [
  { value: 'title', label: 'Title' },
  { value: 'zoning', label: 'Zoning' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'financial', label: 'Financial' },
  { value: 'physical', label: 'Physical' },
  { value: 'market', label: 'Market' },
  { value: 'legal', label: 'Legal' },
];

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  high:     { label: 'High',     color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  medium:   { label: 'Medium',   color: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500' },
  low:      { label: 'Low',      color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
};

const STATUS_CONFIG = {
  open:     { label: 'Open', color: 'bg-red-50 text-red-700' },
  flagged:  { label: 'Flagged', color: 'bg-orange-100 text-orange-700' },
  mitigated:{ label: 'Mitigated', color: 'bg-green-100 text-green-700' },
  resolved: { label: 'Resolved', color: 'bg-gray-100 text-gray-600' },
};

const buildForm = () => ({
  category: 'title',
  severity: 'medium',
  title: '',
  description: '',
  mitigation: '',
  status: 'open',
});

function RiskScoreCard({ score, flagCount }) {
  const label =
    score == null
      ? null
      : score <= 30
        ? { text: 'Low Risk', color: 'text-green-600', bg: 'bg-green-500' }
        : score <= 60
          ? { text: 'Moderate Risk', color: 'text-amber-600', bg: 'bg-amber-500' }
          : { text: 'High Risk', color: 'text-red-600', bg: 'bg-red-500' };

  if (score == null && flagCount === 0) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <ShieldAlert size={16} className={label?.color || 'text-gray-400'} />
          Risk Score
        </h3>
        {label && (
          <span className={clsx('text-sm font-bold', label.color)}>
            {score} — {label.text}
          </span>
        )}
      </div>
      {score != null && (
        <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', label?.bg)}
            style={{ width: `${Math.min(100, score)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">
        {flagCount} risk flag{flagCount !== 1 ? 's' : ''} registered
      </p>
    </div>
  );
}

function RiskFlagCard({ flag, dealId, onDelete, updateFlag }) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);

  const severityCfg = SEVERITY_CONFIG[flag.severity] || SEVERITY_CONFIG.medium;
  const statusCfg = STATUS_CONFIG[flag.status] || STATUS_CONFIG.open;

  const startEdit = () => {
    setEditData({
      title: flag.title || '',
      description: flag.description || '',
      mitigation: flag.mitigation || '',
      status: flag.status || 'open',
      severity: flag.severity || 'medium',
      category: flag.category || 'title',
    });
    setEditing(true);
  };

  const handleSave = () => {
    updateFlag.mutate(
      { dealId, id: flag.id, data: editData },
      { onSuccess: () => setEditing(false) }
    );
  };

  return (
    <div className="card">
      {editing && editData ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
              <select
                value={editData.category}
                onChange={(e) => setEditData((d) => ({ ...d, category: e.target.value }))}
                className="input text-sm"
              >
                {RISK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Severity</label>
              <select
                value={editData.severity}
                onChange={(e) => setEditData((d) => ({ ...d, severity: e.target.value }))}
                className="input text-sm"
              >
                {Object.entries(SEVERITY_CONFIG).map(([v, cfg]) => (
                  <option key={v} value={v}>{cfg.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select
                value={editData.status}
                onChange={(e) => setEditData((d) => ({ ...d, status: e.target.value }))}
                className="input text-sm"
              >
                {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                  <option key={v} value={v}>{cfg.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={editData.title}
              onChange={(e) => setEditData((d) => ({ ...d, title: e.target.value }))}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={editData.description}
              onChange={(e) => setEditData((d) => ({ ...d, description: e.target.value }))}
              rows={2}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Mitigation</label>
            <textarea
              value={editData.mitigation}
              onChange={(e) => setEditData((d) => ({ ...d, mitigation: e.target.value }))}
              rows={2}
              className="input text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="btn btn-secondary text-sm flex items-center gap-1"
            >
              <X size={13} /> Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={updateFlag.isPending}
              className="btn btn-primary text-sm flex items-center gap-1.5"
            >
              {updateFlag.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={clsx('w-2 h-2 rounded-full flex-shrink-0 mt-1', severityCfg.dot)} />
              <h4 className="text-sm font-semibold text-gray-900">{flag.title}</h4>
              <Badge className={clsx('text-xs', severityCfg.color)}>{severityCfg.label}</Badge>
              <Badge className={clsx('text-xs', statusCfg.color)}>{statusCfg.label}</Badge>
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                {RISK_CATEGORIES.find((item) => item.value === flag.category)?.label || flag.category}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={startEdit}
                className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 size={13} />
              </button>
              <button
                onClick={() => onDelete(flag.id)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {flag.description && (
            <p className="text-sm text-gray-600 mb-2">{flag.description}</p>
          )}
          {flag.mitigation && (
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <p className="text-xs font-medium text-green-700 mb-0.5">Mitigation</p>
              <p className="text-sm text-green-800">{flag.mitigation}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function RiskTab({ dealId }) {
  const { data: flagsData, isLoading, isError, refetch } = useRiskFlags(dealId);
  const { data: scoreData } = useRiskScore(dealId);
  const createFlag = useCreateRiskFlag();
  const updateFlag = useUpdateRiskFlag();
  const deleteFlag = useDeleteRiskFlag();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(buildForm());

  const flags = Array.isArray(flagsData)
    ? flagsData
    : Array.isArray(flagsData?.data)
      ? flagsData.data
      : [];

  const score = scoreData?.score ?? null;

  // Group by category
  const grouped = RISK_CATEGORIES.reduce((acc, cat) => {
    const catFlags = flags.filter((f) => (f.category || 'title') === cat.value);
    if (catFlags.length > 0) acc[cat.value] = catFlags;
    return acc;
  }, {});

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createFlag.mutateAsync({ dealId, data: form });
      setForm(buildForm());
      setShowForm(false);
    } catch {
      // handled
    }
  };

  const handleDelete = (flagId) => {
    if (!window.confirm('Remove this risk flag?')) return;
    deleteFlag.mutate({ dealId, id: flagId });
  };

  if (isLoading) return <LoadingSpinner className="py-16" />;

  if (isError) {
    return (
      <div className="card text-center py-12">
        <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-3">Failed to load risk flags.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Risk Score */}
      <RiskScoreCard score={score} flagCount={flags.length} />

      {/* Add Flag */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Risk Flags</h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary text-sm flex items-center gap-1.5"
        >
          <Plus size={14} />
          Add Risk Flag
        </button>
      </div>

      {showForm && (
        <div className="card border-red-100 bg-red-50/20">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">New Risk Flag</h4>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="input text-sm"
                >
                  {RISK_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Severity</label>
                <select
                  value={form.severity}
                  onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                  className="input text-sm"
                >
                  {Object.entries(SEVERITY_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="input text-sm"
                >
                  {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Brief risk title..."
                required
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Describe the risk and its potential impact..."
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mitigation</label>
              <textarea
                value={form.mitigation}
                onChange={(e) => setForm((f) => ({ ...f, mitigation: e.target.value }))}
                rows={2}
                placeholder="How is this risk being managed or mitigated..."
                className="input text-sm"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(buildForm()); }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createFlag.isPending}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {createFlag.isPending && <Loader2 size={13} className="animate-spin" />}
                Add Risk Flag
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Flags List */}
      {flags.length === 0 ? (
        <div className="card text-center py-16">
          <ShieldAlert size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600 mb-1">No risk flags registered</p>
          <p className="text-xs text-gray-400">
            Flag title risks, zoning issues, financial exposures, and mitigation plans.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([catKey, catFlags]) => (
            <div key={catKey}>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {RISK_CATEGORIES.find((item) => item.value === catKey)?.label || catKey}
              </h4>
              <div className="space-y-3">
                {catFlags.map((flag) => (
                  <RiskFlagCard
                    key={flag.id}
                    flag={flag}
                    dealId={dealId}
                    onDelete={handleDelete}
                    updateFlag={updateFlag}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
