/**
 * Shared plumbing between asset-class adapters — input coercion,
 * default assumption resolution, cost aggregation, and the KPI build
 * step. Every adapter funnels through `finalizeResult` so the kernel
 * never grows per-asset summation loops.
 */

import { Decimal, sum as decSum } from '../decimal';
import {
  aggregateNet,
  milestoneSales,
  sCurveConstruction,
  uniformFlow,
  bulletOutflow,
} from '../cashflow';
import { buildFinancing } from '../financing';
import { type CurveOverride, resolveCurveWeights } from '../curves';
import type {
  AreaBreakdown,
  AssetClass,
  CostBreakdown,
  FinancingOutput,
  KPISet,
  KernelResult,
  MonthlyCashFlow,
  MonthlyLineItem,
  PeriodIndex,
  ProvenanceEntry,
  RevenueBreakdown,
} from '../types';
import { equityMultiple, grossMarginPct, irrAnnualPct, npv, residualLandValue, totalInflow } from '../kpis';
import { prov } from '../provenance';
import { INDIA_CONFIG } from '../config';

/** Indian stamp-duty default. Re-exported from `config/india.ts`. */
export const STAMP_DUTY_RATE = INDIA_CONFIG.STAMP_DUTY_RATE;
/** Carpet / FAR ratio default — Indian residential norm. */
export const CARPET_RATIO = INDIA_CONFIG.CARPET_RATIO;
/** Default loading factor on FAR for saleable. */
export const DEFAULT_LOADING_FACTOR = INDIA_CONFIG.DEFAULT_LOADING_FACTOR;
/** 1 Crore in rupees. Used everywhere to flip between ₹/sqft-level inputs and Crore outputs. */
export const CRORE = INDIA_CONFIG.CRORE;

/** Asset-class specific default GST on construction. */
export const DEFAULT_GST_BY_ASSET: Record<AssetClass, number> = {
  residential_apartments: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
  plotted_development: INDIA_CONFIG.GST_CONSTRUCTION_PLOTTED,
  commercial_office: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
  retail: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
  industrial_warehousing: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
  hospitality: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
  mixed_use: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
  land_parcel: INDIA_CONFIG.GST_LAND_PARCEL,
  villas: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
  redevelopment: INDIA_CONFIG.GST_CONSTRUCTION_STANDARD,
};

/** Safe numeric coercion — returns `fallback` for non-finite or null input. */
export function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Like `num`, but returns `null` for missing values. */
export function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a raw number into a Decimal at default scale. */
export function D(n: number): Decimal {
  return Decimal.fromNumber(n);
}

/**
 * Build the canonical KernelResult from an asset adapter's partial outputs.
 * All summations, NPV/IRR/margin calculations happen here exactly once.
 */
export type EquityReturnsMode = 'merchant' | 'income';

