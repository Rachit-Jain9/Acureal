/**
 * Sensitivity-matrix post-processors.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────
 * Every grid is CENTRED ON THE DEAL. For any matrix this module emits,
 *
 *     irrGrid[floor(rows / 2)][floor(cols / 2)] === headline IRR
 *
 * exactly — same number the KPI tile, the IC memo and the exports show.
 * Four consumers already assume this and label that cell "Base IRR"
 * (`export.insights.service.js`, `docx/buildReport.js`, `pptx/slides.js`,
 * `reportPack/composePack.js`); the one-dimensional hospitality strips
 * apply the same rule at index 2.
 *
 * This is enforced by construction:
 *
 *   1. EVERY cell re-runs `computeDeal` with the varied inputs, so no
 *      cell can drift from the canonical model. Income and hospitality
 *      used to run their own simplified projections instead — no debt,
 *      a hardcoded occupancy ramp, quarterly rather than monthly
 *      discounting, a flat 28% NOI margin for hotels — and their centre
 *      cells read 1.2 to 3.5 points ABOVE the headline IRR on
 *      representative deals, always optimistic. An IC reading the grid
 *      centre was reading a different, rosier model than the one on the
 *      KPI tile.
 *
 *   2. Every axis is built around the deal's own value, and the centre
 *      tick is the UNROUNDED input (`exactAt`), so a rate of ₹9,487.50
 *      does not become ₹9,488 in the centre cell and quietly break the
 *      equality. The income exit-cap axis in particular used to be the
 *      absolute ladder 5/6/7/8/9% — a 7.5% deal had no cell of its own
 *      anywhere in the grid, and "Base IRR" resolved to the 7% row.
 *
 * Cost: one `computeDeal` per cell. Measured — income 5×5 ≈ 73 ms,
 * hospitality 5×5 + three strips ≈ 262 ms, residential 9×9 ≈ 83 ms.
 * Only the explicit recompute and `POST /deals/:id/sensitivity` paths
 * build matrices; every read path passes `skipSensitivity`.
 *
 * Output shape is unchanged field-for-field: `{ sellingRates,
 * constructionCosts, irrGrid, axis, variations }`, plus `occAdr`,
 * `hardCost`, `interestRate`, `capRate` for hospitality.
 */

import type { AssetClass, DealInputs } from '../types';
import { computeDeal } from '../registry';
import { INDIA_HOSPITALITY_PRESETS } from './usaliPnl';
import type { IndianHospitalityPresetKey } from './usaliPnl';

