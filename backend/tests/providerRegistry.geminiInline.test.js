'use strict';

// Regression guard for the 2026-07-09 Gemini text-only fix: runGeminiInline
// used to append an unconditional `{ inlineData: { data: undefined,
// mimeType: undefined } }` part, which Google rejects with
// `400 Unsupported MIME type:` for every text-only caller (recommendation
// narration). The document part must only be sent when a document is
// actually attached.

const mockGenerateContent = jest.fn().mockResolvedValue({
  response: { text: () => '  {"ok":true}  ' },
});
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

describe('providerRegistry.runGeminiInline content parts', () => {
  let providerRegistry;
  const priorKey = process.env.GEMINI_API_KEY;

  beforeAll(() => {
    process.env.GEMINI_API_KEY = 'test-key-for-inline-parts';
    jest.resetModules();
    providerRegistry = require('../src/services/ai/providerRegistry');
  });

  afterAll(() => {
    if (priorKey !== undefined) process.env.GEMINI_API_KEY = priorKey;
    else delete process.env.GEMINI_API_KEY;
  });

  beforeEach(() => {
    mockGenerateContent.mockClear();
    mockGetGenerativeModel.mockClear();
  });

  test('text-only calls send a single prompt part — no empty inlineData', async () => {
    const out = await providerRegistry.runGeminiInline({ prompt: 'narrate this card' });
    // Envelope since 2026-08-08 — the bare string it used to return meant
    // aiRouter.extractTokenUsage never saw Gemini's `usageMetadata`, so every
    // Gemini call logged NULL tokens and $0 cost. See gemini.provider.test.js.
    expect(out.result).toBe('{"ok":true}');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const parts = mockGenerateContent.mock.calls[0][0];
    expect(parts).toEqual(['narrate this card']);
  });

  test('document calls still attach the inlineData part with its MIME type', async () => {
    await providerRegistry.runGeminiInline({
      prompt: 'extract fields',
      base64Data: 'aGVsbG8=',
      mimeType: 'application/pdf',
    });
    const parts = mockGenerateContent.mock.calls[0][0];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('extract fields');
    expect(parts[1]).toEqual({ inlineData: { data: 'aGVsbG8=', mimeType: 'application/pdf' } });
  });

  test('text-only calls use the registry default model (env override preserved)', async () => {
    await providerRegistry.runGeminiInline({ prompt: 'x' });
    // Asserted on the model KEY only: the same call now also carries the
    // deterministic generationConfig, which is this test's neighbour's job to
    // pin (gemini.provider.test.js). An exact-object match here would couple
    // the model-resolution guard to the sampling policy.
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: providerRegistry.DEFAULT_GEMINI_MODEL }),
    );
  });
});
