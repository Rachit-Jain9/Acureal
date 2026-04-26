const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const landeedAdapter = require('./adapters/landeed.adapter');
const { getProviderAvailability } = require('./ai/providerRegistry');

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_review']);
const REVIEW_TYPES = new Set(['evidence_source', 'evidence_fact', 'guidance_value', 'far_rule']);
const AUTHORITY_INPUT_KINDS = new Set(['property_fact', 'guidance_value', 'far_rule']);
const SQFT_PER_ACRE = 43560;
const METERS_PER_FOOT = 0.3048;

const PROPERTY_PROMOTION_LABELS = {
  survey_number: 'Survey number',
  pid: 'PID',
  khata_no: 'Khata no.',
  owner_name: 'Owner name',
  land_area_sqft: 'Land area',
  road_width_mtrs: 'Road width',
};

const MANUAL_PROPERTY_FACTS = new Set([
  'survey_number',
  'pid',
  'khata_no',
  'owner_name',
  'land_area_sqft',
  'land_area_acres',
  'road_width_mtrs',
  'road_width_ft',
]);

const textOrNull = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => textOrNull(item))
      .filter(Boolean)
      .join(', ') || null;
  }
  if (typeof value === 'object') return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
};

const requireText = (value, label, max = 500) => {
  const normalized = textOrNull(value);
  if (!normalized) throw createError(`${label} is required.`, 400);
  return normalized.slice(0, max);
};

const requireNumber = (value, label) => {
  const numeric = numberOrNull(value);
  if (numeric === null) throw createError(`${label} must be a number.`, 400);
  return numeric;
};

const optionalNumber = (value) => numberOrNull(value);

const toJsonValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) || typeof value === 'object') return value;
  const numeric = numberOrNull(value);
  if (numeric !== null && String(value).trim().match(/^-?[\d,]+(\.\d+)?$/)) return numeric;
  return String(value).trim();
};

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
};

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const buildPromotionUpdate = (factKey, factValue) => {
  const key = String(factKey || '').toLowerCase();

  if (['survey_number', 'survey_numbers', 'survey_no', 'sy_no'].includes(key)) {
    const value = textOrNull(factValue);
    return value ? { field: 'survey_number', value, updates: { survey_number: value } } : null;
  }

  if (['pid', 'pid_number'].includes(key)) {
    const value = textOrNull(factValue);
    return value ? { field: 'pid', value, updates: { pid: value } } : null;
  }

  if (['khata_number', 'khata_no'].includes(key)) {
    const value = textOrNull(factValue);
    return value ? { field: 'khata_no', value, updates: { khata_no: value } } : null;
  }

  if (key === 'owner_name') {
    const value = textOrNull(factValue);
    return value ? { field: 'owner_name', value, updates: { owner_name: value } } : null;
  }

  if (['land_area_sqft', 'area_sqft', 'total_area_sqft', 'total_land_area_sqft', 'site_area_sqft', 'plot_area_sqft'].includes(key)) {
    const value = numberOrNull(factValue);
    return value
      ? {
          field: 'land_area_sqft',
          value: round(value),
          updates: {
            land_area_sqft: round(value),
            land_area_input_value: round(value),
            land_area_input_unit: 'sqft',
          },
        }
      : null;
  }

  if (['land_area_acres', 'area_acres', 'total_area_acres', 'total_land_area_acres', 'plot_area_acres'].includes(key)) {
    const value = numberOrNull(factValue);
    return value
      ? {
          field: 'land_area_sqft',
          value: round(value * SQFT_PER_ACRE),
          updates: {
            land_area_sqft: round(value * SQFT_PER_ACRE),
            land_area_input_value: value,
            land_area_input_unit: 'acre',
          },
        }
      : null;
  }

  if (['road_width_m', 'road_width_mtrs', 'abutting_road_width_m'].includes(key)) {
    const value = numberOrNull(factValue);
    return value ? { field: 'road_width_mtrs', value: round(value, 3), updates: { road_width_mtrs: round(value, 3) } } : null;
  }

  if (key === 'road_width_ft') {
    const value = numberOrNull(factValue);
    return value ? { field: 'road_width_mtrs', value: round(value * METERS_PER_FOOT, 3), updates: { road_width_mtrs: round(value * METERS_PER_FOOT, 3) } } : null;
  }

  return null;
};

const getCurrentPropertyValue = (currentValues = {}, field) => currentValues?.[field] ?? null;

const normalizePromotionValue = (value) => {
  if (typeof value === 'number') return String(round(value, 3));
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
};

const buildPromotionMetadata = (row) => {
  if (row.type !== 'evidence_fact') return null;

  const promotion = buildPromotionUpdate(row.title, row.payload?.fact_value);
  if (!promotion) {
    return { supported: false, promotable: false, reason: 'unsupported_fact' };
  }

  const propertyId = row.payload?.property_id || null;
  if (!propertyId) {
    return {
      supported: true,
      promotable: false,
      reason: 'no_linked_property',
      field: promotion.field,
      label: PROPERTY_PROMOTION_LABELS[promotion.field],
      value: promotion.value,
    };
  }

  const currentValue = getCurrentPropertyValue(row.payload?.current_property_values, promotion.field);
  const approvalRequired = row.review_status !== 'approved';
  const alreadyPopulated = hasValue(currentValue);

  return {
    supported: true,
    promotable: !approvalRequired && !alreadyPopulated,
    reason: approvalRequired ? 'approval_required' : alreadyPopulated ? 'already_populated' : null,
    field: promotion.field,
    label: PROPERTY_PROMOTION_LABELS[promotion.field],
    value: promotion.value,
    current_value: currentValue,
    property_id: propertyId,
    property_name: row.payload?.property_name || null,
    deal_id: row.payload?.deal_id || null,
  };
};

const attachPromotionMetadata = (row) => ({
  ...row,
  promotion: buildPromotionMetadata(row),
});

const clampLimit = (value, fallback = 50, max = 200) => {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, max);
};

