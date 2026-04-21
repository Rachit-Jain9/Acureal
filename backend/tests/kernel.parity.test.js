/**
 * Parity harness: legacy JS engine vs TS financial-kernel v2, across every
 * asset class handled by both engines.
 *
 * The 2026-04-21 roast's top cleanup ask is "delete the legacy JS engine once
 * v2 parity is 100%." This harness is the gate. For each canonical deal we
 * split KPI checks into two groups:
 *
 *   1. HARD ASSERTIONS — KPIs that already match (revenue, stamp duty, GST,
 *      result shape). Any regression fails CI.
 *   2. PARITY REPORT   — KPIs that may diverge (totalCost, grossMargin, RLV,
 *      NOI / yield for income classes, etc.). Deltas are logged so the
 *      engineering team tracks the gap over time. They do NOT fail the build.
 *
 * When every delta in the PARITY REPORT is within epsilon for every asset
 * class, the log lines can be promoted to hard assertions — that is the
 * green light to delete `backend/src/engines/financial.engine.js`. See
 * `docs/CLEANUP_INVENTORY.md` for the deletion plan.
 *
 * Status post 2026-04-21 finance-cost alignment:
 *   residential_apartments   — HARD (all match within epsilon)
 *   plotted_development      — HARD (all match within epsilon)
 *   commercial_office        — PARITY REPORT (income-class KPIs still align)
 *   retail                   — PARITY REPORT
 *   industrial_warehousing   — PARITY REPORT
 *   hospitality              — PARITY REPORT
 *
 * Run: `cd backend && npm test -- kernel.parity.test.js`
 */
'use strict';

const path = require('path');
const { calculateFullFinancials } = require('../src/engines/financial.engine');

let kernel;
try {
  kernel = require(path.join(
    __dirname,
    '..',
    '..',
    'packages',
    'financial-kernel',
    'dist',
  ));
} catch (err) {
  kernel = null;
  // eslint-disable-next-line no-console
  console.warn(
    '[kernel.parity.test] financial-kernel dist/ not built. Run:\n' +
      '  cd packages/financial-kernel && npx tsc -p tsconfig.build.json\n' +
      'then re-run this suite.',
  );
}

const describeIfBuilt = kernel ? describe : describe.skip;

// ──────────────────────────────────────────────────────────────────────────────
// Canonical deals. Deliberately plausible but not precise to any real deal.
// These exercise the main code paths, not edge cases.
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
  constructionCostPerKey: 9_500_000,
  landCostCr: 60,
  preOpeningCostPerKey: 350_000,
  adr: 7_500,
  adrGrowthPct: 5,
  stabilizedOccPct: 68,
  holdPeriodYears: 8,
  fbRevPct: 28,
  otherRevPct: 10,
  gopMarginPct: 36,
  ebitdaMarginPct: 28,
  exitCapRate: 9,
  discountRatePct: 15,
  projectDurationMonths: 30,
  approvalCostCr: 3,
  skipSensitivity: true,
});

// ──────────────────────────────────────────────────────────────────────────────
// Parity helpers
// ──────────────────────────────────────────────────────────────────────────────

const EPS = Object.freeze({
  moneyCr: 0.5,
  marginPct: 1.0,
  rlvCr: 5.0,
  yieldPct: 0.5,
});

const toNum = (v) => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const readKernelMoney = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toNumber === 'function') return v.toNumber();
  return toNum(v);
};

const report = (label, legacyVal, kernelVal, eps) => {
  const delta = legacyVal != null && kernelVal != null
    ? Math.abs(legacyVal - kernelVal)
    : null;
  const status = delta == null ? 'N/A' : delta <= eps ? 'PASS' : 'DIVERGES';
  const fmt = (v) =>
    v == null ? 'null' : typeof v === 'number' ? v.toFixed(4) : String(v);
  // eslint-disable-next-line no-console
  console.log(
    `[parity] ${label.padEnd(24)} legacy=${fmt(legacyVal).padStart(12)} ` +
      `kernel=${fmt(kernelVal).padStart(12)} Δ=${
        delta == null ? '   N/A' : delta.toFixed(4).padStart(8)
      } [${status}]`,
  );
  return { status, delta };
};

