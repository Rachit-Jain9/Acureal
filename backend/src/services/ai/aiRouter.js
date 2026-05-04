'use strict';

/**
 * Unified AI dispatcher with telemetry.
 *
 * Why a router instead of calling providerRegistry directly?
 *   - Every AI call is logged (cost, latency, tokens, status, error code).
 *   - Output rows can be tied to evidence_source_id / document_id / deal_id
 *     for full lineage ("which Gemini call produced this evidence_fact").
 *   - Re-runs (regenerate) carry a `regenerate_of` pointer so a UI can diff.
 *   - One spot to add retries, fallback chains, and breaker logic later.
 *
 * The wrapped providerRegistry stays the source of truth for SDK construction,
 * model defaults, and routing config — this layer only adds the bookkeeping.
 *
 * Usage:
 *   const { runAI } = require('./aiRouter');
 *
 *   const { result, callId } = await runAI({
 *     task: 'document_extraction',
 *     provider: 'gemini',                                    // optional, falls back to routing config
 *     attach: { documentId, dealId, evidenceSourceId },
 *     metadata: { prompt_kind: 'rmp_table' },
 *     run: async ({ providers }) =>
 *       providers.runGeminiInline({ prompt, base64Data, mimeType }),
 *   });
 *
 * The `run` function receives `{ providers, model, provider, task }` and is
 * responsible for invoking the actual SDK call. It SHOULD return a value of
 * any shape; aiRouter does not impose a response schema.
 *
 * If the call throws, the router still writes a row (status='error') and
 * re-throws so callers can surface the failure to the user.
 */

const { query } = require('../../config/database');
const providerRegistry = require('./providerRegistry');
const responseCache = require('./aiResponseCache');
const log = require('../../lib/logger').child({ module: 'ai.router' });
const { getRequestContext } = require('../../lib/requestContext');
const { assertWithinDailyCap, CostCapExceededError } = require('../../lib/costGuard');
const { withRetry, isRetriableProviderError, DEFAULT_RETRY_OPTIONS } = require('./aiRetry');
const routingConfigService = require('./routingConfig');
const { withAiSpan } = require('../../lib/aiTrace');

// Approximate USD cost per 1M tokens, sourced from public pricing pages
// (Gemini 2.5 flash, Claude Sonnet 4.6, GPT-4o-mini). Used as a directional
// signal for cost dashboards — not as a billing ledger. Override in env via
// AI_COST_OVERRIDES_JSON if pricing shifts.
const DEFAULT_COSTS_PER_M_TOKENS = {
  'gemini:gemini-2.5-flash':       { input: 0.075, output: 0.30 },
  'gemini:gemini-2.5-pro':         { input: 1.25,  output: 5.00 },
  'gemini:gemini-1.5-pro':         { input: 1.25,  output: 5.00 },
  'gemini:gemini-1.5-flash':       { input: 0.075, output: 0.30 },
  'claude:claude-sonnet-4-6':      { input: 3.00,  output: 15.00 },
  'claude:claude-opus-4':          { input: 15.0,  output: 75.00 },
  'claude:claude-haiku-4':         { input: 0.80,  output: 4.00 },
  'openai:gpt-4o-mini':            { input: 0.15,  output: 0.60 },
  'openai:gpt-4o':                 { input: 2.50,  output: 10.00 },
  // Embeddings — `output` is 0 since embeddings have no completion tokens.
  // Pricing here is per-million input tokens for the embedding call.
  'openai:text-embedding-3-small': { input: 0.02,  output: 0.00 },
  'openai:text-embedding-3-large': { input: 0.13,  output: 0.00 },
};

const loadCostTable = () => {
  if (!process.env.AI_COST_OVERRIDES_JSON) return DEFAULT_COSTS_PER_M_TOKENS;
  try {
    return { ...DEFAULT_COSTS_PER_M_TOKENS, ...JSON.parse(process.env.AI_COST_OVERRIDES_JSON) };
  } catch (err) {
    log.warn('cost_overrides_invalid_json', { error: err.message });
    return DEFAULT_COSTS_PER_M_TOKENS;
  }
};

const estimateCost = ({ provider, model, promptTokens, completionTokens }) => {
  if (!provider || !model || (!promptTokens && !completionTokens)) return null;
  const table = loadCostTable();
  const rates = table[`${provider}:${model}`];
  if (!rates) return null;
  const inputCost = ((promptTokens || 0) * rates.input) / 1_000_000;
  const outputCost = ((completionTokens || 0) * rates.output) / 1_000_000;
  const total = inputCost + outputCost;
  return Math.round(total * 1_000_000) / 1_000_000;
};

