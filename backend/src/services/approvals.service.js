'use strict';

const { query } = require('../config/database');
const { EVENTS, publish } = require('../lib/eventBus');
const dealStructureMatrix = require('../utils/dealStructureMatrix');
const dealAuditLog = require('./dealAuditLog.service');

const normalizeApprovalStatus = (value) => {
  const status = String(value || 'pending').trim().toLowerCase();
  const map = {
    not_started: 'pending',
    applied: 'in_progress',
    in_review: 'in_progress',
    approved: 'validated',
    rejected: 'issue',
  };
  return map[status] || status;
};

// snake_case column → camelCase request alias (null = no alias).
const APPROVAL_FIELD_ALIASES = {
  approval_type: 'approvalType',
  name: null,
  is_required: 'isRequired',
  is_available: 'isAvailable',
  is_uploaded: 'isUploaded',
  is_validated: 'isValidated',
  issued_date: 'issuedDate',
  expiry_date: 'expiryDate',
  reference_number: 'referenceNumber',
  issuing_authority: 'issuingAuthority',
  document_id: 'documentId',
  status: null,
  notes: null,
  next_action: 'nextAction',
};

// Emit ONLY the keys the caller actually sent (snake or camel), so a partial
// PATCH touches only those columns. The previous version always materialised
// all 14 keys, so update() wrote every column on any PATCH — omitting `status`
// silently reset it to 'pending' and omitting a date NULLed it. create() fills
// any gaps from its own destructure defaults, so its behaviour is unchanged.
const normalizeApprovalPayload = (data = {}) => {
  const has = (k) => Object.prototype.hasOwnProperty.call(data, k);
  const out = {};
  for (const [snake, camel] of Object.entries(APPROVAL_FIELD_ALIASES)) {
    const key = has(snake) ? snake : (camel && has(camel) ? camel : null);
    if (!key) continue;
    out[snake] = snake === 'status' ? normalizeApprovalStatus(data[key]) : data[key];
  }
  return out;
};

// ──────────────────────────────────────────────────────────────────────────────
// Default approval templates per asset class
// Each item: { approval_type, name, is_required }
// ──────────────────────────────────────────────────────────────────────────────

const RESIDENTIAL_APPROVALS = [
  {
    approval_type: 'planning',
    name: 'CDP / Master Plan Zoning Certificate',
    is_required: true,
  },
  {
    approval_type: 'conversion',
    name: 'DC Conversion Order (Agricultural to Non-Agricultural)',
    is_required: true,
  },
  {
    approval_type: 'khata',
    name: 'Khata Certificate & Extract (BBMP / BMRDA)',
    is_required: true,
  },
  {
    approval_type: 'building_plan',
    name: 'Sanctioned Building Plan (BDA / BBMP / BMICAPA)',
    is_required: true,
  },
  {
    approval_type: 'building_plan',
    name: 'Building Commencement Certificate (BCC)',
    is_required: false,
  },
  {
    approval_type: 'fire_noc',
    name: 'Fire NOC (Karnataka Fire & Emergency Services)',
    is_required: true,
  },
  {
    approval_type: 'water_sewage',
    name: 'BWSSB Water Connection / NOC',
    is_required: true,
  },
  {
    approval_type: 'water_sewage',
    name: 'BWSSB Sewage Connection / NOC',
    is_required: true,
  },
  {
    approval_type: 'power',
    name: 'BESCOM Power Connection / NOC',
    is_required: true,
  },
  {
    approval_type: 'rera',
    name: 'RERA Karnataka Registration',
    is_required: true,
  },
  {
    approval_type: 'environment',
    name: 'Environment Clearance (if project > 20,000 sqm)',
    is_required: false,
  },
];

const PLOTTED_APPROVALS = [
  {
    approval_type: 'planning',
    name: 'CDP / Master Plan Zoning Certificate',
    is_required: true,
  },
  {
    approval_type: 'conversion',
    name: 'DC Conversion Order (Agricultural to Non-Agricultural)',
    is_required: true,
  },
  {
    approval_type: 'khata',
    name: 'Khata Certificate & Extract',
    is_required: true,
  },
  {
    approval_type: 'building_plan',
    name: 'Layout Plan Approval (BDA / BMRDA / BMICAPA)',
    is_required: true,
  },
  {
    approval_type: 'rera',
    name: 'RERA Karnataka Registration (Plotted Layout)',
    is_required: true,
  },
  {
    approval_type: 'water_sewage',
    name: 'BWSSB / Gram Panchayat Water & Sewage NOC',
    is_required: false,
  },
  {
    approval_type: 'power',
    name: 'BESCOM Power Connection NOC',
    is_required: false,
  },
];

