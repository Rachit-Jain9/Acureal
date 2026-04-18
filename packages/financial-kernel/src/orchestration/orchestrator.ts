/**
 * FinancialOrchestrator — end-to-end Phase 3 pipeline.
 *
 * Stage 1: base kernel (`computeDeal`) produces asset-adapter output.
 * Stage 2: facility roll-forward (`rollForwardFacilities`) produces debt schedule.
 * Stage 3: CFADS (`computeCFADS`) from operating projections.
 * Stage 4: cash-flow graph reduces CFADS − DS ± DSRA ± traps → `availableByMonth`.
 * Stage 5: waterfall (`runWaterfall`) distributes available cash.
 * Stage 6: covenants (`computeCovenants`) & KPIs rolled up.
 *
 * Engines, in order of preference:
 *   1) Python service (when `DEBT_ENGINE_PY_URL` is set and gate passes)
 *   2) TypeScript kernel (pure, always available — default V2 engine)
 *   3) Legacy (not invoked here — caller falls through on `usedV2=false`)
 */

import { Decimal, sum as decSum } from '../decimal';
import { prov } from '../provenance';
import type { ProvenanceEntry } from '../types';
import {
  rollForwardFacilities,
  computeCFADS,
  computeCovenants,
  type DebtScheduleAggregate,
  type FacilitySchedule,
  type FacilitySpec,
  type CFADSInputs,
  type CFADSOutputs,
} from '../debt-engine';
import { runWaterfall } from '../waterfall-engine';
import type { WaterfallOutputs } from '../waterfall-engine';
import { computeDeal } from '../registry';
import { buildCashFlowGraph } from './cashFlowGraph';
import {
  logRolloutDecision,
  shouldUseV2ForDeal,
  getPythonUrl,
} from './featureFlag';
import {
  callPythonOrchestrate,
  rehydrateAggregate,
  rehydrateCFADS,
} from './pythonClient';
import type {
  CovenantSummary,
  EngineVersion,
  OrchestratedKPIs,
  OrchestrationInput,
  OrchestrationOutput,
  RolloutDecision,
} from './types';

