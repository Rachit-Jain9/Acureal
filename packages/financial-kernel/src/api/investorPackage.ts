/**
 * HTTP-ready handler that wraps `computeInvestorPackage`.
 *
 * The kernel is pure — no Express, no Supabase client, no runtime
 * framework binding. This module returns a plain
 * `{ status, body, headers }` envelope so any HTTP surface (Next.js
 * route handler, Supabase edge function, backend Express route) can
 * adapt it with a two-line shim.
 *
 * The engine is always on. The handler always returns a package; when
 * the kill-switch is engaged, `engineVersion === 'safe-mode'` and the
 * KPI block reports zeros honestly so the UI can surface an ops banner
 * without crashing.
 */
import {
  computeInvestorPackage,
  getServiceStatus,
} from '../financial.service';
import type { OrchestrationInput } from '../orchestration/types';
import type { InvestorPackage } from '../exports/types';

export interface InvestorPackageResponseBody {
  readonly package: InvestorPackage;
  readonly engineVersion: 'inline' | 'python' | 'safe-mode';
  readonly flagState: ReturnType<typeof getServiceStatus>;
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
        engineVersion: pkg.summary.engineVersion,
        flagState: flag,
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
