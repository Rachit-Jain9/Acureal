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
