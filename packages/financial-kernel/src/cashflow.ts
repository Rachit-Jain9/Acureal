/**
 * Shared monthly cash-flow engine primitives.
 *
 * Every asset-class implementation builds its monthly cash-flow by
 * composing the builders defined here — land outflow, approvals schedule,
 * S-curve construction spend, finance drag, revenue distribution, exit
 * proceeds. No asset class re-implements its own time-series loop.
 */

import { Decimal, sum as decSum } from './decimal';
import type { MonthlyLineItem, PeriodIndex, ProvenanceEntry } from './types';
import { frontLoadedWeights, logisticRevenueWeights, sCurveWeights, uniformWeights } from './periods';
import { prov } from './provenance';

/** Fills a zeroed monthly Decimal array for a given period. */
export function zeroMonthly(period: PeriodIndex): Decimal[] {
  return Array.from({ length: period.totalMonths + 1 }, () => Decimal.zero());
}

/** Sum a list of monthly line items into a single net series. */
export function netMonthly(period: PeriodIndex, items: readonly MonthlyLineItem[]): Decimal[] {
  const net = zeroMonthly(period);
  for (const item of items) {
    for (let t = 0; t < item.values.length && t < net.length; t++) {
      if (item.sign === 'inflow') {
        net[t] = net[t].add(item.values[t]);
      } else {
        net[t] = net[t].sub(item.values[t]);
      }
    }
  }
  return net;
}

/**
 * Build a monthly outflow distributed by an arbitrary weight vector.
 * Weights must sum to 1; the resulting array length equals `period.totalMonths + 1`
 * with non-zero entries only at `startMonth + i` for i in [0, weights.length).
 */
