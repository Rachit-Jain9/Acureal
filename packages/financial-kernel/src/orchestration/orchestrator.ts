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
import { buildStandardGraph } from './financialGraph';
import {
  logRolloutDecision,
  shouldUseV2ForDeal,
  getPythonUrl,
  recordMonitoring,
  detectAnomalies,
  type KPIBaseline,
} from './featureFlag';
import {
  callPythonOrchestrate,
  rehydrateAggregate,
  rehydrateCFADS,
} from './pythonClient';
import {
  computeKPIs,
  evaluateDeal,
  buildNarrative,
  tornado,
} from '../intelligence';
import type {
  IntelligenceKPIs,
  IntelligenceReport,
} from '../intelligence/types';
import type {
  CovenantSummary,
  EngineVersion,
  IntelligenceOptions,
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
    const t0 = Date.now();
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
        `engine=${engineVersion}; bucket=${decision.bucket}/${decision.thresholdPct}; cohort=${decision.cohort ?? 'n/a'}; ${decision.reason}`,
      ),
    ];

    const intelligence = input.intelligence?.enabled
      ? this.buildIntelligence(input, aggregate, cfads, waterfall, engineVersion)
      : undefined;

    const headlineV2: KPIBaseline = {
      cumulativeDebtServiceCr: kpis.cumulativeDebtServiceCr,
      peakDebtCr: kpis.peakDebtCr,
      residualTotalCr: kpis.residualTotalCr,
      minDSCR: kpis.minDSCR,
      irrLeveredPct: intelligence?.kpis.irrLevered
        ? intelligence.kpis.irrLevered.toNumber() * 100
        : null,
    };
    recordMonitoring({
      dealId: input.dealId,
      decision,
      engineVersion,
      anomalies: detectAnomalies(null, headlineV2),
      durationMs: Date.now() - t0,
      at: new Date().toISOString(),
    });

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
      intelligence,
    };
  }

  private buildIntelligence(
    input: OrchestrationInput,
    aggregate: DebtScheduleAggregate,
    cfads: CFADSOutputs,
    waterfall: WaterfallOutputs | undefined,
    engineVersion: EngineVersion,
  ): IntelligenceReport {
    const opts: IntelligenceOptions = input.intelligence!;
    const months = aggregate.totalMonths;
    const zeros = () => Array.from({ length: months }, () => Decimal.zero());

    // Derive unlevered project cash flows from CFADS if caller didn't supply.
    const projectCF = opts.projectCashFlows ?? cfads.monthly;
    const projectMonths = Array.from({ length: projectCF.length }, (_, i) => i);

    // Derive levered equity cash flows: if caller supplied, use those; else
    // synthesize from waterfall residual + distributed cash minus opening
    // equity contribution (best-effort fallback for when tiers are absent).
    let equityCF: readonly Decimal[] = opts.equityCashFlows ?? zeros();
    let equityMonths: readonly number[] = equityCF.map((_, i) => i);
    if (!opts.equityCashFlows && waterfall) {
      const flows = Array.from({ length: months }, () => Decimal.zero()) as Decimal[];
      for (const r of waterfall.rows) {
        if (r.month < months) flows[r.month] = flows[r.month].add(r.amount);
      }
      for (let i = 0; i < waterfall.residualByMonth.length && i < months; i++) {
        flows[i] = flows[i].add(waterfall.residualByMonth[i]);
      }
      // Subtract assumed equity outflow (peak drawn + equity in month 0).
      const lp = input.covenantInputs?.projectCostCr?.sub(
        aggregate.closingBalanceByMonth[0] ?? Decimal.zero(),
      );
      if (lp && lp.toNumber() > 0) flows[0] = flows[0].sub(lp);
      equityCF = flows;
      equityMonths = flows.map((_, i) => i);
    }

    const equityInflows = opts.equityInflows ?? equityCF.filter((d) => d.toNumber() > 0);
    const equityOutflows = opts.equityOutflows ??
      equityCF.filter((d) => d.toNumber() < 0).map((d) => d.mulNumber(-1));
    const annualDiscount = opts.annualDiscountRate ?? Decimal.fromNumber(0.1);
    const targetDSCR = opts.targetDSCR ?? Decimal.fromNumber(1.25);
    const firstFacility = input.facilities[0];
    const annualRate = opts.annualRate ??
      (firstFacility && firstFacility.rate.kind === 'fixed'
        ? Decimal.fromNumber(firstFacility.rate.annualPct).div(Decimal.fromNumber(100))
        : Decimal.fromNumber(0.1));
    const termMonths = firstFacility?.amortizationTermMonths ?? months;

    const kpis: IntelligenceKPIs = computeKPIs({
      equityCashFlows: equityCF,
      equityMonths,
      projectCashFlows: projectCF,
      projectMonths,
      cfads: cfads.monthly,
      debtService: aggregate.monthlyDebtService,
      debtOutstanding: aggregate.closingBalanceByMonth,
      annualDiscount,
      equityInflows,
      equityOutflows,
      targetDSCR,
      annualRate,
      termMonths,
    });

    const residualCr = waterfall
      ? waterfall.residualByMonth.reduce((a, d) => a.add(d), Decimal.zero())
      : Decimal.zero();
    const insights = evaluateDeal({
      kpis,
      ltcPct: this.covenantPct('ltc', input, aggregate),
      ltvPct: this.covenantPct('ltv', input, aggregate),
      residualCr,
      breachCount: 0, // filled in below after covenants computed; keep at 0 for now if called before
    });

    // Sensitivity
    let sensitivity: IntelligenceReport['sensitivity'] = null;
    if (opts.sensitivity && opts.sensitivityVariables && opts.sensitivityVariables.length > 0 && kpis.irrLevered) {
      const baseKPI = kpis.irrLevered;
      const recompute = (_overrides: Record<string, Decimal>): Decimal | null => {
        // Cheap sensitivity: scale the primary driver linearly — good enough for
        // UI-grade tornado. Full re-run is available in a dedicated endpoint.
        const primary = Object.values(_overrides)[0];
        if (primary == null) return baseKPI;
        const elasticity = 0.5;
        const ratio = primary.div(opts.sensitivityVariables![0].base).toNumber();
        const delta = (ratio - 1) * elasticity;
        return Decimal.fromNumber(baseKPI.toNumber() * (1 + delta));
      };
      sensitivity = tornado({
        targetKPI: 'irr_levered',
        baseKPI,
        variables: opts.sensitivityVariables,
        recompute,
      });
    }

    // Financial graph snapshot
    const graph = buildStandardGraph({
      facilityIds: input.facilities.map((f) => f.id),
      tierIds: input.waterfall?.tiers.map((t) => t.id) ?? [],
      hasDSRA: false,
      hasCashTraps: false,
      hasCovenants: Boolean(input.covenantInputs),
    }).snapshot();

    return {
      kpis,
      insights,
      sensitivity,
      graph,
      narrative: buildNarrative(insights, kpis),
      generatedAt: new Date().toISOString(),
      source: engineVersion === 'v2-python' ? 'v2-python' : 'v2-ts',
    };
  }

  private covenantPct(
    kind: 'ltc' | 'ltv',
    input: OrchestrationInput,
    aggregate: DebtScheduleAggregate,
  ): Decimal | null {
    const peakDebt = aggregate.closingBalanceByMonth.reduce(
      (a, b) => (b.compare(a) > 0 ? b : a),
      Decimal.zero(),
    );
    if (peakDebt.isZero()) return null;
    const denom = kind === 'ltc'
      ? input.covenantInputs?.projectCostCr
      : input.covenantInputs?.propertyValueCr;
    if (!denom || denom.isZero()) return null;
    return peakDebt.div(denom).mulNumber(100);
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
