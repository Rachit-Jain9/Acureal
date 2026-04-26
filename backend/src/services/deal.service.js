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

  const countResult = await query(
    `SELECT COUNT(*)
     FROM deals d
     LEFT JOIN properties p ON d.property_id = p.id
     WHERE ${whereClause}`,
    values
  );

  const dataResult = await query(
    `SELECT ${dealSelect}
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

  const normalizedRows = dataResult.rows.map((row) => ({
    ...row,
    document_count: parseInt(row.document_count, 10) || 0,
    pending_required_dd_count: parseInt(row.pending_required_dd_count, 10) || 0,
    pending_deal_breakers: parseInt(row.pending_deal_breakers, 10) || 0,
    required_approval_count: parseInt(row.required_approval_count, 10) || 0,
    validated_approval_count: parseInt(row.validated_approval_count, 10) || 0,
    open_high_risk_count: parseInt(row.open_high_risk_count, 10) || 0,
    key_risks: Array.isArray(row.key_risks) ? row.key_risks : [],
  }));

  return {
    data: normalizedRows,
    pagination: {
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit),
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

const updateDeal = async (id, data) =>
  transaction(async (client) => {
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

    const result = await client.query(
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

    return result.rows[0];
  });

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

    let propertyDeleted = null;
    if (newStage === 'dead') {
      const archivedDeal = dealUpdateResult.rows[0];
      propertyDeleted = await purgePropertyIfInactiveOnly(
        client,
        archivedDeal.property_id,
        dealId
      );
    }

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

const archiveDeal = async (id, userId, reason = null) =>
  transaction(async (client) => {
    const currentDealResult = await client.query(
      'SELECT id, property_id, is_archived FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
      [id]
    );

    if (currentDealResult.rows.length === 0 || currentDealResult.rows[0].is_archived) {
      throw createError('Deal not found or already archived.', 404);
    }

    const result = await client.query(
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
      result.rows[0].property_id,
      id
    );

    return {
      ...result.rows[0],
      property_deleted: propertyDeleted,
    };
  });

const restoreDeal = async (id) => {
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

  return result.rows[0];
};

const deleteDeal = async (id) =>
  transaction(async (client) => {
    const dealResult = await client.query(
      'SELECT id, stage, is_archived, property_id FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
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

    for (const document of documentsResult.rows) {
      if (!document.file_url) {
        continue;
      }
      try {
        await deleteStorageFile(document.file_url);
      } catch (error) {
        throw createError(`Could not permanently delete an associated document: ${error.message}`, 500);
      }
    }

    const result = await client.query('DELETE FROM deals WHERE id = $1 RETURNING id', [id]);
    const propertyDeleted = await purgePropertyIfInactiveOnly(client, deal.property_id, id);

    return {
      deleted: true,
      id: result.rows[0].id,
      property_deleted: propertyDeleted,
    };
  });

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
  deleteDeal,
};
