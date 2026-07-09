'use strict';

// API keys pasted into a hosting dashboard very often carry an invisible
// trailing newline or space. Providers reject those with a 401, so every
// key is read through this helper, which trims at the single point of use.
const readApiKey = (name) => (process.env[name] || '').trim();

const hasConfiguredValue = (value) => !!value && !/your[_-]/i.test(value) && !String(value).startsWith('[');

let geminiClient = null;
let anthropicClient = null;
let openaiClient = null;

// 2026-05-15 upgrade: Gemini 3.1 Flash-Lite GA'd 2026-05-07 (8 days ago).
// 2.5× faster Time-to-First-Token + 45% faster output vs 2.5 Flash, at
// $0.25 / $1.50 per M tokens — best fit for REDIP's extraction +
// classification workloads (high-volume, low-latency, cost-sensitive).
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

// 2026-05-15 correction: GPT-5.4 was released by OpenAI on 2026-03-05
// (confirmed via developers.openai.com + TechCrunch announcement). The
// 2026-05-11 fix-back to 'gpt-4o' (PR-285) was based on a misdiagnosis —
// the 400 BadRequest at the time was likely org-access / transient,
// not "model doesn't exist." Promoting GPT-5.4 to the production default
// now, with 1M-token context + frontier reasoning for the deal-analysis
// surface. Operator override via OPENAI_MODEL env var is preserved.
const DEFAULT_OPENAI_MODEL = 'gpt-5.4';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

const getProviderAvailability = () => ({
  gemini: hasConfiguredValue(readApiKey('GEMINI_API_KEY')),
  claude: hasConfiguredValue(readApiKey('ANTHROPIC_API_KEY')),
  gpt_compatible: hasConfiguredValue(readApiKey('OPENAI_API_KEY')),
});

const getRoutingConfig = () => ({
  document_classification: process.env.AI_PROVIDER_DOCUMENT_CLASSIFICATION || 'gemini',
  document_extraction: process.env.AI_PROVIDER_DOCUMENT_EXTRACTION || 'gemini',
  translation: process.env.AI_PROVIDER_TRANSLATION || 'gemini',
  // 2026-05-15 model-specialization policy (per the AI-architecture doc):
  //   - reasoning + market_synthesis      → OpenAI GPT-5.4 (structured outputs,
  //                                          frontier reasoning, agent workflows)
  //   - narrative_synthesis (NEW)         → Claude Sonnet 4.6 (institutional
  //                                          narrative tone, IC memos, briefing)
  //   - document_extraction/classification → Gemini 3.1 Flash-Lite (cheap +
  //                                          fast multimodal OCR)
  // Each task's provider override stays env-var driven so ops can swap any
  // task's provider without a deploy.
  reasoning: process.env.AI_PROVIDER_REASONING || 'openai',
  market_synthesis: process.env.AI_PROVIDER_MARKET_SYNTHESIS || 'openai',
  narrative_synthesis: process.env.AI_PROVIDER_NARRATIVE_SYNTHESIS || 'claude',
});

const getGeminiClient = () => {
  if (!getProviderAvailability().gemini) {
    throw new Error('Gemini is not configured. Set GEMINI_API_KEY to enable document extraction.');
  }

  if (!geminiClient) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    geminiClient = new GoogleGenerativeAI(readApiKey('GEMINI_API_KEY'));
  }

  return geminiClient;
};

const getAnthropicClient = () => {
  if (!getProviderAvailability().claude) {
    throw new Error('Claude is not configured. Set ANTHROPIC_API_KEY to enable reasoning features.');
  }

  if (!anthropicClient) {
    const { Anthropic } = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: readApiKey('ANTHROPIC_API_KEY') });
  }

  return anthropicClient;
};

