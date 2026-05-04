'use strict';

/**
 * Runtime-editable task → provider / model resolution.
 *
 * Resolution order on every AI call:
 *   1. ai_routing_config row for this task   ← runtime config (this file)
 *   2. process.env.AI_PROVIDER_<TASK>         ← deploy-time override
 *   3. Code default                            ← hardcoded fallback
 *
 * The DB read is cached in-process for 60 seconds so the lookup adds
 * effectively zero latency to a hot path. An admin's UPDATE propagates
 * within one cache window.
 *
 * Fail-open: if the table is missing (pre-migration deploy) or the query
 * throws, we silently fall through to env / code defaults. The platform
 * never breaks an AI call because the routing table is unreachable.
 */

const { query } = require('../../config/database');
const log = require('../../lib/logger').child({ module: 'ai.routing-config' });

const CACHE_TTL_MS = 60 * 1000;

let cache = null;
let cacheExpiresAt = 0;
let inFlight = null;

const fetchFresh = async () => {
  try {
    const result = await query(
      `SELECT task, provider, model, fallback_provider, fallback_model
         FROM public.ai_routing_config`,
    );
    const map = new Map();
    for (const row of result.rows) {
      map.set(row.task, {
        provider: row.provider,
        model: row.model || null,
        fallbackProvider: row.fallback_provider || null,
        fallbackModel: row.fallback_model || null,
      });
    }
    return map;
  } catch (err) {
    // Missing table (pre-migration) or transient error → fail-open. The
    // caller falls through to env / code defaults.
    log.info('routing_config_fetch_failed_fail_open', { error: err.message });
    return new Map();
  }
};

const getCachedConfig = async () => {
  const now = Date.now();
  if (cache && now < cacheExpiresAt) return cache;
  if (inFlight) return inFlight;
  inFlight = fetchFresh().then((map) => {
    cache = map;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    inFlight = null;
    return map;
  });
  return inFlight;
};

// Force-refresh; called immediately after an admin update so the change is
// visible without waiting for the TTL.
const invalidateCache = () => {
  cache = null;
  cacheExpiresAt = 0;
  inFlight = null;
};

const getRoutingForTask = async (task) => {
  const map = await getCachedConfig();
  return map.get(task) || null;
};

const listRoutingConfig = async () => {
  // Read-through (admin UI). Bypass cache so the editor always sees the
  // canonical state — caching here would surface a stale row right after
  // an edit.
  invalidateCache();
  try {
    const result = await query(
      `SELECT task, provider, model, fallback_provider, fallback_model,
              notes, last_changed_by, last_changed_at
         FROM public.ai_routing_config
        ORDER BY task ASC`,
    );
    return result.rows;
  } catch (err) {
    log.warn('routing_config_list_failed', { error: err.message });
    return [];
  }
};

const upsertRouting = async ({
  task,
  provider,
  model = null,
  fallbackProvider = null,
  fallbackModel = null,
  notes = null,
  changedBy = null,
}) => {
  if (!task || !provider) {
    throw new Error('upsertRouting: task and provider are required');
  }
  const result = await query(
    `INSERT INTO public.ai_routing_config (task, provider, model, fallback_provider, fallback_model, notes, last_changed_by, last_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (task) DO UPDATE
       SET provider = EXCLUDED.provider,
           model = EXCLUDED.model,
           fallback_provider = EXCLUDED.fallback_provider,
           fallback_model = EXCLUDED.fallback_model,
           notes = COALESCE(EXCLUDED.notes, ai_routing_config.notes),
           last_changed_by = EXCLUDED.last_changed_by,
           last_changed_at = NOW()
     RETURNING task, provider, model, fallback_provider, fallback_model, notes, last_changed_at`,
    [task, provider, model, fallbackProvider, fallbackModel, notes, changedBy],
  );
  invalidateCache();
  return result.rows[0];
};

module.exports = {
  getRoutingForTask,
  listRoutingConfig,
  upsertRouting,
  invalidateCache,
};
