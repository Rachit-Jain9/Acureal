/**
 * DSCR sculpting. Produces a custom principal-repayment schedule such
 * that each month's debt service ≤ CFADS / targetDSCR. When CFADS is
 * insufficient to cover even target-DSCR interest, principal for that
 * month is 0 and the shortfall is carried (i.e. scheduled principal
 * pushes to later months). Any residual at maturity is the balloon.
 *
 * Output is a principal-per-month series in ₹ Cr suitable for feeding
 * into an `amortizing_custom` facility.
 */

import { Decimal } from '../decimal';
import { accrueInterestMonthly, zeros } from './math';
import type { FacilitySpec, SculptRequest, SculptResult } from './types';

export function sculptDSCR(
  spec: FacilitySpec,
  req: SculptRequest,
): SculptResult {
  const n = req.cfadsMonthly.length;
  const principalPerMonth = zeros(n);
  const target = req.targetDSCR;
  const tolerance = req.tolerance ?? 1e-4;

  // Forward simulation on a shadow balance to produce principal sized
  // to CFADS / target − interest, clamped to remaining balance. This
  // is a direct sizing (no iteration) and guaranteed to satisfy
  // DSCR ≥ target when CFADS covers interest. Any residual is balloon.
  const amortStart = spec.amortizationStartMonth ?? spec.startMonth + (spec.moratoriumMonths ?? 0);
  let balance = spec.commitment;
  let achievedMin: number | null = null;

  for (let m = 0; m < n; m++) {
    if (m < amortStart) continue;
    if (balance.isZero() || balance.isNegative()) break;
    const rate = spec.rate.kind === 'fixed'
      ? spec.rate.annualPct
      : resolveFloating(spec, m);
    const interest = accrueInterestMonthly(balance, rate, spec.compounding);
    const cfads = req.cfadsMonthly[m];
    const allowedDS = cfads.mulNumber(1 / target);
    const allowedPrincipal = allowedDS.sub(interest);
    const sizedPrincipal = allowedPrincipal.isNegative()
      ? Decimal.zero()
      : allowedPrincipal.compare(balance) > 0
        ? balance
        : allowedPrincipal;
    principalPerMonth[m] = sizedPrincipal;
    balance = balance.sub(sizedPrincipal);
    // Track DSCR actually achieved this month.
    const ds = interest.add(sizedPrincipal);
    if (!ds.isZero()) {
      const dscrMonth = cfads.toNumber() / ds.toNumber();
      if (achievedMin == null || dscrMonth < achievedMin) achievedMin = dscrMonth;
    }
  }

  return {
    facilityId: req.facilityId,
    principalPerMonth,
    achievedMinDSCR: achievedMin ?? Number.POSITIVE_INFINITY,
    iterations: 1,
    converged:
      (achievedMin ?? 0) >= target - Math.max(tolerance, 1e-6),
  };
}

function resolveFloating(spec: FacilitySpec, m: number): number {
  if (spec.rate.kind !== 'floating') return 0;
  const r = spec.rate;
  const ref = m < r.referenceAnnualPct.length ? r.referenceAnnualPct[m] : 0;
  let eff = ref + r.spreadPct;
  const floor = r.floorAnnualPct ?? 0;
  const cap = r.capAnnualPct ?? Number.POSITIVE_INFINITY;
  if (eff < floor) eff = floor;
  if (eff > cap) eff = cap;
  return eff;
}
