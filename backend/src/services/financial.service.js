const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  computeFullFinancials,
  computeScenarios,
} = require('../engines/kernel.service');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const {
  resolveFinancialModelClass,
  FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS,
} = require('../constants/assetClasses');
const auditService = require('./audit.service');
const dealAuditLog = require('./dealAuditLog.service');

// ─── SCENARIO PERSISTENCE ────────────────────────────────────────────────────

const SCENARIO_MULTIPLIERS = {
  base: { revenue: 1.00, cost: 1.00, duration: 1.00 },
  bull: { revenue: 1.10, cost: 0.95, duration: 0.90 },
  bear: { revenue: 0.88, cost: 1.10, duration: 1.20 },
};

const persistScenarios = async (dealId, scenarios) => {
  if (!scenarios || typeof scenarios !== 'object') return;
  for (const key of Object.keys(SCENARIO_MULTIPLIERS)) {
    const s = scenarios[key];
    if (!s) continue;
    const kpis = s.kpis || {};
    const rev  = s.revenue || {};
    const m    = SCENARIO_MULTIPLIERS[key];
    await query(
      `INSERT INTO financial_scenarios (
         deal_id, organization_id, scenario, label,
         revenue_multiplier, cost_multiplier, duration_multiplier,
         irr_pct, npv_cr, equity_multiple, gross_margin_pct,
         total_revenue_cr, total_cost_cr,
         kpis, inputs
       ) VALUES ($1, (SELECT organization_id FROM deals WHERE id = $1), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (deal_id, scenario) DO UPDATE SET
         label = EXCLUDED.label,
         revenue_multiplier = EXCLUDED.revenue_multiplier,
         cost_multiplier = EXCLUDED.cost_multiplier,
         duration_multiplier = EXCLUDED.duration_multiplier,
         irr_pct = EXCLUDED.irr_pct,
         npv_cr = EXCLUDED.npv_cr,
         equity_multiple = EXCLUDED.equity_multiple,
         gross_margin_pct = EXCLUDED.gross_margin_pct,
         total_revenue_cr = EXCLUDED.total_revenue_cr,
         total_cost_cr = EXCLUDED.total_cost_cr,
         kpis = EXCLUDED.kpis,
         inputs = EXCLUDED.inputs,
         updated_at = NOW()`,
      [
        dealId,
        key,
        s.label || null,
        m.revenue,
        m.cost,
        m.duration,
        kpis.irr ?? null,
        kpis.npv ?? null,
        kpis.equityMultiple ?? null,
        kpis.grossMarginPct ?? rev.grossMarginPct ?? null,
        rev.totalRevenueCr ?? null,
        rev.totalCostCr ?? null,
        JSON.stringify(kpis),
        JSON.stringify(s.adjustments || {}),
      ]
    );
  }
};

// ─── CALCULATE AND SAVE ───────────────────────────────────────────────────────

