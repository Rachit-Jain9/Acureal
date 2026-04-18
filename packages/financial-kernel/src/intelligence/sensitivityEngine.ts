/**
 * Sensitivity engine — tornado + spider.
 * Caller supplies a `recompute(overrides)` closure; engine returns rows
 * sorted by |swing| descending so the UI can render a canonical tornado.
 */
import { Decimal } from '../decimal';
import type { SensitivityReport, TornadoRow } from './types';

export interface SensitivityVariable {
  readonly name: string;
  readonly base: Decimal;
  readonly lowPct?: number;
  readonly highPct?: number;
}

export type Recompute = (overrides: Record<string, Decimal>) => Decimal | null;

export function tornado(params: {
  targetKPI: SensitivityReport['targetKPI'];
  baseKPI: Decimal;
  variables: readonly SensitivityVariable[];
  recompute: Recompute;
}): SensitivityReport {
  const base: Record<string, Decimal> = {};
  for (const v of params.variables) base[v.name] = v.base;

  const rows: TornadoRow[] = [];
  for (const v of params.variables) {
    const lowMult = 1 + (v.lowPct ?? -10) / 100;
    const highMult = 1 + (v.highPct ?? 10) / 100;
    const lowInput = v.base.mulNumber(lowMult);
    const highInput = v.base.mulNumber(highMult);
    const lowKPI = params.recompute({ ...base, [v.name]: lowInput });
    const highKPI = params.recompute({ ...base, [v.name]: highInput });
    if (lowKPI == null || highKPI == null) continue;
    rows.push({
      variable: v.name,
      lowInput,
      highInput,
      baseKPI: params.baseKPI,
      lowKPI,
      highKPI,
      swing: Math.abs(highKPI.toNumber() - lowKPI.toNumber()),
    });
  }
  rows.sort((a, b) => b.swing - a.swing);
  return {
    targetKPI: params.targetKPI,
    baseKPI: params.baseKPI,
    rows,
    variables: params.variables.map((v) => v.name),
  };
}

export function spider(params: {
  variables: readonly SensitivityVariable[];
  recompute: Recompute;
  steps?: readonly number[];
}): Record<string, readonly { stepPct: number; input: Decimal; kpi: Decimal | null }[]> {
  const steps = params.steps ?? [-20, -10, 0, 10, 20];
  const base: Record<string, Decimal> = {};
  for (const v of params.variables) base[v.name] = v.base;
  const out: Record<string, { stepPct: number; input: Decimal; kpi: Decimal | null }[]> = {};
  for (const v of params.variables) {
    const curve: { stepPct: number; input: Decimal; kpi: Decimal | null }[] = [];
    for (const s of steps) {
      const inp = v.base.mulNumber(1 + s / 100);
      curve.push({ stepPct: s, input: inp, kpi: params.recompute({ ...base, [v.name]: inp }) });
    }
    out[v.name] = curve;
  }
  return out;
}
