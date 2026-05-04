'use strict';

// Verifies the prompt-caching wire-up in providerRegistry. The provider's
// system field must:
//   • be a plain string when cachePrompt is false (existing behaviour)
//   • be a content-block array with `cache_control: ephemeral` when true
// And the function must return `{ result, raw }` so the router can extract
// usage including cache_creation/cache_read tokens.
//
// We mock the Anthropic SDK at the require boundary so no network call fires.

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

beforeEach(() => {
  jest.resetModules();
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('providerRegistry.runClaudeReasoning prompt caching', () => {
  test('default (no cachePrompt) sends system as plain string', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { runClaudeReasoning } = require('../src/services/ai/providerRegistry');

    const out = await runClaudeReasoning({
      systemPrompt: 'You are an analyst.',
      payload: { hello: 'world' },
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toBe('You are an analyst.');
    expect(out.result).toBe('ok');
    expect(out.raw.usage.input_tokens).toBe(10);
  });

  test('cachePrompt: true wraps system in cache_control block', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'cached!' }],
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        cache_creation_input_tokens: 1500,
        cache_read_input_tokens: 0,
      },
    });
    const { runClaudeReasoning } = require('../src/services/ai/providerRegistry');

    const out = await runClaudeReasoning({
      systemPrompt: 'Stable system prefix.',
      payload: { x: 1 },
      cachePrompt: true,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0]).toEqual({
      type: 'text',
      text: 'Stable system prefix.',
      cache_control: { type: 'ephemeral' },
    });
    expect(out.result).toBe('cached!');
    expect(out.raw.usage.cache_creation_input_tokens).toBe(1500);
  });

  test('returns null result when content has no text block', async () => {
    mockCreate.mockResolvedValueOnce({ content: [], usage: { input_tokens: 5, output_tokens: 0 } });
    const { runClaudeReasoning } = require('../src/services/ai/providerRegistry');

    const out = await runClaudeReasoning({
      systemPrompt: 'sys',
      payload: 'p',
    });

    expect(out.result).toBeNull();
  });
});

describe('providerRegistry.runClaudeWithDocument prompt caching', () => {
  const baseArgs = {
    systemPrompt: 'You extract structured JSON.',
    prompt: 'Extract fields',
    base64Data: 'YmFzZTY0',
    mimeType: 'application/pdf',
  };

  test('default (no cachePrompt) sends system as plain string', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 100, output_tokens: 5 },
    });
    const { runClaudeWithDocument } = require('../src/services/ai/providerRegistry');

    await runClaudeWithDocument(baseArgs);

    const call = mockCreate.mock.calls[0][0];
    expect(typeof call.system).toBe('string');
  });

  test('cachePrompt: true wraps system in cache_control block', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{}' }],
      usage: {
        input_tokens: 100,
        output_tokens: 5,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 0,
      },
    });
    const { runClaudeWithDocument } = require('../src/services/ai/providerRegistry');

    const out = await runClaudeWithDocument({ ...baseArgs, cachePrompt: true });

    const call = mockCreate.mock.calls[0][0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(out.result).toBe('{}');
    expect(out.raw.usage.cache_creation_input_tokens).toBe(2000);
  });

  test('throws on missing base64Data', async () => {
    const { runClaudeWithDocument } = require('../src/services/ai/providerRegistry');
    await expect(
      runClaudeWithDocument({ ...baseArgs, base64Data: null }),
    ).rejects.toThrow(/requires base64Data/);
  });

  test('throws on unsupported mime type', async () => {
    const { runClaudeWithDocument } = require('../src/services/ai/providerRegistry');
    await expect(
      runClaudeWithDocument({ ...baseArgs, mimeType: 'application/zip' }),
    ).rejects.toThrow(/only supports PDF or image/);
  });
});
