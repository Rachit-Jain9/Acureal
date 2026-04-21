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
export {
  buildDrawSchedule,
  buildAmortizingSchedule,
  sCurveWeights as sCurveWeightsQuarterly,
} from './debtSchedule';
export type {
  DrawScheduleInputs,
  DrawScheduleResult,
  AmortizingScheduleInputs,
  AmortizingScheduleResult,
} from './debtSchedule';

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
  INDIA_CONFIG,
  INDIA_CONFIG_JSON,
  sqftToAcres,
  acresToSqft,
  rupeesToCrore,
} from './config';

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

// Debt engine — unconditional. Operator emergency escape hatch is
// DEBT_ENGINE_KILL (legacy alias: DEBT_ENGINE_V2_KILL), which collapses
// the orchestrator to a zero-overlay safe-mode without disabling exports.
export * as DebtEngine from './debt-engine';
export * as WaterfallEngine from './waterfall-engine';

// Post-processors — legacy-shape adapters (capitalStack, cashFlows, etc.)
// that run after kernel math. See `docs/LEGACY_SHAPE_AUDIT.md` for why
// these have to match legacy output key-for-key.
export {
  buildConstructionLoanCapitalStack,
  buildIncomeAmortizingCapitalStack,
  buildHospitalityCapitalStack,
  buildHospitalityWaterfall,
  buildCashFlows,
  normalizeEffectiveDate,
  addUtcDays,
  addUtcMonths,
  buildUsaliPnl,
  hospOccRamp,
} from './postprocess';
export type {
  CapitalStack,
  CapitalStackConstructionLoan,
  CapitalStackIncomeAmortizing,
  CapitalStackHospitality,
  CapitalStackWaterfall,
  CapitalStackWaterfallTier,
  CapitalStackConstructionPhase,
  CapitalStackPermanentPhase,
  ConstructionLoanCapitalStackArgs,
  IncomeAmortizingCapitalStackArgs,
  HospitalityCapitalStackArgs,
  BuildWaterfallArgs,
  CashFlowBundle,
  CashFlowSummary,
  QuarterlyCashFlowEntry,
  YearlyCashFlowEntry,
  BuildCashFlowsTimeline,
  UsaliPnlRow,
  UsaliPnlInputs,
} from './postprocess';

// Phase 4 — pure HTTP handler for the investor-package endpoint.
export { handleInvestorPackage } from './api';
export type { InvestorPackageResponseBody, HandlerResult } from './api';
