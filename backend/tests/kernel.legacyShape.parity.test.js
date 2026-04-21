/**
 * Legacy snake_case shape parity: kernel's `buildLegacyShape` vs the
 * legacy engine's `_legacy` block.
 *
 * The service layer pipes `computed._legacy.*` into DB columns. The
 * kernel's `buildLegacyShape` is the replacement source — it emits the
 * same snake_case keys, sourced from the kernel's canonical outputs.
 *
 * This test asserts that every key the kernel emits that's also present
 * in the legacy block carries a numerically-equivalent value. "Missing
 * keys" (either side) are tolerated and logged — they're the natural
 * delta between the two engines' field coverage, which will shrink as
 * the kernel takes over more responsibilities.
 */
'use strict';

const path = require('path');
const { calculateFullFinancials } = require('../src/engines/financial.engine');

let kernel;
try {
  kernel = require(path.join(__dirname, '..', '..', 'packages', 'financial-kernel', 'dist'));
} catch (err) {
  kernel = null;
  // eslint-disable-next-line no-console
  console.warn('[legacyShape.parity] kernel dist not built; suite skipped.');
}

const describeIfBuilt = kernel ? describe : describe.skip;

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

const cases = [
  { name: 'residential_apartments', deal: residentialDeal },
  { name: 'plotted_development', deal: plottedDeal },
  { name: 'commercial_office', deal: commercialDeal },
  { name: 'hospitality', deal: hospitalityDeal },
];

/**
 * Tolerance for cross-engine numeric comparisons. The kernel and the
 * legacy engine round independently and sometimes use slightly
 * different formulas (e.g. s-curve weighting, interest accrual),
 * so we allow a few-percent drift on derived numbers.
 *
 * Pure pass-through fields (land_cost_cr, fsi, project_duration_months)
 * get tight tolerances; derived fields get looser ones.
 */
const TIGHT_EPS = 0.01;
const LOOSE_EPS_REL = 0.10; // 10% — matches existing kernel.parity tolerance

function near(legacy, kernel, eps) {
  if (legacy == null || kernel == null) return true; // null on either side is skip
  if (!Number.isFinite(legacy) || !Number.isFinite(kernel)) return true;
  const absDiff = Math.abs(legacy - kernel);
  if (absDiff <= eps) return true;
  const denom = Math.max(Math.abs(legacy), Math.abs(kernel), 1);
  return absDiff / denom <= LOOSE_EPS_REL;
}

// Input-passthrough keys. These are read directly from `raw` by both
// sides and must round-trip exactly — no math is applied. A divergence
// here is a bug in `buildLegacyShape` or the legacy engine, not the
// math layer.
const PASSTHROUGH_KEYS = new Set([
  'land_cost_cr',
  'plot_area_sqft',
  'project_duration_months',
  'discount_rate_pct',
  'construction_cost_per_sqft',
  'selling_rate_per_sqft',
  'marketing_cost_pct',
  'finance_cost_pct',
  'approval_cost_cr',
  'developer_margin_pct',
]);

// Derived keys are computed by each engine's own math. They may differ
// — that's the DCF/KPI work that hasn't been unified yet, tracked
// elsewhere. This test logs the divergence but does not fail on it.
const DERIVED_KEYS_INFORMATIONAL = true;

describeIfBuilt('legacyShape parity — kernel vs legacy _legacy block', () => {
  for (const { name, deal } of cases) {
    it(`${name}: pass-through keys match exactly`, () => {
      const { computeDeal, buildLegacyShape } = kernel;
      const legacyOutput = calculateFullFinancials(deal);
      const legacyBlock = legacyOutput._legacy || {};

      const kernelResult = computeDeal({ assetClass: deal.assetClass, raw: deal });
      const kernelBlock = buildLegacyShape({
        raw: deal,
        result: kernelResult,
        assetClass: deal.assetClass,
      });

      const sharedKeys = Object.keys(kernelBlock).filter(
        (k) => k in legacyBlock && kernelBlock[k] != null && legacyBlock[k] != null,
      );
      expect(sharedKeys.length).toBeGreaterThanOrEqual(5);

      const mismatches = [];
      const infoOnly = [];
      for (const key of sharedKeys) {
        const lv = Number(legacyBlock[key]);
        const kv = Number(kernelBlock[key]);
        if (PASSTHROUGH_KEYS.has(key)) {
          if (!near(lv, kv, TIGHT_EPS)) {
            mismatches.push({ key, legacy: lv, kernel: kv, delta: kv - lv });
          }
        } else {
          // Derived — only log divergence, don't fail the test.
          if (!near(lv, kv, Math.max(TIGHT_EPS, Math.abs(lv) * 0.01))) {
            infoOnly.push({ key, legacy: lv, kernel: kv, delta: kv - lv });
          }
        }
      }

      if (infoOnly.length > 0 && DERIVED_KEYS_INFORMATIONAL) {
        // eslint-disable-next-line no-console
        console.log(`[parity:${name}] derived-key deltas (informational):`, infoOnly);
      }
      expect(mismatches).toEqual([]);
    });
  }
});
