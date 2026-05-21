'use strict';

/**
 * Deal Apply-Extractions service — PR-NX25 (2026-05-17).
 *
 * The post-extraction half of the document-ingestion flow:
 *
 *   upload PDF → Gemini extracts → operator reviews ONE-BY-ONE
 *     → operator approves a subset → THIS SERVICE writes them to deal + property
 *
 * Pre-NX25 the extraction pipeline produced `field_map` (extraction.service.buildFieldMap),
 * but there was no code path that took an operator-approved subset and persisted
 * it. Operators had to manually re-enter every field into the deal form. This
 * service closes that gap.
 *
 * Design principles:
 *
 *   1. **Ontology-routed** — every approved field is validated + routed
 *      via @redip/real-estate-ontology. No table/column hardcoded here.
 *      Adding a new extraction → deal field means adding ONE entry to the
 *      ontology v1.json, not editing this service.
 *
 *   2. **Transactional** — properties + deals + audit + extraction-marking
 *      all commit together. If any step fails, NOTHING is partially applied.
 *
 *   3. **Append-only audit** — every applied field shows up on the deal
 *      timeline via dealAuditLog.recordAudit() with eventType 'updated'
 *      and metadata.source='document_extraction'.
 *
 *   4. **Source-extraction marking** — each source `document_extractions`
 *      row gets a `correction_history` entry of type `applied_to_deal` so
 *      the operator can see which extractions have already been consumed
 *      (and the apply-extractions modal can hide them from "ready to apply").
 *
 *   5. **Fail-soft per field** — one bad field (e.g., a value below the
 *      ontology min) does NOT roll back the whole batch. Bad fields are
 *      skipped with an explanatory reason in the response. The operator
 *      can fix + retry just the rejected ones.
 *
 *   6. **No new tables** — uses existing deals, properties,
 *      document_extractions.correction_history JSONB column, and
 *      deal_audit_log. Zero migrations required.
 */

const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const dealAuditLog = require('./dealAuditLog.service');
const extractionVerdicts = require('./extractionVerdicts.service');
const ontology = require('../../../packages/real-estate-ontology/src');

/**
 * Apply a set of operator-approved extraction values to a deal +
 * its linked property.
 *
 * @param {string} dealId — UUID of the target deal
 * @param {Array<{
 *   canonical_field: string,
 *   value: any,
 *   source_extraction_id: string,
 *   source_document_id?: string,
 *   source_field?: string,
 *   confidence?: number
 * }>} approvedExtractions — per-field operator-approved extractions
 * @param {string|null} userId — actor user ID for audit attribution
 * @returns {Promise<{
 *   applied: Array<{canonical_field, table, column, value, source_extraction_id, original_value, transform}>,
 *   skipped: Array<{canonical_field, reason, source_extraction_id}>,
 *   deal: object|null,
 *   property: object|null,
 *   audit_log_id_deal: string|null,
 *   audit_log_id_property: string|null
 * }>}
 */
