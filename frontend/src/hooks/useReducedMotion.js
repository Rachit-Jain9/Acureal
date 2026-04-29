import { useEffect, useState } from 'react';

/**
 * Live read of `prefers-reduced-motion: reduce` from the OS.
 *
 * Returns `true` when the user has asked for reduced motion. Listens for
 * media-query changes so a setting flip during the session takes effect
 * without a reload (e.g. macOS System Settings → Accessibility).
 *
 * Used by Recharts `isAnimationActive`, count-up hooks, and any component
 * that needs to disable opacity/transform animations per
 * `docs/FRONTEND_GUIDELINES.md` §9.
 *
 * SSR-safe: returns `false` when `window.matchMedia` is unavailable.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (event) => setReduced(event.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    // Safari < 14 fallback
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  return reduced;
}

export default useReducedMotion;
