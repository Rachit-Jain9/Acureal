'use strict';

const hasConfiguredValue = (value) => !!value && !/your[_-]/i.test(value) && !String(value).startsWith('[');

let geminiClient = null;
let anthropicClient = null;
let openaiClient = null;

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

const getProviderAvailability = () => ({
  gemini: hasConfiguredValue(process.env.GEMINI_API_KEY),
  claude: hasConfiguredValue(process.env.ANTHROPIC_API_KEY),
  gpt_compatible: hasConfiguredValue(process.env.OPENAI_API_KEY),
});

const getRoutingConfig = () => ({
  document_classification: process.env.AI_PROVIDER_DOCUMENT_CLASSIFICATION || 'gemini',
  document_extraction: process.env.AI_PROVIDER_DOCUMENT_EXTRACTION || 'gemini',
  translation: process.env.AI_PROVIDER_TRANSLATION || 'gemini',
  reasoning: process.env.AI_PROVIDER_REASONING || 'claude',
  market_synthesis: process.env.AI_PROVIDER_MARKET_SYNTHESIS || 'claude',
});

const getGeminiClient = () => {
  if (!getProviderAvailability().gemini) {
    throw new Error('Gemini is not configured. Set GEMINI_API_KEY to enable document extraction.');
  }

  if (!geminiClient) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  return geminiClient;
};

const getAnthropicClient = () => {
  if (!getProviderAvailability().claude) {
    throw new Error('Claude is not configured. Set ANTHROPIC_API_KEY to enable reasoning features.');
  }

  if (!anthropicClient) {
    const { Anthropic } = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

  const result = await geminiModel.generateContent([
    prompt,
    {
      inlineData: {
        data: base64Data,
        mimeType,
      },
    },
  ]);

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
  runGeminiInline,
  runClaudeReasoning,
  runClaudeReasoningStream,
  runClaudeWithDocument,
  runOpenAIReasoning,
  runOpenAIEmbedding,
};
