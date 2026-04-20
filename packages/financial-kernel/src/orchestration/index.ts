/**
 * @redip/financial-kernel/orchestration
 *
 * End-to-end financial pipeline: base kernel, debt roll-forward, CFADS,
 * covenants, waterfall, and KPIs behind a single call. The engine is
 * unconditional — the only operational knob is a kill-switch
 * (`DEBT_ENGINE_KILL=1`) that degrades to a safe zero-overlay so deal
 * pages survive an incident without crashing.
 */

export { FinancialOrchestrator, orchestrate } from './orchestrator';
export {
  isKillSwitchOn,
  getPythonUrl,
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
  WireFacilityRow,
  FacilityRow,
} from './types';
export type { PythonOrchestrateResponse } from './pythonClient';
