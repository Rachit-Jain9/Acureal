/**
 * Monthly period helpers. Every kernel calculation normalizes time
 * to months; quarterly/yearly roll-ups are presentation only.
 */

import type { PeriodIndex } from './types';

export interface BuildPeriodArgs {
  /** ISO date string. If absent/invalid, defaults to "1970-01-01" to keep
   *  determinism — kernel must never read wall-clock. */
  readonly effectiveDate?: string;
  readonly projectDurationMonths: number;
  readonly constructionStartMonth?: number;
  readonly constructionEndMonth?: number;
  readonly holdMonths?: number;
}

export function buildPeriodIndex(args: BuildPeriodArgs): PeriodIndex {
  const effectiveDate = normalizeEffectiveDate(args.effectiveDate);
  const projectDurationMonths = clampInt(args.projectDurationMonths, 1, 360);
  const constructionStartMonth = clampInt(args.constructionStartMonth ?? 0, 0, projectDurationMonths);
  const constructionEndMonth = clampInt(
    args.constructionEndMonth ?? projectDurationMonths,
    constructionStartMonth + 1,
    projectDurationMonths,
  );
  const holdMonths = clampInt(args.holdMonths ?? 0, 0, 360);
  const totalMonths = projectDurationMonths + holdMonths;
  return Object.freeze({
    effectiveDate,
    totalMonths,
    constructionStartMonth,
    constructionEndMonth,
    holdMonths,
  });
}

/**
 * S-curve weights for hard-cost spend over N months. Weights sum to 1.
 * Kept in sync with the legacy engine's `sCurveWeights` to minimise
 * cash-flow reconciliation drift.
 */
export function sCurveWeights(months: number): number[] {
  if (months <= 0) return [];
  const raw = Array.from({ length: months }, (_, i) => {
    const p = (i + 1) / months;
    return Math.max(0.01, Math.sin(p * Math.PI) * 1.5);
  });
  const total = raw.reduce((s, w) => s + w, 0);
  return raw.map((w) => w / total);
}

/** Logistic right-skewed weights — milestone-linked sales collections. */
export function logisticRevenueWeights(months: number, midpoint: number = 0.6, steepness: number = 7): number[] {
  if (months <= 0) return [];
  const raw = Array.from({ length: months }, (_, i) => {
    const p = (i + 1) / months;
    return Math.max(0.04, 1 / (1 + Math.exp(-steepness * (p - midpoint))));
  });
  const total = raw.reduce((s, w) => s + w, 0);
  return raw.map((w) => w / total);
}

/** Gaussian-bump weights — plotted launches skew early. */
export function frontLoadedWeights(months: number, peak: number = 0.35, sharpness: number = 4): number[] {
  if (months <= 0) return [];
  const raw = Array.from({ length: months }, (_, i) => {
    const p = (i + 1) / months;
    return Math.max(0.06, Math.exp(-sharpness * (p - peak) ** 2) + 0.1);
  });
  const total = raw.reduce((s, w) => s + w, 0);
  return raw.map((w) => w / total);
}

/** Uniform weights across N months. */
export function uniformWeights(months: number): number[] {
  if (months <= 0) return [];
  const w = 1 / months;
  return Array.from({ length: months }, () => w);
}

/**
 * Roll a monthly series up to quarterly and yearly buckets.
 * Purely presentation — kernel math stays monthly.
 */
export function rollUp<T>(
  monthly: readonly T[],
  group: number,
  combine: (chunk: readonly T[]) => T,
): T[] {
  const out: T[] = [];
  for (let i = 0; i < monthly.length; i += group) {
    out.push(combine(monthly.slice(i, i + group)));
  }
  return out;
}

function normalizeEffectiveDate(raw?: string): string {
  if (!raw) return '1970-01-01';
  // Accept either "yyyy-mm-dd" or a full ISO timestamp; reject anything else.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '1970-01-01';
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const rounded = Math.round(n);
  if (rounded < lo) return lo;
  if (rounded > hi) return hi;
  return rounded;
}