const COMMERCIAL_APPROVALS = [
  {
    approval_type: 'planning',
    name: 'CDP / Master Plan Commercial Zoning Certificate',
    is_required: true,
  },
  {
    approval_type: 'conversion',
    name: 'DC Conversion Order (if on converted land)',
    is_required: false,
  },
  {
    approval_type: 'khata',
    name: 'Khata Certificate & Extract (BBMP)',
    is_required: true,
  },
  {
    approval_type: 'building_plan',
    name: 'Sanctioned Commercial Building Plan (BBMP / BDA)',
    is_required: true,
  },
  {
    approval_type: 'fire_noc',
    name: 'Fire NOC (Karnataka Fire & Emergency Services)',
    is_required: true,
  },
  {
    approval_type: 'water_sewage',
    name: 'BWSSB Water & Sewage Connection / NOC',
    is_required: true,
  },
  {
    approval_type: 'power',
    name: 'BESCOM Power Connection (HT/LT) NOC',
    is_required: true,
  },
  {
    approval_type: 'environment',
    name: 'State-level Environment Clearance (SEAC)',
    is_required: false,
  },
  {
    approval_type: 'airport_height',
    name: 'AAI Airport Height Clearance (if near HAL / KIAL)',
    is_required: false,
  },
];

const RAW_LAND_APPROVALS = [
  {
    approval_type: 'planning',
    name: 'CDP / Master Plan Zoning Certificate',
    is_required: true,
  },
  {
    approval_type: 'conversion',
    name: 'DC Conversion Order',
    is_required: false,
  },
  {
    approval_type: 'khata',
    name: 'Khata Certificate & Extract',
    is_required: false,
  },
];

const ASSET_CLASS_APPROVALS = {
  residential_apartments: RESIDENTIAL_APPROVALS,
  plotted_development: PLOTTED_APPROVALS,
  villas: RESIDENTIAL_APPROVALS,
  commercial_office: COMMERCIAL_APPROVALS,
  retail: COMMERCIAL_APPROVALS,
  industrial_warehousing: COMMERCIAL_APPROVALS,
  hospitality: COMMERCIAL_APPROVALS,
  mixed_use: RESIDENTIAL_APPROVALS,
  raw_land: RAW_LAND_APPROVALS,
  redevelopment: RESIDENTIAL_APPROVALS,
};

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

async function listByDeal(dealId) {
  const result = await query(
    `SELECT a.*,
            d.name AS document_name
     FROM approval_items a
     LEFT JOIN documents d ON d.id = a.document_id
     WHERE a.deal_id = $1
       AND a.organization_id = current_organization_id()
       AND a.deleted_at IS NULL
     ORDER BY a.approval_type, a.created_at`,
    [dealId],
  );
  return result.rows;
}

async function create(dealId, data, actorId = null) {
  const normalized = normalizeApprovalPayload(data);
  const {
    approval_type,
    name,
    is_required = true,
    is_available = false,
    is_uploaded = false,
    is_validated = false,
    issued_date = null,
    expiry_date = null,
    reference_number = null,
    issuing_authority = null,
    document_id = null,
    status = 'pending',
    notes = null,
    next_action = null,
  } = normalized;

  const result = await query(
    `INSERT INTO approval_items
       (deal_id, approval_type, name, is_required, is_available, is_uploaded, is_validated,
        issued_date, expiry_date, reference_number, issuing_authority, document_id,
        status, notes, next_action)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      dealId, approval_type, name, is_required, is_available, is_uploaded, is_validated,
      issued_date, expiry_date, reference_number, issuing_authority, document_id,
      status, notes, next_action,
    ],
  );
  const row = result.rows[0];
  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'approval_created',
    actorId,
    after: { approval_type: row.approval_type, name: row.name, status: row.status, is_validated: row.is_validated },
    metadata: { approval_id: row.id },
  });
  return row;
}

async function update(id, data, actorId = null) {
  const normalizedData = normalizeApprovalPayload(data);
  const allowed = [
    'approval_type', 'name', 'is_required', 'is_available', 'is_uploaded', 'is_validated',
    'issued_date', 'expiry_date', 'reference_number', 'issuing_authority',
    'document_id', 'status', 'notes', 'next_action',
  ];

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(normalizedData, field)) {
      setClauses.push(`${field} = $${paramIndex}`);
      values.push(normalizedData[field]);
      paramIndex += 1;
    }
  }

  if (setClauses.length === 0) {
    // Org-scope this read exactly like the UPDATE/DELETE below. The app connects
    // as the RLS-bypassing role, so this WHERE clause is the ONLY tenant
    // boundary — without it an empty-body PUT would return another org's
    // statutory-approval record (one of the legal-four lanes). `deleted_at IS
    // NULL` keeps a soft-deleted approval invisible here too.
    const existing = await query(
      'SELECT * FROM approval_items WHERE id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL',
      [id],
    );
    return existing.rows[0] || null;
  }

  // Snapshot BEFORE state (same org + live scope) for the audit diff.
  const beforeRes = await query(
    'SELECT * FROM approval_items WHERE id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL',
    [id],
  );
  const beforeRow = beforeRes.rows[0] || null;

  values.push(id);
  const result = await query(
    `UPDATE approval_items SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
       AND organization_id = current_organization_id()
       AND deleted_at IS NULL
     RETURNING *`,
    values,
  );
  const row = result.rows[0] || null;
  if (row && Object.prototype.hasOwnProperty.call(normalizedData, 'status')) {
    publish(EVENTS.APPROVAL_STATUS_CHANGED, {
      dealId: row.deal_id,
      approvalId: row.id,
      approvalName: row.name,
      status: row.status,
    });
  }
  // Append-only audit with a string-normalized field diff — dates come back as
  // Date objects, so compare via String() to avoid reference-inequality false
  // positives. Skip when nothing actually changed.
  if (row && beforeRow) {
    const before = {};
    const after = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(normalizedData, field)
          && String(beforeRow[field] ?? '') !== String(row[field] ?? '')) {
        before[field] = beforeRow[field];
        after[field] = row[field];
      }
    }
    if (Object.keys(after).length > 0) {
      await dealAuditLog.recordAudit({
        dealId: row.deal_id,
        eventType: 'approval_updated',
        actorId,
        before,
        after,
        metadata: { approval_id: row.id, name: row.name },
      });
    }
  }
  return row;
}

