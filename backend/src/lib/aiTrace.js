'use strict';

/**
 * Lightweight OpenTelemetry-shape tracing for AI calls.
 *
 * Why not the full @opentelemetry SDK:
 *   - Bundle weight on a serverless function matters; the OTel Node SDK
 *     pulls in 30 transitive deps.
 *   - Vercel's runtime already parses structured JSON log lines into its
 *     observability surface. Emitting OTel-shape events as `console.log`
 *     gets us 90% of the value at 0% of the bundle cost.
 *   - When/if we adopt @vercel/otel later, this module becomes the thin
 *     emitter that swaps stdout for the real OTLP exporter — every call
 *     site keeps using the same `withAiSpan(...)` wrapper.
 *
 * The `request_id` already in requestContext (PR earlier) acts as the
 * trace_id; each AI call gets its own span_id; concurrent retries within
 * a single AI call share span attributes but emit separate `attempt`
 * events. The persisted `ai_call_logs.metadata.span_id` ties an OTel
 * trace back to its row.
 */

const crypto = require('crypto');
const { getRequestContext } = require('./requestContext');

const OTEL_ENABLED = (() => {
  const flag = process.env.AI_TRACE_ENABLED;
  if (flag === undefined || flag === null || flag === '') return true;
  return /^(1|true|yes)$/i.test(flag);
})();

// 16-hex-char span id per OTel spec (8 bytes). 32-hex trace id is provided
// by the request context's request_id; we hash it down to 32 hex when the
// upstream id isn't already in that shape.
const newSpanId = () => crypto.randomBytes(8).toString('hex');
const normaliseTraceId = (raw) => {
  if (!raw) return crypto.randomBytes(16).toString('hex');
  // Strip dashes (UUIDs), pad/truncate to 32 hex chars.
  const hex = String(raw).replace(/-/g, '').replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32);
  return hex;
};

const emit = (eventName, payload) => {
  if (!OTEL_ENABLED) return;
  // Single-line JSON so Vercel's log parser keeps it as one structured
  // record. Prefix the event so log-search filtering is one substring.
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: `ai.${eventName}`, ts: new Date().toISOString(), ...payload }));
  } catch {
    // emission must never throw
  }
};

/**
 * Wrap an async AI operation with span semantics.
 *
 *   const value = await withAiSpan(
 *     { name: 'reasoning', attributes: { task, provider, model } },
 *     async (span) => {
 *       span.setAttribute('attempts', n);
 *       return providerCall();
 *     },
 *   );
 *
 * Emits ai.span.start at entry, ai.span.attempt for each retry, ai.span.end
 * on completion (success or failure). On failure the span carries
 * `error.code` + `error.message` so the trace search shows what went wrong
 * without joining to ai_call_logs.
 */
const withAiSpan = async ({ name, attributes = {} }, fn) => {
  const ctx = getRequestContext() || {};
  const traceId = normaliseTraceId(ctx.requestId);
  const spanId = newSpanId();
  const start = Date.now();
  const baseAttrs = {
    trace_id: traceId,
    span_id: spanId,
    span_name: name,
    user_id: ctx.userId || null,
    organization_id: ctx.organizationId || null,
    ...attributes,
  };
  const dynamicAttrs = {};

  emit('span.start', baseAttrs);

  const span = {
    traceId,
    spanId,
    setAttribute(key, value) {
      dynamicAttrs[key] = value;
    },
    recordEvent(eventName, attrs = {}) {
      emit(`span.${eventName}`, { trace_id: traceId, span_id: spanId, ...attrs });
    },
  };

  try {
    const result = await fn(span);
    emit('span.end', {
      ...baseAttrs,
      ...dynamicAttrs,
      status: 'ok',
      duration_ms: Date.now() - start,
    });
    return result;
  } catch (err) {
    emit('span.end', {
      ...baseAttrs,
      ...dynamicAttrs,
      status: 'error',
      duration_ms: Date.now() - start,
      error_code: err?.code || err?.name || null,
      error_message: err?.message ? String(err.message).slice(0, 500) : null,
    });
    throw err;
  }
};

module.exports = {
  withAiSpan,
  newSpanId,
  normaliseTraceId,
  // Exported for tests
  OTEL_ENABLED,
};
