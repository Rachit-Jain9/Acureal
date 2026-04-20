/**
 * Waterfall engine types. Skeleton shape supporting JDA (Joint Development
 * Agreement), JV (Joint Venture), and out-right structures. Business-rule
 * bodies are intentionally minimal here; per-tier allocation hooks let
 * downstream modules plug structure-specific logic without rewriting the
 * core priority ordering.
 */

import type { Decimal } from '../decimal';
import type { ProvenanceEntry } from '../types';

/** Supported deal structures. */
export type DealStructure = 'jda' | 'jv' | 'outright';

/**
 * Tier kind tags the cash-flow priority. Debt always precedes equity.
 * `pref_equity` sits between debt and common equity; `sponsor_promote` is
 * the promote/carried-interest bucket. `landowner_share` is a JDA-specific
 * construct (developer sharing revenue or built-area with landowner).
 */
export type TierKind =
  | 'senior_debt'
  | 'mezz_debt'
  | 'pref_equity'
  | 'common_equity'
  | 'sponsor_promote'
  | 'landowner_share'
  | 'return_of_capital'
  | 'preferred_return'
  | 'catch_up'
  | 'promote'
  | 'custom';

/** A stakeholder receiving allocations from a tier. */
export interface Stakeholder {
  readonly id: string;
  readonly label?: string;
  /** Role: lender, sponsor, lp (limited partner), landowner, co-investor, etc. */
  readonly role:
    | 'senior_lender'
    | 'mezz_lender'
    | 'sponsor'
    | 'lp'
    | 'landowner'
    | 'co_investor'
    | 'other';
}

/**
 * Allocation hook: pure function that, given an amount and caller context,
 * returns per-stakeholder splits and a leftover. Return values must sum to
 * the input amount (invariant asserted by the engine).
 */
export type AllocationHook = (
  input: AllocationHookInput,
) => AllocationHookOutput;

export interface AllocationHookInput {
  readonly amount: Decimal;
  readonly month: number;
  readonly tier: WaterfallTier;
  readonly context: WaterfallContext;
}

export interface AllocationHookOutput {
  readonly perStakeholder: readonly { readonly stakeholderId: string; readonly amount: Decimal }[];
  readonly leftover: Decimal;
  readonly notes?: readonly string[];
}

/**
 * State-aware demand function. Lets pref/catch-up/promote tiers look at
 * cumulative prior distributions and produce a period-correct demand
 * without the caller needing to precompute a static array.
 */
export type DemandFn = (ctx: TierDemandContext) => Decimal;

export interface TierDemandContext {
  readonly month: number;
  readonly tier: WaterfallTier;
  readonly cumulativeByTier: ReadonlyMap<string, Decimal>;
  readonly context: WaterfallContext;
}

export interface WaterfallTier {
  readonly id: string;
  readonly kind: TierKind;
  readonly label?: string;
  /** Lower = senior. Tiers with the same priority are paid pari-passu. */
  readonly priority: number;
  /** Stakeholders participating in this tier. */
  readonly stakeholders: readonly Stakeholder[];
  /** Allocation hook; if omitted, uses proportional split across stakeholders. */
  readonly allocate?: AllocationHook;
  /**
   * Per-month demand (e.g. scheduled debt service, preferred return accrual).
   * Can be zero if the tier is residual-only.
   */
  readonly demandPerMonth?: readonly Decimal[];
  /**
   * State-aware demand. Takes precedence over `demandPerMonth` when set —
   * used by pref/catch-up/promote tiers that depend on cumulative history.
   */
  readonly demandFn?: DemandFn;
  /** Cap on total cumulative allocation to this tier (₹ Cr). */
  readonly cumulativeCap?: Decimal;
}

export interface WaterfallContext {
  readonly structure: DealStructure;
  readonly totalMonths: number;
  /** Free-form key-value context passed through to hooks. */
  readonly extras?: Readonly<Record<string, number | string | boolean>>;
}

export interface WaterfallInputs {
  readonly context: WaterfallContext;
  readonly tiers: readonly WaterfallTier[];
  /** Monthly cash available for distribution (₹ Cr). */
  readonly availableByMonth: readonly Decimal[];
}

export interface WaterfallAllocationRow {
  readonly month: number;
  readonly tierId: string;
  readonly stakeholderId: string;
  readonly amount: Decimal;
}

export interface WaterfallOutputs {
  readonly rows: readonly WaterfallAllocationRow[];
  /** Sum per tier per month. */
  readonly perTierMonthly: readonly { readonly tierId: string; readonly byMonth: readonly Decimal[] }[];
  /** Residual (unallocated) per month. */
  readonly residualByMonth: readonly Decimal[];
  readonly provenance: readonly ProvenanceEntry[];
}
