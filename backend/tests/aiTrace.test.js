jest.mock('../src/lib/requestContext', () => ({
  getRequestContext: jest.fn(() => ({ requestId: 'req-abc-123', userId: 'u-1', organizationId: 'o-1' })),
}));

const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

const { withAiSpan, normaliseTraceId, newSpanId, OTEL_ENABLED } = require('../src/lib/aiTrace');
const { getRequestContext } = require('../src/lib/requestContext');

beforeEach(() => {
  consoleLogSpy.mockClear();
  getRequestContext.mockReturnValue({ requestId: 'req-abc-123', userId: 'u-1', organizationId: 'o-1' });
});

afterAll(() => {
  consoleLogSpy.mockRestore();
});

describe('aiTrace.normaliseTraceId', () => {
  test('strips dashes, pads to 32 hex chars', () => {
    const out = normaliseTraceId('abcd1234-ef56-7890-abcd-ef1234567890');
    expect(out).toMatch(/^[a-f0-9]{32}$/);
  });

  test('truncates over-long input', () => {
    const out = normaliseTraceId('a'.repeat(64));
    expect(out).toHaveLength(32);
  });

  test('generates random when input is empty', () => {
    const out = normaliseTraceId('');
    expect(out).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('aiTrace.newSpanId', () => {
  test('produces 16-char hex id', () => {
    expect(newSpanId()).toMatch(/^[a-f0-9]{16}$/);
  });

  test('values are unique across calls', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i += 1) seen.add(newSpanId());
    expect(seen.size).toBe(100);
  });
});

describe('aiTrace.withAiSpan', () => {
  const findEvent = (name) =>
    consoleLogSpy.mock.calls
      .map((c) => {
        try { return JSON.parse(c[0]); } catch { return null; }
      })
      .filter(Boolean)
      .find((p) => p.event === `ai.${name}`);

  test('emits span.start and span.end on success', async () => {
    const result = await withAiSpan(
      { name: 'reasoning', attributes: { task: 'reasoning', provider: 'claude' } },
      async () => 42,
    );
    expect(result).toBe(42);
    const start = findEvent('span.start');
    const end = findEvent('span.end');
    expect(start).toBeTruthy();
    expect(start.span_name).toBe('reasoning');
    expect(start.task).toBe('reasoning');
    expect(end.status).toBe('ok');
    expect(typeof end.duration_ms).toBe('number');
  });

  test('emits span.end with status=error on failure', async () => {
    const boom = new Error('upstream down');
    boom.code = 'ECONNRESET';
    await expect(
      withAiSpan({ name: 'reasoning', attributes: {} }, async () => { throw boom; }),
    ).rejects.toThrow('upstream down');
    const end = findEvent('span.end');
    expect(end.status).toBe('error');
    expect(end.error_code).toBe('ECONNRESET');
    expect(end.error_message).toBe('upstream down');
  });

  test('span.setAttribute attaches to the end event', async () => {
    await withAiSpan(
      { name: 'reasoning', attributes: {} },
      async (span) => {
        span.setAttribute('attempts', 2);
        span.setAttribute('cache_hit', false);
      },
    );
    const end = findEvent('span.end');
    expect(end.attempts).toBe(2);
    expect(end.cache_hit).toBe(false);
  });

  test('uses request_id from requestContext as trace_id', async () => {
    await withAiSpan({ name: 'reasoning', attributes: {} }, async () => null);
    const end = findEvent('span.end');
    // 'req-abc-123' has 9 hex chars after stripping dashes; padded to 32
    expect(end.trace_id).toMatch(/^[a-f0-9]{32}$/);
  });

  test('flag-disabled mode does not emit anything', async () => {
    jest.resetModules();
    process.env.AI_TRACE_ENABLED = '0';
    const { withAiSpan: w } = require('../src/lib/aiTrace');
    consoleLogSpy.mockClear();
    await w({ name: 'reasoning', attributes: {} }, async () => 'x');
    expect(consoleLogSpy).not.toHaveBeenCalled();
    delete process.env.AI_TRACE_ENABLED;
  });
});
