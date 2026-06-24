'use strict';

const { query } = require('../config/database');
const { EVENTS, publish } = require('../lib/eventBus');
const dealAuditLog = require('./dealAuditLog.service');

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

// Retail-specific items: ECS parking minimums, anchor-tenant clauses, and
// trade-mix discipline drive valuation more than vanilla commercial.
const RETAIL_CHECKLIST = [
  ...COMMERCIAL_OFFICE_CHECKLIST,
  {
    category: 'project_specific',
    item_name: 'ECS parking compliance (retail)',
    description: 'Verify ECS / equivalent car space ratios for retail use under BBMP zonal regulations. Mall and high-street retail have different ECS multipliers.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Anchor tenant LOI / lease terms',
    description: 'Letters of intent / executed leases with anchor tenants. Verify lock-in, rental escalations, fitout periods, exit clauses.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Trade mix and category exclusivity review',
    description: 'Confirm trade-mix plan (F&B / fashion / electronics / cinema split). Check category exclusivity clauses promised to anchors.',
    severity: 'secondary',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Footfall study / catchment analysis',
    description: 'Independent footfall projection and catchment population analysis (3km / 5km rings).',
    severity: 'secondary',
    is_required: false,
  },
  {
    category: 'statutory',
    item_name: 'Cinema / multiplex licensing (if applicable)',
    description: 'Karnataka Cinemas (Regulation) Act licence and fire/seating compliance.',
    severity: 'commercial_blocker',
    is_required: false,
  },
];

// Hospitality-specific items: hotels and resorts touch tourism, food safety,
// liquor, and gaming regulations the office checklist doesn't cover.
const HOSPITALITY_CHECKLIST = [
  ...COMMERCIAL_OFFICE_CHECKLIST,
  {
    category: 'statutory',
    item_name: 'Tourism Department classification (star rating)',
    description: 'Karnataka / India Tourism star classification (1–5 star, heritage). Affects FSI bonuses, GST treatment, and brand affiliation eligibility.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'FSSAI food licence and kitchen approval',
    description: 'Food Safety and Standards Authority of India licence for all F&B outlets within the property.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'Excise / liquor licence (CL-7 / CL-9)',
    description: 'Karnataka State Beverages Corporation excise licence for in-house liquor service.',
    severity: 'commercial_blocker',
    is_required: false,
  },
  {
    category: 'project_specific',
    item_name: 'Hotel management / brand operating agreement',
    description: 'HMA / franchise / lease with the hotel operator. Verify term, fees, performance tests, owner termination rights.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Key count, ARR, RevPAR underwriting basis',
    description: 'Confirm the keys, ADR, occupancy, and RevPAR ramp underwritten in the financial model match operator-supplied projections.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Back-of-house and parking ratio verification',
    description: 'Hotels need substantial BoH (laundry, kitchen, plant) and 1 ECS per key minimum. Verify against approved plans.',
    severity: 'buildability_blocker',
    is_required: true,
  },
];

// Industrial / warehousing: heavy on land conversion, environmental, power,
// access. Less on RERA / building plan glamour, more on site fundamentals.
const INDUSTRIAL_WAREHOUSING_CHECKLIST = [
  ...BASE_CHECKLIST,
  {
    category: 'statutory',
    item_name: 'KIADB allotment / industrial land conversion',
    description: 'For KIADB-allotted plots: allotment letter, possession certificate, and lease-cum-sale deed. For private land: Section 109 KLR Act conversion to industrial use.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'Karnataka State Pollution Control Board (KSPCB) consent',
    description: 'Consent to Establish (CFE) and Consent to Operate (CFO) under Air & Water Acts. Category red/orange/green dictates conditions.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'Environment clearance (EIA, if applicable)',
    description: 'EC from SEIAA / MoEF for category-A and category-B1 industrial activities.',
    severity: 'commercial_blocker',
    is_required: false,
  },
  {
    category: 'project_specific',
    item_name: 'BESCOM / KPTCL HT power feasibility',
    description: 'High-tension power feasibility certificate, sanctioned load, dedicated feeder availability.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Heavy-vehicle access and turning radius',
    description: 'Confirm motorable access for 40-ft trailers, internal turning radii, dock-to-dock distances.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Soil bearing capacity for racking / heavy floor loading',
    description: 'Geotechnical report supporting the floor-loading spec required by warehousing / industrial use (typ. 5–8 t/sqm).',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Flood / drainage / nala-buffer compliance',
    description: 'Confirm site is outside 30m raja kaluve buffer and has positive drainage. Industrial sites sit in low-lying areas more often than residential.',
    severity: 'commercial_blocker',
    is_required: true,
  },
];

