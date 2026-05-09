import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSavedDealViews,
  filtersEqual,
  STORAGE_KEY,
  MAX_VIEWS,
} from '../useSavedDealViews';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useSavedDealViews', () => {
  it('starts with an empty list when localStorage is empty', () => {
    const { result } = renderHook(() => useSavedDealViews());
    expect(result.current.views).toEqual([]);
  });

  it('save adds a view and persists to localStorage', () => {
    const { result } = renderHook(() => useSavedDealViews());
    let savedId;
    act(() => {
      savedId = result.current.save('My active', { stage: 'screening', assignedToMe: true });
    });
    expect(savedId).toBeTruthy();
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('My active');
    expect(result.current.views[0].filters).toMatchObject({ stage: 'screening', assignedToMe: true });
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(stored).toHaveLength(1);
  });

  it('save trims whitespace and refuses empty names', () => {
    const { result } = renderHook(() => useSavedDealViews());
    act(() => {
      result.current.save('   ', { stage: 'sourcing' });
    });
    expect(result.current.views).toHaveLength(0);
    act(() => {
      result.current.save('  Trimmed  ', { stage: 'sourcing' });
    });
    expect(result.current.views[0].name).toBe('Trimmed');
  });

  it('caps at MAX_VIEWS — older entries drop off the front', () => {
    const { result } = renderHook(() => useSavedDealViews());
    act(() => {
      for (let i = 0; i < MAX_VIEWS + 5; i += 1) {
        result.current.save(`view-${i}`, { stage: 'sourcing' });
      }
    });
    expect(result.current.views).toHaveLength(MAX_VIEWS);
    // First view should be view-5 (the first 5 dropped off the front).
    expect(result.current.views[0].name).toBe('view-5');
  });

  it('remove drops a view by id', () => {
    const { result } = renderHook(() => useSavedDealViews());
    let id;
    act(() => {
      id = result.current.save('Drop me', { stage: 'closed' });
      result.current.save('Keep me', { stage: 'screening' });
    });
    act(() => {
      result.current.remove(id);
    });
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('Keep me');
  });

  it('rename updates a view name', () => {
    const { result } = renderHook(() => useSavedDealViews());
    let id;
    act(() => {
      id = result.current.save('Old name', { stage: 'screening' });
    });
    act(() => {
      result.current.rename(id, 'New name');
    });
    expect(result.current.views[0].name).toBe('New name');
  });

  it('findActive matches the view whose filters equal the supplied snapshot', () => {
    const { result } = renderHook(() => useSavedDealViews());
    act(() => {
      result.current.save('Bengaluru office', {
        stage: '',
        dealType: '',
        priority: '',
        search: '',
        assignedToMe: false,
        city: 'Bengaluru',
      });
    });
    const match = result.current.findActive({
      stage: '',
      dealType: '',
      priority: '',
      search: '',
      assignedToMe: false,
      city: 'Bengaluru',
    });
    expect(match?.name).toBe('Bengaluru office');
    const noMatch = result.current.findActive({ city: 'Mumbai' });
    expect(noMatch).toBeNull();
  });

  it('persisted views survive remount', () => {
    const { unmount } = renderHook(() => useSavedDealViews());
    // Pre-seed via direct localStorage write
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'v1', name: 'Pre-seeded', filters: { stage: 'sourcing' } }]),
    );
    unmount();
    const { result } = renderHook(() => useSavedDealViews());
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('Pre-seeded');
  });

  it('drops corrupt entries from localStorage rather than crashing', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'v1', name: 'Valid', filters: { stage: 'sourcing' } },
        { id: 'v2' /* missing name + filters */ },
        'not-an-object',
      ]),
    );
    const { result } = renderHook(() => useSavedDealViews());
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].id).toBe('v1');
  });
});

describe('filtersEqual', () => {
  it('returns true for identical filter objects', () => {
    expect(filtersEqual({ stage: 'screening' }, { stage: 'screening' })).toBe(true);
  });

  it('treats empty / undefined / false / null as equivalent', () => {
    expect(filtersEqual(
      { stage: 'screening', search: '', assignedToMe: false },
      { stage: 'screening' }, // missing fields
    )).toBe(true);
    expect(filtersEqual(
      { stage: 'screening', search: undefined },
      { stage: 'screening', search: null },
    )).toBe(true);
  });

  it('returns false when a field differs in non-empty value', () => {
    expect(filtersEqual({ stage: 'screening' }, { stage: 'closed' })).toBe(false);
  });

  it('returns false when one has assignedToMe=true and other does not', () => {
    expect(filtersEqual(
      { assignedToMe: true },
      { assignedToMe: false },
    )).toBe(false);
  });

  it('handles null inputs defensively', () => {
    expect(filtersEqual(null, {})).toBe(false);
    expect(filtersEqual({}, null)).toBe(false);
  });
});