const calculateAndSave = async (dealId, inputData, options = {}) => {
  const { actorId = null } = options;
  const dealResult = await query(
    'SELECT id, is_archived, stage FROM deals WHERE id = $1 AND organization_id = current_organization_id()',
    [dealId]
  );
  if (dealResult.rows.length === 0) throw createError('Deal not found.', 404);
  const dealRow = dealResult.rows[0];
  if (dealRow.is_archived) throw createError('Restore this deal before recalculating financials.', 409);
  if (dealRow.stage === 'dead') throw createError('Financial models cannot be saved to a dead deal.', 409);

  const selectedAssetClass = inputData.assetClass || 'residential_apartments';
  const modelAssetClass = resolveFinancialModelClass(selectedAssetClass);
  const normalizedInput = {
    ...inputData,
    assetClass: modelAssetClass,
  };

  const computed   = computeFullFinancials(normalizedInput);
  const scenarios  = computeScenarios(normalizedInput);
  const assetClass = selectedAssetClass;
  const leg        = computed._legacy || {};
  const kpis       = computed.kpis    || {};
  const costs      = computed.costs   || {};
  const areas      = computed.areas   || {};

  // Store everything including scenarios in model_params (no separate column needed)
  const modelParams = JSON.stringify({
    inputs:       computed.inputs,
    selectedAssetClass,
    financialModelClass: modelAssetClass,
    financialModelLabel: FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS[selectedAssetClass] || 'Residential Apartments',
    kpis,
    areas,
    costs,
    revenue:      computed.revenue,
    capitalStack: computed.capitalStack,
    proforma:     computed.proforma,   // quarter × category sources/uses waterfall
    scenarios,    // embedded — no scenarios_data column needed
    // Audit trail: engine version + computation timestamp. Investor-grade
    // reports can cite this alongside the deal's commit hash to prove which
    // kernel + input set produced the saved numbers.
    engineVersion: computed.engineVersion || 'kernel-v2',
    computedAt: new Date().toISOString(),
  });

  const params = [
    assetClass,
    modelParams,
    leg.land_cost_cr                   ?? null,
    leg.plot_area_sqft                 ?? null,
    leg.fsi                            ?? null,
    leg.loading_factor                 ?? null,
    leg.construction_cost_per_sqft     ?? null,
    leg.selling_rate_per_sqft          ?? null,
    leg.approval_cost_cr               ?? null,
    leg.marketing_cost_pct             ?? null,
    leg.finance_cost_pct               ?? null,
    leg.developer_margin_pct           ?? null,
    leg.project_duration_months        ?? null,
    areas.grossBuiltUp                 ?? null,
    areas.saleable                     ?? null,
    areas.carpet                       ?? null,
    areas.superBuiltUp                 ?? null,
    costs.construction                 ?? null,
    costs.gst                          ?? null,
    costs.stampDuty                    ?? null,
    costs.marketing                    ?? null,
    costs.finance                      ?? null,
    costs.total                        ?? null,
    leg.total_revenue_cr               ?? null,
    leg.gross_profit_cr                ?? null,
    leg.gross_margin_pct               ?? null,
    leg.developer_profit_cr            ?? null,
    kpis.npv                           ?? null,
    kpis.irr                           ?? null,
    kpis.rlv                           ?? null,
    kpis.equityMultiple                ?? null,
    kpis.noi                           ?? null,
    kpis.yieldOnCost                   ?? null,
    kpis.exitValue                     ?? null,
    kpis.entryValue                    ?? null,
    kpis.dscr                          ?? null,
    kpis.noi                           ?? null,   // stabilized_noi_cr
    JSON.stringify(computed.cashFlows),
    JSON.stringify(computed.sensitivityMatrix),
    leg.discount_rate_pct              ?? null,
  ];

  // Persist scenarios to first-class table so they are queryable without
  // deserializing model_params. Non-fatal — model_params still holds the
  // authoritative snapshot in case the table write is rolled back / skipped.
  try {
    await persistScenarios(dealId, scenarios);
  } catch (err) {
    console.warn('[financial.service] persistScenarios failed:', err.message);
  }

  const existing = await query('SELECT id FROM financials WHERE deal_id = $1', [dealId]);

  let result;
  if (existing.rows.length > 0) {
    result = await query(
      `UPDATE financials SET
        asset_class = $1, model_params = $2,
        land_cost_cr = $3, plot_area_sqft = $4, fsi = $5,
        loading_factor = $6, construction_cost_per_sqft = $7, selling_rate_per_sqft = $8,
        approval_cost_cr = $9, marketing_cost_pct = $10, finance_cost_pct = $11,
        developer_margin_pct = $12, project_duration_months = $13,
        gross_area_sqft = $14, saleable_area_sqft = $15, carpet_area_sqft = $16,
        super_builtup_area_sqft = $17, total_construction_cost_cr = $18,
        gst_cost_cr = $19, stamp_duty_cr = $20, marketing_cost_cr = $21,
        finance_cost_cr = $22, total_cost_cr = $23, total_revenue_cr = $24,
        gross_profit_cr = $25, gross_margin_pct = $26, developer_profit_cr = $27,
        npv_cr = $28, irr_pct = $29, residual_land_value_cr = $30, equity_multiple = $31,
        noi_cr = $32, yield_on_cost_pct = $33, exit_value_cr = $34, entry_value_cr = $35,
        dscr = $36, stabilized_noi_cr = $37,
        cash_flows = $38, sensitivity_matrix = $39, discount_rate_pct = $40,
        updated_at = NOW()
       WHERE deal_id = $41
       RETURNING *`,
      [...params, dealId]
    );
  } else {
    result = await query(
      `INSERT INTO financials (
        asset_class, model_params,
        land_cost_cr, plot_area_sqft, fsi, loading_factor,
        construction_cost_per_sqft, selling_rate_per_sqft,
        approval_cost_cr, marketing_cost_pct, finance_cost_pct,
        developer_margin_pct, project_duration_months,
        gross_area_sqft, saleable_area_sqft, carpet_area_sqft,
        super_builtup_area_sqft, total_construction_cost_cr,
        gst_cost_cr, stamp_duty_cr, marketing_cost_cr,
        finance_cost_cr, total_cost_cr, total_revenue_cr,
        gross_profit_cr, gross_margin_pct, developer_profit_cr,
        npv_cr, irr_pct, residual_land_value_cr, equity_multiple,
        noi_cr, yield_on_cost_pct, exit_value_cr, entry_value_cr,
        dscr, stabilized_noi_cr,
        cash_flows, sensitivity_matrix, discount_rate_pct,
        deal_id
       ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
        $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41
       ) RETURNING *`,
      [...params, dealId]
    );
  }

  // ── AUDIT TRAIL ────────────────────────────────────────────────────────────
  // Immutable, HMAC-signed record of (inputs → outputs @ engine version). The
  // row is the single artifact an investor / IC / auditor can replay to prove
  // the numbers on the pitch deck came from the exact kernel version + input
  // set on file. Non-fatal on failure: the financial save already succeeded
  // and we don't want audit infrastructure outages to block underwriting.
  try {
    await auditService.recordEvent({
      dealId,
      eventType: 'calculate_and_save',
      engineVersion: computed.engineVersion || 'kernel-v2',
      assetClass: selectedAssetClass,
      inputs: computed.inputs || normalizedInput,
      outputs: auditService.flattenOutputsForAudit(computed),
      actorId,
      metadata: {
        computedAt: new Date().toISOString(),
        hasSensitivity: !!computed.sensitivityMatrix,
        hasScenarios: !!scenarios,
      },
    });
  } catch (err) {
    console.warn('[financial.service] audit recordEvent failed:', err.message);
  }

  return { ...result.rows[0], computed };
};