// Mixed-use overlays the residential checklist with retail + commercial
// items, plus the unit-share apportionment that drives sales modeling.
const MIXED_USE_CHECKLIST = [
  ...RESIDENTIAL_CHECKLIST,
  {
    category: 'project_specific',
    item_name: 'Mixed-use FSI split (residential / commercial)',
    description: 'Confirm the residential vs commercial FSI/FAR split is permitted under the zone code. RMP draft restricts mixed-use ratios.',
    severity: 'buildability_blocker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Common-area apportionment between use blocks',
    description: 'How are lobby, lifts, parking, MEP, and amenities apportioned between residential and commercial purchasers? Critical for stamp duty and saleable area.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'statutory',
    item_name: 'Separate fire NOCs per use block (if required)',
    description: 'Some BBMP precedents require separate NOCs for residential vs commercial occupancies in mixed-use towers.',
    severity: 'commercial_blocker',
    is_required: false,
  },
];

// Redevelopment overlays residential with society / tenant-rehab obligations
// — the value driver and the risk driver of any redev deal.
const REDEVELOPMENT_CHECKLIST = [
  ...RESIDENTIAL_CHECKLIST,
  {
    category: 'seller_validity',
    item_name: 'Society / association consent (≥ majority threshold)',
    description: 'Registered society / RWA resolution authorising redevelopment with the agreed majority (usually 75% per Karnataka practice).',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Existing-tenant rehab area schedule',
    description: 'Per-tenant existing carpet, agreed rehab carpet, hardship rent / corpus, alternate accommodation terms.',
    severity: 'deal_breaker',
    is_required: true,
  },
  {
    category: 'project_specific',
    item_name: 'Saleable area derivation post rehab and FAR loading',
    description: 'Reconcile total proposed FAR, rehab obligations, and saleable area used in the financial model.',
    severity: 'commercial_blocker',
    is_required: true,
  },
  {
    category: 'physical_technical',
    item_name: 'Demolition feasibility and structural survey',
    description: 'Independent structural survey of the existing building, demolition methodology, and adjacent-building safety plan.',
    severity: 'buildability_blocker',
    is_required: true,
  },
];

