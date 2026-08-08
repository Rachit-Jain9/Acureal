import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateCompsDependents, COMPS_DEPENDENT_KEYS } from '../compsQueries';

/**
 * A comp write must refresh the surfaces that READ comps, not just the comps
 * table. Before this helper, verifying a comp invalidated exactly `['comps']`,
 * so the Financials sell-rate warning kept comparing against the old band, the
 * deal's Comps tab kept showing the old ranked set, and the IC-readiness comps
 * bucket kept counting the old evidence. The user's own action appeared to do
 * nothing on the screens it exists to change.
 */
function makeMockQc() {
  const calls = [];
  return { invalidateQueries: vi.fn((args) => calls.push(args)), _calls: calls };
}

describe('invalidateCompsDependents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates every comp-dependent surface, not just the comps table', () => {
    const qc = makeMockQc();
    invalidateCompsDependents(qc);
    const keys = qc._calls.map((c) => c.queryKey[0]);
    for (const key of COMPS_DEPENDENT_KEYS) expect(keys).toContain(key);
  });

  // The two workspace keys are SIBLINGS, not a prefix pair — invalidating
  // 'deal-workspace' does not reach 'deal-workspace-lite', and the deal page
  // paints from the lite one first.
  it('covers deal-workspace AND deal-workspace-lite separately', () => {
    const qc = makeMockQc();
    invalidateCompsDependents(qc);
    const keys = qc._calls.map((c) => c.queryKey[0]);
    expect(keys).toContain('deal-workspace');
    expect(keys).toContain('deal-workspace-lite');
  });

  /**
   * The assertion that fails on master. A comp is not deal-scoped — which
   * deals it affects is a geographic question the client cannot answer — so
   * the helper invalidates by PREFIX and must reach an existing
   * ['benchmark-bands', dealId] entry.
   */
  it('reaches a real, already-cached per-deal benchmark entry', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ['benchmark-bands', 'deal-abc'];
    qc.setQueryData(key, { bands: { p25: 1, p95: 2 } });
    expect(qc.getQueryState(key).isInvalidated).toBe(false);

    invalidateCompsDependents(qc);

    expect(qc.getQueryState(key).isInvalidated).toBe(true);
    qc.clear();
  });

  it('reaches a cached deal-workspace-lite entry for a specific deal', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ['deal-workspace-lite', 'deal-abc'];
    qc.setQueryData(key, { deal: { id: 'deal-abc' } });

    invalidateCompsDependents(qc);

    expect(qc.getQueryState(key).isInvalidated).toBe(true);
    qc.clear();
  });

  it('leaves unrelated caches alone', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unrelated = ['documents', 'deal-abc'];
    qc.setQueryData(unrelated, [{ id: 'doc-1' }]);

    invalidateCompsDependents(qc);

    expect(qc.getQueryState(unrelated).isInvalidated).toBe(false);
    qc.clear();
  });
});
