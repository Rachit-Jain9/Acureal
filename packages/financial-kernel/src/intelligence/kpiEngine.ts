/**
 * TS KPI engine — IRR (XIRR), MOIC, DSCR profile, LLCR/PLCR,
 * debt capacity, payback month, peak equity outflow.
 *
 * This is the canonical source of truth for local execution. The
 * Python kernel at /orchestrate mirrors these formulas for production
 * parity — reconciliation lives in the golden tests.
 */
import { Decimal, sum as decSum } from '../decimal';
import type {
  DSCRProfile,
  DebtCapacityResult,
  IntelligenceKPIs,
} from './types';

const ZERO = Decimal.zero();

/** Monthly-indexed XIRR solved by Newton-Raphson with bisection fallback. */
export function xirr(
  cashFlows: readonly Decimal[],
  monthsFromOrigin: readonly number[],
  guess: number = 0.12,
): Decimal | null {
  if (cashFlows.length === 0 || cashFlows.length !== monthsFromOrigin.length) return null;
  const cf = cashFlows.map((d) => d.toNumber());
  const months = monthsFromOrigin.slice();
  if (!cf.some((v) => v > 0) || !cf.some((v) => v < 0)) return null;

  const npv = (r: number): number => {
    if (r <= -1) return Number.POSITIVE_INFINITY;
    let t = 0;
    for (let i = 0; i < cf.length; i++) t += cf[i] / Math.pow(1 + r, months[i] / 12);
    return t;
  };
  const dnpv = (r: number): number => {
    if (r <= -1) return Number.POSITIVE_INFINITY;
    let t = 0;
    for (let i = 0; i < cf.length; i++) {
      const m = months[i] / 12;
      t -= (m * cf[i]) / Math.pow(1 + r, m + 1);
    }
    return t;
  };

  let r = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(r);
    if (!Number.isFinite(f)) break;
    if (Math.abs(f) < 1e-7) return Decimal.fromNumber(r);
    const d = dnpv(r);
    if (!Number.isFinite(d) || d === 0) break;
    const rn = r - f / d;
    if (!Number.isFinite(rn) || rn <= -0.999) break;
    if (Math.abs(rn - r) < 1e-9) return Decimal.fromNumber(rn);
    r = rn;
  }

  let lo = -0.99, hi = 10;
  let fl = npv(lo), fh = npv(hi);
  if (!Number.isFinite(fl) || !Number.isFinite(fh) || fl * fh > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-7) return Decimal.fromNumber(mid);
    if (fl * fm < 0) { hi = mid; fh = fm; } else { lo = mid; fl = fm; }
  }
  return Decimal.fromNumber((lo + hi) / 2);
}

export function moic(inflows: readonly Decimal[], outflows: readonly Decimal[]): Decimal {
  const ti = decSum(inflows);
  const to = decSum(outflows);
  if (to.isZero()) return ZERO;
  return ti.div(to);
}

