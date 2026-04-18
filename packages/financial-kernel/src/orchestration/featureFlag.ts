/**
 * Feature-flag wiring for the Phase 3 orchestration layer with built-in
 * monitoring: cohort tracking (bucket tiers), anomaly detection
 * (v1-vs-v2 KPI drift), and an instant kill switch.
 *
 * Env knobs:
 *   - `DEBT_ENGINE_V2` (truthy/falsy): master switch.
 *   - `DEBT_ENGINE_V2_ROLLOUT_PCT` (0-100, default 0): gradual rollout.
 *   - `DEBT_ENGINE_V2_KILL` (truthy): kill switch — forces v1 regardless of
 *     every other setting. Lets ops disable V2 without a code deploy.
 *   - `DEBT_ENGINE_V2_ANOMALY_PCT` (0-100, default 5): abs-pct threshold above
 *     which a v2 KPI vs v1 baseline counts as an anomaly.
 *   - `DEBT_ENGINE_V2_SILENT` ('1'): suppress decision log lines in tests.
 *
 * Determinism: the same deal always gets the same engine unless an operator
 * changes the threshold or flips the kill switch. We hash the deal id with
 * a 32-bit FNV-1a — fast, dependency-free, and stable across runs.
 */

import type { CohortTier, RolloutDecision } from './types';

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

/** Kill switch — forces v1 regardless of every other knob. */
export function isKillSwitchOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.DEBT_ENGINE_V2_KILL ?? '').toLowerCase();
  return TRUTHY.has(v);
}

/** Anomaly threshold in percent (default 5%). */
export function getAnomalyThresholdPct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DEBT_ENGINE_V2_ANOMALY_PCT;
  if (raw == null || raw === '') return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 5;
  return n;
}

/** Coarse-grained bucket tier for cohort observability. */
export function cohortTier(bucket: number): CohortTier {
  if (bucket < 1) return 'control';
  if (bucket < 10) return 'early';
  if (bucket < 25) return 'ramp';
  if (bucket < 75) return 'rollout';
  return 'full';
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
  const killed = isKillSwitchOn(env);
  const threshold = getRolloutPct(env);
  const bucket = dealBucket(dealId);
  let usedV2 = false;
  let reason = '';
  if (killed) {
    reason = 'kill switch on';
  } else if (!enabled) {
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
    killed,
    cohort: cohortTier(bucket),
  };
}

export function logRolloutDecision(
  dealId: string,
  decision: RolloutDecision,
  logger: Pick<Console, 'info'> = console,
): void {
  if (process.env.DEBT_ENGINE_V2_SILENT === '1') return;
  logger.info(
    `[financial.orchestrator] deal=${dealId} v2=${decision.usedV2} python=${decision.usedPython} bucket=${decision.bucket}/${decision.thresholdPct} cohort=${decision.cohort ?? 'n/a'} reason="${decision.reason}"`,
  );
}

export interface KPIBaseline {
  readonly cumulativeDebtServiceCr?: number | null;
  readonly peakDebtCr?: number | null;
  readonly residualTotalCr?: number | null;
  readonly minDSCR?: number | null;
  readonly irrLeveredPct?: number | null;
}

export interface Anomaly {
  readonly metric: string;
  readonly v1: number | null;
  readonly v2: number | null;
  readonly absDeltaPct: number;
}

/** Compare v1 vs v2 headline KPIs; flag metrics whose abs-pct delta exceeds
 *  the configured threshold. Returns empty array if v1 baseline is missing. */
export function detectAnomalies(
  v1: KPIBaseline | null,
  v2: KPIBaseline,
  thresholdPct: number = getAnomalyThresholdPct(),
): Anomaly[] {
  if (v1 == null) return [];
  const metrics: (keyof KPIBaseline)[] = [
    'cumulativeDebtServiceCr',
    'peakDebtCr',
    'residualTotalCr',
    'minDSCR',
    'irrLeveredPct',
  ];
  const out: Anomaly[] = [];
  for (const m of metrics) {
    const a = v1[m] ?? null;
    const b = v2[m] ?? null;
    if (a == null || b == null) continue;
    const denom = Math.max(Math.abs(a), 1e-9);
    const deltaPct = Math.abs((b - a) / denom) * 100;
    if (deltaPct > thresholdPct) {
      out.push({ metric: m, v1: a, v2: b, absDeltaPct: deltaPct });
    }
  }
  return out;
}

export interface MonitoringRecord {
  readonly dealId: string;
  readonly decision: RolloutDecision;
  readonly engineVersion: string;
  readonly anomalies: readonly Anomaly[];
  readonly durationMs: number;
  readonly at: string;
}

/** Emit a structured decision record for telemetry pipelines. Silent in tests. */
export function recordMonitoring(
  rec: MonitoringRecord,
  logger: Pick<Console, 'info' | 'warn'> = console,
): void {
  if (process.env.DEBT_ENGINE_V2_SILENT === '1') return;
  const line = JSON.stringify({ kind: 'financial.orchestrator.monitoring', ...rec });
  if (rec.anomalies.length > 0) logger.warn(line);
  else logger.info(line);
}
