/**
 * Scenario-analysis post-processor — kernel-native port of
 * `calculateScenarios` + `applyScenarioPreset` from
 * `backend/src/engines/financial.engine.js` lines 2587-2661.
 *
 * Three hardcoded scenarios (base / bull / bear) with identical shocks
 * to those in the legacy engine. Each scenario is a full `computeDeal`
 * re-run with perturbed raw inputs; we then return only the fields the
 * frontend `ScenarioComparison.jsx` reader consumes:
 *
 *   { label, color, adjustments, kpis, costs, revenue, capitalStack? }
 *
 * `capitalStack` is optional because the kernel does not (yet) fold the
 * overlay's capital-stack builders into every `computeDeal` path. The
 * service layer synthesizes it via `buildConstructionLoanCapitalStack`
 * et al; callers pass `capitalStackFor` if they want it on each cell.
 */

import type { AssetClass, DealInputs, KernelResult, CostBreakdown, RevenueBreakdown, KPISet } from '../types';
import { computeDeal } from '../registry';

type ScenarioKey = 'base' | 'bull' | 'bear';

interface ScenarioPreset {
  readonly label: string;
  readonly color: string;
  readonly revenueMultiplier: number;
  readonly hardCostMultiplier: number;
  readonly durationMultiplier: number;
  readonly financeDelta: number;
  readonly exitCapRateDelta: number;
  readonly vacancyDelta: number;
}

export const SCENARIO_PRESETS: Readonly<Record<ScenarioKey, ScenarioPreset>> = Object.freeze({
  base: {
    label: 'Base Case',
    color: 'slate',
    revenueMultiplier: 1.00,
    hardCostMultiplier: 1.00,
    durationMultiplier: 1.00,
    financeDelta: 0,
    exitCapRateDelta: 0,
    vacancyDelta: 0,
  },
  bull: {
    label: 'Bull Case',
    color: 'green',
    revenueMultiplier: 1.10,
    hardCostMultiplier: 0.95,
    durationMultiplier: 0.90,
    financeDelta: -1.0,
    exitCapRateDelta: -0.50,
    vacancyDelta: -3,
  },
  bear: {
    label: 'Bear Case',
    color: 'red',
    revenueMultiplier: 0.88,
    hardCostMultiplier: 1.10,
    durationMultiplier: 1.20,
    financeDelta: +2.0,
    exitCapRateDelta: +0.75,
    vacancyDelta: +5,
  },
});

type RawInput = Readonly<Record<string, unknown>>;
type MutableRaw = Record<string, unknown>;

function asNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function applyScenarioPreset(raw: RawInput, key: ScenarioKey): MutableRaw {
  if (key === 'base') return { ...raw };
  const preset = SCENARIO_PRESETS[key];
  const out: MutableRaw = { ...raw };

  // Revenue adjustments
  const sellingRatePerSqft = asNum(out.sellingRatePerSqft);
  if (sellingRatePerSqft != null) {
    out.sellingRatePerSqft = Math.round(sellingRatePerSqft * preset.revenueMultiplier);
  }
  const sellingRatePerSqyd = asNum(out.sellingRatePerSqyd);
  if (sellingRatePerSqyd != null) {
    out.sellingRatePerSqyd = Math.round(sellingRatePerSqyd * preset.revenueMultiplier);
  }
  const baseRent = asNum(out.baseRentPerSqftMonth);
  if (baseRent != null) {
    out.baseRentPerSqftMonth = Math.round(baseRent * preset.revenueMultiplier * 100) / 100;
  }

  // Hard cost adjustments
  const construction = asNum(out.constructionCostPerSqft);
  if (construction != null) {
    out.constructionCostPerSqft = Math.round(construction * preset.hardCostMultiplier);
  }
  const devCost = asNum(out.devCostPerSqft);
  if (devCost != null) {
    out.devCostPerSqft = Math.round(devCost * preset.hardCostMultiplier);
  }

  // Duration adjustments
  const duration = asNum(out.projectDurationMonths);
  if (duration != null) {
    const scaled = Math.min(180, Math.max(12, Math.round(duration * preset.durationMultiplier)));
    out.projectDurationMonths = scaled;
    const constEnd = asNum(out.constructionEndMonths);
    if (constEnd != null) {
      out.constructionEndMonths = Math.min(scaled, Math.round(constEnd * preset.durationMultiplier));
    }
  }

  // Financing adjustments
  const financeCostPct = asNum(out.financeCostPct);
  if (financeCostPct != null) {
    out.financeCostPct = Math.max(0, financeCostPct + preset.financeDelta);
  }
  const debtRatePct = asNum(out.debtRatePct);
  if (debtRatePct != null) {
    out.debtRatePct = Math.max(0, debtRatePct + preset.financeDelta);
  }

  // Income asset adjustments
  if (preset.exitCapRateDelta !== 0) {
    const exitCap = asNum(out.exitCapRate);
    if (exitCap != null) {
      out.exitCapRate = Math.max(3, exitCap + preset.exitCapRateDelta);
      const entryCap = asNum(out.entryCapRate);
      if (entryCap != null) {
        out.entryCapRate = Math.max(3, entryCap + preset.exitCapRateDelta * 0.5);
      }
    }
  }
  if (preset.vacancyDelta !== 0) {
    const vacancy = asNum(out.vacancyPct);
    if (vacancy != null) {
      out.vacancyPct = Math.max(0, Math.min(50, vacancy + preset.vacancyDelta));
    }
  }

  return out;
}

