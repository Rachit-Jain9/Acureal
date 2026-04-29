import { useEffect, useRef } from 'react';

/**
 * Trap focus inside a modal/drawer container while it's active.
 *
 * Per FRONTEND_GUIDELINES §9 (and WAI-ARIA APG dialog pattern):
 *   - Tab/Shift+Tab must cycle through focusable elements *within* the
 *     dialog, not escape to the background page.
 *   - When the dialog closes, focus must restore to the element that
 *     opened it.
 *   - Escape closes the dialog (consumer wires the close handler).
 *
 * Usage:
 *   const ref = useFocusTrap(open, { onEscape: onClose });
 *   return <div ref={ref} role="dialog" ...>...</div>;
 *
 * @param {boolean} active                 - whether the trap is engaged
 * @param {Object}  [opts]
 * @param {Function} [opts.onEscape]       - called on Escape keydown
 * @param {boolean}  [opts.autoFocus=true] - focus the first focusable element on activate
 * @returns {React.RefObject} - attach to the dialog container
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(active, { onEscape, autoFocus = true } = {}) {
  const containerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    if (typeof document === 'undefined') return undefined;

    previouslyFocusedRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return undefined;

    if (autoFocus) {
      const first = container.querySelector(FOCUSABLE_SELECTOR);
      if (first instanceof HTMLElement) {
        first.focus();
      } else {
        container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }

    const handleKey = (event) => {
      if (event.key === 'Escape' && typeof onEscape === 'function') {
        event.stopPropagation();
        onEscape(event);
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = container.querySelectorAll(FOCUSABLE_SELECTOR);
      const focusables = Array.from(nodes).filter((node) => !node.hasAttribute('inert'));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;

      if (event.shiftKey) {
        if (current === first || !container.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKey);
    return () => {
      container.removeEventListener('keydown', handleKey);
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [active, autoFocus, onEscape]);

  return containerRef;
}

export default useFocusTrap;
