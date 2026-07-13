'use strict';

/**
 * REDIP Financial Engine — kernel-native service adapter.
 *
 * Single entry point for the backend service layer. Replaces the 2,767-line
 * `financial.engine.js` by composing the TypeScript kernel (`@redip/financial-kernel`)
 * with its legacy-shape post-processors into the `{ kpis, areas, costs,
 * revenue, capitalStack, cashFlows, sensitivityMatrix, _legacy, inputs }`
 * bundle that `financial.service.js` has persisted since Phase 1.
 *
 *   computeFullFinancials(input)  → legacy-compatible result
 *   computeScenarios(input)       → { base, bull, bear } bundle
 *
 * All determinism comes from the kernel. This module does three jobs:
 *
 *   1. Flatten the kernel's Decimal-typed KPI/Cost/Revenue blocks to the
 *      number-typed camelCase keys the backend service + frontend readers
 *      expect (e.g. `costs.landCr` → `costs.land`, `areas.grossBuiltUpSqft`
 *      → `areas.grossBuiltUp`).
 *   2. Dispatch the right capital-stack builder per asset class, including
 *      a hospitality-specific synthesis of the construction→permanent
 *      refinancing + European 4-tier waterfall that the kernel's
 *      post-processors accept as inputs.
 *   3. Wrap `buildCashFlows`, `buildSensitivityMatrix`, `buildLegacyShape`,
 *      and `buildScenarios` so downstream consumers keep their shape.
 *
 * Rounding matches legacy: `round4` (4dp) for money / percent / KPI and
 * `round2` (2dp) for areas and ratio metrics. Changes here surface as DB
 * column regressions — see `docs/LEGACY_SHAPE_AUDIT.md`.
 */

const kernel = require('../../../packages/financial-kernel/dist');
const orchestration = require('../../../packages/financial-kernel/dist/orchestration');

const {
  computeDeal,
  buildCashFlows,
  buildSensitivityMatrix,
  buildLegacyShape,
  buildConstructionLoanCapitalStack,
  buildIncomeAmortizingCapitalStack,
  buildHospitalityCapitalStack,
  buildHospitalityWaterfall,
  buildScenarios,
  buildAmortizingSchedule,
  buildQuarterlyProforma,
  monthlyToQuarterly,
} = kernel;

const { FinancialGraph } = orchestration;
const { applyJdaStructureAdjustment } = require('../utils/jdaStructure');

// ── Rounding helpers (byte-compatible with financial.engine.js) ─────────────

const round4 = (n) =>
  n != null && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;

const round2 = (n) =>
  n != null && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;

