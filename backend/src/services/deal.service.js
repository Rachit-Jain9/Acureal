const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { EVENTS, publish } = require('../lib/eventBus');
const {
  DEAL_STAGES,
  STAGE_TRANSITIONS,
  canTransitionStage,
  LIVE_DEAL_STAGES,
} = require('../constants/domain');
const { calculateLandPricing } = require('../utils/landPricing');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { buildReadinessSummary, deriveNextSteps } = require('./dealReadiness.service');
const { deleteStorageFile } = require('../config/storage');
const dealAuditLog = require('./dealAuditLog.service');
const recommendationPersistence = require('./recommendation/persistence');
const { summariseRecommendations } = require('./recommendation/summarise');
const crypto = require('crypto');

// Fields whose changes are worth surfacing on the deal audit timeline.
// We intentionally exclude purely-derived columns (computed pricing
// rates, updated_at, etc.) so the timeline doesn't drown in noise.
const UPDATED_FIELDS_TRACKED = [
  'name',
  'deal_type',
  'priority',
  'asset_class',
  'deal_structure',
  'assigned_to',
  'target_launch_date',
  'expected_close_date',
  'land_ask_price_cr',
  'negotiated_price_cr',
  'jv_split_developer_pct',
  'jv_split_landowner_pct',
  'rera_number',
  'rera_expiry_date',
  'notes',
];

// Build a pair of {before, after} objects by diffing the relevant
// updated-deal columns. Returns null when nothing tracked actually
// changed — the caller skips the audit row in that case so the
// timeline doesn't gain a "nothing changed" entry on every save.
const diffTrackedFields = (before, after) => {
  const beforeDiff = {};
  const afterDiff = {};
  let dirty = false;
  for (const col of UPDATED_FIELDS_TRACKED) {
    const b = before?.[col] ?? null;
    const a = after?.[col] ?? null;
    // Treat ISO timestamps + string equivalents that differ only by
    // representation as unchanged.
    const bStr = b instanceof Date ? b.toISOString() : b;
    const aStr = a instanceof Date ? a.toISOString() : a;
    if (bStr !== aStr) {
      beforeDiff[col] = b;
      afterDiff[col] = a;
      dirty = true;
    }
  }
  return dirty ? { before: beforeDiff, after: afterDiff } : null;
};

const buildStageOrderCase = (column = 'd.stage') => `
  CASE ${column}
    WHEN 'sourced' THEN 1
    WHEN 'screening' THEN 2
    WHEN 'site_visit' THEN 3
    WHEN 'loi' THEN 4
    WHEN 'due_diligence' THEN 5
    WHEN 'underwriting' THEN 6
    WHEN 'ic_review' THEN 7
    WHEN 'negotiation' THEN 8
    WHEN 'active' THEN 9
    WHEN 'closed' THEN 10
    WHEN 'dead' THEN 11
  END
`;

const dealSelect = `
  d.*,
  COALESCE(
    NULLIF(p.name, ''),
    NULLIF(p.address, ''),
    CONCAT(
      COALESCE(NULLIF(p.city, ''), 'Unknown city'),
      ' ',
      INITCAP(REPLACE(COALESCE(p.property_type, 'land'), '_', ' ')),
      ' opportunity'
    )
  ) as property_name,
  p.property_type,
  p.city,
  p.state,
  p.lat,
  p.lng,
  -- property_lat / property_lng are the canonical aliases for downstream
  -- services (dealWorkspace, dealStructureRecommender, IC readiness comps,
  -- exports). The bare p.lat / p.lng lines above stay for legacy frontend
  -- consumers (ParcelTab, MapPage, mapConfig, CompsTab, SiteWeatherCard).
  -- Same column, two names -- additive, no breaking changes.
  p.lat  AS property_lat,
  p.lng  AS property_lng,
  p.land_area_sqft,
  p.land_area_acres,
  p.zoning,
  p.pincode,
  p.pid,
  p.khata_no,
  p.bhoomi_id,
  p.rera_registration_number,
  p.existing_fsi,
  p.ownership_type,
  p.encumbrance_status,
  p.address as property_address,
  p.geocode_status,
  p.frontage_mtrs,
  p.depth_mtrs,
  u.name as assigned_to_name,
  creator.name as created_by_name,
  f.irr_pct,
  f.gross_margin_pct,
  f.total_revenue_cr,
  f.total_cost_cr,
  f.gross_profit_cr,
  f.npv_cr,
  f.equity_multiple,
  f.saleable_area_sqft,
  (
    SELECT activity_date
    FROM activities
    WHERE deal_id = d.id
    ORDER BY activity_date DESC
    LIMIT 1
  ) as last_activity_date,
  (
    SELECT COUNT(*)
    FROM documents doc
    WHERE doc.deal_id = d.id
  ) as document_count,
  (
    SELECT COUNT(*)
    FROM dd_items ddi
    WHERE ddi.deal_id = d.id
      AND ddi.is_required = TRUE
      AND ddi.status NOT IN ('completed', 'not_applicable')
  ) as pending_required_dd_count,
  (
    SELECT COUNT(*)
    FROM dd_items ddi
    WHERE ddi.deal_id = d.id
      AND ddi.is_required = TRUE
      AND ddi.severity = 'deal_breaker'
      AND ddi.status NOT IN ('completed', 'not_applicable')
  ) as pending_deal_breakers,
  (
    SELECT COUNT(*)
    FROM approval_items ai
    WHERE ai.deal_id = d.id
      AND ai.is_required = TRUE
  ) as required_approval_count,
  (
    SELECT COUNT(*)
    FROM approval_items ai
    WHERE ai.deal_id = d.id
      AND ai.is_required = TRUE
      AND (
        ai.is_validated = TRUE
        OR ai.status IN ('validated', 'approved')
      )
  ) as validated_approval_count,
  (
    SELECT COUNT(*)
    FROM risk_flags rf
    WHERE rf.deal_id = d.id
      AND rf.status IN ('open', 'flagged')
      AND rf.severity IN ('critical', 'high')
  ) as open_high_risk_count,
  -- Urgency signals for the deals-list card. Same logic the dashboard
  -- Attention panel uses, but rolled up per-deal here so the list can
  -- render the badges inline without an N+1 lookup.
  (
    SELECT COUNT(*)
    FROM dd_items ddi
    WHERE ddi.deal_id = d.id
      AND ddi.is_required = TRUE
      AND ddi.status IN ('pending', 'in_progress')
      AND ddi.due_date IS NOT NULL
      AND ddi.due_date < NOW()
  ) as overdue_dd_count,
  (
    SELECT COUNT(*)
    FROM risk_flags rf
    WHERE rf.deal_id = d.id
      AND rf.status IN ('open', 'flagged')
      AND rf.created_at > NOW() - INTERVAL '7 days'
  ) as new_risk_flag_count,
  COALESCE(
    (
      SELECT json_agg(rf.title ORDER BY risk_order, created_at DESC)
      FROM (
        SELECT
          title,
          created_at,
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            ELSE 4
          END AS risk_order
        FROM risk_flags
        WHERE deal_id = d.id
          AND status IN ('open', 'flagged')
        ORDER BY risk_order, created_at DESC
        LIMIT 3
      ) rf
    ),
    '[]'::json
  ) as key_risks
`;

