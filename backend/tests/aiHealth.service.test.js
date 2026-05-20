'use strict';

/**
 * PR-NX22 (2026-05-16) — Tests for aiHealth.service.js
 *
 * The service has two distinct surfaces:
 *   1. Pure helpers (classifyHealth, worstBand, computePercentile) —
 *      can be unit-tested in isolation, no DB needed.
 *   2. getHealthSnapshot() — hits ai_call_logs + providerRegistry. Tested
 *      with a stubbed query layer; we mock the DB rows.
 */

// Stub the database query function BEFORE requiring the service.
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const aiHealth = require('../src/services/aiHealth.service');
const { classifyHealth, worstBand, computePercentile, PROVIDERS } = aiHealth.__internal;

describe('aiHealth.service (PR-NX22)', () => {
  describe('classifyHealth — pure classifier', () => {
    test('unconfigured provider → unknown', () => {
      expect(classifyHealth({ configured: false, lastCall: null, last7d: { calls: 0 } })).toBe('unknown');
    });

    test('configured but no recent calls → unknown', () => {
      expect(classifyHealth({ configured: true, lastCall: null, last7d: { calls: 0, successRate: null } })).toBe('unknown');
    });

    test('configured + last success + 95% success rate → healthy', () => {
      expect(classifyHealth({
        configured: true,
        lastCall: { status: 'success' },
        last7d: { calls: 100, successRate: 0.95 },
      })).toBe('healthy');
    });

    test('configured + last success + missing success rate (zero calls) → healthy', () => {
      // Edge case: lastCall succeeded but 7d window has no calls (just bumped key)
      expect(classifyHealth({
        configured: true,
        lastCall: { status: 'success' },
        last7d: { calls: 0, successRate: null },
      })).toBe('healthy');
    });

    test('configured + last error + 30% success rate → unhealthy', () => {
      expect(classifyHealth({
        configured: true,
        lastCall: { status: 'error' },
        last7d: { calls: 50, successRate: 0.30 },
      })).toBe('unhealthy');
    });

    test('configured + last error + 80% success rate → degraded (transient blip on a working provider)', () => {
      expect(classifyHealth({
        configured: true,
        lastCall: { status: 'error' },
        last7d: { calls: 50, successRate: 0.80 },
      })).toBe('degraded');
    });

    test('configured + last success + 60% success rate → degraded (recent recovery)', () => {
      expect(classifyHealth({
        configured: true,
        lastCall: { status: 'success' },
        last7d: { calls: 50, successRate: 0.60 },
      })).toBe('degraded');
    });

    test('cache_hit as the last known call with no recent window → healthy', () => {
      // A cache_hit landing as the most-recent call must not flip a provider
      // to degraded just because it is not literally 'success'.
      expect(classifyHealth({
        configured: true,
        lastCall: { status: 'cache_hit' },
        last7d: { calls: 0, successRate: null },
      })).toBe('healthy');
    });
  });

  describe('worstBand — pick the most concerning band across providers', () => {
    test('all healthy → healthy', () => {
      expect(worstBand(['healthy', 'healthy', 'healthy'])).toBe('healthy');
    });
    test('one unhealthy beats two healthy → unhealthy', () => {
      expect(worstBand(['healthy', 'healthy', 'unhealthy'])).toBe('unhealthy');
    });
    test('degraded beats healthy → degraded', () => {
      expect(worstBand(['healthy', 'degraded'])).toBe('degraded');
    });
    test('unknown does not beat degraded', () => {
      expect(worstBand(['unknown', 'degraded'])).toBe('degraded');
    });
    test('unhealthy beats everything', () => {
      expect(worstBand(['healthy', 'degraded', 'unknown', 'unhealthy'])).toBe('unhealthy');
    });
  });

  describe('computePercentile — latency aggregation', () => {
    test('p50 of 1..100 ≈ 50', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      const p50 = computePercentile(sorted, 0.50);
      // floor(100 × 0.50) = 50, sorted[50] = 51
      expect(p50).toBe(51);
    });
    test('p95 of 1..100 ≈ 95', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(computePercentile(sorted, 0.95)).toBe(96);
    });
    test('empty array → null', () => {
      expect(computePercentile([], 0.50)).toBeNull();
    });
    test('null input → null', () => {
      expect(computePercentile(null, 0.50)).toBeNull();
    });
  });

  describe('PROVIDERS constant — 3 providers, correct env-var mapping', () => {
    test('exposes exactly 3 providers', () => {
      expect(PROVIDERS).toHaveLength(3);
    });
    test('each entry has provider, label, envVar', () => {
      PROVIDERS.forEach((p) => {
        expect(p.provider).toMatch(/^(gemini|claude|openai)$/);
        expect(typeof p.label).toBe('string');
        expect(p.envVar).toMatch(/_API_KEY$/);
      });
    });
  });

  describe('getHealthSnapshot — integration with stubbed DB', () => {
    beforeEach(() => {
      mockQuery.mockReset();
      // Stash env vars
      process.env.GEMINI_API_KEY = 'test-gemini';
      process.env.ANTHROPIC_API_KEY = 'test-claude';
      process.env.OPENAI_API_KEY = 'test-openai';
    });
    afterEach(() => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    test('returns 3 providers + overallBand + generatedAt', async () => {
      // Stub: every query returns empty
      mockQuery.mockResolvedValue({ rows: [{ calls: '0', success_count: '0', error_count: '0', cache_hit_count: '0', latencies: null }] });
      const snap = await aiHealth.getHealthSnapshot();
      expect(snap.providers).toHaveLength(3);
      expect(snap.providers.map((p) => p.provider).sort()).toEqual(['claude', 'gemini', 'openai']);
      expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(snap.overallBand);
      expect(snap.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('unconfigured provider returns healthBand=unknown + skips DB query', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      // Stub minimal DB rows for the 2 configured providers
      mockQuery.mockResolvedValue({ rows: [{ calls: '0', success_count: '0', error_count: '0', cache_hit_count: '0', latencies: null }] });
      const snap = await aiHealth.getHealthSnapshot();
      const claude = snap.providers.find((p) => p.provider === 'claude');
      expect(claude.configured).toBe(false);
      expect(claude.healthBand).toBe('unknown');
      expect(claude.lastCall).toBeNull();
      expect(claude.last7d.calls).toBe(0);
    });

    test('healthy provider with recent success + high success rate', async () => {
      // Mock implementation is parameter-aware: when called with provider='claude',
      // returns the healthy fixture; for any other provider, returns empty stats.
      // This avoids Promise.all ordering nondeterminism that breaks mockResolvedValueOnce.
      mockQuery.mockImplementation((sql, params) => {
        const provider = params?.[0];
        if (provider === 'claude') {
          if (sql.includes('LIMIT 1')) {
            // last-call query
            return Promise.resolve({ rows: [{
              status: 'success',
              created_at: '2026-05-16T14:30:00Z',
              latency_ms: 1842,
              task: 'narrative_synthesis',
              error_code: null,
              error_message: null,
            }] });
          }
          // 7-day aggregates query
          return Promise.resolve({ rows: [{
            calls: '100', success_count: '95', error_count: '3', cache_hit_count: '2',
            latencies: [800, 1200, 1500, 1800, 2100, 2500, 3200],
          }] });
        }
        // Other providers — empty
        if (sql.includes('LIMIT 1')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ calls: '0', success_count: '0', error_count: '0', cache_hit_count: '0', latencies: null }] });
      });

      const snap = await aiHealth.getHealthSnapshot();
      const claude = snap.providers.find((p) => p.provider === 'claude');
      expect(claude.configured).toBe(true);
      expect(claude.lastCall.status).toBe('success');
      expect(claude.lastCall.latencyMs).toBe(1842);
      expect(claude.last7d.calls).toBe(100);
      expect(claude.last7d.successCount).toBe(95);
      expect(claude.last7d.cacheHitCount).toBe(2);
      // successRate counts cache hits as success ((95 + 2) / 100 = 0.97)
      expect(claude.last7d.successRate).toBe(0.97);
      expect(claude.healthBand).toBe('healthy');
    });

    test('cost_capped calls are excluded from the success rate', async () => {
      mockQuery.mockImplementation((sql, params) => {
        const provider = params?.[0];
        if (provider === 'openai') {
          if (sql.includes('LIMIT 1')) {
            return Promise.resolve({ rows: [{
              status: 'success', created_at: '2026-05-20T00:00:00Z', latency_ms: 900,
              task: 'reasoning', error_code: null, error_message: null,
            }] });
          }
          return Promise.resolve({ rows: [{
            success_count: '8', error_count: '0', timeout_count: '0',
            cache_hit_count: '0', cost_capped_count: '50', latencies: [900],
          }] });
        }
        if (sql.includes('LIMIT 1')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{
          success_count: '0', error_count: '0', timeout_count: '0',
          cache_hit_count: '0', cost_capped_count: '0', latencies: null,
        }] });
      });
      const snap = await aiHealth.getHealthSnapshot();
      const openai = snap.providers.find((p) => p.provider === 'openai');
      // 50 cost-capped calls must NOT drag the rate down — 8 / 8 = 1.0.
      expect(openai.last7d.calls).toBe(8);
      expect(openai.last7d.costCappedCount).toBe(50);
      expect(openai.last7d.successRate).toBe(1);
      expect(openai.healthBand).toBe('healthy');
    });

    test('timeout calls count as failures in the success rate', async () => {
      mockQuery.mockImplementation((sql, params) => {
        const provider = params?.[0];
        if (provider === 'gemini') {
          if (sql.includes('LIMIT 1')) {
            return Promise.resolve({ rows: [{
              status: 'timeout', created_at: '2026-05-20T00:00:00Z', latency_ms: 30000,
              task: 'document_extraction', error_code: 'ETIMEDOUT', error_message: 'timed out',
            }] });
          }
          return Promise.resolve({ rows: [{
            success_count: '5', error_count: '0', timeout_count: '5',
            cache_hit_count: '0', cost_capped_count: '0', latencies: [1000, 1000, 1000, 1000, 1000],
          }] });
        }
        if (sql.includes('LIMIT 1')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{
          success_count: '0', error_count: '0', timeout_count: '0',
          cache_hit_count: '0', cost_capped_count: '0', latencies: null,
        }] });
      });
      const snap = await aiHealth.getHealthSnapshot();
      const gemini = snap.providers.find((p) => p.provider === 'gemini');
      expect(gemini.last7d.calls).toBe(10);
      expect(gemini.last7d.timeoutCount).toBe(5);
      expect(gemini.last7d.successRate).toBe(0.5);
      expect(gemini.healthBand).toBe('degraded');
    });

    test('soft-fails when ai_call_logs query throws (RLS / missing table)', async () => {
      mockQuery.mockRejectedValue(new Error('relation "ai_call_logs" does not exist'));
      const snap = await aiHealth.getHealthSnapshot();
      // Service must NOT throw; returns null-data shape
      expect(snap.providers).toHaveLength(3);
      snap.providers.forEach((p) => {
        expect(p.configured).toBe(true);
        expect(p.lastCall).toBeNull();
        expect(p.last7d.calls).toBe(0);
        expect(p.healthBand).toBe('unknown');
      });
    });
  });
});