async function deleteApprovalItem(id, actorId = null) {
  // Soft-delete: hide immediately, purge after the retention window. Keeps the
  // tombstone so the 'approval_deleted' audit row carries real before-state and
  // an accidental delete of a statutory-approval record is recoverable.
  const result = await query(
    `UPDATE approval_items
        SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
      WHERE id = $1
        AND organization_id = current_organization_id()
        AND deleted_at IS NULL
      RETURNING id, deal_id, approval_type, name, status`,
    [id, actorId || null],
  );
  const row = result.rows[0] || null;
  if (row) {
    await dealAuditLog.recordAudit({
      dealId: row.deal_id,
      eventType: 'approval_deleted',
      actorId,
      before: { approval_type: row.approval_type, name: row.name, status: row.status },
      metadata: { approval_id: row.id },
    });
  }
  return row ? { id: row.id } : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────────────────────

async function seedForDeal(dealId, assetClass = 'residential_apartments', dealStructure = null) {
  let effectiveAssetClass = assetClass;
  let effectiveDealStructure = dealStructure;

  // Look up missing dimensions from the deal row in a single query if either
  // is absent. Backwards-compatible: callers that only pass assetClass keep
  // working; the structure-specific add-ons just don't fire.
  if (!assetClass || dealStructure === null) {
    const dealResult = await query(
      'SELECT asset_class, deal_structure FROM deals WHERE id = $1',
      [dealId],
    );
    if (!assetClass) {
      effectiveAssetClass = dealResult.rows[0]?.asset_class || 'residential_apartments';
    }
    if (dealStructure === null) {
      effectiveDealStructure = dealResult.rows[0]?.deal_structure || null;
    }
  }

  const baseTemplate = ASSET_CLASS_APPROVALS[effectiveAssetClass] || RESIDENTIAL_APPROVALS;
  const structureAddOns = dealStructureMatrix.getAdditionalApprovals(
    effectiveAssetClass,
    effectiveDealStructure,
  );
  const template = [...baseTemplate, ...structureAddOns];

  // Avoid duplicate seeding
  const existing = await query(
    'SELECT name FROM approval_items WHERE deal_id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL',
    [dealId]
  );
  const existingNames = new Set(existing.rows.map((r) => r.name));

  const toInsert = template.filter((item) => !existingNames.has(item.name));
  if (toInsert.length === 0) {
    return [];
  }

  const placeholders = [];
  const values = [];
  let idx = 1;

  for (const item of toInsert) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
    values.push(dealId, item.approval_type, item.name, item.is_required);
    idx += 4;
  }

  const result = await query(
    `INSERT INTO approval_items (deal_id, approval_type, name, is_required)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values,
  );
  return result.rows;
}

module.exports = {
  listByDeal,
  create,
  update,
  delete: deleteApprovalItem,
  seedForDeal,
};
