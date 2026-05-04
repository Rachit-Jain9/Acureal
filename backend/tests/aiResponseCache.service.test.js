jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query } = require('../src/config/database');
const cache = require('../src/services/ai/aiResponseCache');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aiResponseCache.buildCacheKey', () => {
  test('produces a stable hex sha256 for the same logical inputs', () => {
    const a = cache.buildCacheKey({
      task: 'document_extraction',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptSha256: 'abc',
      inputSha256: 'xyz',
    });
    const b = cache.buildCacheKey({
      task: 'document_extraction',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptSha256: 'abc',
      inputSha256: 'xyz',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test('different inputs produce different keys', () => {
    const a = cache.buildCacheKey({
      task: 'document_extraction',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptSha256: 'abc',
      inputSha256: 'xyz',
    });
    const b = cache.buildCacheKey({
      task: 'document_extraction',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptSha256: 'abc',
      // Same task / provider / model / prompt — different input → different key
      inputSha256: 'different',
    });
    expect(a).not.toBe(b);
  });

  test('throws when required fields missing', () => {
    expect(() => cache.buildCacheKey({})).toThrow();
    expect(() =>
      cache.buildCacheKey({ task: 't', provider: 'p', model: 'm' })
    ).toThrow();
  });
});

describe('aiResponseCache.hashInputMaterial', () => {
  test('hashes a deterministic ordered concatenation of the parts', () => {
    const a = cache.hashInputMaterial(['prompt', 'file-sha', 'application/pdf']);
    const b = cache.hashInputMaterial(['prompt', 'file-sha', 'application/pdf']);
    expect(a).toBe(b);
  });

  test('reordered parts produce a different hash', () => {
    const a = cache.hashInputMaterial(['prompt', 'file-sha']);
    const b = cache.hashInputMaterial(['file-sha', 'prompt']);
    expect(a).not.toBe(b);
  });

  test('throws on empty input', () => {
    expect(() => cache.hashInputMaterial([])).toThrow();
  });
});

describe('aiResponseCache.lookup', () => {
  test('returns null for missing key', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await cache.lookup({ cacheKey: 'k' });
    expect(result).toBeNull();
  });

  test('returns the row when found and not expired', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 5,
        response_jsonb: { extracted: { foo: 'bar' } },
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cost_usd_at_time: '0.000125',
        prompt_version: '2026-05-09.1',
        prompt_sha256: 'abc',
      }],
    });
    const hit = await cache.lookup({ cacheKey: 'k' });
    expect(hit.id).toBe(5);
    expect(hit.response_jsonb).toEqual({ extracted: { foo: 'bar' } });
    // The query must filter out expired rows.
    expect(query.mock.calls[0][0]).toMatch(/expires_at\s*>\s*NOW\(\)/i);
  });

  test('fail-open: returns null on database error', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const result = await cache.lookup({ cacheKey: 'k' });
    expect(result).toBeNull();
  });

  test('returns null without a DB call when cacheKey is missing', async () => {
    const result = await cache.lookup({ cacheKey: null });
    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('aiResponseCache.recordHit', () => {
  test('increments hit_count and updates last_hit_at', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await cache.recordHit(42);
    expect(query.mock.calls[0][0]).toMatch(/hit_count\s*=\s*hit_count\s*\+\s*1/i);
    expect(query.mock.calls[0][0]).toMatch(/last_hit_at\s*=\s*NOW\(\)/i);
    expect(query.mock.calls[0][1]).toEqual([42]);
  });

  test('no-ops when id is null', async () => {
    await cache.recordHit(null);
    expect(query).not.toHaveBeenCalled();
  });

  test('swallows errors so the call path keeps moving', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    await expect(cache.recordHit(1)).resolves.toBeUndefined();
  });
});

describe('aiResponseCache.store', () => {
  test('inserts a fresh row with all metadata, default 90d TTL', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const id = await cache.store({
      cacheKey: 'cache-key-1',
      task: 'document_extraction',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptVersion: '2026-05-09.1',
      promptSha256: 'phash',
      inputSha256: 'ihash',
      responseJson: { foo: 'bar' },
      tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      costUsd: 0.000125,
    });
    expect(id).toBe(7);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO public\.ai_response_cache/i);
    expect(sql).toMatch(/ON CONFLICT \(cache_key\) DO UPDATE/i);
    expect(sql).toMatch(/INTERVAL '90 days'/i);
    const params = query.mock.calls[0][1];
    expect(params[0]).toBe('cache-key-1');
    expect(params[1]).toBe('document_extraction');
    expect(params[2]).toBe('gemini');
    expect(params[3]).toBe('gemini-2.5-flash');
    expect(params[4]).toBe('2026-05-09.1');
    expect(params[5]).toBe('phash');
    expect(params[6]).toBe('ihash');
    expect(params[7]).toBe(JSON.stringify({ foo: 'bar' }));
    expect(params[12]).toBeNull(); // ttlSeconds (default branch)
  });

  test('honours an explicit ttlSeconds override', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 8 }] });
    await cache.store({
      cacheKey: 'k',
      task: 't',
      provider: 'gemini',
      model: 'm',
      inputSha256: 'i',
      responseJson: {},
      ttlSeconds: 600,
    });
    const params = query.mock.calls[0][1];
    expect(params[12]).toBe(600);
  });

  test('returns null silently on DB error (cache writes never throw)', async () => {
    query.mockRejectedValueOnce(new Error('write error'));
    const id = await cache.store({
      cacheKey: 'k',
      task: 't',
      provider: 'gemini',
      model: 'm',
      inputSha256: 'i',
      responseJson: {},
    });
    expect(id).toBeNull();
  });

  test('returns null without DB call when required args missing', async () => {
    const id = await cache.store({ cacheKey: 'only-key' });
    expect(id).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('aiResponseCache.purgeExpired', () => {
  test('deletes rows past their TTL and returns count', async () => {
    query.mockResolvedValueOnce({ rowCount: 12 });
    const n = await cache.purgeExpired();
    expect(n).toBe(12);
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM public\.ai_response_cache/i);
    expect(query.mock.calls[0][0]).toMatch(/expires_at\s*<\s*NOW\(\)/i);
  });

  test('returns 0 when nothing to delete', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    expect(await cache.purgeExpired()).toBe(0);
  });
});
