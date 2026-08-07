// View-model transform: raw financials API response → normalized shape for the
// FinancialsPage and its sub-components. Pure function, no side effects.

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export function hasLegacyResidentialLoadingFactor(financials) {
  if (!financials) return false;
  const assetClass = financials.asset_class || financials.model_params?.assetClass;
  if (assetClass !== 'residential_apartments') return false;

  const stored = financials.model_params?.inputs?.loadingFactor;
  const raw = stored ?? financials.loading_factor;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0.45;
}

export function normalizeFinancials(financials) {
  if (!financials) return null;
  const mp = financials.model_params || {};
  const kpis = mp.kpis || {};
  const areas = mp.areas || {};
  const costs = mp.costs || {};
  const revenue = mp.revenue || {};
  const assetClass = financials.asset_class || 'residential_apartments';

  const cashFlowSeries = financials.cash_flows?.quarterly || [];
  const sm = financials.sensitivity_matrix || {};
  const inputsRaw = mp.inputs || {};
  // The deal record stores duration as projectDurationYears, but the kernel
  // and the what-if / tornado / scenario panels key on projectDurationMonths.
  // Backfill it so those controls anchor on the real duration instead of the
  // registry default. (The kernel's readMonths also accepts the years alias,
  // so this only corrects the front-end view-model.)
  const durationYears = Number(inputsRaw.projectDurationYears);
  const inputs = (inputsRaw.projectDurationMonths == null && Number.isFinite(durationYears))
    ? { ...inputsRaw, projectDurationMonths: durationYears * 12 }
    : inputsRaw;

  return {
    assetClass,
    kpis: {
      irr: toNumber(kpis.irr ?? financials.irr_pct),
      npv: toNumber(kpis.npv ?? financials.npv_cr),
      equityMultiple: toNumber(kpis.equityMultiple ?? financials.equity_multiple),
      rlv: toNumber(kpis.rlv ?? financials.residual_land_value_cr),
      grossMarginPct: toNumber(kpis.grossMarginPct ?? financials.gross_margin_pct),
      noi: toNumber(kpis.noi ?? financials.noi_cr),
      noiAtExit: toNumber(kpis.noiAtExit),
      yieldOnCost: toNumber(kpis.yieldOnCost ?? financials.yield_on_cost_pct),
      dscr: toNumber(kpis.dscr ?? financials.dscr),
      exitValue: toNumber(kpis.exitValue ?? financials.exit_value_cr),
      entryValue: toNumber(kpis.entryValue ?? financials.entry_value_cr),
      exitCapRate: toNumber(kpis.exitCapRate ?? inputsRaw.exitCapRate),
      terminalValue: toNumber(kpis.terminalValue ?? kpis.exitValue),
      terminalValuePV: toNumber(kpis.terminalValuePV),
      // NEVER fall back to the raw INPUT. Doing so laundered an analyst's
      // selection into a statement about what the model did: the kernel
      // capitalises NOI at the exit cap and nothing else, so a deal saved with
      // terminalValueMethod='forward_purchase' displayed a "Forward Purchase"
      // badge over a cap-rate valuation. The label may only ever describe the
      // computation that actually produced the number beside it.
      terminalValueMethod:
        kpis.terminalValueMethod
        || (toNumber(kpis.exitValue ?? financials.exit_value_cr) != null ? 'exit_cap_rate' : null),
      terminalValueFormula: kpis.terminalValueFormula || null,
      capRateValuationCr: toNumber(kpis.capRateValuationCr),
      revPAR: toNumber(kpis.revPAR),
      gopMargin: toNumber(kpis.gopMargin),
    },
    inputs,
    areas: {
      grossBuiltUp: toNumber(areas.grossBuiltUp ?? financials.gross_area_sqft),
      saleable: toNumber(areas.saleable ?? financials.saleable_area_sqft),
      carpet: toNumber(areas.carpet ?? financials.carpet_area_sqft),
      superBuiltUp: toNumber(areas.superBuiltUp ?? financials.super_builtup_area_sqft),
      leasable: toNumber(areas.leasable),
      keys: areas.keys,
      totalPlots: areas.totalPlots,
      avgPlotSizeSqft: toNumber(areas.avgPlotSizeSqft),
      numberOfUnits: toNumber(areas.numberOfUnits),
      residentialAvgUnitSize: toNumber(areas.avgUnitSizeSqft),
    },
    costs: {
      land: toNumber(costs.land ?? financials.land_cost_cr),
      construction: toNumber(costs.construction ?? financials.total_construction_cost_cr),
      gst: toNumber(costs.gst ?? financials.gst_cost_cr),
      stampDuty: toNumber(costs.stampDuty ?? financials.stamp_duty_cr),
      approval: toNumber(costs.approval ?? financials.approval_cost_cr),
      contingency: toNumber(costs.contingency),
      architecture: toNumber(costs.architecture),
      pmc: toNumber(costs.pmc),
      preOpening: toNumber(costs.preOpening),
      marketing: toNumber(costs.marketing ?? financials.marketing_cost_cr),
      finance: toNumber(costs.finance ?? financials.finance_cost_cr),
      tenantImprovements: toNumber(costs.tenantImprovements),
      leasingCommissions: toNumber(costs.leasingCommissions),
      total: toNumber(costs.total ?? financials.total_cost_cr),
    },
    revenue: {
      totalRevenue: toNumber(revenue.totalRevenueCr ?? financials.total_revenue_cr),
      profit: toNumber(revenue.grossProfitCr ?? financials.gross_profit_cr),
      margin: toNumber(revenue.grossMarginPct ?? financials.gross_margin_pct),
      annualNOI: toNumber(revenue.annualNOI ?? financials.noi_cr),
      stabilizedNOI: toNumber(revenue.stabilizedNOI ?? financials.stabilized_noi_cr),
      noiAtExit: toNumber(revenue.noiAtExit),
      exitValue: toNumber(revenue.exitValue ?? financials.exit_value_cr),
      terminalValue: toNumber(revenue.terminalValue ?? revenue.exitValue),
      terminalValuePV: toNumber(revenue.terminalValuePV),
      terminalValueMethod: revenue.terminalValueMethod || null,
      terminalValueFormula: revenue.terminalValueFormula || null,
      capRateValuationCr: toNumber(revenue.capRateValuationCr),
      roomsRevenue: toNumber(revenue.roomsRevenue),
      fbRevenue: toNumber(revenue.fbRevenue),
      gop: toNumber(revenue.gop),
      ebitda: toNumber(revenue.ebitda),
      usali_pnl: revenue.usali_pnl || null,
      usali_summary: revenue.usali_summary || null,
    },
    costsRaw: costs,
    capitalStack: mp.capitalStack || null,
    cashFlows: cashFlowSeries.map((cf, i) => ({ quarter: cf.quarter ?? i, value: toNumber(cf.net) ?? 0 })),
    yearlyCashFlows: (financials.cash_flows?.yearly || []).map((cf) => ({ year: cf.year, label: cf.label, value: toNumber(cf.net) ?? 0 })),
    proforma: mp.proforma || null,
    sensitivity: {
      sellingRates: sm.sellingRates || [],
      constructionCosts: sm.constructionCosts || [],
      grid: sm.irrGrid || [],
      axis: sm.axis || ['Constr. Cost', 'Selling Rate'],
    },
  };
}
