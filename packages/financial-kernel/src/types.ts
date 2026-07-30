/**
 * Canonical types for the Acureal financial kernel.
 *
 * All calculations run on monthly periods internally. Money values use
 * fixed-precision BigInt-backed `Decimal` instances; UI-facing conversions
 * to Number happen only at the serialization boundary.
 */

import type { Decimal } from './decimal';

/** Supported asset classes. */
export type AssetClass =
  | 'residential_apartments'
  | 'plotted_development'
  | 'commercial_office'
  | 'retail'
  | 'industrial_warehousing'
  | 'hospitality'
  | 'mixed_use'
  | 'land_parcel'
  | 'villas'
  | 'redevelopment';

/** Cash-flow sign. */
export type FlowSign = 'inflow' | 'outflow';

/**
 * Raw deal inputs as they arrive from the Acureal app. Free-form so legacy
 * payloads don't need a schema migration to start flowing through the kernel.
 * Numeric coercion is handled in the asset adapter.
 */
export interface DealInputs {
  readonly assetClass: AssetClass;
  readonly currency?: 'INR';
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * Overridable assumptions — anything not originating directly from the deal.
 * Used for scenario overrides and defaults that are expressed separately from
 * source-of-truth inputs.
 */
export type AssumptionSet = Readonly<Record<string, number | string | boolean | null | undefined>>;

/** A canonical monthly period index anchored to an effective date. */
export interface PeriodIndex {
  /** ISO date (yyyy-mm-dd) of period 0. */
  readonly effectiveDate: string;
  /** Total modelled months, inclusive of any hold period. */
  readonly totalMonths: number;
  /** Construction start offset (months, 0-based). */
  readonly constructionStartMonth: number;
  /** Construction end offset (months, 0-based, exclusive). */
  readonly constructionEndMonth: number;
  /** Hold period after completion, in months. 0 for merchant sale. */
  readonly holdMonths: number;
}

/** Provenance for a single derived output. */
export interface ProvenanceEntry {
  /** Dotted key of the output this entry describes — e.g. `kpis.irr`. */
  readonly key: string;
  /** Short symbolic source — e.g. `input.sellingRatePerSqft`, `derived.hardCostCr`, `const.STAMP_DUTY_RATE`. */
  readonly source: string;
  /** Free-form transform description, e.g. `saleable * rate / 1e7`. */
  readonly transform?: string;
  /** Named assumptions that this output depends on. */
  readonly assumptions?: readonly string[];
}

/** A single line item on the monthly P&L. */
export interface MonthlyLineItem {
  readonly category: string;
  readonly subcategory?: string;
  readonly sign: FlowSign;
  /** One entry per month in the enclosing PeriodIndex. */
  readonly values: readonly Decimal[];
  readonly provenance: readonly ProvenanceEntry[];
}

/** Aggregated monthly cash-flow time series for a deal. */
export interface MonthlyCashFlow {
  readonly period: PeriodIndex;
  readonly items: readonly MonthlyLineItem[];
  /** Net monthly cash flow — `inflow - outflow`, one entry per month. */
  readonly net: readonly Decimal[];
}

/** Financing output summary. */
export interface FinancingOutput {
  readonly debtLTV: number;
  /**
   * Loan-to-cost covenant passed through from inputs. Informational only —
   * the kernel sizes debt by `debtLTV × debtableBase`; `debtLTC` is
   * preserved so downstream exports / capital stack views can compare the
   * derived sizing against the covenant ceiling.
   */
  readonly debtLTC?: number | null;
  readonly debtRatePct: number;
  /**
   * Loan term in months. When provided, the capitalised-interest carry
   * caps at `min(constructionMonths, debtTenorMonths)` rather than
   * accruing for the whole construction window.
   */
  readonly debtTenorMonths?: number | null;
  /**
   * Amortization period in years for operating-phase term loans
   * (income-producing assets). Pass-through; schedule construction is
   * reserved for a later phase.
   */
  readonly amortizationYears?: number | null;
  readonly debtDrawn: Decimal;
  readonly debtInterest: Decimal;
  readonly equityInvested: Decimal;
  readonly provenance: readonly ProvenanceEntry[];
}

/** Canonical KPI set returned by every asset class. */
export interface KPISet {
  readonly revenue: Decimal;
  readonly totalCost: Decimal;
  readonly grossProfit: Decimal;
  readonly grossMarginPct: number;
  readonly npv: Decimal;
  readonly irr: number | null;
  readonly equityMultiple: number | null;
  readonly residualLandValue: Decimal | null;
  /** Asset-class-specific KPIs, e.g. NOI, cap rate, RevPAR. */
  readonly extras: Readonly<Record<string, number | null>>;
  readonly provenance: readonly ProvenanceEntry[];
}

/** Area breakdown, all sqft. Null where not applicable. */
export interface AreaBreakdown {
  readonly grossBuiltUpSqft: number | null;
  readonly saleableSqft: number | null;
  readonly carpetSqft: number | null;
  readonly superBuiltUpSqft: number | null;
  readonly leasableSqft: number | null;
  readonly extras: Readonly<Record<string, number | null>>;
}

/** Itemised costs, ₹ Crore. Null where not applicable. */
export interface CostBreakdown {
  readonly landCr: Decimal;
  readonly constructionCr: Decimal;
  readonly gstCr: Decimal;
  readonly contingencyCr: Decimal;
  readonly stampDutyCr: Decimal;
  readonly approvalCr: Decimal;
  readonly architectureCr: Decimal | null;
  readonly pmcCr: Decimal | null;
  readonly marketingCr: Decimal | null;
  readonly financeCr: Decimal | null;
  readonly hardCostTotalCr: Decimal;
  readonly softCostTotalCr: Decimal;
  readonly totalCr: Decimal;
  readonly extras: Readonly<Record<string, Decimal>>;
}

/** Revenue breakdown in ₹ Crore. Values may be null where not applicable (e.g. lease-only assets). */
export interface RevenueBreakdown {
  readonly totalRevenueCr: Decimal | null;
  readonly grossProfitCr: Decimal | null;
  readonly grossMarginPct: number | null;
  readonly stabilizedNOICr: Decimal | null;
  readonly exitValueCr: Decimal | null;
  readonly extras: Readonly<Record<string, Decimal | null>>;
}

/** Top-level kernel output returned by `computeDeal`. */
export interface KernelResult {
  readonly assetClass: AssetClass;
  readonly period: PeriodIndex;
  readonly areas: AreaBreakdown;
  readonly costs: CostBreakdown;
  readonly revenue: RevenueBreakdown;
  readonly kpis: KPISet;
  readonly financing: FinancingOutput | null;
  readonly cashFlow: MonthlyCashFlow;
  readonly provenance: readonly ProvenanceEntry[];
}
