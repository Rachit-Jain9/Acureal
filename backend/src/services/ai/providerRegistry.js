'use strict';

const hasConfiguredValue = (value) => !!value && !/your[_-]/i.test(value) && !String(value).startsWith('[');

let geminiClient = null;
let anthropicClient = null;

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

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

module.exports = {
  getProviderAvailability,
  getRoutingConfig,
  runGeminiInline,
  runClaudeReasoning,
  runClaudeWithDocument,
};