// OpenAI client. Provisioned 2026-05-04 as a third available provider.
// Per `docs/AI_ROADMAP.md`, OpenAI does NOT auto-replace Gemini (better at
// multimodal native extraction) or Claude (better at long-form reasoning
// for our domain). It is wired up for:
//   • Embeddings — `text-embedding-3-small` is the default for the future
//     pgvector layer (Tier 4.1). Cheap ($0.02/M tokens) and well-supported.
//   • Optional reasoning fallback when both Gemini and Claude are down.
//   • A/B comparisons when validating prompt changes.
const getOpenAIClient = () => {
  if (!getProviderAvailability().gpt_compatible) {
    throw new Error('OpenAI is not configured. Set OPENAI_API_KEY to enable OpenAI features.');
  }
  if (!openaiClient) {
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: readApiKey('OPENAI_API_KEY') });
  }
  return openaiClient;
};

const runGeminiInline = async ({
  prompt,
  base64Data,
  mimeType,
  model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
}) => {
  const client = getGeminiClient();
  const geminiModel = client.getGenerativeModel({ model });

  // The inline-document part is only valid when a document is actually
  // attached. Text-only callers (e.g. recommendation narration) used to get
  // an unconditional `{ inlineData: { data: undefined, mimeType: undefined } }`
  // part, which Google rejects with `400 Unsupported MIME type:` — a failure
  // masked for months by the retired-model 404 that fired before body
  // validation (fixed 2026-07-09).
  const parts = [prompt];
  if (base64Data) {
    parts.push({
      inlineData: {
        data: base64Data,
        mimeType,
      },
    });
  }
  const result = await geminiModel.generateContent(parts);

  return result.response.text().trim();
};

// Build the system field for Anthropic. When `cachePrompt` is true, the
// system text is wrapped in a content block with `cache_control: ephemeral`
// so Anthropic caches the prefix for 5 minutes. Subsequent calls within that
// window pay 0.1× the input price for the cached portion (90% discount).
//
// Caching adds ~25% surcharge to the cache-write call, so opt-in only when
// the system prompt is stable across calls (IC memo, scenario diagnosis,
// extraction normalization, export insights — all of these reuse the same
// system block on every call).
const buildSystemField = (systemPrompt, cachePrompt) => {
  if (!systemPrompt) return undefined;
  if (!cachePrompt) return systemPrompt;
  return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
};

// Normalize Anthropic's content-array response back to the text we used to
// return. Two shapes possible: single text block (most common), or
// multi-block (rare, e.g. when tool use is enabled — Tier 3+).
const extractClaudeText = (message) => {
  if (!Array.isArray(message?.content)) return null;
  const textBlock = message.content.find((block) => block?.type === 'text');
  return textBlock?.text || message.content[0]?.text || null;
};

const runClaudeReasoning = async ({
  systemPrompt,
  payload,
  model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  maxTokens = 700,
  cachePrompt = false,
}) => {
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: buildSystemField(systemPrompt, cachePrompt),
    messages: [
      {
        role: 'user',
        content: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  });

  // Return the raw envelope alongside the text so the router can extract
  // both regular usage and cache_creation/cache_read token counts. The
  // router's `runAI` already understands the `{ result, raw }` shape.
  return { result: extractClaudeText(message), raw: message };
};

// Send a PDF or image directly to Claude's messages API as a document /
// image content block — used as the fallback path when Gemini is throttled
// or returns a permanent error. Sonnet 4.x supports up to 32 MB / 100 pages
// for PDFs and standard image formats inline.
const runClaudeWithDocument = async ({
  systemPrompt,
  prompt,
  base64Data,
  mimeType,
  model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  maxTokens = 4000,
  cachePrompt = false,
}) => {
  if (!base64Data) {
    throw new Error('runClaudeWithDocument requires base64Data.');
  }
  const client = getAnthropicClient();
  const lowerMime = String(mimeType || '').toLowerCase();
  const isPdf = lowerMime.includes('pdf');
  const isImage = lowerMime.startsWith('image/');
  if (!isPdf && !isImage) {
    throw new Error(`runClaudeWithDocument only supports PDF or image inputs (got ${mimeType || 'unknown'}).`);
  }

  const documentBlock = isPdf
    ? {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
    }
    : {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: base64Data },
    };

  const effectiveSystem = systemPrompt
    || 'You extract structured JSON from regulatory documents. Return ONLY valid JSON matching the requested schema.';

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: buildSystemField(effectiveSystem, cachePrompt),
    messages: [
      {
        role: 'user',
        content: [documentBlock, { type: 'text', text: prompt || 'Extract the structured fields requested above.' }],
      },
    ],
  });

  return { result: extractClaudeText(message), raw: message };
};

