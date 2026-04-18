/**
 * Phase 3 orchestration types.
 *
 * An orchestration pass takes a deal (inputs + facility specs + waterfall
 * tiers) and returns the unified financial picture: base kernel result,
 * debt schedule, CFADS, covenants, waterfall, and KPIs — together with
 * rollout provenance so we can reason about which engine produced which
 * number.
 */

import type { Decimal } from '../decimal';
import type {
  CFADSInputs,
  CFADSOutputs,
  CovenantResult,
  DebtScheduleAggregate,
  FacilityPeriodRow,
  FacilitySchedule,
  FacilitySpec,
} from '../debt-engine';
import type { WaterfallOutputs, WaterfallTier } from '../waterfall-engine';
import type {
  DealInputs,
  KernelResult,
  ProvenanceEntry,
} from '../types';
import type { IntelligenceReport } from '../intelligence/types';

export type CohortTier = 'control' | 'early' | 'ramp' | 'rollout' | 'full';

export interface CovenantSummary {
  readonly monthly: readonly CovenantResult[];
  readonly minDSCR: number | null;
  readonly maxLTC: number | null;
  readonly maxLTV: number | null;
  readonly minCash: number | null;
  readonly breaches: readonly string[];
}

export type EngineVersion = 'v1-legacy' | 'v2-ts' | 'v2-python';

/**
 * Input shape expected by `FinancialOrchestrator.compute`. Deliberately
 * separate from the raw deal inputs so we can evolve the orchestration
 * layer without touching the base kernel API.
 */
export interface IntelligenceOptions {
  /** Include IntelligenceReport in output. Default: false. */
  readonly enabled: boolean;
  /** Equity contribution timing (negative = outflow from investor). */
  readonly equityCashFlows?: readonly Decimal[];
  /** Project (unlevered) cash flows, month-indexed, aligned to totalMonths. */
  readonly projectCashFlows?: readonly Decimal[];
  /** Discount rate for LLCR/PLCR (annual, as fraction e.g. 0.09 = 9%). */
  readonly annualDiscountRate?: Decimal;
  /** Equity inflows (for MOIC numerator). */
  readonly equityInflows?: readonly Decimal[];
  /** Equity outflows (for MOIC denominator). */
  readonly equityOutflows?: readonly Decimal[];
  /** Target DSCR used to compute debt capacity. Default 1.25. */
  readonly targetDSCR?: Decimal;
  /** Annual facility rate used for debt capacity (if not supplied, uses first facility rate). */
  readonly annualRate?: Decimal;
  /** Include dynamic tornado sensitivity. */
  readonly sensitivity?: boolean;
  /** Variables to sweep for tornado. Default: empty (skip). */
  readonly sensitivityVariables?: readonly {
    name: string;
    base: Decimal;
    lowPct?: number;
    highPct?: number;
  }[];
}

export interface OrchestrationInput {
  readonly dealId: string;
  readonly dealInputs: DealInputs;
  readonly totalMonths: number;
  readonly facilities: readonly FacilitySpec[];
  readonly cfadsInputs: CFADSInputs;
  readonly waterfall?: {
    readonly tiers: readonly WaterfallTier[];
    readonly availableByMonth: readonly Decimal[];
    readonly structure: 'jda' | 'jv' | 'outright';
  };
  readonly covenantInputs?: {
    readonly projectCostCr?: Decimal;
    readonly propertyValueCr?: Decimal;
    readonly testMonths?: readonly number[];
  };
  readonly sculptTarget?: Decimal;
  /** Allow callers to force a specific engine (tests). Prod should leave undefined. */
  readonly forceEngine?: EngineVersion;
  /** Intelligence output options. Opt-in — legacy callers see no change. */
  readonly intelligence?: IntelligenceOptions;
}

/** Rolled-up headline metrics across the pipeline. */
export interface OrchestratedKPIs {
  readonly cumulativeDebtServiceCr: number;
  readonly peakDebtCr: number;
  readonly residualTotalCr: number;
  readonly minDSCR: number | null;
  readonly avgDSCR: number | null;
  readonly breachCount: number;
}

export interface OrchestrationOutput {
  readonly engineVersion: EngineVersion;
  readonly baseResult: KernelResult;
  readonly scheduleByFacility: readonly FacilitySchedule[];
  readonly aggregate: DebtScheduleAggregate;
  readonly cfads: CFADSOutputs;
  readonly covenants: CovenantSummary;
  readonly waterfall?: WaterfallOutputs;
  readonly kpis: OrchestratedKPIs;
  readonly provenance: readonly ProvenanceEntry[];
  readonly rolloutDecision: RolloutDecision;
  readonly intelligence?: IntelligenceReport;
}

export interface RolloutDecision {
  /** Whether the orchestration path ran at all. */
  readonly usedV2: boolean;
  /** Whether the Python engine was used (implies usedV2). */
  readonly usedPython: boolean;
  /** Deterministic hash bucket for this deal (0-99). */
  readonly bucket: number;
  /** Threshold percent at decision time. */
  readonly thresholdPct: number;
  readonly reason: string;
  /** True when the instant kill switch was engaged. */
  readonly killed?: boolean;
  /** Cohort tier for telemetry. */
  readonly cohort?: CohortTier;
}

/** Minimal JSON-safe facility row used on the Python wire format. */
export interface WireFacilityRow {
  facilityId: string;
  month: number;
  openingBalance: string;
  draw: string;
  interestAccrued: string;
  interestPaid: string;
  interestCapitalized: string;
  principalPaid: string;
  prepaymentPaid: string;
  closingBalance: string;
}

export type FacilityRow = FacilityPeriodRow;
