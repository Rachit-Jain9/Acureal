/**
 * Centralized invalidation for the "deal posture" query surface.
 *
 * REDIP renders a deal's risk posture in many places — the per-deal Risk
 * Radar, the Risk Score, the DD checklist, the Approvals tracker, the
 * professional sign-off board, the unified Deal Workspace payload (whose
 * K-RERA cockpit reads signed sign-offs as verified evidence), the
 * dashboard's KPI strip, and the Portfolio Risk Radar tile. All of them are
 * derived from the same source tables: risk_flags, dd_items, approval_items,
 * deal_signoffs.
 *
 * Before this helper, each mutation hook listed the canonical set of
 * `queryClient.invalidateQueries(...)` calls inline. The natural drift was:
 *   - DD-item mutations forgot to invalidate ['risk-radar', dealId] → the
 *     radar showed stale data after marking a required DD item completed.
 *   - Approval-item mutations forgot to invalidate ['risk-radar', dealId]
 *     → expiring an approval didn't flag the Approvals failure mode until
 *     the user clicked into the Risk tab.
 *   - Risk-flag mutations forgot to invalidate ['portfolio-risk-radar'] →
 *     the dashboard tile stayed stale.
 *
 * Centralizing the set into this single helper means a future hook can't
 * accidentally miss a key, and adding a new derived query (say, a
 * "deal-readiness" rollup) is a one-line edit here that propagates to
 * every consumer.
 *
 * Usage:
 *   import { invalidateDealPosture } from './dealPostureQueries';
 *   const qc = useQueryClient();
 *   // … inside an `onSuccess`:
 *   invalidateDealPosture(qc, dealId);
 */

// Per-deal keys — only invalidate when we know which deal changed.
const POSTURE_KEYS_FOR_DEAL = [
  'risk-radar',
  'risk-flags',
  'risk-score',
  'dd-items',
  'dd-score',
  'approvals',
  'signoffs',
  'deal-workspace',
];

// Cross-deal rollups — invalidated on every posture-touching mutation
// because we can't predict which rollup tile the user is looking at.
const PORTFOLIO_ROLLUP_KEYS = [
  'portfolio-risk-radar',
  'dashboard',
];

/**
 * Invalidate every query whose data depends on a deal's risk posture.
 *
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {string|undefined|null} dealId Deal id; if falsy, only the
 *   portfolio-level rollups are invalidated.
 */
export function invalidateDealPosture(qc, dealId) {
  if (dealId) {
    for (const key of POSTURE_KEYS_FOR_DEAL) {
      qc.invalidateQueries({ queryKey: [key, dealId] });
    }
  }
  for (const key of PORTFOLIO_ROLLUP_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Invalidate only the cross-deal rollups. Use this when a mutation affects
 * the portfolio dashboard but is not tied to a specific deal's posture (e.g.
 * archive/restore — the per-deal posture data didn't change, but whether
 * that deal counts toward the portfolio totals did).
 *
 * @param {import('@tanstack/react-query').QueryClient} qc
 */
export function invalidatePortfolioRollups(qc) {
  for (const key of PORTFOLIO_ROLLUP_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

// Exported for tests so the helper's contract is pinnable.
export { POSTURE_KEYS_FOR_DEAL, PORTFOLIO_ROLLUP_KEYS };
