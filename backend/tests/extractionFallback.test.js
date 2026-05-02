'use strict';

// jest hoists vi.mock(...) calls; only variables prefixed with `mock` are
// allowed to be referenced from inside the factory.
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
const {
  callExtractionWithFallback,
  isTransientGeminiError,
} = require('../src/services/extraction.service');

const baseArgs = {
  prompt: 'Extract zoning regulations as JSON.',
  base64Data: 'YmFzZTY0',
  mimeType: 'application/pdf',
  attach: { documentId: 'doc-1' },
};

describe('isTransientGeminiError', () => {
  test.each([
    'Error fetching from https://generativelanguage.googleapis.com 503 Service Unavailable',
    '[GoogleGenerativeAI Error]: 429 Too Many Requests',
    'Gemini call timed out after 60000ms',
    'fetch failed',
    'high demand. Please try again later.',
    'RESOURCE_EXHAUSTED',
    'ECONNRESET',
  ])('treats %s as transient', (msg) => {
    expect(isTransientGeminiError(new Error(msg))).toBe(true);
  });

  test.each([
    'Invalid request: missing prompt',
    'Permission denied',
    '404 Not Found',
    'JSON parse failed: unexpected token',
  ])('treats %s as non-transient', (msg) => {
    expect(isTransientGeminiError(new Error(msg))).toBe(false);
  });
});

describe('callExtractionWithFallback', () => {
  beforeEach(() => {
    aiRouter.runGeminiInline.mockReset();
    aiRouter.runClaudeWithDocument.mockReset();
    providerRegistry.getProviderAvailability.mockReturnValue({
      gemini: true, claude: true, gpt_compatible: false,
    });
  });

  test('returns Gemini result on first success', async () => {
    aiRouter.runGeminiInline.mockResolvedValueOnce('{"zone":"R-PZ-A"}');

    const result = await callExtractionWithFallback(baseArgs);

    expect(result).toMatchObject({
      rawText: '{"zone":"R-PZ-A"}',
      provider: 'gemini',
      attempts: 1,
      fallbackReason: null,
    });
    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(1);
    expect(aiRouter.runClaudeWithDocument).not.toHaveBeenCalled();
  });

  test('retries Gemini on transient error and succeeds', async () => {
    aiRouter.runGeminiInline
      .mockRejectedValueOnce(new Error('503 Service Unavailable: high demand'))
      .mockResolvedValueOnce('{"zone":"R-PZ-B"}');

    const result = await callExtractionWithFallback(baseArgs);

    expect(result.provider).toBe('gemini');
    expect(result.attempts).toBe(2);
    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(2);
    expect(aiRouter.runClaudeWithDocument).not.toHaveBeenCalled();
  }, 10000);

  test('falls back to Claude after Gemini exhausts retries', async () => {
    aiRouter.runGeminiInline
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockRejectedValueOnce(new Error('503 Service Unavailable'));
    aiRouter.runClaudeWithDocument.mockResolvedValueOnce('{"zone":"R-PZ-A","fallback":"claude"}');

    const result = await callExtractionWithFallback(baseArgs);

    expect(result.provider).toBe('claude_fallback');
    expect(result.rawText).toContain('claude');
    expect(result.fallbackReason).toMatch(/503/);
    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(3);
    expect(aiRouter.runClaudeWithDocument).toHaveBeenCalledTimes(1);
  }, 15000);

  test('does not retry Gemini on non-transient errors but still tries Claude', async () => {
    aiRouter.runGeminiInline.mockRejectedValueOnce(new Error('400 Invalid argument: missing parameter'));
    aiRouter.runClaudeWithDocument.mockResolvedValueOnce('{"zone":"X"}');

    const result = await callExtractionWithFallback(baseArgs);

    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('claude_fallback');
    expect(result.fallbackReason).toMatch(/Invalid argument/);
  });

  test('throws combined error when both Gemini and Claude fail', async () => {
    aiRouter.runGeminiInline.mockRejectedValue(new Error('503 high demand'));
    aiRouter.runClaudeWithDocument.mockRejectedValueOnce(new Error('Claude API key invalid'));

    await expect(callExtractionWithFallback(baseArgs)).rejects.toThrow(/Gemini failed.*Claude fallback also failed/);
    expect(aiRouter.runGeminiInline).toHaveBeenCalledTimes(3);
  }, 15000);

  test('throws Gemini error when Claude is not configured', async () => {
    providerRegistry.getProviderAvailability.mockReturnValue({
      gemini: true, claude: false, gpt_compatible: false,
    });
    aiRouter.runGeminiInline.mockRejectedValue(new Error('503 high demand'));

    await expect(callExtractionWithFallback(baseArgs)).rejects.toThrow(/503 high demand/);
    expect(aiRouter.runClaudeWithDocument).not.toHaveBeenCalled();
  }, 15000);
});
