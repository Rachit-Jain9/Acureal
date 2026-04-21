/**
 * Parity harness: legacy JS engine vs TS financial-kernel v2.
 *
 * The roast's top cleanup ask is "delete the legacy JS engine once v2 parity
 * is 100%." This harness is the gate. It runs one canonical deal through both
 * engines and splits the KPI checks into two groups:
 *
 *   1. HARD ASSERTIONS — KPIs that already match (revenue, stamp duty, GST,
 *      result-shape). Any regression here fails CI.
 *   2. PARITY REPORT   — KPIs that currently diverge (totalCost, grossMargin,
 *      RLV). These are logged with the actual delta so the engineering team
 *      can track the gap as parity improves. They do NOT fail the build.
 *
 * Once every delta in the PARITY REPORT is within epsilon, the reports can
 * be promoted to hard assertions, and that is the green light to delete
 * `backend/src/engines/financial.engine.js`. See
 * `docs/CLEANUP_INVENTORY.md` for the deletion plan.
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

/**
 * Canonical Bengaluru residential apartment deal. Deliberately vanilla so
 * any divergence between engines is about math, not edge cases.
 */
const RESIDENTIAL_INPUT = Object.freeze({
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

const EPS_MONEY_CR = 0.5;
const EPS_MARGIN_PCT = 1.0;
const EPS_RLV_CR = 5;

const toNum = (v) => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const report = (label, legacyVal, kernelVal, eps) => {
  const delta = legacyVal != null && kernelVal != null
    ? Math.abs(legacyVal - kernelVal)
    : null;
  const status = delta == null ? 'N/A' : delta <= eps ? 'PASS' : 'DIVERGES';
  // eslint-disable-next-line no-console
  console.log(
    `[parity] ${label.padEnd(22)} legacy=${String(legacyVal).padStart(10)} ` +
      `kernel=${String(kernelVal).padStart(10)} Δ=${delta == null ? 'N/A' : delta.toFixed(3)} [${status}]`,
  );
  return status;
};

describeIfBuilt('kernel parity — residential_apartments', () => {
  let legacy;
  let kernelResult;

  beforeAll(() => {
    legacy = calculateFullFinancials(RESIDENTIAL_INPUT);
    kernelResult = kernel.computeDeal({
      assetClass: 'residential_apartments',
      raw: RESIDENTIAL_INPUT,
    });
  });

  // ── HARD ASSERTIONS ───────────────────────────────────────────────────────
  //   These already match today. Any regression must fail CI.

  test('both engines produce a populated result', () => {
    expect(legacy).toBeTruthy();
    expect(kernelResult).toBeTruthy();
    expect(kernelResult.kpis).toBeDefined();
    expect(kernelResult.costs).toBeDefined();
  });

  test('total revenue matches within epsilon', () => {
    const legacyRev = toNum(legacy.totalRevenueCr ?? legacy.revenue?.totalRevenueCr);
    const kernelRev = kernelResult.kpis.revenue.toNumber();
    expect(legacyRev).not.toBeNull();
    expect(Math.abs(legacyRev - kernelRev)).toBeLessThanOrEqual(EPS_MONEY_CR);
  });

  test('stamp duty matches (single-source-of-truth rate)', () => {
    const legacyStamp = toNum(legacy.stampDutyCr ?? legacy.costs?.stampDuty);
    const kernelStamp = kernelResult.costs.stampDutyCr.toNumber();
    expect(Math.abs(legacyStamp - kernelStamp)).toBeLessThanOrEqual(0.05);
  });

  test('GST matches (single-source-of-truth rate)', () => {
    const legacyGst = toNum(legacy.gstCostCr ?? legacy.costs?.gst);
    const kernelGst = kernelResult.costs.gstCr.toNumber();
    expect(Math.abs(legacyGst - kernelGst)).toBeLessThanOrEqual(EPS_MONEY_CR);
  });

  // ── PARITY REPORT ─────────────────────────────────────────────────────────
  //   These KPIs diverge today. The test logs the actual delta so the gap
  //   is visible in CI output, but does not fail. Promote to hard assertions
  //   once the divergence is closed.

  test('parity report: totalCost, grossMargin, RLV', () => {
    const legacyCost = toNum(legacy.totalCostCr ?? legacy.costs?.total);
    const kernelCost = kernelResult.kpis.totalCost.toNumber();
    report('totalCostCr', legacyCost, kernelCost, EPS_MONEY_CR);

    const legacyMargin = toNum(legacy.grossMarginPct ?? legacy.kpis?.grossMarginPct);
    const kernelMargin = kernelResult.kpis.grossMarginPct;
    report('grossMarginPct', legacyMargin, kernelMargin, EPS_MARGIN_PCT);

    const legacyRlv = toNum(legacy.residualLandValueCr ?? legacy.kpis?.rlv);
    const kernelRlv = kernelResult.kpis.residualLandValue
      ? kernelResult.kpis.residualLandValue.toNumber()
      : null;
    report('residualLandValueCr', legacyRlv, kernelRlv, EPS_RLV_CR);

    // Asserting only that both engines produce numeric values for every KPI;
    // the magnitudes are tracked in the log lines above.
    expect(legacyCost).not.toBeNull();
    expect(kernelCost).not.toBeNull();
    expect(legacyMargin).not.toBeNull();
    expect(kernelMargin).not.toBeNull();
    expect(legacyRlv).not.toBeNull();
    expect(kernelRlv).not.toBeNull();
  });
});