// Streaming Claude reasoning. The Anthropic SDK exposes `messages.stream()`
// which yields text deltas as they generate. We surface that as a small
// adapter object so callers don't take a hard dependency on the SDK shape.
//
// The returned object has:
//   • `onText(cb)` — register a callback called for each text delta. cb
//      receives the chunk string (never the SSE wrapper).
//   • `done()` — Promise that resolves with `{ result: fullText, raw: msg }`
//      where `raw.usage` is the final input/output token counts.
//   • `abort()` — best-effort cancellation. Anthropic's SDK supports
//      AbortController; we wire one up so client-disconnect kills the call.
//
// `cachePrompt: true` works the same way as the non-streaming variant.
const runClaudeReasoningStream = async ({
  systemPrompt,
  payload,
  model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  maxTokens = 700,
  cachePrompt = false,
}) => {
  const client = getAnthropicClient();
  const controller = new AbortController();

  // The SDK's stream() method returns a MessageStream — an EventEmitter +
  // async iterable. We register handlers up front so the caller-supplied
  // onText() runs as text arrives rather than after a full collection.
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: buildSystemField(systemPrompt, cachePrompt),
    messages: [
      {
        role: 'user',
        content: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  }, { signal: controller.signal });

  const textListeners = [];

  // The SDK fires 'text' events as the model emits content_block_delta
  // chunks. Each event carries (textDelta, snapshotSoFar). We forward only
  // the delta — accumulating snapshots is the consumer's job and avoids
  // double-buffering in memory.
  stream.on('text', (textDelta) => {
    for (const cb of textListeners) {
      try {
        cb(textDelta);
      } catch (err) {
        // A throwing listener must not kill the stream — log + continue.
        // eslint-disable-next-line no-console
        console.warn('[ai.stream] text listener threw:', err.message);
      }
    }
  });

  return {
    onText(cb) {
      if (typeof cb === 'function') textListeners.push(cb);
    },
    async done() {
      const finalMessage = await stream.finalMessage();
      return { result: extractClaudeText(finalMessage), raw: finalMessage };
    },
    abort() {
      try { controller.abort(); } catch { /* swallow — best-effort */ }
    },
  };
};

// OpenAI reasoning. Returns the same `{ result, raw }` envelope as the
// Anthropic helpers so the router's existing token-extraction logic
// (`extractTokenUsage`) finds usage on `raw.usage` (input_tokens /
// output_tokens shape) consistently. We deliberately do NOT support
// OpenAI's prompt cache yet — Anthropic's is well-covered (PR #152) and
// OpenAI's caching has different semantics; defer until needed.
const runOpenAIReasoning = async ({
  systemPrompt,
  payload,
  model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  maxTokens = 700,
}) => {
  const client = getOpenAIClient();

  const completion = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      {
        role: 'user',
        content: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  });

  const text = completion.choices?.[0]?.message?.content || null;
  // Translate OpenAI's usage shape (`prompt_tokens` / `completion_tokens`)
  // into Anthropic's (`input_tokens` / `output_tokens`) so the router's
  // shared extractor handles it without provider-specific branching.
  const raw = completion.usage
    ? {
        ...completion,
        usage: {
          input_tokens: completion.usage.prompt_tokens,
          output_tokens: completion.usage.completion_tokens,
        },
      }
    : completion;
  return { result: text, raw };
};

