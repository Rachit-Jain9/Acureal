import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
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

// Instead of `renderHook` (which under CI sometimes returns a proxy
// where `result.current` lazily resolves to the hook's value), we mount
// a tiny wrapper component and capture the hook's return value into a
// shared ref. This gives the test a stable function reference that
// survives `await act(...)` boundaries.
function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const ref = { current: null };
  function Probe() {
    ref.current = usePrefetchDealWorkspace();
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return { qc, getPrefetch: () => ref.current };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePrefetchDealWorkspace', () => {
  it('does nothing when called with no id', async () => {
    const { getPrefetch } = setup();
    await act(async () => {
      await getPrefetch()(null);
      await getPrefetch()(undefined);
      await getPrefetch()('');
    });
    expect(dealsAPI.getWorkspace).not.toHaveBeenCalled();
  });

  it('fires getWorkspace once for a fresh deal id', async () => {
    const { getPrefetch } = setup();
    await act(async () => {
      await getPrefetch()('deal-1');
    });
    expect(dealsAPI.getWorkspace).toHaveBeenCalledTimes(1);
    expect(dealsAPI.getWorkspace).toHaveBeenCalledWith('deal-1');
  });

  it('skips the fetch when the deal is already in cache (no thrash)', async () => {
    const { qc, getPrefetch } = setup();
    qc.setQueryData(['deal-workspace', 'deal-2'], { id: 'deal-2' });
    await act(async () => {
      await getPrefetch()('deal-2');
    });
    expect(dealsAPI.getWorkspace).not.toHaveBeenCalled();
  });

  it('caches the result under the shared ["deal-workspace", id] key', async () => {
    dealsAPI.getWorkspace.mockResolvedValueOnce({
      data: { data: { id: 'deal-3', name: 'Whitefield JV' } },
    });
    const { qc, getPrefetch } = setup();
    await act(async () => {
      await getPrefetch()('deal-3');
    });
    // React Query writes to the cache after the queryFn promise resolves,
    // which happens in a microtask the `await` above doesn't always flush
    // before the next synchronous read on CI. `waitFor` polls until the
    // microtask drains — local + CI both deterministic.
    await waitFor(() => {
      expect(qc.getQueryData(['deal-workspace', 'deal-3'])).toMatchObject({
        id: 'deal-3',
        name: 'Whitefield JV',
      });
    });
  });
});
