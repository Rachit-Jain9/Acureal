/**
 * Pure helpers + option-list constants used by MasterPlanAdminPage and
 * its modal sub-components.
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` (2026-05-25, Task #6
 * decomposition) without behaviour change. Everything here is either a
 * pure function or a static option-list — no React state, no hooks, no
 * side effects — so it's safe to import from any number of components
 * (the upcoming SourceReviewModal, SourceHistoryModal, ZoneModal,
 * ZoneLibraryPanel, DocumentsPanel extractions all use these).
 */

// ─── Static option lists / metadata ──────────────────────────────────

/** Document types the operator can tag uploaded source PDFs as. */
export const SOURCE_DOC_TYPES = [
  { value: 'rmp_table', label: 'RMP / FAR table' },
  { value: 'igr_guidance_pdf', label: 'IGR guidance PDF' },
  { value: 'bbmp_uav_pdf', label: 'BBMP UAV / property tax' },
  { value: 'guidance_value_report', label: 'Guidance report' },
  { value: 'zoning_certificate', label: 'Zoning certificate' },
];

/** Source-role taxonomy (what role does a document play in regulatory chain). */
export const SOURCE_ROLES = [
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

/** Legal-status taxonomy for source documents. */
export const LEGAL_STATUSES = [
  { value: '', label: 'Select status' },
  { value: 'gazetted', label: 'Gazetted' },
  { value: 'draft', label: 'Draft' },
  { value: 'provisional', label: 'Provisional' },
  { value: 'advisory', label: 'Advisory' },
  { value: 'user_supplied', label: 'User supplied' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'unknown', label: 'Unknown' },
];

/** Processing modes that govern whether automated extraction is viable. */
export const PROCESSING_MODES = [
  { value: 'text_extraction', label: 'Text extraction' },
  { value: 'ocr_required', label: 'OCR required' },
  { value: 'image_review', label: 'Image review' },
  { value: 'manual_entry', label: 'Manual entry' },
  { value: 'not_extractable', label: 'Not extractable' },
];

/** Field-label dictionary for the source-history audit modal. */
export const SOURCE_HISTORY_FIELD_LABELS = {
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

/** Readiness-filter pills above the source-documents list. */
export const READINESS_FILTERS = [
  { key: 'all', label: 'All sources' },
  { key: 'ready', label: 'Ready' },
  { key: 'review', label: 'Review queued' },
  { key: 'ocr', label: 'OCR / image' },
  { key: 'metadata', label: 'Metadata gaps' },
  { key: 'manual', label: 'Manual / reference' },
  { key: 'failed', label: 'Failed' },
];

// ─── Formatting helpers ──────────────────────────────────────────────

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDocType(docType) {
  return (
    SOURCE_DOC_TYPES.find((item) => item.value === docType)?.label
    || (docType ? docType.replace(/_/g, ' ') : 'Auto-classify')
  );
}

export function formatOption(options, value) {
  return (
    options.find((item) => item.value === value)?.label
    || (value ? value.replace(/_/g, ' ') : '')
  );
}

export function legalStatusTone(status) {
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

export function formatPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : null;
}

/** Page-status tone helper used by the SourcePagesModal table. */
export function pageStatusTone(status) {
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

// ─── Readiness normalisation ─────────────────────────────────────────

export function normalizeSourceReadiness(readiness) {
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
    isReferenceMap: readiness.is_reference_map ?? readiness.isReferenceMap ?? false,
  };
}

export function getSourceReadiness(doc) {
  const serverReadiness = normalizeSourceReadiness(doc?.source_readiness || doc?.sourceReadiness);
  if (serverReadiness) return serverReadiness;

  // A base map (land-use / planning map sheet) is a VIEWABLE reference, not an
  // extraction target. A freshly-uploaded one would otherwise fall into the
  // "OCR review / pending" branch below and read as a broken or incomplete
  // upload — which is exactly how an operator misreads it. Present a stored map
  // as a settled "Reference map". Once someone manually extracts facts from it,
  // extraction_status moves off 'pending' and the normal readiness applies.
  const status = doc?.extraction_status;
  if (doc?.source_role === 'base_map' && (!status || status === 'pending')) {
    return {
      key: 'manual',
      label: 'Reference map',
      tone: 'neutral',
      description: 'Viewable reference map — stored, not auto-extracted.',
      canExtract: false,
      actionLabel: 'Reference',
      blockReason: 'Map sheets are stored as viewable references; automated extraction is not applied.',
      missingFields: [],
      isReferenceMap: true,
    };
  }

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
  // A registry entry with NO source file (file-less rows seeded directly by
  // the zonal-regulation migrations — RMP 2015 Vol III, BIAAPA MP 2021,
  // Hoskote LPA MP 2031) has nothing to run extraction against. Its
  // extraction_status reads 'completed' (the facts were seeded), so without
  // this branch it fell into "Review queued / Re-extract" and offered a live
  // button that could only ever 400 with a confusing "Only PDF and image..."
  // technicality — the operator hit exactly that three times on 2026-07-29.
  // Sits AFTER the explicit-mode branches: an operator-set mode always wins
  // over a missing-file inference.
  if (!doc?.file_name && !doc?.file_url && !doc?.storage_path) {
    return {
      key: 'manual',
      label: 'Registry entry',
      tone: 'neutral',
      description: 'Seeded directly from the gazetted regulations — no source file attached.',
      canExtract: false,
      actionLabel: 'Registry',
      blockReason: 'This entry\'s regulations were seeded directly; there is no attached file to extract.',
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

// ─── String / number coercion helpers ────────────────────────────────

export function parseList(text) {
  return String(text || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function joinList(arr) {
  return Array.isArray(arr) ? arr.join(', ') : (arr || '');
}

export function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ratioToPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100)) : '';
}

export function pctToRatio(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n)) / 100;
}

// ─── History-modal value formatters ──────────────────────────────────

export function formatHistoryDate(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatHistoryField(field) {
  return SOURCE_HISTORY_FIELD_LABELS[field] || field.replace(/_/g, ' ');
}

export function formatHistoryValue(field, value) {
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

export function normalizePreviousValues(value) {
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
