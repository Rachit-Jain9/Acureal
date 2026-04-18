/**
 * Per-kind facility behavior: draw caps, rate resolution, scheduled
 * principal component. The monthly roll-forward in `engine.ts` delegates
 * to these helpers so the main loop is agnostic to facility kind.
 */

import { Decimal } from '../decimal';
import {
  accrueInterestMonthly,
  capPositive,
  emiPrincipalComponent,
  subClampZero,
} from './math';
import type {
  CustomAmortization,
  DrawRule,
  FacilitySpec,
  RateModel,
} from './types';

/** Resolve the effective annual rate at month `m`. */
export function resolveRateAt(rate: RateModel, m: number): number {
  if (rate.kind === 'fixed') return rate.annualPct;
  const ref = m >= 0 && m < rate.referenceAnnualPct.length ? rate.referenceAnnualPct[m] : 0;
  let eff = ref + rate.spreadPct;
  const floor = rate.floorAnnualPct ?? 0;
  const cap = rate.capAnnualPct ?? Number.POSITIVE_INFINITY;
  if (eff < floor) eff = floor;
  if (eff > cap) eff = cap;
  return eff;
}

/** Compute the draw cap for month `m` given drawRule, commitment, remaining availability. */
export function drawCapAt(
  rule: DrawRule,
  m: number,
  remainingAvailability: Decimal,
): Decimal {
  if (remainingAvailability.isZero() || remainingAvailability.isNegative()) {
    return Decimal.zero();
  }
  switch (rule.kind) {
    case 'schedule': {
      const v = m >= 0 && m < rule.perMonth.length ? rule.perMonth[m] : Decimal.zero();
      return capPositive(v, remainingAvailability);
    }
    case 'basis_linked': {
      const b = m >= 0 && m < rule.basis.length ? rule.basis[m] : Decimal.zero();
      if (b.isZero() || b.isNegative()) return Decimal.zero();
      const frac = rule.perMonthCapFraction ?? 1;
      return capPositive(b.mulNumber(frac), remainingAvailability);
    }
    case 'bullet_at_origination':
      // Bullet draws fully at startMonth only; engine handles this by
      // recognising startMonth and ignoring this helper after month 0.
      return remainingAvailability;
  }
}

/**
 * Scheduled principal component for a given facility kind at month `m`,
 * given opening balance, annual pct, and remaining amortization term.
 * Returns zero for interest-only periods, moratorium, and bullet maturity
 * handling (balloon is applied at maturity by the engine itself).
 */
export function scheduledPrincipalAt(
  spec: FacilitySpec,
  m: number,
  openingBalance: Decimal,
  effectiveRatePct: number,
): Decimal {
  if (openingBalance.isZero() || openingBalance.isNegative()) return Decimal.zero();
  const amortStart = spec.amortizationStartMonth ?? spec.startMonth + (spec.moratoriumMonths ?? 0);
  if (m < amortStart) return Decimal.zero();
  if (m >= spec.maturityMonth) return Decimal.zero(); // balloon handled separately

  const freq = spec.repaymentFrequencyMonths ?? 1;
  // Only pay principal on frequency boundary (relative to amortStart).
  const relative = m - amortStart;
  const isFrequencyTick = relative % freq === 0;
  if (!isFrequencyTick) return Decimal.zero();

  const termEnd = spec.amortizationTermMonths
    ? amortStart + spec.amortizationTermMonths
    : spec.maturityMonth;
  const remainingMonthsForEMI = Math.max(0, termEnd - m);

  switch (spec.kind) {
    case 'interest_only':
    case 'bullet':
      return Decimal.zero();
    case 'balloon':
      // Treated as interest-only until maturity; balloon applied by engine.
      return Decimal.zero();
    case 'amortizing_emi': {
      if (remainingMonthsForEMI <= 0) return openingBalance; // full repay at termEnd
      // Level EMI principal per *period*; for freq > 1, each tick pays the
      // freq-month aggregate principal.
      const periodPrincipal = emiPrincipalComponent(
        openingBalance,
        effectiveRatePct,
        remainingMonthsForEMI,
      );
      // When freq > 1 we aggregate freq months of principal for each tick.
      // Approximation: freq × monthly principal component. Kept simple
      // because interest is still accrued monthly and the engine resolves
      // the final balloon at maturity if there's any rounding drift.
      return capPositive(periodPrincipal.mulNumber(freq), openingBalance);
    }
    case 'amortizing_custom': {
      const custom = spec.customAmortization;
      if (!custom) return Decimal.zero();
      const v = m >= 0 && m < custom.principalPerMonth.length
        ? custom.principalPerMonth[m]
        : Decimal.zero();
      return capPositive(v, openingBalance);
    }
    case 'refinance':
      return Decimal.zero();
  }
}

/**
 * Interest accrual for a facility at month `m`. Honors moratorium and
 * grace period (both produce a zero cash-interest charge; under
 * moratorium with capitalize flag the engine converts accrual into
 * capitalized principal).
 */
export function accrueAt(
  spec: FacilitySpec,
  m: number,
  openingBalance: Decimal,
  effectiveRatePct: number,
): {
  accrued: Decimal;
  paid: Decimal;
  capitalized: Decimal;
} {
  const accrued = accrueInterestMonthly(openingBalance, effectiveRatePct, spec.compounding);
  if (accrued.isZero()) return { accrued, paid: Decimal.zero(), capitalized: Decimal.zero() };

  const graceEnd = spec.startMonth + (spec.gracePeriodMonths ?? 0);
  if (m < graceEnd) {
    // During grace: no cash interest charged; treated as deferred (capitalized).
    return { accrued, paid: Decimal.zero(), capitalized: accrued };
  }

  const moratoriumEnd = spec.startMonth + (spec.moratoriumMonths ?? 0);
  if (m < moratoriumEnd) {
    if (spec.capitalizeInterestDuringMoratorium) {
      return { accrued, paid: Decimal.zero(), capitalized: accrued };
    }
    // Moratorium with cash-interest: pay current, no principal.
    return { accrued, paid: accrued, capitalized: Decimal.zero() };
  }

  // Post-moratorium: interest is paid in cash.
  return { accrued, paid: accrued, capitalized: Decimal.zero() };
}

export function makeCustomAmortization(values: readonly Decimal[]): CustomAmortization {
  return { principalPerMonth: values };
}

export function cloneSubClampZero(a: Decimal, b: Decimal): Decimal {
  return subClampZero(a, b);
}
