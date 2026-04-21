/**
 * @redip/financial-kernel/orchestration
 *
 * End-to-end financial pipeline: base kernel, debt roll-forward, CFADS,
 * covenants, waterfall, and KPIs behind a single call. The in-process
 * TypeScript kernel is the sole runtime; an operator kill-switch
 * (`DEBT_ENGINE_KILL=1`) degrades to a safe zero-overlay so deal pages
 * survive an incident without crashing.
 */

export { FinancialOrchestrator, orchestrate } from './orchestrator';
export {
  isKillSwitchOn,
  isSilent,
  hash32,
  dealBucket,
  selectEngine,
  logEngineDecision,
  recordMonitoring,
} from './featureFlag';
export type { MonitoringRecord } from './featureFlag';
export { buildCashFlowGraph, totalDistributable } from './cashFlowGraph';
export type {
  CashFlowGraphInputs,
  CashFlowGraphOutput,
} from './cashFlowGraph';
export { FinancialGraph, buildStandardGraph } from './financialGraph';
export type { StandardGraphInputs } from './financialGraph';
export type {
  CovenantSummary,
  EngineDecision,
  EngineVersion,
  IntelligenceOptions,
  OrchestratedKPIs,
  OrchestrationInput,
  OrchestrationOutput,
  FacilityRow,
} from './types';
