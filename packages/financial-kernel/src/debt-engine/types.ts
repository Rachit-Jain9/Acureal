/**
 * Facility-based debt engine types.
 *
 * All schedules are canonical monthly. Time terms are expressed in months.
 * Money is Decimal (BigInt-backed fixed precision). Nothing in this module
 * touches the DB, network, Date.now, randomness, filesystem, or UI.
 */

import type { Decimal } from '../decimal';
import type { ProvenanceEntry } from '../types';

/** Supported facility profiles. */
export type FacilityKind =
  | 'interest_only'
  | 'amortizing_emi'
  | 'amortizing_custom'
  | 'bullet'
  | 'balloon'
  | 'refinance';

/** Compounding basis for interest accrual. */
export type CompoundingBasis = 'monthly' | 'simple_monthly';

/**
 * Rate model. Fixed is constant for facility life. Floating is a spread
 * above a monthly-indexed reference rate passed by month; caller supplies
 * the reference series at facility origination.
 */
export type RateModel =
  | { readonly kind: 'fixed'; readonly annualPct: number }
  | {
      readonly kind: 'floating';
      /** Spread over reference rate, in percentage points (annual). */
      readonly spreadPct: number;
      /**
       * Reference rate series, aligned to the model period index. Missing
       * entries fall back to `spreadPct` alone. Annual percentage.
       */
      readonly referenceAnnualPct: readonly number[];
      /** Floor on effective annual rate (default 0). */
      readonly floorAnnualPct?: number;
      /** Cap on effective annual rate (default Infinity). */
      readonly capAnnualPct?: number;
    };

/**
 * Draw rule describing how the facility can be drawn. One of:
 * - schedule: explicit per-month cap (values in ₹ Cr).
 * - basis_linked: drawn pro-rata against an external basis series
 *   (e.g. monthly construction spend) up to an availability cap.
 * - bullet_at_origination: fully drawn at `startMonth`.
 */
export type DrawRule =
  | {
      readonly kind: 'schedule';
      /** Per-month cap series, length ≥ model totalMonths or padded with 0. */
      readonly perMonth: readonly Decimal[];
    }
  | {
      readonly kind: 'basis_linked';
      /** Per-month basis series (e.g. construction spend). Used pro-rata. */
      readonly basis: readonly Decimal[];
      /** Max fraction of basis each month (0–1). Default 1. */
      readonly perMonthCapFraction?: number;
    }
  | { readonly kind: 'bullet_at_origination' };

/** Stop condition preventing further draws after a given month. */
export interface DrawStopCondition {
  /** Draws stop at/after this absolute month index (inclusive). */
  readonly stopAtMonth: number;
  readonly reason?: string;
}

/** Amortization shape for amortizing_custom facilities. */
export interface CustomAmortization {
  /** Per-month principal repayment (₹ Cr). Length ≥ model totalMonths. */
  readonly principalPerMonth: readonly Decimal[];
}

/** DSRA (Debt Service Reserve Account) configuration. */
export interface DSRAConfig {
  /** Target months of debt service to maintain in reserve. */
  readonly monthsOfDebtService: number;
  /**
   * Month at which funding begins (DSRA deposits start). Defaults to
   * `startMonth`. Funding is pro-rated until `targetFullFundingMonth`.
   */
  readonly fundFromMonth?: number;
  readonly targetFullFundingMonth?: number;
  /** Release rule: always, on_final_maturity, or never. */
  readonly releasePolicy?: 'on_final_maturity' | 'as_covenant_permits' | 'never';
}

/** Fee definition. */
export interface FeeDef {
  readonly kind: 'upfront_pct' | 'upfront_amount' | 'ongoing_annual_pct';
  /** If `kind` ends in `_pct`, this is % of commitment; else ₹ Cr. */
  readonly value: number;
  /** Month the fee is charged for upfront; ignored for ongoing. */
  readonly atMonth?: number;
}

/** Penalty / prepayment configuration. */
export interface PrepaymentRule {
  /**
   * Allowed prepayment policy.
   *  - none: no voluntary prepayment
   *  - any_time: allowed at any month after lockout
   *  - scheduled: only at specific months
   */
  readonly policy: 'none' | 'any_time' | 'scheduled';
  /** Lockout period (months from startMonth). Default 0. */
  readonly lockoutMonths?: number;
  /** Penalty as fraction of prepaid principal (0–1). Default 0. */
  readonly penaltyFraction?: number;
  /** For 'scheduled' — list of allowed absolute months. */
  readonly allowedMonths?: readonly number[];
}

/**
 * Refinance directive: close `fromFacilityId` and originate a new facility
 * with the provided spec at `atMonth`. The refinancing facility draws the
 * outstanding balance of the old one (up to its own commitment).
 */
export interface RefinanceDirective {
  readonly atMonth: number;
  readonly fromFacilityId: string;
  readonly replacementSpec: FacilitySpec;
  /** Optional cash sweep if replacement commitment exceeds takeout. */
  readonly retainSurplus?: boolean;
}

/**
 * Facility spec. All time values are canonical month indices anchored
 * to the model PeriodIndex (month 0 = effective date).
 */
