import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from '../useReducedMotion';

const buildMq = (matches) => {
  const listeners = new Set();
  return {
    _listeners: listeners,
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
  };
};

describe('useReducedMotion', () => {
  let currentMq;

  beforeEach(() => {
    currentMq = buildMq(false);
    window.matchMedia = vi.fn().mockImplementation(() => currentMq);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns false when OS reports no reduced-motion preference', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  test('returns true when OS reports reduced-motion preference', () => {
    currentMq = buildMq(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  test('updates when the OS preference flips mid-session', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => {
      currentMq._listeners.forEach((cb) => cb({ matches: true }));
    });
    expect(result.current).toBe(true);
  });
});
