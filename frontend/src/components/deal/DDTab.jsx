import { useState } from 'react';
import EmptyState from '../common/EmptyState';
import EvidenceBadge from '../common/EvidenceBadge';
// PR-NX72 (2026-05-19) — Phase A1.1: DDTab read path migrated to the shared
// workspace cache via useDealDDItems + useDealDDScore selectors. Mutations
// stay on the per-domain hooks but already invalidate `['deal-workspace', dealId]`
// so the cache refreshes automatically.
import { useDealContext, useDealDDItems, useDealDDScore } from '../../hooks/useDealContext';
import {
  ClipboardList,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Stamp,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  // PR-NX72: useDDItems + useDDScore dropped — items + score now read
  // from the shared workspace cache via useDealDDItems / useDealDDScore above.
  useCreateDDItem,
  useUpdateDDItem,
  useUpdateDDItemStatus,
  useDeleteDDItem,
  useSeedDDChecklist,
} from '../../hooks/useDDItems';
import {
  useApprovals,
  useCreateApproval,
  useUpdateApproval,
  useDeleteApproval,
  useSeedApprovals,
} from '../../hooks/useApprovals';
import Badge from '../common/Badge';
import { SkeletonList, SectionHeader, confirm } from '../../design-system';
import { formatDate } from '../../utils/format';

// DD Item configs
const DD_CATEGORIES = [
  { value: 'title_ownership', label: 'Title & Ownership' },
  { value: 'land_classification', label: 'Land Classification' },
  { value: 'seller_validity', label: 'Seller Validity' },
  { value: 'statutory', label: 'Statutory' },
  { value: 'financial_commercial', label: 'Financial / Commercial' },
  { value: 'project_specific', label: 'Project Specific' },
  { value: 'physical_technical', label: 'Physical / Technical' },
];

const SEVERITY_CONFIG = {
  deal_breaker:         { label: 'Deal Breaker',         tone: 'danger' },
  buildability_blocker: { label: 'Buildability Blocker', tone: 'warn' },
  commercial_blocker:   { label: 'Commercial Blocker',   tone: 'warn' },
  secondary:            { label: 'Secondary',            tone: 'neutral' },
};

const DD_STATUS_CONFIG = {
  pending:        { label: 'Pending',     tone: 'neutral' },
  in_progress:    { label: 'In Progress', tone: 'info' },
  completed:      { label: 'Completed',   tone: 'success' },
  flagged:        { label: 'Flagged',     tone: 'danger' },
  not_applicable: { label: 'N/A',         tone: 'neutral' },
};

// Approvals configs
const APPROVAL_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'validated', label: 'Validated' },
  { value: 'issue', label: 'Issue / Rework' },
  { value: 'expired', label: 'Expired' },
];

const APPROVAL_TYPE_OPTIONS = [
  { value: 'rera', label: 'RERA' },
  { value: 'planning', label: 'Planning / Zoning' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'khata', label: 'Khata' },
  { value: 'fire_noc', label: 'Fire NOC' },
  { value: 'building_plan', label: 'Building Plan' },
  { value: 'water_sewage', label: 'Water / Sewage' },
  { value: 'power', label: 'Power' },
  { value: 'airport_height', label: 'Airport Height' },
  { value: 'environment', label: 'Environment' },
  { value: 'drainage_nala', label: 'Drainage / Nala' },
  { value: 'other', label: 'Other' },
];

const buildDDForm = () => ({
  category: 'title_ownership',
  item_name: '',
  severity: 'secondary',
  description: '',
  notes: '',
});

const buildApprovalForm = () => ({
  name: '',
  approval_type: 'other',
  is_required: true,
  status: 'pending',
  is_available: false,
  is_uploaded: false,
  is_validated: false,
  issuedDate: '',
  expiryDate: '',
  referenceNumber: '',
  notes: '',
});

// ----------------------- DD Section -----------------------

