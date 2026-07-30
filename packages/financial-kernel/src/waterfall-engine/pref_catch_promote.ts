/**
 * Pref / catch-up / promote tier builder.
 *
 * Produces the canonical four-tier private-equity distribution waterfall
 * used by Acureal JV and outright structures:
 *
 *   1) Return of capital (LP + sponsor pro-rata, capped at contributed capital)
 *   2) Preferred return (LP-only, accrues at `prefRatePct` on unreturned capital)
 *   3) GP catch-up (sponsor receives `catchUpPct` of distributions until the
 *      running pref/catch-up split matches the promote ratio)
 *   4) Promote split (residual split: LP gets 1 - promotePct, sponsor gets promotePct)
 *
 * All four tiers expose a state-aware `demandFn` so the engine does not
 * need to reason about accrued-vs-paid — the closure reads cumulative
 * state each month.
 */

import { Decimal, sum as decSum } from '../decimal';
import type { DemandFn, WaterfallTier } from './types';

export interface PrefCatchPromoteArgs {
  readonly lpId: string;
  readonly sponsorId: string;
  /** LP committed / contributed capital (₹ Cr). */
  readonly lpCapitalCr: Decimal;
  /** Sponsor committed / contributed capital (₹ Cr). */
  readonly sponsorCapitalCr: Decimal;
  /** Preferred-return hurdle, annual percent (e.g. 8 for 8%). */
  readonly prefRatePct: Decimal;
  /** Catch-up percent (typical: 50-100). 100 = full catch-up. */
  readonly catchUpPct: Decimal;
  /** Promote share of residual (sponsor side). Typical: 20 for 80/20. */
  readonly promotePct: Decimal;
  readonly horizonMonths: number;
  /** Priority offsets applied from `basePriority` onward. */
  readonly basePriority?: number;
}

const HUNDRED = Decimal.fromNumber(100);
const TWELVE = Decimal.fromNumber(12);

/**
 * Build tiers using closure-captured cumulative state. The engine passes
 * its `cumulativeByTier` map to each demandFn call, so we read the running
 * totals live.
 */
