'use strict';

// Router-level retry now lives in `aiRetry.js` (see `aiRetry.test.js` for
// classifier coverage). This file tests the EXTRACTION-LEVEL fallback only:
// "Gemini call failed permanently → switch to Claude with the same document".
// Each `runGeminiInline` mock rejection represents one call FROM the
// extraction service's POV — the router's internal retry is invisible at
// this layer because the entire `runGeminiInline` is mocked.

jest.mock('../src/services/ai/aiRouter', () => ({
  runGeminiInline: jest.fn(),
  runClaudeReasoning: jest.fn(),
  runClaudeWithDocument: jest.fn(),
}));

jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ gemini: true, claude: true, gpt_compatible: false })),
}));

const aiRouter = require('../src/services/ai/aiRouter');
const providerRegistry = require('../src/services/ai/providerRegistry');
const { callExtractionWithFallback } = require('../src/services/extraction.service');

const baseArgs = {
  prompt: 'Extract zoning regulations as JSON.',
  base64Data: 'YmFzZTY0',
  mimeType: 'application/pdf',
  attach: { documentId: 'doc-1' },
};

describe('callExtractionWithFallback', () => {
  beforeEach(() => {
    aiRouter.runGeminiInline.mockReset();
    aiRouter.runClaudeWithDocument.mockReset();
    providerRegistry.getProviderAvailability.mockReturnValue({
      gemini: true, claude: true, gpt_compatible: false,
    });
  });

  test('returns Gemini result on first success — no Claude call', async () => {
    aiRouter.runGeminiInline.mockResolvedValueOnce('{"zone":"R-PZ-A"}');

    const result = await callExtractionWithFallback(baseArgs);

    expect(result).toMatchObject({
      rawText: '{"zone":"R-PZ-A"}',
      provider: 'gemini',
      fallbackReason: null,
    });
    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(1);
    expect(aiRouter.runClaudeWithDocument).not.toHaveBeenCalled();
  });

  test('falls back to Claude when Gemini throws (router has already exhausted internal retries)', async () => {
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    aiRouter.runClaudeWithDocument.mockResolvedValueOnce('{"zone":"R-PZ-A","fallback":"claude"}');

    const result = await callExtractionWithFallback(baseArgs);

    expect(result.provider).toBe('claude_fallback');
    expect(result.rawText).toContain('claude');
    expect(result.fallbackReason).toMatch(/503/);
    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(1);
    expect(aiRouter.runClaudeWithDocument).toHaveBeenCalledTimes(1);
  });

  test('falls back to Claude on permanent (non-transient) Gemini errors too', async () => {
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('400 Invalid argument: missing parameter'));
    aiRouter.runClaudeWithDocument.mockResolvedValueOnce('{"zone":"X"}');

    const result = await callExtractionWithFallback(baseArgs);

    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('claude_fallback');
    expect(result.fallbackReason).toMatch(/Invalid argument/);
  });

  test('throws combined error when both Gemini and Claude fail', async () => {
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503 high demand'));
    aiRouter.runClaudeWithDocument.mockRejectedValueOnce(new Error('Claude API key invalid'));

    await expect(callExtractionWithFallback(baseArgs)).rejects.toThrow(/Gemini failed.*Claude fallback also failed/);
    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(1);
    expect(aiRouter.runClaudeWithDocument).toHaveBeenCalledTimes(1);
  });

  test('throws Gemini error when Claude is not configured', async () => {
    providerRegistry.getProviderAvailability.mockReturnValue({
      gemini: true, claude: false, gpt_compatible: false,
    });
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503 high demand'));

    await expect(callExtractionWithFallback(baseArgs)).rejects.toThrow(/503 high demand/);
    expect(aiRouter.runClaudeWithDocument).not.toHaveBeenCalled();
  });

  test('passes metadata.fallback_from through to Claude on the fallback path', async () => {
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503'));
    aiRouter.runClaudeWithDocument.mockResolvedValueOnce('{"ok":true}');

    await callExtractionWithFallback({ ...baseArgs, metadata: { prompt_kind: 'rmp_table' } });

    const claudeCall = aiRouter.runClaudeWithDocument.mock.calls[0][0];
    expect(claudeCall.metadata).toEqual(
      expect.objectContaining({ prompt_kind: 'rmp_table', fallback_from: 'gemini' }),
    );
  });
});

