/**
 * Deterministic KPI calculators — NPV, IRR, margin, equity multiple, RLV.
 * All money inputs are `Decimal`; IRR returns a plain number for
 * backwards compatibility with the legacy engine.
 */

import { Decimal, DEFAULT_SCALE, sum as decSum } from './decimal';

/**
 * NPV of a monthly cash-flow series at an annual discount rate.
 * Monthly discount factor: `(1 + annual)^(1/12) - 1`.
 *
 * Mirrors the legacy quarterly convention used by the existing engine,
 * expressed as monthly so a monthly and a quarterly series at equivalent
 * annual rates produce the same annualised PV.
 */
export function npv(cashFlows: readonly Decimal[], annualDiscountRate: number): Decimal {
  if (cashFlows.length === 0) return Decimal.zero();
  if (!Number.isFinite(annualDiscountRate)) {
    throw new RangeError(`npv: non-finite rate ${annualDiscountRate}`);
  }
  if (annualDiscountRate < -0.9999 || annualDiscountRate > 10) {
    throw new RangeError('npv: annualDiscountRate must be between -99.99% and 1000%');
  }
  const monthlyRate = Math.pow(1 + annualDiscountRate, 1 / 12) - 1;
  let total = Decimal.zero();
  for (let t = 0; t < cashFlows.length; t++) {
    const factor = Math.pow(1 + monthlyRate, t);
    total = total.add(cashFlows[t].div(Decimal.fromNumber(factor)));
  }
  return total;
}

/**
 * IRR of a monthly cash-flow series. Returns an *annualised* rate in
 * percent (e.g. `18.5` for 18.5% p.a.) to match the legacy engine's
 * convention. Returns `null` if no root converges or signs don't allow
 * an IRR to exist.
 */
export function irrAnnualPct(cashFlows: readonly Decimal[]): number | null {
  if (cashFlows.length < 2) return null;
  const nums = cashFlows.map((d) => d.toNumber());
  const hasPositive = nums.some((v) => v > 0);
  const hasNegative = nums.some((v) => v < 0);
  if (!hasPositive || !hasNegative) return null;

  const npvAt = (r: number) =>
    nums.reduce((acc, v, t) => acc + v / Math.pow(1 + r, t), 0);
  const dNpvAt = (r: number) =>
    nums.reduce((acc, v, t) => (t === 0 ? acc : acc - (t * v) / Math.pow(1 + r, t + 1)), 0);

  const MAX_ITER = 200;
  const PREC = 1e-10;

  // Newton from several seeds — the legacy engine uses similar seeds for
  // monthly-IRR stability across deal archetypes.
  const seeds = [0.01, 0.005, 0.02, 0.001, 0.015, 0.05];
  for (const seed of seeds) {
    let r = seed;
    let converged = false;
    for (let i = 0; i < MAX_ITER; i++) {
      const d = dNpvAt(r);
      if (Math.abs(d) < 1e-14) break;
      const next = r - npvAt(r) / d;
      if (!Number.isFinite(next) || next <= -1) break;
      if (Math.abs(next - r) < PREC) {
        r = next;
        if (Math.abs(npvAt(r)) < 1e-4) {
          converged = true;
        }
        break;
      }
      r = next;
    }
    if (converged) {
      const annual = Math.pow(1 + r, 12) - 1;
      return Math.round(annual * 1e8) / 1e6;
    }
  }

  // Bisection fallback.
  let lo = -0.9999;
  let hi = 10;
  let found = false;
  for (let h = 0.01; h <= 10; h *= 1.5) {
    if (npvAt(lo) * npvAt(h) < 0) {
      hi = h;
      found = true;
      break;
    }
  }
  if (!found) return null;
  for (let i = 0; i < MAX_ITER * 4; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAt(mid);
    if (Math.abs(npvMid) < PREC || (hi - lo) / 2 < PREC) {
      const annual = Math.pow(1 + mid, 12) - 1;
      return Math.round(annual * 1e8) / 1e6;
    }
    if (npvAt(lo) * npvMid < 0) hi = mid;
    else lo = mid;
  }
  const mid = (lo + hi) / 2;
  const annual = Math.pow(1 + mid, 12) - 1;
  return Math.round(annual * 1e8) / 1e6;
}

export interface GrossProfitInput {
  readonly revenue: Decimal;
  readonly totalCost: Decimal;
}

export function grossProfit({ revenue, totalCost }: GrossProfitInput): Decimal {
  return revenue.sub(totalCost);
}

export function grossMarginPct(revenue: Decimal, totalCost: Decimal): number {
  if (revenue.isZero()) return 0;
  return grossProfit({ revenue, totalCost }).toNumber() / revenue.toNumber() * 100;
}

export interface EquityMultipleInput {
  readonly equityInvested: Decimal;
  readonly totalEquityReturns: Decimal;
}

export function equityMultiple({
  equityInvested,
  totalEquityReturns,
}: EquityMultipleInput): number | null {
  if (!equityInvested.isPositive()) return null;
  return totalEquityReturns.toNumber() / equityInvested.toNumber();
}

export interface ResidualLandValueInput {
  readonly revenue: Decimal;
  readonly totalCostExLand: Decimal;
  readonly developerMarginPct: number;
}

/**
 * Residual land value — the maximum land outlay that still delivers the
 * target developer margin. `totalCostExLand` must exclude both land cost
 * and stamp duty (stamp duty is proportional to land value).
 */
export function residualLandValue({
  revenue,
  totalCostExLand,
  developerMarginPct,
}: ResidualLandValueInput): Decimal {
  const denom = 1 + developerMarginPct / 100;
  if (denom === 0) return Decimal.zero();
  return revenue.sub(totalCostExLand).div(Decimal.fromNumber(denom, DEFAULT_SCALE));
}

/** Sum the positive entries of a Decimal series. */
export function totalInflow(cashFlows: readonly Decimal[]): Decimal {
  return decSum(cashFlows.filter((d) => d.isPositive()));
}

/** Sum the absolute value of negative entries. */
export function totalOutflow(cashFlows: readonly Decimal[]): Decimal {
  return decSum(cashFlows.filter((d) => d.isNegative())).neg();
}
