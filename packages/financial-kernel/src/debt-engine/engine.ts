/**
 * Canonical monthly roll-forward engine. All facility kinds share this
 * loop; per-kind behavior is delegated to `facilities.ts`. Balloon is
 * computed as the remaining principal at maturity — never a manual plug.
 *
 * Invariant per facility per month:
 *   opening + draw + capitalized - principalPaid - prepaymentPaid = closing
 */

import { Decimal } from '../decimal';
import { prov } from '../provenance';
import type { ProvenanceEntry } from '../types';
import {
  accrueAt,
  drawCapAt,
  resolveRateAt,
  scheduledPrincipalAt,
} from './facilities';
import { addSeries, capPositive, subClampZero, zeros } from './math';
import type {
  DebtScheduleAggregate,
  DSRAConfig,
  FacilityPeriodRow,
  FacilitySchedule,
  FacilitySpec,
  FeeDef,
  PrepaymentRule,
  RefinanceDirective,
} from './types';

export interface RollForwardOptions {
  /** Horizon in months. Required to size output series. */
  readonly totalMonths: number;
  /**
   * Optional debt-service forecast used for DSRA sizing. If absent,
   * DSRA sizes on a rolling next-N-months of interest + scheduled
   * principal derived from the facility itself.
   */
  readonly externalDebtServiceForecast?: readonly Decimal[];
}

interface FeeChargeAtMonth {
  readonly atMonth: number;
  readonly amount: Decimal;
}

function computeFees(spec: FacilitySpec): FeeChargeAtMonth[] {
  const charges: FeeChargeAtMonth[] = [];
  const fees = spec.fees ?? [];
  for (const f of fees) {
    if (f.kind === 'upfront_amount') {
      charges.push({ atMonth: f.atMonth ?? spec.startMonth, amount: Decimal.fromNumber(f.value) });
    } else if (f.kind === 'upfront_pct') {
      charges.push({
        atMonth: f.atMonth ?? spec.startMonth,
        amount: spec.commitment.mulNumber(f.value / 100),
      });
    } else if (f.kind === 'ongoing_annual_pct') {
      // Charged 1/12 per month on current opening; resolved at loop time.
    }
  }
  return charges;
}

function ongoingFeeRateMonthly(spec: FacilitySpec): number {
  const fees = spec.fees ?? [];
  let rate = 0;
  for (const f of fees) {
    if (f.kind === 'ongoing_annual_pct') rate += f.value / 100 / 12;
  }
  return rate;
}

function isPrepaymentAllowed(rule: PrepaymentRule | undefined, spec: FacilitySpec, m: number): boolean {
  if (!rule || rule.policy === 'none') return false;
  const lockoutEnd = spec.startMonth + (rule.lockoutMonths ?? 0);
  if (m < lockoutEnd) return false;
  if (rule.policy === 'scheduled') {
    return (rule.allowedMonths ?? []).includes(m);
  }
  return true;
}

/**
 * DSRA target at month `m`: next-N months of debt-service forecast, or
 * a self-derived proxy using interest on opening balance plus current
 * scheduled principal. Used only for sizing deposits; release policy
 * is handled separately.
 */
function targetDSRAAt(
  cfg: DSRAConfig,
  m: number,
  debtServiceForecast: readonly Decimal[],
): Decimal {
  const months = cfg.monthsOfDebtService;
  if (months <= 0) return Decimal.zero();
  let total = Decimal.zero();
  for (let k = 0; k < months; k++) {
    const idx = m + 1 + k;
    if (idx >= 0 && idx < debtServiceForecast.length) {
      total = total.add(debtServiceForecast[idx]);
    }
  }
  return total;
}

/** Produce a self-derived debt-service forecast for DSRA sizing. */
function forecastDebtServiceSelf(
  spec: FacilitySpec,
  totalMonths: number,
  initialRate: number,
): Decimal[] {
  const out = zeros(totalMonths);
  // Rough forecast: interest on commitment for life, plus level principal
  // over amortization term. Precise enough for DSRA sizing heuristics.
  const start = spec.amortizationStartMonth ?? spec.startMonth + (spec.moratoriumMonths ?? 0);
  const end = spec.amortizationTermMonths
    ? start + spec.amortizationTermMonths
    : spec.maturityMonth;
  const term = Math.max(1, end - start);
  const levelPrincipal = spec.commitment.divInt(term);
  const monthlyInterest = spec.commitment.mulNumber(initialRate / 100 / 12);
  for (let m = spec.startMonth; m < Math.min(totalMonths, spec.maturityMonth + 1); m++) {
    let ds = Decimal.zero();
    if (m >= start && m < end) ds = ds.add(levelPrincipal);
    ds = ds.add(monthlyInterest);
    out[m] = ds;
  }
  return out;
}