const toNum = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && typeof v.toNumber === 'function') {
    const n = v.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const numOr = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const CRORE = 1e7;

// ── Asset-class family membership ───────────────────────────────────────────

const RESIDENTIAL_FAMILY = new Set(['residential_apartments', 'villas', 'redevelopment', 'mixed_use']);
const INCOME_FAMILY = new Set(['commercial_office', 'retail', 'industrial_warehousing']);

// ── Flatteners: Decimal-typed kernel blocks → legacy camelCase shape ────────

/**
 * Convert a kernel `CostBreakdown` (Decimal-typed, `*Cr` suffixed) into the
 * flat number-keyed shape the backend service persists and the frontend
 * reads. Values are rounded identically to the legacy engine: money to 4dp.
 */
function flattenCosts(k) {
  return {
    land:               round4(toNum(k.landCr)),
    construction:       round4(toNum(k.constructionCr)),
    gst:                round4(toNum(k.gstCr)),
    contingency:        round4(toNum(k.contingencyCr)),
    stampDuty:          round4(toNum(k.stampDutyCr)),
    approval:           round4(toNum(k.approvalCr)),
    architecture:       round4(toNum(k.architectureCr)),
    pmc:                round4(toNum(k.pmcCr)),
    marketing:          round4(toNum(k.marketingCr)),
    finance:            round4(toNum(k.financeCr)),
    hardCostTotal:      round4(toNum(k.hardCostTotalCr)),
    softCostTotal:      round4(toNum(k.softCostTotalCr)),
    total:              round4(toNum(k.totalCr)),
    tenantImprovements: round4(toNum(k.extras?.tenantImprovementsCr)),
    leasingCommissions: round4(toNum(k.extras?.leasingCommissionsCr)),
  };
}

/**
 * Convert a kernel `AreaBreakdown` into the backend's camelCase area keys.
 * Areas are rounded to 2dp (legacy parity). Asset-specific extras
 * (`numberOfUnits`, `avgUnitSizeSqft`, `totalPlots`, `avgPlotSizeSqft`) are
 * passed through untouched — they originate in `areas.extras` on the kernel side.
 */
function flattenAreas(k) {
  const extras = k.extras || {};
  return {
    grossBuiltUp:   round2(k.grossBuiltUpSqft),
    saleable:       round2(k.saleableSqft),
    carpet:         round2(k.carpetSqft),
    superBuiltUp:   round2(k.superBuiltUpSqft),
    leasable:       round2(k.leasableSqft),
    numberOfUnits:  extras.numberOfUnits ?? null,
    avgUnitSizeSqft: extras.avgUnitSizeSqft ?? null,
    totalPlots:     extras.totalPlots ?? null,
    avgPlotSizeSqft: extras.avgPlotSizeSqft != null ? round2(extras.avgPlotSizeSqft) : null,
  };
}

/**
 * Convert a kernel `RevenueBreakdown` into the flat camelCase shape. The
 * kernel's `stabilizedNOICr` is surfaced as both `annualNOI` and
 * `stabilizedNOI` so existing UI readers (which may key on either) stay
 * green. Extras are passed through for asset-class-specific fields
 * (`exitValue`, `revPAR`, `gop`, etc.).
 */
// Non-numeric pass-through keys on revenue.extras. These hold structured
// payloads (USALI P&L row arrays, stabilised summary objects) rather than
// Decimals, so they must bypass numeric coercion and be re-keyed to the
// snake_case shape the frontend reads.
const REVENUE_PASSTHROUGH_KEYS = {
  usaliPnl: 'usali_pnl',
  usaliSummary: 'usali_summary',
};

function flattenRevenue(k) {
  const extras = k.extras || {};
  const out = {
    totalRevenueCr: round4(toNum(k.totalRevenueCr)),
    grossProfitCr:  round4(toNum(k.grossProfitCr)),
    grossMarginPct: round4(k.grossMarginPct),
    annualNOI:      round4(toNum(k.stabilizedNOICr)),
    stabilizedNOI:  round4(toNum(k.stabilizedNOICr)),
    exitValue:      round4(toNum(k.exitValueCr)),
  };
  for (const [name, val] of Object.entries(extras)) {
    const snakeKey = REVENUE_PASSTHROUGH_KEYS[name];
    if (snakeKey) {
      if (out[snakeKey] === undefined) out[snakeKey] = val ?? null;
      continue;
    }
    if (out[name] !== undefined) continue;
    out[name] = round4(toNum(val));
  }
  return out;
}

/**
 * Convert a kernel `KPISet` into the backend's flat KPI map. The kernel's
 * asset-specific extras (IRR-style: `revenuePerSqft`, `noi`, `exitValue`,
 * `dscr`, etc.) land alongside the canonical six (irr, npv, margin,
 * equityMultiple, rlv, moic) so reports don't have to hunt through `extras`.
 */
function flattenKpis(k) {
  const extras = k.extras || {};
  const base = {
    irr:           round4(k.irr),
    npv:           round4(toNum(k.npv)),
    equityMultiple: round4(k.equityMultiple),
    rlv:           round4(toNum(k.residualLandValue)),
    grossMarginPct: round4(k.grossMarginPct),
  };
  for (const [name, val] of Object.entries(extras)) {
    if (base[name] !== undefined) continue;
    base[name] = typeof val === 'number' ? round4(val) : val;
  }
  return base;
}

// ── Capital-stack synthesis ─────────────────────────────────────────────────

/**
 * Construction-loan stack for for-sale assets (residential, villas,
 * plotted, redevelopment, mixed-use). Returns `null` when no debt is used.
 */
function buildConstructionLoanStack(raw, result) {
  const financing = result.financing;
  if (!financing || financing.debtLTV <= 0) return null;

  const totalCostCr = toNum(result.costs.totalCr);
  const debtDrawnCr = toNum(financing.debtDrawn);
  const debtInterestCr = toNum(financing.debtInterest);

  return buildConstructionLoanCapitalStack({
    totalCostCr,
    debtDrawnCr,
    debtInterestCr,
    debtLTV: financing.debtLTV,
    debtRatePct: financing.debtRatePct,
    debtTenorYears: numOr(raw.debtTenorYears) > 0 ? numOr(raw.debtTenorYears) : null,
  });
}

/**
 * Amortizing stack for income assets (office, retail, industrial). DSCR
 * comes from the kernel's `kpis.extras.dscr`; debt schedule is the simple
 * bullet-style summary legacy emits.
 */
function buildIncomeStack(raw, result) {
  const financing = result.financing;
  if (!financing || financing.debtLTV <= 0) return null;

  const totalCostCr = toNum(result.costs.totalCr);
  const debtCoverage = financing.debtLTV;
  const interestRatePct = financing.debtRatePct;
  const amortizationYears = numOr(financing.amortizationYears, numOr(raw.amortizationYears, 15));
  const dscr = result.kpis.extras?.dscr ?? null;

  const debtSchedule = {
    principalCr: round4(toNum(financing.debtDrawn)),
    annualRatePct: interestRatePct,
    amortizationYears,
    totalInterestCr: round4(toNum(financing.debtInterest)),
  };

  return buildIncomeAmortizingCapitalStack({
    totalCostCr,
    debtCoverage,
    interestRatePct,
    amortizationYears,
    dscr,
    debtSchedule,
  });
}

/**
 * Hospitality capital stack — construction-to-permanent refinancing
 * + European 4-tier waterfall. Always non-null (zero-debt hotels still
 * render a stack with debtPct=0 / equityPct=100 so UI is stable).
 *
 * Ports `financial.engine.js:1755-2164` inline because the kernel does not
 * (yet) surface the refi/waterfall intermediates from
 * `computeHospitality`. The math uses the kernel's `buildAmortizingSchedule`
 * for the permanent loan so draws/balances/interest match the debt engine
 * exactly, and the kernel's `buildHospitalityWaterfall` for the LP/GP split.
 */
function buildHospitalityStack(raw, result) {
  const costs = result.costs;
  const totalDevCostCr = toNum(costs.totalCr);
  const stabilizedNOICr = toNum(result.revenue.stabilizedNOICr);
  const financing = result.financing;

  // Capital-stack inputs (user-settable, with legacy defaults)
  const constLoanLTC = Math.min(0.80, Math.max(0, numOr(raw.constLoanLTC, 0.55)));
  const constLoanRatePct = numOr(raw.constLoanRatePct, 10.5);
  const constLoanFeesPct = numOr(raw.constLoanFeesPct, 1.0);
  const refiLTV = Math.min(0.70, Math.max(0, numOr(raw.refiLTV, 0.55)));
  const refiCapRate = numOr(raw.refiCapRatePct, 8.5);
  const refiInterestRate = numOr(raw.refiInterestRatePct, 9.25);
  const refiIOYears = Math.max(0, numOr(raw.refiIOYears, 2));
  const refiAmortYears = Math.max(10, Math.min(30, numOr(raw.refiAmortYears, 20)));

  const holdPeriodYears = Math.max(5, numOr(raw.holdPeriodYears, numOr(raw.holdYears, 10)));
  const stabilizationYear = Math.min(holdPeriodYears - 1, numOr(raw.stabilizationYear, 3));
  const refiYear = Math.max(
    stabilizationYear,
    Math.min(holdPeriodYears - 1, numOr(raw.refiYear, stabilizationYear)),
  );

  const constructionMonths = result.period.totalMonths - (holdPeriodYears * 12);
  const constQ = Math.max(1, Math.ceil(Math.max(constructionMonths, 1) / 3));
  const totalQ = constQ + holdPeriodYears * 4;

  // Debt principal: kernel's `financing.debtDrawn` already reflects the
  // construction-loan sizing (`debtableBase × min(debtLTV, debtLTC)`);
  // fall back to the legacy formula if financing is null.
  const finalConstDebtCr = financing && toNum(financing.debtDrawn) > 0
    ? toNum(financing.debtDrawn)
    : totalDevCostCr * constLoanLTC;
  const equityCr = Math.max(0, totalDevCostCr - finalConstDebtCr);

  // IDC already rolled into `costs.financeCr`; expose it for the construction phase.
  const idcCr = toNum(costs.financeCr) ?? 0;

  // Construction-loan schedule (P&I to refi date)
  const constLoanSched = finalConstDebtCr > 0 ? buildAmortizingSchedule({
    principalCr: finalConstDebtCr,
    annualRatePct: constLoanRatePct,
    amortizationYears: Math.max(2, refiYear),
    drawQ: constQ,
    operatingStartQ: constQ + 1,
    exitQ: constQ + refiYear * 4,
    totalQuarters: totalQ,
  }) : null;

  // Permanent refinance sized off stabilized NOI / going-in cap × LTV
  const stabilizedValueForRefi = refiCapRate > 0 ? (stabilizedNOICr ?? 0) / (refiCapRate / 100) : 0;
  const refiPrincipalCr = stabilizedValueForRefi * refiLTV;
  const refiQ = Math.min(totalQ, constQ + refiYear * 4);
  const refiSched = refiPrincipalCr > 0 ? buildAmortizingSchedule({
    principalCr: refiPrincipalCr,
    annualRatePct: refiInterestRate,
    amortizationYears: refiAmortYears,
    drawQ: refiQ,
    operatingStartQ: refiQ + refiIOYears * 4 + 1,
    exitQ: totalQ,
    totalQuarters: totalQ,
  }) : null;

  // DSCR / debt yield (stabilised)
  let dscr = null;
  let minDSCR = null;
  let debtYieldPct = null;
  if (refiSched && refiSched.quarterlyPayment > 0 && stabilizedNOICr > 0) {
    const annDS = refiSched.quarterlyPayment * 4;
    dscr = round2(stabilizedNOICr / annDS);
    debtYieldPct = refiPrincipalCr > 0 ? round2((stabilizedNOICr / refiPrincipalCr) * 100) : null;
    // Legacy min-DSCR walks annualNOI / annDS; with just stabilised NOI
    // we get the same number. Kept explicit for future per-year ramp.
    minDSCR = dscr;
  } else if (constLoanSched && constLoanSched.quarterlyPayment > 0 && stabilizedNOICr > 0) {
    dscr = round2(stabilizedNOICr / (constLoanSched.quarterlyPayment * 4));
  }

  // Back-compat debt-schedule summary wrapper
  const debtScheduleHosp = (constLoanSched || refiSched) ? {
    termLoan: constLoanSched ? {
      principalCr: round4(finalConstDebtCr),
      annualRatePct: constLoanRatePct,
      amortizationYears: refiYear,
      quarterlyPaymentCr: round4(constLoanSched.quarterlyPayment),
      annualDebtServiceCr: round4(constLoanSched.quarterlyPayment * 4),
      totalInterestCr: round4(constLoanSched.totalInterestCr),
      balloonRepaymentCr: round4(constLoanSched.balloonRepaymentCr),
    } : null,
    lrd: refiSched ? {
      principalCr: round4(refiPrincipalCr),
      annualRatePct: refiInterestRate,
      amortizationYears: refiAmortYears,
      quarterlyPaymentCr: round4(refiSched.quarterlyPayment),
      annualDebtServiceCr: round4(refiSched.quarterlyPayment * 4),
      totalInterestCr: round4(refiSched.totalInterestCr),
      balloonRepaymentCr: round4(refiSched.balloonRepaymentCr),
      refinanceQuarter: refiQ,
    } : null,
  } : null;

  // Waterfall inputs: levered quarterly cash flow (construction outflows
  // netted against NOI inflows + refi proceeds + exit balloon).
  const netMonthly = result.cashFlow.net;
  const quarterlyCfsDec = monthlyToQuarterly(netMonthly);
  const quarterlyCfs = quarterlyCfsDec.map((d) => toNum(d) ?? 0);

  const waterfall = buildHospitalityWaterfall({
    equityCr,
    cashFlows: quarterlyCfs,
    holdPeriodYears,
    constQ,
    lpPct: numOr(raw.lpPct, 0.90),
    gpPct: numOr(raw.gpPct, 0.10),
    tier2Hurdle: numOr(raw.tier2HurdlePct, 10),
    tier3Hurdle: numOr(raw.tier3HurdlePct, 15),
    tier4Hurdle: numOr(raw.tier4HurdlePct, 20),
    tier2PromotePct: numOr(raw.tier2PromotePct, 10),
    tier3PromotePct: numOr(raw.tier3PromotePct, 20),
    tier4PromotePct: numOr(raw.tier4PromotePct, 30),
  });

  const lpEquityMultiple = equityCr > 0 && waterfall.totalLPCr != null
    ? round4(waterfall.totalLPCr / (equityCr * numOr(raw.lpPct, 0.90)))
    : null;
  const gpEquityMultiple = equityCr > 0 && waterfall.totalGPCr != null
    ? round4(waterfall.totalGPCr / (equityCr * numOr(raw.gpPct, 0.10)))
    : null;
  waterfall.lpEquityMultiple = lpEquityMultiple;
  waterfall.gpEquityMultiple = gpEquityMultiple;

  return buildHospitalityCapitalStack({
    totalCostCr: totalDevCostCr,
    finalConstDebtCr,
    equityCr,
    interestRatePct: constLoanRatePct,
    amortizationYearsHosp: refiAmortYears,
    dscr: dscr ?? 0,
    minDSCR,
    debtYieldPct,
    debtScheduleHosp,
    construction: constLoanSched ? {
      finalConstDebtCr,
      constLoanLTC,
      constLoanRatePct,
      constLoanFeesPct,
      idcCr,
      refiYear,
    } : null,
    permanent: refiSched ? {
      refiPrincipalCr,
      refiLTV,
      refiInterestRate,
      refiIOYears,
      refiAmortYears,
      refiYear,
      refiCapRate,
      stabilizedValueForRefi,
      refiQuarterlyPayment: refiSched.quarterlyPayment,
      refiTotalInterestCr: refiSched.totalInterestCr,
      refiBalloonRepaymentCr: refiSched.balloonRepaymentCr,
    } : null,
    waterfall,
  });
}

/** Dispatch to the right capital-stack builder for the deal's asset class. */
function buildCapitalStack(assetClass, raw, result) {
  if (assetClass === 'hospitality') return buildHospitalityStack(raw, result);
  if (INCOME_FAMILY.has(assetClass)) return buildIncomeStack(raw, result);
  if (RESIDENTIAL_FAMILY.has(assetClass) || assetClass === 'plotted_development') {
    return buildConstructionLoanStack(raw, result);
  }
  return null; // land_parcel
}

// ── Cash-flow bundle ────────────────────────────────────────────────────────

function buildQuarterlyCashFlows(result) {
  const monthly = result.cashFlow.net;
  const quarterlyDec = monthlyToQuarterly(monthly);
  const quarterlyNums = quarterlyDec.map((d) => toNum(d) ?? 0);
  return buildCashFlows(quarterlyNums, {
    effectiveDate: result.period.effectiveDate,
  });
}

// ── Provenance graph ────────────────────────────────────────────────────────

/**
 * Build a dependency DAG of every computation in a deal run. The graph is
 * off the hot path — constructed from the already-computed kernel result,
 * so it never affects math. Consumers (MethodologyExplorer, IC decks,
 * audit replay) use it to answer:
 *   - "What inputs feed this KPI?"   (upstream)
 *   - "What downstream breaks if I change X?"  (downstream)
 *   - "Show the full derivation chain for insights."  (snapshot)
 *
 * Node IDs are stable: `input.*`, `cost.*`, `revenue.*`, `kpi.*`, `output.*`.
 * Values carry the exact rounded number the UI renders, so hovering a node
 * in a DAG view shows the same figure as the KPI card.
 */
function buildFinancialGraph(assetClass, raw, result, flatKpis, flatCosts, flatRevenue, capitalStack) {
  const g = new FinancialGraph();
  const isIncomeFamily = INCOME_FAMILY.has(assetClass);
  const isHosp = assetClass === 'hospitality';
  const isLand = assetClass === 'land_parcel';

  // ── Inputs ────────────────────────────────────────────────────────────────
  g.addInput('input.land.area', 'Plot area', numOr(raw.plotAreaSqft), 'sqft');
  g.addInput('input.land.rate', 'Land rate',
    numOr(raw.landRatePerSqft, numOr(raw.landCostPerSqft)), 'INR/sqft');
  if (!isLand) {
    g.addInput('input.area.grossBuiltUp', 'Gross built-up area', flatKpis ? null : null, 'sqft');
    g.addInput('input.construction.hardCost', 'Hard cost per sqft',
      numOr(raw.hardCostPerSqft, numOr(raw.constructionCostPerSqft)), 'INR/sqft');
    g.addInput('input.construction.softCostPct', 'Soft cost % of hard',
      numOr(raw.softCostPct, 15), '%');
  }
  g.addInput('input.finance.debtLTV', 'Debt LTV',
    numOr(raw.debtLTV, numOr(raw.debtLTC, 0.55)), 'ratio');
  g.addInput('input.finance.debtRate', 'Debt rate',
    numOr(raw.debtRatePct, 10.5), '%');
  g.addInput('input.finance.equityIRR', 'Equity hurdle',
    numOr(raw.equityIRRHurdlePct, numOr(raw.targetIRRPct, 18)), '%');
  g.addInput('input.timing.months', 'Project duration',
    numOr(raw.projectDurationMonths, numOr(raw.totalMonths)), 'months');
  if (isHosp) {
    g.addInput('input.hotel.keys', 'Number of keys', numOr(raw.numberOfKeys), 'keys');
    g.addInput('input.hotel.adr', 'Stabilised ADR', numOr(raw.adr), 'INR');
    g.addInput('input.hotel.occupancy', 'Stabilised occupancy',
      numOr(raw.stabilizedOccupancyPct, numOr(raw.occupancyPct, 72)), '%');
  }
  if (isIncomeFamily) {
    g.addInput('input.income.leaseRate', 'Lease rate',
      numOr(raw.leaseRatePerSqftPerMonth, numOr(raw.rentPerSqftPerMonth)), 'INR/sqft/mo');
    g.addInput('input.income.exitCapRate', 'Exit cap rate',
      numOr(raw.exitCapRatePct, 8.5), '%');
  }
  if (!isIncomeFamily && !isLand && !isHosp) {
    g.addInput('input.sales.pricePerSqft', 'Selling price per sqft',
      numOr(raw.sellingPricePerSqft), 'INR/sqft');
  }
  if (assetClass === 'plotted_development') {
    g.addInput('input.plots.pricePerSqft', 'Plot sale rate',
      numOr(raw.plotSaleRatePerSqft, numOr(raw.sellingPricePerSqft)), 'INR/sqft');
  }

  // ── Computations ──────────────────────────────────────────────────────────
  g.addComputation('cost.land', 'Land cost',
    ['input.land.area', 'input.land.rate'],
    flatCosts.land, 'Cr');
  if (!isLand) {
    g.addComputation('cost.construction', 'Hard construction cost',
      ['input.area.grossBuiltUp', 'input.construction.hardCost'],
      flatCosts.construction, 'Cr');
    g.addComputation('cost.softCosts', 'Soft costs (design + approvals + PMC + marketing)',
      ['cost.construction', 'input.construction.softCostPct'],
      flatCosts.softCostTotal, 'Cr');
    g.addComputation('cost.finance', 'Interest during construction',
      ['cost.land', 'cost.construction', 'input.finance.debtLTV', 'input.finance.debtRate', 'input.timing.months'],
      flatCosts.finance, 'Cr');
  }
  g.addComputation('cost.total', 'Total project cost',
    isLand ? ['cost.land']
           : ['cost.land', 'cost.construction', 'cost.softCosts', 'cost.finance'],
    flatCosts.total, 'Cr');

  if (isHosp) {
    g.addComputation('revenue.operating', 'Stabilised room revenue',
      ['input.hotel.keys', 'input.hotel.adr', 'input.hotel.occupancy'],
      flatRevenue.totalRevenueCr, 'Cr');
    g.addComputation('revenue.noi', 'Stabilised NOI',
      ['revenue.operating', 'cost.total'],
      flatRevenue.stabilizedNOI, 'Cr');
    g.addComputation('revenue.total', 'Total revenue (hold-period)',
      ['revenue.operating', 'input.timing.months'],
      flatRevenue.totalRevenueCr, 'Cr');
  } else if (isIncomeFamily) {
    g.addComputation('revenue.operating', 'Stabilised NOI',
      ['input.area.grossBuiltUp', 'input.income.leaseRate'],
      flatRevenue.stabilizedNOI, 'Cr');
    g.addComputation('revenue.exitValue', 'Exit value',
      ['revenue.operating', 'input.income.exitCapRate'],
      flatRevenue.exitValue, 'Cr');
    g.addComputation('revenue.total', 'Total revenue (NOI + exit)',
      ['revenue.operating', 'revenue.exitValue'],
      flatRevenue.totalRevenueCr, 'Cr');
  } else if (isLand) {
    g.addComputation('revenue.total', 'Land residual value',
      ['cost.land'],
      flatRevenue.totalRevenueCr, 'Cr');
  } else {
    g.addComputation('revenue.total', 'Total sale revenue',
      ['input.area.grossBuiltUp', 'input.sales.pricePerSqft'],
      flatRevenue.totalRevenueCr, 'Cr');
  }

  g.addComputation('kpi.grossProfit', 'Gross profit (revenue − cost)',
    ['revenue.total', 'cost.total'],
    flatRevenue.grossProfitCr, 'Cr');
  g.addComputation('kpi.grossMargin', 'Gross margin',
    ['kpi.grossProfit', 'revenue.total'],
    flatKpis.grossMarginPct, '%');
  g.addComputation('cashFlows', 'Quarterly levered cash flows',
    isLand
      ? ['cost.total', 'revenue.total', 'input.timing.months']
      : ['cost.total', 'revenue.total', 'input.finance.debtLTV', 'input.timing.months'],
    null, 'Cr/q');
  g.addComputation('kpi.irr', 'Project IRR',
    ['cashFlows'],
    flatKpis.irr, '%');
  g.addComputation('kpi.npv', 'NPV at equity hurdle',
    ['cashFlows', 'input.finance.equityIRR'],
    flatKpis.npv, 'Cr');
  g.addComputation('kpi.rlv', 'Residual land value',
    isLand ? ['revenue.total']
           : ['revenue.total', 'cost.construction', 'cost.softCosts', 'cost.finance', 'input.finance.equityIRR'],
    flatKpis.rlv, 'Cr');
  g.addComputation('kpi.equityMultiple', 'Equity multiple',
    ['cashFlows', 'input.finance.debtLTV'],
    flatKpis.equityMultiple, 'x');

  if (capitalStack) {
    const stackDeps = ['cost.total', 'input.finance.debtLTV', 'input.finance.debtRate'];
    if (isHosp) stackDeps.push('revenue.noi');
    if (isIncomeFamily) stackDeps.push('revenue.operating');
    g.addComputation('capitalStack', 'Capital stack (debt + equity)',
      stackDeps, null, '');
  }

  // ── Outputs ───────────────────────────────────────────────────────────────
  g.addOutput('output.totalCost', 'Total cost', ['cost.total'], flatCosts.total, 'Cr');
  g.addOutput('output.revenue', 'Revenue', ['revenue.total'], flatRevenue.totalRevenueCr, 'Cr');
  g.addOutput('output.irr', 'IRR', ['kpi.irr'], flatKpis.irr, '%');
  g.addOutput('output.npv', 'NPV', ['kpi.npv'], flatKpis.npv, 'Cr');
  g.addOutput('output.rlv', 'Residual land value', ['kpi.rlv'], flatKpis.rlv, 'Cr');
  g.addOutput('output.equityMultiple', 'Equity multiple',
    ['kpi.equityMultiple'], flatKpis.equityMultiple, 'x');
  g.addOutput('output.grossMargin', 'Gross margin',
    ['kpi.grossMargin'], flatKpis.grossMarginPct, '%');
  if (capitalStack) {
    g.addOutput('output.capitalStack', 'Capital stack',
      ['capitalStack'], null, '');
  }

  // Snapshot — flatten Decimal values to numbers for JSON serialisation.
  const snap = g.snapshot();
  const nodes = snap.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    dependsOn: n.dependsOn,
    value: typeof n.value === 'object' && n.value && typeof n.value.toNumber === 'function'
      ? toNum(n.value)
      : n.value ?? null,
    unit: n.unit || null,
  }));
  return {
    nodes,
    edges: snap.edges.map((e) => ({ from: e.from, to: e.to })),
    nodeCount: nodes.length,
    edgeCount: snap.edges.length,
    assetClass,
    engineVersion: 'kernel-v2',
    generatedAt: new Date().toISOString(),
  };
}

