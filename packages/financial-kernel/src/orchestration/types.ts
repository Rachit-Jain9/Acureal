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