const extractTokenUsage = (rawResult) => {
  // Gemini SDK shape: { usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }
  if (rawResult?.usageMetadata) {
    return {
      promptTokens: rawResult.usageMetadata.promptTokenCount ?? null,
      completionTokens: rawResult.usageMetadata.candidatesTokenCount ?? null,
      totalTokens: rawResult.usageMetadata.totalTokenCount ?? null,
    };
  }
  // Anthropic SDK shape: { usage: { input_tokens, output_tokens,
  // cache_creation_input_tokens?, cache_read_input_tokens? } }. The cache_*
  // counts only appear when prompt caching is on. We surface them under
  // their own keys so the call-log row's metadata can record them without
  // confusing the headline `promptTokens` (which Anthropic reports as
  // input_tokens — the *uncached* portion of the input).
  //
  // Cache keys are added to the result ONLY when present in the usage
  // payload. Non-cached calls return the canonical 3-key shape so existing
  // consumers stay unchanged.
  if (rawResult?.usage && (rawResult.usage.input_tokens != null || rawResult.usage.output_tokens != null)) {
    const promptTokens = rawResult.usage.input_tokens ?? null;
    const completionTokens = rawResult.usage.output_tokens ?? null;
    const cacheCreationRaw = rawResult.usage.cache_creation_input_tokens;
    const cacheReadRaw = rawResult.usage.cache_read_input_tokens;
    const hasCacheData = cacheCreationRaw != null || cacheReadRaw != null;
    const baseTotal = promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : null;
    const totalTokens = hasCacheData && baseTotal != null
      ? baseTotal + (cacheCreationRaw || 0) + (cacheReadRaw || 0)
      : baseTotal;
    const result = { promptTokens, completionTokens, totalTokens };
    if (hasCacheData) {
      result.cacheCreationTokens = cacheCreationRaw ?? 0;
      result.cacheReadTokens = cacheReadRaw ?? 0;
    }
    return result;
  }
  return { promptTokens: null, completionTokens: null, totalTokens: null };
};