const asNum = (v: unknown, fallback = 0): number => {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pctLabel = (v: number): string =>
  `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
const bpsLabel = (v: number): string =>
  `${v >= 0 ? '+' : ''}${v} bps`;

/**
 * Build an axis tick, but return the base value UNTOUCHED at the centre.
 *
 * Rounding a tick is cosmetic everywhere except the centre, where it
 * silently breaks `centre cell === headline`: `Math.round(9487.5)` is a
 * different deal from the one the KPI tile priced. Callers pass the
 * rounding they want for the off-centre ticks and get exactness where
 * it is load-bearing.
 */
const exactAt = (isCentre: boolean, base: number, varied: number): number =>
  (isCentre ? base : varied);

// ─── Shared output shapes ────────────────────────────────────────────

export interface SensitivityMatrix {
  readonly sellingRates: readonly number[];
  readonly constructionCosts: readonly number[];
  readonly irrGrid: readonly (readonly (number | null)[])[];
  readonly axis: readonly [string, string];
  readonly variations: readonly string[];
}

export interface HospSensitivity extends SensitivityMatrix {
  readonly occAdr: {
    readonly rows: readonly number[];
    readonly cols: readonly number[];
    readonly irrGrid: readonly (readonly (number | null)[])[];
    readonly rowLabel: string;
    readonly colLabel: string;
  };
  readonly hardCost: {
    readonly variations: readonly string[];
    readonly irr: readonly (number | null)[];
  };
  readonly interestRate: {
    readonly variations: readonly string[];
    readonly irr: readonly (number | null)[];
  };
  readonly capRate: {
    readonly variations: readonly string[];
    readonly irr: readonly (number | null)[];
  };
}

export interface BuildSensitivityArgs {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly assetClass: AssetClass;
}

// ─── Residential / villas / redevelopment — 9×9 full re-run ──────────

const RES_VARS = [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20] as const;
const RES_AXIS: readonly [string, string] = ['Constr. Cost/sqft', 'Selling Rate/sqft'];

function tryComputeIrr(raw: Readonly<Record<string, unknown>>, assetClass: AssetClass): number | null {
  try {
    const inputs: DealInputs = { assetClass, raw };
    const result = computeDeal(inputs);
    return result.kpis.irr;
  } catch {
    return null;
  }
}

export function buildResidentialSensitivity(args: BuildSensitivityArgs): SensitivityMatrix {
  const { raw, assetClass } = args;
  const baseSelling = asNum(raw.sellingRatePerSqft);
  const baseConstruction = asNum(raw.constructionCostPerSqft);
  if (baseSelling <= 0 || baseConstruction <= 0) {
    return emptyGrid(RES_AXIS);
  }

  const sellingRates = RES_VARS.map((v) => exactAt(v === 0, baseSelling, Math.round(baseSelling * (1 + v))));
  const constructionCosts = RES_VARS.map((v) => exactAt(v === 0, baseConstruction, Math.round(baseConstruction * (1 + v))));
  const irrGrid = constructionCosts.map((cc) =>
    sellingRates.map((sr) =>
      tryComputeIrr(
        { ...raw, constructionCostPerSqft: cc, sellingRatePerSqft: sr, skipSensitivity: true },
        assetClass,
      ),
    ),
  );
  return {
    sellingRates,
    constructionCosts,
    irrGrid,
    axis: RES_AXIS,
    variations: RES_VARS.map(pctLabel),
  };
}

// ─── Plotted — 9×9 full re-run ───────────────────────────────────────

const PLOT_AXIS: readonly [string, string] = ['Dev. Cost/sqft', 'Selling Rate/sqft'];

export function buildPlottedSensitivity(args: BuildSensitivityArgs): SensitivityMatrix {
  const { raw, assetClass } = args;
  const baseSelling = asNum(raw.sellingRatePerSqft);
  const baseDev = asNum(raw.devCostPerSqft);
  if (baseSelling <= 0 || baseDev <= 0) {
    return emptyGrid(PLOT_AXIS);
  }

  const sellingRates = RES_VARS.map((v) => exactAt(v === 0, baseSelling, Math.round(baseSelling * (1 + v))));
  const devCosts = RES_VARS.map((v) => exactAt(v === 0, baseDev, Math.round(baseDev * (1 + v))));
  const irrGrid = devCosts.map((dc) =>
    sellingRates.map((sr) =>
      tryComputeIrr(
        { ...raw, sellingRatePerSqft: sr, devCostPerSqft: dc, skipSensitivity: true },
        assetClass,
      ),
    ),
  );
  return {
    sellingRates,
    constructionCosts: devCosts,
    irrGrid,
    axis: PLOT_AXIS,
    variations: RES_VARS.map(pctLabel),
  };
}

// ─── Income (office / retail / industrial) — 5×5 full re-run ─────────

const INCOME_RENT_VARS = [-0.20, -0.10, 0, 0.10, 0.20] as const;

/**
 * Exit-cap ticks, in basis points RELATIVE to the deal's own exit cap.
 *
 * This axis used to be the absolute ladder 5/6/7/8/9%. Two things were
 * wrong with that. A deal at 7.5% — the single most common exit cap in
 * Bengaluru office underwriting — had no cell of its own anywhere in
 * the grid, so there was nothing to compare the headline IRR against.
 * And because "Base IRR" is read off the middle row, every downstream
 * consumer silently attributed the 7% row to the deal.
 *
 * ±100 bps in 50 bps steps is also the band an IC actually argues over;
 * a 400 bps sweep centred on nothing was mostly noise.
 */
const INCOME_CAP_BPS = [-100, -50, 0, 50, 100] as const;
const INCOME_AXIS: readonly [string, string] = ['Exit Cap Rate (%)', 'Base Rent/sqft/mo'];

export function buildIncomeSensitivity(args: BuildSensitivityArgs): SensitivityMatrix {
  const { raw, assetClass } = args;
  const baseRentMonth = asNum(raw.baseRentPerSqftMonth);
  const leasableAreaSqft = asNum(raw.leasableAreaSqft);
  const baseCap = asNum(raw.exitCapRate, 7);
  if (baseRentMonth <= 0 || leasableAreaSqft <= 0 || baseCap <= 0) {
    return emptyGrid(INCOME_AXIS);
  }

  const rents = INCOME_RENT_VARS.map((v) =>
    exactAt(v === 0, baseRentMonth, Math.round(baseRentMonth * (1 + v) * 100) / 100),
  );
  // Off-centre ticks below zero are left as-is rather than clamped: the
  // kernel rejects a non-positive cap, `tryComputeIrr` turns that into
  // null, and a blank cell is honest. Clamping would instead duplicate a
  // neighbouring column under a label claiming to be a different one.
  const capRates = INCOME_CAP_BPS.map((bps) =>
    exactAt(bps === 0, baseCap, Math.round((baseCap + bps / 100) * 100) / 100),
  );

  const irrGrid = capRates.map((cap) =>
    rents.map((rent) =>
      tryComputeIrr(
        { ...raw, baseRentPerSqftMonth: rent, exitCapRate: cap, skipSensitivity: true },
        assetClass,
      ),
    ),
  );
  return {
    sellingRates: rents,
    constructionCosts: capRates,
    irrGrid,
    axis: INCOME_AXIS,
    variations: capRates.map((c) => `${c}%`),
  };
}

// ─── Hospitality — occupancy × ADR grid + three strips, full re-run ──

const HOSP_AXIS: readonly [string, string] = ['Occupancy (%)', 'ADR (₹)'];

/**
 * Resolve the value the HOSPITALITY KERNEL will actually use for a raw
 * field, through the same `{ ...presetDefaults, ...raw }` merge that
 * `assets/hospitality.ts` applies to its revenue inputs.
 *
 * To be clear about what this does today: `INDIA_HOSPITALITY_PRESETS`
 * defines only USALI cost lines, none of the fields read below, so the
 * merge is currently a no-op and this fixes no live bug. It exists so
 * the axis stays pinned to the kernel's resolution rather than to a
 * duplicate of it — the day a preset gains an `adr`, a deal that sets
 * `hotelTierPreset` and omits ADR would otherwise centre its grid on a
 * fallback the kernel never priced, and the centre cell would silently
 * stop being the deal.
 */
function hospBase(raw: Readonly<Record<string, unknown>>, field: string, fallback: number): number {
  const tierPreset = typeof raw.hotelTierPreset === 'string'
    ? (raw.hotelTierPreset as IndianHospitalityPresetKey)
    : null;
  const presetDefaults: Record<string, unknown> =
    tierPreset && INDIA_HOSPITALITY_PRESETS[tierPreset]
      ? (INDIA_HOSPITALITY_PRESETS[tierPreset] as Record<string, unknown>)
      : {};
  const merged = { ...presetDefaults, ...raw };
  return asNum(merged[field], fallback);
}

export function buildHospSensitivity(args: BuildSensitivityArgs): HospSensitivity {
  const { raw, assetClass } = args;

  // Defaults mirror `assets/hospitality.ts` exactly — a different
  // fallback here would centre the grid on a deal the kernel never priced.
  const adr = hospBase(raw, 'adr', 6000);
  const stabilizedOccPct = hospBase(raw, 'stabilizedOccPct', 65);
  const exitCapRate = hospBase(raw, 'exitCapRate', 9);
  const constLoanRatePct = hospBase(raw, 'constLoanRatePct', 10.5);

  // Hard cost mirrors the kernel's per-key → per-sqft resolution
  // (`assets/hospitality.ts`, which proves the two are the same number):
  // hotels are budgeted per key, so most deals carry only
  // `constructionCostPerKey`. Resolving it here lets the strip vary a
  // single field and still reproduce the deal exactly at 0%.
  const sqftPerKey = hospBase(raw, 'sqftPerKey', 550);
  const ccpk = hospBase(raw, 'constructionCostPerKey', 0);
  const explicitHardCost = hospBase(raw, 'hardCostPerSqft', 0);
  const hardCostPerSqft = explicitHardCost > 0
    ? explicitHardCost
    : ccpk > 0 && sqftPerKey > 0
      ? ccpk / sqftPerKey
      : 11_000;

  const irrAt = (overrides: Record<string, unknown>): number | null =>
    tryComputeIrr({ ...raw, ...overrides, skipSensitivity: true }, assetClass);

  // Occupancy stays inside 40–90% off-centre — outside that band the
  // ramp stops describing a hotel anyone would underwrite — but the
  // centre tick is the deal's own occupancy, uncapped, so the invariant
  // survives a 95% stabilised assumption.
  const occVars = [-15, -10, 0, 10, 15].map((d) =>
    exactAt(d === 0, stabilizedOccPct, Math.max(40, Math.min(90, stabilizedOccPct + d))),
  );
  const adrVars = [-0.20, -0.10, 0, 0.10, 0.20].map((v) =>
    exactAt(v === 0, adr, Math.round(adr * (1 + v))),
  );
  const occAdrIrrGrid = occVars.map((o) =>
    adrVars.map((a) => irrAt({ adr: a, stabilizedOccPct: o })),
  );

  const hcVars = [-15, -10, 0, 10, 15];
  const irVars = [-150, -75, 0, 75, 150];
  const crVars = [-100, -50, 0, 50, 100];
  const hardCostIrr = hcVars.map((pct) =>
    irrAt({ hardCostPerSqft: hardCostPerSqft * (1 + pct / 100) }),
  );
  const interestIrr = irVars.map((bps) =>
    irrAt({ constLoanRatePct: constLoanRatePct + bps / 100 }),
  );
  const capRateIrr = crVars.map((bps) =>
    irrAt({ exitCapRate: exitCapRate + bps / 100 }),
  );

  return {
    sellingRates: adrVars,
    constructionCosts: occVars,
    irrGrid: occAdrIrrGrid,
    axis: HOSP_AXIS,
    variations: occVars.map((o) => `${Math.round(o)}%`),
    occAdr: {
      rows: occVars,
      cols: adrVars,
      irrGrid: occAdrIrrGrid,
      rowLabel: 'Occupancy (%)',
      colLabel: 'ADR (₹)',
    },
    hardCost: {
      variations: hcVars.map((v) => `${v >= 0 ? '+' : ''}${v}%`),
      irr: hardCostIrr,
    },
    interestRate: {
      variations: irVars.map(bpsLabel),
      irr: interestIrr,
    },
    capRate: {
      variations: crVars.map(bpsLabel),
      irr: capRateIrr,
    },
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────

function emptyGrid(axis: readonly [string, string]): SensitivityMatrix {
  return {
    sellingRates: [],
    constructionCosts: [],
    irrGrid: [],
    axis,
    variations: [],
  };
}

/**
 * Pick the right sensitivity variant for the given asset class.
 * Returns `null` for asset classes where sensitivity is not emitted
 * (land_parcel) — caller treats that as "no matrix".
 */
export function buildSensitivityMatrix(
  args: BuildSensitivityArgs,
): SensitivityMatrix | HospSensitivity | null {
  switch (args.assetClass) {
    case 'residential_apartments':
    case 'villas':
    case 'redevelopment':
    case 'mixed_use':
      // Mixed-use routes through the residential model in the kernel
      // (see `assets/mixed_use.ts`), so the sensitivity dispatcher
      // follows the same convention.
      return buildResidentialSensitivity(args);
    case 'plotted_development':
      return buildPlottedSensitivity(args);
    case 'commercial_office':
    case 'retail':
    case 'industrial_warehousing':
      return buildIncomeSensitivity(args);
    case 'hospitality':
      return buildHospSensitivity(args);
    case 'land_parcel':
      return null;
    default: {
      const _exhaustive: never = args.assetClass;
      throw new Error(`buildSensitivityMatrix: unknown asset class ${String(_exhaustive)}`);
    }
  }
}

