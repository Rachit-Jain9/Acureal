'use strict';

const path = require('path');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { createUploadUrl, getDownloadUrl } = require('../config/storage');
const extractionService = require('./extraction.service');
const evidenceIngestionService = require('./evidenceIngestion.service');
const masterplanCorpus = require('./masterplanCorpus');

// Accept the common document / spreadsheet / image / GIS formats real estate
// deal teams actually use. Extraction is still gated behind
// EXTRACTABLE_EXTENSIONS — non-extractable formats land in storage with
// classification metadata for manual review only. Executables, archives, and
// scripts are intentionally excluded for safety.
const ALLOWED_SOURCE_EXTENSIONS = new Set([
  // Documents
  '.pdf', '.docx', '.doc', '.rtf', '.odt', '.txt', '.md',
  // Spreadsheets
  '.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.ods',
  // Presentations
  '.pptx', '.ppt', '.odp',
  // Images
  '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.gif', '.bmp', '.heic', '.heif',
  // GIS / geospatial
  '.geojson', '.kml', '.kmz', '.gpx',
  // Structured data
  '.json', '.xml',
]);
const EXTRACTABLE_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const MAX_SOURCE_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50) * 1024 * 1024;
const MASTERPLAN_DOC_TYPES = new Set([
  'rmp_table',
  'igr_guidance_pdf',
  'bbmp_uav_pdf',
  'guidance_value_report',
  'zoning_certificate',
]);
const SOURCE_ROLES = new Set([
  'operative_regulation',
  'draft_plan',
  'provisional_plan',
  'base_map',
  'land_use_schedule',
  'guidance_value',
  'property_tax_uav',
  'derived_notes',
  'supporting_dataset',
  'other',
]);
const LEGAL_STATUSES = new Set([
  'gazetted',
  'draft',
  'provisional',
  'advisory',
  'user_supplied',
  'vendor',
  'unknown',
]);
const PROCESSING_MODES = new Set([
  'text_extraction',
  'ocr_required',
  'image_review',
  'manual_entry',
  'geojson',
  'not_extractable',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Rules engine
// Mirrors regulatory_data.effective_fsi() Postgres function exactly so frontend,
// backend, and database computations stay consistent.
// ──────────────────────────────────────────────────────────────────────────────

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const textOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const normalizeDocType = (value) => {
  const normalized = textOrNull(value);
  return normalized && MASTERPLAN_DOC_TYPES.has(normalized) ? normalized : null;
};

const normalizeDocTypeStrict = (value, fieldName = 'doc_type') => {
  const normalized = textOrNull(value);
  if (!normalized) return null;
  if (!MASTERPLAN_DOC_TYPES.has(normalized)) {
    throw createError(`${fieldName} is not supported.`, 400);
  }
  return normalized;
};

const normalizeEnum = (value, allowed, fieldName) => {
  const normalized = textOrNull(value);
  if (!normalized) return null;
  if (!allowed.has(normalized)) {
    throw createError(`${fieldName} is not supported.`, 400);
  }
  return normalized;
};

const normalizeRatio = (value, fieldName) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = toNumber(value);
  if (numeric === null || numeric < 0 || numeric > 1) {
    throw createError(`${fieldName} must be between 0 and 1.`, 400);
  }
  return numeric;
};

const normalizePositiveInt = (value, fieldName) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = toNumber(value);
  if (numeric === null || numeric <= 0) {
    throw createError(`${fieldName} must be a positive number.`, 400);
  }
  return Math.round(numeric);
};

const normalizeDate = (value, fieldName) => {
  const normalized = textOrNull(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createError(`${fieldName} must use YYYY-MM-DD format.`, 400);
  }
  return normalized;
};

const normalizeBoolean = (value) => {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === '') return false;
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
};

const isMissingOptionalSourceTable = (error) => (
  error?.code === '42P01'
  || /regulatory_data\.(master_plan_document_pages|bbmp_uav_entries)/i.test(error?.message || '')
);

const sourceFileExt = (fileName = '') => path.extname(String(fileName)).toLowerCase();

const assertSourceFileAllowed = (fileName, fileSize = 0) => {
  const ext = sourceFileExt(fileName);
  if (!ALLOWED_SOURCE_EXTENSIONS.has(ext)) {
    throw createError(`File type ${ext || 'unknown'} is not supported for regulatory extraction. Upload PDF or image source files.`, 400);
  }

  if (Number(fileSize) > MAX_SOURCE_FILE_SIZE) {
    throw createError(`File too large. Maximum allowed size is ${MAX_SOURCE_FILE_SIZE / (1024 * 1024)} MB.`, 413);
  }
};

const isExtractableSource = (doc) => {
  const ext = sourceFileExt(doc.file_name || doc.plan_name || '');
  const mime = String(doc.file_type || '').toLowerCase();
  return EXTRACTABLE_EXTENSIONS.has(ext) || mime.includes('pdf') || mime.startsWith('image/');
};

const SOURCE_METADATA_FIELDS = [
  { field: 'source_role', label: 'source role' },
  { field: 'legal_status', label: 'legal status' },
  { field: 'authority_name', label: 'authority' },
];

const getSourceMetadataGaps = (doc = {}) => SOURCE_METADATA_FIELDS
  .filter(({ field }) => !textOrNull(doc[field]))
  .map(({ field, label }) => ({ field, label }));

const getSourceDocumentReadiness = (doc = {}) => {
  const mode = doc?.processing_mode;
  if (doc?.ocr_required || mode === 'ocr_required' || mode === 'image_review') {
    return {
      key: 'ocr',
      label: mode === 'image_review' ? 'Image review' : 'OCR review',
      tone: 'warn',
      description: 'OCR or image review required before extraction',
      can_extract: false,
      action_label: 'OCR review',
      block_reason: 'This source is marked as needing OCR or image review before automated extraction.',
      missing_fields: [],
    };
  }
  if (mode === 'manual_entry') {
    return {
      key: 'manual',
      label: 'Manual entry',
      tone: 'warn',
      description: 'Manual entry source',
      can_extract: false,
      action_label: 'Manual only',
      block_reason: 'This source is marked for manual entry. Automated extraction is disabled.',
      missing_fields: [],
    };
  }
  if (mode === 'not_extractable') {
    return {
      key: 'manual',
      label: 'Reference only',
      tone: 'neutral',
      description: 'Not extractable',
      can_extract: false,
      action_label: 'Reference',
      block_reason: 'This source is marked as not extractable. Automated extraction is disabled.',
      missing_fields: [],
    };
  }
  if (doc?.extraction_status === 'failed') {
    return {
      key: 'failed',
      label: 'Failed',
      tone: 'danger',
      description: 'Fix the source issue before retrying',
      can_extract: true,
      action_label: 'Retry',
      block_reason: null,
      missing_fields: [],
    };
  }

  const missingFields = getSourceMetadataGaps(doc);
  if (missingFields.length > 0) {
    return {
      key: 'metadata',
      label: 'Metadata gap',
      tone: 'warn',
      description: `Missing ${missingFields.map((field) => field.label).join(', ')}`,
      can_extract: true,
      action_label: 'Extract',
      block_reason: null,
      missing_fields: missingFields,
    };
  }

  if (doc?.extraction_status === 'completed') {
    return {
      key: 'review',
      label: 'Review queued',
      tone: 'success',
      description: 'Candidates are queued for review',
      can_extract: true,
      action_label: 'Re-extract',
      block_reason: null,
      missing_fields: [],
    };
  }

  return {
    key: 'ready',
    label: 'Ready',
    tone: 'info',
    description: 'Text-ready source',
    can_extract: true,
    action_label: 'Extract',
    block_reason: null,
    missing_fields: [],
  };
};

const getExtractionBlockReason = (doc) => {
  const readiness = getSourceDocumentReadiness(doc);
  if (!readiness.can_extract) {
    return readiness.block_reason || readiness.description;
  }
  return null;
};

function calculateEffectiveFSI(zone, roadWidthM) {
  const base = toNumber(zone?.permissible_fsi_base);
  const width = toNumber(roadWidthM);
  const rules = Array.isArray(zone?.fsi_road_width_rules) ? zone.fsi_road_width_rules : null;

  if (!rules || rules.length === 0 || width === null) return base;

  const applicable = rules
    .map((r) => ({ rw: toNumber(r?.road_width_m), fsi: toNumber(r?.fsi) }))
    .filter((r) => r.rw !== null && r.rw <= width)
    .sort((a, b) => b.rw - a.rw);

  return applicable[0]?.fsi ?? base;
}

// ──────────────────────────────────────────────────────────────────────────────
// Payload normalization
// ──────────────────────────────────────────────────────────────────────────────

