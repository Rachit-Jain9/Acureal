// AmountReadout — the muted, unit-aware "what did I just type" line shown beneath
// a large-number input. Echoes the value in Indian form (grouped digits + a ₹/
// scale figure) so a fat-fingered zero is obvious at a glance.
//
//   <AmountReadout value={inputs.landCostCr} kind="rupeeCrore" />
//   53567890 in a ₹/acre field → "5,35,67,890 · ₹5.36 Cr"
//   25.5 in a ₹ Cr field       → "₹25.50 Cr"
//
// Design notes:
//   • The input itself is never reformatted — this is a separate line, so there
//     is no controlled-input caret hazard and submit/parse logic is untouched.
//   • The ₹ scale figure count-ups toward its new value (600ms ease-out via
//     useCountUp, which snaps under prefers-reduced-motion). The grouped digits
//     update instantly so they stay readable mid-animation. Areas don't animate.
//   • Always renders a min-height <p> so toggling between money and %/ratio
//     fields causes zero layout shift (CLS).
//   • Not an aria-live region: announcing a reformatted echo on every keystroke
//     is noise; the <input> already conveys the value to assistive tech.

import clsx from 'clsx';
import { describeAmount, formatAmountScale } from '../../utils/format';
import { useCountUp } from '../../hooks/useCountUp';

export default function AmountReadout({ value, kind, unitSuffix, className }) {
  const desc = describeAmount(value, kind);

  // Hook order must stay stable, so always call useCountUp. When there's no
  // animatable scale (areas, or nothing to show) the target is 0 and the
  // animated value is unused.
  const animatable = desc?.scaleUnit != null && desc?.scaleValue != null;
  const animated = useCountUp(animatable ? desc.scaleValue : 0);

  const base = 'mt-1 min-h-[1.125rem] text-xs text-content-muted tabular-nums';

  if (!desc) {
    return <p data-testid="amount-readout" className={clsx(base, className)} aria-hidden="true" />;
  }

  const compact = animatable ? formatAmountScale(animated, desc.scaleUnit) : desc.compact;
  const segments = [desc.grouped, compact].filter(Boolean);
  let text = segments.join('  ·  ');
  if (unitSuffix) text += ` ${unitSuffix}`;

  return <p data-testid="amount-readout" className={clsx(base, className)}>{text}</p>;
}
