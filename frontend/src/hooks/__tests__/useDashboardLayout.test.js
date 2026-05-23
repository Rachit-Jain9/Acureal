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
  it('preserves the user’s stored relative order for stored widgets', () => {
    // The user explicitly moved `top_deals_irr` to position 0. Reconcile
    // must NOT undo that.
    const stored = [
      { id: 'top_deals_irr', visible: true },
      { id: 'kpi_strip',     visible: true },
    ];
    const out = reconcile(stored);
    const idsByPos = out.map((e) => e.id);
    expect(idsByPos.indexOf('top_deals_irr')).toBeLessThan(idsByPos.indexOf('kpi_strip'));
  });

  it('inserts new catalogue widgets at their natural catalogue position', () => {
    // Stored layout has kpi_strip and pipeline_chart. The catalogue puts
    // `comps_queue_alert` BETWEEN them. After reconcile, the new widget
    // should land between them, NOT at the bottom of the layout.
    const stored = [
      { id: 'kpi_strip',      visible: true },
      { id: 'pipeline_chart', visible: false },
    ];
    const out = reconcile(stored);
    const ids = out.map((e) => e.id);
    expect(ids.indexOf('kpi_strip')).toBeLessThan(ids.indexOf('comps_queue_alert'));
    expect(ids.indexOf('comps_queue_alert')).toBeLessThan(ids.indexOf('pipeline_chart'));
    // Every catalogue widget is present.
    DEFAULT_WIDGETS.forEach((w) => {
      expect(ids).toContain(w.id);
    });
  });

  it('inserts a brand-new widget at index 0 when no catalogue-prior anchor is present', () => {
    // Stored has nothing catalogue-before pipeline_chart (kpi_strip and
    // comps_queue_alert are both missing from storage). A new widget
    // catalogue-before pipeline_chart should land at index 0.
    const stored = [{ id: 'pipeline_chart', visible: true }];
    const out = reconcile(stored);
    // kpi_strip is the very first catalogue entry; it must land at 0.
    expect(out[0].id).toBe('kpi_strip');
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

  it('uses the catalogue’s defaultVisible for newly-inserted widgets', () => {
    // audit_trail_tail defaults to hidden in DEFAULT_WIDGETS — when a
    // pre-existing layout doesn’t mention it, smart insertion should
    // pick up the catalogue’s default-visibility (false).
    const stored = [{ id: 'kpi_strip', visible: true }];
    const out = reconcile(stored);
    const audit = out.find((e) => e.id === 'audit_trail_tail');
    expect(audit).toBeDefined();
    expect(audit.visible).toBe(false);
  });
});