const normalizeStatus = (status = 'pending') => {
  if (status === 'all') return 'all';
  if (!REVIEW_STATUSES.has(status)) return 'pending';
  return status;
};

const normalizeType = (type = 'all') => (REVIEW_TYPES.has(type) ? type : 'all');

const normalizeSearch = (value) => {
  const text = textOrNull(value);
  return text ? text.slice(0, 120) : null;
};

const countByStatus = async (tableName) => {
  const result = await query(
    `SELECT review_status, COUNT(*)::int AS count
     FROM ${tableName}
     GROUP BY review_status`
  );

  return result.rows.reduce((acc, row) => {
    acc[row.review_status || 'unknown'] = Number(row.count || 0);
    return acc;
  }, {});
};

const countScalar = async (sql, params = []) => {
  const result = await query(sql, params);
  return Number(result.rows[0]?.count || 0);
};

const getStatus = async () => {
  const providerAvailability = getProviderAvailability();
  const [
    evidenceSources,
    evidenceFacts,
    guidanceValues,
    farRules,
    pendingQueueCount,
    kgisCacheCount,
    kgisFreshCount,
    latestSnapshot,
    latestEvidence,
  ] = await Promise.all([
    countByStatus('regulatory_data.evidence_sources'),
    countByStatus('regulatory_data.evidence_facts'),
    countByStatus('regulatory_data.guidance_values'),
    countByStatus('regulatory_data.far_rules'),
    countScalar(
      `SELECT (
        (SELECT COUNT(*) FROM regulatory_data.evidence_sources WHERE review_status IN ('pending', 'needs_review')) +
        (SELECT COUNT(*) FROM regulatory_data.evidence_facts WHERE review_status IN ('pending', 'needs_review')) +
        (SELECT COUNT(*) FROM regulatory_data.guidance_values WHERE review_status IN ('pending', 'needs_review')) +
        (SELECT COUNT(*) FROM regulatory_data.far_rules WHERE review_status IN ('pending', 'needs_review'))
      )::int AS count`
    ),
    countScalar('SELECT COUNT(*) FROM regulatory_data.kgis_cache'),
    countScalar(
      `SELECT COUNT(*)
       FROM regulatory_data.kgis_cache
       WHERE expires_at IS NULL OR expires_at > NOW()`
    ),
    query(
      `SELECT generated_at
       FROM regulatory_data.parcel_intelligence_snapshots
       ORDER BY generated_at DESC
       LIMIT 1`
    ),
    query(
      `SELECT created_at
       FROM regulatory_data.evidence_sources
       ORDER BY created_at DESC
       LIMIT 1`
    ),
  ]);

  return {
    review_queue: {
      pending_or_needs_review: pendingQueueCount,
      evidence_sources: evidenceSources,
      evidence_facts: evidenceFacts,
      guidance_values: guidanceValues,
      far_rules: farRules,
    },
    providers: {
      landeed: landeedAdapter.getStatus(),
      igr_pdf: {
        provider: 'igr_pdf',
        status: providerAvailability.gemini ? 'parser_available' : 'not_configured',
        message: providerAvailability.gemini
          ? 'IGR PDF text parsing can propose guidance rows, but human approval is required before use.'
          : 'Set GEMINI_API_KEY to enable PDF extraction into the review queue.',
      },
      kgis: {
        provider: 'kgis',
        status: process.env.KGIS_BASE_URL ? 'configured' : 'default_endpoint',
        message: 'K-GIS hierarchy/survey/geometry lookup is reference-only and cached per property.',
      },
    },
    cache: {
      kgis_rows: kgisCacheCount,
      kgis_fresh_rows: kgisFreshCount,
      latest_snapshot_at: latestSnapshot.rows[0]?.generated_at || null,
      latest_evidence_source_at: latestEvidence.rows[0]?.created_at || null,
    },
  };
};