const ALLOWED_ZONE_FIELDS = [
  'document_id',
  'planning_district_id',
  'city',
  'plan_version',
  'zone_code',
  'zone_name',
  'permissible_fsi_base',
  'permissible_fsi_max',
  'fsi_road_width_rules',
  'ground_coverage_pct',
  'building_height_max_m',
  'road_width_min_m',
  'setback_rules',
  'permissible_uses',
  'prohibited_uses',
  'notes',
  'source_page',
  'source_section',
  'confidence_score',
  'review_status',
  'effective_from',
  'effective_to',
];

const snakeKeys = {
  documentId: 'document_id',
  planningDistrictId: 'planning_district_id',
  planVersion: 'plan_version',
  zoneCode: 'zone_code',
  zoneName: 'zone_name',
  permissibleFsiBase: 'permissible_fsi_base',
  permissibleFsiMax: 'permissible_fsi_max',
  fsiRoadWidthRules: 'fsi_road_width_rules',
  groundCoveragePct: 'ground_coverage_pct',
  buildingHeightMaxM: 'building_height_max_m',
  roadWidthMinM: 'road_width_min_m',
  setbackRules: 'setback_rules',
  permissibleUses: 'permissible_uses',
  prohibitedUses: 'prohibited_uses',
  sourcePage: 'source_page',
  sourceSection: 'source_section',
  confidenceScore: 'confidence_score',
  reviewStatus: 'review_status',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
};

const sourceDocumentSnakeKeys = {
  docType: 'doc_type',
  sourceRole: 'source_role',
  legalStatus: 'legal_status',
  authorityName: 'authority_name',
  publishedOn: 'published_on',
  sourceUrl: 'source_url',
  pageCount: 'page_count',
  processingMode: 'processing_mode',
  textCoverageRatio: 'text_coverage_ratio',
  ocrRequired: 'ocr_required',
  sourceConfidence: 'source_confidence',
  registryNotes: 'registry_notes',
};

const SOURCE_DOCUMENT_METADATA_FIELDS = [
  'doc_type',
  'source_role',
  'legal_status',
  'authority_name',
  'published_on',
  'source_url',
  'page_count',
  'processing_mode',
  'text_coverage_ratio',
  'ocr_required',
  'source_confidence',
  'registry_notes',
];

const DECIMAL_FIELDS = new Set([
  'permissible_fsi_base',
  'permissible_fsi_max',
  'ground_coverage_pct',
  'building_height_max_m',
  'road_width_min_m',
  'confidence_score',
]);

const INTEGER_FIELDS = new Set(['source_page']);
const JSONB_FIELDS = new Set(['fsi_road_width_rules', 'setback_rules']);
const TEXT_ARRAY_FIELDS = new Set(['permissible_uses', 'prohibited_uses']);

const validateRoadWidthRules = (rules) => {
  if (rules === null || rules === undefined) return null;
  if (!Array.isArray(rules)) {
    throw createError('fsi_road_width_rules must be an array', 400);
  }
  return rules.map((r, idx) => {
    const rw = toNumber(r?.road_width_m);
    const fsi = toNumber(r?.fsi);
    if (rw === null || fsi === null) {
      throw createError(`fsi_road_width_rules[${idx}] must include numeric road_width_m and fsi`, 400);
    }
    if (rw < 0 || fsi < 0 || fsi > 20) {
      throw createError(`fsi_road_width_rules[${idx}] out of range`, 400);
    }
    return { road_width_m: rw, fsi };
  });
};

const validateSetbackRules = (setbacks) => {
  if (setbacks === null || setbacks === undefined) return null;
  if (typeof setbacks !== 'object' || Array.isArray(setbacks)) {
    throw createError('setback_rules must be an object', 400);
  }
  const out = {};
  for (const [k, v] of Object.entries(setbacks)) {
    const n = toNumber(v);
    if (n === null) continue;
    if (n < 0 || n > 1000) throw createError(`setback_rules.${k} out of range`, 400);
    out[k] = n;
  }
  return out;
};

const normalizeZonePayload = (input = {}) => {
  const src = { ...input };
  for (const [camel, snake] of Object.entries(snakeKeys)) {
    if (src[camel] !== undefined && src[snake] === undefined) {
      src[snake] = src[camel];
    }
  }

  const payload = {};
  for (const field of ALLOWED_ZONE_FIELDS) {
    if (src[field] === undefined) continue;
    let value = src[field];

    if (value === '') value = null;

    if (DECIMAL_FIELDS.has(field)) {
      value = toNumber(value);
    } else if (INTEGER_FIELDS.has(field)) {
      const n = toNumber(value);
      value = n === null ? null : Math.round(n);
    } else if (field === 'fsi_road_width_rules') {
      value = validateRoadWidthRules(value);
    } else if (field === 'setback_rules') {
      value = validateSetbackRules(value);
    } else if (TEXT_ARRAY_FIELDS.has(field)) {
      if (value === null) {
        // keep null
      } else if (Array.isArray(value)) {
        value = value.map((v) => String(v).trim()).filter(Boolean);
      } else {
        throw createError(`${field} must be an array of strings`, 400);
      }
    } else if (typeof value === 'string') {
      value = value.trim() || null;
    }

    payload[field] = value;
  }

  if (payload.zone_code) payload.zone_code = String(payload.zone_code).toUpperCase();
  if (payload.review_status && !['pending', 'approved', 'rejected'].includes(payload.review_status)) {
    throw createError('review_status must be pending, approved, or rejected', 400);
  }

  if (payload.confidence_score !== undefined && payload.confidence_score !== null) {
    if (payload.confidence_score < 0 || payload.confidence_score > 1) {
      throw createError('confidence_score must be between 0 and 1', 400);
    }
  }

  if (payload.permissible_fsi_base !== undefined && payload.permissible_fsi_base !== null) {
    if (payload.permissible_fsi_base < 0 || payload.permissible_fsi_base > 20) {
      throw createError('permissible_fsi_base must be between 0 and 20', 400);
    }
  }

  if (payload.permissible_fsi_max !== undefined && payload.permissible_fsi_max !== null) {
    if (payload.permissible_fsi_max < 0 || payload.permissible_fsi_max > 20) {
      throw createError('permissible_fsi_max must be between 0 and 20', 400);
    }
  }

  return payload;
};

const normalizeSourceDocumentMetadataPayload = (input = {}) => {
  const src = { ...input };
  for (const [camel, snake] of Object.entries(sourceDocumentSnakeKeys)) {
    if (src[camel] !== undefined && src[snake] === undefined) {
      src[snake] = src[camel];
    }
  }

  const payload = {};
  for (const field of SOURCE_DOCUMENT_METADATA_FIELDS) {
    if (src[field] === undefined) continue;
    let value = src[field];

    if (value === '') value = null;

    if (field === 'doc_type') {
      value = normalizeDocTypeStrict(value, 'doc_type');
    } else if (field === 'source_role') {
      value = normalizeEnum(value, SOURCE_ROLES, 'source_role');
    } else if (field === 'legal_status') {
      value = normalizeEnum(value, LEGAL_STATUSES, 'legal_status');
    } else if (field === 'processing_mode') {
      value = normalizeEnum(value, PROCESSING_MODES, 'processing_mode');
    } else if (field === 'published_on') {
      value = normalizeDate(value, 'published_on');
    } else if (field === 'page_count') {
      value = normalizePositiveInt(value, 'page_count');
    } else if (field === 'text_coverage_ratio') {
      value = normalizeRatio(value, 'text_coverage_ratio');
    } else if (field === 'source_confidence') {
      value = normalizeRatio(value, 'source_confidence');
    } else if (field === 'ocr_required') {
      value = normalizeBoolean(value);
    } else if (typeof value === 'string') {
      value = textOrNull(value);
    }

    payload[field] = value;
  }

  if (
    payload.processing_mode === 'ocr_required'
    || payload.processing_mode === 'image_review'
  ) {
    payload.ocr_required = true;
  }

  return payload;
};

// ──────────────────────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────────────────────

const ZONE_SELECT = `
  SELECT z.*,
         d.plan_name AS document_plan_name,
         pd.pd_code AS planning_district_code,
         pd.pd_name AS planning_district_name,
         ru.name AS reviewed_by_name
  FROM regulatory_data.master_plan_zones z
  LEFT JOIN regulatory_data.master_plan_documents d ON d.id = z.document_id
  LEFT JOIN regulatory_data.planning_districts pd ON pd.id = z.planning_district_id
  LEFT JOIN public.users ru ON ru.id = z.reviewed_by
`;

