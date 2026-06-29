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
const dealAuditLog = require('./dealAuditLog.service');

// Migration-tolerance: until 20260720_yield_studio_persistence is applied the
// table is absent. Reads degrade to null; writes surface the error (operator
// applies the migration before using the feature).
const isUndefinedTable = (err) =>
  !!err && (err.code === '42P01' || /relation .*yield_studies.* does not exist/i.test(err.message || ''));

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

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

// Replace the deal's active study. The partial-unique index
// (uniq_yield_studies_active) forbids two live rows, so soft-delete the prior
// active row then insert the new one — inside one transaction so the GUC
// org-context is shared and the swap is atomic.
async function upsertForDeal(dealId, data = {}, userId = null) {
  const envelope = asObject(data.envelope);
  const assumptions = asObject(data.assumptions);
  const assetClass = data.asset_class ?? null;
  const propertyId = data.property_id ?? null;
  const selectedScenario = data.selected_scenario ?? null;
  const engineVersion = data.engine_version ?? null;

  const row = await transaction(async (client) => {
    await client.query(
      `UPDATE yield_studies
          SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
        WHERE deal_id = $1
          AND organization_id = current_organization_id()
          AND deleted_at IS NULL`,
      [dealId, userId || null],
    );
    const inserted = await client.query(
      `INSERT INTO yield_studies
         (deal_id, property_id, asset_class, envelope, assumptions, selected_scenario, engine_version, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [dealId, propertyId, assetClass, envelope, assumptions, selectedScenario, engineVersion, userId || null],
    );
    return inserted.rows[0];
  });

  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'yield_study_saved',
    actorId: userId || null,
    after: { asset_class: row.asset_class, selected_scenario: row.selected_scenario, engine_version: row.engine_version },
    metadata: { yield_study_id: row.id },
  });
  return row;
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