const queueQueries = {
  evidence_source: ({ status, limit, search, dealId }) => query(
    `SELECT
       'evidence_source' AS type,
       es.id,
       es.source_kind AS category,
       es.source_title AS title,
       es.authority_name,
       es.vendor_name,
       es.source_url,
       es.review_status,
       es.extraction_status,
       es.confidence_score,
       es.created_at,
       es.updated_at,
       NULL::int AS source_page,
       NULL::text AS source_section,
       jsonb_build_object(
         'city', es.city,
         'plan_version', es.plan_version,
         'effective_from', es.effective_from,
         'effective_to', es.effective_to,
         'checksum_sha256', es.checksum_sha256,
         'notes', es.notes,
         'document_id', es.document_id,
         'deal_id', d.id,
         'deal_name', d.name,
         'property_id', p.id,
         'property_name', COALESCE(NULLIF(p.name, ''), NULLIF(p.address, ''))
       ) AS payload
     FROM regulatory_data.evidence_sources es
     LEFT JOIN documents doc ON doc.id = es.document_id
     LEFT JOIN deals d ON d.id = doc.deal_id
     LEFT JOIN properties p ON p.id = d.property_id
     WHERE ($1::varchar = 'all' OR es.review_status = $1::varchar)
       AND (
         $3::uuid IS NULL
         OR d.id = $3::uuid
         OR (
           d.id IS NULL
           AND es.source_title ILIKE '%' || (
             SELECT scoped_deal.name
             FROM deals scoped_deal
             WHERE scoped_deal.id = $3::uuid
               AND scoped_deal.organization_id = current_organization_id()
           ) || '%'
         )
       )
       AND (
         $4::text IS NULL
         OR es.source_title ILIKE '%' || $4::text || '%'
         OR es.source_kind ILIKE '%' || $4::text || '%'
         OR es.authority_name ILIKE '%' || $4::text || '%'
         OR d.name ILIKE '%' || $4::text || '%'
         OR p.name ILIKE '%' || $4::text || '%'
         OR p.address ILIKE '%' || $4::text || '%'
       )
     ORDER BY es.created_at DESC
     LIMIT $2`,
    [status, limit, dealId || null, search || null]
  ),
  evidence_fact: ({ status, limit, search, dealId }) => query(
    `SELECT
       'evidence_fact' AS type,
       ef.id,
       ef.fact_type AS category,
       ef.fact_key AS title,
       es.authority_name,
       es.vendor_name,
       es.source_url,
       ef.review_status,
       NULL::varchar AS extraction_status,
       ef.confidence_score,
       ef.created_at,
       ef.created_at AS updated_at,
       ef.page_number AS source_page,
       ef.source_section,
       jsonb_build_object(
         'fact_value', ef.fact_value,
         'source_title', es.source_title,
         'document_id', es.document_id,
         'deal_id', d.id,
         'deal_name', d.name,
         'property_id', p.id,
         'property_name', COALESCE(NULLIF(p.name, ''), NULLIF(p.address, '')),
         'current_property_values', jsonb_build_object(
           'survey_number', p.survey_number,
           'pid', p.pid,
           'khata_no', p.khata_no,
           'owner_name', p.owner_name,
           'land_area_sqft', p.land_area_sqft,
           'road_width_mtrs', p.road_width_mtrs
         )
       ) AS payload
     FROM regulatory_data.evidence_facts ef
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = ef.source_id
     LEFT JOIN documents doc ON doc.id = es.document_id
     LEFT JOIN deals d ON d.id = doc.deal_id
     LEFT JOIN properties p ON p.id = d.property_id
     WHERE ($1::varchar = 'all' OR ef.review_status = $1::varchar)
       AND (
         $3::uuid IS NULL
         OR d.id = $3::uuid
         OR (
           d.id IS NULL
           AND es.source_title ILIKE '%' || (
             SELECT scoped_deal.name
             FROM deals scoped_deal
             WHERE scoped_deal.id = $3::uuid
               AND scoped_deal.organization_id = current_organization_id()
           ) || '%'
         )
       )
       AND (
         $4::text IS NULL
         OR ef.fact_key ILIKE '%' || $4::text || '%'
         OR ef.fact_type ILIKE '%' || $4::text || '%'
         OR ef.fact_value::text ILIKE '%' || $4::text || '%'
         OR es.source_title ILIKE '%' || $4::text || '%'
         OR d.name ILIKE '%' || $4::text || '%'
         OR p.name ILIKE '%' || $4::text || '%'
         OR p.address ILIKE '%' || $4::text || '%'
         OR p.survey_number ILIKE '%' || $4::text || '%'
       )
     ORDER BY ef.created_at DESC
     LIMIT $2`,
    [status, limit, dealId || null, search || null]
  ),
  guidance_value: ({ status, limit, search, dealId }) => query(
    `SELECT
       'guidance_value' AS type,
       gv.id,
       gv.land_use_type AS category,
       CONCAT_WS(' / ', gv.locality, NULLIF(gv.road_name, '')) AS title,
       es.authority_name,
       es.vendor_name,
       es.source_url,
       gv.review_status,
       NULL::varchar AS extraction_status,
       gv.confidence_score,
       gv.created_at,
       gv.updated_at,
       gv.source_page,
       gv.source_section,
       jsonb_build_object(
         'city', gv.city,
         'sro_name', gv.sro_name,
         'locality', gv.locality,
         'road_name', gv.road_name,
         'value_inr_per_sqft', gv.value_inr_per_sqft,
         'value_inr_per_acre', gv.value_inr_per_acre,
         'unit_type', gv.unit_type,
         'effective_from', gv.effective_from,
         'effective_to', gv.effective_to,
         'notes', gv.notes,
         'deal_id', d.id,
         'deal_name', d.name,
         'property_id', p.id,
         'property_name', COALESCE(NULLIF(p.name, ''), NULLIF(p.address, ''))
       ) AS payload
     FROM regulatory_data.guidance_values gv
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = gv.evidence_source_id
     LEFT JOIN documents doc ON doc.id = es.document_id
     LEFT JOIN deals d ON d.id = doc.deal_id
     LEFT JOIN properties p ON p.id = d.property_id
     WHERE ($1::varchar = 'all' OR gv.review_status = $1::varchar)
       AND (
         $3::uuid IS NULL
         OR d.id = $3::uuid
         OR (
           d.id IS NULL
           AND es.source_title ILIKE '%' || (
             SELECT scoped_deal.name
             FROM deals scoped_deal
             WHERE scoped_deal.id = $3::uuid
               AND scoped_deal.organization_id = current_organization_id()
           ) || '%'
         )
       )
       AND (
         $4::text IS NULL
         OR gv.locality ILIKE '%' || $4::text || '%'
         OR gv.road_name ILIKE '%' || $4::text || '%'
         OR gv.sro_name ILIKE '%' || $4::text || '%'
         OR gv.land_use_type ILIKE '%' || $4::text || '%'
         OR es.source_title ILIKE '%' || $4::text || '%'
         OR d.name ILIKE '%' || $4::text || '%'
         OR p.name ILIKE '%' || $4::text || '%'
         OR p.address ILIKE '%' || $4::text || '%'
       )
     ORDER BY gv.created_at DESC
     LIMIT $2`,
    [status, limit, dealId || null, search || null]
  ),
  far_rule: ({ status, limit, search, dealId }) => query(
    `SELECT
       'far_rule' AS type,
       fr.id,
       fr.land_use_family AS category,
       CONCAT_WS(' / ', fr.zone_code, fr.planning_zone, fr.source_section) AS title,
       es.authority_name,
       es.vendor_name,
       es.source_url,
       fr.review_status,
       NULL::varchar AS extraction_status,
       fr.confidence_score,
       fr.created_at,
       fr.updated_at,
       fr.source_page,
       fr.source_section,
       jsonb_build_object(
         'city', fr.city,
         'plan_version', fr.plan_version,
         'plan_status', fr.plan_status,
         'zone_code', fr.zone_code,
         'planning_zone', fr.planning_zone,
         'plot_area_min_sqm', fr.plot_area_min_sqm,
         'plot_area_max_sqm', fr.plot_area_max_sqm,
         'road_width_min_m', fr.road_width_min_m,
         'road_width_max_m', fr.road_width_max_m,
         'base_far', fr.base_far,
         'additional_far', fr.additional_far,
         'max_far', fr.max_far,
         'ground_coverage_pct', fr.ground_coverage_pct,
         'front_setback_m', fr.front_setback_m,
         'rear_setback_m', fr.rear_setback_m,
         'side_setback_m', fr.side_setback_m,
         'rule_notes', fr.rule_notes,
         'deal_id', d.id,
         'deal_name', d.name,
         'property_id', p.id,
         'property_name', COALESCE(NULLIF(p.name, ''), NULLIF(p.address, ''))
       ) AS payload
     FROM regulatory_data.far_rules fr
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = fr.evidence_source_id
     LEFT JOIN documents doc ON doc.id = es.document_id
     LEFT JOIN deals d ON d.id = doc.deal_id
     LEFT JOIN properties p ON p.id = d.property_id
     WHERE ($1::varchar = 'all' OR fr.review_status = $1::varchar)
       AND (
         $3::uuid IS NULL
         OR d.id = $3::uuid
         OR (
           d.id IS NULL
           AND es.source_title ILIKE '%' || (
             SELECT scoped_deal.name
             FROM deals scoped_deal
             WHERE scoped_deal.id = $3::uuid
               AND scoped_deal.organization_id = current_organization_id()
           ) || '%'
         )
       )
       AND (
         $4::text IS NULL
         OR fr.zone_code ILIKE '%' || $4::text || '%'
         OR fr.planning_zone ILIKE '%' || $4::text || '%'
         OR fr.land_use_family ILIKE '%' || $4::text || '%'
         OR fr.source_section ILIKE '%' || $4::text || '%'
         OR es.source_title ILIKE '%' || $4::text || '%'
         OR d.name ILIKE '%' || $4::text || '%'
         OR p.name ILIKE '%' || $4::text || '%'
         OR p.address ILIKE '%' || $4::text || '%'
       )
     ORDER BY fr.created_at DESC
     LIMIT $2`,
    [status, limit, dealId || null, search || null]
  ),
};