async function searchZones({ search, city, status = 'approved', pd, planVersion, limit = 100 } = {}) {
  const conditions = ['z.effective_to IS NULL'];
  const values = [];
  let idx = 1;

  if (status && status !== 'all') {
    conditions.push(`z.review_status = $${idx++}`);
    values.push(status);
  }

  if (city) {
    conditions.push(`LOWER(z.city) = LOWER($${idx++})`);
    values.push(city);
  }

  if (pd) {
    conditions.push(`pd.pd_code = $${idx++}`);
    values.push(pd);
  }

  if (planVersion) {
    conditions.push(`z.plan_version = $${idx++}`);
    values.push(planVersion);
  }

  if (search) {
    conditions.push(`(z.zone_code ILIKE $${idx} OR z.zone_name ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const cappedLimit = Math.min(parseInt(limit, 10) || 100, 500);
  values.push(cappedLimit);

  const result = await query(
    `${ZONE_SELECT} WHERE ${where} ORDER BY z.zone_code ASC LIMIT $${idx}`,
    values,
  );
  return result.rows;
}

async function getZoneById(id) {
  const result = await query(`${ZONE_SELECT} WHERE z.id = $1`, [id]);
  return result.rows[0] || null;
}

async function createZone(data, userId) {
  const payload = normalizeZonePayload(data);

  if (!payload.zone_code || !payload.zone_name) {
    throw createError('zone_code and zone_name are required', 400);
  }

  const fields = Object.keys(payload);
  const placeholders = fields.map((f, i) => {
    const p = `$${i + 1}`;
    return JSONB_FIELDS.has(f) ? `${p}::jsonb` : p;
  });
  const values = fields.map((f) => {
    if (JSONB_FIELDS.has(f) && payload[f] !== null && payload[f] !== undefined) {
      return JSON.stringify(payload[f]);
    }
    return payload[f];
  });

  const reviewedClause = payload.review_status === 'approved' && userId
    ? `, reviewed_by, reviewed_at`
    : '';
  const reviewedValues = payload.review_status === 'approved' && userId
    ? `, $${fields.length + 1}, now()`
    : '';
  if (reviewedClause) values.push(userId);

  const sql = `
    INSERT INTO regulatory_data.master_plan_zones
      (${fields.join(', ')}${reviewedClause})
    VALUES (${placeholders.join(', ')}${reviewedValues})
    RETURNING *
  `;

  try {
    const result = await query(sql, values);
    return await getZoneById(result.rows[0].id);
  } catch (err) {
    if (err.code === '23505') {
      throw createError(
        'A zone with this code already exists for the selected plan version and district.',
        409,
      );
    }
    throw err;
  }
}

function diffValues(before, after) {
  const diff = {};
  for (const key of Object.keys(after)) {
    const b = before[key];
    const a = after[key];
    const bSerial = b === null || b === undefined ? null : JSON.stringify(b);
    const aSerial = a === null || a === undefined ? null : JSON.stringify(a);
    if (bSerial !== aSerial) {
      diff[key] = { before: b ?? null, after: a ?? null };
    }
  }
  return diff;
}

async function updateZone(id, data, userId, { changeReason } = {}) {
  const existing = await getZoneById(id);
  if (!existing) throw createError('Zone not found.', 404);

  const payload = normalizeZonePayload(data);
  const fields = Object.keys(payload);
  if (fields.length === 0) return existing;

  const diff = diffValues(existing, payload);
  if (Object.keys(diff).length === 0) return existing;

  const setClauses = fields.map((f, i) => {
    const p = `$${i + 1}`;
    return JSONB_FIELDS.has(f) ? `${f} = ${p}::jsonb` : `${f} = ${p}`;
  });

  const values = fields.map((f) => {
    if (JSONB_FIELDS.has(f) && payload[f] !== null && payload[f] !== undefined) {
      return JSON.stringify(payload[f]);
    }
    return payload[f];
  });

  values.push(id);
  const idParam = `$${fields.length + 1}`;

  try {
    const result = await query(
      `UPDATE regulatory_data.master_plan_zones
       SET ${setClauses.join(', ')}
       WHERE id = ${idParam}
       RETURNING *`,
      values,
    );

    const previousSnapshot = {};
    for (const key of Object.keys(diff)) {
      previousSnapshot[key] = existing[key] ?? null;
    }

    await query(
      `INSERT INTO regulatory_data.zone_versions (zone_id, changed_by, previous_values, change_reason)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [id, userId || null, JSON.stringify(previousSnapshot), changeReason || null],
    );

    return await getZoneById(result.rows[0].id);
  } catch (err) {
    if (err.code === '23505') {
      throw createError(
        'A zone with this code already exists for the selected plan version and district.',
        409,
      );
    }
    throw err;
  }
}

async function reviewZone(id, { status, userId, changeReason }) {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw createError('status must be approved, rejected, or pending', 400);
  }
  const existing = await getZoneById(id);
  if (!existing) throw createError('Zone not found.', 404);

  const result = await query(
    `UPDATE regulatory_data.master_plan_zones
     SET review_status = $1::text,
         reviewed_by = $2::uuid,
         reviewed_at = CASE WHEN $1::text IN ('approved','rejected') THEN now() ELSE NULL END
     WHERE id = $3::uuid
     RETURNING *`,
    [status, userId || null, id],
  );

  await query(
    `INSERT INTO regulatory_data.zone_versions (zone_id, changed_by, previous_values, change_reason)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [
      id,
      userId || null,
      JSON.stringify({ review_status: existing.review_status, reviewed_by: existing.reviewed_by }),
      changeReason || `review → ${status}`,
    ],
  );

  return getZoneById(result.rows[0].id);
}

// Vercel serverless functions are capped at 60s (Pro plan max). When a
// Gemini extraction takes longer, the function gets killed before it can
// run its catch block, so the row is left at 'in_progress' forever and
// the admin UI shows a stuck "Extracting..." spinner.
//
// This reaper flips any in_progress row older than EXTRACTION_TIMEOUT_MS
// to 'failed' with a clear error message so the reviewer can retry. It
// runs at the start of every listDocuments() call — cheap, idempotent,
// no separate cron needed.
const EXTRACTION_STUCK_THRESHOLD_MS = 90 * 1000;

async function reapStuckExtractions() {
  try {
    // Two-clause WHERE handles both modern and legacy stuck rows:
    //  - rows that were started after PR #112 deployed have
    //    extraction_started_at and get reaped after the timeout.
    //  - rows that were stuck before PR #112 deployed (extraction_started_at
    //    is NULL because the column didn't exist) get reaped via created_at,
    //    using a longer 5-minute floor to avoid eating freshly-created rows
    //    that are legitimately on their first run.
    await query(
      `UPDATE regulatory_data.master_plan_documents
       SET extraction_status = 'failed',
           extraction_error = 'Extraction timed out before completion. Click Retry to re-run with the async extractor.'
       WHERE extraction_status = 'in_progress'
         AND deleted_at IS NULL
         AND (
           (extraction_started_at IS NOT NULL
             AND extraction_started_at < NOW() - ($1::int || ' milliseconds')::interval)
           OR
           (extraction_started_at IS NULL
             AND created_at < NOW() - INTERVAL '5 minutes')
         )`,
      [EXTRACTION_STUCK_THRESHOLD_MS],
    );
  } catch {
    // Reaper failures are intentionally swallowed — the read path should
    // not break if the cleanup write fails. The next call retries.
  }
}

async function listDocuments({ city } = {}) {
  await reapStuckExtractions();

  const conditions = ['deleted_at IS NULL'];
  const values = [];
  let idx = 1;

  if (city) {
    conditions.push(`LOWER(city) = LOWER($${idx++})`);
    values.push(city);
  }

  const result = await query(
    `SELECT id,
            city,
            plan_name,
            plan_version,
            file_name,
            file_type,
            file_size_bytes,
            file_url,
            storage_path,
            doc_type,
            source_role,
            legal_status,
            authority_name,
            published_on,
            source_url,
            page_count,
            processing_mode,
            text_coverage_ratio,
            ocr_required,
            source_confidence,
            registry_notes,
            extraction_status,
            zones_extracted,
            far_rules_extracted,
            guidance_rows_extracted,
            evidence_facts_extracted,
            extraction_error,
            evidence_source_id,
            extracted_at,
            created_at
     FROM regulatory_data.master_plan_documents
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    values,
  );
  return result.rows.map((doc) => ({
    ...doc,
    source_readiness: getSourceDocumentReadiness(doc),
  }));
}

async function getSourceDocumentUploadUrl({ fileName, fileSize = 0, organizationId }) {
  if (!organizationId) {
    throw createError('Active organization is required for masterplan source uploads.', 400);
  }
  if (!fileName) {
    throw createError('fileName is required.', 400);
  }

  assertSourceFileAllowed(fileName, fileSize);

  try {
    const result = await createUploadUrl(fileName, 'master-plan', organizationId);
    return {
      signedUrl: result.signedUrl,
      storagePath: result.path,
      token: result.token,
    };
  } catch (error) {
    throw createError(`Could not create upload URL: ${error.message}`, 500);
  }
}