// ─── GET FINANCIALS ───────────────────────────────────────────────────────────

const getFinancials = async (dealId) => {
  const result = await query(
    `SELECT f.*
     FROM financials f
     INNER JOIN deals d ON d.id = f.deal_id
     WHERE f.deal_id = $1
       AND ${buildVisibleDealCondition('d')}`,
    [dealId]
  );
  if (result.rows.length === 0) throw createError('Financials not found for this deal.', 404);
  return result.rows[0];
};

const updateFinancials = async (dealId, inputData, options = {}) =>
  calculateAndSave(dealId, inputData, options);

// ─── SENSITIVITY ─────────────────────────────────────────────────────────────

const runSensitivity = async (dealId, params, options = {}) => {
  const { actorId = null } = options;
  const fin        = await getFinancials(dealId);
  const assetClass = fin.asset_class || 'residential_apartments';
  const stored     = fin.model_params?.inputs || {};
  const baseParams = {
    assetClass: resolveFinancialModelClass(assetClass),
    plotAreaSqft:            params.plotAreaSqft            || stored.plotAreaSqft            || fin.plot_area_sqft,
    fsi:                     params.fsi                     || stored.fsi                     || fin.fsi,
    loadingFactor:           params.loadingFactor           || stored.loadingFactor           || fin.loading_factor,
    constructionCostPerSqft: params.constructionCostPerSqft || stored.constructionCostPerSqft || fin.construction_cost_per_sqft,
    sellingRatePerSqft:      params.sellingRatePerSqft      || stored.sellingRatePerSqft      || fin.selling_rate_per_sqft,
    landCostCr:              params.landCostCr              ?? stored.landCostCr              ?? fin.land_cost_cr   ?? 0,
    approvalCostCr:          params.approvalCostCr          ?? stored.approvalCostCr          ?? fin.approval_cost_cr ?? 0,
    marketingCostPct:        params.marketingCostPct        || stored.marketingCostPct        || fin.marketing_cost_pct || 5,
    financeCostPct:          params.financeCostPct          || stored.financeCostPct          || fin.finance_cost_pct  || 12,
    discountRatePct:         params.discountRatePct         || stored.discountRatePct         || fin.discount_rate_pct || 14,
    projectDurationMonths:   params.projectDurationMonths   || stored.projectDurationMonths   || fin.project_duration_months || 36,
    developerMarginPct:      params.developerMarginPct      || stored.developerMarginPct      || fin.developer_margin_pct || 20,
    ...stored,
    ...params,
  };
  const result = computeFullFinancials(baseParams);
  const matrix = result.sensitivityMatrix;
  await query(
    'UPDATE financials SET sensitivity_matrix = $1, updated_at = NOW() WHERE deal_id = $2',
    [JSON.stringify(matrix), dealId]
  );

  // Sign the sensitivity run so operators can prove "this matrix came from
  // this exact input perturbation at this engine version". Non-fatal on
  // failure — the user already has the matrix back.
  try {
    await auditService.recordEvent({
      dealId,
      eventType: 'sensitivity_run',
      engineVersion: result.engineVersion || 'kernel-v2',
      assetClass,
      inputs: result.inputs || baseParams,
      outputs: {
        ...auditService.flattenOutputsForAudit(result),
        sensitivityMatrix: matrix,
      },
      actorId,
      metadata: { perturbations: Object.keys(params || {}) },
    });
  } catch (err) {
    console.warn('[financial.service] audit recordEvent (sensitivity) failed:', err.message);
  }

  return matrix;
};

