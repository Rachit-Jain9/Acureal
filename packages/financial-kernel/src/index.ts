/**
 * Public API for @redip/financial-kernel.
 *
 * The kernel is pure: every exported function is deterministic, side-
 * effect free, and framework-agnostic. Integrations (backend services,
 * export pipelines, scenario engines) should import only from here.
 */

export { Decimal, DEFAULT_SCALE, sum, maxDec, minDec } from './decimal';
export {
  buildPeriodIndex,
  sCurveWeights,
  logisticRevenueWeights,
  frontLoadedWeights,
  uniformWeights,
} from './periods';
export { prov, mergeProvenance } from './provenance';
export {
  npv,
  irrAnnualPct,
  grossProfit,
  grossMarginPct,
  equityMultiple,
  residualLandValue,
  totalInflow,
  totalOutflow,
} from './kpis';
export {
  zeroMonthly,
  netMonthly,
  distributeOutflow,
  distributeInflow,
  bulletOutflow,
  bulletInflow,
  sCurveConstruction,
  milestoneSales,
  frontLoadedSales,
  uniformFlow,
  aggregateNet,
  totalOutflows,
  totalInflows,
  monthlyToQuarterly,
} from './cashflow';
export { buildFinancing } from './financing';

export { computeDeal, isSupportedAssetClass, SUPPORTED_ASSET_CLASSES } from './registry';
export type { ComputeDealOptions } from './registry';

export {
  toSqft,
  fromSqft,
  toCrore,
  crToDecimal,
  toMonths,
  toPercent,
  toFraction,
  DEFAULT_USD_INR,
} from './units';
export type { AreaUnit, MoneyUnit, MoneyAmount, TimeUnit } from './units';

export {
  GLOBAL_DEFAULTS,
  ASSET_DEFAULTS,
  mergeAssumptions,
  resolveAssumptions,
} from './assumptions';

export {
  DealInputError,
  normalizeDealInput,
  normalizedDealInputs,
} from './inputSchema';
export type { NormalizedRaw, NormalizedDeal, NormalizeArgs } from './inputSchema';

export type {
  AssetClass,
  AreaBreakdown,
  AssumptionSet,
  CostBreakdown,
  DealInputs,
  FinancingOutput,
  FlowSign,
  KPISet,
  KernelResult,
  MonthlyCashFlow,
  MonthlyLineItem,
  PeriodIndex,
  ProvenanceEntry,
  RevenueBreakdown,
} from './types';

// Debt engine (Phase 2 — gated behind DEBT_ENGINE_V2 at the integration seam).
export * as DebtEngine from './debt-engine';
export * as WaterfallEngine from './waterfall-engine';

// Phase 4 — pure HTTP handler for the investor-package endpoint.
export { handleInvestorPackage } from './api';
export type { InvestorPackageResponseBody, HandlerResult } from './api';