async function confirmSourceDocumentUpload({
  storagePath,
  originalName,
  fileType,
  fileSize = 0,
  city = 'Bengaluru',
  planName,
  planVersion,
  docType,
  sourceRole,
  legalStatus,
  authorityName,
  publishedOn,
  sourceUrl,
  pageCount,
  processingMode,
  textCoverageRatio,
  ocrRequired,
  sourceConfidence,
  registryNotes,
  organizationId,
}) {
  if (!organizationId) {
    throw createError('Active organization is required for masterplan source uploads.', 400);
  }
  if (!storagePath) {
    throw createError('Storage path is required.', 400);
  }
  assertSourceFileAllowed(originalName || planName || storagePath, fileSize);

  try {
    masterplanCorpus.assertCorpusClassification({
      fileName: originalName || planName || storagePath,
      docType,
    });
  } catch (err) {
    if (err && err.statusCode) throw createError(err.message, err.statusCode);
    throw err;
  }

  const corpusMatch = masterplanCorpus.applyCorpusDefaults({
    fileName: originalName || planName || storagePath,
    requested: {
      planName,
      planVersion,
      docType,
      sourceRole,
      legalStatus,
      authorityName,
      processingMode,
      sourceConfidence,
      registryNotes,
      ocrRequired,
    },
  });

  const merged = corpusMatch.payload;
  planName = merged.planName;
  planVersion = merged.planVersion;
  docType = merged.docType;
  sourceRole = merged.sourceRole;
  legalStatus = merged.legalStatus;
  authorityName = merged.authorityName;
  processingMode = merged.processingMode;
  sourceConfidence = merged.sourceConfidence;
  registryNotes = merged.registryNotes;
  ocrRequired = merged.ocrRequired;

  const resolvedPlanName = textOrNull(planName) || textOrNull(originalName) || 'Masterplan source document';
  const normalizedProcessingMode = normalizeEnum(processingMode, PROCESSING_MODES, 'processing_mode')
    || 'text_extraction';
  const normalizedOcrRequired = normalizeBoolean(ocrRequired)
    || normalizedProcessingMode === 'ocr_required'
    || normalizedProcessingMode === 'image_review';
  const result = await query(
    `INSERT INTO regulatory_data.master_plan_documents (
       org_id,
       city,
       plan_name,
       plan_version,
       file_name,
       file_type,
       file_size_bytes,
       file_url,
       storage_path,
       doc_type,
       source_role,
       legal_status,
       authority_name,
       published_on,
       source_url,
       page_count,
       processing_mode,
       text_coverage_ratio,
       ocr_required,
       source_confidence,
       registry_notes,
       extraction_status
     )
     VALUES (
       $1::uuid,
       COALESCE($2, 'Bengaluru'),
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       $14,
       $15,
       $16,
       $17,
       $18,
       $19,
       $20,
       'pending'
     )
     RETURNING *`,
    [
      organizationId,
      textOrNull(city) || 'Bengaluru',
      resolvedPlanName,
      textOrNull(planVersion),
      textOrNull(originalName) || resolvedPlanName,
      textOrNull(fileType) || sourceFileExt(originalName || '').slice(1) || null,
      Number(fileSize) || 0,
      storagePath,
      normalizeDocType(docType),
      normalizeEnum(sourceRole, SOURCE_ROLES, 'source_role'),
      normalizeEnum(legalStatus, LEGAL_STATUSES, 'legal_status'),
      textOrNull(authorityName),
      normalizeDate(publishedOn, 'published_on'),
      textOrNull(sourceUrl),
      normalizePositiveInt(pageCount, 'page_count'),
      normalizedProcessingMode,
      normalizeRatio(textCoverageRatio, 'text_coverage_ratio'),
      normalizedOcrRequired,
      normalizeRatio(sourceConfidence, 'source_confidence'),
      textOrNull(registryNotes),
    ],
  );

  return result.rows[0];
}

async function getSourceDocumentById(id) {
  const result = await query(
    `SELECT *
     FROM regulatory_data.master_plan_documents
     WHERE id = $1::uuid
       AND deleted_at IS NULL
       AND (org_id IS NULL OR org_id = current_organization_id())`,
    [id],
  );
  return result.rows[0] || null;
}

async function updateSourceDocumentMetadata(id, data, userId, { changeReason } = {}) {
  const payload = normalizeSourceDocumentMetadataPayload(data);
  const fields = Object.keys(payload);
  if (fields.length === 0) {
    throw createError('At least one source metadata field is required.', 400);
  }

  const existing = await getSourceDocumentById(id);
  if (!existing) throw createError('Masterplan source document not found.', 404);

  const diff = diffValues(existing, payload);
  if (Object.keys(diff).length === 0) return existing;

  const setClauses = fields.map((field, index) => `${field} = $${index + 1}`);
  const values = fields.map((field) => payload[field]);
  values.push(id);

  const updated = await query(
    `UPDATE regulatory_data.master_plan_documents
     SET ${setClauses.join(', ')}
     WHERE id = $${fields.length + 1}::uuid
       AND deleted_at IS NULL
       AND (org_id IS NULL OR org_id = current_organization_id())
     RETURNING *`,
    values,
  );

  const doc = updated.rows[0];
  if (!doc) throw createError('Masterplan source document not found.', 404);

  const previousSnapshot = {};
  for (const key of Object.keys(diff)) {
    previousSnapshot[key] = existing[key] ?? null;
  }

  await query(
    `INSERT INTO regulatory_data.master_plan_document_versions
       (document_id, changed_by, previous_values, change_reason)
     VALUES ($1::uuid, $2::uuid, $3::jsonb, $4)`,
    [
      id,
      userId || null,
      JSON.stringify(previousSnapshot),
      changeReason || 'source metadata review',
    ],
  );

  return doc;
}

async function getSourceDocumentVersions(id) {
  const doc = await getSourceDocumentById(id);
  if (!doc) throw createError('Masterplan source document not found.', 404);

  const result = await query(
    `SELECT v.id,
            v.document_id,
            v.changed_by,
            u.name AS changed_by_name,
            v.previous_values,
            v.change_reason,
            v.changed_at
     FROM regulatory_data.master_plan_document_versions v
     LEFT JOIN public.users u ON u.id = v.changed_by
     WHERE v.document_id = $1::uuid
     ORDER BY v.changed_at DESC
     LIMIT 100`,
    [id],
  );
  return result.rows;
}

async function getSourceDocumentDownload(id) {
  const doc = await getSourceDocumentById(id);
  if (!doc) throw createError('Masterplan source document not found.', 404);
  const fileRef = doc.file_url || doc.storage_path;
  if (!fileRef) throw createError('Source document has no stored file reference.', 400);

  return {
    url: await getDownloadUrl(fileRef, 3600),
    expires_in: 3600,
    document: doc,
  };
}

async function listSourceDocumentPages(id) {
  const doc = await getSourceDocumentById(id);
  if (!doc) throw createError('Masterplan source document not found.', 404);

  try {
    const result = await query(
      `SELECT id,
              document_id,
              page_number,
              page_label,
              ocr_status,
              ocr_engine,
              text_coverage_ratio,
              page_checksum_sha256,
              page_image_url,
              citation_anchors,
              review_status,
              reviewer_notes,
              confidence_score,
              reviewed_by,
              reviewed_at,
              created_at,
              updated_at
       FROM regulatory_data.master_plan_document_pages
       WHERE document_id = $1::uuid
       ORDER BY page_number ASC
       LIMIT 1000`,
      [id],
    );

    return {
      schema_ready: true,
      document: {
        id: doc.id,
        plan_name: doc.plan_name,
        page_count: doc.page_count || null,
        processing_mode: doc.processing_mode || null,
        ocr_required: Boolean(doc.ocr_required),
      },
      pages: result.rows,
    };
  } catch (error) {
    if (isMissingOptionalSourceTable(error)) {
      return {
        schema_ready: false,
        document: {
          id: doc.id,
          plan_name: doc.plan_name,
          page_count: doc.page_count || null,
          processing_mode: doc.processing_mode || null,
          ocr_required: Boolean(doc.ocr_required),
        },
        pages: [],
        message: 'Page-level source storage is pending. Apply the source document pages migration before preparing OCR pages.',
      };
    }
    throw error;
  }
}