function DDSection({ dealId }) {
  // PR-NX72 (2026-05-19) — Phase A1.1: DDTab now reads items + score + loading
  // state from the shared workspace cache instead of running per-domain
  // useDDItems + useDDScore queries. Mutations still invalidate
  // `['deal-workspace', dealId]` so the cache refreshes automatically.
  const { isLoading, isError, refetch } = useDealContext();
  const items = useDealDDItems();
  const scoreData = useDealDDScore();
  const createItem = useCreateDDItem();
  const updateItem = useUpdateDDItem();
  const updateStatus = useUpdateDDItemStatus();
  const deleteItem = useDeleteDDItem();
  const seedChecklist = useSeedDDChecklist();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(buildDDForm());
  const [collapsed, setCollapsed] = useState({});

  const score = scoreData?.score ?? null;
  const completed = scoreData?.completed_count ?? 0;
  const total = scoreData?.total_required ?? items.length;

  // Group by category
  const grouped = DD_CATEGORIES.reduce((acc, cat) => {
    const catItems = items.filter((i) => (i.category || 'title_ownership') === cat.value);
    if (catItems.length > 0) acc[cat.value] = catItems;
    return acc;
  }, {});

  const toggleGroup = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createItem.mutateAsync({
        dealId,
        data: {
          ...form,
          item_name: form.item_name,
        },
      });
      setForm(buildDDForm());
      setShowForm(false);
    } catch {
      // handled
    }
  };

  const handleStatusChange = (item, status) => {
    updateStatus.mutate({ dealId, id: item.id, status });
  };

  const handleDelete = async (itemId) => {
    const ok = await confirm({
      title: 'Remove this DD item?',
      tone: 'danger',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    deleteItem.mutate({ dealId, id: itemId });
  };

  if (isLoading) return <div className="py-2"><SkeletonList rows={5} columns={4} /></div>;

  if (isError) {
    return (
      <div className="text-center py-8">
        <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-2">Failed to load DD items.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <SectionHeader
        size="sm"
        icon={ClipboardList}
        title="Due Diligence Checklist"
        sub={total > 0 ? `${completed}/${total} completed` : undefined}
        action={
          <div className="flex items-center gap-2">
            {items.length === 0 && (
              <button
                onClick={() => seedChecklist.mutate({ dealId })}
                disabled={seedChecklist.isPending}
                className="btn btn-secondary text-sm flex items-center gap-1.5"
              >
                {seedChecklist.isPending && <Loader2 size={13} className="animate-spin" />}
                Seed Checklist
              </button>
            )}
            <button
              onClick={() => setShowForm((v) => !v)}
              className="btn btn-primary text-sm flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add Item
            </button>
          </div>
        }
      />

      {/* DD Score */}
      {score != null && (
        <div className="bg-bg-secondary rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-content-secondary">DD Completion Score</span>
            <span
              className={clsx(
                'text-sm font-bold',
                score >= 80 ? 'text-green-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'
              )}
            >
              {Number(score).toFixed(0)}%
            </span>
          </div>
          <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all',
                score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
              )}
              style={{ width: `${Math.min(100, score)}%` }}
            />
          </div>
        </div>
      )}

      {/* Add Item Form */}
      {showForm && (
        <div className="card-editorial border-accent-200 bg-accent-50/40">
          <h4 className="text-sm font-semibold text-content-primary mb-3">New DD Item</h4>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="input text-sm"
                >
                  {DD_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Severity</label>
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
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Item Name</label>
              <input
                type="text"
                value={form.item_name}
                onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                placeholder="e.g. Title Search – EC for 30 years"
                required
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Optional details about this item..."
                className="input text-sm"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(buildDDForm()); }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createItem.isPending}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {createItem.isPending && <Loader2 size={13} className="animate-spin" />}
                Add Item
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Grouped Items */}
      {items.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ClipboardList}
          title="No DD items yet"
          description="Seed the standard checklist or add items manually."
        />
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([catKey, catItems]) => {
            const catLabel = DD_CATEGORIES.find((c) => c.value === catKey)?.label || catKey;
            const isOpen = !collapsed[catKey];
            return (
              <div key={catKey} className="card-editorial p-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleGroup(catKey)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-bg-secondary hover:bg-bg-secondary transition-colors text-left"
                >
                  <span className="text-sm font-semibold text-content-primary">{catLabel}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-content-muted">{catItems.length} items</span>
                    {isOpen ? <ChevronDown size={14} className="text-content-muted" /> : <ChevronRight size={14} className="text-content-muted" />}
                  </div>
                </button>
                {isOpen && (
                  <ul className="divide-y divide-hairline">
                    {catItems.map((item) => {
                      const severityCfg = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.secondary;
                      const statusCfg = DD_STATUS_CONFIG[item.status] || DD_STATUS_CONFIG.pending;
                      return (
                        <li key={item.id} className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-sm font-medium text-content-primary">{item.item_name}</span>
                                <Badge tone={severityCfg.tone}>{severityCfg.label}</Badge>
                                {/* Provenance Spine: hover the chip to see the
                                    source documents / manual checks that back
                                    this item. Lazy-fetches on open. Click
                                    "Manage evidence" to attach / detach. */}
                                <EvidenceBadge
                                  ownerKind="dd_item"
                                  ownerId={item.id}
                                  ownerLabel={item.item_name}
                                  dealId={dealId}
                                  compact
                                />
                              </div>
                              {item.description && (
                                <p className="text-xs text-content-secondary mb-2">{item.description}</p>
                              )}
                              <div className="flex items-center gap-3 flex-wrap">
                                <select
                                  value={item.status}
                                  onChange={(e) => handleStatusChange(item, e.target.value)}
                                  className="text-xs rounded-full px-2 py-0.5 border border-hairline bg-bg-elevated text-content-secondary font-medium cursor-pointer focus:ring-1 focus:ring-accent"
                                >
                                  {Object.entries(DD_STATUS_CONFIG).map(([v, cfg]) => (
                                    <option key={v} value={v}>{cfg.label}</option>
                                  ))}
                                </select>
                                {item.notes && (
                                  <span className="text-xs text-content-muted italic">{item.notes}</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="p-1.5 text-content-muted hover:text-red-500 transition-colors flex-shrink-0"
                              title="Remove item"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----------------------- Approvals Section -----------------------

function ApprovalsSection({ dealId }) {
  const { data: approvalsData, isLoading, isError, refetch } = useApprovals(dealId);
  const createApproval = useCreateApproval();
  const updateApproval = useUpdateApproval();
  const deleteApproval = useDeleteApproval();
  const seedApprovals = useSeedApprovals();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(buildApprovalForm());

  const approvals = Array.isArray(approvalsData)
    ? approvalsData
    : Array.isArray(approvalsData?.data)
      ? approvalsData.data
      : [];

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createApproval.mutateAsync({
        dealId,
        data: {
          name: form.name,
          approval_type: form.approval_type,
          is_required: form.is_required,
          status: form.status,
          is_available: form.is_available,
          is_uploaded: form.is_uploaded,
          is_validated: form.is_validated,
          issuedDate: form.issuedDate || undefined,
          expiryDate: form.expiryDate || undefined,
          referenceNumber: form.referenceNumber || undefined,
          notes: form.notes || undefined,
        },
      });
      setForm(buildApprovalForm());
      setShowForm(false);
    } catch {
      // handled
    }
  };

  const handleFieldUpdate = (approval, field, value) => {
    updateApproval.mutate({
      dealId,
      id: approval.id,
      data: { ...approval, [field]: value },
    });
  };

  const handleDelete = async (approvalId) => {
    const ok = await confirm({
      title: 'Remove this approval item?',
      tone: 'danger',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    deleteApproval.mutate({ dealId, id: approvalId });
  };

  if (isLoading) return <div className="py-2"><SkeletonList rows={5} columns={4} /></div>;

  if (isError) {
    return (
      <div className="text-center py-8">
        <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-2">Failed to load approvals.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <SectionHeader
        size="sm"
        icon={Stamp}
        title="Approvals Tracker"
        action={
          <div className="flex items-center gap-2">
            {approvals.length === 0 && (
              <button
                onClick={() => seedApprovals.mutate({ dealId })}
                disabled={seedApprovals.isPending}
                className="btn btn-secondary text-sm flex items-center gap-1.5"
              >
                {seedApprovals.isPending && <Loader2 size={13} className="animate-spin" />}
                Seed Approval Checklist
              </button>
            )}
            <button
              onClick={() => setShowForm((v) => !v)}
              className="btn btn-primary text-sm flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add Item
            </button>
          </div>
        }
      />

      {/* Add Form */}
      {showForm && (
        <div className="card-editorial border-accent-200 bg-accent-50/40">
          <h4 className="text-sm font-semibold text-content-primary mb-3">New Approval Item</h4>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. RERA Registration"
                  required
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Type</label>
                <select
                  value={form.approval_type}
                  onChange={(e) => setForm((f) => ({ ...f, approval_type: e.target.value }))}
                  className="input text-sm"
                >
                  {APPROVAL_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="input text-sm"
                >
                  {APPROVAL_STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Reference Number</label>
                <input
                  type="text"
                  value={form.referenceNumber}
                  onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                  placeholder="Optional"
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Issued Date</label>
                <input
                  type="date"
                  value={form.issuedDate}
                  onChange={(e) => setForm((f) => ({ ...f, issuedDate: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                  className="input text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-content-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_required}
                  onChange={(e) => setForm((f) => ({ ...f, is_required: e.target.checked }))}
                  className="rounded text-primary-600"
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-sm text-content-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_available}
                  onChange={(e) => setForm((f) => ({ ...f, is_available: e.target.checked }))}
                  className="rounded text-primary-600"
                />
                Available
              </label>
              <label className="flex items-center gap-2 text-sm text-content-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_uploaded}
                  onChange={(e) => setForm((f) => ({ ...f, is_uploaded: e.target.checked }))}
                  className="rounded text-primary-600"
                />
                Uploaded
              </label>
              <label className="flex items-center gap-2 text-sm text-content-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_validated}
                  onChange={(e) => setForm((f) => ({ ...f, is_validated: e.target.checked }))}
                  className="rounded text-primary-600"
                />
                Validated
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="input text-sm"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(buildApprovalForm()); }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createApproval.isPending}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {createApproval.isPending && <Loader2 size={13} className="animate-spin" />}
                Add
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Approvals List */}
      {approvals.length === 0 ? (
        <EmptyState
          size="sm"
          icon={Stamp}
          title="No approval items yet"
          description="Seed the standard checklist or add items manually."
        />
      ) : (
        <div className="card-editorial p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary border-b border-hairline">
                <tr>
                  <th className="text-left text-xs font-semibold text-content-secondary px-4 py-2.5">Name</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Type</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Status</th>
                  <th className="text-center text-xs font-semibold text-content-secondary px-3 py-2.5">Req.</th>
                  <th className="text-center text-xs font-semibold text-content-secondary px-3 py-2.5">Avail.</th>
                  <th className="text-center text-xs font-semibold text-content-secondary px-3 py-2.5">Uploaded</th>
                  <th className="text-center text-xs font-semibold text-content-secondary px-3 py-2.5">Validated</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Issued</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Expiry</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {approvals.map((item) => (
                  <tr key={item.id} className="hover:bg-bg-secondary">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-content-primary">{item.name}</p>
                        {/* Provenance — same chip used on DD items. */}
                        <EvidenceBadge
                          ownerKind="approval"
                          ownerId={item.id}
                          ownerLabel={item.name}
                          dealId={dealId}
                          compact
                        />
                      </div>
                      {item.reference_number && (
                        <p className="text-xs text-content-muted">{item.reference_number}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-content-secondary capitalize text-xs">
                      {(item.approval_type || item.approvalType || '').replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={item.status}
                        onChange={(e) => handleFieldUpdate(item, 'status', e.target.value)}
                        className="text-xs bg-transparent border-0 focus:ring-0 cursor-pointer text-content-secondary p-0"
                      >
                        {APPROVAL_STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {item.is_required ? (
                        <CheckCircle2 size={14} className="text-green-500 mx-auto" />
                      ) : (
                        <span className="text-content-muted">–</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!item.is_available}
                        onChange={(e) => handleFieldUpdate(item, 'is_available', e.target.checked)}
                        className="rounded text-primary-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!item.is_uploaded}
                        onChange={(e) => handleFieldUpdate(item, 'is_uploaded', e.target.checked)}
                        className="rounded text-primary-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!item.is_validated}
                        onChange={(e) => handleFieldUpdate(item, 'is_validated', e.target.checked)}
                        className="rounded text-primary-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 text-xs text-content-secondary">
                      {formatDate(item.issued_date)}
                    </td>
                    <td className="px-3 py-3 text-xs text-content-secondary">
                      {formatDate(item.expiry_date)}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1 text-content-muted hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
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

// ----------------------- Main DDTab -----------------------

export default function DDTab() {
  const { dealId } = useDealContext();
  return (
    <div className="space-y-10">
      <DDSection dealId={dealId} />
      <div className="border-t border-hairline-strong pt-8">
        <ApprovalsSection dealId={dealId} />
      </div>
    </div>
  );
}
