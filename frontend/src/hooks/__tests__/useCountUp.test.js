import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from '../useCountUp';

/**
 * useCountUp behavior:
 *   - reduced-motion → snap to target
 *   - default → animate cubic-out over `duration` via rAF
 *   - non-numeric target → snap, no animation
 */

const setReducedMotion = (reduced) => {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: q.includes('reduce') ? reduced : false,
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe('useCountUp', () => {
  beforeEach(() => {
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('returns the target immediately when prefers-reduced-motion is set', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useCountUp(100));
    expect(result.current).toBe(100);
  });

  test('snaps to non-numeric values without animating', () => {
    const { result } = renderHook(({ t }) => useCountUp(t), {
      initialProps: { t: 'N/A' },
    });
    expect(result.current).toBe('N/A');
  });

  test('animates from previous to target with cubic-out easing', async () => {
    vi.useFakeTimers();
    let now = 0;
    const rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const performanceNow = vi.spyOn(performance, 'now').mockImplementation(() => now);

    const { result, rerender } = renderHook(({ t }) => useCountUp(t, { duration: 600 }), {
      initialProps: { t: 0 },
    });
    expect(result.current).toBe(0);

    rerender({ t: 100 });

    // Drive rAF manually. Cubic-out: t=0 → 0, t=0.5 → 0.875, t=1 → 1.
    const drainRaf = (advanceMs) => {
      now += advanceMs;
      const pending = rafCallbacks.splice(0, rafCallbacks.length);
      act(() => {
        pending.forEach((cb) => cb(now));
      });
    };

    drainRaf(0);
    expect(result.current).toBe(0);

    drainRaf(300); // 50% elapsed → cubic-out 0.875 → ~87.5
    expect(result.current).toBeGreaterThan(80);
    expect(result.current).toBeLessThan(95);

    drainRaf(300); // done
    expect(result.current).toBe(100);

    performanceNow.mockRestore();
  });
});
