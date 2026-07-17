jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const crypto = require('crypto');
const { query, transaction } = require('../src/config/database');
const cache = require('../src/services/dealWorkspaceCache.service');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DEAL_WORKSPACE_CACHE_ENABLED;
  delete process.env.DEAL_WORKSPACE_CACHE_TTL_MS;
});

describe('dealWorkspaceCache.computeVersionKey', () => {
  test('hashes the DB fingerprint into a sha1 hex key', async () => {
    query.mockResolvedValueOnce({ rows: [{ vk: '2:2026-01-01|0:-' }] });
    const key = await cache.computeVersionKey('deal-1');
    expect(key).toBe(sha1('2:2026-01-01|0:-'));
    expect(key).toMatch(/^[a-f0-9]{40}$/);
  });

  test('queries every per-deal input table plus the deal row', async () => {
    query.mockResolvedValueOnce({ rows: [{ vk: 'x' }] });
    await cache.computeVersionKey('deal-1');
    const sql = query.mock.calls[0][0];
    for (const t of cache.VERSIONED_DEAL_TABLES) {
      expect(sql).toContain(`FROM ${t} WHERE deal_id = $1`);
    }
    expect(sql).toContain('FROM deals WHERE id = $1');
    expect(query.mock.calls[0][1]).toEqual(['deal-1']);
  });

  test('different fingerprints yield different keys; identical yield identical', async () => {
    query.mockResolvedValueOnce({ rows: [{ vk: 'a' }] });
    const a1 = await cache.computeVersionKey('d');
    query.mockResolvedValueOnce({ rows: [{ vk: 'a' }] });
    const a2 = await cache.computeVersionKey('d');
    query.mockResolvedValueOnce({ rows: [{ vk: 'b' }] });
    const b = await cache.computeVersionKey('d');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  test('returns null when the query throws (e.g. table absent)', async () => {
    query.mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await cache.computeVersionKey('deal-1')).toBeNull();
  });

  test('returns null when disabled or id missing', async () => {
    process.env.DEAL_WORKSPACE_CACHE_ENABLED = 'false';
    expect(await cache.computeVersionKey('deal-1')).toBeNull();
    delete process.env.DEAL_WORKSPACE_CACHE_ENABLED;
    expect(await cache.computeVersionKey('')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('dealWorkspaceCache.read', () => {
  test('returns the payload for a fresh row within TTL', async () => {
    const payload = { deal: { id: 'd' }, recommendations: { recommendations: [] } };
    query.mockResolvedValueOnce({
      rows: [{ payload, computed_at: new Date().toISOString() }],
    });
    expect(await cache.read('d', 'vk')).toEqual(payload);
  });

  test('returns null when the row is older than the TTL', async () => {
    process.env.DEAL_WORKSPACE_CACHE_TTL_MS = '1000'; // 1s
    const old = new Date(Date.now() - 5000).toISOString(); // 5s ago
    query.mockResolvedValueOnce({ rows: [{ payload: { a: 1 }, computed_at: old }] });
    expect(await cache.read('d', 'vk')).toBeNull();
  });

  test('returns null when there is no cached row', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await cache.read('d', 'vk')).toBeNull();
  });

  test('returns null (cache miss) when the query throws', async () => {
    query.mockRejectedValueOnce(new Error('relation "deal_workspace_cache" does not exist'));
    expect(await cache.read('d', 'vk')).toBeNull();
  });

  test('returns null without querying when disabled or args missing', async () => {
    process.env.DEAL_WORKSPACE_CACHE_ENABLED = 'false';
    expect(await cache.read('d', 'vk')).toBeNull();
    delete process.env.DEAL_WORKSPACE_CACHE_ENABLED;
    expect(await cache.read('d', null)).toBeNull();
    expect(await cache.read(null, 'vk')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('dealWorkspaceCache.write', () => {
  // The write runs inside transaction() (not query()) so its SET LOCAL bounds
  // land on the SAME connection as the INSERT. Drive the real callback.
  const runTransaction = () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    transaction.mockImplementationOnce(async (cb) => cb(client));
    return client;
  };
  const sqlOf = (client) => client.query.mock.calls.map(([s]) => String(s));

  test('upserts via INSERT ... ON CONFLICT with org from current_organization_id()', async () => {
    const client = runTransaction();
    const payload = { deal: { id: 'd' } };
    await cache.write('d', 'vk', payload);

    const insert = client.query.mock.calls.find(([s]) => /INSERT INTO deal_workspace_cache/.test(String(s)));
    expect(insert).toBeTruthy();
    const [sql, params] = insert;
    expect(sql).toContain('current_organization_id()');
    expect(sql).toContain('ON CONFLICT (deal_id, organization_id)');
    expect(params[0]).toBe('d');
    expect(params[1]).toBe('vk');
    expect(params[2]).toBe(JSON.stringify(payload));
  });

  // The production failure: an orphaned transaction from a frozen Vercel
  // instance held this row's per-ORG lock, and the next reader's upsert was
  // cancelled by the 2-minute statement_timeout. An OPTIONAL write must fail
  // fast rather than queue — it must never become the thing that blocks a
  // teammate.
  test('bounds itself with SET LOCAL lock_timeout + statement_timeout', async () => {
    const client = runTransaction();
    await cache.write('d', 'vk', { a: 1 });
    const sql = sqlOf(client).join('\n');
    expect(sql).toMatch(/SET LOCAL lock_timeout/i);
    expect(sql).toMatch(/SET LOCAL statement_timeout/i);
  });

  test('the bounds are set BEFORE the insert (else they do not apply to it)', async () => {
    const client = runTransaction();
    await cache.write('d', 'vk', { a: 1 });
    const sql = sqlOf(client);
    const lastBound = Math.max(
      sql.findIndex((s) => /SET LOCAL lock_timeout/i.test(s)),
      sql.findIndex((s) => /SET LOCAL statement_timeout/i.test(s)),
    );
    const insertAt = sql.findIndex((s) => /INSERT INTO deal_workspace_cache/.test(s));
    expect(lastBound).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(lastBound);
  });

  test('SET LOCAL — not plain SET (the pooler runs in transaction mode)', async () => {
    const client = runTransaction();
    await cache.write('d', 'vk', { a: 1 });
    for (const s of sqlOf(client).filter((x) => /timeout/i.test(x))) {
      expect(s).toMatch(/SET LOCAL/i);
    }
  });

  test('never throws when the write fails — the response is never affected', async () => {
    transaction.mockRejectedValueOnce(new Error('write failed'));
    await expect(cache.write('d', 'vk', { a: 1 })).resolves.toBeUndefined();
  });

  test('a lock timeout is swallowed and logged, not propagated', async () => {
    const err = new Error('canceling statement due to lock timeout');
    err.code = '55P03';
    transaction.mockRejectedValueOnce(err);
    await expect(cache.write('d', 'vk', { a: 1 })).resolves.toBeUndefined();
  });

  test('no-op when disabled or args missing', async () => {
    process.env.DEAL_WORKSPACE_CACHE_ENABLED = 'false';
    await cache.write('d', 'vk', { a: 1 });
    delete process.env.DEAL_WORKSPACE_CACHE_ENABLED;
    await cache.write('d', 'vk', null);
    await cache.write('d', null, { a: 1 });
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
