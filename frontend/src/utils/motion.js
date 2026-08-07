/**
 * Motion helpers for imperative (non-render) code paths.
 *
 * `useReducedMotion` covers everything that happens during render — Recharts
 * `isAnimationActive`, count-up hooks, transition classes. It cannot cover a
 * `scrollIntoView` fired from inside an effect, an event handler, or a plain
 * module-scope hook, because those are not render-time reads and threading a
 * boolean into each of them is exactly the plumbing people forget.
 *
 * So this reads the media query AT CALL TIME. That is correct here rather than
 * merely convenient: an imperative scroll happens once, in response to
 * something the user just did, so the current setting is the only one that
 * matters — there is no subscription to keep or stale value to invalidate.
 *
 * FRONTEND_GUIDELINES §9: respect `prefers-reduced-motion`. A smooth scroll is
 * one of the motions that most reliably triggers vestibular symptoms, and five
 * call sites were passing `behavior: 'smooth'` unconditionally while ten other
 * components correctly honoured the setting. `scripts/check-smooth-scroll.cjs`
 * now fails CI on a raw literal so the count stays at zero.
 */

/** Live read of `prefers-reduced-motion: reduce`. SSR-safe. */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * `Element.scrollIntoView` that degrades to an instant jump when the user has
 * asked for reduced motion. Null-safe: a missing element is a no-op, which is
 * what every call site already hand-rolled with `?.`.
 *
 * @param {Element | null | undefined} el
 * @param {ScrollIntoViewOptions} [options] - `behavior` defaults to 'smooth'
 *   and is overridden to 'auto' whenever reduced motion is requested.
 */
export const scrollIntoView = (el, options = {}) => {
  if (!el || typeof el.scrollIntoView !== 'function') return;
  el.scrollIntoView({
    ...options,
    behavior: prefersReducedMotion() ? 'auto' : (options.behavior || 'smooth'),
  });
};

export default scrollIntoView;