const normalizeAuthorityReviewStatus = (status) => {
  if (!status) return 'approved';
  if (!REVIEW_STATUSES.has(status)) {
    throw createError('Invalid authority input review status.', 400);
  }
  return status;
};

const loadDealAuthorityContext = async (client, dealId) => {
  const result = await client.query(
    `SELECT
       d.id AS deal_id,
       d.name AS deal_name,
       d.property_id,
       p.name AS property_name,
       p.address AS property_address,
       p.city AS property_city,
       p.state AS property_state,
       p.zone_id,
       p.survey_number,
       p.pid,
       p.khata_no,
       p.owner_name,
       p.land_area_sqft,
       p.road_width_mtrs,
       z.zone_code,
       z.planning_zone,
       z.zone_name,
       (
         SELECT doc.id
         FROM documents doc
         WHERE doc.deal_id = d.id
           AND doc.organization_id = current_organization_id()
         ORDER BY doc.created_at DESC
         LIMIT 1
       ) AS document_id
     FROM deals d
     LEFT JOIN properties p
       ON p.id = d.property_id
      AND p.organization_id = current_organization_id()
     LEFT JOIN regulatory_data.master_plan_zones z ON z.id = p.zone_id
     WHERE d.id = $1::uuid
       AND d.organization_id = current_organization_id()`,
    [dealId]
  );

  const context = result.rows[0];
  if (!context) throw createError('Deal not found for authority input.', 404);
  if (!context.property_id) throw createError('Link a property to this deal before adding parcel authority inputs.', 409);
  return context;
};

const createManualEvidenceSource = async (client, { context, data, userId, reviewStatus }) => {
  const rawTitle = requireText(data.source_title || data.sourceTitle, 'Source title');
  const sourceTitle = context.document_id
    ? rawTitle
    : `${context.deal_name || 'Deal'} - ${rawTitle}`.slice(0, 500);
  const reviewed = ['approved', 'rejected'].includes(reviewStatus);

  const result = await client.query(
    `INSERT INTO regulatory_data.evidence_sources (
       org_id,
       document_id,
       source_kind,
       authority_name,
       source_title,
       source_url,
       city,
       extraction_status,
       review_status,
       confidence_score,
       notes,
       created_by,
       reviewed_by,
       reviewed_at
     )
     VALUES (
       current_organization_id(),
       $1::uuid,
       'manual_entry',
       $2,
       $3,
       $4,
       $5,
       'not_required',
       $6::varchar,
       $7,
       $8,
       $9::uuid,
       CASE WHEN $10::boolean THEN $9::uuid ELSE NULL END,
       CASE WHEN $10::boolean THEN NOW() ELSE NULL END
     )
     RETURNING *`,
    [
      context.document_id || null,
      textOrNull(data.authority_name || data.authorityName) || 'Analyst-reviewed authority input',
      sourceTitle,
      textOrNull(data.source_url || data.sourceUrl),
      textOrNull(data.city) || context.property_city || 'Bengaluru',
      reviewStatus,
      optionalNumber(data.confidence_score ?? data.confidenceScore) ?? 1,
      textOrNull(data.notes),
      userId || null,
      reviewed,
    ]
  );

  return result.rows[0];
};

const createAuthorityActivity = async (client, { context, userId, description }) => {
  const result = await client.query(
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
    [context.deal_id, description, userId || null]
  );
  await client.query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [context.deal_id]);
  return result.rows[0]?.id || null;
};

