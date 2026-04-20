/**
 * Input schema + normalization. The UI, the legacy engine, and storage
 * all emit slightly different shapes for the same underlying deal. This
 * module defines the **canonical** kernel-input shape per asset class
 * and a `normalizeDealInput` function that accepts any of the known
 * variants and produces a validated canonical record.
 *
 * Normalization rules:
 *   - Area is internal sqft; callers may pass `acre`, `sqm`, `sqyd` via
 *     a `{value, unit}` tuple (preferred) or via the pre-existing flat
 *     `*_acres` / `*_sqft` legacy keys (for storage compat).
 *   - Money is internal Cr; legacy `*_cr` keys pass through, but
 *     `{value, unit}` forms are converted.
 *   - Rates collapse onto percent via `toPercent` so either `0.12` or
 *     `12` is accepted for `financeCostPct`.
 *   - Anything not supplied is pulled from the assumption hierarchy
 *     (`GLOBAL_DEFAULTS` → `ASSET_DEFAULTS`).
 */

import type { AssetClass, AssumptionSet, DealInputs } from './types';
import { resolveAssumptions } from './assumptions';
import {
  type AreaUnit,
  type MoneyAmount,
  DEFAULT_USD_INR,
  toCrore,
  toMonths,
  toPercent,
  toSqft,
} from './units';

// ─────────────────────────────────────────────────────────────────────────────
//  Canonical shape (output of normalization)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The normalised input record the kernel's asset adapters now consume.
 * Every key is either a plain number in canonical units (sqft / Cr /
 * months / percent) or a string (`effectiveDate`). Adapters never see a
 * `{value, unit}` tuple or a free-form name.
 */
export type NormalizedRaw = Readonly<Record<string, number | string>>;

