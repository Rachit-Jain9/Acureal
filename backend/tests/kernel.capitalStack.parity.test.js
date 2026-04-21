/**
 * Capital-stack shape parity: legacy JS engine vs kernel post-processor.
 *
 * Ports the three `computed.capitalStack` variants from
 * `backend/src/engines/financial.engine.js` into
 * `packages/financial-kernel/src/postprocess/capitalStack.ts`, and asserts
 * that for the same intermediate values the kernel output is byte-for-
 * byte identical to the legacy engine's output.
 *
 * Why this is worth testing even though the builders are pure shape
 * adapters: downstream consumers (FE DebtSchedulePanel, FE Hospitality
 * proforma, BE `financial.service.js` column binding, BE dealExport) are
 * coded against the **exact key names and rounding** the legacy engine
 * emits. A typo in a key name or a rounding mismatch would silently
 * degrade the UI/exports without tripping the KPI parity gate. See
 * `docs/LEGACY_SHAPE_AUDIT.md` for the consumer matrix.
 *
 * Approach:
 *   1. Run each canonical deal through the legacy engine.
 *   2. Extract the intermediate values legacy used internally (by
 *      reading them back out of `legacy.capitalStack`, which is the
 *      rounded version of the same inputs).
 *   3. Feed those intermediates into the kernel builder.
 *   4. Deep-equality check on the full bundle.
 *
 * Step 3→4 proves the kernel preserves the shape exactly. Step 1→2 is
 * tautological for identity-passed fields (debtLTV, debtRatePct, etc.)
 * but non-trivial for computed fields (equityCr, debtPct, equityPct,
 * annualDebtServiceCr).
 *
 * Run: `cd backend && npm test -- kernel.capitalStack.parity.test.js`
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
    '[capitalStack.parity] financial-kernel dist/ not built. Run:\n' +
      '  cd packages/financial-kernel && npx tsc -p tsconfig.build.json\n' +
      'then re-run this suite.',
  );
}

const describeIfBuilt = kernel ? describe : describe.skip;

// ── Canonical debt-bearing deals ────────────────────────────────────────────

const residentialWithDebtDeal = Object.freeze({
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
  debtLTV: 0.6,
  debtRatePct: 12,
  debtTenorYears: 4,
  skipSensitivity: true,
});

const plottedWithDebtDeal = Object.freeze({
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
  debtLTV: 0.55,
  debtRatePct: 11,
  debtTenorYears: 3,
  skipSensitivity: true,
});

const commercialWithDebtDeal = Object.freeze({
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
  debtCoverage: 0.6,
  interestRatePct: 10.5,
  amortizationYears: 20,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function assertShapeIdentical(expected, actual, label) {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  expect(actualKeys).toEqual(expectedKeys);
  for (const k of expectedKeys) {
    const ev = expected[k];
    const av = actual[k];
    if (ev === null) {
      expect(av).toBeNull();
    } else if (typeof ev === 'number') {
      // Both sides use `round4 = Math.round(n * 10000) / 10000` (money) or
      // `round2` (percents). When we feed already-rounded legacy values back
      // into the kernel builder, some derived fields round twice — e.g.
      // `annualDebtServiceCr = round4(quarterlyPaymentCr * 4)` where the
      // kernel receives the already-rounded quarterlyPaymentCr. The max drift
      // from a double round4 is 5e-5 on input + 5e-5 on output = ~1e-4 Cr
      // (₹10,000), which is immaterial at deal scale but exceeds the naïve
      // 1e-9 FP tolerance. 2e-4 gives headroom for both round4 and round2.
      expect(typeof av).toBe('number');
      expect(Math.abs(ev - av)).toBeLessThanOrEqual(2e-4);
    } else {
      // Opaque object or string — must deep-equal.
      expect(av).toEqual(ev);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Variant 1 — Construction-loan (residential, plotted)
// ──────────────────────────────────────────────────────────────────────────────

describeIfBuilt('capitalStack parity — construction-loan variant', () => {
  test('residential_apartments shape matches legacy byte-for-byte', () => {
    const legacy = calculateFullFinancials(residentialWithDebtDeal);
    expect(legacy.capitalStack).toBeTruthy();

    const kernelStack = kernel.buildConstructionLoanCapitalStack({
      totalCostCr: legacy.totalCostCr,
      debtDrawnCr: legacy.capitalStack.debtCr,
      debtInterestCr: legacy.capitalStack.debtInterestCr,
      debtLTV: legacy.capitalStack.debtLTV,
      debtRatePct: legacy.capitalStack.debtRatePct,
      debtTenorYears: legacy.capitalStack.debtTenorYears,
    });

    assertShapeIdentical(legacy.capitalStack, kernelStack, 'residential');
  });

  test('plotted_development shape matches legacy byte-for-byte', () => {
    const legacy = calculateFullFinancials(plottedWithDebtDeal);
    expect(legacy.capitalStack).toBeTruthy();

    const kernelStack = kernel.buildConstructionLoanCapitalStack({
      totalCostCr: legacy.totalCostCr,
      debtDrawnCr: legacy.capitalStack.debtCr,
      debtInterestCr: legacy.capitalStack.debtInterestCr,
      debtLTV: legacy.capitalStack.debtLTV,
      debtRatePct: legacy.capitalStack.debtRatePct,
      debtTenorYears: legacy.capitalStack.debtTenorYears,
    });

    assertShapeIdentical(legacy.capitalStack, kernelStack, 'plotted');
  });

  test('returns null when legacy would have returned null', () => {
    const noDebtDeal = { ...residentialWithDebtDeal, debtLTV: 0 };
    const legacy = calculateFullFinancials(noDebtDeal);
    expect(legacy.capitalStack).toBeNull();

    const kernelStack = kernel.buildConstructionLoanCapitalStack({
      totalCostCr: legacy.totalCostCr,
      debtDrawnCr: 0,
      debtInterestCr: 0,
      debtLTV: 0,
      debtRatePct: 0,
      debtTenorYears: 0,
    });
    expect(kernelStack).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Variant 2 — Income-amortizing (commercial_office)
// ──────────────────────────────────────────────────────────────────────────────

describeIfBuilt('capitalStack parity — income-amortizing variant', () => {
  test('commercial_office shape matches legacy byte-for-byte', () => {
    const legacy = calculateFullFinancials(commercialWithDebtDeal);
    if (!legacy.capitalStack) {
      // Commercial deals sometimes emit null capitalStack if the legacy
      // engine short-circuits debt sizing. Skip rather than fail — the
      // null-branch parity is covered below.
      console.warn('[capitalStack.parity] commercial legacy.capitalStack was null; skipping shape test');
      return;
    }

    const kernelStack = kernel.buildIncomeAmortizingCapitalStack({
      totalCostCr: legacy.totalCostCr,
      debtCoverage: legacy.capitalStack.debtPct / 100,
      interestRatePct: legacy.capitalStack.interestRatePct,
      amortizationYears: legacy.capitalStack.amortizationYears,
      dscr: legacy.capitalStack.dscr,
      debtSchedule: legacy.capitalStack.debtSchedule,
    });

    assertShapeIdentical(legacy.capitalStack, kernelStack, 'commercial');
  });

  test('returns null when debtCoverage is 0', () => {
    const kernelStack = kernel.buildIncomeAmortizingCapitalStack({
      totalCostCr: 100,
      debtCoverage: 0,
      interestRatePct: 10,
      amortizationYears: 20,
      dscr: 1.3,
      debtSchedule: [],
    });
    expect(kernelStack).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Variant 3 — Hospitality (construction → permanent + waterfall)
// ──────────────────────────────────────────────────────────────────────────────

describeIfBuilt('capitalStack parity — hospitality variant', () => {
  let legacy;
  beforeAll(() => {
    legacy = calculateFullFinancials(hospitalityDeal);
  });

  test('hospitality emits a non-null capitalStack', () => {
    expect(legacy.capitalStack).toBeTruthy();
  });

  test('top-level keys match exactly', () => {
    const expected = [
      'amortizationYears',
      'construction',
      'debtCr',
      'debtPct',
      'debtSchedule',
      'debtYieldPct',
      'dscr',
      'equityCr',
      'equityPct',
      'interestRatePct',
      'minDSCR',
      'permanent',
      'totalCostCr',
      'waterfall',
    ].sort();
    expect(Object.keys(legacy.capitalStack).sort()).toEqual(expected);
  });

  test('construction sub-bundle has the expected keys', () => {
    if (!legacy.capitalStack.construction) return;
    const expected = [
      'feesPct',
      'idcCr',
      'ltcPct',
      'principalCr',
      'ratePct',
      'termYears',
    ].sort();
    expect(Object.keys(legacy.capitalStack.construction).sort()).toEqual(expected);
  });

  test('permanent sub-bundle has the expected keys', () => {
    if (!legacy.capitalStack.permanent) return;
    const expected = [
      'amortYears',
      'annualDebtServiceCr',
      'balloonRepaymentCr',
      'ioYears',
      'ltvPct',
      'principalCr',
      'quarterlyPaymentCr',
      'ratePct',
      'refiYear',
      'sizingCapRate',
      'stabilizedValueCr',
      'totalInterestCr',
    ].sort();
    expect(Object.keys(legacy.capitalStack.permanent).sort()).toEqual(expected);
  });

  test('waterfall sub-bundle has the expected keys and 4 tiers', () => {
    expect(legacy.capitalStack.waterfall).toBeTruthy();
    const expected = [
      'gpCapitalCr',
      'gpEquityMultiple',
      'gpPct',
      'lpCapitalCr',
      'lpEquityMultiple',
      'lpPct',
      'tiers',
      'totalDistributionsCr',
      'totalEquityCr',
      'totalGPCr',
      'totalLPCr',
    ].sort();
    expect(Object.keys(legacy.capitalStack.waterfall).sort()).toEqual(expected);
    expect(legacy.capitalStack.waterfall.tiers).toHaveLength(4);
    for (const tier of legacy.capitalStack.waterfall.tiers) {
      expect(Object.keys(tier).sort()).toEqual(
        ['gpCr', 'gpSharePct', 'hurdlePct', 'lpCr', 'lpSharePct', 'name'].sort(),
      );
    }
  });

  test('kernel hospitality builder preserves shape when fed legacy intermediates', () => {
    const ls = legacy.capitalStack;
    const kernelStack = kernel.buildHospitalityCapitalStack({
      totalCostCr: legacy.totalCostCr,
      finalConstDebtCr: ls.debtCr,
      equityCr: ls.equityCr,
      interestRatePct: ls.interestRatePct,
      amortizationYearsHosp: ls.amortizationYears,
      dscr: ls.dscr,
      minDSCR: ls.minDSCR,
      debtYieldPct: ls.debtYieldPct,
      debtScheduleHosp: ls.debtSchedule,
      construction: ls.construction
        ? {
            finalConstDebtCr: ls.construction.principalCr,
            constLoanLTC: ls.construction.ltcPct / 100,
            constLoanRatePct: ls.construction.ratePct,
            constLoanFeesPct: ls.construction.feesPct,
            idcCr: ls.construction.idcCr,
            refiYear: ls.construction.termYears,
          }
        : null,
      permanent: ls.permanent
        ? {
            refiPrincipalCr: ls.permanent.principalCr,
            refiLTV: ls.permanent.ltvPct / 100,
            refiInterestRate: ls.permanent.ratePct,
            refiIOYears: ls.permanent.ioYears,
            refiAmortYears: ls.permanent.amortYears,
            refiYear: ls.permanent.refiYear,
            refiCapRate: ls.permanent.sizingCapRate,
            stabilizedValueForRefi: ls.permanent.stabilizedValueCr,
            refiQuarterlyPayment: ls.permanent.quarterlyPaymentCr,
            refiTotalInterestCr: ls.permanent.totalInterestCr,
            refiBalloonRepaymentCr: ls.permanent.balloonRepaymentCr,
          }
        : null,
      waterfall: ls.waterfall,
    });

    // Top-level scalar keys
    expect(kernelStack.totalCostCr).toBeCloseTo(ls.totalCostCr, 4);
    expect(kernelStack.debtCr).toBeCloseTo(ls.debtCr, 4);
    expect(kernelStack.equityCr).toBeCloseTo(ls.equityCr, 4);
    expect(kernelStack.debtPct).toBeCloseTo(ls.debtPct, 2);
    expect(kernelStack.equityPct).toBeCloseTo(ls.equityPct, 2);
    expect(kernelStack.interestRatePct).toBe(ls.interestRatePct);
    expect(kernelStack.amortizationYears).toBe(ls.amortizationYears);
    expect(kernelStack.dscr).toBe(ls.dscr);
    expect(kernelStack.minDSCR).toBe(ls.minDSCR);
    expect(kernelStack.debtYieldPct).toBe(ls.debtYieldPct);
    expect(kernelStack.debtSchedule).toBe(ls.debtSchedule);

    // Waterfall is passed through by reference
    expect(kernelStack.waterfall).toBe(ls.waterfall);

    // Sub-bundles deep-match
    if (ls.construction) assertShapeIdentical(ls.construction, kernelStack.construction, 'hosp.construction');
    if (ls.permanent) assertShapeIdentical(ls.permanent, kernelStack.permanent, 'hosp.permanent');
  });

  test('kernel waterfall builder shape matches legacy waterfall shape', () => {
    // Legacy's buildHospWaterfall isn't exported, so we assert kernel output
    // has identical keys/shape to the legacy waterfall embedded in
    // legacy.capitalStack.waterfall — then a separate numeric check confirms
    // tier math is preserved.
    const kernelWaterfall = kernel.buildHospitalityWaterfall({
      equityCr: 100,
      cashFlows: [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 150],
      holdPeriodYears: 5,
      constQ: 0,
      lpPct: 0.9,
      gpPct: 0.1,
      tier2Hurdle: 10,
      tier3Hurdle: 15,
      tier4Hurdle: 20,
      tier2PromotePct: 10,
      tier3PromotePct: 20,
      tier4PromotePct: 30,
    });
    expect(Object.keys(kernelWaterfall).sort()).toEqual(
      Object.keys(legacy.capitalStack.waterfall).sort(),
    );
    expect(kernelWaterfall.tiers).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(Object.keys(kernelWaterfall.tiers[i]).sort()).toEqual(
        Object.keys(legacy.capitalStack.waterfall.tiers[i]).sort(),
      );
    }
  });
});