const updatePropertyFromPromotion = async (client, { context, promotion, overwrite }) => {
  const currentValues = {
    survey_number: context.survey_number,
    pid: context.pid,
    khata_no: context.khata_no,
    owner_name: context.owner_name,
    land_area_sqft: context.land_area_sqft,
    road_width_mtrs: context.road_width_mtrs,
  };
  const currentValue = getCurrentPropertyValue(currentValues, promotion.field);
  if (hasValue(currentValue) && !overwrite) {
    throw createError(
      `${PROPERTY_PROMOTION_LABELS[promotion.field]} is already populated on this property. Use overwrite if the reviewed authority input supersedes it.`,
      409
    );
  }

  let result;
  if (promotion.field === 'land_area_sqft') {
    result = await client.query(
      `UPDATE properties
       SET land_area_sqft = $1,
           land_area_input_value = $2,
           land_area_input_unit = $3,
           updated_at = NOW()
       WHERE id = $4::uuid
         AND organization_id = current_organization_id()
       RETURNING *`,
      [
        promotion.updates.land_area_sqft,
        promotion.updates.land_area_input_value,
        promotion.updates.land_area_input_unit,
        context.property_id,
      ]
    );
  } else {
    result = await client.query(
      `UPDATE properties
       SET ${promotion.field} = $1,
           updated_at = NOW()
       WHERE id = $2::uuid
         AND organization_id = current_organization_id()
       RETURNING *`,
      [promotion.value, context.property_id]
    );
  }

  if (!result.rows[0]) throw createError('Linked property not found.', 404);
  return { property: result.rows[0], old_value: currentValue };
};

const createManualPropertyFact = async (client, { context, source, data, payload, userId, reviewStatus }) => {
  const factKey = requireText(payload.fact_key || payload.factKey, 'Property fact key', 160);
  if (!MANUAL_PROPERTY_FACTS.has(factKey)) {
    throw createError('This property fact is not supported for authority input promotion.', 400);
  }

  const factValue = toJsonValue(payload.fact_value ?? payload.value);
  if (factValue === null || factValue === '') throw createError('Property fact value is required.', 400);
  const reviewed = ['approved', 'rejected'].includes(reviewStatus);

  const factResult = await client.query(
    `INSERT INTO regulatory_data.evidence_facts (
       source_id,
       org_id,
       fact_type,
       fact_key,
       fact_value,
       page_number,
       source_section,
       confidence_score,
       review_status,
       created_by,
       reviewed_by,
       reviewed_at
     )
     VALUES (
       $1::uuid,
       current_organization_id(),
       'authority_input',
       $2,
       $3::jsonb,
       $4,
       $5,
       $6,
       $7::varchar,
       $8::uuid,
       CASE WHEN $9::boolean THEN $8::uuid ELSE NULL END,
       CASE WHEN $9::boolean THEN NOW() ELSE NULL END
     )
     RETURNING *`,
    [
      source.id,
      factKey,
      JSON.stringify(factValue),
      optionalNumber(payload.page_number ?? payload.pageNumber),
      textOrNull(payload.source_section || payload.sourceSection),
      optionalNumber(data.confidence_score ?? data.confidenceScore) ?? 1,
      reviewStatus,
      userId || null,
      reviewed,
    ]
  );

  let promoted = null;
  if (data.auto_promote === true || data.autoPromote === true) {
    if (reviewStatus !== 'approved') {
      throw createError('Only approved authority inputs can be promoted to property fields.', 409);
    }
    const promotion = buildPromotionUpdate(factKey, factValue);
    if (!promotion) {
      throw createError('Authority input value cannot be promoted to this property field.', 400);
    }
    promoted = await updatePropertyFromPromotion(client, {
      context,
      promotion,
      overwrite: data.overwrite === true,
    });
  }
  const promotion = buildPromotionUpdate(factKey, factValue);

  const activityId = await createAuthorityActivity(client, {
    context,
    userId,
    description: [
      `Added parcel authority input: ${PROPERTY_PROMOTION_LABELS[promotion?.field] || factKey}.`,
      `Value: ${formatFactForActivity(factValue)}.`,
      `Source: ${source.source_title}.`,
      promoted ? 'Promoted to property inputs.' : 'Queued as reviewed evidence.',
    ].filter(Boolean).join(' '),
  });

  return {
    source,
    row: factResult.rows[0],
    promoted: promoted
      ? {
          property_id: context.property_id,
          old_value: promoted.old_value,
          field: promotion?.field,
          value: promotion?.value,
        }
      : null,
    activity_id: activityId,
  };
};