export class FinancialOrchestrator {
  private readonly env: NodeJS.ProcessEnv;
  private readonly pythonEnabled: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
    this.pythonEnabled = getPythonUrl(env) != null;
  }

  /**
   * Top-level entry. Always returns a result; the `engineVersion` and
   * `rolloutDecision` fields describe which path ran.
   *
   * Invariants:
   *   - Throws only on invalid inputs (malformed spec, negative totalMonths).
   *   - Python failures degrade to TS silently; the decision records the fall-back.
   *   - `forceEngine` overrides rollout; useful for parity tests.
   */
  async compute(input: OrchestrationInput): Promise<OrchestrationOutput> {
    if (input.totalMonths <= 0) {
      throw new Error('FinancialOrchestrator.compute: totalMonths must be > 0');
    }
    let decision = shouldUseV2ForDeal(input.dealId, this.env);
    if (input.forceEngine === 'v1-legacy') {
      decision = { ...decision, usedV2: false, usedPython: false, reason: 'forceEngine v1' };
    } else if (input.forceEngine === 'v2-ts') {
      decision = { ...decision, usedV2: true, usedPython: false, reason: 'forceEngine v2-ts' };
    } else if (input.forceEngine === 'v2-python') {
      decision = {
        ...decision,
        usedV2: true,
        usedPython: this.pythonEnabled,
        reason: this.pythonEnabled ? 'forceEngine v2-python' : 'forceEngine v2-python (no URL, fallback)',
      };
    }
    logRolloutDecision(input.dealId, decision);

    const baseResult = computeDeal(input.dealInputs);

    let engineVersion: EngineVersion = 'v1-legacy';
    let aggregate: DebtScheduleAggregate;
    let scheduleByFacility: readonly FacilitySchedule[] = [];
    let cfads: CFADSOutputs;

    if (decision.usedV2 && decision.usedPython) {
      try {
        const pyResp = await this.runPython(input);
        aggregate = rehydrateAggregate(pyResp, input.totalMonths);
        cfads = rehydrateCFADS(pyResp);
        engineVersion = 'v2-python';
      } catch (err) {
        // Degrade to TS fallback silently; log for ops.
        if (process.env.DEBT_ENGINE_V2_SILENT !== '1') {
          console.warn(`[financial.orchestrator] python fallback: ${(err as Error).message}`);
        }
        ({ aggregate, scheduleByFacility, cfads } = this.computeLocalV2(input));
        engineVersion = 'v2-ts';
      }
    } else if (decision.usedV2) {
      ({ aggregate, scheduleByFacility, cfads } = this.computeLocalV2(input));
      engineVersion = 'v2-ts';
    } else {
      // V2 disabled: return a legacy-shape result with empty debt overlays.
      ({ aggregate, scheduleByFacility, cfads } = this.emptyLocal(input));
      engineVersion = 'v1-legacy';
    }

    const covenants = this.computeCovenantSummary(input, aggregate, cfads);
    const waterfall = this.runWaterfall(input, aggregate, cfads);
    const kpis = this.rollUpKPIs(aggregate, covenants, waterfall);

    const provenance: ProvenanceEntry[] = [
      prov(
        'orchestrator.engine',
        `kernel.orchestrator.${engineVersion}`,
        `engine=${engineVersion}; bucket=${decision.bucket}/${decision.thresholdPct}; ${decision.reason}`,
      ),
    ];

    return {
      engineVersion,
      baseResult,
      scheduleByFacility,
      aggregate,
      cfads,
      covenants,
      waterfall,
      kpis,
      provenance,
      rolloutDecision: decision,
    };
  }

  private computeLocalV2(input: OrchestrationInput): {
    aggregate: DebtScheduleAggregate;
    scheduleByFacility: readonly FacilitySchedule[];
    cfads: CFADSOutputs;
  } {
    const specs = input.facilities as FacilitySpec[];
    const aggregate = specs.length === 0
      ? this.emptyAggregate(input.totalMonths)
      : rollForwardFacilities(specs, { totalMonths: input.totalMonths });
    const cfads = computeCFADS(input.cfadsInputs);
    return {
      aggregate,
      scheduleByFacility: aggregate.facilities,
      cfads,
    };
  }

  private emptyLocal(input: OrchestrationInput) {
    const cfads = computeCFADS(input.cfadsInputs);
    return {
      aggregate: this.emptyAggregate(input.totalMonths),
      scheduleByFacility: [] as readonly FacilitySchedule[],
      cfads,
    };
  }

  private emptyAggregate(totalMonths: number): DebtScheduleAggregate {
    const zeros = () => Array.from({ length: totalMonths }, () => Decimal.zero());
    return {
      totalMonths,
      facilities: [],
      monthlyDebtService: zeros(),
      monthlyInterestPaid: zeros(),
      monthlyPrincipalPaid: zeros(),
      monthlyDrawn: zeros(),
      closingBalanceByMonth: zeros(),
      provenance: [],
    };
  }

  private async runPython(input: OrchestrationInput) {
    const url = getPythonUrl(this.env);
    if (!url) throw new Error('DEBT_ENGINE_PY_URL not set');
    return callPythonOrchestrate({
      url,
      dealId: input.dealId,
      facilities: input.facilities,
      cfadsInputs: input.cfadsInputs,
      tiers: input.waterfall?.tiers ?? [],
      availableByMonth: input.waterfall?.availableByMonth ?? [],
      totalMonths: input.totalMonths,
      projectCostCr: input.covenantInputs?.projectCostCr,
      propertyValueCr: input.covenantInputs?.propertyValueCr,
      sculptTarget: input.sculptTarget,
    });
  }

  private computeCovenantSummary(
    input: OrchestrationInput,
    aggregate: DebtScheduleAggregate,
    cfads: CFADSOutputs,
  ): CovenantSummary {
    const projectCostCr = input.covenantInputs?.projectCostCr ?? Decimal.zero();
    const out = computeCovenants(aggregate, {
      cfadsMonthly: cfads.monthly,
      projectCostCr,
      assetValueByMonth: input.covenantInputs?.propertyValueCr
        ? Array.from({ length: input.totalMonths }, () => input.covenantInputs!.propertyValueCr!)
        : undefined,
    });
    return {
      monthly: out.monthly,
      minDSCR: out.minDSCR,
      maxLTC: out.maxLTC,
      maxLTV: out.maxLTV,
      minCash: out.minCash,
      breaches: out.breaches,
    };
  }

  private runWaterfall(
    input: OrchestrationInput,
    aggregate: DebtScheduleAggregate,
    cfads: CFADSOutputs,
  ): WaterfallOutputs | undefined {
    if (!input.waterfall) return undefined;
    // If caller supplied explicit availableByMonth, honor it; otherwise derive
    // from CFADS − debt service via the cash-flow graph.
    const explicit = input.waterfall.availableByMonth;
    const available = explicit.length > 0
      ? explicit
      : buildCashFlowGraph({
          cfads,
          debt: aggregate,
          totalMonths: input.totalMonths,
        }).availableByMonth;
    return runWaterfall({
      context: {
        structure: input.waterfall.structure,
        totalMonths: input.totalMonths,
      },
      tiers: input.waterfall.tiers,
      availableByMonth: available,
    });
  }

  private rollUpKPIs(
    aggregate: DebtScheduleAggregate,
    covenants: CovenantSummary,
    waterfall: WaterfallOutputs | undefined,
  ): OrchestratedKPIs {
    const cumulativeDS = decSum(aggregate.monthlyDebtService);
    let peakDebt = Decimal.zero();
    for (const b of aggregate.closingBalanceByMonth) {
      if (b.compare(peakDebt) > 0) peakDebt = b;
    }
    const residualTotal = waterfall
      ? decSum(waterfall.residualByMonth)
      : Decimal.zero();
    const dscrValues = covenants.monthly
      .map((c) => c.dscr)
      .filter((v): v is number => v != null);
    const avgDSCR = dscrValues.length
      ? dscrValues.reduce((a, v) => a + v, 0) / dscrValues.length
      : null;
    return {
      cumulativeDebtServiceCr: cumulativeDS.toNumber(),
      peakDebtCr: peakDebt.toNumber(),
      residualTotalCr: residualTotal.toNumber(),
      minDSCR: covenants.minDSCR,
      avgDSCR,
      breachCount: covenants.breaches.length,
    };
  }
}

/**
 * Module-level convenience. Same signature as the class method.
 */
export async function orchestrate(input: OrchestrationInput): Promise<OrchestrationOutput> {
  return new FinancialOrchestrator().compute(input);
}
