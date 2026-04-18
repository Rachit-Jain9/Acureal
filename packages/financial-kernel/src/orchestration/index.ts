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
  getRolloutPct,
  getPythonUrl,
  hash32,
  dealBucket,
  shouldUseV2ForDeal,
  logRolloutDecision,
} from './featureFlag';
export { buildCashFlowGraph, totalDistributable } from './cashFlowGraph';
export type {
  CashFlowGraphInputs,
  CashFlowGraphOutput,
} from './cashFlowGraph';
export type {
  CovenantSummary,
  EngineVersion,
  OrchestratedKPIs,
  OrchestrationInput,
  OrchestrationOutput,
  RolloutDecision,
  WireFacilityRow,
  FacilityRow,
} from './types';
export type { PythonOrchestrateResponse } from './pythonClient';
