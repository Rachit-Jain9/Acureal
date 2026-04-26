'use strict';

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');

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
    `SELECT id, city, plan_name, plan_version, extraction_status, zones_extracted, created_at
     FROM regulatory_data.master_plan_documents
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    values,
  );
  return result.rows;
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

module.exports = {
  calculateEffectiveFSI,
  searchZones,
  getZoneById,
  createZone,
  updateZone,
  reviewZone,
  listDocuments,
  getZoneVersions,
};
