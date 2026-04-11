'use strict';

const { query } = require('../config/database');

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

const normalizeApprovalPayload = (data = {}) => ({
  approval_type: data.approval_type ?? data.approvalType,
  name: data.name,
  is_required: data.is_required ?? data.isRequired,
  is_available: data.is_available ?? data.isAvailable,
  is_uploaded: data.is_uploaded ?? data.isUploaded,
  is_validated: data.is_validated ?? data.isValidated,
  issued_date: data.issued_date ?? data.issuedDate,
  expiry_date: data.expiry_date ?? data.expiryDate,
  reference_number: data.reference_number ?? data.referenceNumber,
  issuing_authority: data.issuing_authority ?? data.issuingAuthority,
  document_id: data.document_id ?? data.documentId,
  status: normalizeApprovalStatus(data.status),
  notes: data.notes,
  next_action: data.next_action ?? data.nextAction,
});

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
     ORDER BY a.approval_type, a.created_at`,
    [dealId],
  );
  return result.rows;
}

async function create(dealId, data) {
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
  return result.rows[0];
}

async function update(id, data) {
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
    const existing = await query('SELECT * FROM approval_items WHERE id = $1', [id]);
    return existing.rows[0] || null;
  }

  values.push(id);
  const result = await query(
    `UPDATE approval_items SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

async function deleteApprovalItem(id) {
  const result = await query('DELETE FROM approval_items WHERE id = $1 RETURNING id', [id]);
  return result.rows[0] || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────────────────────

async function seedForDeal(dealId, assetClass = 'residential_apartments') {
  let effectiveAssetClass = assetClass;

  if (!assetClass) {
    const dealResult = await query('SELECT asset_class FROM deals WHERE id = $1', [dealId]);
    effectiveAssetClass = dealResult.rows[0]?.asset_class || 'residential_apartments';
  }

  const template = ASSET_CLASS_APPROVALS[effectiveAssetClass] || RESIDENTIAL_APPROVALS;

  // Avoid duplicate seeding
  const existing = await query('SELECT name FROM approval_items WHERE deal_id = $1', [dealId]);
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
