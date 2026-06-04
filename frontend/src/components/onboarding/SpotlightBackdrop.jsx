// SpotlightBackdrop — dims the page and cuts a clean window around the current
// tour target, so attention lands on exactly what the coachmark is describing.
//
// One fixed full-screen SVG with a rounded-rect mask cutout (the dim is
// opacity-only — cheap), plus a crisp accent highlight ring that tracks the
// target. Both share the same geometry via useTargetRect, so they move together
// when the step changes. The sidebar/tab targets a tour walks are always
// on-screen, so the geometry change is step-to-step (a deliberate, smooth
// tween) rather than scroll-driven.
//
// z-[110] sits above the page chrome but below the Coachmark (z-[120]); the
// whole layer is pointer-events-none so the highlighted control stays clickable.
// Collapses to an instant snap under prefers-reduced-motion.

import { createPortal } from 'react-dom';
import useTargetRect from '../../hooks/useTargetRect';
import useReducedMotion from '../../hooks/useReducedMotion';

const PAD = 8;
const RADIUS = 10;
const MASK_ID = 'redip-spotlight-mask';

export default function SpotlightBackdrop({ target }) {
  const reduced = useReducedMotion();
  // No scrollIntoView here — the Coachmark owns bringing the target into view.
  const rect = useTargetRect(target);

  // Nothing measurable (target absent / zero-size) — render nothing rather than
  // an orphan dim. useTargetRect measures in a layout effect, so the first
  // painted frame already has a rect; there's no undimmed flash to cover.
  if (!rect) return null;

  const x = Math.max(0, rect.left - PAD);
  const y = Math.max(0, rect.top - PAD);
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;
  const tween = reduced
    ? ''
    : 'transition-all duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)]';

  return createPortal(
    <div className="fixed inset-0 z-[110] pointer-events-none" aria-hidden="true">
      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <mask id={MASK_ID}>
            {/* white = dimmed, black = clear window */}
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={RADIUS} fill="black" className={tween} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask={`url(#${MASK_ID})`} />
      </svg>
      <div
        className={`absolute rounded-[10px] ring-2 ring-accent/60 ${tween}`}
        style={{ left: x, top: y, width: w, height: h }}
      />
    </div>,
    document.body,
  );
}
