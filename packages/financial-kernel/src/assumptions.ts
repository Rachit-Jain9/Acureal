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
import {
  GLOBAL_DEFAULTS_VALUES,
  ASSET_DEFAULTS_VALUES,
} from './config/defaults';

// ─────────────────────────────────────────────────────────────────────────────
//  Global defaults + per-asset overrides are sourced from the single
//  registry at `config/defaults.ts`. The value-only projections preserve
//  the legacy `Readonly<Record<string, number>>` shape so every existing
//  import site (kernel adapters, tests, service layer) continues working
//  unchanged. The registry carries metadata (unit, range, source,
//  lastReviewed) that the UI can surface via `getAssetDefaultsMeta`.
// ─────────────────────────────────────────────────────────────────────────────

export const GLOBAL_DEFAULTS: Readonly<Record<string, number>> =
  GLOBAL_DEFAULTS_VALUES;

/** Asset-class-specific overrides applied on top of `GLOBAL_DEFAULTS`. */
export const ASSET_DEFAULTS: Readonly<
  Record<AssetClass, Readonly<Record<string, number>>>
> = ASSET_DEFAULTS_VALUES;

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
