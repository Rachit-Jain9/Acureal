'use strict';

// Verifies the OpenAI client wiring in providerRegistry.
//   • runOpenAIReasoning returns { result, raw } envelope (matches Anthropic)
//   • Translates OpenAI's prompt_tokens/completion_tokens → input_tokens/output_tokens
//     so aiRouter.extractTokenUsage works without provider branching
//   • runOpenAIEmbedding returns { result: number[][], dimensions, raw }
//
// We mock the openai SDK at the require boundary so no network call fires.

const mockChatCreate = jest.fn();
const mockEmbeddingsCreate = jest.fn();

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

beforeEach(() => {
  jest.resetModules();
  mockChatCreate.mockReset();
  mockEmbeddingsCreate.mockReset();
  process.env.OPENAI_API_KEY = 'sk-test-key';
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe('providerRegistry.runOpenAIReasoning', () => {
  test('returns { result, raw } envelope with normalized usage', async () => {
    mockChatCreate.mockResolvedValueOnce({
      id: 'chatcmpl-x',
      choices: [{ message: { content: 'reasoned answer' } }],
      usage: { prompt_tokens: 30, completion_tokens: 70, total_tokens: 100 },
    });
    const { runOpenAIReasoning } = require('../src/services/ai/providerRegistry');

    const out = await runOpenAIReasoning({
      systemPrompt: 'You are an analyst.',
      payload: { hello: 'world' },
    });

    expect(out.result).toBe('reasoned answer');
    // Translated to Anthropic-shape so router's extractTokenUsage finds it.
    expect(out.raw.usage.input_tokens).toBe(30);
    expect(out.raw.usage.output_tokens).toBe(70);

    const call = mockChatCreate.mock.calls[0][0];
    expect(call.messages[0]).toEqual({ role: 'system', content: 'You are an analyst.' });
    expect(call.messages[1].role).toBe('user');
  });

  test('skips system message when systemPrompt is empty', async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const { runOpenAIReasoning } = require('../src/services/ai/providerRegistry');

    await runOpenAIReasoning({ payload: 'hi' });

    const call = mockChatCreate.mock.calls[0][0];
    expect(call.messages.length).toBe(1);
    expect(call.messages[0].role).toBe('user');
  });

  test('returns null result when content is missing', async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: {} }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    });
    const { runOpenAIReasoning } = require('../src/services/ai/providerRegistry');

    const out = await runOpenAIReasoning({ systemPrompt: 's', payload: 'p' });
    expect(out.result).toBeNull();
  });
});

describe('providerRegistry.runOpenAIEmbedding', () => {
  test('returns embedding vector with dimensions + normalized usage', async () => {
    mockEmbeddingsCreate.mockResolvedValueOnce({
      data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
      usage: { prompt_tokens: 12, total_tokens: 12 },
    });
    const { runOpenAIEmbedding } = require('../src/services/ai/providerRegistry');

    const out = await runOpenAIEmbedding({ input: 'hello world' });

    expect(out.result).toEqual([[0.1, 0.2, 0.3, 0.4]]);
    expect(out.dimensions).toBe(4);
    expect(out.raw.usage.input_tokens).toBe(12);
    expect(out.raw.usage.output_tokens).toBe(0);
  });

  test('preserves order for batch input', async () => {
    mockEmbeddingsCreate.mockResolvedValueOnce({
      data: [
        { embedding: [1, 0] },
        { embedding: [0, 1] },
      ],
      usage: { prompt_tokens: 8 },
    });
    const { runOpenAIEmbedding } = require('../src/services/ai/providerRegistry');

    const out = await runOpenAIEmbedding({ input: ['a', 'b'] });
    expect(out.result).toEqual([[1, 0], [0, 1]]);
  });

  test('throws on empty input', async () => {
    const { runOpenAIEmbedding } = require('../src/services/ai/providerRegistry');
    await expect(runOpenAIEmbedding({ input: '' })).rejects.toThrow(/non-empty/);
    await expect(runOpenAIEmbedding({ input: [] })).rejects.toThrow(/non-empty/);
  });

  test('passes optional dimensions to API when provided', async () => {
    mockEmbeddingsCreate.mockResolvedValueOnce({
      data: [{ embedding: new Array(512).fill(0) }],
      usage: { prompt_tokens: 5 },
    });
    const { runOpenAIEmbedding } = require('../src/services/ai/providerRegistry');

    await runOpenAIEmbedding({ input: 'x', dimensions: 512 });

    const call = mockEmbeddingsCreate.mock.calls[0][0];
    expect(call.dimensions).toBe(512);
  });
});

describe('providerRegistry.getProviderAvailability', () => {
  test('marks gpt_compatible true when OPENAI_API_KEY is configured', () => {
    process.env.OPENAI_API_KEY = 'sk-real-key';
    const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
    expect(getProviderAvailability().gpt_compatible).toBe(true);
  });

  test('marks gpt_compatible false when OPENAI_API_KEY is a placeholder', () => {
    process.env.OPENAI_API_KEY = 'your-openai-key-here';
    const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
    expect(getProviderAvailability().gpt_compatible).toBe(false);
  });
});
