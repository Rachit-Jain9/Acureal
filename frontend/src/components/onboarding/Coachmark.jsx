// Coachmark — a small anchored pop-up that points at a target element
// elsewhere on the page (typically a sidebar nav item). Positions itself
// to the right of the target by default, flipping below if there isn't
// enough horizontal room. Re-computes position on resize + scroll, fades
// in via requestAnimationFrame, and respects prefers-reduced-motion.

import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '../../design-system';
import useReducedMotion from '../../hooks/useReducedMotion';

const PANEL_WIDTH = 320;
const PANEL_HEIGHT_ESTIMATE = 200;
const OFFSET = 14;

function computePosition(rect) {
  if (!rect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer placement to the right of the target (works perfectly for
  // sidebar nav items, the main use case).
  const fitsRight = vw - rect.right >= PANEL_WIDTH + OFFSET + 16;
  if (fitsRight) {
    const desiredTop = rect.top + rect.height / 2 - PANEL_HEIGHT_ESTIMATE / 2;
    const top = Math.max(
      16,
      Math.min(vh - PANEL_HEIGHT_ESTIMATE - 16, desiredTop),
    );
    return { placement: 'right', left: rect.right + OFFSET, top };
  }

  // Fallback: place below the target, horizontally centred but clamped.
  const desiredLeft = rect.left + rect.width / 2 - PANEL_WIDTH / 2;
  const left = Math.max(16, Math.min(vw - PANEL_WIDTH - 16, desiredLeft));
  return { placement: 'bottom', left, top: rect.bottom + OFFSET };
}

export default function Coachmark({
  target,
  title,
  body,
  step,
  total,
  isFirst = false,
  isLast = false,
  onNext,
  onBack,
  onSkip,
}) {
  const reduced = useReducedMotion();
  const [pos, setPos] = useState(null);
  const [visible, setVisible] = useState(false);

  // Position computation — re-runs when the target changes AND on
  // window resize / scroll so the panel stays glued to the anchor.
  useLayoutEffect(() => {
    const update = () => {
      const el = document.querySelector(target);
      if (!el) {
        setPos(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setPos(null);
        return;
      }
      setPos(computePosition(rect));
    };

    update();

    // Make sure the target is on-screen before we commit to its position.
    const el = document.querySelector(target);
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } catch (_) {
        // older browsers without smooth-scroll options — ignore.
      }
    }

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target]);

  // Fade in once we have a position; reset on target change.
  useEffect(() => {
    setVisible(false);
    if (!pos) return undefined;
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [pos]);

  if (!pos) return null;

  const animate = !reduced;

  const node = (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${PANEL_WIDTH}px` }}
      className={
        'fixed z-[120] rounded-lg border border-hairline bg-bg-elevated shadow-elevated '
        + (animate ? 'transition-[opacity,transform] duration-200 ease-out ' : '')
        + (animate && !visible ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0')
      }
    >
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-content-muted">
            Step {step} of {total}
          </span>
          <button
            type="button"
            aria-label="Skip the tour"
            onClick={onSkip}
            className="-mr-1 -mt-1 rounded p-1 text-content-muted transition-colors duration-150 ease-out
              hover:text-content-secondary
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X size={13} />
          </button>
        </div>
        <h3 className="mt-1 text-sm font-semibold text-content-primary">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-content-secondary">{body}</p>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2">
        <button
          type="button"
          onClick={onSkip}
          className="rounded px-1.5 text-xs font-medium text-content-muted transition-colors duration-150 ease-out
            hover:text-content-secondary
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Skip tour
        </button>
        <div className="flex items-center gap-1.5">
          {!isFirst && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              leftIcon={<ChevronLeft size={12} />}
            >
              Back
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={onNext}
            rightIcon={!isLast ? <ChevronRight size={12} /> : undefined}
          >
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
