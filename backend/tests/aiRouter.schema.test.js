'use strict';

// Verifies the Zod-validated structured-output helpers in aiRouter:
//   • stripJsonFences strips ```json ... ``` wrappers Gemini/Claude often add
//   • tryParseAndValidate returns { ok, value } | { ok: false, reason, issues }
//   • runAIWithSchema reprompts ONCE on parse/validation failure
//   • StructuredOutputError carries rawText + issues + callId for diagnostics

const { z } = require('zod');

const {
  stripJsonFences,
  tryParseAndValidate,
  runAIWithSchema,
  StructuredOutputError,
} = require('../src/services/ai/aiRouter');

// Mock runAI through a partial mock — we don't want full call-log/cost-cap
// behaviour for this unit test. Instead, mock the file's runAI export.
jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'mock-call-id' }] }),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

jest.mock('../src/lib/costGuard', () => ({
  assertWithinDailyCap: jest.fn().mockResolvedValue(undefined),
  CostCapExceededError: class extends Error {},
}));

jest.mock('../src/lib/requestContext', () => ({
  getRequestContext: () => ({ userId: null, organizationId: null, requestId: null }),
}));

jest.mock('../src/services/ai/aiResponseCache', () => ({
  buildCacheKey: jest.fn(),
  lookup: jest.fn().mockResolvedValue(null),
  store: jest.fn().mockResolvedValue(undefined),
  recordHit: jest.fn(),
  hashInputMaterial: jest.fn(() => 'mock-input-sha'),
}));

describe('stripJsonFences', () => {
  test('strips ```json fence wrapper', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  test('strips bare ``` fence wrapper', () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  test('passes through unwrapped JSON', () => {
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
  });
  test('handles non-string gracefully', () => {
    expect(stripJsonFences(null)).toBeNull();
    expect(stripJsonFences(undefined)).toBeUndefined();
  });
});

describe('tryParseAndValidate', () => {
  const schema = z.object({ doc_type: z.string(), confidence: z.number().min(0).max(1) });

  test('valid JSON + valid schema → { ok: true }', () => {
    const result = tryParseAndValidate('{"doc_type":"sale_deed","confidence":0.92}', schema);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ doc_type: 'sale_deed', confidence: 0.92 });
  });

  test('strips fences before parsing', () => {
    const result = tryParseAndValidate('```json\n{"doc_type":"sale_deed","confidence":0.5}\n```', schema);
    expect(result.ok).toBe(true);
  });

  test('malformed JSON → { ok: false } with parse reason', () => {
    const result = tryParseAndValidate('{not json', schema);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/JSON parse failed/);
  });

  test('valid JSON but missing required field → ok:false with issues', () => {
    const result = tryParseAndValidate('{"doc_type":"sale_deed"}', schema);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/confidence/);
    expect(Array.isArray(result.issues)).toBe(true);
  });

  test('out-of-range value → ok:false', () => {
    const result = tryParseAndValidate('{"doc_type":"sale_deed","confidence":2.5}', schema);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/confidence/);
  });
});

describe('StructuredOutputError', () => {
  test('carries rawText, issues, callId', () => {
    const err = new StructuredOutputError('boom', {
      rawText: '{bad}',
      issues: [{ path: ['x'], message: 'required' }],
      callId: 'call-123',
    });
    expect(err.code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(err.rawText).toBe('{bad}');
    expect(err.callId).toBe('call-123');
    expect(err.issues[0].message).toBe('required');
  });
});

describe('runAIWithSchema', () => {
  // Use a permissive schema — focus is on the reprompt flow, not zod itself.
  const schema = z.object({ value: z.number() });

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  test('first-try success returns parsed value, recovered=false', async () => {
    const run = jest.fn().mockResolvedValue('{"value": 42}');
    const out = await runAIWithSchema({
      task: 'test_validate',
      schema,
      run,
      retry: { enabled: false },
    });
    expect(out.result).toEqual({ value: 42 });
    expect(out.recovered).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('reprompt after parse failure, then success → recovered=true', async () => {
    const run = jest.fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce('{"value": 7}');
    const out = await runAIWithSchema({
      task: 'test_validate',
      schema,
      run,
      retry: { enabled: false },
    });
    expect(out.result).toEqual({ value: 7 });
    expect(out.recovered).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('terminal failure throws StructuredOutputError', async () => {
    const run = jest.fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('still not json');
    await expect(
      runAIWithSchema({
        task: 'test_validate',
        schema,
        run,
        retry: { enabled: false },
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  test('repromptOnFailure=false throws on first invalid response', async () => {
    const run = jest.fn().mockResolvedValueOnce('not json');
    await expect(
      runAIWithSchema({
        task: 'test_validate',
        schema,
        run,
        repromptOnFailure: false,
        retry: { enabled: false },
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('rejects when schema is not a Zod schema', async () => {
    await expect(
      runAIWithSchema({ task: 'x', schema: {}, run: () => Promise.resolve('') }),
    ).rejects.toThrow(/must be a Zod schema/);
  });
});
