import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedViews, filtersEqual } from '../useSavedViews';

const TEST_KEY = 'redip.test.savedViews';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useSavedViews — generic hook', () => {
  it('throws when storageKey is missing', () => {
    expect(() => renderHook(() => useSavedViews({}))).toThrow();
    expect(() => renderHook(() => useSavedViews())).toThrow();
  });

  it('two hooks with different storageKeys are isolated', () => {
    const { result: a } = renderHook(() => useSavedViews({ storageKey: 'redip.testA.savedViews' }));
    const { result: b } = renderHook(() => useSavedViews({ storageKey: 'redip.testB.savedViews' }));
    act(() => a.current.save('A only', { stage: 'screening' }));
    expect(a.current.views).toHaveLength(1);
    expect(b.current.views).toHaveLength(0);
  });

  it('respects custom maxViews cap', () => {
    const { result } = renderHook(() => useSavedViews({ storageKey: TEST_KEY, maxViews: 3 }));
    act(() => {
      for (let i = 0; i < 5; i += 1) result.current.save(`v-${i}`, {});
    });
    expect(result.current.views).toHaveLength(3);
    expect(result.current.views[0].name).toBe('v-2');
  });

  it('save / remove / rename / findActive flow on the queue-shaped filters', () => {
    const { result } = renderHook(() => useSavedViews({ storageKey: TEST_KEY }));
    let id;
    act(() => {
      id = result.current.save('My queue', { status: 'pending_review', source: null, assignedToMe: true });
    });
    expect(result.current.views[0].name).toBe('My queue');

    act(() => result.current.rename(id, 'Mine'));
    expect(result.current.views[0].name).toBe('Mine');

    const match = result.current.findActive({
      status: 'pending_review',
      source: null,
      assignedToMe: true,
    });
    expect(match?.id).toBe(id);

    act(() => result.current.remove(id));
    expect(result.current.views).toHaveLength(0);
  });
});

describe('filtersEqual still treats null/empty/false as equivalent', () => {
  it('does for the queue-shaped filter', () => {
    expect(
      filtersEqual(
        { status: 'pending_review', source: null, assignedToMe: false },
        { status: 'pending_review' },
      ),
    ).toBe(true);
  });
});
