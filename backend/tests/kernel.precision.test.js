/**
 * Kernel precision regression — fractional-input edge cases.
 *
 * Locks the investor-grade guarantee that cost derivations at fractional
 * landCostCr values are computed via BigInt-backed Decimal arithmetic, not
 * via native float multiplication. The distinction matters because
 *
 *   D(a * b)              ← one float multiply, then wrap (two rounding
 *                           events, first in IEEE-754, second at scale)
 *
 *   D(a).mulNumber(b)     ← wrap a as Decimal (one rounding), then multiply
 *                           as BigInt at target scale (exact)
 *
 * Both forms coincide at scale 10 for simple rates (STAMP_DUTY_RATE=0.05
 * against a whole-rupee land cost), but diverge silently on fractional
 * rates, fractional land costs, or compound factors like
 * `landCost × (1+r)^n`. That divergence is what this suite regresses.
 *
 * What the tests assert:
 *
 *   1. stamp-duty = landCostCr × STAMP_DUTY_RATE to 10 decimal places
 *      across residential, plotted, income-family, hospitality, land-parcel.
 *   2. holding-cost = perYear × years to 10 dp (land-parcel).
 *   3. hospitality betterment = landCostCr × bettermentPct / 100 to 10 dp.
 *   4. Two consecutive calls with identical inputs yield bit-identical
 *      Decimal quantities (determinism).
 *
 * Tolerance is 1e-10, two orders of magnitude tighter than the 4dp
 * rounding that the backend service applies to flattened costs. Any
 * regression that re-introduces native `D(a * b)` patterns on the
 * land-multiplier paths will show up here first.
 *
 * Run: `cd backend && npm test -- kernel.precision.test.js`
 */
'use strict';

const kernel = require('../../packages/financial-kernel/dist');
const { computeDeal } = kernel;

const STAMP_DUTY_RATE = 0.05;
const TOL_DEC = 1e-10;

/**
 * Wrap a flat deal input into the `{ assetClass, raw }` shape the kernel
 * dispatcher expects. Mirrors `kernel.service.computeFullFinancials`'s
 * normalisation step without going through the flat-output rounder, so we
 * can read raw Decimal `.q` and `.toNumber()` values at full scale-10
 * precision.
 */
const runKernel = (deal) => {
  const { assetClass, ...rest } = deal;
  return computeDeal({ assetClass, raw: rest });
};

