'use strict';

/**
 * Parcel intelligence admin — promotion of approved evidence facts to
 * structured property fields.
 *
 * Two paths:
 *   - `promoteEvidenceFactToProperty`: single fact → single property field.
 *     Validates approval, conflict, and supported field; runs the UPDATE
 *     + activity insert in a transaction.
 *   - `promoteEvidenceFactsToProperty`: batch path. Loads all requested
 *     facts in one query, runs `buildBatchPromotionPlan` to bucket them by
 *     (property, field), picks the best candidate per bucket (highest
 *     confidence, latest created_at) when there's no conflict, then loops
 *     `promoteEvidenceFactToProperty` per selected candidate. Soft-fails:
 *     one failed promotion doesn't abort the rest.
 *
 * `buildBatchPromotionPlan` is exported separately because it has unit
 * tests and is also used by the admin UI to preview "what would happen
 * if I clicked Promote on these 12 facts" before committing.
 *
 * Extracted from parcelIntelligenceAdmin.service.js as part of the Bet 3
 * decomposition.
 */

const { query, transaction } = require('../../config/database');
const { createError } = require('../../middleware/errorHandler');
const {
  PROPERTY_PROMOTION_LABELS,
  buildPromotionUpdate,
  getCurrentPropertyValue,
  normalizePromotionValue,
  hasValue,
} = require('./_helpers');

// ── Internal SQL + helpers ─────────────────────────────────────────────────

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

// ── Public API ─────────────────────────────────────────────────────────────

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
  promoteEvidenceFactToProperty,
  promoteEvidenceFactsToProperty,
  buildBatchPromotionPlan,
};
