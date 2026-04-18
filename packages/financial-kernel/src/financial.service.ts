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
  isKillSwitchOn,
  getRolloutPct,
  getPythonUrl,
  shouldUseV2ForDeal,
} from './orchestration/featureFlag';
import { buildInvestorPackage } from './exports/intelligentReport';
import type { InvestorPackage } from './exports/types';

export type { OrchestrationInput, OrchestrationOutput } from './orchestration/types';
export type { InvestorPackage } from './exports/types';
export type { IntelligenceReport, Insight, IntelligenceKPIs } from './intelligence/types';

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
  readonly killSwitch: boolean;
}

export function getServiceStatus(
  env: NodeJS.ProcessEnv = process.env,
): FinancialServiceStatus {
  return {
    v2Enabled: isDebtV2Enabled(env),
    rolloutPct: getRolloutPct(env),
    pythonUrl: getPythonUrl(env),
    killSwitch: isKillSwitchOn(env),
  };
}

/**
 * Investor-grade entry point. Runs the full pipeline with intelligence
 * enabled and returns a flat, serialization-ready package suitable for
 * the UI, PDF, and XLSX renderers. Gated by DEBT_ENGINE_V2 — when the
 * flag is off, returns null and the caller should render legacy output.
 *
 * Phase 5 routing:
 *   - v1-legacy          → returns null (caller renders legacy)
 *   - v2-ts              → builds the package locally from orchestrator output
 *   - v2-python + URL    → POSTs to `${DEBT_ENGINE_PY_URL}/investor-package`
 *                          (canonical Python source-of-truth; persists to
 *                          Supabase server-side) and returns the parsed body
 *   - v2-python, no URL  → silently falls back to v2-ts local build
 */
export async function computeInvestorPackage(
  input: OrchestrationInput,
): Promise<InvestorPackage | null> {
  const out = await computeFinancials({
    ...input,
    intelligence: {
      ...(input.intelligence ?? {}),
      enabled: true,
    },
  });
  if (out.engineVersion === 'v1-legacy' || !out.intelligence) return null;

  const pyUrl = getPythonUrl(process.env);
  if (out.engineVersion === 'v2-python' && pyUrl) {
    try {
      const remote = await callPythonInvestorPackage(pyUrl, input, out);
      if (remote) return remote;
    } catch (err) {
      // Silent degrade — Python fallback matches orchestrator's behavior.
      if (process.env.DEBT_ENGINE_V2_SILENT !== '1') {
        console.warn(
          `[financial.service] python investor-package fallback: ${(err as Error).message}`,
        );
      }
    }
  }
  return buildInvestorPackage(out, out.intelligence, input.dealId);
}

/**
 * Serialize orchestrator output + intelligence inputs into the FastAPI
 * wire format and POST to `/investor-package`. Returns the parsed
 * payload cast to `InvestorPackage`; Python's response already matches
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
    engine_version: 'v2-python',
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
  shouldUseV2ForDeal,
  isDebtV2Enabled,
  isKillSwitchOn,
  getRolloutPct,
  getPythonUrl,
};
