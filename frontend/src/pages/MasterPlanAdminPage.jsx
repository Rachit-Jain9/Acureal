import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, X, Search, Shield, CheckCircle2, XCircle, Clock, Edit3,
  FileText, AlertTriangle, Upload, FileSearch, ExternalLink, Loader2, RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import useAuthStore from '../store/authStore';
import PageHeader from '../components/common/PageHeader';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import {
  useZones,
  useMasterPlanDocuments,
  useCreateZone,
  useUpdateZone,
  useReviewZone,
  useUploadMasterPlanDocument,
  useExtractMasterPlanDocument,
  useOpenMasterPlanDocument,
} from '../hooks/useMasterPlan';

const EDITOR_ROLES = ['admin', 'owner', 'editor', 'analyst'];

const EMPTY_ZONE = {
  zone_code: '',
  zone_name: '',
  plan_version: 'RMP 2031 Draft',
  city: 'Bengaluru',
  permissible_fsi_base: '',
  permissible_fsi_max: '',
  ground_coverage_pct: '',
  building_height_max_m: '',
  road_width_min_m: '',
  permissible_uses: '',
  prohibited_uses: '',
  notes: '',
  source_page: '',
  source_section: '',
  fsi_road_width_rules: [],
  setback_rules: { front_m: '', rear_m: '', side_m: '' },
  effective_from: '',
  effective_to: '',
  review_status: 'pending',
};

const SOURCE_DOC_TYPES = [
  { value: 'rmp_table', label: 'RMP / FAR table' },
  { value: 'igr_guidance_pdf', label: 'IGR guidance PDF' },
  { value: 'guidance_value_report', label: 'Guidance report' },
  { value: 'zoning_certificate', label: 'Zoning certificate' },
];

const DOC_STATUS_META = {
  pending: { label: 'pending', color: 'bg-slate-100 text-slate-700', icon: Clock },
  in_progress: { label: 'extracting', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'queued for review', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed: { label: 'failed', color: 'bg-red-100 text-red-700', icon: XCircle },
};

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDocType(docType) {
  return SOURCE_DOC_TYPES.find((item) => item.value === docType)?.label || (docType ? docType.replace(/_/g, ' ') : 'Auto-classify');
}

function SourceStatusBadge({ status }) {
  const cfg = DOC_STATUS_META[status] || DOC_STATUS_META.pending;
  const Icon = cfg.icon;
  const spinning = status === 'in_progress';
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.color)}>
      <Icon size={11} className={spinning ? 'animate-spin' : ''} /> {cfg.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    approved: { color: 'bg-green-100 text-green-700', icon: CheckCircle2, label: 'Approved' },
    pending:  { color: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Pending review' },
    rejected: { color: 'bg-red-100 text-red-700', icon: XCircle, label: 'Rejected' },
  }[status] || { color: 'bg-bg-secondary text-content-secondary', icon: Clock, label: status || '—' };
  const Icon = cfg.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.color)}>
      <Icon size={11} /> {cfg.label}
    </span>
  );
}