export function finalizeResult(args: {
  assetClass: AssetClass;
  period: PeriodIndex;
  areas: AreaBreakdown;
  costs: CostBreakdown;
  revenue: Pick<RevenueBreakdown, 'totalRevenueCr' | 'stabilizedNOICr' | 'exitValueCr' | 'extras'>;
  items: readonly MonthlyLineItem[];
  discountRatePct: number;
  financing: FinancingOutput | null;
  /**
   * `'merchant'` (residential, plotted, villas, redevelopment):
   *   EM = 1 + grossProfit / equity
   * `'income'` (commercial, retail, industrial, hospitality, land_parcel):
   *   EM = sum(positive net cash flows) / equity
   */
  equityReturnsMode?: EquityReturnsMode;
  developerMarginPct?: number;
  kpiExtras?: Readonly<Record<string, number | null>>;
  extraProvenance?: readonly ProvenanceEntry[];
  /**
   * When an asset class reports a different margin convention than the
   * generic `(revenue - totalCost) / revenue` (for example, hospitality
   * reports USALI EBITDA margin), pass it here. Both `kpis.grossMarginPct`
   * and `revenue.grossMarginPct` will use this value instead.
   */
  grossMarginPctOverride?: number | null;
}): KernelResult {
  const net = aggregateNet(args.items, args.period);
  const totalRevenue = args.revenue.totalRevenueCr ?? (args.revenue.exitValueCr ?? Decimal.zero());
  const totalCost = args.costs.totalCr;
  const grossProfitCr = totalRevenue.sub(totalCost);
  const grossMarginPctVal =
    args.grossMarginPctOverride != null && Number.isFinite(args.grossMarginPctOverride)
      ? args.grossMarginPctOverride
      : grossMarginPct(totalRevenue, totalCost);

  const irrVal = irrAnnualPct(net);
  const npvVal = npv(net, args.discountRatePct / 100);

  const equityInvested = args.financing?.equityInvested ?? totalCost;
  const mode: EquityReturnsMode = args.equityReturnsMode ?? 'merchant';
  const equityReturns =
    mode === 'merchant'
      ? equityInvested.add(grossProfitCr)
      : totalInflow(net).sub(args.financing ? args.financing.debtDrawn : Decimal.zero());
  const em = equityMultiple({
    equityInvested,
    totalEquityReturns: equityReturns,
  });

  const rlv =
    args.developerMarginPct != null
      ? residualLandValue({
          revenue: totalRevenue,
          totalCostExLand: totalCost.sub(args.costs.landCr).sub(args.costs.stampDutyCr),
          developerMarginPct: args.developerMarginPct,
        })
      : null;

  const kpiProv: ProvenanceEntry[] = [
    prov('kpis.revenue', 'derived.totalRevenue', 'sum(revenue line items)'),
    prov('kpis.totalCost', 'derived.costs.totalCr', 'land + hard + soft + finance'),
    prov('kpis.grossProfit', 'derived.revenue - totalCost'),
    prov('kpis.grossMarginPct', 'derived.grossProfit / revenue × 100'),
    prov('kpis.npv', 'derived.cashFlow', `NPV(net, ${args.discountRatePct}% annual)`),
    prov('kpis.irr', 'derived.cashFlow', 'Newton + bisection solver'),
    prov('kpis.equityMultiple', 'derived.equityReturns / equityInvested'),
  ];
  if (rlv) kpiProv.push(prov('kpis.residualLandValue', 'derived.RLV formula', 'revenue − costExLand  /  (1 + margin)'));

  const kpis: KPISet = {
    revenue: totalRevenue,
    totalCost,
    grossProfit: grossProfitCr,
    grossMarginPct: grossMarginPctVal,
    npv: npvVal,
    irr: irrVal,
    equityMultiple: em,
    residualLandValue: rlv,
    extras: Object.freeze({ ...(args.kpiExtras ?? {}) }),
    provenance: Object.freeze(kpiProv),
  };

  const revenue: RevenueBreakdown = {
    totalRevenueCr: args.revenue.totalRevenueCr,
    grossProfitCr,
    grossMarginPct: grossMarginPctVal,
    stabilizedNOICr: args.revenue.stabilizedNOICr ?? null,
    exitValueCr: args.revenue.exitValueCr ?? null,
    extras: args.revenue.extras,
  };

  const cashFlow: MonthlyCashFlow = {
    period: args.period,
    items: Object.freeze([...args.items]),
    net: Object.freeze(net),
  };

  const extraProv: readonly ProvenanceEntry[] = args.extraProvenance ?? [];
  const allProv = Object.freeze([
    ...extraProv,
    ...kpiProv,
    ...(args.financing?.provenance ?? []),
  ]);

  return {
    assetClass: args.assetClass,
    period: args.period,
    areas: args.areas,
    costs: args.costs,
    revenue,
    kpis,
    financing: args.financing,
    cashFlow,
    provenance: allProv,
  };
}

/** Build a `CostBreakdown` from named cost atoms. All inputs are Decimals. */
export function assembleCosts(args: {
  land: Decimal;
  construction: Decimal;
  gst: Decimal;
  contingency: Decimal;
  stampDuty: Decimal;
  approval: Decimal;
  architecture?: Decimal | null;
  pmc?: Decimal | null;
  marketing?: Decimal | null;
  finance?: Decimal | null;
  extras?: Record<string, Decimal>;
}): CostBreakdown {
  const hardCostTotal = args.land
    .add(args.construction)
    .add(args.gst)
    .add(args.contingency)
    .add(args.stampDuty);

  const soft = [args.architecture, args.pmc, args.marketing, args.finance, args.approval]
    .filter((x): x is Decimal => x != null);
  const softCostTotal = decSum(soft);

  const extras = Object.freeze({ ...(args.extras ?? {}) });
  const extrasSum = decSum(Object.values(extras));

  const totalCr = hardCostTotal.add(softCostTotal).add(extrasSum);

  return {
    landCr: args.land,
    constructionCr: args.construction,
    gstCr: args.gst,
    contingencyCr: args.contingency,
    stampDutyCr: args.stampDuty,
    approvalCr: args.approval,
    architectureCr: args.architecture ?? null,
    pmcCr: args.pmc ?? null,
    marketingCr: args.marketing ?? null,
    financeCr: args.finance ?? null,
    hardCostTotalCr: hardCostTotal,
    softCostTotalCr: softCostTotal.add(extrasSum),
    totalCr,
    extras,
  };
}

