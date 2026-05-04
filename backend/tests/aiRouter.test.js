'use strict';

const { estimateCost, resolveProviderForTask, resolveDefaultModel, extractTokenUsage } = require('../src/services/ai/aiRouter');

describe('services/ai/aiRouter', () => {
  describe('estimateCost', () => {
    test('returns null when token counts are missing', () => {
      expect(estimateCost({ provider: 'gemini', model: 'gemini-2.5-flash' })).toBeNull();
    });

    test('returns null for unknown provider/model', () => {
      expect(
        estimateCost({ provider: 'no-such', model: 'no-such', promptTokens: 100, completionTokens: 100 })
      ).toBeNull();
    });

    test('computes a finite cost for a well-known model', () => {
      const cost = estimateCost({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptTokens: 100_000,
        completionTokens: 10_000,
      });
      // input @ 0.075/M + output @ 0.30/M → 0.0075 + 0.003 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 4);
    });

    test('honors AI_COST_OVERRIDES_JSON when valid', () => {
      process.env.AI_COST_OVERRIDES_JSON = JSON.stringify({
        'custom:model-x': { input: 1.0, output: 2.0 },
      });
      const cost = estimateCost({
        provider: 'custom',
        model: 'model-x',
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
      });
      expect(cost).toBe(3.0);
      delete process.env.AI_COST_OVERRIDES_JSON;
    });

    test('returns null gracefully on bad override JSON', () => {
      process.env.AI_COST_OVERRIDES_JSON = '{not json';
      // No throw. With bad JSON the table falls back to defaults; an unknown
      // model still returns null, demonstrating fail-safe behavior.
      expect(
        estimateCost({ provider: 'custom', model: 'model-x', promptTokens: 1, completionTokens: 1 })
      ).toBeNull();
      delete process.env.AI_COST_OVERRIDES_JSON;
    });
  });

  describe('extractTokenUsage', () => {
    test('parses Gemini-shape usageMetadata', () => {
      const tokens = extractTokenUsage({
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 75, totalTokenCount: 125 },
      });
      expect(tokens).toEqual({ promptTokens: 50, completionTokens: 75, totalTokens: 125 });
    });

    test('parses Anthropic-shape usage', () => {
      const tokens = extractTokenUsage({
        usage: { input_tokens: 30, output_tokens: 70 },
      });
      expect(tokens).toEqual({ promptTokens: 30, completionTokens: 70, totalTokens: 100 });
    });

    test('returns nulls for unknown shape', () => {
      const tokens = extractTokenUsage('plain string');
      expect(tokens).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
    });

    test('Anthropic shape WITHOUT cache fields stays 3-key', () => {
      const tokens = extractTokenUsage({
        usage: { input_tokens: 30, output_tokens: 70 },
      });
      // Cache keys must be absent (not null) so existing consumers see the
      // canonical shape unchanged.
      expect(tokens).toEqual({ promptTokens: 30, completionTokens: 70, totalTokens: 100 });
      expect(tokens).not.toHaveProperty('cacheCreationTokens');
      expect(tokens).not.toHaveProperty('cacheReadTokens');
    });

    test('Anthropic shape WITH cache_creation surfaces cacheCreationTokens', () => {
      const tokens = extractTokenUsage({
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_creation_input_tokens: 1500,
          cache_read_input_tokens: 0,
        },
      });
      expect(tokens.promptTokens).toBe(100);
      expect(tokens.completionTokens).toBe(200);
      // Total includes cache_creation tokens (those are real input tokens billed
      // at 1.25× the base input rate for the write call).
      expect(tokens.totalTokens).toBe(100 + 200 + 1500);
      expect(tokens.cacheCreationTokens).toBe(1500);
      expect(tokens.cacheReadTokens).toBe(0);
    });

    test('Anthropic shape WITH cache_read surfaces cacheReadTokens', () => {
      const tokens = extractTokenUsage({
        usage: {
          input_tokens: 50,
          output_tokens: 150,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1500,
        },
      });
      // The cache-read scenario: 90% discount on the cached portion. Token
      // count is still the same; the cost-table uses cacheReadTokens to
      // apply the discount when costs land in `ai_call_logs.metadata`.
      expect(tokens.cacheReadTokens).toBe(1500);
      expect(tokens.totalTokens).toBe(50 + 150 + 1500);
    });
  });

  describe('routing config helpers', () => {
    test('resolveProviderForTask falls back to gemini for unknown task', () => {
      expect(resolveProviderForTask('not_a_real_task')).toBe('gemini');
    });

    test('resolveProviderForTask reads env override', () => {
      process.env.AI_PROVIDER_REASONING = 'gemini';
      // The provider registry caches its first read so we re-require to pick
      // up the override when a test is the first reader.
      jest.resetModules();
      const { resolveProviderForTask: r } = require('../src/services/ai/aiRouter');
      expect(r('reasoning')).toBe('gemini');
      delete process.env.AI_PROVIDER_REASONING;
      jest.resetModules();
    });

    test('resolveDefaultModel returns sensible defaults', () => {
      expect(resolveDefaultModel('gemini')).toMatch(/gemini/);
      expect(resolveDefaultModel('claude')).toMatch(/claude/);
      expect(resolveDefaultModel('openai')).toMatch(/gpt/);
      expect(resolveDefaultModel('unknown')).toBe('unknown');
    });
  });
});