export function distributeOutflow({
  period,
  startMonth,
  amount,
  weights,
  category,
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  startMonth: number;
  amount: Decimal;
  weights: readonly number[];
  category: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const values = zeroMonthly(period);
  for (let i = 0; i < weights.length; i++) {
    const idx = startMonth + i;
    if (idx < 0 || idx >= values.length) continue;
    values[idx] = values[idx].add(amount.mulNumber(weights[i]));
  }
  const item: {
    category: string;
    subcategory?: string;
    sign: 'outflow';
    values: readonly Decimal[];
    provenance: readonly ProvenanceEntry[];
  } = {
    category,
    sign: 'outflow',
    values,
    provenance: provenance ?? [],
  };
  if (subcategory !== undefined) item.subcategory = subcategory;
  return item as MonthlyLineItem;
}

/** Symmetric helper for inflows. */
export function distributeInflow({
  period,
  startMonth,
  amount,
  weights,
  category,
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  startMonth: number;
  amount: Decimal;
  weights: readonly number[];
  category: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const values = zeroMonthly(period);
  for (let i = 0; i < weights.length; i++) {
    const idx = startMonth + i;
    if (idx < 0 || idx >= values.length) continue;
    values[idx] = values[idx].add(amount.mulNumber(weights[i]));
  }
  const item: {
    category: string;
    subcategory?: string;
    sign: 'inflow';
    values: readonly Decimal[];
    provenance: readonly ProvenanceEntry[];
  } = {
    category,
    sign: 'inflow',
    values,
    provenance: provenance ?? [],
  };
  if (subcategory !== undefined) item.subcategory = subcategory;
  return item as MonthlyLineItem;
}

/** Bullet outflow in a single month. */
export function bulletOutflow({
  period,
  month,
  amount,
  category,
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  month: number;
  amount: Decimal;
  category: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const values = zeroMonthly(period);
  if (month >= 0 && month < values.length) {
    values[month] = values[month].add(amount);
  }
  const item: {
    category: string;
    subcategory?: string;
    sign: 'outflow';
    values: readonly Decimal[];
    provenance: readonly ProvenanceEntry[];
  } = {
    category,
    sign: 'outflow',
    values,
    provenance: provenance ?? [],
  };
  if (subcategory !== undefined) item.subcategory = subcategory;
  return item as MonthlyLineItem;
}

/** Bullet inflow in a single month. */
export function bulletInflow({
  period,
  month,
  amount,
  category,
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  month: number;
  amount: Decimal;
  category: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const values = zeroMonthly(period);
  if (month >= 0 && month < values.length) {
    values[month] = values[month].add(amount);
  }
  const item: {
    category: string;
    subcategory?: string;
    sign: 'inflow';
    values: readonly Decimal[];
    provenance: readonly ProvenanceEntry[];
  } = {
    category,
    sign: 'inflow',
    values,
    provenance: provenance ?? [],
  };
  if (subcategory !== undefined) item.subcategory = subcategory;
  return item as MonthlyLineItem;
}

/**
 * Build an S-curve construction-cost line item across the construction
 * window defined on the period.
 */
export function sCurveConstruction({
  period,
  amount,
  category = 'hard_cost',
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  amount: Decimal;
  category?: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const months = Math.max(1, period.constructionEndMonth - period.constructionStartMonth);
  const weights = sCurveWeights(months);
  return distributeOutflow({
    period,
    startMonth: period.constructionStartMonth,
    amount,
    weights,
    category,
    subcategory,
    provenance,
  });
}

/** Milestone-linked sales collections (right-skewed logistic). */
export function milestoneSales({
  period,
  amount,
  startMonth,
  endMonth,
  category = 'sales',
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  amount: Decimal;
  startMonth: number;
  endMonth: number;
  category?: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const months = Math.max(1, endMonth - startMonth + 1);
  const weights = logisticRevenueWeights(months);
  return distributeInflow({
    period,
    startMonth,
    amount,
    weights,
    category,
    subcategory,
    provenance,
  });
}

/** Plotted-style launch bookings — front-loaded Gaussian bump. */
export function frontLoadedSales({
  period,
  amount,
  startMonth,
  endMonth,
  category = 'sales',
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  amount: Decimal;
  startMonth: number;
  endMonth: number;
  category?: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const months = Math.max(1, endMonth - startMonth + 1);
  const weights = frontLoadedWeights(months);
  return distributeInflow({
    period,
    startMonth,
    amount,
    weights,
    category,
    subcategory,
    provenance,
  });
}

/** Uniformly-spread operating-period outflow or inflow. */
export function uniformFlow({
  period,
  amount,
  startMonth,
  endMonth,
  sign,
  category,
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  amount: Decimal;
  startMonth: number;
  endMonth: number;
  sign: 'inflow' | 'outflow';
  category: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  const months = Math.max(1, endMonth - startMonth + 1);
  const weights = uniformWeights(months);
  if (sign === 'inflow') {
    return distributeInflow({
      period,
      startMonth,
      amount,
      weights,
      category,
      subcategory,
      provenance,
    });
  }
  return distributeOutflow({
    period,
    startMonth,
    amount,
    weights,
    category,
    subcategory,
    provenance,
  });
}

/**
 * Sum line items into a flat net Decimal array. Strictly a convenience
 * — callers that need per-item provenance should iterate items directly.
 */
export function aggregateNet(items: readonly MonthlyLineItem[], period: PeriodIndex): Decimal[] {
  return netMonthly(period, items);
}

/** Convenience: total of all outflows across items. */
export function totalOutflows(items: readonly MonthlyLineItem[]): Decimal {
  const outs: Decimal[] = [];
  for (const item of items) {
    if (item.sign !== 'outflow') continue;
    outs.push(decSum(item.values as Decimal[]));
  }
  return decSum(outs);
}

/** Convenience: total of all inflows across items. */
export function totalInflows(items: readonly MonthlyLineItem[]): Decimal {
  const ins: Decimal[] = [];
  for (const item of items) {
    if (item.sign !== 'inflow') continue;
    ins.push(decSum(item.values as Decimal[]));
  }
  return decSum(ins);
}

/**
 * Trivial helper: quarterly rollup of a monthly Decimal series. Useful for
 * legacy interop where callers expect quarterly cashflows.
 */
export function monthlyToQuarterly(monthly: readonly Decimal[]): Decimal[] {
  const out: Decimal[] = [];
  for (let i = 0; i < monthly.length; i += 3) {
    const chunk = monthly.slice(i, i + 3);
    out.push(decSum(chunk));
  }
  return out;
}

/** Default provenance builder for composed cash-flow items. */
export function cashflowProv(
  key: string,
  source: string,
  transform?: string,
  assumptions?: readonly string[],
): ProvenanceEntry {
  return prov(key, source, transform, assumptions);
}