/** Standard land + stamp-duty outflow at t=0. */
export function landAndStamp({
  period,
  land,
  stampDuty,
}: {
  period: PeriodIndex;
  land: Decimal;
  stampDuty: Decimal;
}): MonthlyLineItem {
  return bulletOutflow({
    period,
    month: 0,
    amount: land.add(stampDuty),
    category: 'land',
    subcategory: 'land+stamp',
    provenance: [prov('cashflow.land', 'input.landCostCr + derived.stampDuty')],
  });
}

/** Approvals: 25% at t=0, 75% uniformly spread across the pre-construction window. */
export function approvalsSchedule({
  period,
  amount,
}: {
  period: PeriodIndex;
  amount: Decimal;
}): MonthlyLineItem[] {
  const items: MonthlyLineItem[] = [];
  if (amount.isZero()) return items;
  items.push(
    bulletOutflow({
      period,
      month: 0,
      amount: amount.mulNumber(0.25),
      category: 'approvals',
      subcategory: 'upfront',
      provenance: [prov('cashflow.approvals.upfront', 'input.approvalCostCr × 0.25')],
    }),
  );
  const windowStart = 1;
  const windowEnd = Math.max(period.constructionStartMonth, 1);
  const rem = amount.mulNumber(0.75);
  if (!rem.isZero()) {
    items.push(
      uniformFlow({
        period,
        startMonth: windowStart,
        endMonth: Math.max(windowStart, windowEnd),
        amount: rem,
        sign: 'outflow',
        category: 'approvals',
        subcategory: 'remaining',
        provenance: [prov('cashflow.approvals.remaining', 'input.approvalCostCr × 0.75, uniform pre-construction')],
      }),
    );
  }
  return items;
}

/** Shared helper: spread a cost uniformly across the entire project. */
export function uniformAcrossProject({
  period,
  amount,
  category,
  subcategory,
  provenance,
}: {
  period: PeriodIndex;
  amount: Decimal;
  category: string;
  subcategory?: string;
  provenance?: readonly ProvenanceEntry[];
}): MonthlyLineItem {
  return uniformFlow({
    period,
    startMonth: 1,
    endMonth: period.totalMonths,
    amount,
    sign: 'outflow',
    category,
    subcategory,
    provenance,
  });
}

/** Shared helper: pre-construction spend for architect + PMC. */
export function preConstructionSoftCosts({
  period,
  architect,
  pmc,
}: {
  period: PeriodIndex;
  architect: Decimal;
  pmc: Decimal;
}): MonthlyLineItem {
  const total = architect.add(pmc);
  const endMonth = Math.max(1, period.constructionStartMonth);
  return uniformFlow({
    period,
    startMonth: 0,
    endMonth,
    amount: total,
    sign: 'outflow',
    category: 'soft_cost',
    subcategory: 'architect+pmc',
    provenance: [prov('cashflow.softCost.architect+pmc', 'input.architectFeePct + input.pmcFeePct')],
  });
}

/** Shared helper: marketing spend across the sales window. */
export function marketingSchedule({
  period,
  amount,
}: {
  period: PeriodIndex;
  amount: Decimal;
}): MonthlyLineItem {
  if (amount.isZero()) return uniformFlow({
    period,
    startMonth: 0,
    endMonth: period.totalMonths,
    amount: Decimal.zero(),
    sign: 'outflow',
    category: 'soft_cost',
    subcategory: 'marketing',
  });
  const start = Math.max(
    period.constructionStartMonth + 2,
    Math.floor(period.totalMonths * 0.25),
  );
  const end = Math.max(start, period.totalMonths - 1);
  return uniformFlow({
    period,
    startMonth: start,
    endMonth: end,
    amount,
    sign: 'outflow',
    category: 'soft_cost',
    subcategory: 'marketing',
    provenance: [prov('cashflow.softCost.marketing', 'input.marketingCostPct × totalRevenue')],
  });
}

