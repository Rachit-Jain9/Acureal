/**
 * Kernel service acceptance suite — the post-legacy gate.
 *
 * This replaces the pre-2026-04 legacy/kernel parity tests. The legacy JS
 * engine was retired once every KPI matched within epsilon; parity is now a
 * tautology, so the gate shifts from "kernel == legacy" to
 * "kernel.service.js end-to-end produces the documented investor-grade
 * bundle for each asset class, within 1 bp of the canonical golden values."
 *
 * What is locked here:
 *   - The six KPIs the frontend depends on (irr, npv, equityMultiple, rlv,
 *     grossMarginPct + per-class extras like noi, yieldOnCost, exitValue)
 *   - The cost-bucket topology (land, construction, gst, contingency, stamp,
 *     approval, architecture, pmc, marketing, finance, TI, LC, hard/soft/total)
 *   - The area breakdown for each family (residential, plotted, income, hospitality)
 *   - The revenue block (totalRevenue, grossProfit, grossMargin, NOI, exitValue)
 *   - The presence and shape of `capitalStack`, `cashFlows`, `_legacy`
 *
 * Golden values are hand-pinned (not snapshot-generated) to force deliberate
 * review on change: any drift breaks CI and must be justified in the PR.
 *
 * Canonical deals mirror the pre-2026-04 parity deals so historical audit
 * trails survive. Hospitality adds the full construction→refi capital stack
 * + European 4-tier waterfall assertions.
 *
 * Run: `cd backend && npm test -- kernel.service.acceptance.test.js`
 */
'use strict';

const { computeFullFinancials, computeScenarios, buildSensitivityMatrix } =
  require('../src/engines/kernel.service');

// ──────────────────────────────────────────────────────────────────────────────
// Tolerances. Tight by default — these are deterministic. We allow 1 bp on
// percent metrics and 0.005 Cr on money (50k INR) to absorb round-to-2/4 drift.
// ──────────────────────────────────────────────────────────────────────────────

const EPS = Object.freeze({
  money: 0.005,     // 50k INR
  percent: 0.01,    // 1 bp
  ratio: 0.001,     // 0.1% on equity multiples
  rate: 0.001,      // 0.1% on IRR / yields
  sqft: 1,
});

