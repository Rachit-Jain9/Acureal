'use strict';

// Deal Registers service — the rent roll / sales & collections / hotel
// operating / occupant registers under every deal (plan v2, 2026-07-14).
//
// One live `deal_registers` row per deal (family derived from asset class),
// family-specific record tables, immutable `register_snapshots`. Derived
// metrics come from utils/rentRollMetrics — the parent `summary` column is a
// CACHE recomputed inside every mutation transaction (that recompute also
// bumps the parent's updated_at, which is the workspace cache's freshness
// fingerprint — every record write MUST go through a helper that does this).
//
// All reads/writes are org-scoped (organization_id = current_organization_id())
// on top of RLS, and soft-delete aware. Every mutation records a
// dealAuditLog event; bulk import records ONE event with row counts.
//
// Tables may predate the operator applying 20260726_deal_registers.sql —
// read paths treat 42P01 (undefined_table) as "feature unavailable" (null),
// mirroring dealAuditLog's posture. Write paths surface the error.

const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const dealAuditLog = require('./dealAuditLog.service');
const {
  METRICS_VERSION,
  computeLeaseMetrics,
  validateLeaseRoll,
  computeSaleMetrics,
  validateSaleRoll,
  computeHotelMetrics,
  validateHotelRoll,
  computeOccupantMetrics,
  validateOccupantRoll,
} = require('../utils/rentRollMetrics');

// Family → metric/validator dispatch. Centralized so recomputeSummary,
// createSnapshot, and getExportSlice can never drift on which engine runs for
// which register family. Families without an engine yet return null metrics
// (record counts still keep the summary honest).
const metricsForFamily = (register, recordsByKind) => {
  switch (register.register_family) {
    case 'lease_income':
      return computeLeaseMetrics(recordsByKind.lease || [], register);
    case 'sales_collections':
      return computeSaleMetrics(recordsByKind.sale || [], register);
    case 'hotel_operating':
      return computeHotelMetrics(recordsByKind, register);
    case 'redevelopment':
      // Two kinds under one register: occupant obligations + free-sale inventory.
      return {
        occupant: computeOccupantMetrics(recordsByKind.occupant || [], register),
        sale: computeSaleMetrics(recordsByKind.sale || [], register),
      };
    default:
      return null;
  }
};

const warningsForFamily = (register, recordsByKind, financialInputs) => {
  switch (register.register_family) {
    case 'lease_income':
      return validateLeaseRoll(recordsByKind.lease || [], register, financialInputs);
    case 'sales_collections':
      return validateSaleRoll(recordsByKind.sale || [], register);
    case 'hotel_operating':
      return validateHotelRoll(recordsByKind);
    case 'redevelopment':
      return [
        ...validateOccupantRoll(recordsByKind.occupant || [], register),
        ...validateSaleRoll(recordsByKind.sale || [], register),
      ];
    default:
      return [];
  }
};

// ── Family / kind registry ──────────────────────────────────────────────────

const REGISTER_FAMILY_BY_ASSET_CLASS = Object.freeze({
  residential_apartments: 'lease_income',
  villas: 'lease_income',
  commercial_office: 'lease_income',
  retail: 'lease_income',
  industrial_warehousing: 'lease_income',
  mixed_use: 'lease_income',
  raw_land: 'lease_income',           // ground-lease & licence roll
  plotted_development: 'sales_collections',
  hospitality: 'hotel_operating',
  redevelopment: 'redevelopment',      // occupants + free-sale inventory
});

const RECORD_KINDS_BY_FAMILY = Object.freeze({
  lease_income: ['lease'],
  sales_collections: ['sale'],
  hotel_operating: ['hotel_key_block', 'hotel_contract', 'hotel_operating_month'],
  redevelopment: ['occupant', 'sale'],
});

const RECORD_TABLE_BY_KIND = Object.freeze({
  lease: 'lease_records',
  sale: 'sale_records',
  hotel_key_block: 'hotel_key_blocks',
  hotel_contract: 'hotel_contracts',
  hotel_operating_month: 'hotel_operating_months',
  occupant: 'occupant_records',
});

