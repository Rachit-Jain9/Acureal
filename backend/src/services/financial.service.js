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

const calculateAndSave = async (dealId, inputData) => {
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

const updateFinancials = async (dealId, inputData) => calculateAndSave(dealId, inputData);

// ─── SENSITIVITY ─────────────────────────────────────────────────────────────

const runSensitivity = async (dealId, params) => {
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

module.exports = {
  calculateAndSave,
  getFinancials,
  updateFinancials,
  runSensitivity,
  getScenarios,
  getFinancialGraph,
  exportFinancialCSV,
};
