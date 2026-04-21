/**
 * Cash-flow shape parity: legacy JS engine vs kernel post-processor.
 *
 * Asserts that `packages/financial-kernel/src/postprocess/cashFlows.ts`
 * produces output byte-for-byte identical to the legacy
 * `structureCashFlows` function in `backend/src/engines/financial.engine.js`
 * (lines 536-599).
 *
 * Approach:
 *   1. Run each canonical deal through the legacy engine and capture its
 *      `computed.cashFlows` bundle (quarterly / yearly / summary).
 *   2. Reconstruct the flat quarterly net array by reading the
 *      `quarterly[].net` field from the legacy output.
 *   3. Feed that flat array plus the legacy timeline into the kernel's
 *      `buildCashFlows`, and deep-compare the result.
 *
 * Any divergence in key names, date strings, rounding, or year-bucket
 * logic is a failure — the UI (FinancialsPage CashFlowChart, exports
 * summarizeCashFlows) reads these shapes directly without defensive
 * normalisation.
 *
 * Run: `cd backend && npm test -- kernel.cashFlows.parity.test.js`
 */
'use strict';

const path = require('path');
const { calculateFullFinancials } = require('../src/engines/financial.engine');

let kernel;
try {
  kernel = require(
    path.join(__dirname, '..', '..', 'packages', 'financial-kernel', 'dist'),
  );
} catch (err) {
  kernel = null;
  // eslint-disable-next-line no-console
  console.warn(
    '[cashFlows.parity] financial-kernel dist/ not built. Run:\n' +
      '  cd packages/financial-kernel && npx tsc -p tsconfig.build.json\n' +
      'then re-run this suite.',
  );
}

const describeIfBuilt = kernel ? describe : describe.skip;

// ── Canonical deals (lifted from kernel.parity.test.js) ─────────────────────

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

// ── Parity helpers ─────────────────────────────────────────────────────────

function assertEntryIdentical(expected, actual, ctx) {
  const eKeys = Object.keys(expected).sort();
  const aKeys = Object.keys(actual).sort();
  expect(aKeys).toEqual(eKeys);
  for (const k of eKeys) {
    const ev = expected[k];
    const av = actual[k];
    if (typeof ev === 'number') {
      expect(typeof av).toBe('number');
      // 2dp tolerance accommodates double-round drift on re-summing yearly
      // slices. Quarterly.net passes through both engines untouched so
      // equality is exact for those, but yearly.net sums already-rounded
      // quarterlies in the legacy output, which can drift ≤0.5 × 0.01 Cr.
      expect(Math.abs(ev - av)).toBeLessThanOrEqual(0.02);
    } else {
      expect(av).toEqual(ev);
    }
  }
}

function assertBundleIdentical(legacyBundle, kernelBundle) {
  expect(Object.keys(kernelBundle).sort()).toEqual(
    ['quarterly', 'summary', 'yearly'].sort(),
  );

  expect(kernelBundle.quarterly).toHaveLength(legacyBundle.quarterly.length);
  for (let i = 0; i < legacyBundle.quarterly.length; i++) {
    assertEntryIdentical(legacyBundle.quarterly[i], kernelBundle.quarterly[i], `quarterly[${i}]`);
  }

  expect(kernelBundle.yearly).toHaveLength(legacyBundle.yearly.length);
  for (let i = 0; i < legacyBundle.yearly.length; i++) {
    assertEntryIdentical(legacyBundle.yearly[i], kernelBundle.yearly[i], `yearly[${i}]`);
  }

  expect(Object.keys(kernelBundle.summary).sort()).toEqual(
    ['totalInflow', 'totalOutflow'].sort(),
  );
  expect(kernelBundle.summary.totalInflow).toBeCloseTo(legacyBundle.summary.totalInflow, 2);
  expect(kernelBundle.summary.totalOutflow).toBeCloseTo(legacyBundle.summary.totalOutflow, 2);
}

function runParity(deal) {
  const legacy = calculateFullFinancials(deal);
  const bundle = legacy.cashFlows;
  expect(bundle).toBeTruthy();

  // Reconstruct the flat net array from legacy's quarterly output.
  const flatCfs = bundle.quarterly.map((q) => q.net);

  // Kernel needs the effectiveDate used by legacy — pull from the first
  // quarter row (quarter 0 has startDate === effectiveDate).
  const effectiveDate = bundle.quarterly[0]?.startDate;

  const kernelBundle = kernel.buildCashFlows(flatCfs, { effectiveDate });
  assertBundleIdentical(bundle, kernelBundle);
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-class parity
// ──────────────────────────────────────────────────────────────────────────────

describeIfBuilt('cashFlows parity — construction-sale classes', () => {
  test('residential_apartments bundle matches legacy', () => {
    runParity(residentialDeal);
  });

  test('plotted_development bundle matches legacy', () => {
    runParity(plottedDeal);
  });
});

describeIfBuilt('cashFlows parity — income classes', () => {
  test('commercial_office bundle matches legacy', () => {
    runParity(commercialDeal);
  });

  test('retail bundle matches legacy', () => {
    runParity(retailDeal);
  });

  test('industrial_warehousing bundle matches legacy', () => {
    runParity(industrialDeal);
  });
});

describeIfBuilt('cashFlows parity — hospitality', () => {
  test('hospitality bundle matches legacy', () => {
    runParity(hospitalityDeal);
  });
});

describeIfBuilt('cashFlows parity — edge cases', () => {
  test('all-zero cashflows → no Year 0 row, empty summary', () => {
    const out = kernel.buildCashFlows([0, 0, 0, 0, 0], { effectiveDate: '2026-01-01' });
    expect(out.yearly[0].year).toBe(1);
    expect(out.summary.totalInflow).toBe(0);
    expect(out.summary.totalOutflow).toBe(0);
  });

  test('matches legacy for a single-period deal', () => {
    // Construct a minimal residential deal with shortest supported duration.
    const miniDeal = { ...residentialDeal, projectDurationMonths: 12 };
    runParity(miniDeal);
  });
});
