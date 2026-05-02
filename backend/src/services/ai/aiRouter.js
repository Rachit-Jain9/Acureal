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
const log = require('../../lib/logger').child({ module: 'ai.router' });
const { getRequestContext } = require('../../lib/requestContext');
const { assertWithinDailyCap, CostCapExceededError } = require('../../lib/costGuard');

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
  // Anthropic SDK shape: { usage: { input_tokens, output_tokens } }
  if (rawResult?.usage && (rawResult.usage.input_tokens != null || rawResult.usage.output_tokens != null)) {
    const promptTokens = rawResult.usage.input_tokens ?? null;
    const completionTokens = rawResult.usage.output_tokens ?? null;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens != null && completionTokens != null
        ? promptTokens + completionTokens
        : null,
    };
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
         created_by
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19
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
        JSON.stringify(metadata || {}),
        attach?.userId ?? ctx.userId ?? null,
      ]
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    // Logging the AI call must never break the AI call itself.
    log.warn('ai_call_log_persist_failed', { error: err.message, task, provider });
    return null;
  }
};

const resolveProviderForTask = (task) => {
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
 * @param {Object=}  args.metadata  Free-form JSON for the log row
 * @param {Function} args.run       async ({ providers, provider, model, task }) => result
 * @returns {Promise<{ result: any, callId: string|null, status: string, latencyMs: number }>}
 */
const runAI = async ({ task, provider, model, attach = {}, metadata = {}, run }) => {
  if (typeof run !== 'function') {
    throw new Error('aiRouter.run: `run` callback is required.');
  }
  if (!task) {
    throw new Error('aiRouter.run: `task` is required.');
  }

  const resolvedProvider = provider || resolveProviderForTask(task);
  const resolvedModel = model || resolveDefaultModel(resolvedProvider);
  const start = Date.now();

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

  try {
    const raw = await run({
      providers: providerRegistry,
      provider: resolvedProvider,
      model: resolvedModel,
      task,
    });

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
      metadata,
      errorCode,
      errorMessage,
    });

    log.error('ai_call_failed', err, { task, provider: resolvedProvider, model: resolvedModel, call_id: callId, latency_ms: latencyMs });
    throw err;
  }

  const latencyMs = Date.now() - start;
  const cost = estimateCost({ provider: resolvedProvider, model: resolvedModel, ...tokens });
  const callId = await persistCallLog({
    task,
    provider: resolvedProvider,
    model: resolvedModel,
    status,
    latencyMs,
    tokens,
    cost,
    attach,
    metadata,
    errorCode,
    errorMessage,
  });

  log.info('ai_call_completed', {
    task,
    provider: resolvedProvider,
    model: resolvedModel,
    latency_ms: latencyMs,
    total_tokens: tokens.totalTokens,
    cost_usd: cost,
    call_id: callId,
  });

  return { result, callId, status, latencyMs, tokens, cost };
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
 */
const runGeminiInline = async (args = {}) => {
  const { task = 'document_extraction', attach, metadata, ...passthrough } = args;
  return runAIResult({
    task,
    provider: 'gemini',
    model: passthrough.model,
    attach,
    metadata,
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
  const { task = 'document_extraction', attach, metadata, ...passthrough } = args;
  return runAIResult({
    task,
    provider: 'claude',
    model: passthrough.model,
    attach,
    metadata,
    run: async ({ providers, model }) =>
      providers.runClaudeWithDocument({ ...passthrough, model }),
  });
};

module.exports = {
  runAI,
  runAIResult,
  runGeminiInline,
  runClaudeReasoning,
  runClaudeWithDocument,
  estimateCost,
  extractTokenUsage,
  resolveProviderForTask,
  resolveDefaultModel,
};
