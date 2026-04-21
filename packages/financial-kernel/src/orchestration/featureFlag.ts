/**
 * Engine routing + ops escape hatches.
 *
 * The debt engine is always on — no rollout, no cohort bucketing, no
 * version toggling, and no external runtime. Two operational knobs remain:
 *
 *   - `DEBT_ENGINE_KILL`      — emergency kill-switch. When truthy, every
 *                               call returns the `safe-mode` zero-overlay
 *                               so an incident in the engine never breaks
 *                               deal pages. Legacy name
 *                               `DEBT_ENGINE_V2_KILL` still works.
 *   - `DEBT_ENGINE_SILENT`    — suppress decision log lines in tests.
 *                               Legacy name `DEBT_ENGINE_V2_SILENT`
 *                               also accepted.
 *
 * The prior Python FastAPI companion service and its routing flag
 * (`DEBT_ENGINE_PY_URL`) were retired in the 2026-04 consolidation. The
 * in-process TypeScript kernel is now the sole runtime.
 *
 * Determinism: `dealBucket(dealId)` gives a stable 0-99 value per deal.
 * Callers don't gate on it anymore but monitoring uses it to detect
 * drift (same bucket → same numbers across time).
 */

import type { EngineDecision, EngineVersion } from './types';

const TRUTHY = new Set(['true', '1', 'on', 'yes', 'enabled']);

function envFirst(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    const v = env[k];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

/**
 * True only when an operator has explicitly engaged the kill-switch.
 * Accepts both the current name and the legacy `_V2_` name so operators
 * with stale env vars don't lose their escape hatch on upgrade.
 */
export function isKillSwitchOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = envFirst(env, ['DEBT_ENGINE_KILL', 'DEBT_ENGINE_V2_KILL']);
  if (raw == null) return false;
  return TRUTHY.has(raw.toLowerCase());
}

/** Suppress decision/monitoring log lines (used by the test suite). */
export function isSilent(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = envFirst(env, ['DEBT_ENGINE_SILENT', 'DEBT_ENGINE_V2_SILENT']);
  if (raw == null) return false;
  return raw === '1' || TRUTHY.has(raw.toLowerCase());
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

/** Deterministic 0-99 bucket for a deal id. Used by telemetry for drift. */
export function dealBucket(dealId: string): number {
  return hash32(dealId) % 100;
}

/**
 * Pick the runtime for a given deal. Pure function; no I/O.
 *
 * Decision order:
 *   1. Kill-switch on → `safe-mode` (empty overlays; compute path short-circuits).
 *   2. Otherwise → `inline`.
 */
export function selectEngine(
  dealId: string,
  env: NodeJS.ProcessEnv = process.env,
): EngineDecision {
  const killed = isKillSwitchOn(env);
  const bucket = dealBucket(dealId);
  const engineVersion: EngineVersion = killed ? 'safe-mode' : 'inline';
  const reason = killed ? 'kill_switch_on' : 'inline_default';
  return {
    engineVersion,
    killed,
    bucket,
    reason,
  };
}

/** Structured decision log. Silent in tests via `DEBT_ENGINE_SILENT=1`. */
export function logEngineDecision(
  dealId: string,
  decision: EngineDecision,
  logger: Pick<Console, 'info'> = console,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isSilent(env)) return;
  logger.info(
    `[financial.orchestrator] deal=${dealId} engine=${decision.engineVersion} bucket=${decision.bucket} reason=${decision.reason}`,
  );
}

/**
 * Telemetry record emitted once per orchestration run. Callers that
 * persist to `monitoring_logs` should flatten this into the payload.
 */
export interface MonitoringRecord {
  readonly dealId: string;
  readonly decision: EngineDecision;
  readonly engineVersion: EngineVersion;
  readonly durationMs: number;
  readonly at: string;
}

export function recordMonitoring(
  rec: MonitoringRecord,
  logger: Pick<Console, 'info' | 'warn'> = console,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isSilent(env)) return;
  const line = JSON.stringify({
    kind: 'financial.orchestrator.monitoring',
    ...rec,
  });
  if (rec.engineVersion === 'safe-mode') logger.warn(line);
  else logger.info(line);
}