export function buildPrefCatchPromoteTiers(args: PrefCatchPromoteArgs): WaterfallTier[] {
  const base = args.basePriority ?? 50;
  const totalCapital = args.lpCapitalCr.add(args.sponsorCapitalCr);
  const monthlyPrefRate = args.prefRatePct.div(HUNDRED).div(TWELVE);
  const lpShare = totalCapital.isZero() ? Decimal.zero() : args.lpCapitalCr.div(totalCapital);
  const sponsorShare = totalCapital.isZero() ? Decimal.zero() : args.sponsorCapitalCr.div(totalCapital);

  const lpStk = { id: args.lpId, role: 'lp' as const };
  const sponsorStk = { id: args.sponsorId, role: 'sponsor' as const };

  // Tier 1: Return of capital — pro-rata between LP and sponsor based on
  // contribution, capped at totalCapital.
  const rocDemandFn: DemandFn = ({ cumulativeByTier }) => {
    const paid = cumulativeByTier.get('roc') ?? Decimal.zero();
    const remaining = totalCapital.sub(paid);
    return remaining.isNegative() ? Decimal.zero() : remaining;
  };

  const rocAllocate = ({ amount }: { amount: Decimal }) => ({
    perStakeholder: [
      { stakeholderId: args.lpId, amount: amount.mul(lpShare) },
      {
        stakeholderId: args.sponsorId,
        amount: amount.sub(amount.mul(lpShare)),
      },
    ],
    leftover: Decimal.zero(),
  });

  const rocTier: WaterfallTier = {
    id: 'roc',
    kind: 'return_of_capital',
    priority: base,
    stakeholders: [lpStk, sponsorStk],
    cumulativeCap: totalCapital,
    demandFn: rocDemandFn,
    allocate: rocAllocate,
  };

  // Tier 2: Preferred return — accrues monthly on LP committed capital.
  // We track demand monotonically against original LP capital × rate ×
  // elapsed months; the cumulativeByTier[pref] records what has actually
  // been paid, so unpaid pref carries forward even after ROC is complete.
  // This matches the "commitment-based" pref variant common in real PE
  // waterfalls (vs. the "unreturned-capital" variant which requires
  // carrying an accrued-liability ledger).
  const prefDemandFn: DemandFn = ({ month, cumulativeByTier }) => {
    const totalAccrued = args.lpCapitalCr.mul(monthlyPrefRate).mulNumber(month + 1);
    const paid = cumulativeByTier.get('pref') ?? Decimal.zero();
    const remaining = totalAccrued.sub(paid);
    return remaining.isNegative() ? Decimal.zero() : remaining;
  };

  const prefTier: WaterfallTier = {
    id: 'pref',
    kind: 'preferred_return',
    priority: base + 10,
    stakeholders: [lpStk],
    demandFn: prefDemandFn,
  };

  // Tier 3: Catch-up — sponsor receives `catchUpPct` of distributions until
  // total sponsor promote equals (promotePct / (1 - promotePct)) * LP pref.
  const catchUpFrac = args.catchUpPct.div(HUNDRED);
  const promoteFrac = args.promotePct.div(HUNDRED);
  const catchUpDemandFn: DemandFn = ({ cumulativeByTier }) => {
    const prefPaid = cumulativeByTier.get('pref') ?? Decimal.zero();
    if (prefPaid.isZero()) return Decimal.zero();
    // Target sponsor catch-up so that sponsor_catchup / (prefPaid + sponsor_catchup) = promoteFrac
    // sponsor_catchup = prefPaid * promoteFrac / (1 - promoteFrac)
    const oneMinusPromote = Decimal.fromNumber(1).sub(promoteFrac);
    if (oneMinusPromote.isZero() || oneMinusPromote.isNegative()) return Decimal.zero();
    const target = prefPaid.mul(promoteFrac).div(oneMinusPromote);
    const paid = cumulativeByTier.get('catchup') ?? Decimal.zero();
    const remaining = target.sub(paid);
    if (remaining.isNegative() || remaining.isZero()) return Decimal.zero();
    // Throttle by catchUpPct of the month-level flow — approximated by a
    // large-but-finite demand (engine scales down when supply is short).
    return remaining.mul(catchUpFrac).mulNumber(10);
  };

  const catchUpTier: WaterfallTier = {
    id: 'catchup',
    kind: 'catch_up',
    priority: base + 20,
    stakeholders: [sponsorStk],
    demandFn: catchUpDemandFn,
  };

  // Tier 4: Promote / residual split — effectively unbounded demand, split
  // LP (1 - promotePct) : sponsor promotePct via allocate hook.
  const residualDemandFn: DemandFn = () => Decimal.fromNumber(1e12);
  const residualAllocate = ({ amount }: { amount: Decimal }) => {
    const spAmt = amount.mul(promoteFrac);
    const lpAmt = amount.sub(spAmt);
    return {
      perStakeholder: [
        { stakeholderId: args.lpId, amount: lpAmt },
        { stakeholderId: args.sponsorId, amount: spAmt },
      ],
      leftover: Decimal.zero(),
    };
  };

  const promoteTier: WaterfallTier = {
    id: 'promote',
    kind: 'promote',
    priority: base + 30,
    stakeholders: [lpStk, sponsorStk],
    demandFn: residualDemandFn,
    allocate: residualAllocate,
  };

  return [rocTier, prefTier, catchUpTier, promoteTier];
}

/**
 * Sum distributions across a waterfall result for a single stakeholder.
 * Convenience used by orchestration KPIs and tests.
 */
export function sumStakeholder(
  rows: readonly { readonly stakeholderId: string; readonly amount: Decimal }[],
  stakeholderId: string,
): Decimal {
  return decSum(rows.filter((r) => r.stakeholderId === stakeholderId).map((r) => r.amount));
}
