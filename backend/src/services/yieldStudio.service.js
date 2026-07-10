'use strict';

// Server-side persistence for a Yield Studio study (one active row per
// org + deal). The study is the analyst's working scratch — envelope +
// assumptions in the exact engine shape `computeSiteYield` consumes — so
// exports can recompute the programme deterministically server-side and
// teammates see the same study across devices.
//
// Tenancy: the app connects to Postgres as an RLS-bypassing role, so the
// `organization_id = current_organization_id()` clause on every read/write is
// the REAL tenant boundary (RLS on yield_studies is defense-in-depth). INSERTs
// omit organization_id — the column DEFAULT current_organization_id() fills it
// and the RLS WITH CHECK passes. Mirrors risk.service.js exactly.

const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const dealAuditLog = require('./dealAuditLog.service');

// Migration-tolerance: until 20260720_yield_studio_persistence is applied the
// table is absent. Reads degrade to null; writes surface the error (operator
// applies the migration before using the feature).
const isUndefinedTable = (err) =>
  !!err && (err.code === '42P01' || /relation .*yield_studies.* does not exist/i.test(err.message || ''));

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Key-order-independent serialization for change detection. Postgres jsonb
// returns keys sorted; the incoming request body's key order is arbitrary —
// a naive JSON.stringify would call identical studies "changed" forever.
const stableStringify = (v) => {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

const studyFingerprint = (row) => stableStringify({
  envelope: asObject(row.envelope),
  assumptions: asObject(row.assumptions),
  asset_class: row.asset_class ?? null,
  property_id: row.property_id ?? null,
  selected_scenario: row.selected_scenario ?? null,
  engine_version: row.engine_version ?? null,
});

async function getByDeal(dealId) {
  if (!dealId) return null;
  try {
    const result = await query(
      `SELECT *
         FROM yield_studies
        WHERE deal_id = $1
          AND organization_id = current_organization_id()
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 1`,
      [dealId],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isUndefinedTable(err)) return null;
    throw err;
  }
}

// Save the deal's active study — idempotent and change-gated:
//   • identical payload → return the existing row untouched, write NOTHING
//     (the deal audit trail is immutable evidence; merely re-opening the tab
//     must never mint `yield_study_saved` events);
//   • real change → UPDATE the active row in place (stable row id, no
//     delete+insert churn against uniq_yield_studies_active, no 23505 race
//     between two quick saves) and write ONE audit event;
//   • no active row → INSERT; if a concurrent first-save wins the unique
//     index race (23505), retry once — the second pass finds the row and
//     UPDATEs it.
async function upsertForDeal(dealId, data = {}, userId = null, _retried = false) {
  // Verify the deal exists in the caller's org BEFORE writing. The RLS-bypassing
  // role makes this WHERE clause the only tenant boundary — without it a caller
  // from another org could attach a study to (and plant deal_audit_log rows on)
  // a foreign deal id.
  const dealResult = await query(
    'SELECT id FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId],
  );
  if (dealResult.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }

  const envelope = asObject(data.envelope);
  const assumptions = asObject(data.assumptions);
  const assetClass = data.asset_class ?? null;
  const propertyId = data.property_id ?? null;
  const selectedScenario = data.selected_scenario ?? null;
  const engineVersion = data.engine_version ?? null;
  const incoming = {
    envelope, assumptions, asset_class: assetClass, property_id: propertyId,
    selected_scenario: selectedScenario, engine_version: engineVersion,
  };

  let outcome;
  try {
    outcome = await transaction(async (client) => {
      const existing = await client.query(
        `SELECT * FROM yield_studies
          WHERE deal_id = $1
            AND organization_id = current_organization_id()
            AND deleted_at IS NULL
          LIMIT 1`,
        [dealId],
      );
      const prior = existing.rows[0] || null;
      if (prior && studyFingerprint(prior) === studyFingerprint(incoming)) {
        return { row: prior, changed: false };
      }
      if (prior) {
        const updated = await client.query(
          `UPDATE yield_studies
              SET property_id = $2, asset_class = $3, envelope = $4, assumptions = $5,
                  selected_scenario = $6, engine_version = $7, updated_by = $8, updated_at = NOW()
            WHERE id = $1
              AND organization_id = current_organization_id()
              AND deleted_at IS NULL
            RETURNING *`,
          [prior.id, propertyId, assetClass, envelope, assumptions, selectedScenario, engineVersion, userId || null],
        );
        return { row: updated.rows[0], changed: true };
      }
      const inserted = await client.query(
        `INSERT INTO yield_studies
           (deal_id, property_id, asset_class, envelope, assumptions, selected_scenario, engine_version, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING *`,
        [dealId, propertyId, assetClass, envelope, assumptions, selectedScenario, engineVersion, userId || null],
      );
      return { row: inserted.rows[0], changed: true };
    });
  } catch (err) {
    if (err && err.code === '23505' && !_retried) {
      // Two first-saves raced the partial-unique index; the loser retries once
      // and lands on the UPDATE path against the winner's row.
      return upsertForDeal(dealId, data, userId, true);
    }
    throw err;
  }

  if (outcome.changed) {
    await dealAuditLog.recordAudit({
      dealId,
      eventType: 'yield_study_saved',
      actorId: userId || null,
      after: { asset_class: outcome.row.asset_class, selected_scenario: outcome.row.selected_scenario, engine_version: outcome.row.engine_version },
      metadata: { yield_study_id: outcome.row.id },
    });
  }
  return outcome.row;
}

async function deleteByDeal(dealId, actorId = null) {
  const result = await query(
    `UPDATE yield_studies
        SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
      WHERE deal_id = $1
        AND organization_id = current_organization_id()
        AND deleted_at IS NULL
      RETURNING id, deal_id`,
    [dealId, actorId || null],
  );
  const row = result.rows[0] || null;
  if (row) {
    await dealAuditLog.recordAudit({
      dealId,
      eventType: 'yield_study_deleted',
      actorId,
      metadata: { yield_study_id: row.id },
    });
  }
  return row ? { id: row.id } : null;
}

module.exports = {
  getByDeal,
  upsertForDeal,
  delete: deleteByDeal,
};
