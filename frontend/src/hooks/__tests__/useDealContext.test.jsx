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
} from '../useDealContext';

// Mock the underlying network hook so the provider can render synchronously
// without an actual API. The mock simply reflects whatever state we want.
vi.mock('../useDeals', () => ({
  useDealWorkspace: vi.fn(),
}));

// eslint-disable-next-line import/first
import { useDealWorkspace } from '../useDeals';

const buildWrapper = (workspace, opts = {}) => {
  useDealWorkspace.mockReturnValue({
    data: workspace,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: opts.error ?? null,
    refetch: opts.refetch ?? vi.fn(),
  });
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

describe('selector hooks', () => {
  const workspace = {
    deal: { id: 'deal-1', name: 'Whitefield acres' },
    financials: { kpis: { irr_pct: 18, npv_cr: 12.5 } },
    risk_flags: [{ id: 'flag-a', severity: 'high' }],
    events: [{ id: 'event-a', event_type: 'calculate_and_save' }],
    documents: [{ id: 'doc-a', name: 'EC.pdf' }],
    activities: [{ id: 'act-a', activity_type: 'note' }],
  };

  it('useDealRecord returns the deal slice', () => {
    const { result } = renderHook(() => useDealRecord(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.deal);
  });

  it('useDealKpis returns the kpis slice', () => {
    const { result } = renderHook(() => useDealKpis(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.financials.kpis);
  });

  it('useDealRedFlags returns the risk_flags array', () => {
    const { result } = renderHook(() => useDealRedFlags(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.risk_flags);
  });

  it('useDealEvents returns the events array', () => {
    const { result } = renderHook(() => useDealEvents(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.events);
  });

  it('useDealDocuments returns the documents array', () => {
    const { result } = renderHook(() => useDealDocuments(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.documents);
  });

  it('useDealActivities returns the activities array', () => {
    const { result } = renderHook(() => useDealActivities(), {
      wrapper: buildWrapper(workspace),
    });
    expect(result.current).toEqual(workspace.activities);
  });

  it('selector hooks default to safe empty values when workspace is null', () => {
    const wrapper = buildWrapper(null);
    expect(renderHook(() => useDealRecord(), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useDealKpis(), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useDealRedFlags(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealEvents(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealDocuments(), { wrapper }).result.current).toEqual([]);
    expect(renderHook(() => useDealActivities(), { wrapper }).result.current).toEqual([]);
  });
});
