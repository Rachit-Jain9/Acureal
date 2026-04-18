/**
 * Feature-flag wiring for the Phase 3 orchestration layer.
 *
 * Two independent env knobs:
 *
 *   - `DEBT_ENGINE_V2` (truthy/falsy): master switch. When off, the
 *     orchestrator is bypassed and callers see legacy behavior.
 *   - `DEBT_ENGINE_V2_ROLLOUT_PCT` (0-100, default 0): gradual rollout.
 *     A deterministic hash of the deal id places every deal in a bucket
 *     [0, 100). Deals with `bucket < threshold` run V2; others run legacy.
 *
 * Determinism matters: the same deal should always get the same engine
 * unless an operator changes the threshold. We hash the deal id with a
 * simple 32-bit FNV-1a — fast, dependency-free, and stable across runs.
 */

import type { RolloutDecision } from './types';

const TRUTHY = new Set(['true', '1', 'on', 'yes', 'enabled']);

export function isDebtV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.DEBT_ENGINE_V2 ?? '').toLowerCase();
  return TRUTHY.has(v);
}

export function getRolloutPct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DEBT_ENGINE_V2_ROLLOUT_PCT;
  if (raw == null || raw === '') return isDebtV2Enabled(env) ? 100 : 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function getPythonUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.DEBT_ENGINE_PY_URL;
  if (!url || typeof url !== 'string' || url.trim() === '') return null;
  return url.trim();
}

/** 32-bit FNV-1a hash of a string, returned as an unsigned integer. */
export function hash32(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function dealBucket(dealId: string): number {
  return hash32(dealId) % 100;
}

export function shouldUseV2ForDeal(
  dealId: string,
  env: NodeJS.ProcessEnv = process.env,
): RolloutDecision {
  const enabled = isDebtV2Enabled(env);
  const threshold = getRolloutPct(env);
  const bucket = dealBucket(dealId);
  let usedV2 = false;
  let reason = '';
  if (!enabled) {
    reason = 'DEBT_ENGINE_V2 off';
  } else if (threshold <= 0) {
    reason = 'rollout 0%';
  } else if (threshold >= 100) {
    usedV2 = true;
    reason = 'rollout 100%';
  } else if (bucket < threshold) {
    usedV2 = true;
    reason = `bucket ${bucket} < ${threshold}`;
  } else {
    reason = `bucket ${bucket} >= ${threshold}`;
  }
  const pythonUrl = usedV2 ? getPythonUrl(env) : null;
  return {
    usedV2,
    usedPython: Boolean(pythonUrl),
    bucket,
    thresholdPct: threshold,
    reason,
  };
}

export function logRolloutDecision(
  dealId: string,
  decision: RolloutDecision,
  logger: Pick<Console, 'info'> = console,
): void {
  if (process.env.DEBT_ENGINE_V2_SILENT === '1') return;
  logger.info(
    `[financial.orchestrator] deal=${dealId} v2=${decision.usedV2} python=${decision.usedPython} bucket=${decision.bucket}/${decision.thresholdPct} reason="${decision.reason}"`,
  );
}
