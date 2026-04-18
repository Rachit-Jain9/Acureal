/**
 * `financial.service.ts` — single entry point for callers that want a
 * unified financial picture for a deal.
 *
 * Contract:
 *   - Always returns a full result. `baseResult` is the legacy-equivalent
 *     asset-adapter output every caller has depended on since Phase 1.
 *   - The debt/CFADS/waterfall overlays always run. `engineVersion`
 *     records the runtime (`inline` | `python` | `safe-mode`).
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
import {
  isKillSwitchOn,
  getPythonUrl,
} from './orchestration/featureFlag';
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
  readonly pythonUrl: string | null;
  readonly killSwitch: boolean;
}

export function getServiceStatus(
  env: NodeJS.ProcessEnv = process.env,
): FinancialServiceStatus {
  return {
    pythonUrl: getPythonUrl(env),
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
 *   - `python`    → POSTs to `${DEBT_ENGINE_PY_URL}/investor-package`
 *                   (canonical source-of-truth; persists to Supabase
 *                   server-side) and returns the parsed body. If the
 *                   endpoint is unreachable, silently falls back to the
 *                   local build so the deal page always renders.
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

  const pyUrl = getPythonUrl(process.env);
  if (out.engineVersion === 'python' && pyUrl) {
    try {
      const remote = await callPythonInvestorPackage(pyUrl, input, out);
      if (remote) return remote;
    } catch (err) {
      // Silent degrade — match orchestrator's fallback behavior.
      if (process.env.DEBT_ENGINE_SILENT !== '1' && process.env.DEBT_ENGINE_V2_SILENT !== '1') {
        console.warn(
          `[financial.service] python investor-package fallback: ${(err as Error).message}`,
        );
      }
    }
  }
  return buildInvestorPackage(out, intel, input.dealId);
}

/**
 * Serialize orchestrator output + intelligence inputs into the FastAPI
 * wire format and POST to `/investor-package`. Returns the parsed
 * payload cast to `InvestorPackage`; Python's response shape matches
 * the TS shape (both engines share `build_investor_package` contract).
 *
 * All decimals cross the wire as strings — never floats.
 */
async function callPythonInvestorPackage(
  url: string,
  input: OrchestrationInput,
  out: OrchestrationOutput,
): Promise<InvestorPackage | null> {
  if (!out.intelligence) return null;
  const intel: NonNullable<OrchestrationInput['intelligence']> = input.intelligence ?? {
    enabled: true,
  };
  const months = out.aggregate.totalMonths;
  const dec = (xs: readonly { toString(): string }[]) => xs.map((x) => x.toString());
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const equityCF = intel.equityCashFlows ?? [];
  const projectCF = intel.projectCashFlows ?? out.cfads.monthly;

  const body: Record<string, unknown> = {
    deal_id: input.dealId,
    engine_version: 'python',
    generated_at: new Date().toISOString(),
    organization_id: (input as { organizationId?: string | null }).organizationId ?? null,
    persist: true,

    equity_cash_flows: dec(equityCF),
    equity_months: range(equityCF.length),
    project_cash_flows: dec(projectCF),
    project_months: range(projectCF.length),
    cfads: dec(out.cfads.monthly),
    debt_service: dec(out.aggregate.monthlyDebtService),
    debt_outstanding: dec(out.aggregate.closingBalanceByMonth),

    annual_discount: (intel.annualDiscountRate ?? { toString: () => '0.10' }).toString(),
    equity_inflows: dec(intel.equityInflows ?? []),
    equity_outflows: dec(intel.equityOutflows ?? []),
    target_dscr: (intel.targetDSCR ?? { toString: () => '1.25' }).toString(),
    annual_rate: (intel.annualRate ?? { toString: () => '0.08' }).toString(),
    term_months: months,

    residual_total_cr: out.kpis.residualTotalCr?.toString() ?? '0',
    peak_debt_cr: out.kpis.peakDebtCr?.toString() ?? '0',
    cumulative_debt_service_cr: out.kpis.cumulativeDebtServiceCr?.toString() ?? '0',
    breach_count: out.covenants?.breaches?.length ?? 0,
  };

  const endpoint = `${url.replace(/\/$/, '')}/investor-package`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`python /investor-package HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as InvestorPackage;
  return json;
}

/**
 * Re-export flag helpers so the service file is a complete surface for
 * deployment scripts and the backend adapter.
 */
export {
  isKillSwitchOn,
  getPythonUrl,
};
