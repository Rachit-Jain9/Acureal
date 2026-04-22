/**
 * Per-deal schedule overrides for kernel cash-flow curves.
 *
 * Underwriters routinely need to replace the default S-curve /
 * logistic-sales / front-loaded / uniform schedules with a concrete
 * project plan — a milestone ladder from the contractor, a sales plan
 * tied to launch/CLU/approvals, an ADR ramp from operator budgets.
 * This module provides a typed override shape and a deterministic
 * resolver that asset-class implementations call instead of the default
 * weight functions directly.
 *
 * The resolver ALWAYS returns weights summing to 1 across exactly the
 * requested number of months. If an override is invalid (empty, all
 * zero, non-finite), the resolver falls back to the default and attaches
 * a warning — the caller decides whether to surface it. Existing callers
 * that pass no override see identical numbers to before.
 */

import { frontLoadedWeights, logisticRevenueWeights, sCurveWeights, uniformWeights } from './periods';

export type CurveKind = 'sCurve' | 'logistic' | 'frontLoaded' | 'uniform';

/**
 * Deal-level curve override. Four shapes:
 *   - `{ kind: 'default' }`           → keep the default for this slot.
 *   - `{ kind: 'explicit', weights }` → hand-tuned weights, auto-normalised
 *                                       and linearly resized if length
 *                                       doesn't match the month count.
 *   - `{ kind: 'logistic', ... }`     → parametric logistic with tunable
 *                                       midpoint + steepness.
 *   - `{ kind: 'frontLoaded', ... }`  → parametric Gaussian bump with
 *                                       tunable peak + sharpness.
 *   - `{ kind: 'sCurve' }` / `{ kind: 'uniform' }` → pick a different
 *                                       built-in without tuning it.
 */
export type CurveOverride =
  | { kind: 'default' }
  | { kind: 'explicit'; weights: readonly number[] }
  | { kind: 'logistic'; midpoint?: number; steepness?: number }
  | { kind: 'frontLoaded'; peak?: number; sharpness?: number }
  | { kind: 'uniform' }
  | { kind: 'sCurve' };

export interface ResolvedCurve {
  readonly weights: readonly number[];
  readonly source: 'default' | 'explicit' | 'parametric';
  readonly kind: CurveKind;
  readonly warning?: string;
}

/** Normalise + sanitise an arbitrary weight array; returns null if unsalvageable. */
function normaliseWeights(raw: readonly number[]): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const cleaned = raw.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const total = cleaned.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return null;
  return cleaned.map((w) => w / total);
}

/**
 * Linearly interpolate a length-M weight array onto a length-N grid so
 * a caller who supplies, say, 12 quarterly weights can still drive a
 * 36-month schedule. Preserves the underlying shape (relative timing of
 * peaks) while re-normalising to sum to 1 at the target resolution.
 */
function resizeWeights(weights: readonly number[], targetMonths: number): number[] {
  if (weights.length === targetMonths) return [...weights];
  if (weights.length === 0 || targetMonths <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < targetMonths; i++) {
    const p = (i + 0.5) / targetMonths;
    const sIdxF = p * weights.length - 0.5;
    const lo = Math.max(0, Math.floor(sIdxF));
    const hi = Math.min(weights.length - 1, lo + 1);
    const alpha = Math.max(0, Math.min(1, sIdxF - lo));
    out.push(weights[lo] * (1 - alpha) + weights[hi] * alpha);
  }
  const sum = out.reduce((s, w) => s + w, 0);
  return sum > 0 ? out.map((w) => w / sum) : Array.from({ length: targetMonths }, () => 1 / targetMonths);
}

function defaultWeights(kind: CurveKind, months: number): number[] {
  switch (kind) {
    case 'sCurve':
      return sCurveWeights(months);
    case 'logistic':
      return logisticRevenueWeights(months);
    case 'frontLoaded':
      return frontLoadedWeights(months);
    case 'uniform':
      return uniformWeights(months);
  }
}