function runBoth(raw) {
  const legacy = calculateFullFinancials(raw);
  const kernelResult = kernel.computeDeal({ assetClass: raw.assetClass, raw });
  return { legacy, kernelResult };
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-class parity suites
// ──────────────────────────────────────────────────────────────────────────────

describeIfBuilt('kernel parity — residential_apartments', () => {
  let legacy;
  let kr;
  beforeAll(() => {
    ({ legacy, kernelResult: kr } = runBoth(residentialDeal));
  });

  test('shape: both engines populate a result', () => {
    expect(legacy).toBeTruthy();
    expect(kr && kr.kpis && kr.costs).toBeTruthy();
  });

  test('revenue matches', () => {
    const l = toNum(legacy.totalRevenueCr);
    const k = readKernelMoney(kr.kpis.revenue);
    expect(Math.abs(l - k)).toBeLessThanOrEqual(EPS.moneyCr);
  });

  test('stamp duty matches', () => {
    const l = toNum(legacy.stampDutyCr ?? legacy.costs?.stampDuty);
    const k = readKernelMoney(kr.costs.stampDutyCr);
    expect(Math.abs(l - k)).toBeLessThanOrEqual(0.05);
  });

  test('GST matches', () => {
    const l = toNum(legacy.gstCostCr ?? legacy.costs?.gst);
    const k = readKernelMoney(kr.costs.gstCr);
    expect(Math.abs(l - k)).toBeLessThanOrEqual(EPS.moneyCr);
  });

  // Post 2026-04-21 alignment: these now pass within epsilon.
  test('totalCost matches within epsilon', () => {
    const l = toNum(legacy.totalCostCr);
    const k = readKernelMoney(kr.kpis.totalCost);
    const { status } = report('totalCostCr', l, k, EPS.moneyCr);
    expect(status).toBe('PASS');
  });

  test('grossMargin matches within epsilon', () => {
    const l = toNum(legacy.grossMarginPct);
    const k = kr.kpis.grossMarginPct;
    const { status } = report('grossMarginPct', l, k, EPS.marginPct);
    expect(status).toBe('PASS');
  });

  test('residualLandValue matches within epsilon', () => {
    const l = toNum(legacy.residualLandValueCr);
    const k = readKernelMoney(kr.kpis.residualLandValue);
    const { status } = report('residualLandValueCr', l, k, EPS.rlvCr);
    expect(status).toBe('PASS');
  });
});

describeIfBuilt('kernel parity — plotted_development', () => {
  let legacy;
  let kr;
  beforeAll(() => {
    ({ legacy, kernelResult: kr } = runBoth(plottedDeal));
  });

  test('shape: both engines populate a result', () => {
    expect(legacy).toBeTruthy();
    expect(kr && kr.kpis).toBeTruthy();
  });

  test('revenue matches', () => {
    const l = toNum(legacy.totalRevenueCr);
    const k = readKernelMoney(kr.kpis.revenue);
    expect(Math.abs(l - k)).toBeLessThanOrEqual(EPS.moneyCr);
  });

  test('totalCost matches within epsilon', () => {
    const l = toNum(legacy.totalCostCr);
    const k = readKernelMoney(kr.kpis.totalCost);
    const { status } = report('totalCostCr', l, k, EPS.moneyCr);
    expect(status).toBe('PASS');
  });

  test('grossMargin matches within epsilon', () => {
    const l = toNum(legacy.grossMarginPct);
    const k = kr.kpis.grossMarginPct;
    const { status } = report('grossMarginPct', l, k, EPS.marginPct);
    expect(status).toBe('PASS');
  });
});

function incomeClassSuite(label, raw) {
  describeIfBuilt(`kernel parity — ${label}`, () => {
    let legacy;
    let kr;
    beforeAll(() => {
      ({ legacy, kernelResult: kr } = runBoth(raw));
    });

    test('shape: both engines populate a result', () => {
      expect(legacy).toBeTruthy();
      expect(kr && kr.kpis).toBeTruthy();
    });

    test('totalCost matches within epsilon', () => {
      const l = toNum(legacy.totalCostCr);
      const k = readKernelMoney(kr.kpis.totalCost);
      const { status } = report('totalCostCr', l, k, EPS.moneyCr);
      expect(status).toBe('PASS');
    });

    test('revenue matches within epsilon', () => {
      const l = toNum(legacy.totalRevenueCr);
      const k = readKernelMoney(kr.kpis.revenue);
      const { status } = report('revenue (exit+NOI)', l, k, EPS.moneyCr);
      expect(status).toBe('PASS');
    });

    test('stabilized NOI matches within epsilon', () => {
      const extras = kr.kpis.extras || {};
      // Legacy exposes NOI inside `kpis.noi`; kernel exposes it at `kpis.extras.noi`.
      const l = toNum(legacy.kpis?.noi ?? legacy.stabilizedNOICr);
      const k = extras.noi != null ? toNum(extras.noi) : null;
      const { status } = report('stabilizedNOI', l, k, EPS.moneyCr);
      expect(status).toBe('PASS');
    });

    test('yield-on-cost matches within epsilon', () => {
      const extras = kr.kpis.extras || {};
      const l = toNum(legacy.kpis?.yieldOnCost ?? legacy.yieldOnCostPct);
      const k = extras.yieldOnCost != null ? toNum(extras.yieldOnCost) : null;
      const { status } = report('yieldOnCostPct', l, k, EPS.yieldPct);
      expect(status).toBe('PASS');
    });
  });
}

incomeClassSuite('commercial_office', commercialDeal);
incomeClassSuite('retail', retailDeal);
incomeClassSuite('industrial_warehousing', industrialDeal);

describeIfBuilt('kernel parity — hospitality', () => {
  let legacy;
  let kr;
  beforeAll(() => {
    ({ legacy, kernelResult: kr } = runBoth(hospitalityDeal));
  });

  test('shape: both engines populate a result', () => {
    expect(legacy).toBeTruthy();
    expect(kr && kr.kpis).toBeTruthy();
  });

  test('parity report: hospitality KPIs', () => {
    const l1 = toNum(legacy.totalCostCr);
    const k1 = readKernelMoney(kr.kpis.totalCost);
    report('totalCostCr', l1, k1, EPS.moneyCr);

    const l2 = toNum(legacy.totalRevenueCr);
    const k2 = readKernelMoney(kr.kpis.revenue);
    report('revenue (exit+cash)', l2, k2, EPS.moneyCr);

    const extras = kr.kpis.extras || {};
    const l3 = toNum(legacy.revPAR ?? legacy.kpis?.revPAR);
    const k3 = extras.revPar != null ? toNum(extras.revPar) : null;
    report('revPAR', l3, k3, 10); // ₹/room·night — wider eps in absolute units

    const l4 = toNum(legacy.stabilizedEBITDACr ?? legacy.stabilizedNOICr);
    const k4 = extras.ebitda != null ? toNum(extras.ebitda)
      : extras.noi != null ? toNum(extras.noi) : null;
    report('ebitdaCr', l4, k4, EPS.moneyCr);

    const l5 = toNum(legacy.grossMarginPct);
    const k5 = kr.kpis.grossMarginPct;
    report('grossMarginPct', l5, k5, EPS.marginPct);

    expect(l1).not.toBeNull();
    expect(k1).not.toBeNull();
  });
});