// ── Public entry points ─────────────────────────────────────────────────────

/**
 * Compute the full legacy-compatible financial bundle for a deal. Accepts
 * the same flat input shape (`{ assetClass, plotAreaSqft, ... }`) that
 * the old `calculateFullFinancials` consumed; the kernel normalizes
 * units, fills defaults from `GLOBAL_DEFAULTS` / `ASSET_DEFAULTS`, and
 * dispatches to the correct asset-class adapter internally.
 *
 * Never throws `DealInputError` up to the service layer — instead,
 * missing required fields surface as an `Error` with the kernel's
 * aggregated field-error list in the message.
 */
function computeFullFinancials(input) {
  const assetClass = input.assetClass || 'residential_apartments';
  // Kernel expects `{ assetClass, raw }`. The backend passes a flat object —
  // map it to the kernel's nested shape and forward `currency` if present.
  const { assetClass: _ac, ...raw } = input;
  void _ac;

  // JDA / development-management structure adjustment (land contributed → 0,
  // revenue net of the landowner share). Applied to the KERNEL input so EVERY
  // derivation (result, legacy, capital stack, sensitivity, graph) is
  // structure-correct. The UNTRANSFORMED operator inputs are echoed in `.inputs`
  // below for the app form; `structureAdjustment` records what changed (null
  // when the deal is not a JDA — the common case, zero overhead).
  const { input: kraw, adjustment: structureAdjustment } = applyJdaStructureAdjustment(raw);

  let result;
  try {
    result = computeDeal({ assetClass, raw: kraw });
  } catch (err) {
    if (err && err.name === 'DealInputError') {
      throw new Error(`Financial kernel input error: ${err.message}`);
    }
    throw err;
  }

  const flatCosts = flattenCosts(result.costs);
  const flatAreas = flattenAreas(result.areas);
  const flatRevenue = flattenRevenue(result.revenue);
  const flatKpis = flattenKpis(result.kpis);

  const legacyShape = buildLegacyShape({ raw: kraw, result, assetClass });
  const capitalStack = buildCapitalStack(assetClass, kraw, result);
  const cashFlows = buildQuarterlyCashFlows(result);
  const proforma = input.skipProforma ? null : buildQuarterlyProforma(result);
  const sensitivityMatrix = input.skipSensitivity
    ? null
    : buildSensitivityMatrix({ raw: kraw, assetClass });
  const financialGraph = input.skipGraph
    ? null
    : buildFinancialGraph(assetClass, kraw, result, flatKpis, flatCosts, flatRevenue, capitalStack);

  return {
    assetClass,
    inputs: { ...raw, assetClass },
    structureAdjustment,
    kpis: flatKpis,
    areas: flatAreas,
    costs: flatCosts,
    revenue: flatRevenue,
    capitalStack,
    cashFlows,
    proforma,
    sensitivityMatrix,
    financialGraph,
    // Kernel canonical block preserved for provenance / debug surfaces.
    kernel: {
      kpis: result.kpis,
      areas: result.areas,
      costs: result.costs,
      revenue: result.revenue,
      financing: result.financing,
      cashFlow: result.cashFlow,
      provenance: result.provenance,
    },
    engineVersion: 'kernel-v2',
    _legacy: legacyShape,
  };
}