/** Shared helper: finance cost across the project, post-month-0. */
export function financeDrag({
  period,
  amount,
}: {
  period: PeriodIndex;
  amount: Decimal;
}): MonthlyLineItem {
  return uniformFlow({
    period,
    startMonth: 1,
    endMonth: period.totalMonths,
    amount,
    sign: 'outflow',
    category: 'soft_cost',
    subcategory: 'finance',
    provenance: [prov('cashflow.softCost.finance', 'land×rate×tenor + hardCost×rate×constructionTenor×0.5')],
  });
}

/**
 * Build a provenance source label that reflects what the resolver
 * actually did, not what the user asked for. Explicit weights that
 * were rejected fall back to the default curve AND the default label,
 * so the methodology drawer never misreports the timing.
 */
function curveSourceLabel({
  months,
  defaultKind,
  override,
  defaultLabel,
  slot,
}: {
  months: number;
  defaultKind: 'sCurve' | 'logistic' | 'frontLoaded' | 'uniform';
  override?: CurveOverride | null;
  defaultLabel: string;
  slot: string;
}): string {
  const resolved = resolveCurveWeights(months, defaultKind, override ?? null);
  if (resolved.source === 'default') return defaultLabel;
  if (resolved.source === 'explicit') return `deal-override explicit ${slot}`;
  // Parametric: use the resolved kind (uniform / logistic / frontLoaded / sCurve).
  return `deal-override ${resolved.kind} ${slot}`;
}

/** Shared helper: sales distribution across a custom window. */
export function salesMilestoneCollections({
  period,
  amount,
  startMonth,
  endMonth,
  curveOverride,
}: {
  period: PeriodIndex;
  amount: Decimal;
  startMonth: number;
  endMonth: number;
  curveOverride?: CurveOverride | null;
}): MonthlyLineItem {
  const months = Math.max(1, endMonth - startMonth + 1);
  const sourceLabel = curveSourceLabel({
    months,
    defaultKind: 'logistic',
    override: curveOverride,
    defaultLabel: 'logistic milestone schedule',
    slot: 'schedule',
  });
  return milestoneSales({
    period,
    amount,
    startMonth,
    endMonth,
    category: 'revenue',
    subcategory: 'sales',
    provenance: [prov('cashflow.revenue.sales', sourceLabel)],
    curveOverride,
  });
}

/** Shared helper: S-curve hard cost item. */
export function hardCostItem({
  period,
  amount,
  curveOverride,
}: {
  period: PeriodIndex;
  amount: Decimal;
  curveOverride?: CurveOverride | null;
}): MonthlyLineItem {
  const months = Math.max(1, period.constructionEndMonth - period.constructionStartMonth);
  const sourceLabel = curveSourceLabel({
    months,
    defaultKind: 'sCurve',
    override: curveOverride,
    defaultLabel: 'S-curve over construction window',
    slot: 'construction schedule',
  });
  return sCurveConstruction({
    period,
    amount,
    category: 'hard_cost',
    subcategory: 'construction+gst+contingency',
    provenance: [prov('cashflow.hardCost', sourceLabel)],
    curveOverride,
  });
}

/** Simple financing builder; adapters can skip if debtLTV = 0. */
export function maybeFinancing({
  totalCost,
  debtableBase,
  debtLTV,
  debtLTC,
  debtRatePct,
  constructionMonths,
  debtTenorMonths,
  amortizationYears,
}: {
  totalCost: Decimal;
  debtableBase: Decimal;
  debtLTV: number;
  debtLTC?: number;
  debtRatePct: number;
  constructionMonths: number;
  debtTenorMonths?: number;
  amortizationYears?: number;
}): FinancingOutput | null {
  if (debtLTV <= 0) return null;
  return buildFinancing({
    totalCost,
    debtableBase,
    debtLTV,
    debtLTC,
    debtRatePct,
    constructionMonths,
    debtTenorMonths,
    amortizationYears,
  });
}
