'use strict';

/**
 * Persistent cache for AI provider responses.
 *
 * The cache is keyed by a deterministic tuple of (task, provider, model,
 * prompt_sha256, input_sha256). Identical inputs → same key → cache hit.
 *
 * Hits skip the provider entirely and return the stored response immediately;
 * the caller still writes a row to ai_call_logs with status='cache_hit' so
 * cost dashboards account for the request even though the provider was
 * not invoked. Misses fall through to the live provider, and on success
 * the new response is stored for future calls.
 *
 * Failure modes are deliberately fail-open: if the cache table is offline
 * or the lookup throws, callers continue with a live provider call. The
 * cache must never become a hard dependency.
 */

const crypto = require('crypto');
const { query } = require('../../config/database');
const log = require('../../lib/logger').child({ module: 'ai.responseCache' });

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// Build a deterministic cache key. Inputs are JSON-stringified in a stable
// order so two clients that hand us the same logical inputs produce the
// same key regardless of property-order quirks in their callers.
const buildCacheKey = ({ task, provider, model, promptSha256, inputSha256 }) => {
  if (!task || !provider || !model || !inputSha256) {
    throw new Error('aiResponseCache.buildCacheKey: task, provider, model, inputSha256 are required.');
  }
  // Sort keys explicitly so the JSON encoding is canonical.
  const canonical = JSON.stringify({
    task,
    provider,
    model,
    prompt_sha256: promptSha256 || null,
    input_sha256: inputSha256,
  });
  return sha256(canonical);
};

// Hash arbitrary input material (rendered prompt, file bytes hash, mime,
// any other per-call varying inputs) into a single input_sha256 value.
const hashInputMaterial = (parts) => {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('aiResponseCache.hashInputMaterial: parts[] must be non-empty.');
  }
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    hash.update('|', 'utf8');
    hash.update(part == null ? '' : String(part), 'utf8');
  }
  return hash.digest('hex');
};

const lookup = async ({ cacheKey }) => {
  if (!cacheKey) return null;
  try {
    const result = await query(
      `SELECT id, response_jsonb, prompt_tokens, completion_tokens, total_tokens,
              cost_usd_at_time, prompt_version, prompt_sha256
         FROM public.ai_response_cache
        WHERE cache_key = $1
          AND expires_at > NOW()
        LIMIT 1`,
      [cacheKey]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (err) {
    // Fail-open — a cache lookup error must never block the live call.
    log.warn('cache_lookup_failed', { error: err.message });
    return null;
  }
};

const recordHit = async (id) => {
  if (!id) return;
  try {
    await query(
      `UPDATE public.ai_response_cache
          SET hit_count = hit_count + 1,
              last_hit_at = NOW()
        WHERE id = $1`,
      [id]
    );
  } catch (err) {
    log.warn('cache_hit_record_failed', { error: err.message });
  }
};

const store = async ({
  cacheKey,
  task,
  provider,
  model,
  promptVersion,
  promptSha256,
  inputSha256,
  responseJson,
  tokens,
  costUsd,
  ttlSeconds,
}) => {
  if (!cacheKey || !task || !provider || !model || !inputSha256 || responseJson === undefined) {
    return null;
  }
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : null;
  try {
    const result = await query(
      `INSERT INTO public.ai_response_cache (
         cache_key, task, provider, model,
         prompt_version, prompt_sha256, input_sha256,
         response_jsonb,
         prompt_tokens, completion_tokens, total_tokens, cost_usd_at_time,
         expires_at
       )
       VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         $8::jsonb,
         $9, $10, $11, $12,
         CASE WHEN $13::int IS NULL
              THEN NOW() + INTERVAL '90 days'
              ELSE NOW() + ($13::int * INTERVAL '1 second')
         END
       )
       ON CONFLICT (cache_key) DO UPDATE
         SET response_jsonb     = EXCLUDED.response_jsonb,
             prompt_tokens      = EXCLUDED.prompt_tokens,
             completion_tokens  = EXCLUDED.completion_tokens,
             total_tokens       = EXCLUDED.total_tokens,
             cost_usd_at_time   = EXCLUDED.cost_usd_at_time,
             expires_at         = EXCLUDED.expires_at,
             prompt_version     = EXCLUDED.prompt_version,
             prompt_sha256      = EXCLUDED.prompt_sha256
       RETURNING id`,
      [
        cacheKey,
        task,
        provider,
        model,
        promptVersion || null,
        promptSha256 || null,
        inputSha256,
        JSON.stringify(responseJson),
        tokens?.promptTokens ?? null,
        tokens?.completionTokens ?? null,
        tokens?.totalTokens ?? null,
        costUsd ?? null,
        ttl,
      ]
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    log.warn('cache_store_failed', { error: err.message, task, provider });
    return null;
  }
};

// Operator-callable cleanup. The cron in vercel.json (or a manual run)
// removes rows past their TTL. Returns the rowCount deleted.
const purgeExpired = async () => {
  const result = await query(
    `DELETE FROM public.ai_response_cache WHERE expires_at < NOW()`
  );
  return result.rowCount || 0;
};

module.exports = {
  sha256,
  buildCacheKey,
  hashInputMaterial,
  lookup,
  recordHit,
  store,
  purgeExpired,
};