const applyExtractionsToDeal = async (dealId, approvedExtractions, userId = null) => {
  if (!dealId) throw createError('dealId is required', 400);
  if (!Array.isArray(approvedExtractions)) {
    throw createError('approvedExtractions must be an array', 400);
  }
  if (approvedExtractions.length === 0) {
    throw createError('approvedExtractions cannot be empty — provide at least one field to apply', 400);
  }

  // ── Phase 1: validate + group by destination table ──────────────────
  const applied = [];
  const skipped = [];
  const dealUpdates = {}; // column → value (one-shot SET in deals UPDATE)
  const propertyUpdates = {}; // column → value (one-shot SET in properties UPDATE)
  const sourceExtractionIds = new Set();

  for (const item of approvedExtractions) {
    if (!item || typeof item !== 'object') {
      skipped.push({ canonical_field: null, reason: 'item is not an object', source_extraction_id: null });
      continue;
    }
    const canonical = item.canonical_field;
    const rawValue = item.value;
    const srcExtractionId = item.source_extraction_id || null;

    const validation = ontology.validateAndCoerce(canonical, rawValue);
    if (!validation.ok) {
      skipped.push({
        canonical_field: canonical,
        reason: validation.error,
        source_extraction_id: srcExtractionId,
      });
      continue;
    }

    const spec = ontology.getExtractionField(canonical);
    // validateAndCoerce already verified spec exists; defensive double-check
    if (!spec) {
      skipped.push({
        canonical_field: canonical,
        reason: `Internal: spec disappeared for "${canonical}"`,
        source_extraction_id: srcExtractionId,
      });
      continue;
    }

    // Last write wins per (table, column) — if two extractions disagree
    // for the same target, the LAST one in the array overrides. Callers
    // should pre-sort by confidence DESC if they want highest-confidence
    // to win.
    if (spec.table === 'deals') {
      dealUpdates[spec.column] = validation.value;
    } else if (spec.table === 'properties') {
      propertyUpdates[spec.column] = validation.value;
    } else {
      skipped.push({
        canonical_field: canonical,
        reason: `Internal: unknown table "${spec.table}" for "${canonical}"`,
        source_extraction_id: srcExtractionId,
      });
      continue;
    }

    applied.push({
      canonical_field: canonical,
      table: spec.table,
      column: spec.column,
      value: validation.value,
      original_value: validation.original_value,
      transform: validation.transform,
      source_extraction_id: srcExtractionId,
      source_document_id: item.source_document_id || null,
      source_field: item.source_field || null,
      confidence: item.confidence != null ? Number(item.confidence) : null,
    });

    if (srcExtractionId) sourceExtractionIds.add(srcExtractionId);
  }

  if (applied.length === 0) {
    // Nothing valid to apply — return the skip list without opening a transaction.
    return {
      applied: [],
      skipped,
      deal: null,
      property: null,
      audit_log_id_deal: null,
      audit_log_id_property: null,
    };
  }

  // ── Phase 2: transactional write ────────────────────────────────────
  const txResult = await transaction(async (client) => {
    // Load deal + linked property under RLS. Bail if deal not visible.
    const dealRowResult = await client.query(
      `SELECT * FROM deals WHERE id = $1 AND organization_id = current_organization_id()`,
      [dealId],
    );
    if (dealRowResult.rows.length === 0) {
      throw createError('Deal not found.', 404);
    }
    const dealBefore = dealRowResult.rows[0];
    const propertyId = dealBefore.property_id;

    let propertyBefore = null;
    if (propertyId && Object.keys(propertyUpdates).length > 0) {
      const propRowResult = await client.query(
        `SELECT * FROM properties WHERE id = $1 AND organization_id = current_organization_id()`,
        [propertyId],
      );
      if (propRowResult.rows.length === 0) {
        throw createError(
          `Deal has property_id=${propertyId} but property is not accessible. Cannot apply property-level extractions.`,
          409,
        );
      }
      propertyBefore = propRowResult.rows[0];
    } else if (!propertyId && Object.keys(propertyUpdates).length > 0) {
      throw createError(
        'Deal has no linked property. Cannot apply property-level extractions until a property is attached.',
        409,
      );
    }

    // Build dynamic UPDATE for deals (if any deal-level fields applied)
    let dealAfter = dealBefore;
    if (Object.keys(dealUpdates).length > 0) {
      const setCols = [];
      const setVals = [];
      let idx = 1;
      for (const [col, val] of Object.entries(dealUpdates)) {
        setCols.push(`${col} = $${idx}`);
        setVals.push(val);
        idx += 1;
      }
      setCols.push('updated_at = NOW()');
      setVals.push(dealId);
      const dealUpdResult = await client.query(
        `UPDATE deals
            SET ${setCols.join(', ')}
          WHERE id = $${idx}
            AND organization_id = current_organization_id()
          RETURNING *`,
        setVals,
      );
      if (dealUpdResult.rows.length === 0) {
        throw createError('Deal update returned 0 rows — concurrent delete or RLS denied.', 409);
      }
      dealAfter = dealUpdResult.rows[0];
    }

    // Build dynamic UPDATE for properties
    let propertyAfter = propertyBefore;
    if (Object.keys(propertyUpdates).length > 0 && propertyId) {
      const setCols = [];
      const setVals = [];
      let idx = 1;
      for (const [col, val] of Object.entries(propertyUpdates)) {
        setCols.push(`${col} = $${idx}`);
        setVals.push(val);
        idx += 1;
      }
      setCols.push('updated_at = NOW()');
      setVals.push(propertyId);
      const propUpdResult = await client.query(
        `UPDATE properties
            SET ${setCols.join(', ')}
          WHERE id = $${idx}
            AND organization_id = current_organization_id()
          RETURNING *`,
        setVals,
      );
      if (propUpdResult.rows.length === 0) {
        throw createError('Property update returned 0 rows — concurrent delete or RLS denied.', 409);
      }
      propertyAfter = propUpdResult.rows[0];
    }

    // Mark each source extraction as "applied" via correction_history
    // JSONB column append. Zero-migration audit linkage: when the modal
    // re-opens, it filters out extractions whose correction_history
    // contains an entry of type 'applied_to_deal' for THIS deal.
    if (sourceExtractionIds.size > 0) {
      const historyEntry = JSON.stringify({
        type: 'applied_to_deal',
        deal_id: dealId,
        applied_by: userId,
        applied_at: new Date().toISOString(),
        applied_fields: applied
          .filter((a) => sourceExtractionIds.has(a.source_extraction_id))
          .map((a) => ({
            canonical_field: a.canonical_field,
            table: a.table,
            column: a.column,
            source_field: a.source_field,
          })),
      });
      const idList = Array.from(sourceExtractionIds);
      // Append the new entry to correction_history JSONB array. If null,
      // coalesce to an empty array first.
      await client.query(
        `UPDATE document_extractions
            SET correction_history = COALESCE(correction_history, '[]'::jsonb) || $1::jsonb,
                updated_at = NOW()
          WHERE id = ANY($2::uuid[])
            AND organization_id = current_organization_id()`,
        [`[${historyEntry}]`, idList],
      );
    }

    return { dealBefore, dealAfter, propertyBefore, propertyAfter };
  });

  // ── Phase 3: append audit log rows (fail-open, outside transaction) ─
  // dealAuditLog.recordAudit is itself fail-open and never throws.
  let auditLogIdDeal = null;
  let auditLogIdProperty = null;

  if (Object.keys(dealUpdates).length > 0) {
    const dealBeforeSnap = pickColumns(txResult.dealBefore, dealUpdates);
    const dealAfterSnap = pickColumns(txResult.dealAfter, dealUpdates);
    const row = await dealAuditLog.recordAudit({
      dealId,
      eventType: 'updated',
      actorId: userId,
      before: dealBeforeSnap,
      after: dealAfterSnap,
      metadata: {
        source: 'document_extraction',
        applied_fields_count: Object.keys(dealUpdates).length,
        source_extraction_ids: Array.from(sourceExtractionIds),
        target_table: 'deals',
        ontology_version: ontology.getOntologyVersion(),
      },
    });
    auditLogIdDeal = row?.id || null;
  }

  if (Object.keys(propertyUpdates).length > 0 && txResult.propertyBefore) {
    const propBeforeSnap = pickColumns(txResult.propertyBefore, propertyUpdates);
    const propAfterSnap = pickColumns(txResult.propertyAfter, propertyUpdates);
    const row = await dealAuditLog.recordAudit({
      dealId,
      eventType: 'updated',
      actorId: userId,
      before: propBeforeSnap,
      after: propAfterSnap,
      metadata: {
        source: 'document_extraction',
        applied_fields_count: Object.keys(propertyUpdates).length,
        source_extraction_ids: Array.from(sourceExtractionIds),
        target_table: 'properties',
        property_id: txResult.propertyBefore.id,
        ontology_version: ontology.getOntologyVersion(),
      },
    });
    auditLogIdProperty = row?.id || null;
  }

  // ── Phase 4: capture per-field extraction verdicts (Workstream C) ───
  // Record — per applied field — whether the operator kept the AI's value or
  // overrode it: durable operational state + a values-free Layer-5 learning
  // signal. recordVerdictsForApply never throws and is migration-tolerant, so
  // awaiting it cannot break the apply — it just makes the signal reliable on
  // serverless (un-awaited work after the response can be killed).
  await extractionVerdicts.recordVerdictsForApply({
    dealId,
    organizationId: txResult.dealAfter?.organization_id || null,
    applied,
    userId,
  });

  return {
    applied,
    skipped,
    deal: txResult.dealAfter,
    property: txResult.propertyAfter,
    audit_log_id_deal: auditLogIdDeal,
    audit_log_id_property: auditLogIdProperty,
  };
};

// Extract just the columns we're tracking into a {col: val} snapshot for
// the audit log. Excludes everything else so the timeline reads cleanly.
const pickColumns = (row, columnMap) => {
  if (!row) return {};
  const snap = {};
  for (const col of Object.keys(columnMap)) {
    snap[col] = row[col] ?? null;
  }
  return snap;
};

module.exports = {
  applyExtractionsToDeal,
  // exported for tests
  __internal: {
    pickColumns,
  },
};