export interface ScenarioCell {
  readonly label: string;
  readonly color: string;
  readonly adjustments:
    | null
    | {
        readonly revenue: string;
        readonly hardCost: string;
        readonly duration: string;
        readonly financeRate: string;
      };
  readonly kpis: KPISet | null;
  readonly costs: CostBreakdown | null;
  readonly revenue: RevenueBreakdown | null;
  readonly capitalStack?: unknown;
  readonly error?: string;
}

export type ScenarioBundle = Readonly<Record<ScenarioKey, ScenarioCell>>;

export interface BuildScenariosArgs {
  readonly raw: RawInput;
  readonly assetClass: AssetClass;
  /**
   * Optional post-hook to synthesize the legacy-shape capital stack for
   * a scenario's result. Passed the perturbed raw + `KernelResult`.
   * Return value is surfaced untouched on the cell's `capitalStack`.
   */
  readonly capitalStackFor?: (raw: RawInput, result: KernelResult) => unknown;
}

function buildAdjustmentsBlock(key: ScenarioKey): ScenarioCell['adjustments'] {
  if (key === 'base') return null;
  const preset = SCENARIO_PRESETS[key];
  const pct = (mult: number) => `${mult >= 1 ? '+' : ''}${((mult - 1) * 100).toFixed(0)}%`;
  const sign = (v: number) => `${v > 0 ? '+' : ''}${v}`;
  return {
    revenue: pct(preset.revenueMultiplier),
    hardCost: pct(preset.hardCostMultiplier),
    duration: pct(preset.durationMultiplier),
    financeRate: `${sign(preset.financeDelta)}% pa`,
  };
}

/**
 * Compute base / bull / bear scenarios for a deal.
 *
 * Each scenario does a full `computeDeal` re-run on perturbed inputs.
 * Errors inside a single scenario are caught and surfaced on the cell
 * as `{ error, kpis: null, ... }` — the bundle always contains all
 * three keys.
 */
export function buildScenarios(args: BuildScenariosArgs): ScenarioBundle {
  const { raw, assetClass, capitalStackFor } = args;
  const cells = {} as { -readonly [K in ScenarioKey]: ScenarioCell };

  for (const key of ['base', 'bull', 'bear'] as const) {
    const preset = SCENARIO_PRESETS[key];
    try {
      const perturbedRaw = applyScenarioPreset(raw, key);
      const inputs: DealInputs = { assetClass, raw: perturbedRaw };
      const result = computeDeal(inputs);
      cells[key] = {
        label: preset.label,
        color: preset.color,
        adjustments: buildAdjustmentsBlock(key),
        kpis: result.kpis,
        costs: result.costs,
        revenue: result.revenue,
        capitalStack: capitalStackFor ? capitalStackFor(perturbedRaw, result) : undefined,
      };
    } catch (err) {
      cells[key] = {
        label: preset.label,
        color: preset.color,
        adjustments: buildAdjustmentsBlock(key),
        kpis: null,
        costs: null,
        revenue: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return Object.freeze(cells);
}
