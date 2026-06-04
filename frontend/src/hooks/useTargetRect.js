// useTargetRect — measures a target element (by CSS selector) and keeps the
// measurement current across scroll and resize. Shared by the tour coachmark
// and the spotlight backdrop so both stay glued to the exact same anchor and
// can never drift apart.
//
// Returns the element's viewport rect ({ top, left, width, height, right,
// bottom }) or null when the target isn't present / has zero size (e.g. a
// sidebar item inside a closed mobile drawer). Pass `scrollIntoView: true` from
// exactly one consumer (the coachmark) so the target is brought into view once
// per step, not twice.

import { useLayoutEffect, useState } from 'react';

export default function useTargetRect(selector, { scrollIntoView = false } = {}) {
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return undefined;
    }

    const measure = () => {
      const el = document.querySelector(selector);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      setRect({
        top: r.top, left: r.left, width: r.width, height: r.height,
        right: r.right, bottom: r.bottom,
      });
    };

    measure();

    if (scrollIntoView) {
      const el = document.querySelector(selector);
      if (el && typeof el.scrollIntoView === 'function') {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        } catch (_) {
          // older browsers without smooth-scroll options — ignore.
        }
      }
    }

    // Capture-phase scroll so we catch scrolling on any ancestor, not just window.
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [selector, scrollIntoView]);

  return rect;
}
