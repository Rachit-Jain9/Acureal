import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Animate a number from its previous value to the new target using
 * `requestAnimationFrame` interpolation.
 *
 * Per `docs/FRONTEND_GUIDELINES.md` §5: numbers count up/down on change over
 * 600ms (`ease-out`). Honors `prefers-reduced-motion: reduce` by snapping
 * directly to the target.
 *
 * Returns the current animated value. Pass through a formatter at the call
 * site (e.g. `formatINR(animated)`).
 *
 * @param {number} target  - the canonical target value
 * @param {object} [opts]
 * @param {number} [opts.duration=600] - animation duration in ms
 * @param {(t: number) => number} [opts.easing] - 0..1 easing fn (default ease-out)
 * @returns {number} the live animated value
 */
export function useCountUp(target, { duration = 600, easing } = {}) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(typeof target === 'number' ? target : 0);
  const fromRef = useRef(typeof target === 'number' ? target : 0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof target !== 'number' || !Number.isFinite(target)) {
      setValue(target);
      fromRef.current = typeof target === 'number' ? target : 0;
      return undefined;
    }
    if (reduced || duration <= 0) {
      setValue(target);
      fromRef.current = target;
      return undefined;
    }

    const from = fromRef.current;
    const start = performance.now();
    const ease = easing || ((t) => 1 - (1 - t) ** 3); // cubic ease-out

    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const next = from + (target - from) * ease(progress);
      setValue(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, easing, reduced]);

  return value;
}

export default useCountUp;