// Writable columns per kind — anything else in a payload is dropped, never
// interpolated. Mirrors 20260726_deal_registers.sql exactly.
const COMMON_RECORD_COLUMNS = [
  'position', 'record_label', 'attributes',
  'source', 'verified', 'field_sources', 'source_document_id', 'extraction_id',
];

const RECORD_COLUMNS_BY_KIND = Object.freeze({
  lease: [
    ...COMMON_RECORD_COLUMNS,
    'building', 'unit_ref', 'tenant_name', 'sector_use', 'status',
    'rent_basis', 'chargeable_area_sqft',
    'lease_start', 'rent_commencement', 'lease_expiry', 'lockin_end', 'notice_period_months',
    'base_rent_rate', 'cam_rate', 'cam_treatment',
    'ancillary_qty', 'ancillary_rate_monthly', 'other_income_monthly',
    'sales_revenue_base_annual', 'variable_rent_pct',
    'escalation_pct', 'escalation_every_months', 'rent_steps', 'rent_free_months',
    'deposit_months', 'security_deposit_amount',
    'gst_pct', 'tds_pct', 'collection_pct', 'market_rent_rate', 'owner_opex_annual',
  ],
  sale: [
    ...COMMON_RECORD_COLUMNS,
    'block_phase', 'unit_type', 'customer_name', 'status',
    'area_sqft', 'base_price_per_sqft', 'other_charges_amount', 'gst_pct',
    'agreement_value', 'amount_collected', 'amount_overdue', 'current_market_rate',
    'booking_date', 'agreement_date', 'possession_date', 'payment_milestones',
  ],
  hotel_key_block: [
    ...COMMON_RECORD_COLUMNS,
    'room_type', 'keys_count', 'operational', 'ooo_pct', 'adr_premium_pct', 'floor_wing',
  ],
  hotel_contract: [
    ...COMMON_RECORD_COLUMNS,
    'operator_name', 'brand', 'contract_type',
    'start_date', 'end_date', 'lockin_end', 'notice_period_months',
    'base_fee_pct', 'incentive_fee_pct', 'minimum_guarantee_annual',
    'owner_priority_annual', 'ffe_reserve_pct', 'key_money',
    'security_deposit_amount', 'keys_covered',
  ],
  // No position / record_label — identity is the month itself.
  hotel_operating_month: [
    'attributes', 'source', 'verified', 'field_sources', 'source_document_id', 'extraction_id',
    'month', 'occupancy_pct', 'adr', 'room_revenue', 'fnb_revenue', 'other_revenue',
    'dept_expenses', 'undistributed_expenses', 'gop', 'fees_paid', 'ffe_reserve', 'owner_noi',
  ],
  occupant: [
    ...COMMON_RECORD_COLUMNS,
    'building', 'occupant_name', 'occupancy_type', 'agreement_status', 'status',
    'existing_carpet_area_sqft', 'rehab_entitlement_sqft', 'additional_area_sqft',
    'transit_rent_monthly', 'transit_rent_start', 'transit_rent_end',
    'transit_rent_escalation_pct', 'shifting_allowance', 'brokerage_amount',
    'corpus_amount', 'other_obligation_amount', 'rehab_possession_target',
    'documentation_risk',
  ],
});

// JSONB columns must be stringified explicitly — node-postgres would format a
// bare JS array (e.g. rent_steps) as a Postgres array literal, not JSON.
const JSONB_RECORD_COLUMNS = new Set([
  'attributes', 'field_sources', 'rent_steps', 'payment_milestones',
]);

const REGISTER_SETTINGS_COLUMNS = [
  'status', 'as_of_date', 'total_leasable_area_sqft', 'area_display_unit', 'settings',
];

const MISSING_TABLE = '42P01';

const resolveFamily = (assetClass) => REGISTER_FAMILY_BY_ASSET_CLASS[assetClass] || 'lease_income';

const kindsForFamily = (family) => RECORD_KINDS_BY_FAMILY[family] || ['lease'];

const assertKind = (kind, family = null) => {
  if (!RECORD_TABLE_BY_KIND[kind]) {
    const err = new Error(`Unknown record kind: ${kind}`);
    err.statusCode = 400;
    throw err;
  }
  if (family && !kindsForFamily(family).includes(kind)) {
    const err = new Error(`Record kind '${kind}' does not belong to the '${family}' register`);
    err.statusCode = 400;
    throw err;
  }
};