// ─── SCENARIOS ────────────────────────────────────────────────────────────────

const getScenarios = async (dealId) => {
  const fin = await getFinancials(dealId);

  // Check if scenarios already stored in model_params
  if (fin.model_params?.scenarios) return fin.model_params.scenarios;

  // Recompute from stored inputs
  const assetClass = fin.asset_class || 'residential_apartments';
  const stored     = fin.model_params?.inputs || {};
  const baseParams = {
    assetClass: resolveFinancialModelClass(assetClass),
    ...stored,
    plotAreaSqft:            stored.plotAreaSqft            ?? fin.plot_area_sqft,
    fsi:                     stored.fsi                     ?? fin.fsi,
    loadingFactor:           stored.loadingFactor           ?? fin.loading_factor,
    constructionCostPerSqft: stored.constructionCostPerSqft ?? fin.construction_cost_per_sqft,
    sellingRatePerSqft:      stored.sellingRatePerSqft      ?? fin.selling_rate_per_sqft,
    landCostCr:              stored.landCostCr              ?? fin.land_cost_cr   ?? 0,
    approvalCostCr:          stored.approvalCostCr          ?? fin.approval_cost_cr ?? 0,
    marketingCostPct:        stored.marketingCostPct        ?? fin.marketing_cost_pct ?? 5,
    financeCostPct:          stored.financeCostPct          ?? fin.finance_cost_pct  ?? 12,
    discountRatePct:         stored.discountRatePct         ?? fin.discount_rate_pct ?? 14,
    projectDurationMonths:   stored.projectDurationMonths   ?? fin.project_duration_months ?? 36,
    developerMarginPct:      stored.developerMarginPct      ?? fin.developer_margin_pct ?? 20,
  };
  return computeScenarios(baseParams);
};

