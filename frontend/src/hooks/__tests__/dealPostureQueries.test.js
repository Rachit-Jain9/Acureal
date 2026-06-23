import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invalidateDealPosture,
  invalidatePortfolioRollups,
  POSTURE_KEYS_FOR_DEAL,
  PORTFOLIO_ROLLUP_KEYS,
} from '../dealPostureQueries';

// Mock QueryClient that just records every invalidateQueries call.
function makeMockQc() {
  const calls = [];
  return {
    invalidateQueries: vi.fn((args) => {
      calls.push(args);
    }),
    _calls: calls,
  };
}

const flatKeys = (calls) => calls.map((c) => c.queryKey);

describe('invalidateDealPosture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates every per-deal posture key + the portfolio rollups', () => {
    const qc = makeMockQc();
    invalidateDealPosture(qc, 'deal-123');
    const keys = flatKeys(qc._calls);

    // Every per-deal key appears with the dealId.
    for (const k of POSTURE_KEYS_FOR_DEAL) {
      expect(keys).toContainEqual([k, 'deal-123']);
    }
    // Every portfolio rollup key appears with no dealId.
    for (const k of PORTFOLIO_ROLLUP_KEYS) {
      expect(keys).toContainEqual([k]);
    }
    // Exact total — guards against accidental duplicates.
    expect(qc._calls).toHaveLength(POSTURE_KEYS_FOR_DEAL.length + PORTFOLIO_ROLLUP_KEYS.length);
  });

  it('with a falsy dealId, invalidates only the portfolio rollups', () => {
    const qc = makeMockQc();
    invalidateDealPosture(qc, null);
    expect(qc._calls).toHaveLength(PORTFOLIO_ROLLUP_KEYS.length);
    for (const k of PORTFOLIO_ROLLUP_KEYS) {
      expect(flatKeys(qc._calls)).toContainEqual([k]);
    }
  });

  it('keeps the per-deal and portfolio key sets disjoint', () => {
    // A deal-id-bearing key in the portfolio set would silently double-invalidate.
    const perDeal = new Set(POSTURE_KEYS_FOR_DEAL);
    for (const k of PORTFOLIO_ROLLUP_KEYS) {
      expect(perDeal.has(k)).toBe(false);
    }
  });
});

describe('invalidatePortfolioRollups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates every portfolio rollup key and nothing else', () => {
    const qc = makeMockQc();
    invalidatePortfolioRollups(qc);
    expect(qc._calls).toHaveLength(PORTFOLIO_ROLLUP_KEYS.length);
    for (const k of PORTFOLIO_ROLLUP_KEYS) {
      expect(flatKeys(qc._calls)).toContainEqual([k]);
    }
  });
});

describe('canonical key set', () => {
  // These keys are the contract between the mutation hooks and the query
  // hooks. Changing any of them is a coordinated rename across the
  // codebase, not a local edit.
  it('per-deal keys match the canonical query-hook keys', () => {
    expect(POSTURE_KEYS_FOR_DEAL).toEqual([
      'risk-radar',
      'risk-flags',
      'risk-score',
      'dd-items',
      'dd-score',
      'approvals',
      'signoffs',
      'deal-workspace',
    ]);
  });

  it('portfolio rollup keys match the dashboard surfaces', () => {
    expect(PORTFOLIO_ROLLUP_KEYS).toEqual([
      'portfolio-risk-radar',
      'dashboard',
      'dashboard-attention',
      'portfolio-readiness',
    ]);
  });
});
