/**
 * FinancialOrchestrator — end-to-end financial pipeline.
 *
 * One pass, six deterministic stages:
 *   1. base kernel (`computeDeal`) → asset-adapter output
 *   2. facility roll-forward (`rollForwardFacilities`) → debt schedule
 *   3. CFADS (`computeCFADS`) from operating projections
 *   4. cash-flow graph: CFADS − DS ± DSRA ± traps → `availableByMonth`
 *   5. waterfall (`runWaterfall`) distributes available cash
 *   6. covenants + KPIs rolled up
 *
 * Runtime selection (see `selectEngine` in featureFlag.ts):
 *   - `inline`    — in-process TypeScript kernel (the production path)
 *   - `safe-mode` — kill-switch engaged; returns a zero-overlay so a deal
 *                   page never crashes on engine failure
 *
 * The engine is always on; operators have a single emergency kill-switch
 * (`DEBT_ENGINE_KILL=1`) as an escape hatch. `forceEngine` on the input
 * is honored for tests and failover drills.
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
  logEngineDecision,
  selectEngine,
  recordMonitoring,
} from './featureFlag';
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
  EngineDecision,
  EngineVersion,
  IntelligenceOptions,
  OrchestratedKPIs,
  OrchestrationInput,
  OrchestrationOutput,
} from './types';

export class FinancialOrchestrator {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  /**
   * Top-level entry. Always returns a full result. `engineVersion` and
   * `engineDecision` describe which runtime produced the numbers.
   *
   * Invariants:
   *   - Throws only on malformed inputs (negative/zero `totalMonths`).
   *   - Kill-switch always wins — safe-mode returns zero overlays so the
   *     deal page stays renderable during an incident.
   *   - `forceEngine` is respected for tests + drills.
   */
  async compute(input: OrchestrationInput): Promise<OrchestrationOutput> {
    if (input.totalMonths <= 0) {
      throw new Error('FinancialOrchestrator.compute: totalMonths must be > 0');
    }
    const t0 = Date.now();

    // Engine selection is pure: (dealId, env) → EngineDecision.
    let decision = selectEngine(input.dealId, this.env);
    if (input.forceEngine && input.forceEngine !== decision.engineVersion) {
      decision = {
        ...decision,
        engineVersion: input.forceEngine,
        reason: `forceEngine=${input.forceEngine}`,
      };
    }
    logEngineDecision(input.dealId, decision);

    // Base kernel always runs — asset-adapter output is the canonical
    // deal shape every caller has depended on since the kernel landed.
    const baseResult = computeDeal(input.dealInputs);

    let engineVersion: EngineVersion;
    let aggregate: DebtScheduleAggregate;
    let scheduleByFacility: readonly FacilitySchedule[] = [];
    let cfads: CFADSOutputs;

    if (decision.engineVersion === 'safe-mode') {
      // Kill-switch: produce a valid result with zero debt overlays so the
      // deal page renders and CFADS still reflects operations. No throws.
      ({ aggregate, scheduleByFacility, cfads } = this.emptyOverlay(input));
      engineVersion = 'safe-mode';
    } else {
      // Default path: in-process TypeScript kernel.
      ({ aggregate, scheduleByFacility, cfads } = this.computeInline(input));
      engineVersion = 'inline';
    }

    const covenants = this.computeCovenantSummary(input, aggregate, cfads);
    const waterfall = this.runWaterfall(input, aggregate, cfads);
    const kpis = this.rollUpKPIs(aggregate, covenants, waterfall);

    const provenance: ProvenanceEntry[] = [
      prov(
        'orchestrator.engine',
        `kernel.orchestrator.${engineVersion}`,
        `engine=${engineVersion}; bucket=${decision.bucket}; reason=${decision.reason}`,
      ),
    ];

    const intelligence = input.intelligence?.enabled
      ? this.buildIntelligence(input, aggregate, cfads, waterfall, engineVersion)
      : undefined;

    recordMonitoring(
      {
        dealId: input.dealId,
        decision,
        engineVersion,
        durationMs: Date.now() - t0,
        at: new Date().toISOString(),
      },
      console,
      this.env,
    );

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
      engineDecision: decision,
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
      source: 'inline',
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

  /** In-process TypeScript debt + CFADS runtime. Handles empty facilities. */
  private computeInline(input: OrchestrationInput): {
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

  /**
   * Zero-overlay result used under the kill-switch. CFADS still runs
   * because it's just operating math — the overlay only zeros out debt.
   */
  private emptyOverlay(input: OrchestrationInput) {
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