const jsonbSafe = (column, value) => {
  if (!JSONB_RECORD_COLUMNS.has(column)) return value;
  if (value === null || value === undefined) return value;
  return JSON.stringify(value);
};

// ── Internal helpers (all take a client so they compose inside transactions) ─

const selectLiveRegister = async (db, dealId, { forUpdate = false } = {}) => {
  const res = await db.query(
    `SELECT * FROM deal_registers
      WHERE deal_id = $1
        AND organization_id = current_organization_id()
        AND deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [dealId],
  );
  return res.rows[0] || null;
};

const ensureRegister = async (client, dealId, userId) => {
  const existing = await selectLiveRegister(client, dealId, { forUpdate: true });
  if (existing) return existing;

  const dealRes = await client.query(
    `SELECT id, asset_class FROM deals
      WHERE id = $1 AND organization_id = current_organization_id()`,
    [dealId],
  );
  const deal = dealRes.rows[0];
  if (!deal) {
    const err = new Error('Deal not found');
    err.statusCode = 404;
    throw err;
  }

  const family = resolveFamily(deal.asset_class);
  const inserted = await client.query(
    `INSERT INTO deal_registers (deal_id, register_family, created_by, updated_by)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (deal_id) WHERE deleted_at IS NULL DO NOTHING
     RETURNING *`,
    [dealId, family, userId || null],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  // Lost a create race — the winner's row is now visible.
  return selectLiveRegister(client, dealId, { forUpdate: true });
};

const listRecordsForKind = async (db, dealId, kind) => {
  const table = RECORD_TABLE_BY_KIND[kind];
  const orderBy = kind === 'hotel_operating_month' ? 'month' : 'position, id';
  const res = await db.query(
    `SELECT * FROM ${table}
      WHERE deal_id = $1
        AND organization_id = current_organization_id()
        AND deleted_at IS NULL
      ORDER BY ${orderBy}`,
    [dealId],
  );
  return res.rows;
};

// Recompute the parent summary cache from live rows and bump updated_at —
// THE invariant every mutation relies on (workspace cache fingerprints
// deal_registers.updated_at; provenance staleness reads summary.dataHash).
const recomputeSummary = async (client, register) => {
  const kinds = kindsForFamily(register.register_family);
  const recordsByKind = {};
  for (const kind of kinds) {
    recordsByKind[kind] = await listRecordsForKind(client, register.deal_id, kind);
  }

  const recordCounts = Object.fromEntries(
    Object.entries(recordsByKind).map(([k, rows]) => [k, rows.length]),
  );

  // hotel_operating / redevelopment metrics land with their family PRs —
  // record counts keep the summary honest until then.
  const metrics = metricsForFamily(register, recordsByKind);

  const dataHash = hashRegister(register, recordsByKind);
  const summary = {
    metricsVersion: METRICS_VERSION,
    computedAt: new Date().toISOString(),
    recordCounts,
    dataHash,
    metrics,
  };

  const res = await client.query(
    `UPDATE deal_registers
        SET summary = $2, updated_at = NOW()
      WHERE id = $1
        AND organization_id = current_organization_id()
      RETURNING *`,
    [register.id, JSON.stringify(summary)],
  );
  return res.rows[0] || register;
};

// Stable content hash over the register's live rows PLUS the register-level
// scalars that drive derived metrics and the financial bridge (as-of date,
// leasable-area denominator, LOI policy). A denominator or policy edit changes
// occupancy/vacancy without touching a single row — the hash must move with
// it or staleness checks would sleep through exactly the changes that matter.
const hashRegister = (register, recordsByKind) => {
  const canonical = [
    {
      as_of_date: register?.as_of_date ?? null,
      total_leasable_area_sqft: register?.total_leasable_area_sqft ?? null,
      loi_policy: register?.settings?.loi_policy ?? 'include',
    },
    Object.keys(recordsByKind).sort().map((kind) => [
      kind,
      recordsByKind[kind].map((r) => {
        const { created_at, updated_at, ...rest } = r;
        return rest;
      }),
    ]),
  ];
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const buildInsert = (kind, dealId, registerId, data, userId) => {
  const allowed = RECORD_COLUMNS_BY_KIND[kind];
  const columns = ['deal_id', 'register_id', 'created_by', 'updated_by'];
  const values = [dealId, registerId, userId || null, userId || null];
  for (const col of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, col)) {
      columns.push(col);
      values.push(jsonbSafe(col, data[col]));
    }
  }
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  return {
    sql: `INSERT INTO ${RECORD_TABLE_BY_KIND[kind]} (${columns.join(', ')})
          VALUES (${placeholders})
          RETURNING *`,
    values,
  };
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * The register + all live records for a deal. Null register (never created,
 * or migration not applied) is a valid empty state, not an error.
 */
async function getRegister(dealId) {
  try {
    const register = await selectLiveRegister({ query }, dealId);
    if (!register) return { register: null, records: {} };
    const records = {};
    for (const kind of kindsForFamily(register.register_family)) {
      records[kind] = await listRecordsForKind({ query }, dealId, kind);
    }
    return { register, records };
  } catch (err) {
    if (err.code === MISSING_TABLE) return { register: null, records: {}, unavailable: true };
    throw err;
  }
}

/**
 * Resolve a deal's register family (from its asset class) + name — for the
 * import-template download, which must work BEFORE any register exists.
 */
async function getDealRegisterInfo(dealId) {
  const res = await query(
    `SELECT id, name, asset_class FROM deals
      WHERE id = $1 AND organization_id = current_organization_id()`,
    [dealId],
  );
  const deal = res.rows[0];
  if (!deal) {
    const err = new Error('Deal not found');
    err.statusCode = 404;
    throw err;
  }
  return { dealId: deal.id, dealName: deal.name, assetClass: deal.asset_class, family: resolveFamily(deal.asset_class) };
}

/** Update register-level settings (creating the register lazily). */
async function updateSettings(dealId, data, userId) {
  const updated = await transaction(async (client) => {
    const register = await ensureRegister(client, dealId, userId);

    const setClauses = [];
    const values = [];
    let i = 1;
    for (const col of REGISTER_SETTINGS_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(data, col)) {
        setClauses.push(`${col} = $${i}`);
        values.push(col === 'settings' ? JSON.stringify(data[col] ?? {}) : data[col]);
        i += 1;
      }
    }
    let row = register;
    if (setClauses.length > 0) {
      values.push(register.id);
      const res = await client.query(
        `UPDATE deal_registers
            SET ${setClauses.join(', ')}, updated_by = $${i + 1}, updated_at = NOW()
          WHERE id = $${i}
            AND organization_id = current_organization_id()
          RETURNING *`,
        [...values, userId || null],
      );
      row = res.rows[0] || register;
    }
    return recomputeSummary(client, row);
  });

  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'register_settings_updated',
    actorId: userId || null,
    after: {
      status: updated.status,
      as_of_date: updated.as_of_date,
      total_leasable_area_sqft: updated.total_leasable_area_sqft,
    },
    metadata: { register_id: updated.id, register_family: updated.register_family },
  });
  return updated;
}

async function createRecord(dealId, kind, data, userId) {
  assertKind(kind);
  const { record, register } = await transaction(async (client) => {
    const reg = await ensureRegister(client, dealId, userId);
    assertKind(kind, reg.register_family);
    const { sql, values } = buildInsert(kind, dealId, reg.id, data, userId);
    const res = await client.query(sql, values);
    const updatedRegister = await recomputeSummary(client, reg);
    return { record: res.rows[0], register: updatedRegister };
  });

  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'register_record_created',
    actorId: userId || null,
    after: {
      kind,
      record_label: record.record_label || record.room_type || record.month || null,
      status: record.status || null,
    },
    metadata: { register_id: register.id, record_id: record.id, kind },
  });
  return record;
}

async function updateRecord(dealId, kind, recordId, data, userId) {
  assertKind(kind);
  const table = RECORD_TABLE_BY_KIND[kind];
  const allowed = RECORD_COLUMNS_BY_KIND[kind];

  const { before, record } = await transaction(async (client) => {
    const register = await selectLiveRegister(client, dealId, { forUpdate: true });
    if (!register) {
      const err = new Error('Register not found');
      err.statusCode = 404;
      throw err;
    }
    assertKind(kind, register.register_family);

    const beforeRes = await client.query(
      `SELECT * FROM ${table}
        WHERE id = $1 AND deal_id = $2
          AND organization_id = current_organization_id()
          AND deleted_at IS NULL`,
      [recordId, dealId],
    );
    const beforeRow = beforeRes.rows[0];
    if (!beforeRow) {
      const err = new Error('Record not found');
      err.statusCode = 404;
      throw err;
    }

    const setClauses = [];
    const values = [];
    let i = 1;
    for (const col of allowed) {
      if (Object.prototype.hasOwnProperty.call(data, col)) {
        setClauses.push(`${col} = $${i}`);
        values.push(jsonbSafe(col, data[col]));
        i += 1;
      }
    }
    if (setClauses.length === 0) return { before: beforeRow, record: beforeRow };

    values.push(recordId, dealId);
    const res = await client.query(
      `UPDATE ${table}
          SET ${setClauses.join(', ')}, updated_by = $${i + 2}, updated_at = NOW()
        WHERE id = $${i} AND deal_id = $${i + 1}
          AND organization_id = current_organization_id()
          AND deleted_at IS NULL
        RETURNING *`,
      [...values, userId || null],
    );
    await recomputeSummary(client, register);
    return { before: beforeRow, record: res.rows[0] };
  });

  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'register_record_updated',
    actorId: userId || null,
    before: { status: before.status || null },
    after: { status: record.status || null, kind },
    metadata: { record_id: record.id, kind },
  });
  return record;
}

async function deleteRecord(dealId, kind, recordId, userId) {
  assertKind(kind);
  const table = RECORD_TABLE_BY_KIND[kind];

  const deleted = await transaction(async (client) => {
    const register = await selectLiveRegister(client, dealId, { forUpdate: true });
    if (!register) return null;
    const res = await client.query(
      `UPDATE ${table}
          SET deleted_at = NOW(), deleted_by = $3
        WHERE id = $1 AND deal_id = $2
          AND organization_id = current_organization_id()
          AND deleted_at IS NULL
        RETURNING *`,
      [recordId, dealId, userId || null],
    );
    if (!res.rows[0]) return null;
    await recomputeSummary(client, register);
    return res.rows[0];
  });

  if (deleted) {
    await dealAuditLog.recordAudit({
      dealId,
      eventType: 'register_record_deleted',
      actorId: userId || null,
      before: { kind, record_label: deleted.record_label || null, status: deleted.status || null },
      metadata: { record_id: deleted.id, kind },
    });
  }
  return deleted;
}

/** Bulk insert (import path). One transaction, ONE audit event. */
async function bulkUpsertRecords(dealId, kind, rows, { source = 'import', sourceDocumentId = null, userId = null } = {}) {
  assertKind(kind);
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error('rows must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }

  const { inserted, register } = await transaction(async (client) => {
    const reg = await ensureRegister(client, dealId, userId);
    assertKind(kind, reg.register_family);
    const out = [];
    // hotel_operating_month has no position column; skip the seed query.
    let nextPos = 0;
    if (RECORD_COLUMNS_BY_KIND[kind].includes('position')) {
      const posRes = await client.query(
        `SELECT coalesce(max(position), 0) AS max_pos FROM ${RECORD_TABLE_BY_KIND[kind]}
          WHERE deal_id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL`,
        [dealId],
      );
      nextPos = Number(posRes.rows[0]?.max_pos || 0);
    }
    for (const row of rows) {
      nextPos += 1;
      const withMeta = {
        ...row,
        position: row.position ?? nextPos,
        source,
        source_document_id: row.source_document_id ?? sourceDocumentId,
      };
      const { sql, values } = buildInsert(kind, dealId, reg.id, withMeta, userId);
      const res = await client.query(sql, values);
      out.push(res.rows[0]);
    }
    const updatedRegister = await recomputeSummary(client, reg);
    return { inserted: out, register: updatedRegister };
  });

  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'register_bulk_imported',
    actorId: userId || null,
    after: { kind, row_count: inserted.length, source },
    metadata: { register_id: register.id, kind, source_document_id: sourceDocumentId },
  });
  return inserted;
}

/** Freeze the register into an immutable snapshot (append-only). */
async function createSnapshot(dealId, { label = null, trigger = 'manual' } = {}, userId = null) {
  const snapshot = await transaction(async (client) => {
    const register = await selectLiveRegister(client, dealId);
    if (!register) {
      const err = new Error('Register not found');
      err.statusCode = 404;
      throw err;
    }
    const recordsByKind = {};
    for (const kind of kindsForFamily(register.register_family)) {
      recordsByKind[kind] = await listRecordsForKind(client, dealId, kind);
    }
    const metrics = metricsForFamily(register, recordsByKind)
      || { recordCounts: Object.fromEntries(Object.entries(recordsByKind).map(([k, v]) => [k, v.length])) };
    const dataHash = hashRegister(register, recordsByKind);

    const res = await client.query(
      `INSERT INTO register_snapshots
         (register_id, deal_id, label, trigger, as_of_date, records, metrics, metrics_version, data_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, register_id, deal_id, label, trigger, as_of_date, metrics_version, data_hash, created_at`,
      [
        register.id, dealId, label, trigger, register.as_of_date,
        JSON.stringify(recordsByKind), JSON.stringify(metrics),
        METRICS_VERSION, dataHash, userId,
      ],
    );
    return res.rows[0];
  });

  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'register_snapshot_created',
    actorId: userId,
    after: { label, trigger, data_hash: snapshot.data_hash },
    metadata: { snapshot_id: snapshot.id, register_id: snapshot.register_id },
  });
  return snapshot;
}

async function listSnapshots(dealId, limit = 20) {
  try {
    const res = await query(
      `SELECT id, register_id, deal_id, label, trigger, as_of_date,
              metrics_version, data_hash, created_by, created_at
         FROM register_snapshots
        WHERE deal_id = $1 AND organization_id = current_organization_id()
        ORDER BY created_at DESC
        LIMIT $2`,
      [dealId, Math.min(Number(limit) || 20, 100)],
    );
    return res.rows;
  } catch (err) {
    if (err.code === MISSING_TABLE) return [];
    throw err;
  }
}

// ── Read-model slices ───────────────────────────────────────────────────────

/** Lightweight slice for the deal-workspace payload (summary only, no rows). */
async function getWorkspaceSlice(dealId) {
  try {
    const register = await selectLiveRegister({ query }, dealId);
    if (!register) return null;
    return {
      family: register.register_family,
      status: register.status,
      asOfDate: register.as_of_date,
      totalLeasableAreaSqft: register.total_leasable_area_sqft,
      settings: register.settings || {},
      summary: register.summary || {},
      updatedAt: register.updated_at,
    };
  } catch (err) {
    if (err.code === MISSING_TABLE) return null;
    throw err;
  }
}

/**
 * Full slice for the export context: live records + metrics RECOMPUTED from
 * live rows (never the summary cache) + WARN-only validation findings.
 */
async function getExportSlice(dealId, financialInputs = null) {
  try {
    const { register, records } = await getRegister(dealId);
    if (!register) return null;
    const metrics = metricsForFamily(register, records);
    const warnings = warningsForFamily(register, records, financialInputs);
    return {
      family: register.register_family,
      asOfDate: register.as_of_date,
      totalLeasableAreaSqft: register.total_leasable_area_sqft,
      settings: register.settings || {},
      records,
      metrics,
      warnings,
      dataHash: hashRegister(register, records),
      metricsVersion: METRICS_VERSION,
      updatedAt: register.updated_at,
    };
  } catch (err) {
    if (err.code === MISSING_TABLE) return null;
    throw err;
  }
}

module.exports = {
  REGISTER_FAMILY_BY_ASSET_CLASS,
  RECORD_KINDS_BY_FAMILY,
  RECORD_TABLE_BY_KIND,
  RECORD_COLUMNS_BY_KIND,
  resolveFamily,
  getRegister,
  getDealRegisterInfo,
  updateSettings,
  createRecord,
  updateRecord,
  deleteRecord,
  bulkUpsertRecords,
  createSnapshot,
  listSnapshots,
  getWorkspaceSlice,
  getExportSlice,
};
