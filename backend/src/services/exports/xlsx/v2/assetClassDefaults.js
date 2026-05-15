'use strict';

/**
 * Asset-class defaults library (PR-NX6 — 2026-05-15)
 *
 * Bengaluru-priority, India-context default values per asset class for
 * fields the financial kernel does NOT cover. Consumed by
 * resolveEngineAssumptions() in buildWorkbook.js: layered INTO
 * ctx.engineAssumptions BEFORE the kernel's resolveAssumptions output,
 * so the precedence chain is:
 *
 *   1. ctx.inputs.X                       (operator-entered)
 *   2. ctx.engineAssumptions.X            (kernel resolveAssumptions OR
 *                                          our asset-class default —
 *                                          kernel wins where it has a value)
 *   3. hardcoded fallback at the call site
 *
 * ## Scope policy
 *
 * The kernel ALREADY publishes a rich set of asset-class defaults for:
 * stampDutyPct, registrationPct, gstOnConstructionPct, marketingCostPct,
 * financeCostPct, developerMarginPct, discountRatePct, loadingFactor,
 * carpetRatio, vacancyPct, rentEscalationPct, exitCapRatePct,
 * holdPeriodYears, propertyTaxPctOfRevenue, rentPerSqftPerMonth, etc.
 *
 * This file fills the GAPS the kernel doesn't cover — area, land cost,
 * construction cost, debt structure, RERA collection, asset-class-specific
 * operating inputs (hospitality keys/ADR, retail anchor split, mixed-use
 * components, raw-land pipeline). It does NOT redefine the keys the
 * kernel already publishes, so test assertions on kernel defaults keep
 * working.
 *
 * ## Source attribution
 *
 * Bengaluru market values (2026) cross-referenced from:
 * - Cushman & Wakefield India quarterly reports (rents, cap rates)
 * - JLL India MarketBeat (vacancy, absorption)
 * - Knight Frank Wealth Report (luxury / villa)
 * - Hospitality Valuation Services India (ADR / occupancy / USALI)
 * - RBI Master Direction on Real Estate (Sep 2023) — debt benchmarks
 * - Karnataka Stamp Act 1957 + BBMP Property Tax Rules 2009
 *
 * Operators can always override any default via deal.model_params.inputs.
 */

// Hold / build periods (months) — operator-typed expectation.
const HOLD_MONTHS = {
  income_5yr: 60,
  income_long: 168, // 14yr (hospitality)
  dev_short: 24,    // plotted / villas
  dev_mid: 36,      // residential
  dev_long: 48,     // mixed-use / redevelopment
};

