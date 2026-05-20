'use strict';

/**
 * Regression test for PR-NX89.
 *
 * runAI passes the whole providerRegistry module to a task's run() callback
 * as `providers`. exportNarrative.service.js and aiMarketContext.service.js
 * call `providers.getGeminiClient()` / `providers.getOpenAIClient()` — those
 * getters must be on the export surface, or the Gemini / OpenAI cascade legs
 * throw "<provider> client unavailable" on every call.
 */

describe('providerRegistry — raw client getters are exported', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('getGeminiClient / getAnthropicClient / getOpenAIClient are exported functions', () => {
    const registry = require('../src/services/ai/providerRegistry');
    expect(typeof registry.getGeminiClient).toBe('function');
    expect(typeof registry.getAnthropicClient).toBe('function');
    expect(typeof registry.getOpenAIClient).toBe('function');
  });

  test('getGeminiClient returns a client when GEMINI_API_KEY is configured', () => {
    process.env.GEMINI_API_KEY = 'AIzaTestKeyValueForUnitTest';
    const registry = require('../src/services/ai/providerRegistry');
    expect(registry.getGeminiClient()).toBeTruthy();
  });

  test('getOpenAIClient returns a client when OPENAI_API_KEY is configured', () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai-key-value';
    const registry = require('../src/services/ai/providerRegistry');
    expect(registry.getOpenAIClient()).toBeTruthy();
  });

  test('getAnthropicClient throws a clear error when ANTHROPIC_API_KEY is absent', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = require('../src/services/ai/providerRegistry');
    expect(() => registry.getAnthropicClient()).toThrow(/not configured/i);
  });
});
