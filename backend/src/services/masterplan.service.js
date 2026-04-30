'use strict';

const path = require('path');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { createUploadUrl, getDownloadUrl } = require('../config/storage');
const extractionService = require('./extraction.service');
const evidenceIngestionService = require('./evidenceIngestion.service');
const masterplanCorpus = require('./masterplanCorpus');

const ALLOWED_SOURCE_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
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

async function listDocuments({ city } = {}) {
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
         extraction_error = NULL
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
  extractSourceDocument,
  assignReviewedZoneToProperty,
  getZoneVersions,
  listZoneGeoJSON,
};