/** Error thrown when a required canonical field is missing or nonsensical. */
export class DealInputError extends Error {
  public readonly fieldErrors: ReadonlyArray<{ field: string; message: string }>;
  constructor(errors: ReadonlyArray<{ field: string; message: string }>) {
    super(`DealInputError: ${errors.map((e) => `${e.field} ${e.message}`).join(', ')}`);
    this.name = 'DealInputError';
    this.fieldErrors = errors;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-asset-class required fields
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_BY_CLASS: Record<AssetClass, readonly string[]> = {
  residential_apartments: [
    'plotAreaSqft',
    'fsi',
    'constructionCostPerSqft',
    'sellingRatePerSqft',
    'landCostCr',
  ],
  villas: ['plotAreaSqft', 'constructionCostPerSqft', 'sellingRatePerSqft', 'landCostCr'],
  mixed_use: [
    'plotAreaSqft',
    'fsi',
    'constructionCostPerSqft',
    'sellingRatePerSqft',
    'landCostCr',
  ],
  redevelopment: ['plotAreaSqft', 'fsi', 'constructionCostPerSqft', 'sellingRatePerSqft'],
  plotted_development: ['totalLandSqft', 'sellingRatePerSqft', 'landCostCr'],
  commercial_office: ['leasableAreaSqft', 'constructionCostPerSqft', 'baseRentPerSqftMonth', 'landCostCr'],
  retail: ['leasableAreaSqft', 'constructionCostPerSqft', 'baseRentPerSqftMonth', 'landCostCr'],
  industrial_warehousing: [
    'leasableAreaSqft',
    'constructionCostPerSqft',
    'baseRentPerSqftMonth',
    'landCostCr',
  ],
  hospitality: ['keys', 'constructionCostPerKey', 'adr', 'landCostCr'],
  land_parcel: ['landCostCr'],
};

// ─────────────────────────────────────────────────────────────────────────────
//  Field-coercion helpers
// ─────────────────────────────────────────────────────────────────────────────

type Unknowny = Readonly<Record<string, unknown>>;

function readNum(raw: Unknowny, key: string): number | undefined {
  const v = raw[key];
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function readStr(raw: Unknowny, key: string): string | undefined {
  const v = raw[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Pull an area either from a `{value, unit}` tuple, a paired `*_acre`/`*_sqm`
 * key, or a direct `*Sqft` numeric field. Returns sqft.
 */
function readAreaSqft(raw: Unknowny, canonicalKey: string): number | undefined {
  // 1. direct sqft
  const direct = readNum(raw, canonicalKey);
  if (direct !== undefined) return direct;

  // 2. {value, unit} tuple on the same key
  const tuple = raw[canonicalKey];
  if (tuple && typeof tuple === 'object' && 'value' in tuple && 'unit' in tuple) {
    const v = Number((tuple as { value: unknown }).value);
    const u = (tuple as { unit: unknown }).unit as AreaUnit;
    if (Number.isFinite(v)) return toSqft(v, u);
  }

  // 3. legacy *_acre / *_sqm / *_sqyd aliases
  const base = canonicalKey.replace(/Sqft$/, '');
  const altMap: Array<[string, AreaUnit]> = [
    [`${base}Acre`, 'acre'],
    [`${base}Acres`, 'acre'],
    [`${base}Sqm`, 'sqm'],
    [`${base}Hectare`, 'hectare'],
    [`${base}Sqyd`, 'sqyd'],
  ];
  for (const [alias, unit] of altMap) {
    const v = readNum(raw, alias);
    if (v !== undefined) return toSqft(v, unit);
  }
  return undefined;
}

/**
 * Pull a money value in Cr. Accepts direct Cr (the canonical key), a
 * `{value, unit}` tuple, or a legacy `*_lakh` / `*_inr` alias.
 */
function readMoneyCr(raw: Unknowny, canonicalKey: string): number | undefined {
  const direct = readNum(raw, canonicalKey);
  if (direct !== undefined) return direct;

  const tuple = raw[canonicalKey];
  if (tuple && typeof tuple === 'object' && 'value' in tuple && 'unit' in tuple) {
    const m = tuple as MoneyAmount;
    if (Number.isFinite(m.value)) return toCrore(m);
  }

  const base = canonicalKey.replace(/Cr$/, '');
  const altMap: Array<[string, MoneyAmount['unit']]> = [
    [`${base}Lakh`, 'lakh'],
    [`${base}INR`, 'INR'],
    [`${base}USD`, 'USD'],
  ];
  for (const [alias, unit] of altMap) {
    const v = readNum(raw, alias);
    if (v !== undefined) {
      return toCrore({ value: v, unit, fxINR: DEFAULT_USD_INR });
    }
  }
  return undefined;
}

/**
 * Pull a time value in months. Accepts direct months, a `*_years` alias,
 * or a `{value, unit}` tuple.
 */
function readMonths(raw: Unknowny, canonicalKey: string): number | undefined {
  const direct = readNum(raw, canonicalKey);
  if (direct !== undefined) return direct;

  const tuple = raw[canonicalKey];
  if (tuple && typeof tuple === 'object' && 'value' in tuple && 'unit' in tuple) {
    const v = Number((tuple as { value: unknown }).value);
    const u = (tuple as { unit: unknown }).unit as 'months' | 'years' | 'quarters' | 'days';
    if (Number.isFinite(v)) return toMonths(v, u);
  }

  const base = canonicalKey.replace(/Months$/, '');
  const altMap: Array<[string, 'years' | 'quarters' | 'days']> = [
    [`${base}Years`, 'years'],
    [`${base}Quarters`, 'quarters'],
  ];
  for (const [alias, unit] of altMap) {
    const v = readNum(raw, alias);
    if (v !== undefined) return toMonths(v, unit);
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Key set — what we know how to normalise
// ─────────────────────────────────────────────────────────────────────────────

const AREA_KEYS = ['plotAreaSqft', 'totalLandSqft', 'leasableAreaSqft', 'avgPlotSizeSqft', 'avgUnitSizeSqft'] as const;
const MONEY_KEYS = ['landCostCr', 'approvalCostCr', 'rehousingCostCr', 'holdingCostPerYearCr'] as const;
const MONTH_KEYS = ['projectDurationMonths', 'constructionStartMonths', 'constructionEndMonths'] as const;
const PERCENT_KEYS = [
  'fsi', 'loadingFactor',
  'saleableLandPct', 'anchorPct', 'anchorRentDiscount',
  'stampDutyPct', 'gstPct', 'marketingCostPct', 'financeCostPct', 'developerMarginPct',
  'discountRatePct', 'contingencyPct', 'architectFeePct', 'pmcFeePct',
  'rentEscalationPct', 'vacancyPct', 'opexPct',
  'entryCapRate', 'exitCapRate',
  'adrGrowthPct', 'stabilizedOccPct', 'fbRevPct', 'otherRevPct', 'gopMarginPct', 'ebitdaMarginPct',
  'landAppreciationPct',
  'interestRatePct', 'debtRatePct',
] as const;
// Ratio keys — accept either fraction form (0.6) or percent form (60).
// Normalised to fraction [0,1] to match master's `resolveDebtRatio` tolerance.
const RATIO_KEYS = ['debtLTV', 'debtLTC', 'debtCoverage'] as const;
const PER_SQFT_KEYS = [
  'constructionCostPerSqft', 'sellingRatePerSqft', 'devCostPerSqft',
  'baseRentPerSqftMonth', 'tiPerSqft', 'approvalCostPerSqft',
] as const;
const COUNT_KEYS = ['keys', 'constructionCostPerKey', 'preOpeningCostPerKey', 'adr', 'lcMonths'] as const;
const TENOR_KEYS = ['holdPeriodYears', 'holdYears', 'debtTenorYears', 'amortizationYears'] as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizeArgs {
  readonly assetClass: AssetClass;
  readonly raw: Unknowny;
  readonly scenarioOverrides?: AssumptionSet | null;
}

export interface NormalizedDeal {
  readonly assetClass: AssetClass;
  readonly raw: NormalizedRaw;
  readonly assumptions: AssumptionSet;
  readonly warnings: readonly string[];
}

export function normalizeDealInput(args: NormalizeArgs): NormalizedDeal {
  const { assetClass, raw } = args;
  if (raw == null || typeof raw !== 'object') {
    throw new DealInputError([{ field: 'raw', message: 'is required and must be an object' }]);
  }

  const warnings: string[] = [];
  const out: Record<string, number | string> = {};

  // effectiveDate passthrough
  const effectiveDate = readStr(raw, 'effectiveDate');
  if (effectiveDate) out.effectiveDate = effectiveDate;

  for (const k of AREA_KEYS) {
    const v = readAreaSqft(raw, k);
    if (v !== undefined) out[k] = v;
  }
  for (const k of MONEY_KEYS) {
    const v = readMoneyCr(raw, k);
    if (v !== undefined) out[k] = v;
  }
  for (const k of MONTH_KEYS) {
    const v = readMonths(raw, k);
    if (v !== undefined) out[k] = v;
  }
  for (const k of PERCENT_KEYS) {
    const v = raw[k];
    if (v == null) continue;
    // `fsi` and `loadingFactor` are ratios, not percents — keep as-is
    // (but convert if clearly in percent form for loadingFactor).
    if (k === 'fsi') {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (k === 'loadingFactor') {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n > 1 ? n / 100 : n;
    } else {
      out[k] = toPercent(v);
    }
  }
  for (const k of RATIO_KEYS) {
    const v = raw[k];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    // If |n| > 1 the caller almost certainly passed percent form (e.g. 60 → 0.6).
    const frac = Math.abs(n) > 1 ? n / 100 : n;
    out[k] = Math.max(0, Math.min(1, frac));
  }
  for (const k of PER_SQFT_KEYS) {
    const v = readNum(raw, k);
    if (v !== undefined) out[k] = v;
  }
  for (const k of COUNT_KEYS) {
    const v = readNum(raw, k);
    if (v !== undefined) out[k] = v;
  }
  for (const k of TENOR_KEYS) {
    const v = readNum(raw, k);
    if (v !== undefined) out[k] = v;
  }

  // Preserve anything else the caller sent through unchanged so custom
  // per-class fields (like `gstPct` override) still flow. Skip the keys
  // we've already normalised and their recognised aliases.
  const consumedAliases = new Set<string>();
  for (const k of AREA_KEYS) {
    const base = k.replace(/Sqft$/, '');
    ['Acre', 'Acres', 'Sqm', 'Hectare', 'Sqyd'].forEach((suf) =>
      consumedAliases.add(`${base}${suf}`),
    );
  }
  for (const k of MONEY_KEYS) {
    const base = k.replace(/Cr$/, '');
    ['Lakh', 'INR', 'USD'].forEach((suf) => consumedAliases.add(`${base}${suf}`));
  }
  for (const k of MONTH_KEYS) {
    const base = k.replace(/Months$/, '');
    ['Years', 'Quarters'].forEach((suf) => consumedAliases.add(`${base}${suf}`));
  }
  const known = new Set<string>([
    ...AREA_KEYS,
    ...MONEY_KEYS,
    ...MONTH_KEYS,
    ...PERCENT_KEYS,
    ...RATIO_KEYS,
    ...PER_SQFT_KEYS,
    ...COUNT_KEYS,
    ...TENOR_KEYS,
    'effectiveDate',
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (known.has(k) || consumedAliases.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v;
  }

  // Merge assumption layers. Scenario overrides (if any) ALWAYS win over
  // both the deal inputs and the defaults — otherwise a scenario can't
  // move a value the deal already set.
  const assumptions = resolveAssumptions({
    assetClass,
    dealOverrides: Object.freeze({ ...(out as Record<string, number | string>) }) as AssumptionSet,
    scenarioOverrides: args.scenarioOverrides ?? null,
  });
  // Backfill missing fields from globals / asset defaults.
  for (const [k, v] of Object.entries(assumptions)) {
    if (out[k] === undefined && typeof v === 'number') {
      out[k] = v;
    }
  }
  // Apply scenario overrides last, unconditionally.
  if (args.scenarioOverrides) {
    for (const [k, v] of Object.entries(args.scenarioOverrides)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof v === 'string') out[k] = v;
    }
  }

  // Validate required fields.
  const errors: Array<{ field: string; message: string }> = [];
  for (const req of REQUIRED_BY_CLASS[assetClass]) {
    const v = out[req];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      errors.push({ field: req, message: 'is required, finite, and > 0' });
    }
  }
  if (errors.length) throw new DealInputError(errors);

  return {
    assetClass,
    raw: Object.freeze(out),
    assumptions,
    warnings: Object.freeze(warnings),
  };
}

/** Convenience — `DealInputs` pass-through that normalises in one call. */
export function normalizedDealInputs(inputs: DealInputs, scenarioOverrides?: AssumptionSet): DealInputs {
  const normalized = normalizeDealInput({
    assetClass: inputs.assetClass,
    raw: inputs.raw as Unknowny,
    scenarioOverrides: scenarioOverrides ?? null,
  });
  return Object.freeze({
    assetClass: normalized.assetClass,
    currency: inputs.currency ?? 'INR',
    raw: normalized.raw,
  }) as DealInputs;
}