// ─── PROVENANCE GRAPH ─────────────────────────────────────────────────────────

/**
 * Return the dependency DAG for a saved deal's financial model.
 *
 * Every KPI, cost bucket, and revenue line traces back through computations
 * to the user-supplied inputs. The UI (MethodologyExplorer DAG view, IC
 * deck derivation hovers) consumes this snapshot so investors can answer
 * "how was this number produced" without re-running the kernel.
 *
 * Recomputed from persisted inputs on each read — cheap (<200 nodes), and
 * guarantees the graph structure tracks the current kernel version rather
 * than whatever shape was saved. Matches `getScenarios` cadence.
 */
const getFinancialGraph = async (dealId) => {
  const fin = await getFinancials(dealId);
  const assetClass = fin.asset_class || 'residential_apartments';
  const stored = fin.model_params?.inputs || {};
  const baseParams = {
    assetClass: resolveFinancialModelClass(assetClass),
    ...stored,
    plotAreaSqft:            stored.plotAreaSqft            ?? fin.plot_area_sqft,
    fsi:                     stored.fsi                     ?? fin.fsi,
    loadingFactor:           stored.loadingFactor           ?? fin.loading_factor,
    constructionCostPerSqft: stored.constructionCostPerSqft ?? fin.construction_cost_per_sqft,
    sellingRatePerSqft:      stored.sellingRatePerSqft      ?? fin.selling_rate_per_sqft,
    landCostCr:              stored.landCostCr              ?? fin.land_cost_cr   ?? 0,
    approvalCostCr:          stored.approvalCostCr          ?? fin.approval_cost_cr ?? 0,
    marketingCostPct:        stored.marketingCostPct        ?? fin.marketing_cost_pct ?? 5,
    financeCostPct:          stored.financeCostPct          ?? fin.finance_cost_pct  ?? 12,
    discountRatePct:         stored.discountRatePct         ?? fin.discount_rate_pct ?? 14,
    projectDurationMonths:   stored.projectDurationMonths   ?? fin.project_duration_months ?? 36,
    developerMarginPct:      stored.developerMarginPct      ?? fin.developer_margin_pct ?? 20,
    skipSensitivity: true, // graph endpoint doesn't need sensitivity matrix
  };
  const result = computeFullFinancials(baseParams);
  return result.financialGraph;
};

// ─── AUDIT EVENTS ─────────────────────────────────────────────────────────────

/**
 * Return the signed audit trail for a deal. Verifies each row in-memory so
 * the UI can render a pass/fail indicator per event without a second round
 * trip. `getFinancials` is called first to enforce the deal visibility
 * policy — if the caller can't read the deal, they can't read its events.
 *
 * When `includeOutputsSummary` is true (default for the Audit tab on the
 * deal page), each row includes a `outputs_summary` projection of
 * common KPIs so the UI can compute deltas between consecutive events
 * without N round-trips. The actor's display name is hydrated via a
 * single bulk users lookup.
 */