async function prepareSourceDocumentPages(id, { pageCount } = {}) {
  const doc = await getSourceDocumentById(id);
  if (!doc) throw createError('Masterplan source document not found.', 404);

  const resolvedPageCount = normalizePositiveInt(pageCount ?? doc.page_count, 'page_count');
  if (!resolvedPageCount) {
    throw createError('Set a page count before preparing the source page ledger.', 400);
  }
  if (resolvedPageCount > 1000) {
    throw createError('Page ledger preparation is limited to 1000 pages per source.', 400);
  }

  try {
    const created = await query(
      `INSERT INTO regulatory_data.master_plan_document_pages (
         document_id,
         page_number,
         ocr_status,
         review_status
       )
       SELECT $1::uuid,
              page_number,
              CASE
                WHEN $3::boolean THEN 'queued'
                ELSE 'not_started'
              END,
              CASE
                WHEN $3::boolean THEN 'needs_ocr'
                ELSE 'pending'
              END
       FROM generate_series(1, $2::int) AS page_number
       ON CONFLICT (document_id, page_number) DO NOTHING
       RETURNING id`,
      [id, resolvedPageCount, Boolean(doc.ocr_required)],
    );
    const listed = await listSourceDocumentPages(id);
    return {
      ...listed,
      pages_created: created.rows.length,
    };
  } catch (error) {
    if (isMissingOptionalSourceTable(error)) {
      return {
        schema_ready: false,
        document: {
          id: doc.id,
          plan_name: doc.plan_name,
          page_count: doc.page_count || null,
          processing_mode: doc.processing_mode || null,
          ocr_required: Boolean(doc.ocr_required),
        },
        pages: [],
        pages_created: 0,
        message: 'Page-level source storage is pending. Apply the source document pages migration before preparing OCR pages.',
      };
    }
    throw error;
  }
}

async function listBbmpUavEntries({ documentId, city, status = 'pending', search, limit = 100 } = {}) {
  const conditions = ['1=1'];
  const values = [];
  let idx = 1;

  if (documentId) {
    conditions.push(`document_id = $${idx++}::uuid`);
    values.push(documentId);
  }
  if (city) {
    conditions.push(`LOWER(city) = LOWER($${idx++})`);
    values.push(city);
  }
  if (status && status !== 'all') {
    conditions.push(`review_status = $${idx++}`);
    values.push(status);
  }
  if (search) {
    conditions.push(`(
      uav_zone_code ILIKE $${idx}
      OR ward_name ILIKE $${idx}
      OR road_name ILIKE $${idx}
      OR area_name ILIKE $${idx}
    )`);
    values.push(`%${search}%`);
    idx++;
  }

  values.push(Math.min(parseInt(limit, 10) || 100, 500));

  try {
    const result = await query(
      `SELECT id,
              org_id,
              document_id,
              evidence_source_id,
              page_id,
              city,
              authority_name,
              assessment_year,
              uav_zone_code,
              uav_zone_name,
              ward_number,
              ward_name,
              road_name,
              area_name,
              property_use,
              unit_area_value_inr,
              unit_label,
              source_page,
              source_section,
              confidence_score,
              review_status,
              notes,
              reviewed_by,
              reviewed_at,
              created_at,
              updated_at
       FROM regulatory_data.bbmp_uav_entries
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${idx}`,
      values,
    );
    return { schema_ready: true, rows: result.rows };
  } catch (error) {
    if (isMissingOptionalSourceTable(error)) {
      return {
        schema_ready: false,
        rows: [],
        message: 'BBMP UAV review storage is pending. Apply the source document pages migration before reviewing UAV rows.',
      };
    }
    throw error;
  }
}

// Synchronous part of an extraction request: validate the document, mark it
// in_progress, return the row to the caller. The actual Gemini work is run
// after the HTTP response is sent (see runExtractionJob).
async function queueExtractionJob(id, { docType } = {}) {
  const doc = await getSourceDocumentById(id);
  if (!doc) throw createError('Masterplan source document not found.', 404);
  if (!isExtractableSource(doc)) {
    throw createError('Only PDF and image source documents can be extracted in this intake flow.', 400);
  }
  const blockReason = getExtractionBlockReason(doc);
  if (blockReason) {
    throw createError(blockReason, 409);
  }

  const requestedDocType = normalizeDocType(docType) || normalizeDocType(doc.doc_type);

  await query(
    `UPDATE regulatory_data.master_plan_documents
     SET extraction_status = 'in_progress',
         extraction_error = NULL,
         extraction_started_at = NOW()
     WHERE id = $1::uuid`,
    [id],
  );

  return { document: { ...doc, extraction_status: 'in_progress' }, requestedDocType };
}

// Run the Gemini extraction + ingestion work. Always called *after* the row
// has been transitioned to 'in_progress' by queueExtractionJob. Errors here
// are captured into the document row, never thrown back to the caller —
// this is fire-and-forget from the HTTP layer.
async function runExtractionJob(id, { docType, userId } = {}) {
  const doc = await getSourceDocumentById(id);
  if (!doc) return;
  try {
    const requestedDocType = normalizeDocType(docType) || normalizeDocType(doc.doc_type);
    const extraction = await extractionService.extractStoredFileFields({
      fileUrl: doc.file_url || doc.storage_path,
      fileName: doc.file_name || doc.plan_name,
      mimeType: doc.file_type,
      userId,
      options: {
        docType: requestedDocType,
        context: {
          city: doc.city,
          plan_name: doc.plan_name,
          plan_version: doc.plan_version,
          source_role: doc.source_role,
          legal_status: doc.legal_status,
          authority_name: doc.authority_name,
          processing_mode: doc.processing_mode,
          ocr_required: doc.ocr_required,
        },
        attach: {
          masterPlanDocumentId: doc.id,
          userId: userId || null,
        },
      },
    });

    const ingestion = await evidenceIngestionService.ingestRegulatoryFields({
      docType: extraction.docType,
      fields: extraction.structuredFields || {},
      scores: extraction.confidenceScores || {},
      source: {
        master_plan_document_id: doc.id,
        org_id: doc.org_id,
        source_kind: 'official_pdf',
        source_url: doc.source_url,
        authority_name: doc.authority_name,
        source_title: doc.plan_name,
        document_name: doc.plan_name,
        file_name: doc.file_name,
        file_url: doc.file_url || doc.storage_path,
        storage_path: doc.storage_path,
        extraction_status: extraction.structuredFields ? 'completed' : 'failed',
      },
      userId,
    });

    const completed = Boolean(extraction.structuredFields);
    await query(
      `UPDATE regulatory_data.master_plan_documents
       SET extraction_status = $1,
           doc_type = $2,
           zones_extracted = $3,
           far_rules_extracted = $4,
           guidance_rows_extracted = $5,
           evidence_facts_extracted = $6,
           evidence_source_id = $7::uuid,
           extraction_error = $8,
           extracted_at = NOW()
       WHERE id = $9::uuid`,
      [
        completed ? 'completed' : 'failed',
        extraction.docType,
        ingestion.skipped ? 0 : Number(ingestion.zones_created || 0),
        ingestion.skipped ? 0 : Number(ingestion.far_rules_created || 0),
        ingestion.skipped ? 0 : Number(ingestion.guidance_values_created || 0),
        ingestion.skipped ? 0 : Number(ingestion.evidence_facts_created || 0),
        ingestion.skipped ? null : ingestion.source_id,
        extraction.parseError || (ingestion.skipped ? ingestion.reason : null),
        id,
      ],
    );
  } catch (error) {
    await query(
      `UPDATE regulatory_data.master_plan_documents
       SET extraction_status = 'failed',
           extraction_error = $1
       WHERE id = $2::uuid`,
      [error.message || 'Unknown extraction error', id],
    );
  }
}

