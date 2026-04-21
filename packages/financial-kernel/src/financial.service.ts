/**
 * `financial.service.ts` — single entry point for callers that want a
 * unified financial picture for a deal.
 *
 * Contract:
 *   - Always returns a full result. `baseResult` is the legacy-equivalent
 *     asset-adapter output every caller has depended on since Phase 1.
 *   - The debt/CFADS/waterfall overlays always run. `engineVersion`
 *     records the runtime (`inline` | `safe-mode`).
 *   - Under the kill-switch (`DEBT_ENGINE_KILL=1`), overlays collapse to
 *     zero-series so deal pages survive an incident without crashing.
 *
 * Every invocation emits a structured decision log so ops can audit
 * which runtime produced which number.
 */

import { FinancialOrchestrator } from './orchestration/orchestrator';
import type {
  OrchestrationInput,
  OrchestrationOutput,
} from './orchestration/types';
import { isKillSwitchOn } from './orchestration/featureFlag';
import { buildInvestorPackage } from './exports/intelligentReport';
import type { InvestorPackage } from './exports/types';

export type { OrchestrationInput, OrchestrationOutput } from './orchestration/types';
export type { InvestorPackage } from './exports/types';
export type { IntelligenceReport, Insight, IntelligenceKPIs } from './intelligence/types';

/**
 * Main service call. The orchestrator runs the full pipeline
 * unconditionally; this thin layer exists so callers can import from a
 * stable path (`@redip/financial-kernel/dist/financial.service`) without
 * reaching into the orchestration submodule.
 */
export async function computeFinancials(
  input: OrchestrationInput,
): Promise<OrchestrationOutput> {
  const orch = new FinancialOrchestrator();
  return orch.compute(input);
}

/** Synchronous snapshot of the ops state. Cheap — no orchestration. */
export interface FinancialServiceStatus {
  readonly killSwitch: boolean;
}

export function getServiceStatus(
  env: NodeJS.ProcessEnv = process.env,
): FinancialServiceStatus {
  return {
    killSwitch: isKillSwitchOn(env),
  };
}

/**
 * Investor-grade entry point. Runs the full pipeline with intelligence
 * enabled and returns a flat, serialization-ready package suitable for
 * the UI, PDF, and XLSX renderers.
 *
 * Routing:
 *   - `inline`    → builds the package locally from orchestrator output
 *   - `safe-mode` → builds locally from the zero-overlay result. The
 *                   KPI block reports zeros honestly; callers should
 *                   check `engineVersion === 'safe-mode'` if they want
 *                   to surface an ops banner.
 */
export async function computeInvestorPackage(
  input: OrchestrationInput,
): Promise<InvestorPackage> {
  const out = await computeFinancials({
    ...input,
    intelligence: {
      ...(input.intelligence ?? {}),
      enabled: true,
    },
  });
  // `out.intelligence` is guaranteed here because we forced enabled=true.
  const intel = out.intelligence!;
  return buildInvestorPackage(out, intel, input.dealId);
}

/**
 * Re-export flag helpers so the service file is a complete surface for
 * deployment scripts and the backend adapter.
 */
export { isKillSwitchOn };
