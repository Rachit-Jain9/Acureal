'use strict';

/**
 * Cross-provider failover (2026-07-31).
 *
 * The admin Routing page has offered `fallbackProvider` / `fallbackModel`
 * since it shipped, and `resolveTaskRouting` faithfully returned them — to
 * nobody. No consumer existed. When a primary provider broke, the affected
 * features simply stopped while the configured fallback sat unused: the July
 * 2026 outage was a week of export-insights and narration failures with a
 * working fallback in ai_routing_config the whole time.
 *
 * These tests pin the contract that makes failover safe rather than clever:
 *   • it engages on NON-retriable primary failure (July was a model-404);
 *   • it never engages when unconfigured, self-referential, or pointed at a
 *     provider the wrapper cannot execute;
 *   • the ledger stays honest: the primary's failure row is written even when
 *     the fallback rescues the call, and the success row carries the
 *     fallback's provider + `failed_over_from` — never the primary's name on
 *     the fallback's tokens.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(async () => ({ rows: [{ id: 'log-row' }] })) }));
jest.mock('../src/services/ai/providerRegistry', () => ({
  runOpenAIReasoning: jest.fn(),
  runClaudeReasoning: jest.fn(),
  getRoutingConfig: jest.fn(() => ({})),
  DEFAULT_GEMINI_MODEL: 'gemini-2.5-flash',
}));
jest.mock('../src/services/ai/routingConfig', () => ({ getRoutingForTask: jest.fn() }));
jest.mock('../src/services/ai/aiResponseCache', () => ({
  buildCacheKey: jest.fn(() => 'cache-key'),
  lookup: jest.fn(async () => null),
  recordHit: jest.fn(),
  store: jest.fn(async () => {}),
  hashInputMaterial: jest.fn(() => 'sha'),
}));
jest.mock('../src/lib/costGuard', () => ({
  assertWithinDailyCap: jest.fn(async () => {}),
  CostCapExceededError: class CostCapExceededError extends Error {},
}));

const { query } = require('../src/config/database');
const providerRegistry = require('../src/services/ai/providerRegistry');
const routingConfigService = require('../src/services/ai/routingConfig');
const {
  runClaudeReasoning,
  reasoningFailoverPlan,
} = require('../src/services/ai/aiRouter');

// A non-retriable provider failure — the aiRetry classifier must not retry it,
// which is exactly the July shape (Anthropic 404 on a retired model name).
const hardFailure = () => {
  const err = new Error('model not found');
  err.status = 404;
  return err;
};

// Column order pinned by persistCallLog's INSERT: provider=$4, status=$6,
// metadata=$18 (0-indexed: 3, 5, 17).
const callLogInserts = () =>
  query.mock.calls
    .filter(([sql]) => /INSERT INTO ai_call_logs/i.test(sql))
    .map(([, params]) => ({ provider: params[3], status: params[5], metadata: JSON.parse(params[17] || '{}') }));

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [{ id: 'log-row' }] });
});

describe('reasoningFailoverPlan — eligibility', () => {
  test('a configured claude fallback behind an openai primary is eligible', () => {
    expect(reasoningFailoverPlan({ fallbackProvider: 'claude', fallbackModel: 'claude-sonnet-4-6' }, 'openai'))
      .toEqual({ provider: 'claude', model: 'claude-sonnet-4-6' });
  });

  test('a fallback the wrapper cannot execute is ignored, not remapped', () => {
    // Remapping gemini→openai would run a provider the operator did not name.
    expect(reasoningFailoverPlan({ fallbackProvider: 'gemini' }, 'openai')).toBeNull();
  });

  test('a self-referential fallback is dropped — retry already covers same-provider transience', () => {
    expect(reasoningFailoverPlan({ fallbackProvider: 'openai' }, 'openai')).toBeNull();
  });

  test('no configuration, no failover', () => {
    expect(reasoningFailoverPlan({}, 'openai')).toBeNull();
    expect(reasoningFailoverPlan(null, 'openai')).toBeNull();
  });
});

describe('runClaudeReasoning — failover in flight', () => {
  test('primary hard-fails → the configured fallback answers, and the ledger shows both', async () => {
    routingConfigService.getRoutingForTask.mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      fallbackProvider: 'claude',
      fallbackModel: 'claude-sonnet-4-6',
    });
    providerRegistry.runOpenAIReasoning.mockRejectedValue(hardFailure());
    providerRegistry.runClaudeReasoning.mockResolvedValue('fallback answer');

    const result = await runClaudeReasoning({
      task: 'export_insights',
      systemPrompt: 's',
      payload: 'p',
      retry: { enabled: false },
    });

    expect(result).toBe('fallback answer');
    expect(providerRegistry.runOpenAIReasoning).toHaveBeenCalledTimes(1);
    expect(providerRegistry.runClaudeReasoning).toHaveBeenCalledTimes(1);
    // The fallback runs ITS configured model — a model name must never cross
    // a provider boundary (that leak was the July root cause).
    expect(providerRegistry.runClaudeReasoning.mock.calls[0][0].model).toBe('claude-sonnet-4-6');

    const rows = callLogInserts();
    expect(rows).toHaveLength(2);
    // Row 1: the primary's failure — visible even though the call succeeded.
    expect(rows[0].provider).toBe('openai');
    expect(rows[0].status).toBe('error');
    expect(rows[0].metadata.failing_over_to).toBe('claude');
    // Row 2: the fallback's success, attributed to the fallback.
    expect(rows[1].provider).toBe('claude');
    expect(rows[1].status).toBe('success');
    expect(rows[1].metadata.failed_over_from).toBe('openai');
  });

  test('both providers fail → the caller gets the FALLBACK error and two failure rows exist', async () => {
    routingConfigService.getRoutingForTask.mockResolvedValue({
      provider: 'openai',
      fallbackProvider: 'claude',
    });
    providerRegistry.runOpenAIReasoning.mockRejectedValue(hardFailure());
    providerRegistry.runClaudeReasoning.mockRejectedValue(new Error('claude also down'));

    await expect(
      runClaudeReasoning({ task: 'export_insights', systemPrompt: 's', payload: 'p', retry: { enabled: false } }),
    ).rejects.toThrow('claude also down');

    const rows = callLogInserts();
    expect(rows.map((r) => [r.provider, r.status])).toEqual([
      ['openai', 'error'],
      ['claude', 'error'],
    ]);
  });

  test('no fallback configured → single failure, no second provider touched', async () => {
    routingConfigService.getRoutingForTask.mockResolvedValue({ provider: 'openai' });
    providerRegistry.runOpenAIReasoning.mockRejectedValue(hardFailure());

    await expect(
      runClaudeReasoning({ task: 'reasoning', systemPrompt: 's', payload: 'p', retry: { enabled: false } }),
    ).rejects.toThrow('model not found');

    expect(providerRegistry.runClaudeReasoning).not.toHaveBeenCalled();
    expect(callLogInserts()).toHaveLength(1);
  });

  test('primary succeeds → the fallback is never invoked and no failover metadata appears', async () => {
    routingConfigService.getRoutingForTask.mockResolvedValue({
      provider: 'openai',
      fallbackProvider: 'claude',
    });
    providerRegistry.runOpenAIReasoning.mockResolvedValue('primary answer');

    const result = await runClaudeReasoning({
      task: 'reasoning', systemPrompt: 's', payload: 'p', retry: { enabled: false },
    });

    expect(result).toBe('primary answer');
    expect(providerRegistry.runClaudeReasoning).not.toHaveBeenCalled();
    const rows = callLogInserts();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.failed_over_from).toBeUndefined();
  });
});