// Legacy synchronous extraction — kept for tests and backward compat. New
// callers should use queueExtractionJob + runExtractionJob via the route's
// waitUntil pattern so the HTTP response returns immediately.
async function extractSourceDocument(id, { docType, userId } = {}) {
  const doc = await getSourceDocumentById(id);
  if (!doc) throw createError('Masterplan source document not found.', 404);
  if (!isExtractableSource(doc)) {
    throw createError('Only PDF and image source documents can be extracted in this intake flow.', 400);
  }
  const blockReason = getExtractionBlockReason(doc);
  if (blockReason) {
    throw createError(blockReason, 409);
  }

  await query(
    `UPDATE regulatory_data.master_plan_documents
     SET extraction_status = 'in_progress',
         extraction_error = NULL,
         extraction_started_at = NOW()
     WHERE id = $1::uuid`,
    [id],
  );

  try {
    const requestedDocType = normalizeDocType(docType) || normalizeDocType(doc.doc_type);
    const extraction = await extractionService.extractStoredFileFields({
      fileUrl: doc.file_url || doc.storage_path,
      fileName: doc.file_name || doc.plan_name,
      mimeType: doc.file_type,
      userId,
      options: {
        docType: requestedDocType,
        context: {
          city: doc.city,
          plan_name: doc.plan_name,
          plan_version: doc.plan_version,
          source_role: doc.source_role,
          legal_status: doc.legal_status,
          authority_name: doc.authority_name,
          processing_mode: doc.processing_mode,
          ocr_required: doc.ocr_required,
        },
        attach: {
          masterPlanDocumentId: doc.id,
          userId: userId || null,
        },
      },
    });

    const ingestion = await evidenceIngestionService.ingestRegulatoryFields({
      docType: extraction.docType,
      fields: extraction.structuredFields || {},
      scores: extraction.confidenceScores || {},
      source: {
        master_plan_document_id: doc.id,
        org_id: doc.org_id,
        source_kind: 'official_pdf',
        source_url: doc.source_url,
        authority_name: doc.authority_name,
        source_title: doc.plan_name,
        document_name: doc.plan_name,
        file_name: doc.file_name,
        file_url: doc.file_url || doc.storage_path,
        storage_path: doc.storage_path,
        extraction_status: extraction.structuredFields ? 'completed' : 'failed',
      },
      userId,
    });

    const completed = Boolean(extraction.structuredFields);
    const updated = await query(
      `UPDATE regulatory_data.master_plan_documents
       SET extraction_status = $1,
           doc_type = $2,
           zones_extracted = $3,
           far_rules_extracted = $4,
           guidance_rows_extracted = $5,
           evidence_facts_extracted = $6,
           evidence_source_id = $7::uuid,
           extraction_error = $8,
           extracted_at = NOW()
       WHERE id = $9::uuid
       RETURNING *`,
      [
        completed ? 'completed' : 'failed',
        extraction.docType,
        ingestion.skipped ? 0 : Number(ingestion.zones_created || 0),
        ingestion.skipped ? 0 : Number(ingestion.far_rules_created || 0),
        ingestion.skipped ? 0 : Number(ingestion.guidance_values_created || 0),
        ingestion.skipped ? 0 : Number(ingestion.evidence_facts_created || 0),
        ingestion.skipped ? null : ingestion.source_id,
        extraction.parseError || (ingestion.skipped ? ingestion.reason : null),
        id,
      ],
    );

    return {
      document: updated.rows[0],
      extraction: {
        doc_type: extraction.docType,
        status: completed ? 'completed' : 'failed',
        error_message: extraction.parseError || null,
      },
      ingestion,
    };
  } catch (error) {
    await query(
      `UPDATE regulatory_data.master_plan_documents
       SET extraction_status = 'failed',
           extraction_error = $1
       WHERE id = $2::uuid`,
      [error.message, id],
    );
    throw error;
  }
}

async function assignReviewedZoneToProperty({ zoneId, propertyId, userId, notes }) {
  const zone = await getZoneById(zoneId);
  if (!zone) throw createError('Zone not found.', 404);
  if (zone.review_status !== 'approved') {
    throw createError('Only approved master plan zones can be assigned to a property.', 409);
  }

  const propertyResult = await query(
    `SELECT p.id,
            p.name,
            p.address,
            p.zone_id,
            d.id AS deal_id
     FROM properties p
     LEFT JOIN deals d
       ON d.property_id = p.id
      AND d.organization_id = current_organization_id()
      AND d.is_archived = FALSE
      AND d.stage <> 'dead'
     WHERE p.id = $1::uuid
       AND p.organization_id = current_organization_id()
     ORDER BY d.updated_at DESC NULLS LAST
     LIMIT 1`,
    [propertyId],
  );

  const property = propertyResult.rows[0];
  if (!property) throw createError('Property not found.', 404);

  const updated = await query(
    `UPDATE properties
     SET zone_id = $1::uuid,
         zone_assigned_by = $2::uuid,
         zone_assigned_at = NOW(),
         zone_notes = $3,
         updated_at = NOW()
     WHERE id = $4::uuid
       AND organization_id = current_organization_id()
     RETURNING *`,
    [
      zone.id,
      userId || null,
      textOrNull(notes) || `Assigned approved ${zone.zone_code} zone from ${zone.plan_version || 'master plan source'}.`,
      property.id,
    ],
  );

  let activityId = null;
  if (property.deal_id) {
    const activity = await query(
      `INSERT INTO activities (
         deal_id,
         activity_type,
         description,
         performed_by,
         activity_date,
         is_important,
         status,
         priority,
         completed_at,
         completed_by
       )
       VALUES ($1, 'note', $2, $3, NOW(), TRUE, 'completed', 'medium', NOW(), $3)
       RETURNING id`,
      [
        property.deal_id,
        `Assigned reviewed master plan zone ${zone.zone_code} (${zone.zone_name}) to property.`,
        userId || null,
      ],
    );
    activityId = activity.rows[0]?.id || null;
    await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [property.deal_id]);
  }

  return {
    property: updated.rows[0],
    zone,
    activity_id: activityId,
  };
}

// T3 — Zoning overlay GeoJSON.
// Returns a GeoJSON FeatureCollection of approved zones with non-null geom.
// When (lat,lng) is provided, filters to a bbox via PostGIS — much cheaper
// than serialising every zone in the country. Falls back to global on no
// coordinates.
async function listZoneGeoJSON({ lat = null, lng = null, radiusKm = 5 } = {}) {
  const params = [];
  let geomFilter = '';

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // ST_DWithin on geography type takes radius in metres.
    params.push(lng, lat, radiusKm * 1000);
    geomFilter = `AND ST_DWithin(z.geom::geography, ST_SetSRID(ST_MakePoint($${params.length - 2}, $${params.length - 1}), 4326)::geography, $${params.length})`;
  }

  const result = await query(
    `SELECT
       z.id,
       z.zone_code,
       z.zone_name,
       z.planning_zone,
       z.permissible_fsi_base,
       z.permissible_fsi_max,
       z.review_status,
       ST_AsGeoJSON(z.geom)::jsonb AS geometry
     FROM regulatory_data.master_plan_zones z
     WHERE z.geom IS NOT NULL
       AND z.review_status = 'approved'
       ${geomFilter}
     LIMIT 200`,
    params,
  );

  const features = result.rows.map((row) => ({
    type: 'Feature',
    id: row.id,
    geometry: row.geometry,
    properties: {
      zone_code: row.zone_code,
      zone_name: row.zone_name,
      planning_zone: row.planning_zone,
      permissible_fsi_base: row.permissible_fsi_base ? Number(row.permissible_fsi_base) : null,
      permissible_fsi_max: row.permissible_fsi_max ? Number(row.permissible_fsi_max) : null,
      review_status: row.review_status,
    },
  }));

  return {
    type: 'FeatureCollection',
    features,
    meta: {
      total_zones_with_geom: features.length,
      bbox_filtered: Boolean(geomFilter),
      radius_km: geomFilter ? radiusKm : null,
    },
  };
}

async function getZoneVersions(zoneId) {
  const result = await query(
    `SELECT v.*, u.name AS changed_by_name
     FROM regulatory_data.zone_versions v
     LEFT JOIN public.users u ON u.id = v.changed_by
     WHERE v.zone_id = $1
     ORDER BY v.changed_at DESC`,
    [zoneId],
  );
  return result.rows;
}

async function listMasterplanCorpus({ city } = {}) {
  const docs = await listDocuments({ city });
  return masterplanCorpus.buildCorpusStatus(docs);
}