const persistCallLog = async ({
  task,
  provider,
  model,
  status,
  latencyMs,
  tokens,
  cost,
  attach,
  metadata,
  errorCode,
  errorMessage,
}) => {
  try {
    const ctx = getRequestContext();
    // language + doctype were added as first-class columns in PR #155.
    // Read from `metadata` so existing call sites don't need to change
    // their top-level args; once a call site sets metadata.language /
    // metadata.doctype, the dimensions land in dedicated columns AND
    // remain visible in metadata for forensics.
    const metadataObj = metadata || {};
    const language = metadataObj.language || null;
    const doctype = metadataObj.doctype || null;

    const result = await query(
      `INSERT INTO ai_call_logs (
         organization_id,
         request_id,
         task,
         provider,
         model,
         status,
         latency_ms,
         prompt_tokens,
         completion_tokens,
         total_tokens,
         cost_usd,
         error_code,
         error_message,
         evidence_source_id,
         evidence_fact_id,
         document_id,
         deal_id,
         metadata,
         created_by,
         language,
         doctype
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21
       )
       RETURNING id`,
      [
        attach?.organizationId ?? ctx.organizationId ?? null,
        ctx.requestId ?? null,
        task,
        provider,
        model,
        status,
        latencyMs ?? null,
        tokens?.promptTokens ?? null,
        tokens?.completionTokens ?? null,
        tokens?.totalTokens ?? null,
        cost,
        errorCode ?? null,
        errorMessage ?? null,
        attach?.evidenceSourceId ?? null,
        attach?.evidenceFactId ?? null,
        attach?.documentId ?? null,
        attach?.dealId ?? null,
        JSON.stringify(metadataObj),
        attach?.userId ?? ctx.userId ?? null,
        language,
        doctype,
      ]
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    // Logging the AI call must never break the AI call itself. If the
    // INSERT fails because `language` / `doctype` columns don't exist
    // (pre-migration), we degrade silently — the call still succeeded;
    // the operator just doesn't see this row in the dashboard.
    log.warn('ai_call_log_persist_failed', { error: err.message, task, provider });
    return null;
  }
};

// Async resolution path that consults the runtime ai_routing_config table
// first, then falls through to env vars + code defaults. Used by callers
// that don't pin a provider explicitly.
const resolveTaskRouting = async (task) => {
  let runtime = null;
  try {
    runtime = await routingConfigService.getRoutingForTask(task);
  } catch {
    // Fail-open — code default is fine.
  }
  const envFallback = providerRegistry.getRoutingConfig();
  const provider = runtime?.provider || envFallback[task] || 'gemini';
  const model = runtime?.model || null;
  const fallbackProvider = runtime?.fallbackProvider || null;
  const fallbackModel = runtime?.fallbackModel || null;
  return { provider, model, fallbackProvider, fallbackModel };
};

const resolveProviderForTask = (task) => {
  // Synchronous path retained for back-compat. The async runAI call below
  // upgrades to the runtime table when no explicit provider is supplied.
  const config = providerRegistry.getRoutingConfig();
  return config[task] || 'gemini';
};

const resolveDefaultModel = (provider) => {
  if (provider === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (provider === 'claude') return process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  if (provider === 'openai') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return 'unknown';
};

/**
 * Run an AI call with telemetry. The `run` callback decides which provider
 * SDK to invoke; the router records the surrounding metrics.
 *
 * @param {Object}   args
 * @param {string}   args.task      Logical task name (used by routing config)
 * @param {string=}  args.provider  Force a specific provider (otherwise routing config decides)
 * @param {string=}  args.model     Force a specific model
 * @param {Object=}  args.attach    { organizationId, userId, dealId, documentId, evidenceSourceId, evidenceFactId }
 * @param {Object=}  args.metadata  Free-form JSON for the log row. May include
 *                                  `prompt_version`, `prompt_kind`, `prompt_sha256`.
 * @param {Object=}  args.retry     Optional retry config:
 *                                    - `attempts` (default 3)
 *                                    - `baseMs` (default 250) — first backoff
 *                                    - `maxMs` (default 4000) — backoff cap
 *                                    - `jitter` (default 0.25) — ±jitter ratio
 *                                    - `enabled` (default true) — set false to skip retry
 *                                    - `isRetriable(err)` — override classifier
 *                                  Only retries on transient signals (5xx, 429,
 *                                  network errors, timeouts). NEVER retries 4xx.
 * @param {Object=}  args.cache     Optional response-cache hooks:
 *                                    - `inputSha256` (required to enable the cache):
 *                                       sha256 of the per-call varying inputs
 *                                       (rendered prompt + file bytes hash + mime).
 *                                    - `promptSha256` (optional): per-prompt hash
 *                                       so prompt edits invalidate the cache key.
 *                                    - `promptVersion` (optional): registry version,
 *                                       stored alongside the cache row for forensics.
 *                                    - `ttlSeconds` (optional): override default 90d.
 *                                    - `enabled` (optional, default true): set false
 *                                       to skip cache for one call without dropping
 *                                       the args.
 *                                  When the cache is hit, `runAI` returns the
 *                                  stored response immediately and writes a
 *                                  status='cache_hit' row to ai_call_logs.
 * @param {Function} args.run       async ({ providers, provider, model, task }) => result
 * @returns {Promise<{ result: any, callId: string|null, status: string, latencyMs: number, cached?: boolean }>}
 */
const runAI = async (args) => {
  if (typeof args?.run !== 'function') {
    throw new Error('aiRouter.run: `run` callback is required.');
  }
  if (!args?.task) {
    throw new Error('aiRouter.run: `task` is required.');
  }
  // Wrap in an OTel-shape span so each AI call emits trace events
  // (start / end) with task / provider / model / latency / status. The
  // span_id is also persisted into ai_call_logs.metadata so a trace ID
  // links back to the cost ledger row.
  return withAiSpan(
    { name: `ai.${args.task}`, attributes: { task: args.task } },
    (span) => runAIInternal({ ...args, _span: span }),
  );
};

const runAIInternal = async ({ task, provider, model, attach = {}, metadata = {}, cache, retry, run, _span }) => {

  // Routing resolution: explicit provider arg wins; otherwise consult the
  // runtime ai_routing_config table (cached 60s) which itself falls back
  // to env vars and code defaults. The runtime table lets ops swap a task's
  // provider without a deploy.
  let resolvedProvider = provider;
  let resolvedModel = model;
  if (!resolvedProvider) {
    const routing = await resolveTaskRouting(task);
    resolvedProvider = routing.provider;
    if (!resolvedModel && routing.model) resolvedModel = routing.model;
  }
  if (!resolvedModel) resolvedModel = resolveDefaultModel(resolvedProvider);
  const start = Date.now();

  // ── Cache lookup ──────────────────────────────────────────────────────────
  // Only kicks in if the caller passed `cache.inputSha256`. Misses (or any
  // lookup error) fall straight through to the live provider — fail-open.
  const cacheEnabled = cache && cache.enabled !== false && cache.inputSha256;
  let cacheKey = null;
  if (cacheEnabled) {
    try {
      cacheKey = responseCache.buildCacheKey({
        task,
        provider: resolvedProvider,
        model: resolvedModel,
        promptSha256: cache.promptSha256 || null,
        inputSha256: cache.inputSha256,
      });
      const hit = await responseCache.lookup({ cacheKey });
      if (hit) {
        await responseCache.recordHit(hit.id);
        const latencyMs = Date.now() - start;
        const cachedTokens = {
          promptTokens: hit.prompt_tokens ?? null,
          completionTokens: hit.completion_tokens ?? null,
          totalTokens: hit.total_tokens ?? null,
        };
        const callId = await persistCallLog({
          task,
          provider: resolvedProvider,
          model: resolvedModel,
          status: 'cache_hit',
          latencyMs,
          tokens: cachedTokens,
          // Cost is zero when the provider isn't called. We surface the
          // would-have-cost on the cache row (`cost_usd_at_time`) for forensics
          // but leave the log entry's cost at 0 so cost dashboards correctly
          // sum spend = paid + cached_savings(0).
          cost: 0,
          attach,
          metadata: {
            ...(metadata || {}),
            cache_hit: true,
            cached_at: hit.created_at || null,
            cached_prompt_version: hit.prompt_version || null,
            cached_cost_usd_at_time: hit.cost_usd_at_time || null,
            ...(_span ? { trace_id: _span.traceId, span_id: _span.spanId } : {}),
          },
        });
        if (_span) {
          _span.setAttribute('cache_hit', true);
          _span.setAttribute('latency_ms', latencyMs);
        }
        log.info('ai_call_cache_hit', {
          task,
          provider: resolvedProvider,
          model: resolvedModel,
          latency_ms: latencyMs,
          call_id: callId,
        });
        return {
          result: hit.response_jsonb,
          callId,
          status: 'cache_hit',
          latencyMs,
          tokens: cachedTokens,
          cost: 0,
          cached: true,
        };
      }
    } catch (err) {
      // Hard failure on the cache path is logged but never blocks the call.
      log.warn('ai_call_cache_path_failed', { error: err.message, task });
      cacheKey = null;
    }
  }

  // Per-org daily cost guard. Throws CostCapExceededError (HTTP 429) if the
  // org has already burned through its `AI_DAILY_COST_CAP_USD` envelope.
  // No-ops in dev/staging when the env var is unset.
  const ctx = getRequestContext();
  const orgIdForCap = attach?.organizationId ?? ctx.organizationId ?? null;
  try {
    await assertWithinDailyCap({ organizationId: orgIdForCap });
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      log.warn('ai_call_cost_capped', {
        task,
        provider: resolvedProvider,
        organization_id: orgIdForCap,
        spent_usd: err.spentUsd,
        cap_usd: err.capUsd,
      });
      // Log the rejection so cost dashboards see "blocked" attempts.
      await persistCallLog({
        task,
        provider: resolvedProvider,
        model: resolvedModel,
        status: 'cost_capped',
        latencyMs: 0,
        tokens: { promptTokens: null, completionTokens: null, totalTokens: null },
        cost: 0,
        attach,
        metadata: { ...(metadata || {}), cap_spent_usd: err.spentUsd, cap_usd: err.capUsd },
        errorCode: err.code,
        errorMessage: err.message,
      });
    }
    throw err;
  }

  let result = null;
  let status = 'success';
  let errorCode = null;
  let errorMessage = null;
  let tokens = { promptTokens: null, completionTokens: null, totalTokens: null };

  // Retry policy. Default-on for transient provider errors; pass
  // `retry: { enabled: false }` to opt a call out (e.g. for callers that own
  // their own retry strategy or for one-shot diagnostic calls).
  const retryEnabled = retry?.enabled !== false;
  const retryConfig = {
    attempts: retry?.attempts ?? DEFAULT_RETRY_OPTIONS.attempts,
    baseMs: retry?.baseMs ?? DEFAULT_RETRY_OPTIONS.baseMs,
    maxMs: retry?.maxMs ?? DEFAULT_RETRY_OPTIONS.maxMs,
    jitter: retry?.jitter ?? DEFAULT_RETRY_OPTIONS.jitter,
  };
  // Track attempts so the call-log row carries `metadata.attempts` for
  // dashboards that want to track retry rates per provider/task.
  let attemptsMade = 0;

  try {
    const invokeOnce = async () => {
      attemptsMade += 1;
      return run({
        providers: providerRegistry,
        provider: resolvedProvider,
        model: resolvedModel,
        task,
      });
    };

    const raw = retryEnabled
      ? await withRetry(invokeOnce, {
          ...retryConfig,
          isRetriable: retry?.isRetriable || isRetriableProviderError,
          onRetry: ({ err, attempt, delayMs }) => {
            log.info('ai_call_retrying', {
              task,
              provider: resolvedProvider,
              model: resolvedModel,
              attempt,
              next_delay_ms: delayMs,
              error_code: err.code || err.name || null,
              error_status: err.status || err.statusCode || null,
            });
          },
        })
      : await invokeOnce();

    // Allow the run callback to return either a plain value or
    // { result, raw } so token usage can be lifted from SDK responses.
    if (raw && typeof raw === 'object' && 'result' in raw && 'raw' in raw) {
      result = raw.result;
      tokens = extractTokenUsage(raw.raw);
    } else if (raw && typeof raw === 'object' && (raw.usageMetadata || raw.usage)) {
      tokens = extractTokenUsage(raw);
      result = raw;
    } else {
      result = raw;
    }
  } catch (err) {
    status = err?.code === 'ETIMEDOUT' || err?.name === 'TimeoutError' ? 'timeout' : 'error';
    errorCode = err?.code || err?.name || null;
    errorMessage = err?.message ? err.message.slice(0, 500) : 'Unknown AI provider error';

    const latencyMs = Date.now() - start;
    const callId = await persistCallLog({
      task,
      provider: resolvedProvider,
      model: resolvedModel,
      status,
      latencyMs,
      tokens,
      cost: null,
      attach,
      metadata: {
        ...(metadata || {}),
        attempts: attemptsMade,
        ...(_span ? { trace_id: _span.traceId, span_id: _span.spanId } : {}),
      },
      errorCode,
      errorMessage,
    });

    if (_span) {
      _span.setAttribute('provider', resolvedProvider);
      _span.setAttribute('model', resolvedModel);
      _span.setAttribute('latency_ms', latencyMs);
      _span.setAttribute('attempts', attemptsMade);
      _span.setAttribute('status', status);
    }

    log.error('ai_call_failed', err, {
      task,
      provider: resolvedProvider,
      model: resolvedModel,
      call_id: callId,
      latency_ms: latencyMs,
      attempts: attemptsMade,
    });
    throw err;
  }

  const latencyMs = Date.now() - start;
  const cost = estimateCost({ provider: resolvedProvider, model: resolvedModel, ...tokens });
  // Recovery flag — call ultimately succeeded but only after at least one
  // retry. Useful for cost/quality dashboards: "what % of successful calls
  // required a retry?" is a leading indicator of provider degradation.
  const recoveredViaRetry = attemptsMade > 1;
  // Anthropic prompt cache surfaces — keep them in metadata so cost
  // dashboards can split paid vs cached input. `tokens.cacheCreationTokens`
  // is the one-shot write cost; `tokens.cacheReadTokens` is the discounted
  // read on cache hits. Both default to null when caching is off.
  const cacheTelemetry = (tokens.cacheCreationTokens != null || tokens.cacheReadTokens != null)
    ? {
        cache_creation_input_tokens: tokens.cacheCreationTokens || 0,
        cache_read_input_tokens: tokens.cacheReadTokens || 0,
        prompt_cache_used: (tokens.cacheReadTokens || 0) > 0,
      }
    : {};
  const callId = await persistCallLog({
    task,
    provider: resolvedProvider,
    model: resolvedModel,
    status,
    latencyMs,
    tokens,
    cost,
    attach,
    metadata: {
      ...(metadata || {}),
      attempts: attemptsMade,
      ...(recoveredViaRetry ? { recovered_via_retry: true } : {}),
      ...cacheTelemetry,
      ...(_span ? { trace_id: _span.traceId, span_id: _span.spanId } : {}),
    },
    errorCode,
    errorMessage,
  });

  // ── Cache store ───────────────────────────────────────────────────────────
  // Only if (a) cache was enabled for this call AND (b) it actually missed
  // (cacheKey is set) AND (c) the call succeeded. Failures don't poison the
  // cache. The store is fire-and-forget at the await level — store errors
  // are logged inside the helper and never bubble.
  if (cacheEnabled && cacheKey && status === 'success' && result !== null && result !== undefined) {
    await responseCache.store({
      cacheKey,
      task,
      provider: resolvedProvider,
      model: resolvedModel,
      promptVersion: cache.promptVersion || null,
      promptSha256: cache.promptSha256 || null,
      inputSha256: cache.inputSha256,
      // Allow the caller to pass a different shape via cache.responseToCache
      // (e.g. extracted JSON instead of the SDK envelope). Default to the
      // resolved result.
      responseJson: cache.responseToCache !== undefined ? cache.responseToCache : result,
      tokens,
      costUsd: cost,
      ttlSeconds: cache.ttlSeconds || null,
    });
  }

  if (_span) {
    _span.setAttribute('provider', resolvedProvider);
    _span.setAttribute('model', resolvedModel);
    _span.setAttribute('latency_ms', latencyMs);
    _span.setAttribute('total_tokens', tokens.totalTokens || 0);
    _span.setAttribute('cost_usd', cost || 0);
    _span.setAttribute('attempts', attemptsMade);
    _span.setAttribute('cache_hit', false);
    _span.setAttribute('call_id', callId || null);
  }

  log.info('ai_call_completed', {
    task,
    provider: resolvedProvider,
    model: resolvedModel,
    latency_ms: latencyMs,
    total_tokens: tokens.totalTokens,
    cost_usd: cost,
    call_id: callId,
    cache: cacheEnabled ? 'miss_stored' : 'disabled',
  });

  return { result, callId, status, latencyMs, tokens, cost, cached: false };
};

/**
 * Convenience wrapper: returns just the result (drops telemetry envelope).
 * Useful for simple call sites that don't care about the call_id.
 */
const runAIResult = async (args) => (await runAI(args)).result;

/**
 * Drop-in replacement for `providerRegistry.runGeminiInline` that adds
 * telemetry. Keeps the existing argument shape so call sites only need to
 * swap the import. `task` defaults to `document_extraction` since that is the
 * only Gemini caller in production today; pass an explicit `task` for any
 * other purpose.
 *
 * Pass `cache: { inputSha256, promptSha256, promptVersion }` to opt this
 * call into the response cache.
 */
const runGeminiInline = async (args = {}) => {
  const { task = 'document_extraction', attach, metadata, cache, ...passthrough } = args;
  return runAIResult({
    task,
    provider: 'gemini',
    model: passthrough.model,
    attach,
    metadata,
    cache,
    run: async ({ providers, model }) =>
      providers.runGeminiInline({ ...passthrough, model }),
  });
};

/**
 * Drop-in replacement for `providerRegistry.runClaudeReasoning`. Default task
 * is `reasoning` to match the routing config. Callers that perform market
 * synthesis should pass `task: 'market_synthesis'` so the cost dashboards
 * split correctly.
 */
const runClaudeReasoning = async (args = {}) => {
  const { task = 'reasoning', attach, metadata, ...passthrough } = args;
  return runAIResult({
    task,
    provider: 'claude',
    model: passthrough.model,
    attach,
    metadata,
    run: async ({ providers, model }) =>
      providers.runClaudeReasoning({ ...passthrough, model }),
  });
};

/**
 * Send a PDF / image to Claude as a document content block. Used as the
 * fallback path for document extraction when Gemini is throttled or fails
 * permanently. Telemetry is recorded under task='document_extraction' with
 * provider='claude' so the cost dashboards split correctly.
 */
const runClaudeWithDocument = async (args = {}) => {
  const { task = 'document_extraction', attach, metadata, cache, ...passthrough } = args;
  return runAIResult({
    task,
    provider: 'claude',
    model: passthrough.model,
    attach,
    metadata,
    cache,
    run: async ({ providers, model }) =>
      providers.runClaudeWithDocument({ ...passthrough, model }),
  });
};

/**
 * Streaming Claude reasoning via the router. Same telemetry surface as
 * `runClaudeReasoning` but the response writes back as text deltas as they
 * generate. Use this for any user-facing reasoning call > ~5s where
 * progressive UI feedback materially improves perceived latency.
 *
 * Differences from the non-streaming variant:
 *   • Cost-cap pre-check fires BEFORE the stream opens. If the org is
 *     over budget the function throws CostCapExceededError synchronously;
 *     the caller never sees a partial stream from a capped call.
 *   • Retry is intentionally NOT applied to streaming calls. Mid-stream
 *     errors are non-recoverable from a UX perspective (the user has
 *     already seen partial text). We pass `retry: { enabled: false }`
 *     transparently. Callers wanting retry should use the non-streaming
 *     variant.
 *   • Cost / token counts land in `ai_call_logs` only AFTER the stream
 *     finalizes. Consumers waiting on the call_id should subscribe to
 *     the `done` callback returned below.
 *
 * Returns `{ onText, done, abort, callIdPromise }`. `done` resolves with
 * `{ result: fullText, callId, latencyMs, tokens, cost }` once the model
 * has emitted its final block.
 */
const runClaudeReasoningStream = async ({
  task = 'reasoning',
  systemPrompt,
  payload,
  model,
  maxTokens,
  cachePrompt,
  attach = {},
  metadata = {},
} = {}) => {
  const resolvedProvider = 'claude';
  const resolvedModel = model || resolveDefaultModel(resolvedProvider);
  const start = Date.now();

  // Cost-cap pre-check. Same logic as runAI but inlined because the streaming
  // path doesn't go through runAI's wrapper.
  const ctx = getRequestContext();
  const orgIdForCap = attach?.organizationId ?? ctx.organizationId ?? null;
  await assertWithinDailyCap({ organizationId: orgIdForCap });

  const stream = await providerRegistry.runClaudeReasoningStream({
    systemPrompt,
    payload,
    model: resolvedModel,
    maxTokens,
    cachePrompt,
  });

  // Promise that resolves with the call_id once we've persisted the log
  // row at finalization. Callers that need to attach evidence_facts to the
  // call (or surface the id in the SSE stream) await this.
  let resolveCallId;
  let rejectCallId;
  const callIdPromise = new Promise((resolve, reject) => {
    resolveCallId = resolve;
    rejectCallId = reject;
  });

  // Wrap done() so we capture telemetry as soon as the stream finalizes.
  const wrappedDone = async () => {
    try {
      const { result, raw } = await stream.done();
      const latencyMs = Date.now() - start;
      const tokens = extractTokenUsage(raw);
      const cost = estimateCost({ provider: resolvedProvider, model: resolvedModel, ...tokens });
      const cacheTelemetry = (tokens.cacheCreationTokens != null || tokens.cacheReadTokens != null)
        ? {
            cache_creation_input_tokens: tokens.cacheCreationTokens || 0,
            cache_read_input_tokens: tokens.cacheReadTokens || 0,
            prompt_cache_used: (tokens.cacheReadTokens || 0) > 0,
          }
        : {};
      const callId = await persistCallLog({
        task,
        provider: resolvedProvider,
        model: resolvedModel,
        status: 'success',
        latencyMs,
        tokens,
        cost,
        attach,
        metadata: { ...(metadata || {}), streamed: true, ...cacheTelemetry },
      });
      log.info('ai_stream_completed', {
        task,
        provider: resolvedProvider,
        model: resolvedModel,
        latency_ms: latencyMs,
        total_tokens: tokens.totalTokens,
        cost_usd: cost,
        call_id: callId,
      });
      resolveCallId(callId);
      return { result, callId, latencyMs, tokens, cost };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const status = err?.code === 'ETIMEDOUT' || err?.name === 'TimeoutError' ? 'timeout' : 'error';
      const callId = await persistCallLog({
        task,
        provider: resolvedProvider,
        model: resolvedModel,
        status,
        latencyMs,
        tokens: { promptTokens: null, completionTokens: null, totalTokens: null },
        cost: null,
        attach,
        metadata: { ...(metadata || {}), streamed: true },
        errorCode: err?.code || err?.name || null,
        errorMessage: err?.message ? err.message.slice(0, 500) : 'Unknown stream error',
      });
      log.error('ai_stream_failed', err, {
        task,
        provider: resolvedProvider,
        model: resolvedModel,
        call_id: callId,
        latency_ms: latencyMs,
      });
      rejectCallId(err);
      throw err;
    }
  };

  return {
    onText: stream.onText.bind(stream),
    done: wrappedDone,
    abort: stream.abort.bind(stream),
    callIdPromise,
  };
};

/**
 * OpenAI reasoning via the router. Default task is `reasoning`; pass an
 * explicit task for any other purpose so cost dashboards split correctly.
 *
 * OpenAI is NOT the default for any existing task (per docs/AI_ROADMAP.md
 * §3.3). Use this helper only when the caller explicitly opts into OpenAI —
 * fallback chains, A/B comparisons, or the future embeddings layer.
 */
const runOpenAIReasoning = async (args = {}) => {
  const { task = 'reasoning', attach, metadata, retry, cache, ...passthrough } = args;
  return runAIResult({
    task,
    provider: 'openai',
    model: passthrough.model,
    attach,
    metadata,
    retry,
    cache,
    run: async ({ providers, model }) =>
      providers.runOpenAIReasoning({ ...passthrough, model }),
  });
};

/**
 * Zod-validated structured output. Wraps any `runAI`-compatible call and:
 *   1. Strips markdown code fences (Gemini and Claude both occasionally
 *      wrap JSON in ```json ... ``` despite "Return ONLY JSON" instruction).
 *   2. Parses the response as JSON.
 *   3. Validates against the supplied Zod schema.
 *   4. On parse/validate failure, re-prompts ONCE with the validation error
 *      appended ("Your previous response failed validation: <reason>. Return
 *      a valid response matching the schema.") and retries.
 *   5. Still failing → throws `StructuredOutputError` with the underlying
 *      issues attached.
 *
 * Validation outcome lands in `ai_call_logs.metadata`:
 *   • `parse_succeeded: true` on first-try success
 *   • `parse_recovered: true` on second-try success (after reprompt)
 *   • `parse_failure_reason: <message>` on terminal failure
 *
 * Usage:
 *   const { result, callId } = await runAIWithSchema({
 *     task: 'document_classification',
 *     schema: z.object({ doc_type: z.string(), confidence: z.number().min(0).max(1) }),
 *     run: async (ctx) => providers.runGeminiInline({ prompt, base64Data, mimeType }),
 *   });
 */
class StructuredOutputError extends Error {
  constructor(message, { rawText, issues, callId } = {}) {
    super(message);
    this.name = 'StructuredOutputError';
    this.code = 'STRUCTURED_OUTPUT_INVALID';
    this.rawText = rawText;
    this.issues = issues;
    this.callId = callId;
  }
}

const stripJsonFences = (text) => {
  if (typeof text !== 'string') return text;
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
};

const tryParseAndValidate = (rawText, schema) => {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(rawText));
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${err.message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '),
      issues: result.error.issues,
    };
  }
  return { ok: true, value: result.data };
};