function parseList(text) {
  return String(text || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function joinList(arr) {
  return Array.isArray(arr) ? arr.join(', ') : (arr || '');
}

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ZoneModal({ isOpen, onClose, zone, onSubmit, submitting }) {
  const [form, setForm] = useState(EMPTY_ZONE);

  useMemo(() => {
    if (!isOpen) return;
    if (zone) {
      setForm({
        ...EMPTY_ZONE,
        ...zone,
        permissible_uses: joinList(zone.permissible_uses),
        prohibited_uses: joinList(zone.prohibited_uses),
        fsi_road_width_rules: zone.fsi_road_width_rules || [],
        setback_rules: zone.setback_rules || { front_m: '', rear_m: '', side_m: '' },
        effective_from: zone.effective_from ? String(zone.effective_from).slice(0, 10) : '',
        effective_to:   zone.effective_to   ? String(zone.effective_to).slice(0, 10)   : '',
        source_page: zone.source_page ?? '',
        source_section: zone.source_section ?? '',
      });
    } else {
      setForm(EMPTY_ZONE);
    }
  }, [isOpen, zone?.id]);

  if (!isOpen) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSetback = (k, v) => setForm((f) => ({ ...f, setback_rules: { ...f.setback_rules, [k]: v } }));

  const addTier = () =>
    setForm((f) => ({
      ...f,
      fsi_road_width_rules: [...f.fsi_road_width_rules, { road_width_m: '', fsi: '' }],
    }));
  const updateTier = (i, k, v) =>
    setForm((f) => ({
      ...f,
      fsi_road_width_rules: f.fsi_road_width_rules.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)),
    }));
  const removeTier = (i) =>
    setForm((f) => ({
      ...f,
      fsi_road_width_rules: f.fsi_road_width_rules.filter((_, idx) => idx !== i),
    }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.zone_code.trim() || !form.zone_name.trim()) return;
    const payload = {
      zone_code: form.zone_code.trim(),
      zone_name: form.zone_name.trim(),
      plan_version: form.plan_version?.trim() || null,
      city: form.city?.trim() || 'Bengaluru',
      permissible_fsi_base: toNum(form.permissible_fsi_base),
      permissible_fsi_max:  toNum(form.permissible_fsi_max),
      ground_coverage_pct:  toNum(form.ground_coverage_pct),
      building_height_max_m: toNum(form.building_height_max_m),
      road_width_min_m:      toNum(form.road_width_min_m),
      permissible_uses: parseList(form.permissible_uses),
      prohibited_uses: parseList(form.prohibited_uses),
      notes: form.notes?.trim() || null,
      source_page: toNum(form.source_page),
      source_section: form.source_section?.trim() || null,
      fsi_road_width_rules: form.fsi_road_width_rules
        .map((r) => ({ road_width_m: toNum(r.road_width_m), fsi: toNum(r.fsi) }))
        .filter((r) => r.road_width_m != null && r.fsi != null),
      setback_rules: {
        front_m: toNum(form.setback_rules.front_m),
        rear_m:  toNum(form.setback_rules.rear_m),
        side_m:  toNum(form.setback_rules.side_m),
      },
      effective_from: form.effective_from || null,
      effective_to:   form.effective_to || null,
      review_status: form.review_status,
    };
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content-primary">
            {zone ? `Edit Zone — ${zone.zone_code}` : 'Add Zone'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary text-content-muted hover:text-content-secondary">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Zone Code *</label>
              <input className="input" required value={form.zone_code} onChange={(e) => set('zone_code', e.target.value)} placeholder="R1" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-secondary mb-1">Zone Name *</label>
              <input className="input" required value={form.zone_name} onChange={(e) => set('zone_name', e.target.value)} placeholder="Residential (Main)" />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Plan Version</label>
              <input className="input" value={form.plan_version} onChange={(e) => set('plan_version', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">City</label>
              <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Review Status</label>
              <select className="input" value={form.review_status} onChange={(e) => set('review_status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">FSI Base</label>
              <input type="number" step="0.01" className="input" value={form.permissible_fsi_base} onChange={(e) => set('permissible_fsi_base', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">FSI Max</label>
              <input type="number" step="0.01" className="input" value={form.permissible_fsi_max} onChange={(e) => set('permissible_fsi_max', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Ground Cov %</label>
              <input type="number" step="0.01" className="input" value={form.ground_coverage_pct} onChange={(e) => set('ground_coverage_pct', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Height Max (m)</label>
              <input type="number" step="0.01" className="input" value={form.building_height_max_m} onChange={(e) => set('building_height_max_m', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Road Min (m)</label>
              <input type="number" step="0.01" className="input" value={form.road_width_min_m} onChange={(e) => set('road_width_min_m', e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-content-secondary">FSI Road-Width Tiers</label>
              <button type="button" onClick={addTier} className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1">
                <Plus size={12} /> Add tier
              </button>
            </div>
            {form.fsi_road_width_rules.length === 0 ? (
              <p className="text-xs text-content-muted italic">No tiers — FSI will fall back to base value.</p>
            ) : (
              <div className="space-y-2">
                {form.fsi_road_width_rules.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr,1fr,auto] gap-2 items-center">
                    <input type="number" step="0.01" placeholder="road width ≥ (m)" className="input" value={r.road_width_m} onChange={(e) => updateTier(i, 'road_width_m', e.target.value)} />
                    <input type="number" step="0.01" placeholder="FSI" className="input" value={r.fsi} onChange={(e) => updateTier(i, 'fsi', e.target.value)} />
                    <button type="button" onClick={() => removeTier(i)} className="text-content-muted hover:text-red-500 p-1">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Setback Front (m)</label>
              <input type="number" step="0.01" className="input" value={form.setback_rules.front_m ?? ''} onChange={(e) => setSetback('front_m', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Setback Rear (m)</label>
              <input type="number" step="0.01" className="input" value={form.setback_rules.rear_m ?? ''} onChange={(e) => setSetback('rear_m', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Setback Side (m)</label>
              <input type="number" step="0.01" className="input" value={form.setback_rules.side_m ?? ''} onChange={(e) => setSetback('side_m', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Permissible Uses (comma-separated)</label>
              <input className="input" value={form.permissible_uses} onChange={(e) => set('permissible_uses', e.target.value)} placeholder="Residential, Retail, Parks" />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Prohibited Uses (comma-separated)</label>
              <input className="input" value={form.prohibited_uses} onChange={(e) => set('prohibited_uses', e.target.value)} placeholder="Industrial, Slaughterhouse" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Notes (verbatim clause text)</label>
            <textarea
              rows={4}
              className="input text-sm w-full"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Paste the verbatim zoning regulation clause from the source PDF."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Source Page</label>
              <input type="number" className="input" value={form.source_page} onChange={(e) => set('source_page', e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-content-secondary mb-1">Source Section</label>
              <input className="input" value={form.source_section} onChange={(e) => set('source_section', e.target.value)} placeholder="Part II - Zoning Regulations" />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Effective From</label>
              <input type="date" className="input" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Effective To</label>
              <input type="date" className="input" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-hairline">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-bg-secondary">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60">
              {submitting ? 'Saving…' : (zone ? 'Save changes' : 'Create zone')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ZoneLibrary({ canEdit }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(canEdit ? '' : 'approved');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingZone, setEditingZone] = useState(null);

  const params = useMemo(() => {
    const p = { limit: 200 };
    if (search) p.search = search;
    if (statusFilter) p.status = statusFilter;
    return p;
  }, [search, statusFilter]);

  const { data: zones = [], isLoading } = useZones(params);
  const createMut = useCreateZone();
  const updateMut = useUpdateZone();
  const reviewMut = useReviewZone();

  const openCreate = () => { setEditingZone(null); setModalOpen(true); };
  const openEdit = (z) => { setEditingZone(z); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditingZone(null); };

  const handleSubmit = async (payload) => {
    if (editingZone) {
      await updateMut.mutateAsync({ id: editingZone.id, data: payload });
    } else {
      await createMut.mutateAsync(payload);
    }
    closeModal();
  };

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            className="input pl-8"
            placeholder="Search zone code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canEdit && (
          <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        )}
        {canEdit && (
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700">
            <Plus size={14} /> Add Zone
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center"><LoadingSpinner /></div>
      ) : zones.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No zones found"
          description={canEdit
            ? 'Add zones manually from the RMP 2031 Zoning Regulations PDF to seed the library.'
            : 'No approved zones available yet. An analyst is curating the master plan data.'}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong text-left text-xs text-content-secondary uppercase">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Plan</th>
                <th className="py-2 pr-3">FSI</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Effective</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className="border-b border-hairline hover:bg-bg-secondary">
                  <td className="py-2 pr-3 font-semibold text-content-primary">{z.zone_code}</td>
                  <td className="py-2 pr-3 text-content-secondary">{z.zone_name}</td>
                  <td className="py-2 pr-3 text-content-secondary text-xs">{z.plan_version || '—'}</td>
                  <td className="py-2 pr-3 text-xs">
                    {z.permissible_fsi_base != null ? `${z.permissible_fsi_base}` : '—'}
                    {z.permissible_fsi_max != null ? ` – ${z.permissible_fsi_max}` : ''}
                    {Array.isArray(z.fsi_road_width_rules) && z.fsi_road_width_rules.length > 0 && (
                      <span className="ml-1 text-content-muted">({z.fsi_road_width_rules.length} tier{z.fsi_road_width_rules.length === 1 ? '' : 's'})</span>
                    )}
                  </td>
                  <td className="py-2 pr-3"><StatusBadge status={z.review_status} /></td>
                  <td className="py-2 pr-3 text-xs text-content-secondary">
                    {z.effective_from ? String(z.effective_from).slice(0, 10) : '—'}
                    {z.effective_to ? ` → ${String(z.effective_to).slice(0, 10)}` : ''}
                  </td>
                  <td className="py-2">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(z)} className="p-1.5 rounded hover:bg-bg-secondary text-content-secondary" title="Edit zone">
                          <Edit3 size={14} />
                        </button>
                        {z.review_status !== 'approved' && (
                          <button
                            onClick={() => reviewMut.mutate({ id: z.id, status: 'approved' })}
                            className="px-2 py-1 rounded text-xs bg-green-50 text-green-700 hover:bg-green-100"
                          >
                            Approve
                          </button>
                        )}
                        {z.review_status !== 'rejected' && (
                          <button
                            onClick={() => reviewMut.mutate({ id: z.id, status: 'rejected' })}
                            className="px-2 py-1 rounded text-xs bg-red-50 text-red-700 hover:bg-red-100"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ZoneModal
        isOpen={modalOpen}
        onClose={closeModal}
        zone={editingZone}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}

function DocumentsPanel({ canEdit }) {
  const { data: docs = [], isLoading, isError, refetch } = useMasterPlanDocuments();
  const uploadMut = useUploadMasterPlanDocument();
  const extractMut = useExtractMasterPlanDocument();
  const openMut = useOpenMasterPlanDocument();

  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    city: 'Bengaluru',
    planName: '',
    planVersion: 'RMP 2031 Draft',
    docType: 'rmp_table',
  });
  const [extractingId, setExtractingId] = useState(null);
  const [fileError, setFileError] = useState('');

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleFile = (event) => {
    const selected = event.target.files?.[0] || null;
    setFileError('');
    setFile(selected);
    if (!selected) return;
    const lower = selected.name.toLowerCase();
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'].some((ext) => lower.endsWith(ext));
    if (!allowed) {
      setFileError('Upload a PDF or image source file.');
      setFile(null);
      return;
    }
    if (!form.planName.trim()) {
      set('planName', selected.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) {
      setFileError('Select a source file first.');
      return;
    }
    await uploadMut.mutateAsync({
      file,
      city: form.city,
      planName: form.planName.trim() || file.name,
      planVersion: form.planVersion.trim() || null,
      docType: form.docType,
    });
    setFile(null);
  };

  const handleExtract = async (doc) => {
    setExtractingId(doc.id);
    try {
      await extractMut.mutateAsync({ id: doc.id, docType: doc.doc_type || form.docType });
    } finally {
      setExtractingId(null);
    }
  };

  if (isLoading) return <div className="py-12 flex justify-center"><LoadingSpinner /></div>;

  if (isError) {
    return (
      <div className="card-editorial text-center py-12">
        <AlertTriangle size={28} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-3">Failed to load source documents.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <form onSubmit={handleUpload} className="card-editorial border-hairline-strong bg-bg-elevated">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-content-primary">Source document intake</h3>
              <p className="mt-0.5 text-xs text-content-secondary">
                Upload official Masterplan, RMP, FAR, zoning, or guidance source files for review-backed extraction.
              </p>
            </div>
            <SourceStatusBadge status="pending" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">City</label>
              <input className="input text-sm" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Plan version</label>
              <input className="input text-sm" value={form.planVersion} onChange={(e) => set('planVersion', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Document type</label>
              <select className="input text-sm" value={form.docType} onChange={(e) => set('docType', e.target.value)}>
                {SOURCE_DOC_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Source file</label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff"
                onChange={handleFile}
                className="block w-full text-sm text-content-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium text-content-secondary mb-1">Source title</label>
            <input
              className="input text-sm"
              value={form.planName}
              onChange={(e) => set('planName', e.target.value)}
              placeholder="Volume-6 Zoning Regulations"
            />
            {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}
            {file && !fileError && (
              <p className="mt-1 text-xs text-content-muted">{file.name} | {formatBytes(file.size)}</p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3">
            <Link to="/dashboard/settings/parcel-intelligence" className="text-xs font-medium text-primary-600 hover:underline">
              Review queue
            </Link>
            <button
              type="submit"
              disabled={uploadMut.isPending || !file}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {uploadMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploadMut.isPending ? 'Uploading...' : 'Upload source'}
            </button>
          </div>
        </form>
      )}

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No master plan source documents"
          description="Upload reviewed source material to extract candidate zones, FAR rules, planning districts, and guidance values into the review queue."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-bg-elevated">
          <div className="hidden border-b border-hairline-strong px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-content-secondary md:grid md:grid-cols-[minmax(260px,1.4fr),minmax(160px,0.9fr),minmax(180px,0.9fr),minmax(150px,0.7fr)] md:gap-3">
            <div>Source</div>
            <div>Extraction</div>
            <div>Review candidates</div>
            <div className="text-right">Actions</div>
          </div>
          <div className="divide-y divide-hairline">
            {docs.map((doc) => {
              const counts = [
                ['zones', doc.zones_extracted],
                ['FAR', doc.far_rules_extracted],
                ['guidance', doc.guidance_rows_extracted],
                ['facts', doc.evidence_facts_extracted],
              ].filter(([, value]) => Number(value) > 0);
              const busy = extractingId === doc.id || doc.extraction_status === 'in_progress';

              return (
                <div
                  key={doc.id}
                  className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(260px,1.4fr),minmax(160px,0.9fr),minmax(180px,0.9fr),minmax(150px,0.7fr)] md:items-center hover:bg-bg-secondary"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-content-primary">{doc.plan_name}</div>
                    <div className="mt-0.5 text-xs text-content-secondary">
                      {[doc.city, doc.plan_version || null, doc.file_name || null].filter(Boolean).join(' | ')}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <SourceStatusBadge status={doc.extraction_status} />
                    <div className="text-xs text-content-muted">{formatDocType(doc.doc_type)}</div>
                    {doc.extraction_error && (
                      <div className="line-clamp-2 text-xs text-red-600">{doc.extraction_error}</div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {counts.length === 0 ? (
                      <span className="text-xs text-content-muted">No queued rows yet</span>
                    ) : counts.map(([label, value]) => (
                      <span key={label} className="rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-content-secondary">
                        {value} {label}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => openMut.mutate(doc.id)}
                      disabled={openMut.isPending}
                      className="rounded-lg p-1.5 text-content-muted hover:bg-bg-secondary hover:text-primary-600 disabled:opacity-50"
                      title="Open source"
                    >
                      <ExternalLink size={15} />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleExtract(doc)}
                        disabled={busy || extractingId !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
                        {doc.extraction_status === 'completed' ? 'Re-extract' : 'Extract'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MasterPlanAdminPage() {
  const { user } = useAuthStore();
  const role = String(user?.role || '').toLowerCase();
  const canEdit = EDITOR_ROLES.includes(role);
  const [tab, setTab] = useState('zones');

  return (
    <div>
      <PageHeader
        title="Master Plan — Regulatory Data"
        description="Curated zoning regulations (FSI, ground coverage, setbacks, use rules) used across deals. Source: RMP 2031 Draft (OpenCity.in)."
      />

      {!canEdit && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            Read-only view. Only admins, owners, editors, and analysts can add or edit zones.
            Always verify regulatory data with BBMP/BDA before using it in underwriting.
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-hairline-strong mb-4">
        {[
          { key: 'zones', label: 'Zone Library' },
          { key: 'documents', label: 'Source Documents' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-content-secondary hover:text-content-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'zones' ? <ZoneLibrary canEdit={canEdit} /> : <DocumentsPanel canEdit={canEdit} />}
    </div>
  );
}
