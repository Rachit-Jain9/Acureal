import { useReducedMotion } from './useReducedMotion';

/**
 * Standard recharts animation props, gated on `prefers-reduced-motion`.
 *
 * Spread onto any recharts series (`<Bar>`, `<Line>`, `<Area>`, `<Pie>`) so its
 * first-render draw-in collapses to instant for reduced-motion users
 * (`docs/FRONTEND_GUIDELINES.md` §9) while everyone else keeps the animation.
 * Existing per-series `animationDuration` / `animationEasing` are preserved —
 * this only toggles whether the animation runs, so there is no visual change
 * for users who have not requested reduced motion.
 *
 *   const chartAnim = useChartAnim();
 *   <Bar dataKey="value" {...chartAnim} />
 *
 * One shared source of truth for chart motion so every recharts surface behaves
 * identically (the dashboard charts use the same `useReducedMotion` gate).
 */
export function useChartAnim() {
  const reduced = useReducedMotion();
  return { isAnimationActive: !reduced };
}

export default useChartAnim;