// Lightweight projection for read-only consumers (Map / Reports / Compare /
// Property-detail) that need only scalar deal/property/financial fields, NOT the
// per-row rollup subqueries (DD/risk/approval counts, key_risks) the Deals list
// cards render. This drops ~11 correlated subqueries per row AND the
// getLatestRunsForDeals batch — turning the most expensive query in the system
// into a flat projection for callers that ignore those columns. Same JOINs, so
// every scalar field stays available.
const dealSummarySelect = `
  d.*,
  COALESCE(
    NULLIF(p.name, ''),
    NULLIF(p.address, ''),
    CONCAT(
      COALESCE(NULLIF(p.city, ''), 'Unknown city'),
      ' ',
      INITCAP(REPLACE(COALESCE(p.property_type, 'land'), '_', ' ')),
      ' opportunity'
    )
  ) as property_name,
  p.property_type, p.city, p.state, p.lat, p.lng,
  p.lat AS property_lat, p.lng AS property_lng,
  p.land_area_sqft, p.land_area_acres, p.zoning, p.pincode,
  p.ownership_type, p.encumbrance_status, p.address as property_address,
  p.geocode_status,
  u.name as assigned_to_name, creator.name as created_by_name,
  f.irr_pct, f.gross_margin_pct, f.total_revenue_cr, f.total_cost_cr,
  f.gross_profit_cr, f.npv_cr, f.equity_multiple, f.saleable_area_sqft
`;

const purgePropertyIfInactiveOnly = async (client, propertyId, excludingDealId = null) => {
  if (!propertyId) {
    return null;
  }

  const values = [propertyId];
  let excludingClause = '';
  if (excludingDealId) {
    values.push(excludingDealId);
    excludingClause = `AND d.id <> $2`;
  }

  const visibleDealsResult = await client.query(
    `SELECT EXISTS(
      SELECT 1
      FROM deals d
      WHERE d.property_id = $1
        ${excludingClause}
        AND ${buildVisibleDealCondition('d')}
    ) AS has_visible_deals`,
    values
  );

  if (visibleDealsResult.rows[0]?.has_visible_deals) {
    return null;
  }

  const deleteResult = await client.query(
    'DELETE FROM properties WHERE id = $1 RETURNING id, address, city',
    [propertyId]
  );

  return deleteResult.rows[0] || null;
};

const getPropertyContext = async (client, propertyId) => {
  if (!propertyId) {
    return null;
  }

  const propertyResult = await client.query(
    'SELECT id, land_area_sqft FROM properties WHERE id = $1',
    [propertyId]
  );

  if (propertyResult.rows.length === 0) {
    throw createError('Property not found.', 404);
  }

  return propertyResult.rows[0];
};

const buildDealPricing = (data, propertyAreaSqft = null) =>
  calculateLandPricing({
    pricingBasis: data.landPricingBasis || data.land_pricing_basis || 'total_cr',
    landAskPriceCr: data.landAskPriceCr ?? data.land_ask_price_cr,
    landPriceRateInr: data.landPriceRateInr ?? data.land_price_rate_inr,
    landExtentInputValue: data.landExtentInputValue ?? data.land_extent_input_value,
    landExtentInputUnit: data.landExtentInputUnit ?? data.land_extent_input_unit,
    propertyAreaSqft,
  });

const createDeal = async (data, userId) =>
  transaction(async (client) => {
    const property = await getPropertyContext(client, data.propertyId);
    const pricing = buildDealPricing(data, property?.land_area_sqft || null);

    const result = await client.query(
      `INSERT INTO deals (
        property_id, name, deal_type, stage, assigned_to,
        target_launch_date, expected_close_date, land_pricing_basis,
        land_price_rate_inr, land_extent_input_value, land_extent_input_unit,
        land_ask_price_cr, negotiated_price_cr, jv_split_developer_pct, jv_split_landowner_pct,
        rera_number, rera_expiry_date, notes, priority, created_by,
        asset_class, deal_structure
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,$18,$19,$20,
        $21,$22
      )
      RETURNING *`,
      [
        data.propertyId || null,
        data.name,
        data.dealType,
        data.stage || 'screening',
        data.assignedTo || userId,
        data.targetLaunchDate || null,
        data.expectedCloseDate || null,
        pricing.landPricingBasis,
        pricing.landPriceRateInr,
        pricing.landExtentInputValue,
        pricing.landExtentInputUnit,
        pricing.computedLandAskPriceCr,
        data.negotiatedPriceCr || null,
        data.jvSplitDeveloperPct || null,
        data.jvSplitLandownerPct || null,
        data.reraNumber || null,
        data.reraExpiryDate || null,
        data.notes || null,
        data.priority || 'medium',
        userId,
        data.assetClass || 'residential_apartments',
        data.dealStructure || 'outright',
      ]
    );

    const deal = result.rows[0];

    await client.query(
      `INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by, notes)
       VALUES ($1, NULL, $2, $3, $4)`,
      [deal.id, deal.stage, userId, 'Deal created']
    );

    publish(EVENTS.DEAL_CREATED, {
      dealId: deal.id,
      dealName: deal.name,
      stage: deal.stage,
      assetClass: deal.asset_class,
      userId,
    });

    return deal;
  });

