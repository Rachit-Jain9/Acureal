'use strict';

/**
 * Parcel intelligence admin — review queue listing + per-item / batch review.
 *
 * Powers the admin dashboard's review queue: lists pending evidence sources,
 * evidence facts, guidance values, and FAR rules; updates their review_status
 * one at a time or in batches.
 *
 * Read path: parameterized SQL per type, sorted by created_at, capped at
 * `clampLimit`. The four queue queries are functionally similar (same
 * status + deal-id + search filters) but each pulls a different subset of
 * columns, which is why they're separate query builders rather than a
 * generic UNION.
 *
 * Write path: `reviewItem` and `reviewItems` flip review_status, stamp
 * reviewer + reviewed_at, optionally update notes. Batch is a soft-fail
 * loop — one failed row doesn't abort the rest.
 *
 * Extracted from parcelIntelligenceAdmin.service.js as part of the Bet 3
 * decomposition.
 */

const { query } = require('../../config/database');
const { createError } = require('../../middleware/errorHandler');
const {
  REVIEW_STATUSES,
  REVIEW_TYPES,
  attachPromotionMetadata,
  clampLimit,
  normalizeStatus,
  normalizeType,
  normalizeSearch,
} = require('./_helpers');

// ── Per-type SQL ───────────────────────────────────────────────────────────

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

// ── Public API ─────────────────────────────────────────────────────────────

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

module.exports = {
  listReviewQueue,
  reviewItem,
  reviewItems,
};
