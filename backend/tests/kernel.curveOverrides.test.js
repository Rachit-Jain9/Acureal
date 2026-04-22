/**
 * Per-deal curve overrides — kernel acceptance suite.
 *
 * The default S-curve (`sin((q+1)/n·π)·1.5`) and logistic sales-revenue
 * curves are reasonable underwriting defaults but not credible as the
 * only option: underwriters routinely have a contractor's milestone
 * ladder or an operator's ADR ramp they want reflected. This suite
 * locks the contract that asset classes honour a deal-level override
 * without disturbing the no-override baseline.
 *
 * Guaranteed invariants:
 *   1.  No override ⇒ byte-for-byte identical KPIs and provenance labels
 *       vs. the pre-override kernel. Regression would break
 *       kernel.service.acceptance — this suite double-checks the
 *       passthrough on the same deal.
 *   2.  `constructionCurve` and `salesCurve` are opaque objects on the
 *       raw input; the kernel's input normaliser keeps them intact.
 *   3.  Accepted override shapes: `explicit` (weight array),
 *       `logistic` / `frontLoaded` (parametric), `uniform` / `sCurve`
 *       (swap default), `default` (no-op).
 *   4.  Override provenance surfaces on the line item so the UI can
 *       reflect "customised by user" in the methodology drawer.
 *   5.  Invalid overrides (unknown kind, empty weights, non-object)
 *       silently fall back to the default — underwriters never see a
 *       500 because they typed a curve name wrong.
 *   6.  Total revenue / total cost stay invariant under override — the
 *       *timing* of cash flows shifts, the *amounts* don't.
 */
'use strict';

const { computeFullFinancials } = require('../src/engines/kernel.service');

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures. Canonical residential + plotted deals mirror the ones
// locked in kernel.service.acceptance.test.js so any cross-suite drift is a
// smoking gun for a regression in the override plumbing.
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