export interface FacilitySpec {
  readonly id: string;
  readonly kind: FacilityKind;
  readonly label?: string;
  readonly currency: 'INR';
  readonly commitment: Decimal;
  readonly startMonth: number;
  readonly maturityMonth: number;
  readonly rate: RateModel;
  readonly compounding: CompoundingBasis;
  readonly drawRule: DrawRule;
  readonly drawStop?: DrawStopCondition;
  /**
   * Moratorium / IO period (months from startMonth). During this period
   * no principal is repaid; interest may be either paid or capitalized
   * depending on `capitalizeInterestDuringMoratorium`.
   */
  readonly moratoriumMonths?: number;
  readonly capitalizeInterestDuringMoratorium?: boolean;
  /**
   * Amortization start month (absolute). Defaults to
   * `startMonth + moratoriumMonths`.
   */
  readonly amortizationStartMonth?: number;
  /**
   * Amortization term in months (EMI / custom shape length). Defaults
   * to `maturityMonth - amortizationStartMonth`.
   */
  readonly amortizationTermMonths?: number;
  /**
   * Repayment frequency in months. 1 = monthly, 3 = quarterly, 6 =
   * semi-annual, 12 = annual. Interest still accrues monthly; principal
   * is applied on the frequency boundary.
   */
  readonly repaymentFrequencyMonths?: number;
  /** For amortizing_custom only. */
  readonly customAmortization?: CustomAmortization;
  /** Grace period in months before any interest payment is due. */
  readonly gracePeriodMonths?: number;
  readonly fees?: readonly FeeDef[];
  readonly dsra?: DSRAConfig;
  readonly prepayment?: PrepaymentRule;
  /**
   * Voluntary prepayment events: repay `amount` of principal at `atMonth`
   * (subject to prepayment rule; any penalty is applied automatically).
   */
  readonly prepaymentEvents?: readonly { readonly atMonth: number; readonly amount: Decimal }[];
  readonly refinance?: RefinanceDirective;
  /**
   * Tier for waterfall ordering (lower = senior). Default: 100.
   */
  readonly seniority?: number;
  /** Free-form covenant config (kept opaque to the engine). */
  readonly covenants?: CovenantSpec;
}

/** Covenant thresholds tracked by the engine. */
export interface CovenantSpec {
  readonly minDSCR?: number;
  readonly maxLTC?: number;
  readonly maxLTV?: number;
  readonly minCashCr?: number;
  readonly testFrequencyMonths?: number;
}

/** Single-month roll-forward row for one facility. */
export interface FacilityPeriodRow {
  readonly month: number;
  readonly openingBalance: Decimal;
  readonly draw: Decimal;
  readonly interestAccrued: Decimal;
  readonly interestPaid: Decimal;
  readonly interestCapitalized: Decimal;
  readonly principalPaid: Decimal;
  readonly prepaymentPaid: Decimal;
  readonly prepaymentPenalty: Decimal;
  readonly feesPaid: Decimal;
  readonly dsraDeposit: Decimal;
  readonly dsraRelease: Decimal;
  readonly dsraBalance: Decimal;
  readonly closingBalance: Decimal;
  readonly effectiveAnnualRatePct: number;
}

/** Facility schedule across the model horizon. */
export interface FacilitySchedule {
  readonly facilityId: string;
  readonly kind: FacilityKind;
  readonly rows: readonly FacilityPeriodRow[];
  readonly commitment: Decimal;
  /** Sum over rows.draw. */
  readonly totalDrawn: Decimal;
  /** Sum of interestPaid + principalPaid + prepaymentPaid + fees. */
  readonly totalDebtService: Decimal;
  readonly totalInterestPaid: Decimal;
  readonly totalInterestCapitalized: Decimal;
  readonly totalPrincipalPaid: Decimal;
  readonly totalFees: Decimal;
  readonly finalBalance: Decimal;
  readonly provenance: readonly ProvenanceEntry[];
}

/** Monthly CFADS inputs (all ₹ Cr). */
export interface CFADSInputs {
  /** Operating revenue by month. */
  readonly revenue: readonly Decimal[];
  /** Operating expenses by month. */
  readonly opex: readonly Decimal[];
  /** Taxes by month. */
  readonly taxes: readonly Decimal[];
  /** Maintenance capex by month. */
  readonly maintenanceCapex: readonly Decimal[];
  /** Working capital movement by month (use-of-cash positive). */
  readonly workingCapital?: readonly Decimal[];
}

export interface CFADSOutputs {
  readonly monthly: readonly Decimal[];
  readonly annualBuckets: readonly Decimal[];
  /** 12-month rolling sum, one entry per month after enough history. */
  readonly rolling12m: readonly (Decimal | null)[];
  readonly provenance: readonly ProvenanceEntry[];
}

/** Covenant test output. */
export interface CovenantResult {
  readonly month: number;
  readonly dscr: number | null;
  readonly ltc: number | null;
  readonly ltv: number | null;
  readonly minCash: number | null;
  readonly breaches: readonly string[];
}

/** Aggregate debt outputs for a set of facilities. */
export interface DebtScheduleAggregate {
  readonly totalMonths: number;
  readonly facilities: readonly FacilitySchedule[];
  /** Sum across facilities, per month. */
  readonly monthlyDebtService: readonly Decimal[];
  readonly monthlyInterestPaid: readonly Decimal[];
  readonly monthlyPrincipalPaid: readonly Decimal[];
  readonly monthlyDrawn: readonly Decimal[];
  readonly closingBalanceByMonth: readonly Decimal[];
  readonly provenance: readonly ProvenanceEntry[];
}

/** DSCR sculpting request. */
export interface SculptRequest {
  readonly facilityId: string;
  /** Target minimum DSCR the sculpted schedule must satisfy. */
  readonly targetDSCR: number;
  /** Solver tolerance on DSCR (default 1e-4). */
  readonly tolerance?: number;
  /** Max iterations (default 200). */
  readonly maxIterations?: number;
  /** CFADS to sculpt against (per facility-life month, post-moratorium). */
  readonly cfadsMonthly: readonly Decimal[];
}

export interface SculptResult {
  readonly facilityId: string;
  readonly principalPerMonth: readonly Decimal[];
  readonly achievedMinDSCR: number;
  readonly iterations: number;
  readonly converged: boolean;
}
