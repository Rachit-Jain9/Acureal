import { useLayoutEffect } from 'react';

/**
 * Lock body scroll while `active`, restoring the previous value on release.
 *
 * The design-system Modal already does this inline; this hook is for the
 * hand-rolled overlays that can't use the primitive (wide/custom dialogs)
 * so the page behind a modal can't scroll. useLayoutEffect runs before paint
 * so there's no scroll flash on open.
 *
 *   useScrollLock(open);
 */
export default function useScrollLock(active) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    if (typeof document === 'undefined') return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [active]);
}
