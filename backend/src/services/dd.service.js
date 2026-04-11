'use strict';

const { query } = require('../config/database');

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DD_STATUSES = ['pending', 'in_progress', 'completed', 'flagged', 'not_applicable'];

// ──────────────────────────────────────────────────────────────────────────────
// Default checklists per asset class
// Each item: { category, item_name, description, severity, is_required }
// ──────────────────────────────────────────────────────────────────────────────

const BASE_CHECKLIST = [
  // Title & Ownership
  {
    category: 'title_ownership',
    item_name: 'Title chain verification (30 years)',
    description: 'Verify unbroken chain of title for minimum 30 years. All sale deeds, gift deeds, inheritance records in sequence.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'title_ownership',
    item_name: 'Encumbrance Certificate (30 years)',
    description: 'EC from Sub-Registrar office covering at least 30 years. Confirm no mortgages, charges, or court attachments.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'title_ownership',
    item_name: 'Sale deed / Conveyance deed',
    description: 'Obtain and verify the current registered sale deed in favour of the seller.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'title_ownership',
    item_name: 'Mutation records (RTC / Pahani)',
    description: 'Revenue records confirming mutation of ownership in the name of the seller.',
    severity: 'secondary',
    is_required: true,
  },
  {
    category: 'title_ownership',
    item_name: 'Property tax receipts (3 years)',
    description: 'Latest 3 years property tax paid receipts to confirm no dues.',
    severity: 'secondary',
    is_required: false,
  },
  // Land Classification
  {
    category: 'land_classification',
    item_name: 'Conversion certificate (DC Conversion)',
    description: 'Deputy Commissioner order converting agricultural land to non-agricultural residential use.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'land_classification',
    item_name: 'Khata certificate and extract',
    description: 'BBMP / CMC / gram panchayat khata in the name of the seller confirming the property is on municipal records.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'land_classification',
    item_name: 'Zoning plan match (CDP / Master Plan)',
    description: 'Confirm land is zoned for proposed use in the current CDP / BDA Master Plan. Get zoning extract.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'land_classification',
    item_name: 'Land use certificate',
    description: 'Obtain LUC from local authority confirming permissible use.',
    severity: 'buildability_blocker',
    is_required: false,
  },
  // Seller Validity
  {
    category: 'seller_validity',
    item_name: 'Board resolution / authority letter',
    description: 'For corporate sellers: board resolution authorising the sale and the signatory.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'seller_validity',
    item_name: 'POA validity check',
    description: 'If seller is acting through a Power of Attorney, verify POA is registered, notarised, and not revoked.',
    severity: 'deal_breaker',
    is_required: false,
  },
  {
    category: 'seller_validity',
    item_name: 'KYC of all co-owners / legal heirs',
    description: 'Obtain KYC documents and consent from all co-owners, legal heirs, or beneficiaries.',
    severity: 'deal_breaker',
    is_required: true,
  },
  // Statutory
  {
    category: 'statutory',
    item_name: 'No objection from income tax authority (if applicable)',
    description: 'Form 26QB / TDS compliance confirmation for high-value transactions.',
    severity: 'commercial_blocker',
    is_required: false,
  },
  // Physical & Technical
  {
    category: 'physical_technical',
    item_name: 'Boundary survey and demarcation',
    description: 'Licensed surveyor to physically demarcate and certify boundary, confirm area matches documents.',
    severity: 'secondary',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Access road verification',
    description: 'Confirm legal, motorable access road to the property. Check for road widening notifications.',
    severity: 'secondary',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Soil test / geotechnical report',
    description: 'Preliminary soil investigation to confirm ground conditions and identify any contamination.',
    severity: 'secondary',
    is_required: false,
  },
];

const RESIDENTIAL_CHECKLIST = [
  ...BASE_CHECKLIST,
  {
    category: 'statutory',
    item_name: 'RERA registration (mandatory for residential)',
    description: 'Confirm project is registered under RERA Karnataka (RERA number, agent registration if applicable).',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'Building plan approval (BDA / BBMP / BMRDA)',
    description: 'Sanctioned building plan from the appropriate local authority.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'FSI / FAR computation sheet',
    description: 'Compute permissible FSI, verify against proposed development plan.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Setback and height compliance',
    description: 'Confirm setbacks, height, and ground coverage are within permissible limits.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'financial_commercial',
    item_name: 'Stamp duty and registration cost estimate',
    description: 'Compute stamp duty liability on the transaction value.',
    severity: 'commercial_blocker',
    is_required: true,
  },
];