/**
 * Monthly roll-forward for a single facility. `openingBalance0` is the
 * balance carried from a predecessor facility (e.g. refinance takeout);
 * normally zero.
 */
export function rollForwardFacility(
  spec: FacilitySpec,
  opts: RollForwardOptions,
  openingBalance0: Decimal = Decimal.zero(),
): FacilitySchedule {
  const totalMonths = opts.totalMonths;
  const rows: FacilityPeriodRow[] = [];
  const upfrontCharges = computeFees(spec);
  const ongoingFeeRate = ongoingFeeRateMonthly(spec);
  const dsraCfg = spec.dsra;
  const initialRate = resolveRateAt(spec.rate, spec.startMonth);

  // Forecast used for DSRA sizing: caller may supply a global one;
  // otherwise we derive a self-forecast.
  const dsForecast = opts.externalDebtServiceForecast
    ?? forecastDebtServiceSelf(spec, totalMonths, initialRate);

  let balance = openingBalance0;
  let remainingCommitment = spec.commitment.sub(openingBalance0);
  if (remainingCommitment.isNegative()) remainingCommitment = Decimal.zero();
  let dsraBalance = Decimal.zero();
  let totalDrawn = openingBalance0;
  let totalInterestPaid = Decimal.zero();
  let totalInterestCapitalized = Decimal.zero();
  let totalPrincipalPaid = Decimal.zero();
  let totalFees = Decimal.zero();
  let totalDebtService = Decimal.zero();

  // Prepayment events indexed by month (first-match).
  const prepayIndex = new Map<number, Decimal>();
  for (const ev of spec.prepaymentEvents ?? []) {
    const prior = prepayIndex.get(ev.atMonth) ?? Decimal.zero();
    prepayIndex.set(ev.atMonth, prior.add(ev.amount));
  }

  for (let m = 0; m < totalMonths; m++) {
    const opening = balance;
    let draw = Decimal.zero();
    let interestAccrued = Decimal.zero();
    let interestPaid = Decimal.zero();
    let interestCapitalized = Decimal.zero();
    let principalPaid = Decimal.zero();
    let prepaymentPaid = Decimal.zero();
    let prepaymentPenalty = Decimal.zero();
    let feesPaid = Decimal.zero();
    let dsraDeposit = Decimal.zero();
    let dsraRelease = Decimal.zero();
    const effRate = resolveRateAt(spec.rate, m);

    if (m < spec.startMonth) {
      rows.push({
        month: m,
        openingBalance: opening,
        draw,
        interestAccrued,
        interestPaid,
        interestCapitalized,
        principalPaid,
        prepaymentPaid,
        prepaymentPenalty,
        feesPaid,
        dsraDeposit,
        dsraRelease,
        dsraBalance,
        closingBalance: opening,
        effectiveAnnualRatePct: 0,
      });
      continue;
    }

    // Upfront fees due this month
    for (const c of upfrontCharges) {
      if (c.atMonth === m) {
        feesPaid = feesPaid.add(c.amount);
      }
    }

    // Draws — only while draw availability exists and stop condition not hit.
    const drawStop = spec.drawStop;
    const drawsAllowed = !drawStop || m < drawStop.stopAtMonth;
    if (drawsAllowed && m <= spec.maturityMonth) {
      if (spec.drawRule.kind === 'bullet_at_origination') {
        if (m === spec.startMonth) {
          draw = remainingCommitment;
        }
      } else {
        draw = drawCapAt(spec.drawRule, m, remainingCommitment);
      }
    }
    balance = balance.add(draw);
    remainingCommitment = subClampZero(remainingCommitment, draw);

    // Interest accrual (on post-draw balance)
    const acc = accrueAt(spec, m, balance, effRate);
    interestAccrued = acc.accrued;
    interestPaid = acc.paid;
    interestCapitalized = acc.capitalized;
    balance = balance.add(interestCapitalized);

    // Ongoing fees charged against opening-balance proxy = current balance.
    if (ongoingFeeRate > 0 && balance.isPositive()) {
      feesPaid = feesPaid.add(balance.mulNumber(ongoingFeeRate));
    }

    // Scheduled principal
    const schedPrincipal = scheduledPrincipalAt(spec, m, balance, effRate);
    principalPaid = capPositive(schedPrincipal, balance);
    balance = subClampZero(balance, principalPaid);

    // Voluntary prepayment at this month
    const prepayReq = prepayIndex.get(m);
    if (prepayReq && prepayReq.isPositive() && isPrepaymentAllowed(spec.prepayment, spec, m)) {
      const applied = capPositive(prepayReq, balance);
      prepaymentPaid = applied;
      const penaltyFrac = spec.prepayment?.penaltyFraction ?? 0;
      if (penaltyFrac > 0) {
        prepaymentPenalty = applied.mulNumber(penaltyFrac);
      }
      balance = subClampZero(balance, prepaymentPaid);
    }

    // Balloon / bullet maturity handling: at maturity, repay remaining balance.
    if (m === spec.maturityMonth && balance.isPositive()) {
      const bullet = balance;
      principalPaid = principalPaid.add(bullet);
      balance = Decimal.zero();
    }

    // DSRA deposits (after debt service computed this month)
    if (dsraCfg) {
      const fundFrom = dsraCfg.fundFromMonth ?? spec.startMonth;
      if (m >= fundFrom) {
        const target = targetDSRAAt(dsraCfg, m, dsForecast);
        const fullBy = dsraCfg.targetFullFundingMonth ?? spec.startMonth + 12;
        const monthsToFull = Math.max(1, fullBy - fundFrom);
        const elapsed = Math.min(monthsToFull, m - fundFrom + 1);
        const scheduled = target.mulNumber(elapsed / monthsToFull);
        if (scheduled.compare(dsraBalance) > 0) {
          dsraDeposit = scheduled.sub(dsraBalance);
          dsraBalance = dsraBalance.add(dsraDeposit);
        } else if (
          dsraCfg.releasePolicy !== 'never' && scheduled.compare(dsraBalance) < 0
        ) {
          const releaseAmt = dsraBalance.sub(scheduled);
          dsraRelease = releaseAmt;
          dsraBalance = subClampZero(dsraBalance, releaseAmt);
        }
      }
      // Final release at maturity
      if (m === spec.maturityMonth && dsraCfg.releasePolicy !== 'never' && dsraBalance.isPositive()) {
        dsraRelease = dsraRelease.add(dsraBalance);
        dsraBalance = Decimal.zero();
      }
    }

    const rowDebtService = interestPaid.add(principalPaid).add(prepaymentPaid).add(feesPaid);

    totalDrawn = totalDrawn.add(draw);
    totalInterestPaid = totalInterestPaid.add(interestPaid);
    totalInterestCapitalized = totalInterestCapitalized.add(interestCapitalized);
    totalPrincipalPaid = totalPrincipalPaid.add(principalPaid).add(prepaymentPaid);
    totalFees = totalFees.add(feesPaid);
    totalDebtService = totalDebtService.add(rowDebtService);

    rows.push({
      month: m,
      openingBalance: opening,
      draw,
      interestAccrued,
      interestPaid,
      interestCapitalized,
      principalPaid,
      prepaymentPaid,
      prepaymentPenalty,
      feesPaid,
      dsraDeposit,
      dsraRelease,
      dsraBalance,
      closingBalance: balance,
      effectiveAnnualRatePct: effRate,
    });
  }

  const provenance: ProvenanceEntry[] = [
    prov(`debt.${spec.id}.schedule`, 'kernel.debtEngine.rollForward', 'canonical monthly roll-forward'),
    prov(`debt.${spec.id}.balloon`, 'kernel.debtEngine.remainingPrincipal', 'balloon = remaining principal at maturity'),
  ];

  return {
    facilityId: spec.id,
    kind: spec.kind,
    rows,
    commitment: spec.commitment,
    totalDrawn,
    totalDebtService,
    totalInterestPaid,
    totalInterestCapitalized,
    totalPrincipalPaid,
    totalFees,
    finalBalance: balance,
    provenance,
  };
}