const incomeDeal = Object.freeze({
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

// Small helpers to pick line items out of the kernel cash-flow bundle.
// Residential tags sales via subcategory='sales', plotted via category='sales'
// with no subcategory — accept either.
const getItem = (result, subcategory) =>
  result.kernel.cashFlow.items.find(
    (it) => it.subcategory === subcategory || it.category === subcategory,
  );

const sumValues = (item) =>
  item ? item.values.reduce((acc, v) => acc + Number(v), 0) : 0;

const provSources = (item) =>
  item ? item.provenance.map((p) => p.source).join('|') : '';

// Sample the first non-zero month on a cashflow item so we can compare
// "when did sales start" between baseline and override without pinning a
// full distribution.
const firstNonZeroMonth = (item) => {
  if (!item) return -1;
  for (let i = 0; i < item.values.length; i++) {
    if (Math.abs(Number(item.values[i])) > 1e-9) return i;
  }
  return -1;
};

// ──────────────────────────────────────────────────────────────────────────────
// 1. No-override baseline is pristine — the critical regression gate.
// ──────────────────────────────────────────────────────────────────────────────

describe('curve overrides — baseline remains pristine when absent', () => {
  const baseline = computeFullFinancials(residentialDeal);
  const withDefaultKind = computeFullFinancials({
    ...residentialDeal,
    constructionCurve: { kind: 'default' },
    salesCurve: { kind: 'default' },
  });

  test('explicit {kind:default} is a no-op on KPIs', () => {
    expect(Number(withDefaultKind.kpis.irr)).toBeCloseTo(
      Number(baseline.kpis.irr),
      6,
    );
    expect(Number(withDefaultKind.kpis.npv)).toBeCloseTo(
      Number(baseline.kpis.npv),
      6,
    );
    expect(Number(withDefaultKind.kpis.grossMarginPct)).toBeCloseTo(
      Number(baseline.kpis.grossMarginPct),
      6,
    );
    expect(Number(withDefaultKind.kpis.equityMultiple)).toBeCloseTo(
      Number(baseline.kpis.equityMultiple),
      6,
    );
  });

  test('provenance labels match the pre-override wording', () => {
    const hc = getItem(baseline, 'construction+gst+contingency');
    const rev = getItem(baseline, 'sales');
    expect(provSources(hc)).toContain('S-curve over construction window');
    expect(provSources(rev)).toContain('logistic milestone schedule');
  });

  test('invalid overrides silently fall back to default', () => {
    const junk = computeFullFinancials({
      ...residentialDeal,
      constructionCurve: 'not-an-object',
      salesCurve: { kind: 'pegasus', weights: 'bad' },
    });
    expect(Number(junk.kpis.irr)).toBeCloseTo(Number(baseline.kpis.irr), 6);
    const hc = getItem(junk, 'construction+gst+contingency');
    expect(provSources(hc)).toContain('S-curve over construction window');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Explicit weights override — user-supplied milestone ladder.
// ──────────────────────────────────────────────────────────────────────────────

describe('curve overrides — explicit weight arrays', () => {
  test('residential construction accepts hand-tuned weights', () => {
    // 8 weights — auto-rescaled to the construction window.
    const result = computeFullFinancials({
      ...residentialDeal,
      constructionCurve: {
        kind: 'explicit',
        weights: [0.02, 0.05, 0.1, 0.2, 0.25, 0.2, 0.1, 0.08],
      },
    });
    const hc = getItem(result, 'construction+gst+contingency');
    expect(hc).toBeDefined();
    expect(provSources(hc)).toContain('deal-override explicit construction schedule');
    // Totals still balance — only timing changes.
    const baseline = computeFullFinancials(residentialDeal);
    const baseHc = getItem(baseline, 'construction+gst+contingency');
    expect(sumValues(hc)).toBeCloseTo(sumValues(baseHc), 4);
  });

  test('empty / all-zero weights fall back to default', () => {
    const result = computeFullFinancials({
      ...residentialDeal,
      constructionCurve: { kind: 'explicit', weights: [0, 0, 0] },
    });
    const hc = getItem(result, 'construction+gst+contingency');
    expect(provSources(hc)).toContain('S-curve over construction window');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Parametric overrides — logistic + frontLoaded with custom knobs.
// ──────────────────────────────────────────────────────────────────────────────

describe('curve overrides — parametric tuning', () => {
  test('logistic midpoint shifts sales timing', () => {
    const lateSales = computeFullFinancials({
      ...residentialDeal,
      salesCurve: { kind: 'logistic', midpoint: 0.85, steepness: 9 },
    });
    const earlySales = computeFullFinancials({
      ...residentialDeal,
      salesCurve: { kind: 'logistic', midpoint: 0.25, steepness: 9 },
    });
    const late = getItem(lateSales, 'sales');
    const early = getItem(earlySales, 'sales');
    // Totals balance; timing shifts.
    expect(sumValues(late)).toBeCloseTo(sumValues(early), 4);
    // Compare centre-of-mass: a later midpoint pushes revenue right.
    const com = (item) => {
      const vals = item.values.map((v) => Number(v));
      const total = vals.reduce((a, b) => a + b, 0);
      if (total === 0) return 0;
      let acc = 0;
      for (let i = 0; i < vals.length; i++) acc += i * vals[i];
      return acc / total;
    };
    expect(com(late)).toBeGreaterThan(com(early));
    // Provenance announces the override.
    expect(provSources(late)).toContain('deal-override logistic schedule');
  });

  test('frontLoaded peak/sharpness flag as parametric', () => {
    const result = computeFullFinancials({
      ...residentialDeal,
      salesCurve: { kind: 'frontLoaded', peak: 0.2, sharpness: 6 },
    });
    const sales = getItem(result, 'sales');
    expect(provSources(sales)).toContain('deal-override frontLoaded schedule');
    // First non-zero month should not be later than the default launch.
    const baseline = computeFullFinancials(residentialDeal);
    const baseSales = getItem(baseline, 'sales');
    expect(firstNonZeroMonth(sales)).toBeLessThanOrEqual(firstNonZeroMonth(baseSales) + 1);
  });

  test('uniform override produces flat construction spend', () => {
    const result = computeFullFinancials({
      ...residentialDeal,
      constructionCurve: { kind: 'uniform' },
    });
    const hc = getItem(result, 'construction+gst+contingency');
    expect(provSources(hc)).toContain('deal-override uniform construction schedule');
    // Collect only non-zero months — uniform should make them all equal.
    const nonZero = hc.values
      .map((v) => Number(v))
      .filter((v) => Math.abs(v) > 1e-9);
    expect(nonZero.length).toBeGreaterThan(3);
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
    for (const v of nonZero) {
      expect(Math.abs(v - avg)).toBeLessThan(avg * 0.05); // <5% variance vs mean
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Cross-asset plumbing — plotted, hospitality, income all accept curves.
// ──────────────────────────────────────────────────────────────────────────────

describe('curve overrides — cross-asset plumbing', () => {
  test('plotted_development accepts construction + sales curves together', () => {
    const result = computeFullFinancials({
      ...plottedDeal,
      constructionCurve: { kind: 'explicit', weights: [0.1, 0.2, 0.3, 0.25, 0.15] },
      salesCurve: { kind: 'logistic', midpoint: 0.5, steepness: 5 },
    });
    const hc = getItem(result, 'construction+gst+contingency');
    const rev = getItem(result, 'sales');
    expect(provSources(hc)).toContain('deal-override explicit');
    expect(provSources(rev)).toContain('deal-override logistic launch sales');
    expect(Number.isFinite(Number(result.kpis.irr))).toBe(true);
    expect(Number.isFinite(Number(result.kpis.npv))).toBe(true);
  });

  test('hospitality honours a construction curve override', () => {
    const baseline = computeFullFinancials(hospitalityDeal);
    const result = computeFullFinancials({
      ...hospitalityDeal,
      constructionCurve: { kind: 'uniform' },
    });
    const baseHc = getItem(baseline, 'construction+gst+contingency');
    const hc = getItem(result, 'construction+gst+contingency');
    expect(provSources(hc)).toContain('deal-override uniform construction schedule');
    // Total construction spend is an invariant; only distribution shifts.
    expect(sumValues(hc)).toBeCloseTo(sumValues(baseHc), 4);
  });

  test('commercial_office honours a construction curve override', () => {
    const result = computeFullFinancials({
      ...incomeDeal,
      constructionCurve: { kind: 'sCurve' },
    });
    const hc = getItem(result, 'construction+gst+contingency');
    expect(hc).toBeDefined();
    // sCurve explicit kind still routes via the override path — label reflects it.
    expect(provSources(hc)).toContain('deal-override sCurve construction schedule');
    // IRR/NPV stay finite.
    expect(Number.isFinite(Number(result.kpis.irr))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Total-cost / total-revenue invariants. Timing shifts, amounts don't.
// ──────────────────────────────────────────────────────────────────────────────

describe('curve overrides — total invariants under re-timing', () => {
  test('override does not change total revenue or total cost', () => {
    const baseline = computeFullFinancials(residentialDeal);
    const override = computeFullFinancials({
      ...residentialDeal,
      constructionCurve: { kind: 'uniform' },
      salesCurve: { kind: 'frontLoaded', peak: 0.3, sharpness: 5 },
    });
    // Kernel service flattens: totals live on `revenue.totalRevenueCr` and
    // `costs.total` as plain numbers.
    expect(Number(override.revenue.totalRevenueCr)).toBeCloseTo(
      Number(baseline.revenue.totalRevenueCr),
      2,
    );
    expect(Number(override.costs.total)).toBeCloseTo(
      Number(baseline.costs.total),
      2,
    );
  });
});
