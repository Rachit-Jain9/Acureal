'use strict';

const { estimateCost, isModelPriced, resolveProviderForTask, resolveDefaultModel, extractTokenUsage } = require('../src/services/ai/aiRouter');

describe('services/ai/aiRouter', () => {
  describe('estimateCost', () => {
    test('returns null when token counts are missing', () => {
      expect(estimateCost({ provider: 'gemini', model: 'gemini-2.5-flash' })).toBeNull();
    });

    test('prices an UNKNOWN model at the conservative fallback so it still counts toward the cap', () => {
      // Fail-safe: a model missing from the table must NOT log cost=null (which
      // contributes 0 to the daily cap), it's estimated at the Opus-tier fallback
      // (input $15/M, output $75/M). 100k in + 100k out → 1.5 + 7.5 = 9.0.
      const cost = estimateCost({ provider: 'no-such', model: 'no-such', promptTokens: 100_000, completionTokens: 100_000 });
      expect(cost).toBe(9.0);
      expect(cost).not.toBeNull();
    });

    test('prices the current default models at their verified rates', () => {
      // Opus 4.8 = $5/$25, Sonnet 4.6 = $3/$15, Haiku 4.5 = $1/$5 (per MTok).
      expect(estimateCost({ provider: 'claude', model: 'claude-opus-4-8', promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(30.0);
      expect(estimateCost({ provider: 'claude', model: 'claude-sonnet-4-6', promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(18.0);
      expect(estimateCost({ provider: 'claude', model: 'claude-haiku-4-5', promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(6.0);
    });

    test('computes a finite cost for a well-known model', () => {
      const cost = estimateCost({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptTokens: 100_000,
        completionTokens: 10_000,
      });
      // input @ 0.30/M + output @ 2.50/M → 0.03 + 0.025 = 0.055
      expect(cost).toBeCloseTo(0.055, 4);
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

    test('does not throw on bad override JSON; unknown model still priced at fallback', () => {
      process.env.AI_COST_OVERRIDES_JSON = '{not json';
      // No throw. With bad JSON the table falls back to defaults; an unknown
      // model is priced at the conservative fallback (not null) so its spend
      // still counts toward the cap — fail-safe.
      const cost = estimateCost({ provider: 'custom', model: 'model-x', promptTokens: 1_000_000, completionTokens: 1_000_000 });
      expect(cost).toBe(90.0); // 15 + 75 fallback
      delete process.env.AI_COST_OVERRIDES_JSON;
    });
  });

  describe('isModelPriced (cost-leak guard)', () => {
    test('true for a model in the default cost table', () => {
      expect(isModelPriced('gemini', 'gemini-2.5-flash')).toBe(true);
    });

    test('false for an unknown provider:model — flags the row cost_unpriced (estimated at fallback)', () => {
      // No longer "escapes the cap" — estimateCost prices unknowns at the
      // fallback so they count; isModelPriced=false just marks the row as an
      // estimate rather than a real list price.
      expect(isModelPriced('acme', 'turbo-9')).toBe(false);
    });

    test('false when provider or model is missing', () => {
      expect(isModelPriced(null, 'x')).toBe(false);
      expect(isModelPriced('x', undefined)).toBe(false);
    });

    test('a model priced via AI_COST_OVERRIDES_JSON becomes known', () => {
      expect(isModelPriced('newprov', 'newmodel')).toBe(false);
      process.env.AI_COST_OVERRIDES_JSON = JSON.stringify({ 'newprov:newmodel': { input: 1, output: 2 } });
      expect(isModelPriced('newprov', 'newmodel')).toBe(true);
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

    test('gemini default follows providerRegistry — the retired preview must never come back', () => {
      // July 2026 outage regression guard: a duplicate literal here kept
      // shipping gemini-3-flash-preview after Google retired it (1.5k error
      // rows). The router must delegate to the registry's single source.
      const prior = process.env.GEMINI_MODEL;
      delete process.env.GEMINI_MODEL;
      try {
        const registry = require('../src/services/ai/providerRegistry');
        expect(resolveDefaultModel('gemini')).toBe(registry.DEFAULT_GEMINI_MODEL);
        expect(resolveDefaultModel('gemini')).not.toBe('gemini-3-flash-preview');
      } finally {
        if (prior !== undefined) process.env.GEMINI_MODEL = prior;
      }
    });
  });

  describe('constrainReasoningRouting', () => {
    const { constrainReasoningRouting } = require('../src/services/ai/aiRouter');

    test('honours explicit claude routing with its model', () => {
      expect(constrainReasoningRouting({ provider: 'claude', model: 'claude-sonnet-4-6' }))
        .toEqual({ provider: 'claude', model: 'claude-sonnet-4-6' });
    });

    test('honours openai routing with its model', () => {
      expect(constrainReasoningRouting({ provider: 'openai', model: 'gpt-4o' }))
        .toEqual({ provider: 'openai', model: 'gpt-4o' });
    });

    test('gemini-routed tasks constrain to openai and NEVER forward the gemini model', () => {
      // The misroute behind the July 2026 export-insights failures: the
      // reasoning wrapper handed a Gemini model name to the Claude SDK.
      const out = constrainReasoningRouting({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
      expect(out.provider).toBe('openai');
      expect(out.model).toBeNull();
    });

    test('unrouted/unknown providers constrain to openai with no model', () => {
      expect(constrainReasoningRouting({})).toEqual({ provider: 'openai', model: null });
      expect(constrainReasoningRouting({ provider: 'bogus' })).toEqual({ provider: 'openai', model: null });
    });

    test('an explicit caller model always wins over routed models', () => {
      expect(constrainReasoningRouting({ provider: 'gemini', model: 'gemini-x' }, 'gpt-4o-mini'))
        .toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    });
  });
});
