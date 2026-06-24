'use strict';

/**
 * Parcel intelligence admin — manual authority-input creation.
 *
 * The "I just confirmed something at the BBMP / IGR / sub-registrar
 * window" path. Creates a manual evidence_source row, then attaches one
 * of three typed children:
 *   - property_fact   → evidence_facts row (and optional auto-promotion to
 *                       the property's survey/PID/khata/owner/area/road
 *                       columns)
 *   - guidance_value  → guidance_values row
 *   - far_rule        → far_rules row
 *
 * Everything happens in a single transaction so a partial save can't
 * leave an orphaned source. Each path also writes a deal-level activity
 * row so the timeline shows what was added and by whom.
 *
 * Extracted from parcelIntelligenceAdmin.service.js as part of the Bet 3
 * decomposition.
 */

const { transaction } = require('../../config/database');
const { createError } = require('../../middleware/errorHandler');
const {
  REVIEW_STATUSES,
  AUTHORITY_INPUT_KINDS,
  PROPERTY_PROMOTION_LABELS,
  MANUAL_PROPERTY_FACTS,
  textOrNull,
  numberOrNull,
  requireText,
  requireNumber,
  optionalNumber,
  toJsonValue,
  hasValue,
  buildPromotionUpdate,
  getCurrentPropertyValue,
} = require('./_helpers');

// ── Internal helpers ───────────────────────────────────────────────────────

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
           AND doc.deleted_at IS NULL
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

const formatFactForActivity = (value) => {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
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

// ── Public API ─────────────────────────────────────────────────────────────

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

module.exports = {
  createAuthorityInput,
};