const getDeals = async (filters = {}, pagination = {}) => {
  const conditions = ['(d.organization_id = current_organization_id() OR d.id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id()))'];
  const values = [];
  let paramCount = 1;

  // Lightweight projection mode for read-only consumers (Map/Reports/Compare/
  // Property-detail). Skips the per-row rollup subqueries + the recommendation
  // batch — see dealSummarySelect.
  const useSummary = pagination.fields === 'summary';

  if (filters.onlyArchived) {
    conditions.push('d.is_archived = TRUE');
  } else if (!filters.includeArchived) {
    conditions.push('d.is_archived = FALSE');
  }

  if (!filters.includeDead) {
    conditions.push(`d.stage <> 'dead'`);
  }

  if (filters.stage) {
    conditions.push(`d.stage = $${paramCount}`);
    values.push(filters.stage);
    paramCount++;
  }

  if (filters.dealType) {
    conditions.push(`d.deal_type = $${paramCount}`);
    values.push(filters.dealType);
    paramCount++;
  }

  if (filters.assignedTo) {
    conditions.push(`d.assigned_to = $${paramCount}`);
    values.push(filters.assignedTo);
    paramCount++;
  }

  if (filters.city) {
    conditions.push(`LOWER(p.city) = LOWER($${paramCount})`);
    values.push(filters.city);
    paramCount++;
  }

  if (filters.propertyId) {
    conditions.push(`d.property_id = $${paramCount}`);
    values.push(filters.propertyId);
    paramCount++;
  }

  if (filters.propertyType) {
    conditions.push(`p.property_type = $${paramCount}`);
    values.push(filters.propertyType);
    paramCount++;
  }

  if (filters.priority) {
    conditions.push(`d.priority = $${paramCount}`);
    values.push(filters.priority);
    paramCount++;
  }

  if (filters.liveOnly) {
    conditions.push(`d.stage <> 'closed' AND d.stage <> 'dead'`);
  }

  if (filters.search) {
    conditions.push(
      `(d.name ILIKE $${paramCount}
        OR COALESCE(p.name, '') ILIKE $${paramCount}
        OR COALESCE(p.city, '') ILIKE $${paramCount}
        OR COALESCE(d.notes, '') ILIKE $${paramCount})`
    );
    values.push(`%${filters.search}%`);
    paramCount++;
  }

  const page = parseInt(pagination.page, 10) || 1;
  const limit = Math.min(parseInt(pagination.limit, 10) || 20, 500);
  const offset = (page - 1) * limit;
  const whereClause = conditions.join(' AND ');

  // Single round-trip: COUNT(*) OVER() carries the full filtered total on
  // every returned row (window functions run after WHERE, before LIMIT/
  // OFFSET), so the separate COUNT query is gone. The one case it can't
  // answer is a page past the end (offset > total → zero rows, nothing to
  // read the count from); we fall back to a COUNT there so totalPages stays
  // correct. The common path (page 1, or any page with rows) is one query.
  const dataResult = await query(
    `SELECT ${useSummary ? dealSummarySelect : dealSelect},
            COUNT(*) OVER() AS total_count
     FROM deals d
     LEFT JOIN properties p ON d.property_id = p.id
     LEFT JOIN users u ON d.assigned_to = u.id
     LEFT JOIN users creator ON d.created_by = creator.id
     LEFT JOIN financials f ON d.id = f.deal_id
     WHERE ${whereClause}
     ORDER BY d.is_archived ASC, d.updated_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...values, limit, offset]
  );

  let total;
  if (dataResult.rows.length > 0) {
    total = parseInt(dataResult.rows[0].total_count, 10) || 0;
  } else if (offset === 0) {
    total = 0; // genuinely empty result set
  } else {
    // Past-the-end page (rare). One small COUNT keeps pagination honest.
    const countResult = await query(
      `SELECT COUNT(*)
       FROM deals d
       LEFT JOIN properties p ON d.property_id = p.id
       WHERE ${whereClause}`,
      values
    );
    total = parseInt(countResult.rows[0].count, 10) || 0;
  }

  // Strip the window-function helper column so it never leaks into the API
  // payload; it exists only to carry the total in one round-trip.
  const normalizedRows = dataResult.rows.map(({ total_count, ...row }) => {
    // Summary projection carries no rollup columns to coerce — return scalars as-is.
    if (useSummary) return row;
    return {
      ...row,
      document_count: parseInt(row.document_count, 10) || 0,
      pending_required_dd_count: parseInt(row.pending_required_dd_count, 10) || 0,
      pending_deal_breakers: parseInt(row.pending_deal_breakers, 10) || 0,
      required_approval_count: parseInt(row.required_approval_count, 10) || 0,
      validated_approval_count: parseInt(row.validated_approval_count, 10) || 0,
      open_high_risk_count: parseInt(row.open_high_risk_count, 10) || 0,
      overdue_dd_count: parseInt(row.overdue_dd_count, 10) || 0,
      new_risk_flag_count: parseInt(row.new_risk_flag_count, 10) || 0,
      key_risks: Array.isArray(row.key_risks) ? row.key_risks : [],
    };
  });

  // Attach the persisted recommendation summary to each row in one batched
  // round-trip. Deals that have never had a workspace load (no run yet) get
  // a `null` summary — the frontend renders no badge for those. Pre-migration
  // deploys return an empty Map and the summaries are all null.
  if (!useSummary && normalizedRows.length > 0) {
    const dealIds = normalizedRows.map((r) => r.id);
    const runsByDeal = await recommendationPersistence.getLatestRunsForDeals(dealIds);
    for (const row of normalizedRows) {
      const run = runsByDeal.get(row.id);
      row.recommendations_summary = run
        ? {
            ...summariseRecommendations(run.recommendations),
            snapshot_hash: run.snapshot_hash,
            generated_at: run.created_at,
          }
        : null;
    }
  }

  return {
    data: normalizedRows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getDealById = async (id) => {
  const result = await query(
    `SELECT ${dealSelect},
      p.survey_number,
      p.pid,
      p.khata_no,
      p.bhoomi_id,
      p.rera_registration_number,
      p.owner_name,
      p.circle_rate_per_sqft,
      p.permissible_fsi,
      p.road_width_mtrs,
      p.frontage_mtrs,
      p.depth_mtrs,
      p.zone_id,
      p.zone_notes,
      u.email as assigned_to_email
     FROM deals d
     LEFT JOIN properties p ON d.property_id = p.id
     LEFT JOIN users u ON d.assigned_to = u.id
     LEFT JOIN users creator ON d.created_by = creator.id
     LEFT JOIN financials f ON d.id = f.deal_id
     WHERE d.id = $1
       AND (d.organization_id = current_organization_id() OR d.id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id()))`,
    [id]
  );

  if (result.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }

  if (result.rows[0].is_archived || result.rows[0].stage === 'dead') {
    throw createError('Deal not found.', 404);
  }

  const deal = {
    ...result.rows[0],
    document_count: parseInt(result.rows[0].document_count, 10) || 0,
    pending_required_dd_count: parseInt(result.rows[0].pending_required_dd_count, 10) || 0,
    pending_deal_breakers: parseInt(result.rows[0].pending_deal_breakers, 10) || 0,
    required_approval_count: parseInt(result.rows[0].required_approval_count, 10) || 0,
    validated_approval_count: parseInt(result.rows[0].validated_approval_count, 10) || 0,
    open_high_risk_count: parseInt(result.rows[0].open_high_risk_count, 10) || 0,
    key_risks: Array.isArray(result.rows[0].key_risks) ? result.rows[0].key_risks : [],
  };

  const [
    financialsResult,
    activitiesResult,
    historyResult,
    ddItemsResult,
    approvalsResult,
    riskFlagsResult,
    documentCategoriesResult,
  ] = await Promise.all([
    query('SELECT * FROM financials WHERE deal_id = $1', [id]),
    query(
      `SELECT a.*, u.name as performed_by_name, completer.name as completed_by_name
       FROM activities a
       LEFT JOIN users u ON a.performed_by = u.id
       LEFT JOIN users completer ON a.completed_by = completer.id
       WHERE a.deal_id = $1
       ORDER BY a.activity_date DESC
       LIMIT 10`,
      [id]
    ),
    query(
      `SELECT dsh.*, u.name as changed_by_name
       FROM deal_stage_history dsh
       LEFT JOIN users u ON dsh.changed_by = u.id
       WHERE dsh.deal_id = $1
       ORDER BY dsh.changed_at ASC`,
      [id]
    ),
    query('SELECT * FROM dd_items WHERE deal_id = $1 ORDER BY created_at ASC', [id]),
    query('SELECT * FROM approval_items WHERE deal_id = $1 ORDER BY created_at ASC', [id]),
    query('SELECT * FROM risk_flags WHERE deal_id = $1 ORDER BY created_at DESC', [id]),
    query(
      `SELECT doc_category, COUNT(*) AS count
       FROM documents
       WHERE deal_id = $1
       GROUP BY doc_category`,
      [id]
    ),
  ]);

  deal.financials = financialsResult.rows[0] || null;
  deal.recent_activities = activitiesResult.rows;
  deal.stage_history = historyResult.rows;
  deal.dd_items = ddItemsResult.rows;
  deal.approval_items = approvalsResult.rows;
  deal.risk_flags = riskFlagsResult.rows;
  deal.document_category_counts = Object.fromEntries(
    documentCategoriesResult.rows.map((row) => [row.doc_category, parseInt(row.count, 10) || 0]),
  );
  deal.readiness_summary = buildReadinessSummary({
    ddItems: deal.dd_items,
    approvals: deal.approval_items,
    riskFlags: deal.risk_flags,
    financials: deal.financials,
    documentCount: deal.document_count,
  });
  deal.next_steps = deriveNextSteps({
    deal,
    ddItems: deal.dd_items,
    approvals: deal.approval_items,
    riskFlags: deal.risk_flags,
    financials: deal.financials,
    documentCount: deal.document_count,
    documentCategoryCounts: deal.document_category_counts,
    readinessSummary: deal.readiness_summary,
  });

  return deal;
};

const updateDeal = async (id, data, userId = null) => {
  const { result, beforeDeal } = await transaction(async (client) => {
    const existingResult = await client.query(
      'SELECT * FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
      [id]
    );
    if (existingResult.rows.length === 0) {
      throw createError('Deal not found.', 404);
    }

    const existingDeal = existingResult.rows[0];
    const propertyId =
      data.propertyId !== undefined
        ? data.propertyId || null
        : existingDeal.property_id;
    const property = await getPropertyContext(client, propertyId);

    const merged = {
      ...existingDeal,
      ...data,
      propertyId,
      landPricingBasis: data.landPricingBasis ?? existingDeal.land_pricing_basis,
      landPriceRateInr: data.landPriceRateInr ?? existingDeal.land_price_rate_inr,
      landExtentInputValue: data.landExtentInputValue ?? existingDeal.land_extent_input_value,
      landExtentInputUnit: data.landExtentInputUnit ?? existingDeal.land_extent_input_unit,
      landAskPriceCr: data.landAskPriceCr ?? existingDeal.land_ask_price_cr,
    };

    const pricing = buildDealPricing(merged, property?.land_area_sqft || null);

    const updateResult = await client.query(
      `UPDATE deals SET
        property_id = $1,
        name = $2,
        deal_type = $3,
        assigned_to = $4,
        target_launch_date = $5,
        expected_close_date = $6,
        land_pricing_basis = $7,
        land_price_rate_inr = $8,
        land_extent_input_value = $9,
        land_extent_input_unit = $10,
        land_ask_price_cr = $11,
        negotiated_price_cr = $12,
        jv_split_developer_pct = $13,
        jv_split_landowner_pct = $14,
        rera_number = $15,
        rera_expiry_date = $16,
        notes = $17,
        priority = $18,
        asset_class = $19,
        deal_structure = $20,
        updated_at = NOW()
      WHERE id = $21
      RETURNING *`,
      [
        propertyId,
        data.name ?? existingDeal.name,
        data.dealType ?? existingDeal.deal_type,
        data.assignedTo ?? existingDeal.assigned_to,
        data.targetLaunchDate ?? existingDeal.target_launch_date,
        data.expectedCloseDate ?? existingDeal.expected_close_date,
        pricing.landPricingBasis,
        pricing.landPriceRateInr,
        pricing.landExtentInputValue,
        pricing.landExtentInputUnit,
        pricing.computedLandAskPriceCr,
        data.negotiatedPriceCr ?? existingDeal.negotiated_price_cr,
        data.jvSplitDeveloperPct ?? existingDeal.jv_split_developer_pct,
        data.jvSplitLandownerPct ?? existingDeal.jv_split_landowner_pct,
        data.reraNumber ?? existingDeal.rera_number,
        data.reraExpiryDate ?? existingDeal.rera_expiry_date,
        data.notes ?? existingDeal.notes,
        data.priority ?? existingDeal.priority,
        data.assetClass ?? existingDeal.asset_class,
        data.dealStructure ?? existingDeal.deal_structure,
        id,
      ]
    );

    return { result: updateResult.rows[0], beforeDeal: existingDeal };
  });

  // Reassignment is captured as its own event_type so the timeline
  // can render an "owner changed" pill that the analyst recognizes
  // separately from a "fields edited" entry. Other tracked fields
  // collapse into a single 'updated' row.
  if (
    beforeDeal &&
    result &&
    (beforeDeal.assigned_to ?? null) !== (result.assigned_to ?? null)
  ) {
    await dealAuditLog.recordAudit({
      dealId: id,
      eventType: 'reassigned',
      actorId: userId,
      before: { assigned_to: beforeDeal.assigned_to ?? null },
      after: { assigned_to: result.assigned_to ?? null },
    });
  }

  // Generic field-edit row — only fires when something tracked
  // actually changed (excluding assigned_to which already got its
  // own row above).
  const otherDiff = diffTrackedFields(
    { ...beforeDeal, assigned_to: result?.assigned_to },
    result,
  );
  if (otherDiff) {
    await dealAuditLog.recordAudit({
      dealId: id,
      eventType: 'updated',
      actorId: userId,
      before: otherDiff.before,
      after: otherDiff.after,
    });
  }

  return result;
};

const transitionStage = async (dealId, newStage, userId, notes = '') => {
  const dealResult = await query(
    'SELECT id, stage, is_archived FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );

  if (dealResult.rows.length === 0) {
    throw createError('Deal not found.', 404);
  }

  const currentDeal = dealResult.rows[0];

  if (currentDeal.is_archived) {
    throw createError('Restore this deal before moving it across stages.', 409);
  }

  if (!canTransitionStage(currentDeal.stage, newStage)) {
    throw createError(
      `Invalid stage transition from '${currentDeal.stage}' to '${newStage}'. Allowed: ${(STAGE_TRANSITIONS[currentDeal.stage] || []).join(', ') || 'none'}`,
      400
    );
  }

  return transaction(async (client) => {
    const dealUpdateResult = await client.query(
      `UPDATE deals SET stage = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newStage, dealId]
    );

    await client.query(
      `INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [dealId, currentDeal.stage, newStage, userId, notes || null]
    );

    // The 'dead' stage is REVERSIBLE (canTransitionStage permits dead -> sourced
    // / screening to revive a deal). We previously hard-deleted the linked
    // parcel here whenever no other live deal referenced it — permanently
    // destroying its PID / khata / survey / geocode / zoning / owner
    // intelligence, which the revival path never restored. Parcel data is
    // expensive to reconstruct, so we KEEP it: a dead deal retains its property,
    // and reviving the deal brings the parcel back intact. True orphan cleanup
    // happens only on hard-delete (deleteDeal), where the deal is gone for good.
    const propertyDeleted = null;

    // Fire after the txn writes succeed but before we return the row. The
    // activity insert runs outside the transaction (separate connection in
    // the sink) — that's deliberate, the auto-activity is best-effort and a
    // failure in it must never roll back the stage transition itself.
    publish(EVENTS.DEAL_STAGE_CHANGED, {
      dealId,
      fromStage: currentDeal.stage,
      toStage: newStage,
      userId,
      notes,
    });

    // Audit the transition for the AuditTab timeline. Fail-open: an
    // audit insert error must not roll back the stage write.
    await dealAuditLog.recordAudit({
      dealId,
      eventType: 'stage_changed',
      actorId: userId,
      before: { stage: currentDeal.stage },
      after: { stage: newStage },
      metadata: notes ? { notes } : {},
    });

    return {
      ...dealUpdateResult.rows[0],
      property_deleted: propertyDeleted,
    };
  });
};

const getDealsByStage = async () => {
  const result = await query(
    `SELECT d.stage,
      COUNT(*) as deal_count,
      SUM(COALESCE(f.total_revenue_cr, 0)) as total_value_cr,
      AVG(f.irr_pct) as avg_irr_pct,
      json_agg(
        json_build_object(
          'id', d.id,
          'name', d.name,
          'property_name', COALESCE(NULLIF(p.name, ''), NULLIF(p.address, ''), COALESCE(p.city, 'Unlinked property')),
          'city', p.city,
          'property_type', p.property_type,
          'land_area_sqft', p.land_area_sqft,
          'deal_type', d.deal_type,
          'priority', d.priority,
          'irr_pct', f.irr_pct,
          'total_revenue_cr', f.total_revenue_cr,
          'assigned_to_name', u.name,
          'updated_at', d.updated_at
        ) ORDER BY d.updated_at DESC
      ) as deals
     FROM deals d
     LEFT JOIN properties p ON d.property_id = p.id
     LEFT JOIN users u ON d.assigned_to = u.id
     LEFT JOIN financials f ON d.id = f.deal_id
     WHERE ${buildVisibleDealCondition('d')}
     GROUP BY d.stage
     ORDER BY ${buildStageOrderCase('d.stage')}`,
    []
  );

  const stageMap = {};
  for (const stage of DEAL_STAGES) {
    stageMap[stage] = {
      stage,
      deal_count: 0,
      total_value_cr: 0,
      avg_irr_pct: null,
      deals: [],
    };
  }

  for (const row of result.rows) {
    stageMap[row.stage] = {
      ...row,
      deal_count: parseInt(row.deal_count, 10),
      total_value_cr: parseFloat(row.total_value_cr) || 0,
      avg_irr_pct: row.avg_irr_pct ? parseFloat(row.avg_irr_pct) : null,
    };
  }

  return DEAL_STAGES.map((stage) => stageMap[stage]);
};

const getPipelineSummary = async () => {
  const summaryResult = await query(
    `SELECT
      COUNT(*) FILTER (WHERE ${buildVisibleDealCondition('d')}) as total_deals,
      COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage = ANY($1::deal_stage[])) as active_deals,
      COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage = 'closed') as closed_deals,
      COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage = 'dead') as dead_deals,
      COUNT(*) FILTER (WHERE d.is_archived = TRUE) as archived_deals,
      COALESCE(SUM(f.total_revenue_cr) FILTER (WHERE d.is_archived = FALSE AND d.stage = ANY($1::deal_stage[])), 0) as pipeline_value_cr,
      AVG(f.irr_pct) FILTER (WHERE f.irr_pct IS NOT NULL AND d.is_archived = FALSE AND d.stage <> 'dead') as avg_irr_pct
     FROM deals d
     LEFT JOIN financials f ON d.id = f.deal_id
     WHERE (d.organization_id = current_organization_id() OR d.id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id()))`,
    [LIVE_DEAL_STAGES]
  );

  const stageResult = await query(
    `SELECT stage, COUNT(*) as count
     FROM deals
     WHERE ${buildVisibleDealCondition('deals')}
     GROUP BY stage
     ORDER BY ${buildStageOrderCase('stage')}`
  );

  const stageDistribution = {};
  for (const row of stageResult.rows) {
    stageDistribution[row.stage] = parseInt(row.count, 10);
  }

  const summary = summaryResult.rows[0];
  return {
    total_deals: parseInt(summary.total_deals, 10),
    active_deals: parseInt(summary.active_deals, 10),
    closed_deals: parseInt(summary.closed_deals, 10),
    dead_deals: parseInt(summary.dead_deals, 10),
    archived_deals: parseInt(summary.archived_deals, 10),
    pipeline_value_cr: parseFloat(summary.pipeline_value_cr) || 0,
    avg_irr_pct: summary.avg_irr_pct ? parseFloat(summary.avg_irr_pct) : null,
    stage_distribution: stageDistribution,
  };
};

const archiveDeal = async (id, userId, reason = null) => {
  const result = await transaction(async (client) => {
    const currentDealResult = await client.query(
      'SELECT id, property_id, is_archived FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
      [id]
    );

    if (currentDealResult.rows.length === 0 || currentDealResult.rows[0].is_archived) {
      throw createError('Deal not found or already archived.', 404);
    }

    const updateResult = await client.query(
      `UPDATE deals
       SET is_archived = TRUE,
           archived_at = NOW(),
           archived_by = $2,
           archived_reason = $3,
           updated_at = NOW()
       WHERE id = $1 AND is_archived = FALSE
       RETURNING *`,
      [id, userId, reason || null]
    );

    const propertyDeleted = await purgePropertyIfInactiveOnly(
      client,
      updateResult.rows[0].property_id,
      id
    );

    return {
      ...updateResult.rows[0],
      property_deleted: propertyDeleted,
    };
  });

  // Audit OUTSIDE the txn. Fail-open: a logging failure must not
  // pretend the archive didn't happen.
  await dealAuditLog.recordAudit({
    dealId: id,
    eventType: 'archived',
    actorId: userId,
    before: { is_archived: false },
    after: { is_archived: true, archived_reason: reason || null },
    metadata: reason ? { reason } : {},
  });

  return result;
};

const restoreDeal = async (id, userId = null) => {
  const result = await query(
    `UPDATE deals
     SET is_archived = FALSE,
         archived_at = NULL,
         archived_by = NULL,
         archived_reason = NULL,
         updated_at = NOW()
     WHERE id = $1 AND is_archived = TRUE AND organization_id = current_organization_id()
     RETURNING *`,
    [id]
  );

  if (result.rows.length === 0) {
    throw createError('Deal not found or not archived.', 404);
  }

  // Audit. Fail-open.
  await dealAuditLog.recordAudit({
    dealId: id,
    eventType: 'restored',
    actorId: userId,
    before: { is_archived: true },
    after: { is_archived: false },
  });

  return result.rows[0];
};

// ──────────────────────────────────────────────────────────────────────────
// Bulk operations — multi-deal archive / reassign / stage transition
// ──────────────────────────────────────────────────────────────────────────

const MAX_BULK_DEAL_IDS = 50;

const sanitizeBulkIds = (ids) => {
  if (!Array.isArray(ids)) {
    throw createError('Body must include an array of deal ids.', 400);
  }
  const cleaned = [...new Set(
    ids
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter(Boolean),
  )];
  if (cleaned.length === 0) {
    throw createError('At least one id is required.', 400);
  }
  if (cleaned.length > MAX_BULK_DEAL_IDS) {
    throw createError(
      `Bulk operation capped at ${MAX_BULK_DEAL_IDS} ids per request (received ${cleaned.length}).`,
      400,
    );
  }
  return cleaned;
};

/**
 * Archive a list of deals. Per-id failures (already archived, not
 * found, etc.) are aggregated into the response — the request never
 * aborts halfway. Each archive runs through the existing
 * `archiveDeal` so the property-purge logic stays consistent.
 *
 * Each successful archive's per-deal audit row is augmented with the
 * shared `bulk_id` so an analyst can pivot on "show me everything
 * archived in that one batch action".
 */
const bulkArchiveDeals = async (ids, userId, reason = null) => {
  const cleaned = sanitizeBulkIds(ids);
  const bulkId = crypto.randomUUID();
  const succeeded = [];
  const failed = [];
  for (const id of cleaned) {
    try {
      const row = await archiveDeal(id, userId, reason);
      succeeded.push({ id, archived_at: row.archived_at });
      // Re-tag the audit row with bulk metadata. Best-effort; if
      // the migration is missing this is a no-op.
      await dealAuditLog.recordAudit({
        dealId: id,
        eventType: 'bulk_archived',
        actorId: userId,
        before: { is_archived: false },
        after: { is_archived: true, archived_reason: reason || null },
        metadata: { bulk_id: bulkId, bulk_size: cleaned.length, reason: reason || null },
      });
    } catch (err) {
      failed.push({
        id,
        error: err.message || 'Unknown error',
        statusCode: err.statusCode || 500,
      });
    }
  }
  return {
    requested: cleaned.length,
    succeeded_count: succeeded.length,
    failed_count: failed.length,
    succeeded,
    failed,
    bulk_id: bulkId,
  };
};

/**
 * Reassign a list of deals to a target user (or unassign with null).
 * Validates the target belongs to the same org, then runs a single
 * UPDATE with `id = ANY($ids)`. Same partial-failure shape as the
 * other bulk ops — anything that didn't move (deleted/archived/wrong-
 * org) lands in `failed[]` for the analyst to investigate.
 */
const bulkReassignDeals = async (ids, targetUserId, actorId) => {
  const cleaned = sanitizeBulkIds(ids);

  if (targetUserId) {
    const targetCheck = await query(
      `SELECT id FROM users WHERE id = $1 AND organization_id = current_organization_id() LIMIT 1`,
      [targetUserId],
    );
    if (!targetCheck.rows[0]) {
      throw createError('Target user not found in this organization.', 400);
    }
  }

  // CTE captures the previous assignee in the same round-trip as the
  // UPDATE so the audit row can record before / after without a
  // second SELECT. RETURNING surfaces both columns to the caller.
  const result = await query(
    `WITH prev AS (
       SELECT id, assigned_to AS old_assigned_to
         FROM deals
        WHERE id = ANY($2::uuid[])
          AND organization_id = current_organization_id()
     )
     UPDATE deals d
        SET assigned_to = $1,
            updated_at  = NOW()
       FROM prev
      WHERE d.id = prev.id
        AND d.organization_id = current_organization_id()
        AND d.is_archived = FALSE
      RETURNING d.id, d.assigned_to, prev.old_assigned_to`,
    [targetUserId || null, cleaned],
  );

  const succeededIds = new Set(result.rows.map((r) => r.id));
  const succeeded = result.rows.map((r) => ({
    id: r.id,
    assigned_to: r.assigned_to,
  }));
  const failed = cleaned
    .filter((id) => !succeededIds.has(id))
    .map((id) => ({
      id,
      error: 'Deal not found, archived, or not in this organization.',
      statusCode: 409,
    }));

  // Per-deal audit row tagged with the bulk_id so analysts can
  // reconstruct the batch. Fail-open: insert errors don't undo the
  // UPDATE that already committed. The CTE above gave us both old
  // and new assignees in a single round-trip.
  const bulkId = crypto.randomUUID();
  for (const r of result.rows) {
    await dealAuditLog.recordAudit({
      dealId: r.id,
      eventType: 'bulk_reassigned',
      actorId,
      before: { assigned_to: r.old_assigned_to ?? null },
      after: { assigned_to: r.assigned_to ?? null },
      metadata: { bulk_id: bulkId, bulk_size: cleaned.length },
    });
  }

  return {
    requested: cleaned.length,
    succeeded_count: succeeded.length,
    failed_count: failed.length,
    succeeded,
    failed,
    target_user_id: targetUserId || null,
    bulk_id: bulkId,
  };
};

/**
 * Hard-delete a list of deals. Same partial-failure shape as the other
 * bulk ops — anything that errors out (storage cleanup failure,
 * row-not-found, etc.) lands in failed[]. Each deletion runs through
 * the existing `deleteDeal` so the document-storage purge + property
 * cascade stay consistent. Admin-gated at the route layer; per-id RLS
 * inside `deleteDeal` is the additional safeguard.
 */
const bulkDeleteDeals = async (ids, userId = null) => {
  const cleaned = sanitizeBulkIds(ids);
  // We don't write a separate bulk_deleted audit row per deal because
  // the per-deal audit row inserted inside deleteDeal cascades when
  // the deal is removed. Instead, the bulk_id is recorded against the
  // org-scoped audit log via a synthetic 'bulk_deleted' row that
  // references each deal id, written BEFORE deleteDeal runs so the
  // FK still resolves. As with deleteDeal itself, the cascade will
  // sweep these up post-delete; the value is an org-wide audit query
  // that can list "everything this admin deleted in one click".
  const bulkId = crypto.randomUUID();
  const succeeded = [];
  const failed = [];
  for (const id of cleaned) {
    try {
      await dealAuditLog.recordAudit({
        dealId: id,
        eventType: 'bulk_deleted',
        actorId: userId,
        before: {},
        after: {},
        metadata: { bulk_id: bulkId, bulk_size: cleaned.length },
      });
      const result = await deleteDeal(id, userId);
      succeeded.push({ id: result?.id || id });
    } catch (err) {
      failed.push({
        id,
        error: err.message || 'Unknown error',
        statusCode: err.statusCode || 500,
      });
    }
  }
  return {
    requested: cleaned.length,
    succeeded_count: succeeded.length,
    failed_count: failed.length,
    succeeded,
    failed,
    bulk_id: bulkId,
  };
};

/**
 * Move a list of deals to the same target stage. Validates each
 * transition against the existing canTransitionStage rules — any deal
 * whose current stage doesn't allow the requested target lands in
 * failed[]. Iterates so the per-stage history rows + DEAL_STAGE_CHANGED
 * events fire correctly per deal.
 */
const bulkTransitionStage = async (ids, newStage, userId, notes = '') => {
  const cleaned = sanitizeBulkIds(ids);
  const bulkId = crypto.randomUUID();
  const succeeded = [];
  const failed = [];
  for (const id of cleaned) {
    try {
      const row = await transitionStage(id, newStage, userId, notes);
      succeeded.push({ id, stage: row.stage });
      // Tag the bulk batch id in addition to the per-deal
      // 'stage_changed' row that transitionStage already wrote.
      await dealAuditLog.recordAudit({
        dealId: id,
        eventType: 'bulk_stage_changed',
        actorId: userId,
        before: {},
        after: { stage: newStage },
        metadata: { bulk_id: bulkId, bulk_size: cleaned.length, notes: notes || null },
      });
    } catch (err) {
      failed.push({
        id,
        error: err.message || 'Unknown error',
        statusCode: err.statusCode || 500,
      });
    }
  }
  return {
    requested: cleaned.length,
    succeeded_count: succeeded.length,
    failed_count: failed.length,
    succeeded,
    failed,
    target_stage: newStage,
    bulk_id: bulkId,
  };
};

const deleteDeal = async (id, userId = null) => {
  // Snapshot the deal BEFORE deletion so the audit row records what was lost.
  // We log inside the transaction, before the DELETE, while the deal_id FK
  // still resolves. The FK is ON DELETE SET NULL (migration 20260624), so the
  // 'deleted' audit row SURVIVES the deletion (deal_id -> NULL) — a durable,
  // immutable record of who deleted what and when, surfaced by org-wide audit
  // reads. If the audit table is missing the insert soft-fails and the deletion
  // proceeds anyway.
  const dealSnapshot = await transaction(async (client) => {
    const dealResult = await client.query(
      'SELECT id, name, stage, is_archived, property_id FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
      [id]
    );

    if (dealResult.rows.length === 0) {
      throw createError('Deal not found.', 404);
    }

    const deal = dealResult.rows[0];
    // Delete is admin-gated at the route layer (requireRole('admin')) and
    // confirmed client-side by a modal. We previously required callers to
    // archive-first or move to dead/closed, but Archive was removed from the
    // UI in favor of Delete as the single destructive action — keep the
    // authz + confirm as the safeguards.

    const documentsResult = await client.query(
      'SELECT id, file_url FROM documents WHERE deal_id = $1',
      [id]
    );
    // Collect the storage keys but DON'T delete inside the transaction. Storage
    // deletes are not transactional, so deleting here and then hitting a later
    // in-txn failure would roll back the DB while the objects are already gone
    // — irreversible loss with the DB still referencing them. Purge AFTER the
    // commit, best-effort (below).
    const fileUrls = documentsResult.rows.map((d) => d.file_url).filter(Boolean);

    // Audit BEFORE the DELETE so the deal_id FK still resolves at insert. The
    // FK is ON DELETE SET NULL (migration 20260624), so this 'deleted' row
    // SURVIVES the deletion (deal_id -> NULL) — a durable, immutable record. The
    // deal-level AuditTab can't show it post-delete (the deal is gone), but
    // org-wide audit reads still surface it; the original id is preserved in
    // metadata.deleted_deal_id. Fail-open: if the audit insert fails we still
    // want the delete to proceed — the docs are already gone.
    try {
      await client.query(
        `INSERT INTO deal_audit_log (
           deal_id, organization_id, actor_id,
           event_type, before_json, after_json, metadata
         ) VALUES (
           $1,
           (SELECT organization_id FROM deals WHERE id = $1),
           $2,
           'deleted',
           $3, $4, $5
         )`,
        [
          id,
          userId,
          JSON.stringify({ name: deal.name, stage: deal.stage, is_archived: deal.is_archived }),
          JSON.stringify({}),
          JSON.stringify({ deleted_deal_id: id }),
        ],
      );
    } catch (err) {
      if (err && err.code !== '42P01' && err.code !== '42703') {
        // eslint-disable-next-line no-console
        console.warn(`[deleteDeal] audit insert failed: ${err.message || err}`);
      }
    }

    const result = await client.query('DELETE FROM deals WHERE id = $1 RETURNING id', [id]);
    const propertyDeleted = await purgePropertyIfInactiveOnly(client, deal.property_id, id);

    return {
      deleted: true,
      id: result.rows[0].id,
      property_deleted: propertyDeleted,
      fileUrls,
    };
  });

  // DB delete has COMMITTED. Purge the document objects from storage now as a
  // best-effort cleanup: a failure here only orphans a storage object (GC-able)
  // and must never reverse or block a committed deletion.
  for (const fileUrl of dealSnapshot.fileUrls) {
    try {
      await deleteStorageFile(fileUrl);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[deleteDeal] post-commit storage purge failed for ${fileUrl}: ${error.message}`);
    }
  }

  delete dealSnapshot.fileUrls;
  return dealSnapshot;
};

module.exports = {
  createDeal,
  getDeals,
  getDealById,
  updateDeal,
  transitionStage,
  getDealsByStage,
  getPipelineSummary,
  archiveDeal,
  restoreDeal,
  bulkArchiveDeals,
  bulkReassignDeals,
  bulkTransitionStage,
  bulkDeleteDeals,
  deleteDeal,
};
