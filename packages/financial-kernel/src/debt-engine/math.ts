/**
 * Deterministic debt math primitives. Pure Decimal arithmetic.
 */

import { Decimal } from '../decimal';

export const ONE = Decimal.one();
export const ZERO = Decimal.zero();

/** Convert an annual percentage rate to a monthly decimal. */
export function monthlyRate(annualPct: number): number {
  return annualPct / 100 / 12;
}

/**
 * EMI (level payment) for a principal `p`, monthly rate `r`, and `n` months.
 * Returns a Decimal at default scale.
 *   EMI = p * r * (1+r)^n / ((1+r)^n - 1)
 * When r == 0 → p / n.
 */
export function emi(principal: Decimal, annualPct: number, termMonths: number): Decimal {
  if (termMonths <= 0) return Decimal.zero();
  const r = monthlyRate(annualPct);
  if (r === 0) return principal.divInt(termMonths);
  const factor = (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
  return principal.mulNumber(factor);
}

/**
 * Derive the level principal component of an EMI schedule at a given month
 * given opening balance, annual pct, remaining term. Used for EMI-style
 * facilities when `repaymentFrequencyMonths > 1` (the monthly rows still
 * accrue interest; principal is bucketed to frequency boundaries).
 */
export function emiPrincipalComponent(
  openingBalance: Decimal,
  annualPct: number,
  remainingTermMonths: number,
): Decimal {
  if (remainingTermMonths <= 0) return Decimal.zero();
  const level = emi(openingBalance, annualPct, remainingTermMonths);
  const interest = accrueInterestMonthly(openingBalance, annualPct, 'monthly');
  const principal = level.sub(interest);
  return principal.isNegative() ? Decimal.zero() : principal;
}

/**
 * One month of interest accrual on `balance` at `annualPct`. `basis` is
 * either standard monthly compounding (rate/12) or simple-monthly
 * (actual days / 360 approximation → rate/12 in our canonical grain).
 * Both resolve to the same per-month charge in monthly canonical time;
 * the distinction is retained for downstream reporting semantics.
 */
export function accrueInterestMonthly(
  balance: Decimal,
  annualPct: number,
  _basis: 'monthly' | 'simple_monthly' = 'monthly',
): Decimal {
  if (balance.isZero() || balance.isNegative()) return Decimal.zero();
  const r = monthlyRate(annualPct);
  if (r === 0) return Decimal.zero();
  return balance.mulNumber(r);
}

/**
 * Safe min for a Decimal vs a plain cap expressed as Decimal. Returns the
 * smaller non-negative value; negatives are clamped to zero.
 */
export function capPositive(value: Decimal, cap: Decimal): Decimal {
  if (value.isNegative()) return Decimal.zero();
  if (cap.isNegative()) return Decimal.zero();
  return value.compare(cap) <= 0 ? value : cap;
}

/** Subtract, clamping to zero on negative. */
export function subClampZero(a: Decimal, b: Decimal): Decimal {
  const d = a.sub(b);
  return d.isNegative() ? Decimal.zero() : d;
}

/** Element-wise add two Decimal series, padding the shorter with zeros. */
export function addSeries(a: readonly Decimal[], b: readonly Decimal[]): Decimal[] {
  const n = Math.max(a.length, b.length);
  const out: Decimal[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ai = i < a.length ? a[i] : Decimal.zero();
    const bi = i < b.length ? b[i] : Decimal.zero();
    out[i] = ai.add(bi);
  }
  return out;
}

/** Build a zeros series of length `n`. */
export function zeros(n: number): Decimal[] {
  const out: Decimal[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Decimal.zero();
  return out;
}

/** Clamp a number to [min, max]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
