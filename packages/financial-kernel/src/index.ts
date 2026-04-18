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
