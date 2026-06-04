import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DealContextProvider,
  useDealContext,
  useDealRecord,
  useDealKpis,
  useDealRedFlags,
  useDealEvents,
  useDealDocuments,
  useDealActivities,
  useDealDDItems,
  useDealDDScore,
  useDealRiskScore,
  useDealApprovals,
  useDealFinancialSummary,
  useDealReadiness,
} from '../useDealContext';

// Mock the underlying network hook so the provider can render synchronously
// without an actual API. The mock simply reflects whatever state we want.
vi.mock('../useDeals', () => ({
  useDealWorkspace: vi.fn(),
  useDealWorkspaceLite: vi.fn(),
}));

// eslint-disable-next-line import/first
import { useDealWorkspace, useDealWorkspaceLite } from '../useDeals';

const buildWrapper = (workspace, opts = {}) => {
  // The provider now fetches a fast `lite` payload + the full payload. Mirror
  // both onto the same state for these tests — full.data dominates, and "error"
  // now means BOTH failed (a full-only failure degrades to the lite
  // deterministic deal in production, so it is not a hard page error).
  const state = {
    data: workspace,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: opts.error ?? null,
    refetch: opts.refetch ?? vi.fn(),
  };
  useDealWorkspace.mockReturnValue(state);
  useDealWorkspaceLite.mockReturnValue(state);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/prop-types
  return ({ children }) => (
    <QueryClientProvider client={client}>
      <DealContextProvider dealId="deal-1">{children}</DealContextProvider>
    </QueryClientProvider>
  );
};

