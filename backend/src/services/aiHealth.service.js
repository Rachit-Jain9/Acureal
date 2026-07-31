'use strict';

/**
 * AI Health service (PR-NX22 — 2026-05-16).
 *
 * Surfaces per-provider live status so operators can see WHICH AI providers
 * are working RIGHT NOW without having to read Vercel function logs or
 * download a deal export and inspect the briefing footer.
 *
 * Why this is a separate concern from `aiUsage.service.js` (which exists):
 * - aiUsage answers "how much did we spend?" (cost dashboard, 30-day window)
 * - aiHealth answers "is it WORKING?" (operational status, last-call success)
 *
 * Returns a per-provider snapshot:
 * {
 *   providers: [
 *     {
 *       provider: 'claude',
 *       label: 'Claude Sonnet 4.6',
 *       configured: true,           // env-var present
 *       lastCall: {                 // most recent call from ai_call_logs
 *         status: 'success',        // success|error|timeout|cache_hit|cost_capped|skipped
 *         occurredAt: '2026-05-16T14:30:00Z',
 *         latencyMs: 1842,
 *         task: 'narrative_synthesis',
 *         errorCode: null,
 *         errorMessage: null,
 *       },
 *       last7d: {
 *         calls: 124,
 *         successCount: 118,
 *         errorCount: 4,
 *         cacheHitCount: 2,
 *         successRate: 0.952,
 *         p50LatencyMs: 1640,
 *         p95LatencyMs: 3210,
 *       },
 *       healthBand: 'healthy',     // 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
 *     },
 *     ...
 *   ],
 *   overallBand: 'healthy',         // worst of the three
 *   generatedAt: '2026-05-16T...',
 * }
 *
 * healthBand thresholds (per-provider, 7d window). successRate is computed
 * over provider-outcome calls only — success + error + timeout + cache_hit.
 * cost_capped and skipped rows are Acureal's own throttle decisions, not
 * provider outcomes, so they are excluded from the rate's denominator.
 *   - 'healthy'    — configured AND successRate ≥ 0.90
 *   - 'degraded'   — configured AND 0.50 ≤ successRate < 0.90
 *   - 'unhealthy'  — configured AND successRate < 0.50
 *   - 'unknown'    — not configured OR no provider-outcome calls in last 7d
 *
 * Soft-fails: if ai_call_logs query fails (e.g., RLS, missing table), the
 * service still returns provider configuration status. Never throws.
 */

const { query } = require('../config/database');
const { getProviderAvailability } = require('./ai/providerRegistry');

const PROVIDERS = [
  { provider: 'gemini',  label: 'Gemini 3.1 Flash-Lite',  envVar: 'GEMINI_API_KEY' },
  { provider: 'claude',  label: 'Claude Sonnet 4.6',      envVar: 'ANTHROPIC_API_KEY' },
  { provider: 'openai',  label: 'OpenAI GPT-5.4',         envVar: 'OPENAI_API_KEY' },
];

const computePercentile = (sortedNumbers, p) => {
  if (!sortedNumbers || sortedNumbers.length === 0) return null;
  const idx = Math.min(sortedNumbers.length - 1, Math.floor(sortedNumbers.length * p));
  return Math.round(sortedNumbers[idx]);
};

// Health is a function of the 7-day success rate, which the caller computes
// over provider-outcome calls only. Pure-band so that a single cache_hit /
// cost_capped row landing as the most-recent call cannot flip a healthy
// provider to degraded.
const classifyHealth = ({ configured, lastCall, last7d }) => {
  if (!configured) return 'unknown';

  const calls = last7d?.calls ?? 0;
  const successRate = last7d?.successRate ?? null;

  if (calls === 0 || successRate === null) {
    // No provider-outcome calls in the window. Fall back to the last known
    // call: a success or cache_hit means the provider worked recently.
    const lastStatus = lastCall?.status ?? null;
    if (lastStatus === 'success' || lastStatus === 'cache_hit') return 'healthy';
    return 'unknown';
  }

  if (successRate >= 0.90) return 'healthy';
  if (successRate < 0.50) return 'unhealthy';
  return 'degraded';
};

const worstBand = (bands) => {
  const order = ['unhealthy', 'degraded', 'unknown', 'healthy'];
  for (const band of order) {
    if (bands.includes(band)) return band;
  }
  return 'unknown';
};

