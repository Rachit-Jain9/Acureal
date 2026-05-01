import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, X, Search, Shield, CheckCircle2, XCircle, Clock, Edit3,
  FileText, AlertTriangle, Upload, FileSearch, ExternalLink, Loader2, RefreshCw, History,
} from 'lucide-react';
import { clsx } from 'clsx';
import useAuthStore from '../store/authStore';
import PageHeader from '../components/common/PageHeader';
import EmptyState from '../components/common/EmptyState';
import Badge from '../components/common/Badge';
import { ErrorState } from '../design-system';
import MasterPlanCorpusPanel from '../components/masterplan/MasterPlanCorpusPanel';
import MasterPlanBbmpUavPanel from '../components/masterplan/MasterPlanBbmpUavPanel';
import ZoneGeoJsonImportButton from '../components/masterplan/ZoneGeoJsonImportButton';
import {
  useZones,
  useMasterPlanDocuments,
  useCreateZone,
  useUpdateZone,
  useReviewZone,
  useUploadMasterPlanDocument,
  useExtractMasterPlanDocument,
  useExtractMasterPlanDocumentsBatch,
  useUpdateMasterPlanDocumentMetadata,
  useMasterPlanDocumentVersions,
  useMasterPlanDocumentPages,
  usePrepareMasterPlanDocumentPages,
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
  { value: 'bbmp_uav_pdf', label: 'BBMP UAV / property tax' },
  { value: 'guidance_value_report', label: 'Guidance report' },
  { value: 'zoning_certificate', label: 'Zoning certificate' },
];

const SOURCE_ROLES = [
  { value: '', label: 'Select role' },
  { value: 'operative_regulation', label: 'Operative regulation' },
  { value: 'draft_plan', label: 'Draft plan' },
  { value: 'provisional_plan', label: 'Provisional plan' },
  { value: 'base_map', label: 'Base map' },
  { value: 'land_use_schedule', label: 'Land-use schedule' },
  { value: 'guidance_value', label: 'Guidance value' },
  { value: 'property_tax_uav', label: 'Property-tax UAV' },
  { value: 'derived_notes', label: 'Derived notes' },
  { value: 'supporting_dataset', label: 'Supporting dataset' },
  { value: 'other', label: 'Other' },
];

const LEGAL_STATUSES = [
  { value: '', label: 'Select status' },
  { value: 'gazetted', label: 'Gazetted' },
  { value: 'draft', label: 'Draft' },
  { value: 'provisional', label: 'Provisional' },
  { value: 'advisory', label: 'Advisory' },
  { value: 'user_supplied', label: 'User supplied' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'unknown', label: 'Unknown' },
];

const PROCESSING_MODES = [
  { value: 'text_extraction', label: 'Text extraction' },
  { value: 'ocr_required', label: 'OCR required' },
  { value: 'image_review', label: 'Image review' },
  { value: 'manual_entry', label: 'Manual entry' },
  { value: 'not_extractable', label: 'Not extractable' },
];

const SOURCE_HISTORY_FIELD_LABELS = {
  doc_type: 'Document type',
  source_role: 'Source role',
  legal_status: 'Legal status',
  authority_name: 'Authority',
  published_on: 'Published on',
  source_url: 'Source URL',
  page_count: 'Page count',
  processing_mode: 'Processing',
  text_coverage_ratio: 'Text coverage',
  ocr_required: 'OCR needed',
  source_confidence: 'Confidence',
  registry_notes: 'Registry notes',
};

const DOC_STATUS_META = {
  pending: { label: 'pending', tone: 'neutral', icon: Clock },
  in_progress: { label: 'extracting', tone: 'info', icon: Loader2 },
  completed: { label: 'queued for review', tone: 'success', icon: CheckCircle2 },
  failed: { label: 'failed', tone: 'danger', icon: XCircle },
};

const READINESS_FILTERS = [
  { key: 'all', label: 'All sources' },
  { key: 'ready', label: 'Ready' },
  { key: 'review', label: 'Review queued' },
  { key: 'ocr', label: 'OCR / image' },
  { key: 'metadata', label: 'Metadata gaps' },
  { key: 'manual', label: 'Manual / reference' },
  { key: 'failed', label: 'Failed' },
];

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

function formatOption(options, value) {
  return options.find((item) => item.value === value)?.label || (value ? value.replace(/_/g, ' ') : '');
}