// ── The 'parseable' tier (spreadsheet / doc / deck / CSV / KML) ──────────────
//
// These files are transcribed to text upstream, so the fallback carries the
// transcript INSIDE the prompt and there is no base64 to attach. That routes it
// to runClaudeReasoning instead of runClaudeWithDocument — a leg the tests above
// never exercised, which is how it stayed broken from the day it was written:
//
//   • it passed `prompt`, but providerRegistry.runClaudeReasoning and
//     runOpenAIReasoning both read `payload`. The stray key was swallowed by the
//     router's passthrough and the SDK received `content: undefined` → 400,
//     every time. The leg could never succeed.
//   • it was gated on `claude` availability, but the router's
//     constrainReasoningRouting maps `document_extraction` (routed provider
//     'gemini') onto OPENAI — so it was admitted on the wrong key.
//   • it inherited the reasoning default of 700 max tokens, far too small for a
//     full extraction JSON.
describe('callExtractionWithFallback — parseable tier (text, no base64)', () => {
  const textArgs = {
    prompt: 'Transcribed sheet follows…\nExtract the rent roll as JSON.',
    base64Data: null,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    attach: { documentId: 'doc-2' },
  };

  beforeEach(() => {
    aiRouter.runGeminiInline.mockReset();
    aiRouter.runClaudeReasoning.mockReset();
    aiRouter.runClaudeWithDocument.mockReset();
    providerRegistry.getProviderAvailability.mockReturnValue({
      gemini: true, claude: false, gpt_compatible: true,
    });
  });

  test('sends the prompt as `payload` — the key the provider helpers actually read', async () => {
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503 high demand'));
    aiRouter.runClaudeReasoning.mockResolvedValueOnce('{"units":[]}');

    const result = await callExtractionWithFallback(textArgs);

    expect(result.provider).toBe('claude_fallback');
    const call = aiRouter.runClaudeReasoning.mock.calls[0][0];
    expect(call.payload).toBe(textArgs.prompt);
    // A `prompt` key here would be silently dropped — assert it is not how the
    // text is carried, so the bug cannot be reintroduced by a "tidy-up".
    expect(call.prompt).toBeUndefined();
    // Never route a text-tier extraction through the document API.
    expect(aiRouter.runClaudeWithDocument).not.toHaveBeenCalled();
  });

  test('raises the token budget above the 700-token reasoning default', async () => {
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503'));
    aiRouter.runClaudeReasoning.mockResolvedValueOnce('{"units":[]}');

    await callExtractionWithFallback(textArgs);

    expect(aiRouter.runClaudeReasoning.mock.calls[0][0].maxTokens).toBeGreaterThanOrEqual(4000);
  });

  test('runs on an OpenAI key alone — the router constrains this task to OpenAI', async () => {
    // claude:false, gpt_compatible:true. The pre-fix guard checked `claude` and
    // would have skipped the fallback entirely here, re-throwing the Gemini error.
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503'));
    aiRouter.runClaudeReasoning.mockResolvedValueOnce('{"ok":true}');

    await expect(callExtractionWithFallback(textArgs)).resolves.toMatchObject({
      provider: 'claude_fallback',
    });
    expect(aiRouter.runClaudeReasoning).toHaveBeenCalledTimes(1);
  });

  test('skips the fallback cleanly when neither reasoning provider is configured', async () => {
    providerRegistry.getProviderAvailability.mockReturnValue({
      gemini: true, claude: false, gpt_compatible: false,
    });
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('503 high demand'));

    await expect(callExtractionWithFallback(textArgs)).rejects.toThrow(/503 high demand/);
    expect(aiRouter.runClaudeReasoning).not.toHaveBeenCalled();
  });
});
