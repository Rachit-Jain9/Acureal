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

const runClaudeReasoning = async ({
  systemPrompt,
  payload,
  model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  maxTokens = 700,
}) => {
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  });

  return message.content[0]?.text || null;
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

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt || 'You extract structured JSON from regulatory documents. Return ONLY valid JSON matching the requested schema.',
    messages: [
      {
        role: 'user',
        content: [documentBlock, { type: 'text', text: prompt || 'Extract the structured fields requested above.' }],
      },
    ],
  });

  const textBlock = Array.isArray(message.content)
    ? message.content.find((block) => block?.type === 'text')
    : null;
  return textBlock?.text || message.content?.[0]?.text || null;
};

module.exports = {
  getProviderAvailability,
  getRoutingConfig,
  runGeminiInline,
  runClaudeReasoning,
  runClaudeWithDocument,
};
