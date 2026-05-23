import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API the hook fans out to so we can observe the prefetch
// without hitting the network.
vi.mock('../../services/api', () => ({
  dealsAPI: {
    getWorkspace: vi.fn(() => Promise.resolve({ data: { data: { id: 'd1' } } })),
  },
}));

import { dealsAPI } from '../../services/api';
import { usePrefetchDealWorkspace } from '../useDeals';

const renderPrefetchHook = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => usePrefetchDealWorkspace(), { wrapper }) };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePrefetchDealWorkspace', () => {
  it('does nothing when called with no id', () => {
    const { result } = renderPrefetchHook();
    act(() => result.current(null));
    act(() => result.current(undefined));
    act(() => result.current(''));
    expect(dealsAPI.getWorkspace).not.toHaveBeenCalled();
  });

  it('fires getWorkspace once for a fresh deal id', async () => {
    const { result, qc } = renderPrefetchHook();
    await act(async () => {
      result.current('deal-1');
      // Let the prefetch promise resolve before assertions.
      await qc.getQueryCache().findAll().find?.((q) => q.queryKey[1] === 'deal-1')?.promise;
    });
    expect(dealsAPI.getWorkspace).toHaveBeenCalledTimes(1);
    expect(dealsAPI.getWorkspace).toHaveBeenCalledWith('deal-1');
  });

  it('skips the fetch when the deal is already in cache (no thrash)', async () => {
    const { result, qc } = renderPrefetchHook();
    // Pre-populate the cache as if a previous prefetch already landed.
    qc.setQueryData(['deal-workspace', 'deal-2'], { id: 'deal-2' });
    await act(async () => result.current('deal-2'));
    expect(dealsAPI.getWorkspace).not.toHaveBeenCalled();
  });

  it('caches the result under the shared ["deal-workspace", id] key', async () => {
    dealsAPI.getWorkspace.mockResolvedValueOnce({
      data: { data: { id: 'deal-3', name: 'Whitefield JV' } },
    });
    const { result, qc } = renderPrefetchHook();
    await act(async () => {
      result.current('deal-3');
      const q = qc.getQueryCache().find({ queryKey: ['deal-workspace', 'deal-3'] });
      if (q) await q.promise;
    });
    expect(qc.getQueryData(['deal-workspace', 'deal-3'])).toMatchObject({
      id: 'deal-3',
      name: 'Whitefield JV',
    });
  });
});