const PLOTTED_DEVELOPMENT_CHECKLIST = [
  ...BASE_CHECKLIST,
  {
    category: 'statutory',
    item_name: 'Layout approval (LPA / BDA / BMRDA)',
    description: 'Layout plan approval from BDA, BMRDA, or BMICAPA as applicable.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'RERA registration for plotted layout',
    description: 'RERA registration if layout has more than 500 sqm or 8 plots.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Road, open space, civic amenity reservations',
    description: 'Confirm reserved areas for roads, parks, and CA sites per layout norms.',
    severity: 'buildability_blocker',
    is_required: true,
  },
];

const COMMERCIAL_OFFICE_CHECKLIST = [
  ...BASE_CHECKLIST,
  {
    category: 'statutory',
    item_name: 'Commercial building plan approval',
    description: 'Sanctioned commercial building plan from BBMP / BDA.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'Fire NOC',
    description: 'Fire safety NOC from Karnataka State Fire and Emergency Services.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'Environment clearance (if > 20,000 sqm)',
    description: 'EC from State Environment Impact Assessment Authority for large commercial projects.',
    severity: 'commercial_blocker',
    is_required: false,
  },
  {
    category: 'project_specific',
    item_name: 'Commercial FSI / FAR verification',
    description: 'Verify permissible commercial FAR including TDR/premium FAR if applicable.',
    severity: 'buildability_blocker',
    is_required: true,
  },
];

const ASSET_CLASS_CHECKLISTS = {
  residential_apartments: RESIDENTIAL_CHECKLIST,
  plotted_development: PLOTTED_DEVELOPMENT_CHECKLIST,
  villas: RESIDENTIAL_CHECKLIST,
  commercial_office: COMMERCIAL_OFFICE_CHECKLIST,
  retail: COMMERCIAL_OFFICE_CHECKLIST,
  industrial_warehousing: BASE_CHECKLIST,
  hospitality: COMMERCIAL_OFFICE_CHECKLIST,
  mixed_use: RESIDENTIAL_CHECKLIST,
  raw_land: BASE_CHECKLIST,
  redevelopment: RESIDENTIAL_CHECKLIST,
};

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

async function listByDeal(dealId) {
  const result = await query(
    `SELECT
       d.*,
       u_assigned.name AS assigned_to_name,
       u_completed.name AS completed_by_name
     FROM dd_items d
     LEFT JOIN users u_assigned  ON u_assigned.id  = d.assigned_to
     LEFT JOIN users u_completed ON u_completed.id = d.completed_by
     WHERE d.deal_id = $1
     ORDER BY
       CASE d.severity
         WHEN 'deal_breaker'         THEN 1
         WHEN 'buildability_blocker' THEN 2
         WHEN 'commercial_blocker'   THEN 3
         ELSE 4
       END,
       d.category,
       d.created_at`,
    [dealId],
  );
  return result.rows;
}