// District intelligence — joins the 42 seeded planning_districts with the
// per-district demographics fact extracted from Volume 4 PDR plus the
// landmark / SDZ / heritage callouts from the maps. Returns one enriched
// record per PD so the UI can render demographics + adjacency context
// without making a second round-trip.
async function getDistrictIntelligence() {
  const districtsResult = await query(
    `SELECT id, pd_code, pd_name, city
     FROM regulatory_data.planning_districts
     WHERE city = 'Bengaluru'
     ORDER BY pd_code`,
  );
  const districts = districtsResult.rows;

  // Pull rich per-district facts (populations, areas, densities) plus the
  // city-wide callouts in one shot so we can stitch them client-side cheaply.
  const factsResult = await query(
    `SELECT fact_type, fact_key, fact_value, page_number, source_section, confidence_score
     FROM regulatory_data.evidence_facts
     WHERE (fact_type = 'rmp_table' AND fact_key = 'planning_districts')
        OR fact_type IN ('sdz', 'heritage', 'landmark', 'boundary', 'environmental', 'road_network')`,
  );

  const facts = factsResult.rows;

  // Find the richest planning_districts fact (the one with full
  // population/area metadata). There are typically two rmp_table rows —
  // a routing-key list and the full PDR-derived list. Pick the one whose
  // entries carry a `notes` field (that's the rich one).
  const districtFactCandidates = facts
    .filter((f) => f.fact_type === 'rmp_table' && f.fact_key === 'planning_districts' && Array.isArray(f.fact_value))
    .map((f) => f.fact_value);
  const richDistrictFacts = districtFactCandidates.find((arr) => arr.some((d) => d && d.notes))
    || districtFactCandidates[0]
    || [];

  // Build a normalised lookup keyed by zero-padded pd_code (PD-01 style)
  const lookup = new Map();
  for (const entry of richDistrictFacts) {
    const code = normalizePdCode(entry?.pd_code);
    if (!code) continue;
    lookup.set(code, entry);
  }

  const sdzFact = facts.find((f) => f.fact_type === 'sdz' && f.fact_key === 'special_development_zones')?.fact_value || null;
  const heritage = facts.find((f) => f.fact_type === 'heritage' && f.fact_key === 'heritage_zones')?.fact_value || null;
  const ngt = facts.find((f) => f.fact_type === 'environmental' && f.fact_key === 'ngt_drainage_classification')?.fact_value || null;
  const regionalParks = facts.find((f) => f.fact_type === 'environmental' && f.fact_key === 'regional_parks')?.fact_value || null;
  const landmarks = facts.find((f) => f.fact_type === 'landmark' && f.fact_key === 'major_landmarks_in_bma')?.fact_value || [];
  const adjacentAuthorities = facts.find((f) => f.fact_type === 'boundary' && f.fact_key === 'adjacent_planning_authorities')?.fact_value || [];
  const peripheralRing = facts.find((f) => f.fact_type === 'road_network' && f.fact_key === 'peripheral_ring_road')?.fact_value || null;

  const enrichedDistricts = districts.map((d) => {
    const entry = lookup.get(normalizePdCode(d.pd_code)) || null;
    const parsed = parseDistrictNotes(entry?.notes);
    const isSdz = /special development zone/i.test(d.pd_name || '');
    return {
      id: d.id,
      pd_code: d.pd_code,
      pd_name: d.pd_name,
      is_sdz: isSdz,
      population_2011: parsed.population,
      area_ha: parsed.area_ha,
      gross_density_pph: parsed.density,
      ward_count: parsed.wards,
      village_count: parsed.villages,
      source_page: entry?.source_page || null,
      source_section: entry?.source_section || null,
      raw_notes: entry?.notes || null,
    };
  });

  // Aggregate stats for the StatTiles
  const totalPopulation = enrichedDistricts.reduce((sum, d) => sum + (d.population_2011 || 0), 0);
  const totalArea = enrichedDistricts.reduce((sum, d) => sum + (d.area_ha || 0), 0);
  const sdzCount = enrichedDistricts.filter((d) => d.is_sdz).length;
  const populatedDistricts = enrichedDistricts.filter((d) => d.population_2011);
  const weightedDensity = populatedDistricts.length > 0
    ? populatedDistricts.reduce((sum, d) => sum + (d.population_2011 || 0), 0)
        / Math.max(1, populatedDistricts.reduce((sum, d) => sum + (d.area_ha || 0), 0))
    : null;

  return {
    districts: enrichedDistricts,
    summary: {
      district_count: enrichedDistricts.length,
      sdz_count: sdzCount,
      total_population_2011: totalPopulation,
      total_area_ha: Math.round(totalArea),
      mean_density_pph: weightedDensity ? Math.round(weightedDensity) : null,
    },
    callouts: {
      sdz: sdzFact,
      heritage,
      ngt,
      regional_parks: regionalParks,
      landmarks,
      adjacent_authorities: adjacentAuthorities,
      peripheral_ring: peripheralRing,
    },
    disclaimer: 'AI-extracted from RMP 2031 Volume 4 PDR (per-district demographics) and Existing/Proposed Land Use maps (landmarks, boundaries, callouts). Verify against the published RMP 2031 before quoting in IC memos.',
  };
}

// Normalise "PD 1" / "PD 01" / "PD-01" / "PD-1" to "PD-01" so the join
// with the seeded planning_districts table (which uses PD-01..PD-42)
// always lands.
function normalizePdCode(code) {
  if (!code) return null;
  const match = String(code).trim().match(/PD[\s-]*(\d+)/i);
  if (!match) return null;
  return `PD-${String(parseInt(match[1], 10)).padStart(2, '0')}`;
}

// Parse the loose-text notes field from the Volume 4 PDR fact into
// structured fields. Notes look like:
//   "Population (2011 Census): 5,93,883; Area of PD: 2774.3 ha; Wards in PD: 19; Gross Density: 214PPH"
// or use sqkm or mix of variants. We do best-effort regex extraction.
function parseDistrictNotes(notes) {
  if (!notes) return { population: null, area_ha: null, density: null, wards: null, villages: null };
  const text = String(notes);

  // Population: skip past any parenthetical "(2011 Census)" qualifier; lock onto
  // the colon that precedes the actual number. Example: "Population (2011 Census): 5,93,883".
  const popMatch = text.match(/Population[^:]*:\s*([\d,]+)/i);
  const population = popMatch ? Number(popMatch[1].replace(/,/g, '')) : null;

  // Area: prefer the Ha value when both sqkm and ha are listed.
  const haMatch = text.match(/Area[^()]*?(?:\(([\d.]+)\s*ha\)|([\d,.]+)\s*(?:Ha|ha))/i);
  let area_ha = null;
  if (haMatch) {
    area_ha = Number((haMatch[1] || haMatch[2] || '').replace(/,/g, ''));
  } else {
    const sqkmMatch = text.match(/Area[^()]*?([\d.]+)\s*sq\.?\s*km/i);
    if (sqkmMatch) area_ha = Math.round(Number(sqkmMatch[1]) * 100);
  }
  if (!Number.isFinite(area_ha)) area_ha = null;

  // Density: skip past any "(2011 Census)" parenthetical to the `:` or `=` that
  // precedes the number. Examples we need to cover:
  //   "Gross Density: 214PPH"
  //   "Gross Density (2011 Census): 436 pph"
  //   "Gross Density= 20PPH"
  const densityMatch = text.match(/Density[^:=]*[:=]\s*=?\s*(\d+(?:\.\d+)?)\s*p?ph/i);
  const density = densityMatch ? Number(densityMatch[1]) : null;

  const wardsMatch = text.match(/Wards in PD:\s*(\d+)/i);
  const wards = wardsMatch ? Number(wardsMatch[1]) : null;

  // Villages count comes under several spellings ("Villages", "Gramathanas",
  // "Gramthana") and label variants ("in PD" / "Number of Villages").
  const villagesMatch = text.match(/(?:Villages|Gramathanas|Gramthana)(?:\s+in\s+PD)?:\s*(\d+)/i)
    || text.match(/Number of Villages:\s*(\d+)/i);
  const villages = villagesMatch ? Number(villagesMatch[1]) : null;

  return { population, area_ha, density, wards, villages };
}

// Land-use intelligence — pulls the existing/proposed BMA land-use breakdown
// facts seeded from the Existing Land Use 2015 + Proposed Land Use 2031
// maps. Returns paired rows so the UI can render the 2015 → 2031 shift.
// Source explorer — returns every evidence_source with its facts grouped by
// page_number. Lets the UI render a "what facts came from which page of which
// document?" browser. Critical for IC defensibility: every number REDIP shows
// must be one click away from the exact PDF page it was extracted from.
async function getSourceExplorer() {
  const sourcesResult = await query(
    `SELECT
       s.id,
       s.document_id,
       s.source_kind,
       s.source_title,
       s.plan_version,
       s.authority_name,
       s.city,
       s.created_at,
       d.file_name,
       d.plan_name,
       d.doc_type,
       d.legal_status,
       d.source_role,
       d.processing_mode
     FROM regulatory_data.evidence_sources s
     LEFT JOIN regulatory_data.master_plan_documents d ON d.id = s.document_id
     ORDER BY s.created_at DESC`,
  );

  const factsResult = await query(
    `SELECT
       id,
       source_id,
       fact_type,
       fact_key,
       fact_value,
       page_number,
       source_section,
       confidence_score,
       review_status,
       created_at
     FROM regulatory_data.evidence_facts
     ORDER BY page_number NULLS LAST, fact_type, fact_key`,
  );

  const factsBySource = new Map();
  for (const fact of factsResult.rows) {
    const arr = factsBySource.get(fact.source_id) || [];
    arr.push(fact);
    factsBySource.set(fact.source_id, arr);
  }

  const sources = sourcesResult.rows.map((s) => {
    const facts = factsBySource.get(s.id) || [];
    const pageNumbers = facts
      .map((f) => f.page_number)
      .filter((p) => p !== null && p !== undefined && Number.isFinite(Number(p)))
      .map((p) => Number(p));
    const factTypes = [...new Set(facts.map((f) => f.fact_type))].sort();
    return {
      id: s.id,
      document_id: s.document_id,
      source_kind: s.source_kind,
      source_title: s.source_title,
      plan_version: s.plan_version,
      authority_name: s.authority_name,
      city: s.city,
      file_name: s.file_name,
      plan_name: s.plan_name,
      doc_type: s.doc_type,
      legal_status: s.legal_status,
      source_role: s.source_role,
      processing_mode: s.processing_mode,
      fact_count: facts.length,
      page_count: new Set(pageNumbers).size,
      fact_types: factTypes,
      first_page: pageNumbers.length ? Math.min(...pageNumbers) : null,
      last_page: pageNumbers.length ? Math.max(...pageNumbers) : null,
      created_at: s.created_at,
      facts,
    };
  }).filter((s) => s.fact_count > 0);

  // Aggregate summary
  const totalFacts = sources.reduce((sum, s) => sum + s.fact_count, 0);
  const linkedDocs = sources.filter((s) => s.document_id).length;
  const factTypeCounts = {};
  for (const s of sources) {
    for (const f of s.facts) {
      factTypeCounts[f.fact_type] = (factTypeCounts[f.fact_type] || 0) + 1;
    }
  }

  return {
    sources,
    summary: {
      source_count: sources.length,
      fact_count: totalFacts,
      linked_doc_count: linkedDocs,
      fact_type_counts: factTypeCounts,
    },
    disclaimer: 'Each fact below traces back to a specific source-document page. AI-extracted facts must be verified against the underlying PDF before being quoted in IC memos.',
  };
}

