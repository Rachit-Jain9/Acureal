import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDashboardLayout,
  DEFAULT_WIDGETS,
  STORAGE_KEY,
  reconcile,
  defaultLayout,
} from '../useDashboardLayout';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useDashboardLayout', () => {
  it('returns DEFAULT_WIDGETS when localStorage is empty', () => {
    const { result } = renderHook(() => useDashboardLayout());
    expect(result.current.layout).toHaveLength(DEFAULT_WIDGETS.length);
    expect(result.current.layout[0].id).toBe('kpi_strip');
  });

  it('toggleVisible flips the visibility flag and persists to localStorage', () => {
    const { result } = renderHook(() => useDashboardLayout());
    const before = result.current.layout.find((e) => e.id === 'pipeline_chart');
    expect(before.visible).toBe(true);
    act(() => result.current.toggleVisible('pipeline_chart'));
    const after = result.current.layout.find((e) => e.id === 'pipeline_chart');
    expect(after.visible).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(stored.find((e) => e.id === 'pipeline_chart').visible).toBe(false);
  });

  it('toggleVisible refuses to hide always-on widgets (kpi_strip)', () => {
    const { result } = renderHook(() => useDashboardLayout());
    act(() => result.current.toggleVisible('kpi_strip'));
    expect(result.current.layout.find((e) => e.id === 'kpi_strip').visible).toBe(true);
  });

  it('moveUp swaps with the previous entry', () => {
    const { result } = renderHook(() => useDashboardLayout());
    const original = [...result.current.layout];
    act(() => result.current.moveUp('cities_chart'));
    const after = result.current.layout;
    const oldIdx = original.findIndex((e) => e.id === 'cities_chart');
    const newIdx = after.findIndex((e) => e.id === 'cities_chart');
    expect(newIdx).toBe(oldIdx - 1);
  });

  it('moveDown swaps with the next entry', () => {
    const { result } = renderHook(() => useDashboardLayout());
    const original = [...result.current.layout];
    act(() => result.current.moveDown('pipeline_chart'));
    const after = result.current.layout;
    const oldIdx = original.findIndex((e) => e.id === 'pipeline_chart');
    const newIdx = after.findIndex((e) => e.id === 'pipeline_chart');
    expect(newIdx).toBe(oldIdx + 1);
  });

  it('moveUp on first item is a no-op', () => {
    const { result } = renderHook(() => useDashboardLayout());
    const before = result.current.layout[0].id;
    act(() => result.current.moveUp(before));
    expect(result.current.layout[0].id).toBe(before);
  });

  it('reset() returns to defaults', () => {
    const { result } = renderHook(() => useDashboardLayout());
    act(() => result.current.toggleVisible('pipeline_chart'));
    act(() => result.current.moveUp('cities_chart'));
    act(() => result.current.reset());
    // After reset, layout matches defaultLayout()
    expect(result.current.layout.map((e) => e.id)).toEqual(
      DEFAULT_WIDGETS.map((w) => w.id),
    );
    expect(result.current.layout.every((e) => {
      const d = DEFAULT_WIDGETS.find((w) => w.id === e.id);
      return e.visible === d.defaultVisible;
    })).toBe(true);
  });

  it('reads persisted layout on subsequent mount', () => {
    const persisted = [
      { id: 'top_deals_irr', visible: true },
      { id: 'kpi_strip',     visible: true },
      { id: 'cities_chart',  visible: false },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    const { result } = renderHook(() => useDashboardLayout());
    // First entry should be top_deals_irr (preserved order); kpi_strip
    // forced visible; cities_chart respects stored false.
    expect(result.current.layout[0].id).toBe('top_deals_irr');
    expect(result.current.layout.find((e) => e.id === 'cities_chart').visible).toBe(false);
    expect(result.current.layout.find((e) => e.id === 'kpi_strip').visible).toBe(true);
  });
});

describe('reconcile (pure)', () => {
  it('appends new catalogue widgets that were not in storage', () => {
    const stored = [
      { id: 'kpi_strip',      visible: true },
      { id: 'pipeline_chart', visible: false },
    ];
    const out = reconcile(stored);
    // Stored widgets keep their order; missing ones are appended in
    // catalogue order.
    expect(out[0].id).toBe('kpi_strip');
    expect(out[1].id).toBe('pipeline_chart');
    // Make sure all default widgets are now present.
    const ids = out.map((e) => e.id);
    DEFAULT_WIDGETS.forEach((w) => {
      expect(ids).toContain(w.id);
    });
  });

  it('drops unknown ids that were stored from an older catalogue', () => {
    const stored = [
      { id: 'kpi_strip', visible: true },
      { id: 'ghost_widget', visible: true },
    ];
    const out = reconcile(stored);
    expect(out.find((e) => e.id === 'ghost_widget')).toBeUndefined();
  });

  it('forces always-on widgets visible even if stored false', () => {
    const stored = [{ id: 'kpi_strip', visible: false }];
    const out = reconcile(stored);
    expect(out[0].visible).toBe(true);
  });

  it('returns defaults when stored is null/empty', () => {
    expect(reconcile(null)).toEqual(defaultLayout());
  });
});