export function dscrProfile(cfads: readonly Decimal[], ds: readonly Decimal[]): DSCRProfile {
  const ratios: number[] = [];
  const n = Math.min(cfads.length, ds.length);
  for (let i = 0; i < n; i++) {
    if (ds[i].isZero()) continue;
    ratios.push(cfads[i].toNumber() / ds[i].toNumber());
  }
  if (ratios.length === 0) {
    return {
      min: null, max: null, avg: null,
      p5: null, p25: null, p50: null, p75: null,
      countBelow1_0: 0, countBelow1_25: 0,
    };
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const pct = (p: number): number => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const sum = ratios.reduce((a, b) => a + b, 0);
  return {
    min: Decimal.fromNumber(sorted[0]),
    max: Decimal.fromNumber(sorted[sorted.length - 1]),
    avg: Decimal.fromNumber(sum / ratios.length),
    p5: Decimal.fromNumber(pct(0.05)),
    p25: Decimal.fromNumber(pct(0.25)),
    p50: Decimal.fromNumber(pct(0.50)),
    p75: Decimal.fromNumber(pct(0.75)),
    countBelow1_0: ratios.filter((r) => r < 1.0).length,
    countBelow1_25: ratios.filter((r) => r < 1.25).length,
  };
}

export function llcr(
  cfads: readonly Decimal[],
  debtOutstanding: readonly Decimal[],
  annualDiscount: Decimal,
): Decimal | null {
  if (cfads.length === 0 || debtOutstanding.length === 0) return null;
  const current = debtOutstanding[0].toNumber();
  if (current <= 0) return null;
  const r = annualDiscount.toNumber() / 12;
  let pv = 0;
  for (let i = 0; i < cfads.length; i++) pv += cfads[i].toNumber() / Math.pow(1 + r, i + 1);
  return Decimal.fromNumber(pv / current);
}

export function plcr(
  cfads: readonly Decimal[],
  currentDebt: Decimal,
  annualDiscount: Decimal,
): Decimal | null {
  const cur = currentDebt.toNumber();
  if (cfads.length === 0 || cur <= 0) return null;
  const r = annualDiscount.toNumber() / 12;
  let pv = 0;
  for (let i = 0; i < cfads.length; i++) pv += cfads[i].toNumber() / Math.pow(1 + r, i + 1);
  return Decimal.fromNumber(pv / cur);
}

export function debtCapacity(
  cfads: readonly Decimal[],
  targetDSCR: Decimal,
  annualRate: Decimal,
  termMonths: number,
): DebtCapacityResult {
  if (cfads.length === 0 || termMonths <= 0) {
    return { maxDebtCr: ZERO, bindingMonth: null, achievedMinDSCR: null };
  }
  const target = targetDSCR.toNumber();
  if (target <= 0) return { maxDebtCr: ZERO, bindingMonth: null, achievedMinDSCR: null };
  const r = annualRate.toNumber() / 12;
  const n = Math.min(termMonths, cfads.length);
  let minCfads = Number.POSITIVE_INFINITY;
  let bindingMonth: number | null = null;
  for (let i = 0; i < n; i++) {
    const v = cfads[i].toNumber();
    if (v <= 0) continue;
    if (v < minCfads) {
      minCfads = v;
      bindingMonth = i;
    }
  }
  if (!Number.isFinite(minCfads) || bindingMonth === null) {
    return { maxDebtCr: ZERO, bindingMonth: null, achievedMinDSCR: null };
  }
  const emiFactor = r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));
  const maxEMI = minCfads / target;
  const maxDebt = maxEMI / emiFactor;
  return {
    maxDebtCr: Decimal.fromNumber(maxDebt),
    bindingMonth,
    achievedMinDSCR: Decimal.fromNumber(target),
  };
}

export function paybackMonth(cashFlows: readonly Decimal[]): number | null {
  let cum = 0;
  for (let i = 0; i < cashFlows.length; i++) {
    cum += cashFlows[i].toNumber();
    if (cum >= 0) return i;
  }
  return null;
}

export function peakEquityOutflow(equityFlows: readonly Decimal[]): Decimal {
  let cum = 0, peak = 0;
  for (const f of equityFlows) {
    cum += f.toNumber();
    if (cum < peak) peak = cum;
  }
  return Decimal.fromNumber(Math.abs(peak));
}

export interface ComputeKPIArgs {
  readonly equityCashFlows: readonly Decimal[];
  readonly equityMonths: readonly number[];
  readonly projectCashFlows: readonly Decimal[];
  readonly projectMonths: readonly number[];
  readonly cfads: readonly Decimal[];
  readonly debtService: readonly Decimal[];
  readonly debtOutstanding: readonly Decimal[];
  readonly annualDiscount: Decimal;
  readonly equityInflows: readonly Decimal[];
  readonly equityOutflows: readonly Decimal[];
  readonly targetDSCR: Decimal;
  readonly annualRate: Decimal;
  readonly termMonths: number;
}

export function computeKPIs(p: ComputeKPIArgs): IntelligenceKPIs {
  const m = moic(p.equityInflows, p.equityOutflows);
  return {
    irrLevered: xirr(p.equityCashFlows, p.equityMonths),
    irrUnlevered: xirr(p.projectCashFlows, p.projectMonths),
    moic: m,
    equityMultiple: m,
    dscrProfile: dscrProfile(p.cfads, p.debtService),
    llcr: llcr(p.cfads, p.debtOutstanding, p.annualDiscount),
    plcr: p.debtOutstanding.length > 0 ? plcr(p.cfads, p.debtOutstanding[0], p.annualDiscount) : null,
    peakEquityCr: peakEquityOutflow(p.equityCashFlows),
    paybackMonth: paybackMonth(p.equityCashFlows),
    debtCapacity: debtCapacity(p.cfads, p.targetDSCR, p.annualRate, p.termMonths),
  };
}