const fetchProviderStats = async (provider) => {
  try {
    // Most recent call (any status)
    const lastResult = await query(
      `SELECT status, created_at, latency_ms, task, error_code, error_message
         FROM ai_call_logs
        WHERE provider = $1
          AND organization_id = current_organization_id()
        ORDER BY created_at DESC
        LIMIT 1`,
      [provider],
    );
    const lastRow = lastResult.rows[0] || null;
    const lastCall = lastRow ? {
      status: lastRow.status,
      occurredAt: lastRow.created_at,
      latencyMs: lastRow.latency_ms,
      task: lastRow.task,
      errorCode: lastRow.error_code,
      errorMessage: lastRow.error_message,
    } : null;

    // 7-day aggregates, split by status so the success rate can be computed
    // over provider-outcome calls only.
    const aggResult = await query(
      `SELECT
         SUM(CASE WHEN status = 'success'     THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN status = 'error'       THEN 1 ELSE 0 END) AS error_count,
         SUM(CASE WHEN status = 'timeout'     THEN 1 ELSE 0 END) AS timeout_count,
         SUM(CASE WHEN status = 'cache_hit'   THEN 1 ELSE 0 END) AS cache_hit_count,
         SUM(CASE WHEN status = 'cost_capped' THEN 1 ELSE 0 END) AS cost_capped_count,
         ARRAY_AGG(latency_ms ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS latencies
       FROM ai_call_logs
       WHERE provider = $1
         AND organization_id = current_organization_id()
         AND created_at >= NOW() - INTERVAL '7 days'`,
      [provider],
    );
    const agg = aggResult.rows[0] || {};
    const successCount = Number(agg.success_count) || 0;
    const errorCount = Number(agg.error_count) || 0;
    const timeoutCount = Number(agg.timeout_count) || 0;
    const cacheHitCount = Number(agg.cache_hit_count) || 0;
    const costCappedCount = Number(agg.cost_capped_count) || 0;
    // Provider health reflects calls that actually exercised the provider (or
    // its cache). cost_capped (daily-budget throttle) and skipped are Acureal's
    // own decisions — folding them in would make a healthy provider look
    // broken every time the cost cap fires — so they stay out of the rate.
    const providerCalls = successCount + errorCount + timeoutCount + cacheHitCount;
    const latencies = (agg.latencies || []).map(Number).filter((n) => Number.isFinite(n));
    const last7d = {
      calls: providerCalls,
      successCount,
      errorCount,
      timeoutCount,
      cacheHitCount,
      costCappedCount,
      successRate: providerCalls > 0
        ? Math.round(((successCount + cacheHitCount) / providerCalls) * 1000) / 1000
        : null,
      p50LatencyMs: computePercentile(latencies, 0.50),
      p95LatencyMs: computePercentile(latencies, 0.95),
    };

    return { lastCall, last7d };
  } catch (err) {
    // Soft-fail: ai_call_logs may be missing or RLS may block — return empty
    // stats but never throw. Operator can still see configured/unconfigured.
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'test') console.warn(`[aiHealth] fetch failed for ${provider}:`, err.message);
    return {
      lastCall: null,
      last7d: { calls: 0, successCount: 0, errorCount: 0, timeoutCount: 0, cacheHitCount: 0, costCappedCount: 0, successRate: null, p50LatencyMs: null, p95LatencyMs: null },
    };
  }
};

/**
 * Get the live AI health snapshot for all 3 providers.
 *
 * @returns {Promise<{providers, overallBand, generatedAt}>}
 */
const getHealthSnapshot = async () => {
  const availability = getProviderAvailability();
  const results = await Promise.all(PROVIDERS.map(async (cfg) => {
    const configured = Boolean(availability[cfg.provider === 'openai' ? 'gpt_compatible' : cfg.provider]);
    const stats = configured
      ? await fetchProviderStats(cfg.provider)
      : { lastCall: null, last7d: { calls: 0, successCount: 0, errorCount: 0, timeoutCount: 0, cacheHitCount: 0, costCappedCount: 0, successRate: null, p50LatencyMs: null, p95LatencyMs: null } };
    const healthBand = classifyHealth({ configured, lastCall: stats.lastCall, last7d: stats.last7d });
    return {
      provider: cfg.provider,
      label: cfg.label,
      envVar: cfg.envVar,
      configured,
      lastCall: stats.lastCall,
      last7d: stats.last7d,
      healthBand,
    };
  }));

  return {
    providers: results,
    overallBand: worstBand(results.map((r) => r.healthBand)),
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  getHealthSnapshot,
  // Exported for tests / future reuse
  __internal: {
    classifyHealth,
    worstBand,
    computePercentile,
    PROVIDERS,
  },
};