function legalStatusTone(status) {
  return {
    gazetted: 'success',
    draft: 'warn',
    provisional: 'warn',
    advisory: 'info',
    user_supplied: 'neutral',
    vendor: 'neutral',
    unknown: 'neutral',
  }[status] || 'neutral';
}

function formatPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : null;
}

function normalizeSourceReadiness(readiness) {
  if (!readiness) return null;
  return {
    key: readiness.key || 'ready',
    label: readiness.label || 'Ready',
    tone: readiness.tone || 'info',
    description: readiness.description || 'Text-ready source',
    canExtract: readiness.can_extract ?? readiness.canExtract ?? true,
    actionLabel: readiness.action_label || readiness.actionLabel || 'Extract',
    blockReason: readiness.block_reason || readiness.blockReason || null,
    missingFields: readiness.missing_fields || readiness.missingFields || [],
  };
}

function getSourceReadiness(doc) {
  const serverReadiness = normalizeSourceReadiness(doc?.source_readiness || doc?.sourceReadiness);
  if (serverReadiness) return serverReadiness;

  const mode = doc?.processing_mode;
  if (doc?.ocr_required || mode === 'ocr_required' || mode === 'image_review') {
    return {
      key: 'ocr',
      label: mode === 'image_review' ? 'Image review' : 'OCR review',
      tone: 'warn',
      description: 'OCR or image review required before extraction',
      canExtract: false,
      actionLabel: 'OCR review',
      blockReason: 'This source is marked as needing OCR or image review before automated extraction.',
      missingFields: [],
    };
  }
  if (mode === 'manual_entry') {
    return {
      key: 'manual',
      label: 'Manual entry',
      tone: 'warn',
      description: 'Manual entry source',
      canExtract: false,
      actionLabel: 'Manual only',
      blockReason: 'This source is marked for manual entry. Automated extraction is disabled.',
      missingFields: [],
    };
  }
  if (mode === 'not_extractable') {
    return {
      key: 'manual',
      label: 'Reference only',
      tone: 'neutral',
      description: 'Not extractable',
      canExtract: false,
      actionLabel: 'Reference',
      blockReason: 'This source is marked as not extractable. Automated extraction is disabled.',
      missingFields: [],
    };
  }
  if (doc?.extraction_status === 'failed') {
    return {
      key: 'failed',
      label: 'Failed',
      tone: 'danger',
      description: 'Fix the source issue before retrying',
      canExtract: true,
      actionLabel: 'Retry',
      blockReason: null,
      missingFields: [],
    };
  }
  const missing = [
    !doc?.source_role && { field: 'source_role', label: 'source role' },
    !doc?.legal_status && { field: 'legal_status', label: 'legal status' },
    !doc?.authority_name && { field: 'authority_name', label: 'authority' },
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      key: 'metadata',
      label: 'Metadata gap',
      tone: 'warn',
      description: `Missing ${missing.map((field) => field.label).join(', ')}`,
      canExtract: true,
      actionLabel: 'Extract',
      blockReason: null,
      missingFields: missing,
    };
  }
  if (doc?.extraction_status === 'completed') {
    return {
      key: 'review',
      label: 'Review queued',
      tone: 'success',
      description: 'Candidates are queued for review',
      canExtract: true,
      actionLabel: 'Re-extract',
      blockReason: null,
      missingFields: [],
    };
  }
  return {
    key: 'ready',
    label: 'Ready',
    tone: 'info',
    description: 'Text-ready source',
    canExtract: true,
    actionLabel: 'Extract',
    blockReason: null,
    missingFields: [],
  };
}

function SourceStatusBadge({ status }) {
  const cfg = DOC_STATUS_META[status] || DOC_STATUS_META.pending;
  const Icon = cfg.icon;
  const spinning = status === 'in_progress';
  return (
    <Badge tone={cfg.tone} className="gap-1">
      <Icon size={11} className={spinning ? 'animate-spin' : ''} />
      {cfg.label}
    </Badge>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    approved: { tone: 'success', icon: CheckCircle2, label: 'Approved' },
    pending:  { tone: 'warn', icon: Clock, label: 'Pending review' },
    rejected: { tone: 'danger', icon: XCircle, label: 'Rejected' },
  }[status] || { tone: 'neutral', icon: Clock, label: status || '—' };
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone} className="gap-1">
      <Icon size={11} />
      {cfg.label}
    </Badge>
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

function ratioToPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100)) : '';
}

function pctToRatio(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n)) / 100;
}