const listDealEvents = async (dealId, { limit = 50, includeOutputsSummary = false } = {}) => {
  await getFinancials(dealId); // visibility gate

  // Pull both feeds in parallel — financial computations (HMAC-signed)
  // and mutation log (stage transitions / archive / reassign / bulk).
  // The two are merged + sorted client-side here so the AuditTab
  // renders one chronological timeline.
  const [financialRows, mutationRows] = await Promise.all([
    auditService.listEvents(dealId, {
      limit,
      includeOutputs: !!includeOutputsSummary,
    }),
    dealAuditLog.listForDeal(dealId, { limit }),
  ]);

  // Bulk-resolve actor display names across BOTH feeds so the timeline
  // can show "Rachit Jain" instead of an opaque UUID. One round-trip
  // regardless of event count.
  let actorMap = new Map();
  const actorIds = [
    ...new Set(
      [
        ...financialRows.map((r) => r.actor_id),
        ...mutationRows.map((r) => r.actor_id),
      ].filter(Boolean),
    ),
  ];
  if (actorIds.length > 0) {
    try {
      const actorsResult = await query(
        `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`,
        [actorIds],
      );
      actorMap = new Map(actorsResult.rows.map((u) => [u.id, u]));
    } catch {
      // Fail open — UI will fall back to actor_id display.
    }
  }

  const hydrateActor = (actorId) => {
    if (!actorId) return null;
    const u = actorMap.get(actorId);
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  };

  // Financial rows: keep the existing shape (verification note, hashes,
  // optional outputs_summary). Tag with kind: 'financial' so the UI
  // discriminator renders the existing KPI delta block.
  const financial = financialRows.map((row) => {
    const summary = includeOutputsSummary
      ? auditService.summarizeEventOutputs(row.outputs_json)
      : null;
    const { outputs_json: _drop, ...restRow } = row;
    return {
      ...restRow,
      kind: 'financial',
      actor: hydrateActor(row.actor_id),
      outputs_summary: summary,
      verification: {
        note: 'Call GET /financials/:dealId/events/:eventId/verify for full hash + HMAC check.',
      },
    };
  });

  // Mutation rows: shape them so the UI renders a before/after diff
  // pill block instead of KPI deltas. Hashes / signature are absent
  // by design — these aren't replay-verifiable.
  const mutation = mutationRows.map((row) => ({
    id: row.id,
    deal_id: row.deal_id,
    organization_id: row.organization_id,
    actor_id: row.actor_id,
    actor: hydrateActor(row.actor_id),
    event_type: row.event_type,
    before: row.before_json || {},
    after: row.after_json || {},
    metadata: row.metadata || {},
    created_at: row.created_at,
    kind: 'mutation',
  }));

  // Merge + sort newest-first by created_at. Tie-break by kind so
  // mutation events render below financial events of the same
  // millisecond (rarely happens in practice, but stable ordering
  // keeps snapshot tests happy).
  const merged = [...financial, ...mutation].sort((a, b) => {
    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    if (bt !== at) return bt - at;
    return a.kind === 'financial' ? -1 : 1;
  });

  // Cap the merged feed at the requested limit (default 50). The two
  // upstream queries each fetch up to `limit` rows so the merged
  // result can be up to 2*limit before truncation.
  return merged.slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
};

const verifyDealEvent = async (dealId, eventId) => {
  await getFinancials(dealId); // visibility gate
  const event = await auditService.getEvent(eventId);
  if (event.deal_id !== dealId) throw createError('Audit event does not belong to this deal.', 404);
  const verification = auditService.verifyEvent(event);
  return { event, verification };
};

const replayDealEvent = async (dealId, eventId) => {
  await getFinancials(dealId); // visibility gate
  const event = await auditService.getEvent(eventId);
  if (event.deal_id !== dealId) throw createError('Audit event does not belong to this deal.', 404);
  const verification = auditService.verifyEvent(event);
  const replay = auditService.replayEvent(event);
  return { event, verification, replay };
};

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────