const formatFactForActivity = (value) => {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const createManualGuidanceValue = async (client, { context, source, data, payload, userId, reviewStatus }) => {
  const locality = requireText(payload.locality, 'Guidance locality');
  const valueSqft = optionalNumber(payload.value_inr_per_sqft ?? payload.valueInrPerSqft);
  const valueAcre = optionalNumber(payload.value_inr_per_acre ?? payload.valueInrPerAcre);
  if (valueSqft === null && valueAcre === null) {
    throw createError('Guidance value requires INR per sqft or INR per acre.', 400);
  }

  const result = await client.query(
    `INSERT INTO regulatory_data.guidance_values (
       org_id,
       evidence_source_id,
       city,
       sro_name,
       locality,
       road_name,
       land_use_type,
       value_inr_per_sqft,
       value_inr_per_acre,
       unit_type,
       effective_from,
       effective_to,
       source_page,
       source_section,
       review_status,
       confidence_score,
       notes
     )
     VALUES (
       current_organization_id(),
       $1::uuid,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       $14::varchar,
       $15,
       $16
     )
     RETURNING *`,
    [
      source.id,
      textOrNull(payload.city) || context.property_city || 'Bengaluru',
      textOrNull(payload.sro_name || payload.sroName),
      locality,
      textOrNull(payload.road_name || payload.roadName),
      textOrNull(payload.land_use_type || payload.landUseType) || 'residential',
      valueSqft,
      valueAcre,
      textOrNull(payload.unit_type || payload.unitType) || (valueSqft !== null ? 'sqft' : 'acre'),
      textOrNull(payload.effective_from || payload.effectiveFrom),
      textOrNull(payload.effective_to || payload.effectiveTo),
      optionalNumber(payload.source_page ?? payload.sourcePage),
      textOrNull(payload.source_section || payload.sourceSection),
      reviewStatus,
      optionalNumber(data.confidence_score ?? data.confidenceScore) ?? 1,
      textOrNull(data.notes),
    ]
  );

  const activityId = await createAuthorityActivity(client, {
    context,
    userId,
    description: `Added ${reviewStatus.replace(/_/g, ' ')} guidance value authority input for ${locality}. Source: ${source.source_title}.`,
  });

  return { source, row: result.rows[0], activity_id: activityId };
};

const createManualFarRule = async (client, { context, source, data, payload, userId, reviewStatus }) => {
  const zoneCode = requireText(payload.zone_code || payload.zoneCode || context.zone_code, 'FAR zone code', 80).toUpperCase();
  const landUseFamily = requireText(payload.land_use_family || payload.landUseFamily, 'FAR land-use family', 80).toLowerCase();
  const baseFar = requireNumber(payload.base_far ?? payload.baseFar, 'Base FAR');
  const maxFar = requireNumber(payload.max_far ?? payload.maxFar, 'Max FAR');
  const additionalFar = optionalNumber(payload.additional_far ?? payload.additionalFar) ?? Math.max(0, maxFar - baseFar);

  const result = await client.query(
    `INSERT INTO regulatory_data.far_rules (
       org_id,
       evidence_source_id,
       zone_id,
       city,
       plan_version,
       plan_status,
       zone_code,
       planning_zone,
       land_use_family,
       plot_area_min_sqm,
       plot_area_max_sqm,
       road_width_min_m,
       road_width_max_m,
       base_far,
       additional_far,
       max_far,
       ground_coverage_pct,
       front_setback_m,
       rear_setback_m,
       side_setback_m,
       source_page,
       source_section,
       rule_notes,
       confidence_score,
       review_status,
       effective_from,
       effective_to
     )
     VALUES (
       current_organization_id(),
       $1::uuid,
       $2::uuid,
       $3,
       $4,
       $5,
       $6,
       $7,
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
       $21,
       $22,
       $23,
       $24::varchar,
       $25,
       $26
     )
     RETURNING *`,
    [
      source.id,
      context.zone_id || null,
      textOrNull(payload.city) || context.property_city || 'Bengaluru',
      textOrNull(payload.plan_version || payload.planVersion) || 'Authority reviewed',
      textOrNull(payload.plan_status || payload.planStatus) || 'authority_reviewed',
      zoneCode,
      textOrNull(payload.planning_zone || payload.planningZone || context.planning_zone),
      landUseFamily,
      optionalNumber(payload.plot_area_min_sqm ?? payload.plotAreaMinSqm) ?? 0,
      optionalNumber(payload.plot_area_max_sqm ?? payload.plotAreaMaxSqm),
      optionalNumber(payload.road_width_min_m ?? payload.roadWidthMinM) ?? 0,
      optionalNumber(payload.road_width_max_m ?? payload.roadWidthMaxM),
      baseFar,
      additionalFar,
      maxFar,
      optionalNumber(payload.ground_coverage_pct ?? payload.groundCoveragePct),
      optionalNumber(payload.front_setback_m ?? payload.frontSetbackM),
      optionalNumber(payload.rear_setback_m ?? payload.rearSetbackM),
      optionalNumber(payload.side_setback_m ?? payload.sideSetbackM),
      optionalNumber(payload.source_page ?? payload.sourcePage),
      textOrNull(payload.source_section || payload.sourceSection),
      textOrNull(payload.rule_notes || payload.ruleNotes || data.notes),
      optionalNumber(data.confidence_score ?? data.confidenceScore) ?? 1,
      reviewStatus,
      textOrNull(payload.effective_from || payload.effectiveFrom),
      textOrNull(payload.effective_to || payload.effectiveTo),
    ]
  );

  const activityId = await createAuthorityActivity(client, {
    context,
    userId,
    description: `Added ${reviewStatus.replace(/_/g, ' ')} FAR authority input for ${zoneCode}, max FAR ${maxFar}. Source: ${source.source_title}.`,
  });

  return { source, row: result.rows[0], activity_id: activityId };
};

const createAuthorityInput = async ({ dealId, kind, payload = {}, userId, ...data }) => {
  if (!AUTHORITY_INPUT_KINDS.has(kind)) {
    throw createError('Unsupported authority input type.', 400);
  }
  const reviewStatus = normalizeAuthorityReviewStatus(data.review_status || data.reviewStatus);

  return transaction(async (client) => {
    const context = await loadDealAuthorityContext(client, dealId || data.deal_id || data.dealId);
    const source = await createManualEvidenceSource(client, { context, data, userId, reviewStatus });
    let result;

    if (kind === 'property_fact') {
      result = await createManualPropertyFact(client, { context, source, data, payload, userId, reviewStatus });
    } else if (kind === 'guidance_value') {
      result = await createManualGuidanceValue(client, { context, source, data, payload, userId, reviewStatus });
    } else {
      result = await createManualFarRule(client, { context, source, data, payload, userId, reviewStatus });
    }

    return {
      kind,
      review_status: reviewStatus,
      deal_id: context.deal_id,
      property_id: context.property_id,
      document_id: context.document_id || null,
      ...result,
    };
  });
};

const listReviewQueue = async ({ type = 'all', status = 'pending', limit = 50, search, deal_id: dealId } = {}) => {
  const normalizedType = normalizeType(type);
  const normalizedStatus = normalizeStatus(status);
  const normalizedSearch = normalizeSearch(search);
  const safeLimit = clampLimit(limit);
  const types = normalizedType === 'all' ? [...REVIEW_TYPES] : [normalizedType];
  const results = await Promise.all(
    types.map((queueType) => queueQueries[queueType]({
      status: normalizedStatus,
      limit: safeLimit,
      search: normalizedSearch,
      dealId: dealId || null,
    }))
  );

  return results
    .flatMap((result) => result.rows)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, safeLimit)
    .map(attachPromotionMetadata);
};