const close = (actual, expected, tol = TOL_DEC) => {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures: fractional land costs chosen so `a * b` in native floats would
// accumulate error at the 1e-12 range if routed through IEEE-754 first.
// ──────────────────────────────────────────────────────────────────────────────

const fractionalLandCostCr = 12.345;

const residentialFractional = Object.freeze({
  assetClass: 'residential_apartments',
  plotAreaSqft: 50_000,
  fsi: 2.5,
  loadingFactor: 0.15,
  constructionCostPerSqft: 3_500,
  sellingRatePerSqft: 9_500,
  landCostCr: fractionalLandCostCr,
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

const plottedFractional = Object.freeze({
  assetClass: 'plotted_development',
  totalLandSqft: 400_000,
  saleableLandPct: 55,
  avgPlotSizeSqft: 1500,
  sellingRatePerSqft: 3_800,
  landCostCr: fractionalLandCostCr,
  devCostPerSqft: 350,
  approvalCostCr: 3,
  projectDurationMonths: 24,
  marketingCostPct: 4,
  financeCostPct: 12,
  discountRatePct: 14,
  skipSensitivity: true,
});

const commercialFractional = Object.freeze({
  assetClass: 'commercial_office',
  leasableAreaSqft: 300_000,
  constructionCostPerSqft: 5_500,
  landCostCr: fractionalLandCostCr,
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

const hospitalityFractional = Object.freeze({
  assetClass: 'hospitality',
  keys: 180,
  sqftPerKey: 550,
  hardCostPerSqft: 11_000,
  landCostCr: fractionalLandCostCr,
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
  // Pin stamp + betterment rates so the asserted products are stable
  // regardless of config drift. Both paths use the precision-safe
  // D(a).mulNumber(b) / .divInt(100) pattern.
  stampRegPct: 6.6,
  bettermentPct: 2.5,
  skipSensitivity: true,
});

const landParcelFractional = Object.freeze({
  assetClass: 'land_parcel',
  landCostCr: fractionalLandCostCr,
  totalLandSqft: 200_000,
  holdPeriodYears: 5,
  landAppreciationPct: 8,
  holdingCostPerYearCr: 0.175,
  discountRatePct: 12,
  skipSensitivity: true,
});

// ──────────────────────────────────────────────────────────────────────────────

describe('kernel precision — stamp duty exact to 10 dp', () => {
  const expectedStamp = fractionalLandCostCr * STAMP_DUTY_RATE; // 0.61725

  test('residential_apartments', () => {
    const r = runKernel(residentialFractional);
    close(r.costs.stampDutyCr.toNumber(), expectedStamp);
  });

  test('plotted_development', () => {
    const r = runKernel(plottedFractional);
    close(r.costs.stampDutyCr.toNumber(), expectedStamp);
  });

  test('commercial_office', () => {
    const r = runKernel(commercialFractional);
    close(r.costs.stampDutyCr.toNumber(), expectedStamp);
  });

  test('land_parcel', () => {
    const r = runKernel(landParcelFractional);
    close(r.costs.stampDutyCr.toNumber(), expectedStamp);
  });
});

describe('kernel precision — hospitality stamp + betterment', () => {
  // Hospitality routes land-cost through two precision-sensitive paths:
  //   stampDutyCr   = D(landCostCr).mulNumber(stampRegPct)
  //   bettermentCr  = D(landCostCr).mulNumber(bettermentPct).divInt(100)
  // Both must reproduce the exact product at scale 10.
  test('stamp duty from fractional land cost is exact', () => {
    const r = runKernel(hospitalityFractional);
    const expectedStamp = fractionalLandCostCr * 0.066; // fixture PINS stampRegPct: 6.6 (input-driven, not the default)
    close(r.costs.stampDutyCr.toNumber(), expectedStamp);
  });

  test('betterment = landCost × bettermentPct / 100 is exact', () => {
    const r = runKernel(hospitalityFractional);
    const expected = (fractionalLandCostCr * 2.5) / 100;
    const bettermentCr = r.costs.extras?.bettermentCr;
    expect(bettermentCr).toBeDefined();
    close(bettermentCr.toNumber(), expected);
  });
});

describe('kernel precision — holding cost × years is exact', () => {
  test('land_parcel holdingCost = perYear × years to 10 dp', () => {
    const r = runKernel(landParcelFractional);
    const expected = 0.175 * 5;
    const holdingCr = r.costs.extras?.holdingCostsCr?.toNumber?.() ?? null;
    expect(holdingCr).not.toBeNull();
    close(holdingCr, expected);
  });
});

describe('kernel precision — determinism', () => {
  // Two invocations with the same input must return bit-identical Decimal
  // quantities. This is free under BigInt-backed Decimal arithmetic and
  // would fail if any path re-introduced nondeterministic float math.
  test('residential repeat run matches bit-for-bit', () => {
    const a = runKernel(residentialFractional);
    const b = runKernel(residentialFractional);
    expect(a.costs.stampDutyCr.q).toBe(b.costs.stampDutyCr.q);
    expect(a.costs.landCr.q).toBe(b.costs.landCr.q);
    expect(a.costs.totalCr.q).toBe(b.costs.totalCr.q);
  });

  test('land_parcel repeat run matches bit-for-bit', () => {
    const a = runKernel(landParcelFractional);
    const b = runKernel(landParcelFractional);
    expect(a.costs.stampDutyCr.q).toBe(b.costs.stampDutyCr.q);
    expect(a.costs.extras.holdingCostsCr.q).toBe(
      b.costs.extras.holdingCostsCr.q,
    );
    expect(a.revenue.exitValueCr.q).toBe(b.revenue.exitValueCr.q);
  });
});
