import { useCallback, useEffect, useState } from 'react';
import { parseEvidenceRef } from '../utils/evidenceRef';

/**
 * useEvidenceNavigate — Phase 1 / E1.
 *
 * Returns a callback `(ref) => boolean` that routes the operator to the
 * tab + scroll target encoded by an evidence ref string. Updates the URL
 * directly via `window.history` so the hook works outside a React Router
 * context too (component-isolation tests, etc.). Dispatches a `popstate`
 * so any React Router subtree picks up the new URL.
 *
 * Returns `true` when navigation happened, `false` when the ref was
 * unrouted (so the caller can decide whether to render the link
 * affordance at all).
 */
export function useEvidenceNavigate() {
  return useCallback((ref) => {
    const target = parseEvidenceRef(ref);
    if (!target) return false;
    if (typeof window === 'undefined') return false;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', target.tab);
    if (target.scrollTo) url.searchParams.set('scroll', target.scrollTo);
    else url.searchParams.delete('scroll');
    window.history.pushState({}, '', url);
    // React Router listens for `popstate` to sync its internal state; the
    // built-in `pushState` does NOT fire it, so we fire it manually.
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
  }, []);
}

/**
 * useScrollOnMount — companion hook.
 *
 * Reads `?scroll=<id>` from `window.location` on mount + on every URL
 * change; if there's a matching DOM element, scrolls it into view smoothly
 * with a brief flash so the operator sees what got targeted. Clears the
 * scroll param after firing so a refresh / back-navigation doesn't re-fire.
 *
 * Router-agnostic by design — reads from `window.location` so the hook
 * never throws outside a Router context (component-isolation tests).
 */
export function useScrollOnMount() {
  const [scrollTo, setScrollTo] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('scroll');
  });

  // Keep `scrollTo` in sync if the URL changes (evidence-ref click → URL
  // gets ?scroll=... → this hook should fire).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPopState = () => {
      setScrollTo(new URLSearchParams(window.location.search).get('scroll'));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!scrollTo || typeof window === 'undefined') return undefined;
    // Defer one frame so the new tab content has actually rendered.
    const timer = setTimeout(() => {
      const el = document.getElementById(scrollTo);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief flash so the operator sees WHICH element was targeted.
        el.classList.add('evidence-highlight-flash');
        setTimeout(() => el.classList.remove('evidence-highlight-flash'), 1800);
      }
      // Clear the scroll param so a refresh / back-nav doesn't re-fire.
      const url = new URL(window.location.href);
      url.searchParams.delete('scroll');
      window.history.replaceState({}, '', url);
      setScrollTo(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollTo]);
}