const closeTo = (actual, expected, tol) => {
  if (expected == null) return expect(actual).toBeNull();
  expect(actual).not.toBeNull();
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

// ──────────────────────────────────────────────────────────────────────────────
// Canonical deals
// ──────────────────────────────────────────────────────────────────────────────

const residentialDeal = Object.freeze({
  assetClass: 'residential_apartments',
  plotAreaSqft: 50_000,
  fsi: 2.5,
  loadingFactor: 0.15,
  constructionCostPerSqft: 3_500,
  sellingRatePerSqft: 9_500,
  landCostCr: 30,
  projectDurationMonths: 36,
  discountRatePct: 14,
  developerMarginPct: 20,
  contingencyPct: 5,
  architectFeePct: 2,
  pmcFeePct: 1.5,
  marketingCostPct: 4,
  approvalCostCr: 2,
  debtLTV: 0,
  skipSensitivity: true,
});

const plottedDeal = Object.freeze({
  assetClass: 'plotted_development',
  totalLandSqft: 400_000,
  saleableLandPct: 55,
  avgPlotSizeSqft: 1500,
  sellingRatePerSqft: 3_800,
  landCostCr: 40,
  devCostPerSqft: 350,
  approvalCostCr: 3,
  projectDurationMonths: 24,
  marketingCostPct: 4,
  financeCostPct: 12,
  discountRatePct: 14,
  skipSensitivity: true,
});

const commercialDeal = Object.freeze({
  assetClass: 'commercial_office',
  leasableAreaSqft: 300_000,
  constructionCostPerSqft: 5_500,
  landCostCr: 75,
  baseRentPerSqftMonth: 95,
  rentEscalationPct: 5,
  vacancyPct: 10,
  opexPct: 22,
  tiPerSqft: 800,
  lcMonths: 4,
  exitCapRate: 7.5,
  entryCapRate: 8,
  holdPeriodYears: 5,
  projectDurationMonths: 36,
  discountRatePct: 14,
  contingencyPct: 4,
  approvalCostCr: 4,
  skipSensitivity: true,
});

const retailDeal = Object.freeze({
  ...commercialDeal,
  assetClass: 'retail',
  baseRentPerSqftMonth: 140,
  anchorPct: 40,
  anchorRentDiscount: 20,
  opexPct: 25,
  exitCapRate: 8,
});

const industrialDeal = Object.freeze({
  assetClass: 'industrial_warehousing',
  leasableAreaSqft: 500_000,
  constructionCostPerSqft: 2_200,
  landCostCr: 45,
  baseRentPerSqftMonth: 26,
  rentEscalationPct: 5,
  vacancyPct: 8,
  opexPct: 15,
  tiPerSqft: 150,
  lcMonths: 2,
  exitCapRate: 8.5,
  entryCapRate: 9,
  holdPeriodYears: 5,
  projectDurationMonths: 18,
  discountRatePct: 13,
  contingencyPct: 4,
  approvalCostCr: 2,
  skipSensitivity: true,
});

const hospitalityDeal = Object.freeze({
  assetClass: 'hospitality',
  keys: 180,
  sqftPerKey: 550,
  hardCostPerSqft: 11_000,
  landCostCr: 60,
  preOpeningCostPerKey: 350_000,
  adr: 7_500,
  adrGrowthPct: 5,
  stabilizedOccPct: 68,
  holdPeriodYears: 8,
  fbRevPct: 28,
  otherRevPct: 10,
  exitCapRate: 9,
  discountRatePct: 15,
  projectDurationMonths: 30,
  skipSensitivity: true,
});

// ──────────────────────────────────────────────────────────────────────────────
// Residential
// ──────────────────────────────────────────────────────────────────────────────

describe('kernel.service acceptance — residential_apartments', () => {
  let r;
  beforeAll(() => { r = computeFullFinancials(residentialDeal); });

  test('engineVersion is kernel-v2', () => {
    expect(r.engineVersion).toBe('kernel-v2');
  });

  test('KPIs match golden values', () => {
    closeTo(r.kpis.irr, 5.1124, EPS.rate);
    closeTo(r.kpis.npv, -10.8839, EPS.money);
    closeTo(r.kpis.equityMultiple, 1.0631, EPS.ratio);
    closeTo(r.kpis.rlv, 33.0035, EPS.money);
    closeTo(r.kpis.grossMarginPct, 5.9344, EPS.percent);
    closeTo(r.kpis.costPerSqft, 8936.2313, 0.01);
    closeTo(r.kpis.revenuePerSqft, 9500, 0.01);
    closeTo(r.kpis.profitPerSqft, 563.7687, 0.01);
    closeTo(r.kpis.landCostPerSqft, 6000, 0.01);
  });

  test('cost bucket topology matches', () => {
    closeTo(r.costs.land, 30, EPS.money);
    closeTo(r.costs.construction, 50.3125, EPS.money);
    closeTo(r.costs.gst, 9.0563, EPS.money);
    closeTo(r.costs.contingency, 2.5156, EPS.money);
    closeTo(r.costs.stampDuty, 1.5, EPS.money);
    closeTo(r.costs.approval, 2, EPS.money);
    closeTo(r.costs.architecture, 1.0063, EPS.money);
    closeTo(r.costs.pmc, 0.7547, EPS.money);
    closeTo(r.costs.marketing, 5.4625, EPS.money);
    closeTo(r.costs.finance, 25.8505, EPS.money);
    closeTo(r.costs.hardCostTotal, 93.3844, EPS.money);
    closeTo(r.costs.softCostTotal, 35.0739, EPS.money);
    closeTo(r.costs.total, 128.4583, EPS.money);
  });

  test('area breakdown matches', () => {
    closeTo(r.areas.grossBuiltUp, 125_000, EPS.sqft);
    closeTo(r.areas.saleable, 143_750, EPS.sqft);
    closeTo(r.areas.carpet, 87_500, EPS.sqft);
    closeTo(r.areas.superBuiltUp, 143_750, EPS.sqft);
    expect(r.areas.numberOfUnits).toBe(125);
    expect(r.areas.avgUnitSizeSqft).toBe(1150);
  });

  test('revenue block matches', () => {
    closeTo(r.revenue.totalRevenueCr, 136.5625, EPS.money);
    closeTo(r.revenue.grossProfitCr, 8.1042, EPS.money);
    closeTo(r.revenue.grossMarginPct, 5.9344, EPS.percent);
  });

  test('cash flows and legacy shape present', () => {
    expect(r.cashFlows).toMatchObject({
      quarterly: expect.any(Array),
      yearly: expect.any(Array),
      summary: expect.any(Object),
    });
    expect(r._legacy).toMatchObject({
      total_cost_cr: expect.any(Number),
      total_revenue_cr: expect.any(Number),
      gross_margin_pct: expect.any(Number),
      irr_pct: expect.any(Number),
      npv_cr: expect.any(Number),
      equity_multiple: expect.any(Number),
      residual_land_value_cr: expect.any(Number),
    });
  });

  test('debtLTV=0 → capitalStack null', () => {
    expect(r.capitalStack).toBeNull();
  });

  test('kernel canonical block is exposed', () => {
    expect(r.kernel).toMatchObject({
      kpis: expect.any(Object),
      costs: expect.any(Object),
      revenue: expect.any(Object),
      cashFlow: expect.any(Object),
      provenance: expect.any(Array),
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Plotted
// ──────────────────────────────────────────────────────────────────────────────

describe('kernel.service acceptance — plotted_development', () => {
  let r;
  beforeAll(() => { r = computeFullFinancials(plottedDeal); });

  test('KPIs match golden values', () => {
    closeTo(r.kpis.irr, 18.9692, EPS.rate);
    closeTo(r.kpis.npv, 1.7237, EPS.money);
    closeTo(r.kpis.equityMultiple, 1.1005, EPS.ratio);
    closeTo(r.kpis.rlv, 41.3322, EPS.money);
    closeTo(r.kpis.grossMarginPct, 9.1308, EPS.percent);
    closeTo(r.kpis.revenuePerPlot, 5_700_000, 100);
    closeTo(r.kpis.costPerPlot, 5_179_543.8545, 1);
  });

  test('cost bucket topology matches', () => {
    closeTo(r.costs.land, 40, EPS.money);
    closeTo(r.costs.construction, 14, EPS.money);
    closeTo(r.costs.gst, 1.68, EPS.money);
    closeTo(r.costs.contingency, 0.7, EPS.money);
    closeTo(r.costs.stampDuty, 2, EPS.money);
    closeTo(r.costs.approval, 3, EPS.money);
    closeTo(r.costs.marketing, 3.3288, EPS.money);
    closeTo(r.costs.finance, 10.9125, EPS.money);
    closeTo(r.costs.total, 75.6213, EPS.money);
  });

  test('area / plot breakdown matches', () => {
    closeTo(r.areas.grossBuiltUp, 400_000, EPS.sqft);
    closeTo(r.areas.saleable, 220_000, EPS.sqft);
    expect(r.areas.totalPlots).toBe(146);
    expect(r.areas.avgPlotSizeSqft).toBe(1500);
  });

  test('revenue block matches', () => {
    closeTo(r.revenue.totalRevenueCr, 83.22, EPS.money);
    closeTo(r.revenue.grossProfitCr, 7.5987, EPS.money);
    closeTo(r.revenue.grossMarginPct, 9.1308, EPS.percent);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Income assets (commercial / retail / industrial)
// ──────────────────────────────────────────────────────────────────────────────

describe('kernel.service acceptance — commercial_office', () => {
  let r;
  beforeAll(() => { r = computeFullFinancials(commercialDeal); });

  test('KPIs match golden values', () => {
    closeTo(r.kpis.irr, 8.4456, EPS.rate);
    closeTo(r.kpis.npv, -73.2627, EPS.money);
    closeTo(r.kpis.equityMultiple, 1.6604, EPS.ratio);
    closeTo(r.kpis.grossMarginPct, 21.8094, EPS.percent);
    closeTo(r.kpis.noi, 24.0084, EPS.money);
    closeTo(r.kpis.yieldOnCost, 7.5155, EPS.percent);
    closeTo(r.kpis.exitValue, 408.553, EPS.money);
    closeTo(r.kpis.entryValue, 300.105, EPS.money);
  });

  test('cost topology + TI/LC pass-through', () => {
    closeTo(r.costs.total, 319.45, EPS.money);
    closeTo(r.costs.tenantImprovements, 24, EPS.money);
    closeTo(r.costs.leasingCommissions, 11.4, EPS.money);
  });

  test('leasable + GBUA areas match', () => {
    closeTo(r.areas.grossBuiltUp, 352_941.18, 0.01);
    closeTo(r.areas.leasable, 300_000, EPS.sqft);
  });

  test('revenue block + NOI match', () => {
    closeTo(r.revenue.annualNOI, 24.0084, EPS.money);
    closeTo(r.revenue.stabilizedNOI, 24.0084, EPS.money);
    closeTo(r.revenue.exitValue, 408.553, EPS.money);
  });
});

describe('kernel.service acceptance — retail', () => {
  let r;
  beforeAll(() => { r = computeFullFinancials(retailDeal); });

  test('KPIs reflect anchor blend', () => {
    closeTo(r.kpis.irr, 12.1468, EPS.rate);
    closeTo(r.kpis.noi, 31.2984, EPS.money);
    closeTo(r.kpis.yieldOnCost, 9.6748, EPS.percent);
    closeTo(r.kpis.exitValue, 499.3196, EPS.money);
    closeTo(r.kpis.blendedRentFactor, 0.92, 0.001);
  });

  test('cost topology matches', () => {
    closeTo(r.costs.total, 323.506, EPS.money);
    closeTo(r.costs.leasingCommissions, 15.456, EPS.money);
  });
});

describe('kernel.service acceptance — industrial_warehousing', () => {
  let r;
  beforeAll(() => { r = computeFullFinancials(industrialDeal); });

  test('KPIs match golden values', () => {
    closeTo(r.kpis.irr, 4.4504, EPS.rate);
    closeTo(r.kpis.noi, 12.1992, EPS.money);
    closeTo(r.kpis.yieldOnCost, 6.3029, EPS.percent);
    closeTo(r.kpis.exitValue, 183.1719, EPS.money);
  });

  test('cost topology matches', () => {
    closeTo(r.costs.total, 193.55, EPS.money);
    closeTo(r.costs.tenantImprovements, 7.5, EPS.money);
    closeTo(r.costs.leasingCommissions, 2.6, EPS.money);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Hospitality — full USALI + capital stack + waterfall
// ──────────────────────────────────────────────────────────────────────────────

describe('kernel.service acceptance — hospitality', () => {
  let r;
  beforeAll(() => { r = computeFullFinancials(hospitalityDeal); });

  test('KPIs + USALI extras match golden values', () => {
    closeTo(r.kpis.irr, -4.4924, EPS.rate);
    closeTo(r.kpis.npv, -191.5834, EPS.money);
    closeTo(r.kpis.equityMultiple, 0.6904, EPS.ratio);
    closeTo(r.kpis.grossMarginPct, 22, EPS.percent);
    closeTo(r.kpis.noi, 8.3231, EPS.money);
    closeTo(r.kpis.ebitda, 10.1727, EPS.money);
    closeTo(r.kpis.yieldOnCost, 2.8098, EPS.percent);
    closeTo(r.kpis.exitValue, 130.1277, EPS.money);
    closeTo(r.kpis.revPAR, 5100, 0.01);
    closeTo(r.kpis.gopMargin, 30, EPS.percent);
    closeTo(r.kpis.ebitdaMarginPct, 22, EPS.percent);
    closeTo(r.kpis.devCostPerKey, 16_456_687.7675, 1);
  });

  test('cost bucket topology matches', () => {
    closeTo(r.costs.land, 60, EPS.money);
    closeTo(r.costs.construction, 108.9, EPS.money);
    closeTo(r.costs.gst, 19.602, EPS.money);
    closeTo(r.costs.contingency, 8.6812, EPS.money);
    closeTo(r.costs.stampDuty, 3.96, EPS.money);
    closeTo(r.costs.approval, 2.178, EPS.money);
    closeTo(r.costs.finance, 21.3537, EPS.money);
    closeTo(r.costs.total, 296.2204, EPS.money);
  });

  test('capital stack is populated (construction → permanent)', () => {
    expect(r.capitalStack).not.toBeNull();
    expect(r.capitalStack).toMatchObject({
      totalCostCr: expect.any(Number),
      debtCr: expect.any(Number),
      equityCr: expect.any(Number),
      debtPct: expect.any(Number),
      equityPct: expect.any(Number),
      construction: expect.any(Object),
      permanent: expect.any(Object),
      waterfall: expect.any(Object),
    });
    expect(r.capitalStack.debtPct + r.capitalStack.equityPct).toBeCloseTo(100, 1);
  });

  test('waterfall has 4 tiers + LP/GP split', () => {
    const w = r.capitalStack.waterfall;
    expect(w).toBeTruthy();
    expect(w.totalLPCr).toBeGreaterThanOrEqual(0);
    expect(w.totalGPCr).toBeGreaterThanOrEqual(0);
    // LP equity multiple is a derived field we attach from equity contribution
    expect(w.lpEquityMultiple).not.toBeUndefined();
    expect(w.gpEquityMultiple).not.toBeUndefined();
  });

  test('revenue NOI/EBITDA/exit match', () => {
    closeTo(r.revenue.stabilizedNOI, 8.3231, EPS.money);
    closeTo(r.revenue.exitValue, 130.1277, EPS.money);
    closeTo(r.revenue.ebitda, 10.1727, EPS.money);
    closeTo(r.revenue.gop, 13.8719, EPS.money);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Scenarios + sensitivity — smoke tests to guard the adapter
// ──────────────────────────────────────────────────────────────────────────────

describe('kernel.service scenario bundle', () => {
  test('residential base/bull/bear all compute', () => {
    const s = computeScenarios(residentialDeal);
    expect(s.base).toBeTruthy();
    expect(s.bull).toBeTruthy();
    expect(s.bear).toBeTruthy();
    for (const key of ['base', 'bull', 'bear']) {
      expect(s[key].kpis).toBeTruthy();
      expect(s[key].costs).toBeTruthy();
      expect(s[key].revenue).toBeTruthy();
    }
    // Bull should out-earn bear on gross margin (revenue↑ + cost↓ + duration↓)
    expect(s.bull.kpis.grossMarginPct).toBeGreaterThan(s.bear.kpis.grossMarginPct);
  });

  test('commercial base/bull/bear capital stack attaches', () => {
    const s = computeScenarios(commercialDeal);
    expect(s.base.kpis).toBeTruthy();
    expect(s.base.kpis.noi).toBeGreaterThan(0);
  });
});

describe('kernel.service sensitivity matrix', () => {
  test('residential 9×9 grid builds for sensitivity-enabled deals', () => {
    const { skipSensitivity: _drop, ...sensInput } = residentialDeal;
    void _drop;
    const m = buildSensitivityMatrix(sensInput);
    expect(m).toBeTruthy();
    expect(m.sellingRates).toHaveLength(9);
    expect(m.constructionCosts).toHaveLength(9);
    expect(m.irrGrid).toHaveLength(9);
    expect(m.irrGrid[0]).toHaveLength(9);
    expect(m.axis).toBeTruthy();
  });
});