const reviewItem = async ({ type, id, status, userId, notes }) => {
  if (!REVIEW_TYPES.has(type)) {
    throw createError('Unsupported parcel intelligence review item type.', 400);
  }
  if (!REVIEW_STATUSES.has(status)) {
    throw createError('Invalid review status.', 400);
  }

  let result;
  if (type === 'evidence_source') {
    result = await query(
      `UPDATE regulatory_data.evidence_sources
       SET review_status = $1::varchar,
           reviewed_by = $2::uuid,
           reviewed_at = CASE WHEN $1::varchar IN ('approved', 'rejected') THEN NOW() ELSE reviewed_at END,
           notes = COALESCE($3::text, notes),
           updated_at = NOW()
       WHERE id = $4::uuid
       RETURNING id, review_status`,
      [status, userId || null, notes || null, id]
    );
  } else if (type === 'evidence_fact') {
    result = await query(
      `UPDATE regulatory_data.evidence_facts
       SET review_status = $1::varchar,
           reviewed_by = $2::uuid,
           reviewed_at = CASE WHEN $1::varchar IN ('approved', 'rejected') THEN NOW() ELSE reviewed_at END
       WHERE id = $3::uuid
       RETURNING id, review_status`,
      [status, userId || null, id]
    );
  } else if (type === 'guidance_value') {
    result = await query(
      `UPDATE regulatory_data.guidance_values
       SET review_status = $1::varchar,
           notes = COALESCE($2::text, notes),
           updated_at = NOW()
       WHERE id = $3::uuid
       RETURNING id, review_status`,
      [status, notes || null, id]
    );
  } else {
    result = await query(
      `UPDATE regulatory_data.far_rules
       SET review_status = $1::varchar,
           rule_notes = COALESCE($2::text, rule_notes),
           updated_at = NOW()
       WHERE id = $3::uuid
       RETURNING id, review_status`,
      [status, notes || null, id]
    );
  }

  if (!result.rows[0]) {
    throw createError('Review item not found.', 404);
  }

  return { type, ...result.rows[0] };
};

const reviewItems = async ({ items = [], status, userId, notes }) => {
  if (!REVIEW_STATUSES.has(status)) {
    throw createError('Invalid review status.', 400);
  }

  const uniqueItems = [];
  const seen = new Set();
  items.forEach((item) => {
    const key = `${item?.type}:${item?.id}`;
    if (!REVIEW_TYPES.has(item?.type) || !item?.id || seen.has(key)) return;
    seen.add(key);
    uniqueItems.push({ type: item.type, id: item.id });
  });

  if (!uniqueItems.length) {
    throw createError('Select at least one review item.', 400);
  }
  if (uniqueItems.length > 80) {
    throw createError('Review at most 80 items at a time.', 400);
  }

  const updated = [];
  const failed = [];

  for (const item of uniqueItems) {
    try {
      updated.push(await reviewItem({
        type: item.type,
        id: item.id,
        status,
        userId,
        notes,
      }));
    } catch (error) {
      failed.push({
        ...item,
        reason: error.message || 'review_update_failed',
        statusCode: error.statusCode || 500,
      });
    }
  }

  return {
    updated,
    failed,
    summary: {
      requested: uniqueItems.length,
      updated: updated.length,
      failed: failed.length,
    },
  };
};

const promotionFactSelect = `
  SELECT
     ef.id,
     ef.fact_key,
     ef.fact_value,
     ef.review_status,
     ef.confidence_score,
     ef.page_number,
     ef.source_section,
     ef.created_at,
     es.source_title,
     es.document_id,
     doc.name AS document_name,
     d.id AS deal_id,
     d.name AS deal_name,
     p.id AS property_id,
     p.name AS property_name,
     p.address AS property_address,
     p.survey_number,
     p.pid,
     p.khata_no,
     p.owner_name,
     p.land_area_sqft,
     p.road_width_mtrs
   FROM regulatory_data.evidence_facts ef
   LEFT JOIN regulatory_data.evidence_sources es ON es.id = ef.source_id
   LEFT JOIN documents doc ON doc.id = es.document_id
   LEFT JOIN deals d ON d.id = doc.deal_id
   LEFT JOIN properties p ON p.id = d.property_id
`;

const loadEvidenceFactForPromotion = async (factId) => {
  const result = await query(
    `${promotionFactSelect}
     WHERE ef.id = $1::uuid
       AND ef.org_id = current_organization_id()`,
    [factId]
  );

  return result.rows[0] || null;
};

const loadEvidenceFactsForPromotion = async (factIds = []) => {
  if (!factIds.length) return [];

  const result = await query(
    `${promotionFactSelect}
     WHERE ef.id = ANY($1::uuid[])
       AND ef.org_id = current_organization_id()
     ORDER BY ef.created_at DESC`,
    [factIds]
  );

  return result.rows;
};

const promoteEvidenceFactToProperty = async ({ factId, userId, overwrite = false }) => {
  const fact = await loadEvidenceFactForPromotion(factId);
  if (!fact) {
    throw createError('Evidence fact not found.', 404);
  }

  if (fact.review_status !== 'approved') {
    throw createError('Approve this evidence fact before promoting it to property inputs.', 409);
  }

  if (!fact.property_id) {
    throw createError('This evidence fact is not linked to a property through its source document.', 409);
  }

  const promotion = buildPromotionUpdate(fact.fact_key, fact.fact_value);
  if (!promotion) {
    throw createError('This evidence fact cannot be promoted to a property input.', 400);
  }

  const currentValues = {
    survey_number: fact.survey_number,
    pid: fact.pid,
    khata_no: fact.khata_no,
    owner_name: fact.owner_name,
    land_area_sqft: fact.land_area_sqft,
    road_width_mtrs: fact.road_width_mtrs,
  };
  const currentValue = getCurrentPropertyValue(currentValues, promotion.field);
  if (hasValue(currentValue) && !overwrite) {
    throw createError(
      `${PROPERTY_PROMOTION_LABELS[promotion.field]} is already populated on this property. Clear it or use an overwrite flow before promoting.`,
      409
    );
  }

  const updated = await transaction(async (client) => {
    let propertyResult;
    if (promotion.field === 'land_area_sqft') {
      propertyResult = await client.query(
        `UPDATE properties
         SET land_area_sqft = $1,
             land_area_input_value = $2,
             land_area_input_unit = $3,
             updated_at = NOW()
         WHERE id = $4
           AND organization_id = current_organization_id()
         RETURNING *`,
        [
          promotion.updates.land_area_sqft,
          promotion.updates.land_area_input_value,
          promotion.updates.land_area_input_unit,
          fact.property_id,
        ]
      );
    } else {
      const column = promotion.field;
      propertyResult = await client.query(
        `UPDATE properties
         SET ${column} = $1,
             updated_at = NOW()
         WHERE id = $2
           AND organization_id = current_organization_id()
         RETURNING *`,
        [promotion.value, fact.property_id]
      );
    }

    if (!propertyResult.rows[0]) {
      throw createError('Linked property not found.', 404);
    }

    const sourceLabel = fact.document_name || fact.source_title || 'reviewed evidence';
    const description = [
      `Promoted reviewed parcel evidence to property input: ${PROPERTY_PROMOTION_LABELS[promotion.field]}.`,
      `Value: ${promotion.value}.`,
      `Source: ${sourceLabel}.`,
      `Evidence fact: ${fact.id}.`,
    ].join(' ');

    const activityResult = await client.query(
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
      [fact.deal_id, description, userId || null]
    );

    await client.query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [fact.deal_id]);

    return {
      property: propertyResult.rows[0],
      activity_id: activityResult.rows[0]?.id || null,
    };
  });

  return {
    promoted: true,
    fact_id: fact.id,
    property_id: fact.property_id,
    deal_id: fact.deal_id,
    field: promotion.field,
    label: PROPERTY_PROMOTION_LABELS[promotion.field],
    old_value: currentValue,
    value: promotion.value,
    activity_id: updated.activity_id,
    property: updated.property,
  };
};

