jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

const { withRetry, isRetriableProviderError, computeDelay } = require('../src/services/ai/aiRetry');

describe('isRetriableProviderError', () => {
  test('retries on 5xx', () => {
    expect(isRetriableProviderError({ status: 500 })).toBe(true);
    expect(isRetriableProviderError({ status: 502 })).toBe(true);
    expect(isRetriableProviderError({ status: 503 })).toBe(true);
    expect(isRetriableProviderError({ statusCode: 504 })).toBe(true);
  });

  test('retries on 429 (rate-limited)', () => {
    expect(isRetriableProviderError({ status: 429 })).toBe(true);
  });

  test('does NOT retry on other 4xx', () => {
    expect(isRetriableProviderError({ status: 400 })).toBe(false);
    expect(isRetriableProviderError({ status: 401 })).toBe(false);
    expect(isRetriableProviderError({ status: 403 })).toBe(false);
    expect(isRetriableProviderError({ status: 404 })).toBe(false);
    expect(isRetriableProviderError({ status: 422 })).toBe(false);
  });

  test('retries on network-level codes', () => {
    expect(isRetriableProviderError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetriableProviderError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetriableProviderError({ code: 'ENOTFOUND' })).toBe(true);
    expect(isRetriableProviderError({ code: 'EAI_AGAIN' })).toBe(true);
    // Lowercase still works
    expect(isRetriableProviderError({ code: 'econnreset' })).toBe(true);
  });

  test('retries on TimeoutError name', () => {
    const err = new Error('boom');
    err.name = 'TimeoutError';
    expect(isRetriableProviderError(err)).toBe(true);
  });

  test('does NOT retry on AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isRetriableProviderError(err)).toBe(false);
  });

  test('does NOT retry on unknown shape', () => {
    expect(isRetriableProviderError(null)).toBe(false);
    expect(isRetriableProviderError(undefined)).toBe(false);
    expect(isRetriableProviderError({ message: 'something weird' })).toBe(false);
  });

  test('reads response.status when present', () => {
    expect(isRetriableProviderError({ response: { status: 500 } })).toBe(true);
    expect(isRetriableProviderError({ response: { status: 401 } })).toBe(false);
  });

  // Message-string fallback: covers SDK-wrapped errors where the structured
  // props are lost. This is the path that catches Gemini's transient throws
  // when they bubble up through several layers of wrapping.
  describe('message-string fallback', () => {
    test.each([
      'Error fetching from https://generativelanguage.googleapis.com 503 Service Unavailable',
      '[GoogleGenerativeAI Error]: 429 Too Many Requests',
      'Gemini call timed out after 60000ms',
      'fetch failed',
      'high demand. Please try again later.',
      'RESOURCE_EXHAUSTED',
      'UNAVAILABLE',
      'Service unavailable',
      'ECONNRESET while reading response',
    ])('treats %s as transient', (msg) => {
      expect(isRetriableProviderError(new Error(msg))).toBe(true);
    });

    test.each([
      'Invalid request: missing prompt',
      'Permission denied',
      '404 Not Found',
      '400 Invalid argument: missing parameter',
      'Authentication failed',
      'Unauthorized',
      'JSON parse failed: unexpected token',
    ])('treats %s as non-transient', (msg) => {
      expect(isRetriableProviderError(new Error(msg))).toBe(false);
    });
  });
});

describe('computeDelay', () => {
  test('grows exponentially up to maxMs', () => {
    const a = computeDelay({ attempt: 1, baseMs: 100, maxMs: 10000, jitter: 0 });
    const b = computeDelay({ attempt: 2, baseMs: 100, maxMs: 10000, jitter: 0 });
    const c = computeDelay({ attempt: 3, baseMs: 100, maxMs: 10000, jitter: 0 });
    expect(a).toBe(100);
    expect(b).toBe(200);
    expect(c).toBe(400);
  });

  test('caps at maxMs', () => {
    const d = computeDelay({ attempt: 10, baseMs: 100, maxMs: 1000, jitter: 0 });
    expect(d).toBe(1000);
  });

  test('jitter stays within ± ratio of base', () => {
    for (let i = 0; i < 50; i += 1) {
      const d = computeDelay({ attempt: 2, baseMs: 1000, maxMs: 10000, jitter: 0.25 });
      // base * 2 = 2000; ±25% → [1500, 2500]
      expect(d).toBeGreaterThanOrEqual(1500);
      expect(d).toBeLessThanOrEqual(2500);
    }
  });
});

describe('withRetry', () => {
  test('returns immediately when fn succeeds first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3, baseMs: 1, maxMs: 1, jitter: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on transient error and recovers', async () => {
    const transient = Object.assign(new Error('502'), { status: 502 });
    const fn = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('recovered');
    const result = await withRetry(fn, { attempts: 3, baseMs: 1, maxMs: 1, jitter: 0 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('does NOT retry on non-retriable error', async () => {
    const auth = Object.assign(new Error('401'), { status: 401 });
    const fn = jest.fn().mockRejectedValue(auth);
    await expect(
      withRetry(fn, { attempts: 5, baseMs: 1, maxMs: 1, jitter: 0 }),
    ).rejects.toBe(auth);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('throws the last error after exhausting retries', async () => {
    const transient = Object.assign(new Error('500'), { status: 500 });
    const fn = jest.fn().mockRejectedValue(transient);
    await expect(
      withRetry(fn, { attempts: 3, baseMs: 1, maxMs: 1, jitter: 0 }),
    ).rejects.toBe(transient);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('passes attempt number into fn', async () => {
    const seen = [];
    const fn = jest.fn(async ({ attempt }) => {
      seen.push(attempt);
      if (attempt < 3) throw Object.assign(new Error('500'), { status: 500 });
      return attempt;
    });
    const out = await withRetry(fn, { attempts: 3, baseMs: 1, maxMs: 1, jitter: 0 });
    expect(out).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  test('honors a custom isRetriable classifier', async () => {
    const err = new Error('weird');
    const fn = jest.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, {
      attempts: 3,
      baseMs: 1,
      maxMs: 1,
      jitter: 0,
      isRetriable: (e) => e.message === 'weird',
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('invokes onRetry hook with err/attempt/delayMs', async () => {
    const transient = Object.assign(new Error('500'), { status: 500 });
    const fn = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('ok');
    const onRetry = jest.fn();
    await withRetry(fn, {
      attempts: 2,
      baseMs: 1,
      maxMs: 1,
      jitter: 0,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    const call = onRetry.mock.calls[0][0];
    expect(call.err).toBe(transient);
    expect(call.attempt).toBe(1);
    expect(typeof call.delayMs).toBe('number');
  });

  test('a throwing onRetry hook does not abort the loop', async () => {
    const transient = Object.assign(new Error('500'), { status: 500 });
    const fn = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, {
      attempts: 2,
      baseMs: 1,
      maxMs: 1,
      jitter: 0,
      onRetry: () => {
        throw new Error('hook crashed');
      },
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