describe('useDealContext', () => {
  it('throws when called outside the provider', () => {
    // Suppress React's expected error log for this negative test.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useDealContext())).toThrow(/inside <DealContextProvider>/);
    errorSpy.mockRestore();
  });

  it('returns dealId, workspace, and query state from the provider', () => {
    const workspace = { deal: { id: 'deal-1', name: 'Bengaluru tower' } };
    const { result } = renderHook(() => useDealContext(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current.dealId).toBe('deal-1');
    expect(result.current.workspace).toEqual(workspace);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('reflects the loading state', () => {
    const { result } = renderHook(() => useDealContext(), {
      wrapper: buildWrapper(null, { isLoading: true }),
    });
    expect(result.current.workspace).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('reflects the error state', () => {
    const error = new Error('boom');
    const { result } = renderHook(() => useDealContext(), {
      wrapper: buildWrapper(null, { isError: true, error }),
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(error);
  });
});

describe('useDealContext — two-phase load (lite first, full upgrades)', () => {
  const wrapWith = (fullState, liteState) => {
    useDealWorkspace.mockReturnValue({ isError: false, error: null, refetch: vi.fn(), ...fullState });
    useDealWorkspaceLite.mockReturnValue({ isError: false, error: null, refetch: vi.fn(), ...liteState });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // eslint-disable-next-line react/prop-types
    return ({ children }) => (
      <QueryClientProvider client={client}>
        <DealContextProvider dealId="d1">{children}</DealContextProvider>
      </QueryClientProvider>
    );
  };

  it('paints from lite while full is still loading, and flags AI pending', () => {
    const liteData = { deal: { id: 'd1' }, recommendations: { recommendations: [{ id: 'c1' }] } };
    const { result } = renderHook(() => useDealContext(), {
      wrapper: wrapWith(
        { data: undefined, isLoading: true },
        { data: liteData, isLoading: false },
      ),
    });
    expect(result.current.workspace).toEqual(liteData); // painted from lite
    expect(result.current.isLoading).toBe(false); // not blocking
    expect(result.current.isAiPending).toBe(true); // AI prose still generating
  });

  it('prefers the full payload once it lands and clears AI pending', () => {
    const liteData = { deal: { id: 'd1' }, recommendations: { recommendations: [{ headline: 'template' }] } };
    const fullData = { deal: { id: 'd1' }, recommendations: { recommendations: [{ headline: 'AI-refined' }] } };
    const { result } = renderHook(() => useDealContext(), {
      wrapper: wrapWith(
        { data: fullData, isLoading: false },
        { data: liteData, isLoading: false },
      ),
    });
    expect(result.current.workspace).toEqual(fullData); // full dominates
    expect(result.current.isAiPending).toBe(false);
  });

  it('stays usable (no hard error) if the full payload fails but lite succeeded', () => {
    const liteData = { deal: { id: 'd1' } };
    const { result } = renderHook(() => useDealContext(), {
      wrapper: wrapWith(
        { data: undefined, isLoading: false, isError: true, error: new Error('full failed') },
        { data: liteData, isLoading: false },
      ),
    });
    expect(result.current.workspace).toEqual(liteData);
    expect(result.current.isError).toBe(false); // degrades gracefully
  });
});

describe('selector hooks — match backend dealWorkspace.service.js shape (PR-NX62)', () => {
  // This shape mirrors the actual `GET /api/deals/:id/workspace` response.
  // See backend/src/services/dealWorkspace.service.js getDealWorkspace().
  // Pre-NX62 the tests used a synthetic shape that didn't match — so the
  // selectors passed tests but silently returned null/[] in production.
  const kpis = { irr: 18, npv: 12.5, dscr: 1.45 };
  const ddItems = [{ id: 'dd-a', item_type: 'title_deed' }];
  const ddScore = { total_required: 12, completed_required: 8 };
  const riskFlags = [{ id: 'flag-a', severity: 'high' }];
  const riskScore = { critical: 0, high: 1, medium: 2 };
  const auditEvents = [{ id: 'event-a', event_type: 'calculate_and_save' }];
  const documentsArray = [{ id: 'doc-a', name: 'EC.pdf' }];
  const activities = [{ id: 'act-a', activity_type: 'note' }];
  const approvals = [{ id: 'app-a', authority: 'BBMP' }];
  const readiness = { summary: 'IC-ready', nextSteps: ['Schedule IC'] };
  const workspace = {
    deal: { id: 'deal-1', name: 'Whitefield acres' },
    financial: {
      summary: {
        model_params: { kpis },
        irr_pct: 18,
      },
      scenarios: [],
      graph: null,
      auditEvents,
    },
    dd: {
      items: ddItems,
      score: ddScore,
    },
    risk: {
      flags: riskFlags,
      score: riskScore,
    },
    approvals,
    documents: { documents: documentsArray, grouped: {} },
    activities,
    waterfall: { jda: null, jv: null },
    readiness,
    generatedAt: '2026-05-19T08:00:00Z',
  };

  it('useDealRecord returns the deal slice', () => {
    const { result } = renderHook(() => useDealRecord(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.deal);
  });

  it('useDealKpis returns the kernel kpis from financial.summary.model_params.kpis', () => {
    const { result } = renderHook(() => useDealKpis(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(kpis);
  });

  it('useDealRedFlags returns workspace.risk.flags', () => {
    const { result } = renderHook(() => useDealRedFlags(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(riskFlags);
  });

  it('useDealRedFlags falls back to deal.risk_flags when risk slice missing', () => {
    // Defensive fallback for partially-shaped workspace.
    const partial = { deal: { id: 'deal-1', risk_flags: riskFlags } };
    const { result } = renderHook(() => useDealRedFlags(), {
      wrapper: buildWrapper(partial),
    });
    expect(result.current).toEqual(riskFlags);
  });

  it('useDealEvents returns workspace.financial.auditEvents', () => {
    const { result } = renderHook(() => useDealEvents(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(auditEvents);
  });

  it('useDealDocuments unwraps the {documents, grouped} envelope', () => {
    const { result } = renderHook(() => useDealDocuments(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(documentsArray);
  });

  it('useDealDocuments accepts a flat array for backward compat', () => {
    const { result } = renderHook(() => useDealDocuments(), {
      wrapper: buildWrapper({ documents: documentsArray }),
    });
    expect(result.current).toEqual(documentsArray);
  });

  it('useDealActivities returns the activities array', () => {
    const { result } = renderHook(() => useDealActivities(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(activities);
  });

  it('useDealDDItems returns workspace.dd.items', () => {
    const { result } = renderHook(() => useDealDDItems(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(ddItems);
  });

  it('useDealDDScore returns workspace.dd.score', () => {
    const { result } = renderHook(() => useDealDDScore(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(ddScore);
  });

  it('useDealRiskScore returns workspace.risk.score', () => {
    const { result } = renderHook(() => useDealRiskScore(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(riskScore);
  });

  it('useDealApprovals returns workspace.approvals', () => {
    const { result } = renderHook(() => useDealApprovals(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(approvals);
  });

  it('useDealFinancialSummary returns workspace.financial.summary', () => {
    const { result } = renderHook(() => useDealFinancialSummary(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.financial.summary);
  });

  it('useDealReadiness returns workspace.readiness with safe defaults', () => {
    const { result } = renderHook(() => useDealReadiness(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(readiness);
  });

  it('selector hooks default to safe empty values when workspace is null', () => {
    const wrapper = buildWrapper(null);
    expect(renderHook(() => useDealRecord(), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useDealKpis(), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useDealRedFlags(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealEvents(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealDocuments(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealActivities(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealDDItems(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealDDScore(), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useDealRiskScore(), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useDealApprovals(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealFinancialSummary(), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useDealReadiness(), { wrapper }).result.current).toEqual({
      summary: null,
      nextSteps: [],
    });
  });

  // PR-NX74 HOTFIX — workspace.activities is the `{data:[...], pagination:{...}}`
  // envelope from listActivities(); useDealActivities must unwrap it.
  // Same defensive coercion is now in useDealDDItems / useDealApprovals /
  // useDealRedFlags / useDealEvents — protects against any service that
  // returns the same envelope shape.
  describe('PR-NX74: defensive {data:[...]} envelope unwrap', () => {
    it('useDealActivities unwraps the {data:[...], pagination} envelope (production bug from listActivities)', () => {
      const envelope = {
        activities: { data: activities, pagination: { total: 1, page: 1, limit: 50 } },
      };
      const { result } = renderHook(() => useDealActivities(), {
        wrapper: buildWrapper(envelope),
      });
      expect(result.current).toEqual(activities);
      // The smoke test that proves the bug is fixed:
      expect(() => [...result.current]).not.toThrow();
    });

    it('useDealActivities still returns a flat array when given one (backward compat)', () => {
      const flat = { activities: activities };
      const { result } = renderHook(() => useDealActivities(), {
        wrapper: buildWrapper(flat),
      });
      expect(result.current).toEqual(activities);
    });

    it('useDealDDItems unwraps the {data:[...]} envelope', () => {
      const envelope = { dd: { items: { data: ddItems, pagination: { total: 1 } } } };
      const { result } = renderHook(() => useDealDDItems(), {
        wrapper: buildWrapper(envelope),
      });
      expect(result.current).toEqual(ddItems);
    });

    it('useDealRedFlags unwraps the {data:[...]} envelope', () => {
      const envelope = { risk: { flags: { data: riskFlags } } };
      const { result } = renderHook(() => useDealRedFlags(), {
        wrapper: buildWrapper(envelope),
      });
      expect(result.current).toEqual(riskFlags);
    });

    it('useDealEvents unwraps the {data:[...]} envelope', () => {
      const events = [{ id: 'ev-1' }];
      const envelope = { financial: { auditEvents: { data: events } } };
      const { result } = renderHook(() => useDealEvents(), {
        wrapper: buildWrapper(envelope),
      });
      expect(result.current).toEqual(events);
    });

    it('useDealApprovals unwraps the {data:[...]} envelope', () => {
      const envelope = { approvals: { data: approvals } };
      const { result } = renderHook(() => useDealApprovals(), {
        wrapper: buildWrapper(envelope),
      });
      expect(result.current).toEqual(approvals);
    });

    it('all array selectors return [] for unrecognised wrapper shapes', () => {
      const junk = {
        activities: { foo: 'bar' },
        dd: { items: { foo: 'bar' } },
        risk: { flags: 42 },
        financial: { auditEvents: 'oops' },
        approvals: { foo: 'bar' },
        documents: { foo: 'bar' },
      };
      const wrapper = buildWrapper(junk);
      expect(renderHook(() => useDealActivities(), { wrapper }).result.current).toEqual([]);
      expect(renderHook(() => useDealDDItems(), { wrapper }).result.current).toEqual([]);
      expect(renderHook(() => useDealRedFlags(), { wrapper }).result.current).toEqual([]);
      expect(renderHook(() => useDealEvents(), { wrapper }).result.current).toEqual([]);
      expect(renderHook(() => useDealApprovals(), { wrapper }).result.current).toEqual([]);
      expect(renderHook(() => useDealDocuments(), { wrapper }).result.current).toEqual([]);
    });
  });
});
