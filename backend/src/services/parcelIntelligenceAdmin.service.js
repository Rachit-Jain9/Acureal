const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const landeedAdapter = require('./adapters/landeed.adapter');
const { getProviderAvailability } = require('./ai/providerRegistry');

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_review']);
const REVIEW_TYPES = new Set(['evidence_source', 'evidence_fact', 'guidance_value', 'far_rule']);
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
  evidence_source: ({ status, limit }) => query(
    `SELECT
       'evidence_source' AS type,
       id,
       source_kind AS category,
       source_title AS title,
       authority_name,
       vendor_name,
       source_url,
       review_status,
       extraction_status,
       confidence_score,
       created_at,
       updated_at,
       NULL::int AS source_page,
       NULL::text AS source_section,
       jsonb_build_object(
         'city', city,
         'plan_version', plan_version,
         'effective_from', effective_from,
         'effective_to', effective_to,
         'checksum_sha256', checksum_sha256,
         'notes', notes
       ) AS payload
     FROM regulatory_data.evidence_sources
     WHERE ($1 = 'all' OR review_status = $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [status, limit]
  ),
  evidence_fact: ({ status, limit }) => query(
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
     WHERE ($1 = 'all' OR ef.review_status = $1)
     ORDER BY ef.created_at DESC
     LIMIT $2`,
    [status, limit]
  ),
  guidance_value: ({ status, limit }) => query(
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
         'notes', gv.notes
       ) AS payload
     FROM regulatory_data.guidance_values gv
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = gv.evidence_source_id
     WHERE ($1 = 'all' OR gv.review_status = $1)
     ORDER BY gv.created_at DESC
     LIMIT $2`,
    [status, limit]
  ),
  far_rule: ({ status, limit }) => query(
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
         'rule_notes', fr.rule_notes
       ) AS payload
     FROM regulatory_data.far_rules fr
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = fr.evidence_source_id
     WHERE ($1 = 'all' OR fr.review_status = $1)
     ORDER BY fr.created_at DESC
     LIMIT $2`,
    [status, limit]
  ),
};

const listReviewQueue = async ({ type = 'all', status = 'pending', limit = 50 } = {}) => {
  const normalizedType = normalizeType(type);
  const normalizedStatus = normalizeStatus(status);
  const safeLimit = clampLimit(limit);
  const types = normalizedType === 'all' ? [...REVIEW_TYPES] : [normalizedType];
  const results = await Promise.all(
    types.map((queueType) => queueQueries[queueType]({ status: normalizedStatus, limit: safeLimit }))
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
       SET review_status = $1,
           reviewed_by = $2,
           reviewed_at = CASE WHEN $1 IN ('approved', 'rejected') THEN NOW() ELSE reviewed_at END,
           notes = COALESCE($3, notes),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, review_status`,
      [status, userId || null, notes || null, id]
    );
  } else if (type === 'evidence_fact') {
    result = await query(
      `UPDATE regulatory_data.evidence_facts
       SET review_status = $1,
           reviewed_by = $2,
           reviewed_at = CASE WHEN $1 IN ('approved', 'rejected') THEN NOW() ELSE reviewed_at END
       WHERE id = $3
       RETURNING id, review_status`,
      [status, userId || null, id]
    );
  } else if (type === 'guidance_value') {
    result = await query(
      `UPDATE regulatory_data.guidance_values
       SET review_status = $1,
           notes = COALESCE($2, notes),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, review_status`,
      [status, notes || null, id]
    );
  } else {
    result = await query(
      `UPDATE regulatory_data.far_rules
       SET review_status = $1,
           rule_notes = COALESCE($2, rule_notes),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, review_status`,
      [status, notes || null, id]
    );
  }

  if (!result.rows[0]) {
    throw createError('Review item not found.', 404);
  }

  return { type, ...result.rows[0] };
};

const loadEvidenceFactForPromotion = async (factId) => {
  const result = await query(
    `SELECT
       ef.id,
       ef.fact_key,
       ef.fact_value,
       ef.review_status,
       ef.confidence_score,
       ef.page_number,
       ef.source_section,
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
     WHERE ef.id = $1
       AND ef.org_id = current_organization_id()`,
    [factId]
  );

  return result.rows[0] || null;
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

module.exports = {
  getStatus,
  listReviewQueue,
  reviewItem,
  promoteEvidenceFactToProperty,
  buildPromotionUpdate,
  REVIEW_TYPES,
  REVIEW_STATUSES,
};
