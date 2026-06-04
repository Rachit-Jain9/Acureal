import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// useDealPeek is cache-only and never calls the API, but useDeals.js imports
// the api module at load — stub it so the test stays hermetic.
vi.mock('../../services/api', () => ({ dealsAPI: {} }));

import { useDealPeek } from '../useDeals';

// Mount a tiny probe so the hook runs inside a QueryClientProvider and we can
// capture its return value (renderHook proxies are flaky under CI — see
// usePrefetchDealWorkspace.test.jsx for the same pattern).
function renderPeek(id, seed) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  if (seed) seed(qc);
  const ref = { current: undefined };
  function Probe() {
    ref.current = useDealPeek(id);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return { qc, ref };
}

describe('useDealPeek — cache-only deal identity', () => {
  it('returns null when the id is falsy', () => {
    expect(renderPeek(null).ref.current).toBeNull();
    expect(renderPeek(undefined).ref.current).toBeNull();
  });

  it('returns null on a cold cache (no single entry, no list page)', () => {
    expect(renderPeek('deal-x').ref.current).toBeNull();
  });

  it('reads the deal from the single-deal cache when present', () => {
    const { ref } = renderPeek('deal-1', (qc) => {
      qc.setQueryData(['deal', 'deal-1'], { id: 'deal-1', name: 'Whitefield JV', stage: 'dd' });
    });
    expect(ref.current).toMatchObject({ id: 'deal-1', name: 'Whitefield JV', stage: 'dd' });
  });

  it('finds the deal by scanning a cached deals-list page', () => {
    const { ref } = renderPeek('deal-2', (qc) => {
      qc.setQueryData(['deals', { page: 1, stage: 'all' }], {
        data: [
          { id: 'deal-9', name: 'Other' },
          { id: 'deal-2', name: 'Hebbal Plot', stage: 'sourcing' },
        ],
        pagination: { total: 2 },
      });
    });
    expect(ref.current).toMatchObject({ id: 'deal-2', name: 'Hebbal Plot', stage: 'sourcing' });
  });

  it('prefers the single-deal cache over a list row for the same id', () => {
    const { ref } = renderPeek('deal-3', (qc) => {
      qc.setQueryData(['deals', {}], { data: [{ id: 'deal-3', name: 'List Name' }] });
      qc.setQueryData(['deal', 'deal-3'], { id: 'deal-3', name: 'Single Name' });
    });
    expect(ref.current).toMatchObject({ name: 'Single Name' });
  });

  it('does not throw on malformed list cache entries', () => {
    const { ref } = renderPeek('deal-4', (qc) => {
      qc.setQueryData(['deals', 'weird'], { data: null });
      qc.setQueryData(['deals', 'weird2'], undefined);
      qc.setQueryData(['deals', 'weird3'], { data: [null, { id: 'nope' }] });
    });
    expect(ref.current).toBeNull();
  });
});