/**
 * Roll forward a set of facilities, resolving refinance takeouts.
 * Refinance directives cause the originating facility's outstanding
 * balance at `atMonth` to be "transferred" to a replacement facility
 * whose opening balance starts at the takeout.
 */
export function rollForwardFacilities(
  specs: readonly FacilitySpec[],
  opts: RollForwardOptions,
): DebtScheduleAggregate {
  const totalMonths = opts.totalMonths;
  const schedules: FacilitySchedule[] = [];
  const byId = new Map<string, FacilitySpec>();
  for (const s of specs) byId.set(s.id, s);

  // First pass: roll forward facilities that are *not* replacements.
  // Replacements opened by a refinance directive inherit the outstanding
  // of the originator at `atMonth`.
  const replacementOf = new Map<string, { parentId: string; atMonth: number; surplus: boolean }>();
  // Any facility with a `refinance` directive designates a replacement —
  // the `kind` is purely descriptive and does not gate refinance detection.
  for (const s of specs) {
    if (s.refinance) {
      replacementOf.set(s.refinance.replacementSpec.id, {
        parentId: s.refinance.fromFacilityId,
        atMonth: s.refinance.atMonth,
        surplus: s.refinance.retainSurplus ?? false,
      });
    }
  }

  const originatorBalances = new Map<string, Decimal>();

  // Process originators first: any facility not listed as a replacement.
  for (const s of specs) {
    if (replacementOf.has(s.id)) continue;
    // If this facility has a refinance directive, the engine truncates
    // its own schedule at `atMonth` by paying down the balance fully at
    // that month (treated as a full prepayment).
    const withTakeout = attachRefinanceTakeout(s);
    const sched = rollForwardFacility(withTakeout, opts);
    schedules.push(sched);
    // Capture balance handed to replacement: just before takeout month.
    if (s.refinance) {
      const atMonth = s.refinance.atMonth;
      if (atMonth > 0 && atMonth < sched.rows.length) {
        // Opening at takeout month is the amount being refinanced.
        const takeover = sched.rows[atMonth].openingBalance;
        originatorBalances.set(s.id, takeover);
      }
    }
  }

  // Second pass: process replacement facilities with inherited opening balance.
  for (const s of specs) {
    if (!replacementOf.has(s.id)) continue;
    const map = replacementOf.get(s.id)!;
    const inherited = originatorBalances.get(map.parentId) ?? Decimal.zero();
    const sched = rollForwardFacility(s, opts, inherited);
    schedules.push(sched);
  }

  const monthlyInterestPaid = zeros(totalMonths);
  const monthlyPrincipalPaid = zeros(totalMonths);
  const monthlyDebtService = zeros(totalMonths);
  const monthlyDrawn = zeros(totalMonths);
  const closingBalanceByMonth = zeros(totalMonths);
  for (const s of schedules) {
    for (let i = 0; i < s.rows.length && i < totalMonths; i++) {
      const r = s.rows[i];
      monthlyInterestPaid[i] = monthlyInterestPaid[i].add(r.interestPaid);
      monthlyPrincipalPaid[i] = monthlyPrincipalPaid[i].add(r.principalPaid).add(r.prepaymentPaid);
      monthlyDrawn[i] = monthlyDrawn[i].add(r.draw);
      monthlyDebtService[i] = monthlyDebtService[i]
        .add(r.interestPaid)
        .add(r.principalPaid)
        .add(r.prepaymentPaid)
        .add(r.feesPaid);
      closingBalanceByMonth[i] = closingBalanceByMonth[i].add(r.closingBalance);
    }
  }

  return {
    totalMonths,
    facilities: schedules,
    monthlyDebtService,
    monthlyInterestPaid,
    monthlyPrincipalPaid,
    monthlyDrawn,
    closingBalanceByMonth,
    provenance: schedules.flatMap((s) => s.provenance),
  };
}

/**
 * Build a shadow spec that forces the originator to fully repay at its
 * refinance.atMonth, so roll-forward's balloon logic closes it cleanly.
 * The replacement facility inherits the outstanding balance via
 * `openingBalance0`.
 */
function attachRefinanceTakeout(spec: FacilitySpec): FacilitySpec {
  if (!spec.refinance) return spec;
  const at = spec.refinance.atMonth;
  // Set maturity to refinance month so balloon closes cleanly.
  return {
    ...spec,
    maturityMonth: Math.min(spec.maturityMonth, at),
  };
}

export { addSeries as addFacilitySeries };