// OpenAI streaming reasoning. Mirrors `runClaudeReasoningStream`'s contract:
// returns `{ onText, done, abort }`. Used by the SSE endpoints for IC memo,
// deal Q&A, and per-deal narrative when the routing config picks openai.
//
// `stream_options.include_usage: true` is required to get token counts in the
// final chunk — without it, `raw.usage` ends up undefined and the cost cap
// telemetry silently breaks for streamed calls.
const runOpenAIReasoningStream = async ({
  systemPrompt,
  payload,
  model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  maxTokens = 700,
}) => {
  const client = getOpenAIClient();
  const controller = new AbortController();

  const stream = await client.chat.completions.create(
    {
      model,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        {
          role: 'user',
          content: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
        },
      ],
    },
    { signal: controller.signal },
  );

  const textListeners = [];
  let accumulated = '';
  let finalUsage = null;

  // Drive the iteration in the background so onText fires as chunks arrive.
  // `done()` awaits the same Promise; safe to call multiple times.
  const completionPromise = (async () => {
    for await (const chunk of stream) {
      // OpenAI's final usage chunk has no `choices` — just `usage`.
      if (chunk.usage) {
        finalUsage = chunk.usage;
        continue;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;
      accumulated += delta;
      for (const cb of textListeners) {
        try {
          cb(delta);
        } catch (err) {
          // A throwing listener must not kill the stream — log + continue.
          // eslint-disable-next-line no-console
          console.warn('[ai.stream] text listener threw:', err.message);
        }
      }
    }
    return {
      result: accumulated || null,
      // Translate OpenAI's usage shape into Anthropic's so the router's
      // shared token extractor handles it without provider-specific branching.
      raw: finalUsage
        ? {
            usage: {
              input_tokens: finalUsage.prompt_tokens,
              output_tokens: finalUsage.completion_tokens,
            },
            model,
          }
        : { model },
    };
  })();

  return {
    onText(cb) {
      if (typeof cb === 'function') textListeners.push(cb);
    },
    async done() {
      return completionPromise;
    },
    abort() {
      try { controller.abort(); } catch { /* swallow — best-effort */ }
    },
  };
};

// OpenAI embeddings. Returns `{ embedding: number[], dimensions, raw }`.
// Wired up but not yet called by any service; lands the dependency so when
// Tier 4.1 (pgvector) ships, the embedding plumbing is one import away.
//
// `text-embedding-3-small` chosen as default: $0.02/M tokens, 1536 dim,
// strong baseline. `text-embedding-3-large` (3072 dim, $0.13/M) when
// quality on Indian-real-estate clauses needs the headroom.
const runOpenAIEmbedding = async ({
  input,
  model = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL,
  dimensions,
}) => {
  if (!input || (Array.isArray(input) && input.length === 0)) {
    throw new Error('runOpenAIEmbedding requires non-empty input.');
  }
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model,
    input,
    ...(dimensions ? { dimensions } : {}),
  });
  // For batch inputs, OpenAI returns an array of embeddings preserving
  // input order. For a single string, we still return a one-element array
  // so callers always get the same shape.
  const embeddings = response.data.map((entry) => entry.embedding);
  return {
    result: embeddings,
    raw: {
      ...response,
      usage: response.usage
        ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: 0,
          }
        : undefined,
    },
    dimensions: embeddings[0]?.length || null,
  };
};

module.exports = {
  getProviderAvailability,
  getRoutingConfig,
  // Single source of truth for the current Gemini default. aiRouter's
  // resolveDefaultModel delegates here — never duplicate model-name literals
  // (a stale duplicate caused the July 2026 retired-model outage).
  DEFAULT_GEMINI_MODEL,
  // Raw SDK client getters. runAI passes this whole module to a task's
  // run() callback as `providers`; exportNarrative.service.js and
  // aiMarketContext.service.js need raw client access for text-only
  // generations the run* helpers don't cover. Without these on the export
  // surface, `providers.getGeminiClient` was undefined and those callers'
  // Gemini / OpenAI cascade legs always threw "<provider> client unavailable".
  getGeminiClient,
  getAnthropicClient,
  getOpenAIClient,
  runGeminiInline,
  runClaudeReasoning,
  runClaudeReasoningStream,
  runClaudeWithDocument,
  runOpenAIReasoning,
  runOpenAIReasoningStream,
  runOpenAIEmbedding,
};