/**
 * Compute base / bull / bear scenarios for a deal. Uses the kernel's
 * `buildScenarios` for deterministic shock application and attaches a
 * scenario-specific capital stack so the `ScenarioComparison` UI has a
 * full readout per cell.
 */
function computeScenarios(input) {
  const assetClass = input.assetClass || 'residential_apartments';
  const { assetClass: _ac, ...raw } = input;
  void _ac;

  // Same JDA structure adjustment as computeFullFinancials — scenarios must be
  // shocked around the structure-correct base, not the full-land base.
  const { input: kraw } = applyJdaStructureAdjustment(raw);

  const bundle = buildScenarios({
    raw: kraw,
    assetClass,
    capitalStackFor: (perturbedRaw, result) =>
      buildCapitalStack(assetClass, perturbedRaw, result),
  });

  // Legacy-shape adapter: flatten Decimal-typed KPI/Cost/Revenue blocks so
  // the frontend ScenarioComparison.jsx keeps its existing reader shape.
  const out = {};
  for (const key of ['base', 'bull', 'bear']) {
    const cell = bundle[key];
    if (!cell) continue;
    if (cell.error || !cell.kpis) {
      out[key] = {
        label: cell.label,
        color: cell.color,
        adjustments: cell.adjustments,
        error: cell.error || 'scenario compute failed',
        kpis: null,
        costs: null,
        revenue: null,
      };
      continue;
    }
    out[key] = {
      label: cell.label,
      color: cell.color,
      adjustments: cell.adjustments,
      kpis: flattenKpis(cell.kpis),
      costs: flattenCosts(cell.costs),
      revenue: flattenRevenue(cell.revenue),
      capitalStack: cell.capitalStack,
    };
  }
  return out;
}

/**
 * Residential-style sensitivity matrix — entry point for the dedicated
 * `POST /deals/:id/sensitivity` route. Accepts the same flat input shape
 * as `computeFullFinancials` and delegates to the kernel dispatcher.
 */
function buildSensitivityMatrixFor(input) {
  const assetClass = input.assetClass || 'residential_apartments';
  const { assetClass: _ac, ...raw } = input;
  void _ac;
  return buildSensitivityMatrix({ raw, assetClass });
}

module.exports = {
  computeFullFinancials,
  computeScenarios,
  buildSensitivityMatrix: buildSensitivityMatrixFor,
};