const exportFinancialCSV = async (dealId) => {
  const fin  = await getFinancials(dealId);
  const mp   = fin.model_params || {};
  const kpis = mp.kpis   || {};
  const costs= mp.costs  || {};
  const areas= mp.areas  || {};
  const rev  = mp.revenue|| {};

  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cols) => cols.map(esc).join(',');

  return [
    row('REDIP Financial Model Export'),
    row('Deal ID', dealId),
    row('Asset Class', fin.asset_class),
    row('Generated', new Date().toISOString()),
    row(''),
    row('=== KEY PERFORMANCE INDICATORS ==='),
    row('Metric', 'Value'),
    row('IRR (%)',            kpis.irr           ?? fin.irr_pct),
    row('NPV (₹ Cr)',        kpis.npv           ?? fin.npv_cr),
    row('Equity Multiple',   kpis.equityMultiple ?? fin.equity_multiple),
    row('RLV (₹ Cr)',        kpis.rlv           ?? fin.residual_land_value_cr),
    row('Gross Margin (%)',  kpis.grossMarginPct ?? fin.gross_margin_pct),
    row('Levered IRR (%)',   kpis.leveredIrr),
    row('NOI (₹ Cr/yr)',     kpis.noi           ?? fin.noi_cr),
    row('Yield on Cost (%)', kpis.yieldOnCost    ?? fin.yield_on_cost_pct),
    row('Exit Value (₹ Cr)', kpis.exitValue     ?? fin.exit_value_cr),
    row('DSCR',              kpis.dscr          ?? fin.dscr),
    row(''),
    row('=== AREA BREAKDOWN (sqft) ==='),
    row('Area', 'sqft'),
    row('Gross Built-Up',   areas.grossBuiltUp  ?? fin.gross_area_sqft),
    row('Saleable',         areas.saleable      ?? fin.saleable_area_sqft),
    row('Carpet',           areas.carpet        ?? fin.carpet_area_sqft),
    row('Super Built-Up',   areas.superBuiltUp  ?? fin.super_builtup_area_sqft),
    row('Leasable',         areas.leasable),
    row(''),
    row('=== COST BREAKDOWN (₹ Cr) ==='),
    row('Line Item', 'Amount'),
    row('Land Cost',                 costs.land         ?? fin.land_cost_cr),
    row('Construction Cost',         costs.construction ?? fin.total_construction_cost_cr),
    row('GST',                       costs.gst          ?? fin.gst_cost_cr),
    row('Contingency',               costs.contingency),
    row('Stamp Duty',                costs.stampDuty    ?? fin.stamp_duty_cr),
    row('Approval / Statutory',      costs.approval     ?? fin.approval_cost_cr),
    row('Architecture Fees',         costs.architecture),
    row('PMC Fees',                  costs.pmc),
    row('Marketing',                 costs.marketing    ?? fin.marketing_cost_cr),
    row('Finance Cost',              costs.finance      ?? fin.finance_cost_cr),
    row('Tenant Improvements',       costs.tenantImprovements),
    row('Leasing Commissions',       costs.leasingCommissions),
    row('TOTAL COST',                costs.total        ?? fin.total_cost_cr),
    row(''),
    row('=== REVENUE SUMMARY (₹ Cr) ==='),
    row('Total Revenue',   rev.totalRevenueCr ?? fin.total_revenue_cr),
    row('Gross Profit',    rev.grossProfitCr  ?? fin.gross_profit_cr),
    row('Gross Margin %',  rev.grossMarginPct ?? fin.gross_margin_pct),
    row('Stabilized NOI',  rev.stabilizedNOI  ?? fin.stabilized_noi_cr),
    row('Exit Value',      rev.exitValue      ?? fin.exit_value_cr),
    row(''),
    row('=== QUARTERLY CASH FLOWS (₹ Cr) ==='),
    row('Quarter', 'Net Cash Flow'),
    ...(fin.cash_flows?.quarterly || []).map((cf) => row(`Q${cf.quarter}`, cf.net)),
    row(''),
    row('=== YEARLY CASH FLOWS (₹ Cr) ==='),
    row('Period', 'Net Cash Flow'),
    ...(fin.cash_flows?.yearly || []).map((cf) => row(cf.label, cf.net)),
  ].join('\n');
};

// ─── AUDIT FEED CSV EXPORT ────────────────────────────────────────────────────
//
// Exports the same merged feed the AuditTab renders, in CSV form, so an
// analyst can drop it into an IC packet or hand it to a diligence
// partner. Mirrors the column set the UI exposes — actor name, event
// type, before/after diff (mutation rows), KPI snapshot (financial
// rows), cryptographic hashes (financial rows). One row per event.