const chooseBatchPromotionCandidate = (facts) => {
  if (facts.length === 1) return facts[0];

  const normalizedValues = new Set(facts.map((fact) => normalizePromotionValue(fact.promotion.value)));
  if (normalizedValues.size > 1) return null;

  return [...facts].sort((a, b) => {
    const confidenceDelta = Number(b.confidence_score || 0) - Number(a.confidence_score || 0);
    if (confidenceDelta !== 0) return confidenceDelta;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  })[0];
};

const buildBatchPromotionPlan = (facts = [], requestedIds = [], overwrite = false) => {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const skipped = [];
  const grouped = new Map();

  requestedIds.forEach((factId) => {
    const fact = byId.get(factId);
    if (!fact) {
      skipped.push({ fact_id: factId, reason: 'not_found' });
      return;
    }

    if (fact.review_status !== 'approved') {
      skipped.push({ fact_id: fact.id, reason: 'not_approved', status: fact.review_status });
      return;
    }

    if (!fact.property_id) {
      skipped.push({ fact_id: fact.id, reason: 'no_linked_property' });
      return;
    }

    const promotion = buildPromotionUpdate(fact.fact_key, fact.fact_value);
    if (!promotion) {
      skipped.push({ fact_id: fact.id, reason: 'unsupported_fact', fact_key: fact.fact_key });
      return;
    }

    const currentValues = {
      survey_number: fact.survey_number,
      pid: fact.pid,
      khata_no: fact.khata_no,
      owner_name: fact.owner_name,
      land_area_sqft: fact.land_area_sqft,
      road_width_mtrs: fact.road_width_mtrs,
    };
    const currentValue = getCurrentPropertyValue(currentValues, promotion.field);
    if (hasValue(currentValue) && !overwrite) {
      skipped.push({
        fact_id: fact.id,
        reason: 'already_populated',
        field: promotion.field,
        current_value: currentValue,
      });
      return;
    }

    const groupKey = `${fact.property_id}:${promotion.field}`;
    grouped.set(groupKey, [...(grouped.get(groupKey) || []), { ...fact, promotion }]);
  });

  const promotable = [];
  grouped.forEach((groupFacts) => {
    const selected = chooseBatchPromotionCandidate(groupFacts);
    if (!selected) {
      groupFacts.forEach((fact) => {
        skipped.push({
          fact_id: fact.id,
          reason: 'conflicting_approved_values',
          field: fact.promotion.field,
          value: fact.promotion.value,
        });
      });
      return;
    }

    promotable.push(selected);
    groupFacts
      .filter((fact) => fact.id !== selected.id)
      .forEach((fact) => {
        skipped.push({
          fact_id: fact.id,
          reason: 'duplicate_same_value',
          field: fact.promotion.field,
          selected_fact_id: selected.id,
        });
      });
  });

  return { promotable, skipped };
};

const promoteEvidenceFactsToProperty = async ({ factIds = [], userId, overwrite = false }) => {
  const uniqueFactIds = [...new Set(factIds.filter(Boolean))];
  if (!uniqueFactIds.length) {
    throw createError('Select at least one approved evidence fact to promote.', 400);
  }
  if (uniqueFactIds.length > 80) {
    throw createError('Promote at most 80 evidence facts at a time.', 400);
  }

  const facts = await loadEvidenceFactsForPromotion(uniqueFactIds);
  const plan = buildBatchPromotionPlan(facts, uniqueFactIds, overwrite);
  const promoted = [];
  const failed = [];

  for (const fact of plan.promotable) {
    try {
      const result = await promoteEvidenceFactToProperty({
        factId: fact.id,
        userId,
        overwrite,
      });
      promoted.push(result);
    } catch (error) {
      failed.push({
        fact_id: fact.id,
        reason: error.message || 'promotion_failed',
        statusCode: error.statusCode || 500,
      });
    }
  }

  return {
    promoted,
    skipped: plan.skipped,
    failed,
    summary: {
      requested: uniqueFactIds.length,
      promoted: promoted.length,
      skipped: plan.skipped.length,
      failed: failed.length,
    },
  };
};

module.exports = {
  getStatus,
  listReviewQueue,
  reviewItem,
  reviewItems,
  promoteEvidenceFactToProperty,
  promoteEvidenceFactsToProperty,
  createAuthorityInput,
  buildPromotionUpdate,
  buildBatchPromotionPlan,
  REVIEW_TYPES,
  REVIEW_STATUSES,
  AUTHORITY_INPUT_KINDS,
};