function formatHistoryDate(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatHistoryField(field) {
  return SOURCE_HISTORY_FIELD_LABELS[field] || field.replace(/_/g, ' ');
}

function formatHistoryValue(field, value) {
  if (value === null || value === undefined || value === '') return 'Blank';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field === 'doc_type') return formatDocType(value);
  if (field === 'source_role') return formatOption(SOURCE_ROLES, value) || 'Blank';
  if (field === 'legal_status') return formatOption(LEGAL_STATUSES, value) || 'Blank';
  if (field === 'processing_mode') return formatOption(PROCESSING_MODES, value) || 'Blank';
  if (field === 'text_coverage_ratio' || field === 'source_confidence') {
    return formatPercent(value) || 'Blank';
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normalizePreviousValues(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function SourceReviewModal({ doc, isOpen, onClose, onSubmit, submitting }) {
  const [form, setForm] = useState({
    docType: 'rmp_table',
    sourceRole: '',
    legalStatus: '',
    authorityName: '',
    publishedOn: '',
    sourceUrl: '',
    pageCount: '',
    processingMode: 'text_extraction',
    textCoveragePct: '',
    ocrRequired: false,
    sourceConfidencePct: '',
    registryNotes: '',
  });

  useEffect(() => {
    if (!isOpen || !doc) return;
    setForm({
      docType: doc.doc_type || 'rmp_table',
      sourceRole: doc.source_role || '',
      legalStatus: doc.legal_status || '',
      authorityName: doc.authority_name || '',
      publishedOn: doc.published_on ? String(doc.published_on).slice(0, 10) : '',
      sourceUrl: doc.source_url || '',
      pageCount: doc.page_count ?? '',
      processingMode: doc.processing_mode || 'text_extraction',
      textCoveragePct: ratioToPct(doc.text_coverage_ratio),
      ocrRequired: Boolean(doc.ocr_required),
      sourceConfidencePct: ratioToPct(doc.source_confidence),
      registryNotes: doc.registry_notes || '',
    });
  }, [doc, isOpen]);

  if (!isOpen || !doc) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event) => {
    event.preventDefault();
    const processingMode = form.processingMode || 'text_extraction';
    onSubmit({
      docType: form.docType || null,
      sourceRole: form.sourceRole || null,
      legalStatus: form.legalStatus || null,
      authorityName: form.authorityName.trim() || null,
      publishedOn: form.publishedOn || null,
      sourceUrl: form.sourceUrl.trim() || null,
      pageCount: form.pageCount === '' ? null : Number(form.pageCount),
      processingMode,
      textCoverageRatio: pctToRatio(form.textCoveragePct),
      ocrRequired: form.ocrRequired || processingMode === 'ocr_required' || processingMode === 'image_review',
      sourceConfidence: pctToRatio(form.sourceConfidencePct),
      registryNotes: form.registryNotes.trim() || null,
      changeReason: 'source registry review',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-review-title"
        className="relative mx-4 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-review-title" className="truncate text-lg font-semibold text-content-primary">
              Review source metadata
            </h2>
            <p className="mt-0.5 truncate text-xs text-content-secondary">{doc.plan_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="source-review-doc-type" className="block text-xs font-medium text-content-secondary mb-1">Document type</label>
              <select id="source-review-doc-type" className="input text-sm" value={form.docType} onChange={(e) => set('docType', e.target.value)}>
                {SOURCE_DOC_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-review-role" className="block text-xs font-medium text-content-secondary mb-1">Source role</label>
              <select id="source-review-role" className="input text-sm" value={form.sourceRole} onChange={(e) => set('sourceRole', e.target.value)}>
                {SOURCE_ROLES.map((role) => (
                  <option key={role.value || 'none'} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-review-legal-status" className="block text-xs font-medium text-content-secondary mb-1">Legal status</label>
              <select id="source-review-legal-status" className="input text-sm" value={form.legalStatus} onChange={(e) => set('legalStatus', e.target.value)}>
                {LEGAL_STATUSES.map((status) => (
                  <option key={status.value || 'none'} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="source-review-authority" className="block text-xs font-medium text-content-secondary mb-1">Authority</label>
              <input id="source-review-authority" className="input text-sm" value={form.authorityName} onChange={(e) => set('authorityName', e.target.value)} placeholder="BDA / BBMP" />
            </div>
            <div>
              <label htmlFor="source-review-published" className="block text-xs font-medium text-content-secondary mb-1">Published on</label>
              <input id="source-review-published" type="date" className="input text-sm" value={form.publishedOn} onChange={(e) => set('publishedOn', e.target.value)} />
            </div>
            <div>
              <label htmlFor="source-review-pages" className="block text-xs font-medium text-content-secondary mb-1">Page count</label>
              <input id="source-review-pages" type="number" min="1" className="input text-sm" value={form.pageCount} onChange={(e) => set('pageCount', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr),160px,160px]">
            <div>
              <label htmlFor="source-review-processing" className="block text-xs font-medium text-content-secondary mb-1">Processing</label>
              <select id="source-review-processing" className="input text-sm" value={form.processingMode} onChange={(e) => set('processingMode', e.target.value)}>
                {PROCESSING_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-review-coverage" className="block text-xs font-medium text-content-secondary mb-1">Text coverage %</label>
              <input id="source-review-coverage" type="number" min="0" max="100" className="input text-sm" value={form.textCoveragePct} onChange={(e) => set('textCoveragePct', e.target.value)} />
            </div>
            <div>
              <label htmlFor="source-review-confidence" className="block text-xs font-medium text-content-secondary mb-1">Confidence %</label>
              <input id="source-review-confidence" type="number" min="0" max="100" className="input text-sm" value={form.sourceConfidencePct} onChange={(e) => set('sourceConfidencePct', e.target.value)} />
            </div>
          </div>

          <div>
            <label htmlFor="source-review-url" className="block text-xs font-medium text-content-secondary mb-1">Source URL</label>
            <input id="source-review-url" className="input text-sm" value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="Official page or archive URL" />
          </div>

          <div>
            <label htmlFor="source-review-notes" className="block text-xs font-medium text-content-secondary mb-1">Registry notes</label>
            <textarea id="source-review-notes" rows={3} className="input text-sm" value={form.registryNotes} onChange={(e) => set('registryNotes', e.target.value)} placeholder="OCR completed, image review pending, derived source, authority caveat..." />
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-hairline px-3 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-within:ring-2 focus-within:ring-primary-500/40 active:scale-[0.99]">
              <input
                type="checkbox"
                checked={form.ocrRequired}
                onChange={(e) => set('ocrRequired', e.target.checked)}
                className="h-4 w-4 rounded border-hairline text-primary-600 focus:ring-primary-500/40"
              />
              OCR needed
            </label>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn btn-primary text-sm">
                {submitting ? 'Saving...' : 'Save review'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function SourceHistoryModal({ doc, isOpen, onClose, versions = [], isLoading, isError, onRetry }) {
  if (!isOpen || !doc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 transition-opacity duration-150 ease-out" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-history-title"
        className="relative mx-4 max-h-[84vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl motion-safe:animate-[fadeInUp_220ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-history-title" className="truncate text-lg font-semibold text-content-primary">
              Source review history
            </h2>
            <p className="mt-0.5 truncate text-xs text-content-secondary">{doc.plan_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source review history"
            className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div role="status" aria-busy="true" className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                <div className="h-3 w-36 rounded bg-bg-secondary animate-pulse" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading source review history</span>
          </div>
        ) : isError ? (
          <ErrorState
            tone="danger"
            title="Could not load history"
            action={(
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border border-hairline bg-bg-elevated px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
              >
                Retry
              </button>
            )}
          >
            The source registry kept the edit, but the history list could not be loaded.
          </ErrorState>
        ) : versions.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-bg-elevated px-4 py-8 text-center">
            <p className="text-sm font-medium text-content-primary">No source review history yet.</p>
            <p className="mt-1 text-xs text-content-secondary">Metadata edits will appear here after the first review save.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((version) => {
              const previousValues = normalizePreviousValues(version.previous_values);
              const changedFields = Object.entries(previousValues);
              return (
                <article key={version.id} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">{version.changed_by_name || 'System'}</Badge>
                        <span className="text-xs text-content-muted">{formatHistoryDate(version.changed_at)}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-content-secondary">
                        {version.change_reason || 'Source metadata review'}
                      </p>
                    </div>
                    <Badge tone="info">{changedFields.length} field{changedFields.length === 1 ? '' : 's'}</Badge>
                  </div>

                  {changedFields.length > 0 ? (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {changedFields.map(([field, value]) => (
                        <div key={field} className="rounded-lg border border-hairline-soft bg-bg-secondary px-3 py-2">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                            Previous {formatHistoryField(field)}
                          </div>
                          <div className="mt-1 break-words text-xs font-medium text-content-primary">
                            {formatHistoryValue(field, value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-content-muted">No changed fields were recorded for this entry.</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
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
        {canEdit && <ZoneGeoJsonImportButton />}
      </div>

      {isLoading ? (
        <ZoneTableSkeleton />
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

function pageStatusTone(status) {
  return {
    completed: 'success',
    reviewed: 'success',
    queued: 'warn',
    needs_ocr: 'warn',
    failed: 'danger',
    rejected: 'danger',
    not_required: 'neutral',
  }[status] || 'neutral';
}

function ZoneTableSkeleton() {
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-lg border border-hairline bg-bg-elevated">
      <div className="grid grid-cols-[0.7fr,1.4fr,1fr,0.7fr,0.8fr,0.9fr] gap-3 border-b border-hairline-strong px-4 py-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="h-3 rounded bg-bg-secondary animate-pulse" />
        ))}
      </div>
      <div className="divide-y divide-hairline">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid grid-cols-[0.7fr,1.4fr,1fr,0.7fr,0.8fr,0.9fr] gap-3 px-4 py-3">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="h-8 rounded bg-bg-secondary animate-pulse" />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading master plan zones</span>
    </div>
  );
}

function SourceDocumentsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="rounded-lg border border-hairline bg-bg-elevated p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-4 w-36 rounded bg-bg-secondary animate-pulse" />
            <div className="h-3 w-80 max-w-full rounded bg-bg-secondary animate-pulse" />
          </div>
          <div className="h-6 w-20 rounded bg-bg-secondary animate-pulse" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-10 rounded-lg bg-bg-secondary animate-pulse" />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-hairline bg-bg-elevated">
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid grid-cols-1 gap-3 border-b border-hairline px-4 py-3 last:border-b-0 md:grid-cols-[minmax(260px,1.4fr),minmax(160px,0.9fr),minmax(180px,0.9fr),minmax(150px,0.7fr)]">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-12 rounded bg-bg-secondary animate-pulse" />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading source documents</span>
    </div>
  );
}

function SourcePagesModal({
  doc,
  isOpen,
  onClose,
  data,
  isLoading,
  isError,
  onRetry,
  onPrepare,
  preparing,
}) {
  if (!isOpen || !doc) return null;

  const pages = data?.pages || [];
  const schemaReady = data?.schema_ready !== false;
  const canPrepare = schemaReady && Number(doc.page_count) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 transition-opacity duration-150 ease-out" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-pages-title"
        className="relative mx-4 max-h-[84vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl motion-safe:animate-[fadeInUp_220ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-pages-title" className="truncate text-lg font-semibold text-content-primary">
              Source page ledger
            </h2>
            <p className="mt-0.5 truncate text-xs text-content-secondary">{doc.plan_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source page ledger"
            className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div role="status" aria-busy="true" className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                <div className="h-3 w-28 rounded bg-bg-secondary animate-pulse" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading source page ledger</span>
          </div>
        ) : isError ? (
          <ErrorState
            tone="danger"
            title="Could not load page ledger"
            action={(
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border border-hairline bg-bg-elevated px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
              >
                Retry
              </button>
            )}
          >
            Page-level source review could not be loaded.
          </ErrorState>
        ) : !schemaReady ? (
          <ErrorState tone="warn" title="Page storage not applied yet">
            {data?.message || 'Apply the page-level source storage migration before preparing OCR pages.'}
          </ErrorState>
        ) : pages.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-bg-elevated px-4 py-8 text-center">
            <p className="text-sm font-medium text-content-primary">No pages prepared yet.</p>
            <p className="mt-1 text-xs text-content-secondary">
              {canPrepare
                ? 'Prepare empty page rows before OCR, citation anchoring, or reviewer notes are attached.'
                : 'Set a page count in source review before preparing the page ledger.'}
            </p>
            <button
              type="button"
              onClick={onPrepare}
              disabled={!canPrepare || preparing}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors duration-150 ease-out hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {preparing ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              {preparing ? 'Preparing...' : 'Prepare pages'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Badge tone="neutral">{pages.length} page{pages.length === 1 ? '' : 's'}</Badge>
              <button
                type="button"
                onClick={onPrepare}
                disabled={!canPrepare || preparing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-bg-elevated px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {preparing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {preparing ? 'Preparing...' : 'Fill missing pages'}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {pages.map((page) => (
                <article key={page.id || page.page_number} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-content-primary">Page {page.page_number}</p>
                      <p className="mt-0.5 text-xs text-content-secondary">{page.page_label || 'No page label'}</p>
                    </div>
                    <Badge tone={pageStatusTone(page.ocr_status)}>{String(page.ocr_status || 'not_started').replace(/_/g, ' ')}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={pageStatusTone(page.review_status)}>{String(page.review_status || 'pending').replace(/_/g, ' ')}</Badge>
                    {formatPercent(page.text_coverage_ratio) && (
                      <Badge tone="neutral">Text {formatPercent(page.text_coverage_ratio)}</Badge>
                    )}
                    {page.confidence_score !== null && page.confidence_score !== undefined && (
                      <Badge tone="neutral">Confidence {formatPercent(page.confidence_score)}</Badge>
                    )}
                  </div>
                  <p className="mt-3 line-clamp-2 text-xs text-content-muted">
                    {page.reviewer_notes || page.page_checksum_sha256 || 'OCR text and citation anchors are not stored for this page yet.'}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentsPanel({ canEdit }) {
  const { data: docs = [], isLoading, isError, refetch } = useMasterPlanDocuments();
  const uploadMut = useUploadMasterPlanDocument();
  const extractMut = useExtractMasterPlanDocument();
  const batchExtractMut = useExtractMasterPlanDocumentsBatch();
  const updateDocMut = useUpdateMasterPlanDocumentMetadata();
  const openMut = useOpenMasterPlanDocument();
  const preparePagesMut = usePrepareMasterPlanDocumentPages();

  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    city: 'Bengaluru',
    planName: '',
    planVersion: 'RMP 2031 Draft',
    docType: 'rmp_table',
    sourceRole: '',
    legalStatus: '',
    authorityName: '',
    processingMode: 'text_extraction',
    ocrRequired: false,
    registryNotes: '',
  });
  const [extractingId, setExtractingId] = useState(null);
  const [fileError, setFileError] = useState('');
  const [readinessFilter, setReadinessFilter] = useState('all');
  const [reviewingDoc, setReviewingDoc] = useState(null);
  const [historyDoc, setHistoryDoc] = useState(null);
  const [pagesDoc, setPagesDoc] = useState(null);
  const historyQuery = useMasterPlanDocumentVersions(historyDoc?.id);
  const pagesQuery = useMasterPlanDocumentPages(pagesDoc?.id);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const docsWithReadiness = useMemo(
    () => docs.map((doc) => ({ doc, readiness: getSourceReadiness(doc) })),
    [docs],
  );

  const readinessCounts = useMemo(() => {
    const counts = { all: docs.length };
    docsWithReadiness.forEach(({ readiness }) => {
      counts[readiness.key] = (counts[readiness.key] || 0) + 1;
    });
    return counts;
  }, [docs.length, docsWithReadiness]);

  const filteredDocs = useMemo(
    () => (readinessFilter === 'all'
      ? docsWithReadiness
      : docsWithReadiness.filter(({ readiness }) => readiness.key === readinessFilter)),
    [docsWithReadiness, readinessFilter],
  );

  // "Extract all eligible" — every doc whose readiness allows extraction and
  // whose status isn't already in_progress / completed. Capped at 25 by the
  // backend so it doesn't fan out indefinitely.
  const eligibleForBatchExtract = useMemo(
    () => docsWithReadiness
      .filter(({ doc, readiness }) => (
        readiness.canExtract
        && doc.extraction_status !== 'in_progress'
        && doc.extraction_status !== 'completed'
      ))
      .map(({ doc }) => doc.id)
      .slice(0, 25),
    [docsWithReadiness],
  );

  const handleBatchExtract = async () => {
    if (eligibleForBatchExtract.length === 0) return;
    await batchExtractMut.mutateAsync(eligibleForBatchExtract);
  };

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
      sourceRole: form.sourceRole || null,
      legalStatus: form.legalStatus || null,
      authorityName: form.authorityName.trim() || null,
      processingMode: form.processingMode || 'text_extraction',
      ocrRequired: form.ocrRequired || form.processingMode === 'ocr_required' || form.processingMode === 'image_review',
      registryNotes: form.registryNotes.trim() || null,
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

  const handleReviewSubmit = async (payload) => {
    if (!reviewingDoc?.id) return;
    await updateDocMut.mutateAsync({ id: reviewingDoc.id, data: payload });
    setReviewingDoc(null);
  };

  const handlePreparePages = async () => {
    if (!pagesDoc?.id) return;
    await preparePagesMut.mutateAsync({
      id: pagesDoc.id,
      pageCount: pagesDoc.page_count || undefined,
    });
  };

  if (isLoading) return <SourceDocumentsSkeleton />;

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
                accept=".pdf,.docx,.doc,.rtf,.odt,.txt,.md,.xlsx,.xls,.xlsm,.csv,.tsv,.ods,.pptx,.ppt,.odp,.jpg,.jpeg,.png,.webp,.tif,.tiff,.gif,.bmp,.heic,.heif,.geojson,.kml,.kmz,.gpx,.json,.xml"
                onChange={handleFile}
                className="block w-full text-sm text-content-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Source role</label>
              <select className="input text-sm" value={form.sourceRole} onChange={(e) => set('sourceRole', e.target.value)}>
                {SOURCE_ROLES.map((role) => (
                  <option key={role.value || 'none'} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Legal status</label>
              <select className="input text-sm" value={form.legalStatus} onChange={(e) => set('legalStatus', e.target.value)}>
                {LEGAL_STATUSES.map((status) => (
                  <option key={status.value || 'none'} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Authority</label>
              <input
                className="input text-sm"
                value={form.authorityName}
                onChange={(e) => set('authorityName', e.target.value)}
                placeholder="BDA / BBMP"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Processing</label>
              <select
                className="input text-sm"
                value={form.processingMode}
                onChange={(e) => set('processingMode', e.target.value)}
              >
                {PROCESSING_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
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

          <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr),auto] gap-3 md:items-end">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Registry notes</label>
              <input
                className="input text-sm"
                value={form.registryNotes}
                onChange={(e) => set('registryNotes', e.target.value)}
                placeholder="Draft source, image-only PDF, derived from user remarks..."
              />
            </div>
            <label className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-hairline px-3 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-within:ring-2 focus-within:ring-primary-500/40 active:scale-[0.99]">
              <input
                type="checkbox"
                checked={form.ocrRequired}
                onChange={(e) => set('ocrRequired', e.target.checked)}
                className="h-4 w-4 rounded border-hairline text-primary-600 focus:ring-primary-500/40"
              />
              OCR needed
            </label>
          </div>


          <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3">
            <Link to="/dashboard/settings/parcel-intelligence" className="text-xs font-medium text-primary-600 hover:underline">
              Review queue
            </Link>
            <button
              type="submit"
              disabled={uploadMut.isPending || !file}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-60"
            >
              {uploadMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploadMut.isPending ? 'Uploading...' : 'Upload source'}
            </button>
          </div>
        </form>
      )}

      {docs.length > 0 && (
        <div className="rounded-lg border border-hairline bg-bg-elevated p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-content-primary">Source readiness</h3>
              <p className="mt-0.5 text-xs text-content-secondary">
                Text-ready sources, OCR gaps, and manual-reference documents.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && eligibleForBatchExtract.length > 0 && (
                <button
                  type="button"
                  onClick={handleBatchExtract}
                  disabled={batchExtractMut.isPending}
                  title={`Queue ${eligibleForBatchExtract.length} extraction${eligibleForBatchExtract.length === 1 ? '' : 's'} in parallel — runs in the background`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-60"
                >
                  {batchExtractMut.isPending ? (
                    <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <FileSearch size={12} />
                  )}
                  Extract {eligibleForBatchExtract.length} eligible
                </button>
              )}
              <Badge tone="neutral">{docs.length} total</Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
            {READINESS_FILTERS.map((filter) => {
              const selected = readinessFilter === filter.key;
              const count = readinessCounts[filter.key] || 0;
              return (
                <button
                  key={filter.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setReadinessFilter(filter.key)}
                  className={clsx(
                    'rounded-lg border px-3 py-2 text-left transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]',
                    selected
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-hairline bg-bg-elevated text-content-secondary hover:border-primary-300 hover:bg-bg-secondary',
                  )}
                >
                  <div className="text-lg font-semibold tabular-nums">{count}</div>
                  <div className="truncate text-[11px] font-medium">{filter.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No master plan source documents"
          description="Upload reviewed source material to extract candidate zones, FAR rules, planning districts, and guidance values into the review queue."
        />
      ) : filteredDocs.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-bg-elevated px-4 py-8 text-center">
          <p className="text-sm font-medium text-content-primary">No sources match this readiness view.</p>
          <p className="mt-1 text-xs text-content-secondary">The registry has no documents in this readiness state.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-bg-elevated">
          <div className="hidden border-b border-hairline-strong px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-content-secondary md:grid md:grid-cols-[minmax(260px,1.4fr),minmax(160px,0.9fr),minmax(180px,0.9fr),minmax(150px,0.7fr)] md:gap-3">
            <div>Source</div>
            <div>Extraction</div>
            <div>Review candidates</div>
            <div className="text-right">Actions</div>
          </div>
          <div className="divide-y divide-hairline">
            {filteredDocs.map(({ doc, readiness }) => {
              const counts = [
                ['zones', doc.zones_extracted],
                ['FAR', doc.far_rules_extracted],
                ['guidance', doc.guidance_rows_extracted],
                ['facts', doc.evidence_facts_extracted],
              ].filter(([, value]) => Number(value) > 0);
              const busy = extractingId === doc.id || doc.extraction_status === 'in_progress';
              const textCoverage = formatPercent(doc.text_coverage_ratio);

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
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {doc.legal_status && (
                        <Badge tone={legalStatusTone(doc.legal_status)}>
                          {formatOption(LEGAL_STATUSES, doc.legal_status)}
                        </Badge>
                      )}
                      {doc.source_role && (
                        <Badge tone="neutral">{formatOption(SOURCE_ROLES, doc.source_role)}</Badge>
                      )}
                      {doc.authority_name && (
                        <span className="rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-content-secondary">
                          {doc.authority_name}
                        </span>
                      )}
                      {doc.ocr_required && <Badge tone="warn">OCR needed</Badge>}
                      {textCoverage && <Badge tone="neutral">Text {textCoverage}</Badge>}
                      <Badge tone={readiness.tone}>{readiness.label}</Badge>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <SourceStatusBadge status={doc.extraction_status} />
                    <div className="text-xs text-content-muted">{formatDocType(doc.doc_type)}</div>
                    <div className="text-xs text-content-muted">{readiness.description}</div>
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
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setReviewingDoc(doc)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
                        title="Review source"
                        aria-label={`Review source ${doc.plan_name}`}
                      >
                        <Edit3 size={15} />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setHistoryDoc(doc)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
                        title="Review history"
                        aria-label={`Review history ${doc.plan_name}`}
                      >
                        <History size={15} />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setPagesDoc(doc)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
                        title="Page ledger"
                        aria-label={`Page ledger ${doc.plan_name}`}
                      >
                        <FileText size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openMut.mutate(doc.id)}
                      disabled={openMut.isPending}
                      className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-50"
                      title="Open source"
                    >
                      <ExternalLink size={15} />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleExtract(doc)}
                        disabled={busy || extractingId !== null || !readiness.canExtract}
                        title={readiness.blockReason || readiness.description}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1.5 text-xs font-medium text-primary-700 transition-colors duration-150 ease-out hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98] disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
                        {busy ? 'Extracting...' : readiness.actionLabel}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <SourceReviewModal
        doc={reviewingDoc}
        isOpen={Boolean(reviewingDoc)}
        onClose={() => setReviewingDoc(null)}
        onSubmit={handleReviewSubmit}
        submitting={updateDocMut.isPending}
      />
      <SourceHistoryModal
        doc={historyDoc}
        isOpen={Boolean(historyDoc)}
        onClose={() => setHistoryDoc(null)}
        versions={historyQuery.data || []}
        isLoading={historyQuery.isLoading || historyQuery.isFetching}
        isError={historyQuery.isError}
        onRetry={() => historyQuery.refetch()}
      />
      <SourcePagesModal
        doc={pagesDoc}
        isOpen={Boolean(pagesDoc)}
        onClose={() => setPagesDoc(null)}
        data={pagesQuery.data}
        isLoading={pagesQuery.isLoading || pagesQuery.isFetching}
        isError={pagesQuery.isError}
        onRetry={() => pagesQuery.refetch()}
        onPrepare={handlePreparePages}
        preparing={preparePagesMut.isPending}
      />
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
        <ErrorState tone="warn" className="mb-4">
          Read-only view. Only admins, owners, editors, and analysts can add or edit zones.
          Always verify regulatory data with BBMP/BDA before using it in underwriting.
        </ErrorState>
      )}

      <div className="flex gap-1 border-b border-hairline-strong mb-4">
        {[
          { key: 'zones', label: 'Zone Library' },
          { key: 'documents', label: 'Source Documents' },
          { key: 'corpus', label: 'Source Corpus' },
          { key: 'bbmp-uav', label: 'BBMP UAV' },
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

      {tab === 'zones' && <ZoneLibrary canEdit={canEdit} />}
      {tab === 'documents' && <DocumentsPanel canEdit={canEdit} />}
      {tab === 'corpus' && <MasterPlanCorpusPanel />}
      {tab === 'bbmp-uav' && <MasterPlanBbmpUavPanel />}
    </div>
  );
}