function clamp01(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampPositive(n: number, upper: number, fallback: number): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, upper);
}

/**
 * Single entry point used by every cash-flow primitive. `defaultKind`
 * tells the resolver what to use when no override is given; the
 * optional `override` object opts in to a replacement.
 */
export function resolveCurveWeights(
  months: number,
  defaultKind: CurveKind,
  override?: CurveOverride | null,
): ResolvedCurve {
  if (months <= 0) {
    return { weights: [], source: 'default', kind: defaultKind };
  }
  if (!override || override.kind === 'default') {
    return { weights: defaultWeights(defaultKind, months), source: 'default', kind: defaultKind };
  }

  if (override.kind === 'explicit') {
    const normalised = normaliseWeights(override.weights);
    if (!normalised) {
      return {
        weights: defaultWeights(defaultKind, months),
        source: 'default',
        kind: defaultKind,
        warning: `Explicit curve override rejected (empty / non-finite / all-zero); using ${defaultKind} default.`,
      };
    }
    if (normalised.length === months) {
      return { weights: normalised, source: 'explicit', kind: defaultKind };
    }
    return {
      weights: resizeWeights(normalised, months),
      source: 'explicit',
      kind: defaultKind,
      warning: `Explicit curve had ${normalised.length} weights; linearly rescaled to ${months} months.`,
    };
  }

  if (override.kind === 'logistic') {
    const mid = clamp01(override.midpoint ?? 0.6, 0.6);
    const steep = clampPositive(override.steepness ?? 7, 100, 7);
    return { weights: logisticRevenueWeights(months, mid, steep), source: 'parametric', kind: 'logistic' };
  }
  if (override.kind === 'frontLoaded') {
    const peak = clamp01(override.peak ?? 0.35, 0.35);
    const sharp = clampPositive(override.sharpness ?? 4, 30, 4);
    return { weights: frontLoadedWeights(months, peak, sharp), source: 'parametric', kind: 'frontLoaded' };
  }
  if (override.kind === 'sCurve') {
    return { weights: sCurveWeights(months), source: 'parametric', kind: 'sCurve' };
  }
  if (override.kind === 'uniform') {
    return { weights: uniformWeights(months), source: 'parametric', kind: 'uniform' };
  }

  return { weights: defaultWeights(defaultKind, months), source: 'default', kind: defaultKind };
}

/**
 * Safely coerce an untrusted value (e.g. straight off `req.body` via the
 * deal-input normaliser) into a typed `CurveOverride`. Returns `null`
 * for anything that doesn't look like a recognised override — the
 * caller should then just let the default run.
 */
export function parseCurveOverride(value: unknown): CurveOverride | null {
  if (value == null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const kind = String(obj.kind || '').toLowerCase();
  switch (kind) {
    case 'default':
      return { kind: 'default' };
    case 'explicit': {
      const weights = Array.isArray(obj.weights)
        ? (obj.weights as unknown[]).map((v) => Number(v))
        : [];
      return { kind: 'explicit', weights };
    }
    case 'logistic':
      return {
        kind: 'logistic',
        midpoint: typeof obj.midpoint === 'number' ? obj.midpoint : undefined,
        steepness: typeof obj.steepness === 'number' ? obj.steepness : undefined,
      };
    case 'frontloaded':
    case 'front_loaded':
    case 'frontloadedgaussian':
      return {
        kind: 'frontLoaded',
        peak: typeof obj.peak === 'number' ? obj.peak : undefined,
        sharpness: typeof obj.sharpness === 'number' ? obj.sharpness : undefined,
      };
    case 'scurve':
    case 's_curve':
      return { kind: 'sCurve' };
    case 'uniform':
      return { kind: 'uniform' };
    default:
      return null;
  }
}

// Exported for tests — not part of the public API.
export const _internal = {
  normaliseWeights,
  resizeWeights,
  defaultWeights,
};
