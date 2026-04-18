/**
 * `financial.service.ts` — the single Phase 3 entry point for callers
 * that want a unified financial picture for a deal.
 *
 * Contract:
 *   - Always returns the base kernel result (legacy-equivalent) in `baseResult`.
 *   - When `DEBT_ENGINE_V2` is off, the debt/waterfall overlays are empty
 *     zero-series and `engineVersion === 'v1-legacy'`. Callers can ignore
 *     the overlays and the shape matches legacy consumers byte-for-byte
 *     aside from the extra fields.
 *   - When `DEBT_ENGINE_V2` is on and the deal's hash bucket is under
 *     `DEBT_ENGINE_V2_ROLLOUT_PCT`, the full pipeline runs and
 *     `engineVersion` becomes `v2-ts` (or `v2-python` if the service URL
 *     is configured and responsive).
 *
 * Every invocation emits a structured log line capturing the rollout
 * decision, so ops can audit which engine produced which number.
 */

import { FinancialOrchestrator } from './orchestration/orchestrator';
import type {
  OrchestrationInput,
  OrchestrationOutput,
} from './orchestration/types';
import {
  isDebtV2Enabled,
  getRolloutPct,
  getPythonUrl,
  shouldUseV2ForDeal,
} from './orchestration/featureFlag';

export type { OrchestrationInput, OrchestrationOutput } from './orchestration/types';

/**
 * Main service call. The orchestrator already handles gating, so this
 * layer is thin — it exists so callers can import from a stable path
 * (`@redip/financial-kernel/dist/financial.service`) without reaching
 * into the orchestration submodule.
 */
export async function computeFinancials(
  input: OrchestrationInput,
): Promise<OrchestrationOutput> {
  const orch = new FinancialOrchestrator();
  return orch.compute(input);
}

/**
 * Synchronous snapshot of the flag state. Exposed so the backend
 * adapter can log/report without awaiting an orchestration call.
 */
export interface FinancialServiceStatus {
  readonly v2Enabled: boolean;
  readonly rolloutPct: number;
  readonly pythonUrl: string | null;
}

export function getServiceStatus(
  env: NodeJS.ProcessEnv = process.env,
): FinancialServiceStatus {
  return {
    v2Enabled: isDebtV2Enabled(env),
    rolloutPct: getRolloutPct(env),
    pythonUrl: getPythonUrl(env),
  };
}

/**
 * Re-export flag helpers so the service file is a complete surface for
 * deployment scripts and the backend adapter.
 */
export { shouldUseV2ForDeal, isDebtV2Enabled, getRolloutPct, getPythonUrl };
