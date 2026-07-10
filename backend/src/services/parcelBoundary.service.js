'use strict';

// Server-side persistence for an analyst-uploaded / drawn parcel boundary (one
// active row per org + property). Stores the GeoJSON + its geodesic area +
// provenance. The frontend computes area_sqft (geoArea.js) and posts the parsed
// GeoJSON as JSON; this layer persists it and surfaces it alongside the
// read-only K-GIS boundary.
//
// Tenancy: identical to yieldStudio.service.js — INSERT omits organization_id
// (DEFAULT current_organization_id()); every read/write carries
// `organization_id = current_organization_id()` as the real tenant boundary.

const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const dealAuditLog = require('./dealAuditLog.service');

const isUndefinedTable = (err) =>
  !!err && (err.code === '42P01' || /relation .*parcel_boundaries.* does not exist/i.test(err.message || ''));

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function getActiveBoundary({ propertyId } = {}) {
  if (!propertyId) return null;
  try {
    const result = await query(
      `SELECT *
         FROM parcel_boundaries
        WHERE property_id = $1
          AND organization_id = current_organization_id()
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 1`,
      [propertyId],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isUndefinedTable(err)) return null;
    throw err;
  }
}

// Replace the property's active boundary (partial-unique index forbids two live
// rows). Soft-delete the prior, insert the new — atomic, shared org-context.
async function uploadBoundary(data = {}, userId = null) {
  const propertyId = data.property_id;
  if (!propertyId) throw new Error('property_id is required');
  const geometry = data.geometry_geojson;
  if (!geometry || typeof geometry !== 'object') throw new Error('geometry_geojson (object) is required');

  const dealId = data.deal_id ?? null;

  // Verify the property (and the optional deal link) exist in the caller's org
  // BEFORE writing. The RLS-bypassing role makes these WHERE clauses the only
  // tenant boundary; the deal check stops a request-body deal_id from planting
  // deal_audit_log rows on a foreign deal.
  const propertyResult = await query(
    'SELECT id FROM properties WHERE id = $1 AND organization_id = current_organization_id()',
    [propertyId],
  );
  if (propertyResult.rows.length === 0) {
    throw createError('Property not found.', 404);
  }
  if (dealId) {
    const dealResult = await query(
      'SELECT id FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
      [dealId],
    );
    if (dealResult.rows.length === 0) {
      throw createError('Deal not found.', 404);
    }
  }

  const source = data.source ?? 'manual';
  const areaSqft = num(data.area_sqft);
  const crs = data.crs ?? 'EPSG:4326';
  const confidence = num(data.confidence_score);
  const reviewStatus = data.review_status ?? 'pending';
  const notes = data.notes ?? null;

  const row = await transaction(async (client) => {
    await client.query(
      `UPDATE parcel_boundaries
          SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
        WHERE property_id = $1
          AND organization_id = current_organization_id()
          AND deleted_at IS NULL`,
      [propertyId, userId || null],
    );
    const inserted = await client.query(
      `INSERT INTO parcel_boundaries
         (property_id, deal_id, source, geometry_geojson, area_sqft, crs, confidence_score, review_status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [propertyId, dealId, source, geometry, areaSqft, crs, confidence, reviewStatus, notes, userId || null],
    );
    return inserted.rows[0];
  });

  // Audit only when tied to a deal (the audit log is deal-scoped).
  if (row.deal_id) {
    await dealAuditLog.recordAudit({
      dealId: row.deal_id,
      eventType: 'parcel_boundary_uploaded',
      actorId: userId || null,
      after: { source: row.source, area_sqft: row.area_sqft, review_status: row.review_status },
      metadata: { parcel_boundary_id: row.id, property_id: row.property_id },
    });
  }
  return row;
}

async function deleteByProperty(propertyId, actorId = null) {
  const result = await query(
    `UPDATE parcel_boundaries
        SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
      WHERE property_id = $1
        AND organization_id = current_organization_id()
        AND deleted_at IS NULL
      RETURNING id, deal_id, property_id`,
    [propertyId, actorId || null],
  );
  const row = result.rows[0] || null;
  if (row && row.deal_id) {
    await dealAuditLog.recordAudit({
      dealId: row.deal_id,
      eventType: 'parcel_boundary_deleted',
      actorId,
      metadata: { parcel_boundary_id: row.id, property_id: row.property_id },
    });
  }
  return row ? { id: row.id } : null;
}

module.exports = {
  getActiveBoundary,
  uploadBoundary,
  delete: deleteByProperty,
};
