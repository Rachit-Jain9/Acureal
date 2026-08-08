'use strict';

// Verifies the Gemini client wiring in providerRegistry.
//
// Every assertion here is a regression guard for a defect that was live in
// production until 2026-08-08:
//
//   • NO generationConfig was ever passed, so extraction and classification
//     ran at Google's default temperature of 1.0 — i.e. they SAMPLED. The same
//     sale deed read twice could return a different owner name or a different
//     doc_type. This is the root cause of the "extracted data keeps changing"
//     reports.
//   • runGeminiInline returned a BARE STRING, so aiRouter.extractTokenUsage —
//     which already knew the Gemini `usageMetadata` shape — never saw it. All
//     2,570 logged Gemini calls carried NULL tokens and $0.00 cost, which also
//     left the per-org daily cost cap blind to the highest-volume provider.
//   • The SDK's `response.text()` throws one generic error for a safety block,
//     a prompt-level refusal, and a MAX_TOKENS truncation alike, so a document
//     cut off mid-JSON reached the reviewer as "JSON parse failed" — an error
//     that blames the parser for a token-budget problem.
//
// We mock @google/generative-ai at the require boundary so no network call fires.

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// Build a Gemini SDK response. `text: null` models the real SDK behaviour of
// throwing when no candidate carries text (safety block, empty completion).
const geminiResponse = ({
  text = '{"owner_name":"Ramesh Kumar"}',
  finishReason = 'STOP',
  usageMetadata = null,
  blockReason = null,
} = {}) => ({
  response: {
    text: () => {
      if (text === null) throw new Error('Cannot read properties of undefined');
      return text;
    },
    candidates: finishReason ? [{ finishReason }] : [],
    ...(blockReason ? { promptFeedback: { blockReason } } : {}),
    ...(usageMetadata ? { usageMetadata } : {}),
  },
});

const loadRegistry = () => require('../src/services/ai/providerRegistry');

beforeEach(() => {
  jest.resetModules();
  mockGenerateContent.mockReset();
  mockGetGenerativeModel.mockClear();
  process.env.GEMINI_API_KEY = 'test-gemini-key';
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe('providerRegistry.runGeminiInline — determinism', () => {
  test('pins temperature to 0 so a re-read of the same document cannot drift', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse());
    const { runGeminiInline } = loadRegistry();

    await runGeminiInline({ prompt: 'Extract the deed.', base64Data: 'YmFzZTY0', mimeType: 'application/pdf' });

    const { generationConfig } = mockGetGenerativeModel.mock.calls[0][0];
    // The whole point of the fix: extraction is a reading task with one
    // correct answer, so the sampler must be degenerate.
    expect(generationConfig.temperature).toBe(0);
    expect(generationConfig.topP).toBe(1);
    // Explicit, so a long multilingual reply cannot silently hit an implicit cap.
    expect(generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });

  test('a caller override rides ON TOP of the deterministic base', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse());
    const { runGeminiInline } = loadRegistry();

    await runGeminiInline({ prompt: 'Narrate.', generationConfig: { temperature: 0.4 } });

    const { generationConfig } = mockGetGenerativeModel.mock.calls[0][0];
    expect(generationConfig.temperature).toBe(0.4);
    // Un-overridden keys still come from the base — opting out of one setting
    // must not silently opt out of the token ceiling too.
    expect(generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });

  test('GEMINI_READING_CONFIG is exported so direct-SDK callers share one definition', () => {
    const { GEMINI_READING_CONFIG } = loadRegistry();
    expect(GEMINI_READING_CONFIG.temperature).toBe(0);
    // Frozen: a caller mutating the shared config would silently change the
    // sampling behaviour of every other Gemini path in the process.
    expect(Object.isFrozen(GEMINI_READING_CONFIG)).toBe(true);
  });
});

describe('providerRegistry.runGeminiInline — telemetry envelope', () => {
  test('returns { result, raw } so the router can lift usageMetadata', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse({
      text: '  {"ok":true}  ',
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 340, totalTokenCount: 1540 },
    }));
    const { runGeminiInline } = loadRegistry();

    const out = await runGeminiInline({ prompt: 'Extract.' });

    expect(out.result).toBe('{"ok":true}'); // trimmed, as before
    // aiRouter.extractTokenUsage reads exactly this shape. Returning a bare
    // string here is what zeroed Gemini cost reporting for 2,570 calls.
    expect(out.raw.usageMetadata.promptTokenCount).toBe(1200);
    expect(out.raw.usageMetadata.candidatesTokenCount).toBe(340);
  });

  test('omits the inlineData part when no document is attached', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse());
    const { runGeminiInline } = loadRegistry();

    await runGeminiInline({ prompt: 'Text only.' });

    const parts = mockGenerateContent.mock.calls[0][0];
    expect(parts).toEqual(['Text only.']);
  });
});

describe('providerRegistry.runGeminiInline — failure diagnosis', () => {
  test('MAX_TOKENS truncation throws instead of returning half a JSON body', async () => {
    // The real hazard: this text is a VALID prefix. Returned as-is it becomes a
    // 'partial' extraction whose missing fields look like fields the document
    // never had.
    mockGenerateContent.mockResolvedValueOnce(geminiResponse({
      text: '{"owner_name":"Ramesh Kumar","survey_nu',
      finishReason: 'MAX_TOKENS',
    }));
    const { runGeminiInline } = loadRegistry();

    await expect(runGeminiInline({ prompt: 'Extract.' }))
      .rejects.toThrow(/truncated .* output token limit/i);
  });

  test('a safety block names the reason instead of surfacing an SDK error', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse({ text: null, finishReason: 'SAFETY' }));
    const { runGeminiInline } = loadRegistry();

    await expect(runGeminiInline({ prompt: 'Extract.' }))
      .rejects.toThrow(/safety filters/i);
  });

  test('a prompt-level refusal is distinguished from an empty completion', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse({
      text: null,
      finishReason: null,
      blockReason: 'OTHER',
    }));
    const { runGeminiInline } = loadRegistry();

    await expect(runGeminiInline({ prompt: 'Extract.' }))
      .rejects.toThrow(/refused the request before generating .*OTHER/i);
  });

  test('an empty-but-unexplained reply still fails loudly', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse({ text: '   ', finishReason: 'STOP' }));
    const { runGeminiInline } = loadRegistry();

    await expect(runGeminiInline({ prompt: 'Extract.' }))
      .rejects.toThrow(/no usable text/i);
  });
});
