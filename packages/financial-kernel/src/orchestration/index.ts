/**
 * @redip/financial-kernel/orchestration
 *
 * Phase 3 orchestration layer: unifies base kernel, debt roll-forward,
 * CFADS, covenants, waterfall, and KPIs behind a single call. All math
 * is deterministic Decimal; rollout is gated by DEBT_ENGINE_V2 and
 * a percentage-based hash bucket on the deal id.
 */

export { FinancialOrchestrator, orchestrate } from './orchestrator';
export {
  isDebtV2Enabled,
  isKillSwitchOn,
  getRolloutPct,
  getPythonUrl,
  getAnomalyThresholdPct,
  hash32,
  dealBucket,
  cohortTier,
  shouldUseV2ForDeal,
  logRolloutDecision,
  detectAnomalies,
  recordMonitoring,
} from './featureFlag';
export type { Anomaly, KPIBaseline, MonitoringRecord } from './featureFlag';
export { buildCashFlowGraph, totalDistributable } from './cashFlowGraph';
export type {
  CashFlowGraphInputs,
  CashFlowGraphOutput,
} from './cashFlowGraph';
export { FinancialGraph, buildStandardGraph } from './financialGraph';
export type { StandardGraphInputs } from './financialGraph';
export type {
  CohortTier,
  CovenantSummary,
  EngineVersion,
  IntelligenceOptions,
  OrchestratedKPIs,
  OrchestrationInput,
  OrchestrationOutput,
  RolloutDecision,
  WireFacilityRow,
  FacilityRow,
} from './types';
export type { PythonOrchestrateResponse } from './pythonClient';