const ASSET_CLASS_DEFAULTS = Object.freeze({
  // ── Development family ────────────────────────────────────────────
  residential_apartments: {
    saleableAreaSqft: 350000,
    sellingRatePerSqft: 9500,
    landCostCr: 65,
    constructionCostPerSqft: 4500,
    approvalCostCr: 8,
    salesVelocityPct: 0.16,
    salesLagQuarters: 2,
    constructionLagQuarters: 1,
    customerCollectionPct: 0.85,
    debtLTV: 0.55,
    debtRatePct: 0.115,
    loanTermYears: 5,
    moratoriumMonths: 12,
    projectDurationMonths: HOLD_MONTHS.dev_long,
    propertyTaxPerSqftYr: 30,
  },

  villas: {
    saleableAreaSqft: 180000,
    sellingRatePerSqft: 16000,
    landCostCr: 90,
    constructionCostPerSqft: 5500,
    approvalCostCr: 5,
    salesVelocityPct: 0.20,
    salesLagQuarters: 1,
    constructionLagQuarters: 1,
    customerCollectionPct: 0.90,
    debtLTV: 0.50,
    debtRatePct: 0.115,
    loanTermYears: 4,
    moratoriumMonths: 6,
    projectDurationMonths: HOLD_MONTHS.dev_short,
    propertyTaxPerSqftYr: 35,
  },

  plotted_development: {
    saleableAreaSqft: 400000,
    sellingRatePerSqft: 5500,
    landCostCr: 110,
    // NOTE: do not seed constructionCostPerSqft here — plotted-development
    // uses the `devCostPerSqft / saleableLandPct` math via the explicit
    // dev-cost-per-gross-sqft path in constructionCostPerSqftFor(). Seeding
    // a per-saleable value here would shadow that conversion.
    approvalCostCr: 3,
    salesVelocityPct: 0.22,
    salesLagQuarters: 2,
    constructionLagQuarters: 2,
    customerCollectionPct: 0.95,
    debtLTV: 0.40,
    debtRatePct: 0.12,
    loanTermYears: 3,
    moratoriumMonths: 3,
    projectDurationMonths: HOLD_MONTHS.dev_short,
    propertyTaxPerSqftYr: 15,
  },

  mixed_use: {
    saleableAreaSqft: 550000,
    sellingRatePerSqft: 10500,
    landCostCr: 120,
    constructionCostPerSqft: 5800,
    approvalCostCr: 12,
    salesVelocityPct: 0.14,
    salesLagQuarters: 3,
    constructionLagQuarters: 2,
    customerCollectionPct: 0.80,
    debtLTV: 0.55,
    debtRatePct: 0.115,
    loanTermYears: 6,
    moratoriumMonths: 18,
    projectDurationMonths: HOLD_MONTHS.dev_long,
    propertyTaxPerSqftYr: 40,
    mixUseResidentialShare: 0.50,
    mixUseOfficeShare: 0.30,
    mixUseRetailShare: 0.15,
    mixUseHospitalityShare: 0.05,
  },

  redevelopment: {
    saleableAreaSqft: 280000,
    sellingRatePerSqft: 13500,
    landCostCr: 0, // landowner contributes via area-share
    constructionCostPerSqft: 5200,
    approvalCostCr: 10,
    salesVelocityPct: 0.15,
    salesLagQuarters: 4,
    constructionLagQuarters: 3,
    customerCollectionPct: 0.85,
    debtLTV: 0.45,
    debtRatePct: 0.12,
    loanTermYears: 5,
    moratoriumMonths: 12,
    projectDurationMonths: HOLD_MONTHS.dev_long,
    propertyTaxPerSqftYr: 40,
    jvDevPct: 0.55,
    jvLandPct: 0.45,
    landownerSharePct: 0.45,
  },

  raw_land: {
    saleableAreaSqft: 0,
    sellingRatePerSqft: 1800,
    landCostCr: 25,
    constructionCostPerSqft: 0,
    approvalCostCr: 2,
    salesVelocityPct: 0.10,
    debtLTV: 0.30,
    debtRatePct: 0.14,
    loanTermYears: 3,
    moratoriumMonths: 0,
    projectDurationMonths: 36,
    rawLandTitleMonths: 3,
    rawLandConversionMonths: 6,
    rawLandLayoutMonths: 9,
  },

  // ── Income family ─────────────────────────────────────────────────
  // Income classes intentionally do NOT redefine baseRentPerSqftMonth /
  // exitCapRate / vacancyPct / rentEscalationPct / occupancy — the kernel
  // covers those via rentPerSqftPerMonth / exitCapRatePct / vacancyPct /
  // rentEscalationPct under its own naming.
  commercial_office: {
    saleableAreaSqft: 500000,
    otherIncomePerSqft: 240, // CAM annualised — kernel doesn't publish
    leaseUpPeriodQuarters: 4,
    propertyTaxPerSqftYr: 40, // BBMP UAV — different method from kernel's % of revenue
    insurancePct: 0.01,
    propMgmtPct: 0.03,
    utilitiesPct: 0.04,
    maintenancePct: 0.05,
    capExReservePct: 0.04,
    landCostCr: 80,
    constructionCostPerSqft: 6800,
    approvalCostCr: 6,
    debtLTV: 0.60,
    debtRatePct: 0.105,
    loanTermYears: 12,
    moratoriumMonths: 18,
    projectDurationMonths: HOLD_MONTHS.income_5yr,
  },

  retail: {
    saleableAreaSqft: 350000,
    otherIncomePerSqft: 360,
    leaseUpPeriodQuarters: 6,
    propertyTaxPerSqftYr: 60,
    insurancePct: 0.01,
    propMgmtPct: 0.04,
    utilitiesPct: 0.05,
    maintenancePct: 0.06,
    capExReservePct: 0.05,
    landCostCr: 70,
    constructionCostPerSqft: 7500,
    approvalCostCr: 8,
    debtLTV: 0.55,
    debtRatePct: 0.11,
    loanTermYears: 10,
    moratoriumMonths: 24,
    projectDurationMonths: HOLD_MONTHS.income_5yr,
    retailAnchorSharePct: 0.40,
    retailAnchorRentPerSqftMonth: 60,
    retailVanillaRentPerSqftMonth: 180,
    retailCAMRecoveryPct: 0.95,
  },

  industrial_warehousing: {
    saleableAreaSqft: 600000,
    otherIncomePerSqft: 60,
    leaseUpPeriodQuarters: 3,
    propertyTaxPerSqftYr: 15,
    insurancePct: 0.01,
    propMgmtPct: 0.02,
    utilitiesPct: 0.02,
    maintenancePct: 0.03,
    capExReservePct: 0.03,
    landCostCr: 50,
    constructionCostPerSqft: 2400,
    approvalCostCr: 4,
    debtLTV: 0.60,
    debtRatePct: 0.105,
    loanTermYears: 12,
    moratoriumMonths: 12,
    projectDurationMonths: HOLD_MONTHS.income_5yr,
  },

  hospitality: {
    saleableAreaSqft: 220000,
    propertyTaxPerSqftYr: 40,
    landCostCr: 35,
    constructionCostPerSqft: 6400,
    approvalCostCr: 5,
    debtLTV: 0.55,
    debtRatePct: 0.115,
    loanTermYears: 14,
    moratoriumMonths: 36,
    projectDurationMonths: HOLD_MONTHS.income_long,
    insurancePct: 0.015,
    propMgmtPct: 0.04,
    utilitiesPct: 0.05,
    maintenancePct: 0.06,
    capExReservePct: 0.05,
    // Hospitality-specific USALI drivers — kernel doesn't publish these.
    hospitalityKeys: 250,
    hospitalityADRBase: 7500,
    hospitalityADRPeak: 11500,
    hospitalityPeakShare: 0.30,
    hospitalityOccupancyPct: 0.70,
    hospitalityStabilizationYear: 4,
    hospitalityHoldYears: 14,
    hospitalityConstLoanLTC: 0.55,
    hospitalityRefiLTV: 0.55,
  },
});

const defaultsForAssetClass = (assetClass) =>
  ASSET_CLASS_DEFAULTS[assetClass] || {};

module.exports = {
  ASSET_CLASS_DEFAULTS,
  defaultsForAssetClass,
};