const ASSET_CLASS_CHECKLISTS = {
  residential_apartments: RESIDENTIAL_CHECKLIST,
  plotted_development: PLOTTED_DEVELOPMENT_CHECKLIST,
  villas: RESIDENTIAL_CHECKLIST,
  commercial_office: COMMERCIAL_OFFICE_CHECKLIST,
  retail: RETAIL_CHECKLIST,
  industrial_warehousing: INDUSTRIAL_WAREHOUSING_CHECKLIST,
  hospitality: HOSPITALITY_CHECKLIST,
  mixed_use: MIXED_USE_CHECKLIST,
  raw_land: BASE_CHECKLIST,
  redevelopment: REDEVELOPMENT_CHECKLIST,
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
       AND d.organization_id = current_organization_id()
       AND d.deleted_at IS NULL
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
     WHERE d.id = $1
       AND d.organization_id = current_organization_id()
       AND d.deleted_at IS NULL`,
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
  const row = result.rows[0];
  await dealAuditLog.recordAudit({
    dealId,
    eventType: 'dd_item_created',
    actorId: userId || null,
    after: { category: row.category, item_name: row.item_name, status: row.status, severity: row.severity },
    metadata: { dd_item_id: row.id },
  });
  return row;
}

async function update(id, data, actorId = null) {
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

  // Snapshot BEFORE state (getById is org + live scoped) for the audit diff.
  const beforeRow = await getById(id);

  values.push(id);
  const result = await query(
    `UPDATE dd_items SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
       AND organization_id = current_organization_id()
       AND deleted_at IS NULL
     RETURNING *`,
    values,
  );
  const row = result.rows[0] || null;
  // Append-only audit with a string-normalized field diff (due_date is a Date).
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
        eventType: 'dd_item_updated',
        actorId,
        before,
        after,
        metadata: { dd_item_id: row.id, item_name: row.item_name },
      });
    }
  }
  return row;
}

async function updateStatus(id, status, userId) {
  if (!DD_STATUSES.includes(status)) {
    throw new Error(`Invalid DD status: ${status}`);
  }

  // Snapshot the prior status (org + live scoped) so the audit row carries the
  // before/after transition.
  const beforeRes = await query(
    'SELECT status FROM dd_items WHERE id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL',
    [id],
  );
  const beforeStatus = beforeRes.rows[0]?.status ?? null;

  const isCompleting = status === 'completed';
  const result = await query(
    `UPDATE dd_items
     SET status       = $1,
         completed_at = $2,
         completed_by = $3,
         updated_at   = NOW()
     WHERE id = $4
       AND organization_id = current_organization_id()
       AND deleted_at IS NULL
     RETURNING *`,
    [
      status,
      isCompleting ? new Date() : null,
      isCompleting ? (userId || null) : null,
      id,
    ],
  );
  const row = result.rows[0] || null;
  if (row) {
    publish(EVENTS.DD_ITEM_STATUS_CHANGED, {
      dealId: row.deal_id,
      itemId: row.id,
      itemName: row.item_name,
      status: row.status,
      severity: row.severity,
      userId,
    });
    if (beforeStatus !== row.status) {
      await dealAuditLog.recordAudit({
        dealId: row.deal_id,
        eventType: 'dd_item_updated',
        actorId: userId || null,
        before: { status: beforeStatus },
        after: { status: row.status },
        metadata: { dd_item_id: row.id, item_name: row.item_name },
      });
    }
  }
  return row;
}

async function deleteDDItem(id, actorId = null) {
  // Soft-delete: hide immediately, purge after the retention window. The
  // tombstone lets the 'dd_item_deleted' audit row carry real before-state and
  // makes an accidental delete recoverable.
  const result = await query(
    `UPDATE dd_items
        SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
      WHERE id = $1
        AND organization_id = current_organization_id()
        AND deleted_at IS NULL
      RETURNING id, deal_id, category, item_name, status, severity`,
    [id, actorId || null],
  );
  const row = result.rows[0] || null;
  if (row) {
    await dealAuditLog.recordAudit({
      dealId: row.deal_id,
      eventType: 'dd_item_deleted',
      actorId,
      before: { category: row.category, item_name: row.item_name, status: row.status, severity: row.severity },
      metadata: { dd_item_id: row.id },
    });
  }
  return row ? { id: row.id } : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────────────────────

async function seedForDeal(dealId, assetClass = 'residential_apartments', dealStructure = 'outright') {
  let effectiveAssetClass = assetClass;
  let effectiveDealStructure = dealStructure;

  if (!assetClass || !dealStructure) {
    const dealResult = await query(
      // Org-scope guard (BYPASSRLS app role): never read a deal outside the
      // caller's org just to default the checklist asset class / structure.
      'SELECT asset_class, deal_structure FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
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
  const existing = await query(
    'SELECT item_name FROM dd_items WHERE deal_id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL',
    [dealId]
  );
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
       AND organization_id = current_organization_id()
       AND deleted_at IS NULL
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