async function getById(id) {
  const result = await query(
    `SELECT d.*,
            u_assigned.name  AS assigned_to_name,
            u_completed.name AS completed_by_name
     FROM dd_items d
     LEFT JOIN users u_assigned  ON u_assigned.id  = d.assigned_to
     LEFT JOIN users u_completed ON u_completed.id = d.completed_by
     WHERE d.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

async function create(dealId, data, userId) {
  const {
    category,
    item_name = data.name,
    description = null,
    status = 'pending',
    severity = 'secondary',
    is_required = true,
    notes = null,
    assigned_to = null,
    due_date = null,
  } = data;

  const result = await query(
    `INSERT INTO dd_items
       (deal_id, category, item_name, description, status, severity, is_required, notes, assigned_to, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [dealId, category, item_name, description, status, severity, is_required, notes, assigned_to, due_date],
  );
  return result.rows[0];
}

async function update(id, data) {
  const normalizedData = {
    ...data,
    item_name: data.item_name ?? data.name,
  };

  const allowed = [
    'category', 'item_name', 'description', 'status', 'severity',
    'is_required', 'notes', 'assigned_to', 'due_date', 'document_id',
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
    return getById(id);
  }

  values.push(id);
  const result = await query(
    `UPDATE dd_items SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

async function updateStatus(id, status, userId) {
  if (!DD_STATUSES.includes(status)) {
    throw new Error(`Invalid DD status: ${status}`);
  }

  const isCompleting = status === 'completed';
  const result = await query(
    `UPDATE dd_items
     SET status       = $1,
         completed_at = $2,
         completed_by = $3,
         updated_at   = NOW()
     WHERE id = $4
     RETURNING *`,
    [
      status,
      isCompleting ? new Date() : null,
      isCompleting ? (userId || null) : null,
      id,
    ],
  );
  return result.rows[0] || null;
}

async function deleteDDItem(id) {
  const result = await query('DELETE FROM dd_items WHERE id = $1 RETURNING id', [id]);
  return result.rows[0] || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────────────────────

async function seedForDeal(dealId, assetClass = 'residential_apartments', dealStructure = 'outright') {
  let effectiveAssetClass = assetClass;
  let effectiveDealStructure = dealStructure;

  if (!assetClass || !dealStructure) {
    const dealResult = await query(
      'SELECT asset_class, deal_structure FROM deals WHERE id = $1',
      [dealId],
    );
    const deal = dealResult.rows[0] || {};
    effectiveAssetClass = assetClass || deal.asset_class || 'residential_apartments';
    effectiveDealStructure = dealStructure || deal.deal_structure || 'outright';
  }

  const checklist = ASSET_CLASS_CHECKLISTS[effectiveAssetClass] || BASE_CHECKLIST;

  // Supplement JV/JDA with deal-structure-specific items
  const structureItems = [];
  if (['jv', 'jda', 'revenue_share', 'area_share', 'profit_share'].includes(effectiveDealStructure)) {
    structureItems.push(
      {
        category: 'financial_commercial',
        item_name: 'JV / JDA agreement review',
        description: 'Legal review of joint venture or development agreement terms, profit sharing, exit clauses.',
        severity: 'deal_breaker',
        is_required: true,
      },
      {
        category: 'seller_validity',
        item_name: 'Partner entity KYC and financials',
        description: 'KYC, financials, and litigation check on JV/JDA partner entity.',
        severity: 'deal_breaker',
        is_required: true,
      },
    );
  }

  const allItems = [...checklist, ...structureItems];

  // Deduplicate by item_name to be safe on re-seed
  const existing = await query('SELECT item_name FROM dd_items WHERE deal_id = $1', [dealId]);
  const existingNames = new Set(existing.rows.map((r) => r.item_name));

  const toInsert = allItems.filter((item) => !existingNames.has(item.item_name));
  if (toInsert.length === 0) {
    return [];
  }

  // Batch insert
  const placeholders = [];
  const values = [];
  let idx = 1;

  for (const item of toInsert) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
    values.push(dealId, item.category, item.item_name, item.description || null, item.severity, item.is_required);
    idx += 6;
  }

  const result = await query(
    `INSERT INTO dd_items (deal_id, category, item_name, description, severity, is_required)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values,
  );
  return result.rows;
}

// ──────────────────────────────────────────────────────────────────────────────
// Score
// ──────────────────────────────────────────────────────────────────────────────

async function getDDScore(dealId) {
  const result = await query(
    `SELECT
       COUNT(*)                                                              AS total_required,
       COUNT(*) FILTER (WHERE status IN ('completed', 'not_applicable'))     AS completed_count,
       COUNT(*) FILTER (WHERE status = 'flagged')                           AS flagged_count,
       COUNT(*) FILTER (WHERE severity = 'deal_breaker')                    AS deal_breakers_total,
       COUNT(*) FILTER (WHERE severity = 'deal_breaker'
                          AND status IN ('completed', 'not_applicable'))    AS deal_breakers_done
     FROM dd_items
     WHERE deal_id = $1
       AND is_required = TRUE`,
    [dealId],
  );

  const row = result.rows[0];
  const total = parseInt(row.total_required, 10) || 0;
  const done = parseInt(row.completed_count, 10) || 0;
  const flagged = parseInt(row.flagged_count, 10) || 0;
  const dbTotal = parseInt(row.deal_breakers_total, 10) || 0;
  const dbDone = parseInt(row.deal_breakers_done, 10) || 0;

  const score = total === 0 ? 0 : Math.round((done / total) * 100);

  return {
    score,
    total_required: total,
    completed_count: done,
    flagged_count: flagged,
    deal_breakers_total: dbTotal,
    deal_breakers_done: dbDone,
    deal_breakers_pending: dbTotal - dbDone,
  };
}

module.exports = {
  listByDeal,
  getById,
  create,
  update,
  updateStatus,
  delete: deleteDDItem,
  seedForDeal,
  getDDScore,
};