const csvEsc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const stringifyJson = (obj) => {
  if (!obj || typeof obj !== 'object' || Object.keys(obj).length === 0) return '';
  try {
    return JSON.stringify(obj);
  } catch {
    return '';
  }
};

const exportAuditFeedCSV = async (dealId) => {
  // Reuse the merged feed so the CSV matches the UI exactly. We pull
  // up to 500 rows (the listDealEvents internal cap) — the deal page
  // shows the most recent 50 by default but an exporter should hand
  // back the full audit history available.
  const rows = await listDealEvents(dealId, {
    limit: 500,
    includeOutputsSummary: true,
  });

  const header = [
    'created_at',
    'kind',
    'event_type',
    'actor_name',
    'actor_email',
    'engine_version',
    // Financial-row columns
    'irr_pct', 'npv_cr', 'total_revenue_cr', 'total_cost_cr',
    'gross_profit_cr', 'gross_margin_pct', 'equity_multiple', 'residual_land_value_cr',
    'inputs_hash', 'outputs_hash', 'signature',
    // Mutation-row columns
    'before_json', 'after_json', 'metadata_json',
  ].join(',');

  const dataLines = rows.map((row) => {
    const summary = row.outputs_summary || {};
    const cols = [
      row.created_at ? new Date(row.created_at).toISOString() : '',
      row.kind || 'financial',
      row.event_type || '',
      row.actor?.name || '',
      row.actor?.email || '',
      row.engine_version || '',
      summary.irr_pct ?? '',
      summary.npv_cr ?? '',
      summary.total_revenue_cr ?? '',
      summary.total_cost_cr ?? '',
      summary.gross_profit_cr ?? '',
      summary.gross_margin_pct ?? '',
      summary.equity_multiple ?? '',
      summary.residual_land_value_cr ?? '',
      row.inputs_hash || '',
      row.outputs_hash || '',
      row.signature || '',
      stringifyJson(row.before),
      stringifyJson(row.after),
      stringifyJson(row.metadata),
    ];
    return cols.map(csvEsc).join(',');
  });

  // Two-line header banner so the file is self-describing when opened
  // in Excel — same convention as exportFinancialCSV.
  return [
    csvEsc(`REDIP Deal Audit Feed Export — deal ${dealId}`),
    csvEsc(`Generated ${new Date().toISOString()}`),
    '',
    header,
    ...dataLines,
  ].join('\n');
};

// ─── BULK-BATCH PIVOT ─────────────────────────────────────────────────────────
//
// Given a bulk_id (UUID stamped on every per-deal audit row that came
// from a bulk operation), return the list of deals that batch
// touched. Lets the UI render a "this was 1 of 12 deals moved at the
// same time" peek. Org-scoped via RLS on deal_audit_log.
const listDealsForBulkBatch = async (bulkId) => {
  if (!bulkId) return [];
  let result;
  try {
    result = await query(
      `SELECT dal.deal_id,
              dal.event_type,
              dal.before_json,
              dal.after_json,
              dal.created_at,
              d.name AS deal_name,
              d.stage AS deal_stage,
              d.is_archived AS deal_is_archived
         FROM deal_audit_log dal
         LEFT JOIN deals d ON d.id = dal.deal_id
        WHERE dal.metadata->>'bulk_id' = $1
        ORDER BY dal.created_at ASC`,
      [bulkId],
    );
  } catch (err) {
    // Migration not applied yet — return empty list rather than
    // surface a 500 to the AuditTab.
    if (err && err.code === '42P01') return [];
    throw err;
  }
  return result.rows;
};

module.exports = {
  calculateAndSave,
  getFinancials,
  updateFinancials,
  runSensitivity,
  getScenarios,
  getFinancialGraph,
  exportFinancialCSV,
  exportAuditFeedCSV,
  listDealEvents,
  verifyDealEvent,
  replayDealEvent,
  listDealsForBulkBatch,
};
