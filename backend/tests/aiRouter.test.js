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