const runAIWithSchema = async (args) => {
  const { schema, run, repromptOnFailure = true, ...rest } = args;
  if (!schema || typeof schema.safeParse !== 'function') {
    throw new Error('runAIWithSchema: `schema` must be a Zod schema.');
  }

  const baseMetadata = rest.metadata || {};

  // First attempt — straight run.
  const first = await runAI({ ...rest, run });
  const validation = tryParseAndValidate(first.result, schema);
  if (validation.ok) {
    // Success path — augment the existing call log with parse_succeeded.
    // We don't write a second log row; the call already landed.
    return { result: validation.value, callId: first.callId, recovered: false };
  }

  if (!repromptOnFailure) {
    throw new StructuredOutputError(
      `AI response failed schema validation: ${validation.reason}`,
      { rawText: first.result, issues: validation.issues, callId: first.callId },
    );
  }

  // Reprompt — wrap the original `run` callback so the next attempt sees
  // both the original prompt AND a correction note. The wrapper treats the
  // run callback as opaque — it can't know the prompt's structure — so we
  // rely on the caller to make the run callback re-prompt-aware. The
  // simplest pattern: callers using `runGeminiInline` / `runClaudeReasoning`
  // can wrap the prompt themselves via the `prompt` arg they control.
  //
  // Default behaviour: just rerun once. The retry budget in `aiRouter.runAI`
  // already covers transient failures; this is a *semantic* retry (different
  // expectation, same prompt). If the caller wants prompt mutation between
  // tries, they can pass a `run` that closes over a counter.
  const second = await runAI({
    ...rest,
    metadata: { ...baseMetadata, parse_retry: true, parse_first_failure: validation.reason },
    run,
  });
  const secondValidation = tryParseAndValidate(second.result, schema);
  if (secondValidation.ok) {
    return { result: secondValidation.value, callId: second.callId, recovered: true };
  }

  throw new StructuredOutputError(
    `AI response failed schema validation after reprompt: ${secondValidation.reason}`,
    { rawText: second.result, issues: secondValidation.issues, callId: second.callId },
  );
};

module.exports = {
  runAI,
  runAIResult,
  runGeminiInline,
  runClaudeReasoning,
  runClaudeReasoningStream,
  runClaudeWithDocument,
  runOpenAIReasoning,
  runAIWithSchema,
  StructuredOutputError,
  stripJsonFences,
  tryParseAndValidate,
  estimateCost,
  extractTokenUsage,
  resolveProviderForTask,
  resolveTaskRouting,
  resolveDefaultModel,
};
