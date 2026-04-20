/**
 * Unit normalization. The kernel's canonical units are:
 *   - Area   → square feet (sqft)
 *   - Money  → INR Crore (1 Cr = 10,000,000 ₹)
 *   - Time   → months
 *   - Rates  → percent (e.g. 12.5 for 12.5%)
 *
 * Anything arriving from the outside world in other units is funneled
 * through these converters. Two goals:
 *
 *   1. Keep every adapter free of one-off conversions — a single place
 *      encodes "1 acre = 43,560 sqft" and "1 Cr = 1e7 ₹".
 *   2. Allow the input schema layer to accept `{ value, unit }` tuples
 *      without any adapter caring about the source unit.
 */

import { Decimal } from './decimal';

// ─────────────────────────────────────────────────────────────────────────────
//  Area — canonical: sqft
// ─────────────────────────────────────────────────────────────────────────────

export type AreaUnit = 'sqft' | 'sqm' | 'acre' | 'hectare' | 'sqyd';

const SQFT_PER_UNIT: Record<AreaUnit, number> = {
  sqft: 1,
  sqyd: 9,
  sqm: 10.7639,
  acre: 43_560,
  hectare: 107_639,
};

export function toSqft(value: number, unit: AreaUnit = 'sqft'): number {
  if (!Number.isFinite(value)) return 0;
  return value * SQFT_PER_UNIT[unit];
}

export function fromSqft(valueSqft: number, toUnit: AreaUnit): number {
  if (!Number.isFinite(valueSqft)) return 0;
  return valueSqft / SQFT_PER_UNIT[toUnit];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Money — canonical: INR Crore (Cr)
// ─────────────────────────────────────────────────────────────────────────────

export type MoneyUnit = 'INR' | 'lakh' | 'crore' | 'USD';

/** Default USD→INR reference rate. Never overridden by network lookup; if
 *  the caller wants to convert USD inputs, they must pass `fxINR` explicitly. */
export const DEFAULT_USD_INR = 83;

export interface MoneyAmount {
  readonly value: number;
  readonly unit: MoneyUnit;
  /** Only honored when unit === 'USD'. Falls back to `DEFAULT_USD_INR`. */
  readonly fxINR?: number;
}

export function toCrore(amount: MoneyAmount): number {
  const v = Number.isFinite(amount.value) ? amount.value : 0;
  switch (amount.unit) {
    case 'crore':
      return v;
    case 'lakh':
      return v / 100;
    case 'INR':
      return v / 1e7;
    case 'USD':
      return (v * (amount.fxINR ?? DEFAULT_USD_INR)) / 1e7;
  }
}

export function crToDecimal(valueCr: number): Decimal {
  return Decimal.fromNumber(valueCr);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Time — canonical: months
// ─────────────────────────────────────────────────────────────────────────────

export type TimeUnit = 'months' | 'years' | 'quarters' | 'days';

export function toMonths(value: number, unit: TimeUnit = 'months'): number {
  if (!Number.isFinite(value)) return 0;
  switch (unit) {
    case 'months':
      return value;
    case 'years':
      return value * 12;
    case 'quarters':
      return value * 3;
    case 'days':
      return value / 30.4375;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Rates — canonical: percent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise rate inputs to percent. Accepts:
 *   - number already in percent  → pass through (e.g. `12.5`)
 *   - fractional form            → multiply by 100 iff abs < 1
 * Returns 0 for invalid values.
 */
export function toPercent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) <= 1 && n !== 0 ? n * 100 : n;
}

/** The inverse — percent → fractional (for use inside math). */
export function toFraction(pct: number): number {
  return Number.isFinite(pct) ? pct / 100 : 0;
}
