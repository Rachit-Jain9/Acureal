const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const landeedAdapter = require('./adapters/landeed.adapter');
const { getProviderAvailability } = require('./ai/providerRegistry');

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_review']);
const REVIEW_TYPES = new Set(['evidence_source', 'evidence_fact', 'guidance_value', 'far_rule']);

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
         'source_title', es.source_title
       ) AS payload
     FROM regulatory_data.evidence_facts ef
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = ef.source_id
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
    .slice(0, safeLimit);
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

module.exports = {
  getStatus,
  listReviewQueue,
  reviewItem,
  REVIEW_TYPES,
  REVIEW_STATUSES,
};
