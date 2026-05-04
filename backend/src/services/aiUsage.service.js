'use strict';

/**
 * AI usage rollups — aggregations over `ai_call_logs` for the in-platform
 * admin dashboard. Strictly read-only; no mutations.
 *
 * What the platform's own dashboard answers (that Anthropic + Google's
 * dashboards cannot):
 *   • Cost per task per day (separates extraction vs reasoning vs synthesis)
 *   • Cache hit rate per provider (% of calls served from ai_response_cache)
 *   • Prompt-cache savings (Anthropic ephemeral cache reads vs writes)
 *   • Retry health (% of calls recovered_via_retry — leading indicator of
 *     provider degradation)
 *   • Per-doctype / per-language breakdown when those dimensions are
 *     populated (PR #155)
 *
 * Org-scoped via RLS — the `current_organization_id()` filter lives on the
 * `ai_call_logs` table itself, so this service simply runs SELECT under the
 * caller's session and the rows narrow naturally.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'ai.usage' });

const DEFAULT_DAYS = 30;

const safeQuery = async (sql, params, fallback) => {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (err) {
    // Fail-open: dashboard must never break a user session. Log + return
    // the supplied fallback so the widget renders an empty state.
    log.warn('ai_usage_query_failed', { error: err.message });
    return fallback;
  }
};

// Top-line: total spend, total calls, cache-hit rate, avg latency over the
// trailing window.
const getSummary = async ({ days = DEFAULT_DAYS } = {}) => {
  const rows = await safeQuery(
    `SELECT
       COUNT(*)::int                                                                           AS total_calls,
       COALESCE(SUM(cost_usd), 0)::numeric(12,4)                                              AS total_cost_usd,
       COALESCE(SUM(total_tokens), 0)::bigint                                                 AS total_tokens,
       COUNT(*) FILTER (WHERE status = 'cache_hit')::int                                      AS cache_hits,
       COUNT(*) FILTER (WHERE status = 'success')::int                                        AS successes,
       COUNT(*) FILTER (WHERE status = 'error')::int                                          AS errors,
       COUNT(*) FILTER (WHERE status = 'cost_capped')::int                                    AS cost_capped,
       COUNT(*) FILTER (WHERE (metadata->>'recovered_via_retry')::boolean IS TRUE)::int       AS recovered_via_retry,
       COUNT(*) FILTER (WHERE (metadata->>'prompt_cache_used')::boolean IS TRUE)::int         AS prompt_cache_used,
       AVG(latency_ms)::int                                                                   AS avg_latency_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int                          AS p95_latency_ms
     FROM ai_call_logs
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [days],
    [],
  );
  const r = rows[0] || {};
  const totalCalls = Number(r.total_calls || 0);
  const cacheHits = Number(r.cache_hits || 0);
  const cacheHitRate = totalCalls > 0 ? Math.round((cacheHits / totalCalls) * 1000) / 10 : 0;
  return {
    window_days: days,
    total_calls: totalCalls,
    total_cost_usd: Number(r.total_cost_usd || 0),
    total_tokens: Number(r.total_tokens || 0),
    cache_hits: cacheHits,
    cache_hit_rate_pct: cacheHitRate,
    successes: Number(r.successes || 0),
    errors: Number(r.errors || 0),
    cost_capped: Number(r.cost_capped || 0),
    recovered_via_retry: Number(r.recovered_via_retry || 0),
    prompt_cache_used: Number(r.prompt_cache_used || 0),
    avg_latency_ms: Number(r.avg_latency_ms || 0),
    p95_latency_ms: Number(r.p95_latency_ms || 0),
  };
};

// Daily series for the line/area chart.
const getDailySeries = async ({ days = DEFAULT_DAYS } = {}) => {
  const rows = await safeQuery(
    `SELECT
       DATE_TRUNC('day', created_at)::date                              AS day,
       COUNT(*)::int                                                    AS calls,
       COALESCE(SUM(cost_usd), 0)::numeric(12,4)                       AS cost_usd,
       COUNT(*) FILTER (WHERE status = 'cache_hit')::int               AS cache_hits,
       COUNT(*) FILTER (WHERE status NOT IN ('success','cache_hit'))::int AS failures
     FROM ai_call_logs
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY 1
     ORDER BY 1 ASC`,
    [days],
    [],
  );
  return rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    calls: Number(r.calls),
    cost_usd: Number(r.cost_usd),
    cache_hits: Number(r.cache_hits),
    failures: Number(r.failures),
  }));
};

// Breakdown table — by (task × provider) so the operator sees where the
// money goes. Sorted by cost descending so the highest spenders surface
// first; trailing window matches summary.
const getByTaskProvider = async ({ days = DEFAULT_DAYS } = {}) => {
  const rows = await safeQuery(
    `SELECT
       task,
       provider,
       model,
       COUNT(*)::int                                                                AS calls,
       COALESCE(SUM(cost_usd), 0)::numeric(12,4)                                   AS cost_usd,
       COALESCE(SUM(total_tokens), 0)::bigint                                      AS total_tokens,
       COUNT(*) FILTER (WHERE status = 'cache_hit')::int                           AS cache_hits,
       AVG(latency_ms)::int                                                        AS avg_latency_ms
     FROM ai_call_logs
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY task, provider, model
     ORDER BY cost_usd DESC NULLS LAST, calls DESC
     LIMIT 25`,
    [days],
    [],
  );
  return rows.map((r) => ({
    task: r.task,
    provider: r.provider,
    model: r.model,
    calls: Number(r.calls),
    cost_usd: Number(r.cost_usd),
    total_tokens: Number(r.total_tokens || 0),
    cache_hits: Number(r.cache_hits),
    avg_latency_ms: Number(r.avg_latency_ms || 0),
  }));
};

// Per-doctype / per-language extraction quality breakdown. Surfaces only
// rows where the doctype or language column is populated (PR #155). Used
// for the future per-language confidence calibration work, but useful now
// just to see "are Kannada extractions reliable?"
const getByDoctype = async ({ days = DEFAULT_DAYS } = {}) => {
  const rows = await safeQuery(
    `SELECT
       COALESCE(doctype, 'unspecified')                                  AS doctype,
       COALESCE(language, 'unspecified')                                 AS language,
       COUNT(*)::int                                                     AS calls,
       COUNT(*) FILTER (WHERE status = 'success')::int                   AS successes,
       COUNT(*) FILTER (WHERE status = 'error')::int                     AS errors,
       COALESCE(SUM(cost_usd), 0)::numeric(12,4)                        AS cost_usd
     FROM ai_call_logs
     WHERE created_at >= NOW() - ($1 || ' days')::interval
       AND (doctype IS NOT NULL OR language IS NOT NULL)
     GROUP BY doctype, language
     ORDER BY calls DESC
     LIMIT 25`,
    [days],
    [],
  );
  return rows.map((r) => ({
    doctype: r.doctype,
    language: r.language,
    calls: Number(r.calls),
    successes: Number(r.successes),
    errors: Number(r.errors),
    cost_usd: Number(r.cost_usd),
  }));
};

const getUsageDashboard = async ({ days = DEFAULT_DAYS } = {}) => {
  const safeDays = Math.min(Math.max(parseInt(days, 10) || DEFAULT_DAYS, 1), 365);
  const [summary, dailySeries, byTaskProvider, byDoctype] = await Promise.all([
    getSummary({ days: safeDays }),
    getDailySeries({ days: safeDays }),
    getByTaskProvider({ days: safeDays }),
    getByDoctype({ days: safeDays }),
  ]);
  return {
    summary,
    daily: dailySeries,
    by_task_provider: byTaskProvider,
    by_doctype: byDoctype,
    generated_at: new Date().toISOString(),
  };
};

module.exports = {
  getUsageDashboard,
  // Exported for tests
  getSummary,
  getDailySeries,
  getByTaskProvider,
  getByDoctype,
};