async function getLandUseIntelligence() {
  const result = await query(
    `SELECT id, source_id, fact_type, fact_key, fact_value, source_section, page_number, confidence_score
     FROM regulatory_data.evidence_facts
     WHERE fact_type IN ('land_use_total', 'land_use_share', 'road_network', 'environmental', 'sdz', 'heritage')
     ORDER BY fact_type, fact_key`,
  );
  const rows = result.rows;

  const existingShares = rows
    .filter((r) => r.fact_type === 'land_use_share' && r.fact_key.startsWith('existing_'))
    .map((r) => ({
      key: r.fact_key.replace(/^existing_/, '').replace(/_pct$/, ''),
      label: prettyCategory(r.fact_key.replace(/^existing_/, '').replace(/_pct$/, '')),
      value: Number(r.fact_value?.value ?? 0),
      absolute_ha: r.fact_value?.absolute_ha ?? null,
      year: r.fact_value?.year ?? 2015,
      source_section: r.source_section,
    }));

  const proposedShares = rows
    .filter((r) => r.fact_type === 'land_use_share' && r.fact_key.startsWith('proposed_'))
    .map((r) => ({
      key: r.fact_key.replace(/^proposed_/, '').replace(/_pct$/, ''),
      label: prettyCategory(r.fact_key.replace(/^proposed_/, '').replace(/_pct$/, '')),
      value: Number(r.fact_value?.value ?? 0),
      absolute_ha: r.fact_value?.absolute_ha ?? null,
      year: r.fact_value?.year ?? 2031,
      source_section: r.source_section,
    }));

  const totals = rows
    .filter((r) => r.fact_type === 'land_use_total')
    .map((r) => ({
      key: r.fact_key,
      label: prettyCategory(r.fact_key),
      value: r.fact_value,
      source_section: r.source_section,
    }));

  const callouts = rows
    .filter((r) => ['road_network', 'environmental', 'sdz', 'heritage'].includes(r.fact_type))
    .map((r) => ({
      type: r.fact_type,
      key: r.fact_key,
      value: r.fact_value,
      source_section: r.source_section,
    }));

  return {
    existing: existingShares,
    proposed: proposedShares,
    totals,
    callouts,
    disclaimer: 'AI-extracted from Volume 4 + Existing Land Use 2015 + Proposed Land Use 2031 maps. Verify against the published RMP 2031 before quoting.',
  };
}

const PRETTY = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  psp: 'Public & Semi-Public',
  psp_defence: 'PSP — Defence',
  parks_open: 'Parks & Open Spaces',
  transport: 'Transport & Communication',
  vacant: 'Vacant',
  agriculture: 'Agriculture',
  water_bodies: 'Water Bodies',
  ngt_buffer: 'NGT Buffer',
  bma_total_area: 'BMA Total Area',
  bma_developable_area: 'Developable Area',
  proposed_agriculture_outside_dev: 'Agriculture (outside developable)',
};

function prettyCategory(key) {
  return PRETTY[key] || String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const ALLOWED_GEOJSON_GEOMETRY_TYPES = new Set(['Polygon', 'MultiPolygon']);

// Import polygon geometry for already-reviewed master plan zones from a
// GeoJSON FeatureCollection. Never creates new zones — geometry can only
// attach to a zone that has already gone through the human review path.
//
// Each feature must carry properties.zone_code; planVersion can be set per
// feature or via the top-level argument (default 'RMP 2031 Provisional').
// By default, features are skipped when a zone already has geometry; pass
// overwriteGeom=true to replace existing geometry. Every change is recorded
// in zone_versions so the audit trail keeps working.
async function importZoneGeoJSON({
  featureCollection,
  planVersion = 'RMP 2031 Provisional',
  changeReason,
  overwriteGeom = false,
  userId,
} = {}) {
  if (!featureCollection || typeof featureCollection !== 'object') {
    throw createError('featureCollection must be a GeoJSON object.', 400);
  }
  if (featureCollection.type !== 'FeatureCollection') {
    throw createError('featureCollection.type must be "FeatureCollection".', 400);
  }
  const features = Array.isArray(featureCollection.features) ? featureCollection.features : null;
  if (!features || features.length === 0) {
    throw createError('featureCollection.features must be a non-empty array.', 400);
  }
  if (features.length > 500) {
    throw createError('A single import is limited to 500 features.', 413);
  }

  const summary = {
    received: features.length,
    updated: 0,
    skipped_existing_geom: 0,
    skipped_unknown_zone: 0,
    rejected: 0,
    updates: [],
    errors: [],
  };

  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    const props = feature?.properties || {};
    const geometry = feature?.geometry;
    const zoneCode = textOrNull(props.zone_code);
    const featurePlanVersion = textOrNull(props.plan_version) || planVersion;

    if (!zoneCode) {
      summary.rejected += 1;
      summary.errors.push({ index, reason: 'feature is missing properties.zone_code' });
      continue;
    }
    if (!geometry || !ALLOWED_GEOJSON_GEOMETRY_TYPES.has(geometry.type)) {
      summary.rejected += 1;
      summary.errors.push({
        index,
        zone_code: zoneCode,
        reason: 'feature.geometry must be a Polygon or MultiPolygon',
      });
      continue;
    }
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      summary.rejected += 1;
      summary.errors.push({ index, zone_code: zoneCode, reason: 'feature.geometry.coordinates is empty' });
      continue;
    }

    const lookup = await query(
      `SELECT id, zone_code, plan_version, geom IS NOT NULL AS has_geom,
              ST_AsGeoJSON(geom)::jsonb AS geom_geojson
         FROM regulatory_data.master_plan_zones
        WHERE UPPER(zone_code) = UPPER($1)
          AND ($2::text IS NULL OR plan_version = $2)
        LIMIT 1`,
      [zoneCode, featurePlanVersion],
    );
    const existing = lookup.rows[0];

    if (!existing) {
      summary.skipped_unknown_zone += 1;
      summary.errors.push({
        index,
        zone_code: zoneCode,
        plan_version: featurePlanVersion,
        reason: 'no reviewed zone matches this zone_code + plan_version',
      });
      continue;
    }

    if (existing.has_geom && !overwriteGeom) {
      summary.skipped_existing_geom += 1;
      continue;
    }

    const updated = await query(
      `UPDATE regulatory_data.master_plan_zones
          SET geom = ST_GeomFromGeoJSON($1::text)
        WHERE id = $2::uuid
        RETURNING id, zone_code, plan_version`,
      [JSON.stringify(geometry), existing.id],
    );

    if (updated.rows.length === 0) {
      summary.rejected += 1;
      summary.errors.push({ index, zone_code: zoneCode, reason: 'update returned no rows' });
      continue;
    }

    await query(
      `INSERT INTO regulatory_data.zone_versions (zone_id, changed_by, previous_values, change_reason)
       VALUES ($1::uuid, $2::uuid, $3::jsonb, $4)`,
      [
        existing.id,
        userId || null,
        JSON.stringify({ geom: existing.geom_geojson || null }),
        changeReason || 'GeoJSON import',
      ],
    );

    summary.updated += 1;
    summary.updates.push({
      zone_id: updated.rows[0].id,
      zone_code: updated.rows[0].zone_code,
      plan_version: updated.rows[0].plan_version,
      replaced_geom: Boolean(existing.has_geom),
    });
  }

  return summary;
}

module.exports = {
  calculateEffectiveFSI,
  getSourceDocumentReadiness,
  searchZones,
  getZoneById,
  createZone,
  updateZone,
  reviewZone,
  listDocuments,
  getSourceDocumentUploadUrl,
  confirmSourceDocumentUpload,
  updateSourceDocumentMetadata,
  getSourceDocumentVersions,
  getSourceDocumentDownload,
  listSourceDocumentPages,
  prepareSourceDocumentPages,
  listBbmpUavEntries,
  listMasterplanCorpus,
  getLandUseIntelligence,
  getDistrictIntelligence,
  getSourceExplorer,
  parseDistrictNotes,
  normalizePdCode,
  importZoneGeoJSON,
  extractSourceDocument,
  queueExtractionJob,
  runExtractionJob,
  assignReviewedZoneToProperty,
  getZoneVersions,
  listZoneGeoJSON,
};
