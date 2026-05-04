jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

const { query } = require('../src/config/database');
const svc = require('../src/services/ai/routingConfig');

beforeEach(() => {
  jest.clearAllMocks();
  // Cache lives at module scope; invalidate so each test starts clean.
  svc.invalidateCache();
});

describe('routingConfig.getRoutingForTask', () => {
  test('returns routing when task is configured', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { task: 'reasoning', provider: 'claude', model: null, fallback_provider: 'openai', fallback_model: null },
      ],
    });
    const out = await svc.getRoutingForTask('reasoning');
    expect(out.provider).toBe('claude');
    expect(out.fallbackProvider).toBe('openai');
  });

  test('returns null when task not in config', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const svc = require('../src/services/ai/routingConfig');
    expect(await svc.getRoutingForTask('not_a_task')).toBeNull();
  });

  test('fail-open on missing table — returns null without throwing', async () => {
    const err = new Error('relation "public.ai_routing_config" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const svc = require('../src/services/ai/routingConfig');
    expect(await svc.getRoutingForTask('reasoning')).toBeNull();
  });

  test('caches the read for subsequent calls (single DB hit)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ task: 'reasoning', provider: 'claude', model: null, fallback_provider: null, fallback_model: null }],
    });
    const svc = require('../src/services/ai/routingConfig');
    await svc.getRoutingForTask('reasoning');
    await svc.getRoutingForTask('reasoning');
    await svc.getRoutingForTask('reasoning');
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('invalidateCache forces a fresh DB read', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ task: 'reasoning', provider: 'claude', model: null, fallback_provider: null, fallback_model: null }] })
      .mockResolvedValueOnce({ rows: [{ task: 'reasoning', provider: 'openai', model: null, fallback_provider: null, fallback_model: null }] });
    const svc = require('../src/services/ai/routingConfig');
    const first = await svc.getRoutingForTask('reasoning');
    expect(first.provider).toBe('claude');
    svc.invalidateCache();
    const second = await svc.getRoutingForTask('reasoning');
    expect(second.provider).toBe('openai');
  });
});

describe('routingConfig.upsertRouting', () => {
  test('writes the row + invalidates cache', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ task: 'reasoning', provider: 'claude', model: null, fallback_provider: null, fallback_model: null }] })
      .mockResolvedValueOnce({ rows: [{ task: 'reasoning', provider: 'openai', model: 'gpt-4o', fallback_provider: 'claude', fallback_model: null, notes: null, last_changed_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ task: 'reasoning', provider: 'openai', model: 'gpt-4o', fallback_provider: 'claude', fallback_model: null }] });

    const svc = require('../src/services/ai/routingConfig');
    // Prime the cache with claude
    await svc.getRoutingForTask('reasoning');
    // Update to openai
    const updated = await svc.upsertRouting({
      task: 'reasoning',
      provider: 'openai',
      model: 'gpt-4o',
      fallbackProvider: 'claude',
      changedBy: 'user-1',
    });
    expect(updated.provider).toBe('openai');
    // Cache should have been invalidated → next read hits DB again
    const after = await svc.getRoutingForTask('reasoning');
    expect(after.provider).toBe('openai');
  });

  test('rejects missing task or provider', async () => {
    const svc = require('../src/services/ai/routingConfig');
    await expect(svc.upsertRouting({ task: '', provider: 'claude' })).rejects.toThrow(/task and provider/);
    await expect(svc.upsertRouting({ task: 'x', provider: '' })).rejects.toThrow(/task and provider/);
  });
});
