/**
 * HTTP-ready handler that wraps `computeInvestorPackage`.
 *
 * The kernel is pure — no Express, no Supabase client, no runtime
 * framework binding. This module returns a plain
 * `{ status, body, headers }` envelope so any HTTP surface (Next.js
 * route handler, Supabase edge function, backend Express route) can
 * adapt it with a two-line shim.
 *
 * On gating: if `DEBT_ENGINE_V2` is off or the deal's cohort doesn't
 * opt in, the handler returns 200 with `{ package: null, reason }` —
 * callers should fall back to the legacy summary UI rather than error.
 */
import {
  computeInvestorPackage,
  getServiceStatus,
} from '../financial.service';
import type { OrchestrationInput } from '../orchestration/types';
import type { InvestorPackage } from '../exports/types';

export interface InvestorPackageResponseBody {
  readonly package: InvestorPackage | null;
  readonly engineVersion: 'v1-legacy' | 'v2-ts' | 'v2-python' | null;
  readonly flagState: ReturnType<typeof getServiceStatus>;
  readonly reason?: string;
}

export interface HandlerResult {
  readonly status: number;
  readonly body: InvestorPackageResponseBody | { error: string };
  readonly headers: Record<string, string>;
}

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function validate(input: unknown): input is OrchestrationInput {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  return typeof i.dealId === 'string'
    && typeof i.totalMonths === 'number'
    && Array.isArray(i.facilities);
}

/**
 * Pure handler. Returns a structured envelope; the transport layer
 * serializes body and sets HTTP status. Never throws on bad input —
 * returns 400 so a misconfigured caller can be diagnosed from logs.
 */
export async function handleInvestorPackage(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HandlerResult> {
  if (!validate(input)) {
    return {
      status: 400,
      body: { error: 'invalid OrchestrationInput: dealId, totalMonths, facilities are required' },
      headers: JSON_HEADERS,
    };
  }
  const flag = getServiceStatus(env);
  try {
    const pkg = await computeInvestorPackage(input);
    return {
      status: 200,
      body: {
        package: pkg,
        engineVersion: pkg?.summary.engineVersion ?? null,
        flagState: flag,
        reason: pkg ? undefined : 'intelligence_disabled_or_v1_cohort',
      },
      headers: JSON_HEADERS,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 500,
      body: { error: `compute_failed: ${msg}` },
      headers: JSON_HEADERS,
    };
  }
}
