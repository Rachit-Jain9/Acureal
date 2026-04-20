/**
 * Assumption hierarchy — global → deal → scenario.
 *
 * The kernel sees a single merged `AssumptionSet` when it runs. The
 * three-tier structure lets the rest of the app carry sensible
 * Bengaluru-shaped defaults once, then override them per deal (e.g. a
 * land-heavy transaction with different stamp duty) or per scenario
 * (e.g. a "bear case" with lower selling rate).
 *
 * Values in later layers overwrite earlier ones. `null`/`undefined`
 * values in a layer are treated as "no override" so a scenario can
 * selectively clear a deal override by setting it to `null`.
 */

import type { AssetClass, AssumptionSet } from './types';

// ─────────────────────────────────────────────────────────────────────────────
//  Global defaults — Bengaluru / India first.
//  These are deliberately conservative; specific deals override them.
// ─────────────────────────────────────────────────────────────────────────────

export const GLOBAL_DEFAULTS: Readonly<Record<string, number>> = Object.freeze({
  stampDutyPct: 5,
  registrationPct: 1,
  gstOnConstructionPct: 18, // adapter applies 0 for land_parcel / 12 for plotted
  marketingCostPct: 4,
  financeCostPct: 12,
  architectFeePct: 2,
  pmcFeePct: 1.5,
  contingencyPct: 5,
  developerMarginPct: 20,
  discountRatePct: 14,
  loadingFactor: 0.15,
  carpetRatio: 0.7,

  // Income-asset defaults
  vacancyPct: 10,
  opexPct: 20,
  rentEscalationPct: 5,
  exitCapRatePct: 8,
  entryCapRatePct: 8,
  holdPeriodYears: 5,

  // Hospitality defaults
  stabilizedOccPct: 65,
  adrGrowthPct: 5,
  fbRevPct: 25,
  otherRevPct: 10,
  gopMarginPct: 35,
  ebitdaMarginPct: 28,

  // Land parcel
  landAppreciationPct: 8,
});

/** Asset-class-specific overrides applied on top of `GLOBAL_DEFAULTS`. */
export const ASSET_DEFAULTS: Readonly<Record<AssetClass, Readonly<Record<string, number>>>> =
  Object.freeze({
    residential_apartments: Object.freeze({}),
    villas: Object.freeze({ fsi: 0.8, loadingFactor: 0.05 }),
    plotted_development: Object.freeze({ gstOnConstructionPct: 12, saleableLandPct: 55 }),
    commercial_office: Object.freeze({ vacancyPct: 10, exitCapRatePct: 7.5 }),
    retail: Object.freeze({ vacancyPct: 12, anchorPct: 40, anchorRentDiscount: 20, exitCapRatePct: 8 }),
    industrial_warehousing: Object.freeze({ vacancyPct: 8, opexPct: 15, exitCapRatePct: 8.5 }),
    hospitality: Object.freeze({ exitCapRatePct: 9, discountRatePct: 15 }),
    mixed_use: Object.freeze({}),
    land_parcel: Object.freeze({ gstOnConstructionPct: 0, stampDutyPct: 5 }),
    redevelopment: Object.freeze({}),
  });

// ─────────────────────────────────────────────────────────────────────────────
//  Merge utility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge assumption layers in order. Later arguments win, but entries
 * whose value is `null` or `undefined` are ignored so they don't clobber
 * earlier layers. This makes scenario overrides additive-and-sparse.
 */
export function mergeAssumptions(
  ...layers: ReadonlyArray<AssumptionSet | undefined | null>
): AssumptionSet {
  const out: Record<string, number | string | boolean | null | undefined> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || v === null) continue;
      out[k] = v;
    }
  }
  return Object.freeze(out);
}

/**
 * Resolve the full assumption stack for an asset class. The return value is
 * already merged and frozen, ready to feed the adapter's raw input. Order:
 *   1. GLOBAL_DEFAULTS         (Bengaluru-shaped baseline)
 *   2. ASSET_DEFAULTS[class]   (per-class tweaks)
 *   3. `dealOverrides`         (per-deal inputs — usually the UI form)
 *   4. `scenarioOverrides`     (optional scenario mutations)
 */
export function resolveAssumptions(args: {
  assetClass: AssetClass;
  dealOverrides?: AssumptionSet | null;
  scenarioOverrides?: AssumptionSet | null;
}): AssumptionSet {
  return mergeAssumptions(
    GLOBAL_DEFAULTS,
    ASSET_DEFAULTS[args.assetClass],
    args.dealOverrides ?? null,
    args.scenarioOverrides ?? null,
  );
}
