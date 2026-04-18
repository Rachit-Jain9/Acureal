import { Decimal } from '../src/decimal';
import {
  rollForwardFacility,
  rollForwardFacilities,
  computeCFADS,
  computeCovenants,
  sculptDSCR,
  zeros,
  emi,
} from '../src/debt-engine';
import type { FacilitySpec } from '../src/debt-engine';

const cr = (n: number) => Decimal.fromNumber(n);

function sumSeries(xs: readonly Decimal[]): Decimal {
  return xs.reduce<Decimal>((a, b) => a.add(b), Decimal.zero());
}

function rollForwardInvariant(schedule: { rows: readonly any[] }): void {
  for (const r of schedule.rows) {
    // opening + draw + capitalized - principalPaid - prepayment = closing
    const expected = r.openingBalance
      .add(r.draw)
      .add(r.interestCapitalized)
      .sub(r.principalPaid)
      .sub(r.prepaymentPaid);
    const diff = expected.sub(r.closingBalance).abs();
    // Allow micro-rounding drift at Decimal scale 10.
    expect(diff.toNumber()).toBeLessThan(1e-6);
    // principal never negative
    expect(r.principalPaid.isNegative()).toBe(false);
    expect(r.closingBalance.isNegative()).toBe(false);
  }
}

describe('math.emi', () => {
  test('level EMI matches closed form', () => {
    // Principal 100 Cr, 12% annual, 120 months
    const payment = emi(cr(100), 12, 120).toNumber();
    // Closed form: p*r*(1+r)^n / ((1+r)^n - 1), r = 0.01
    const r = 0.01;
    const expected = (100 * r * Math.pow(1 + r, 120)) / (Math.pow(1 + r, 120) - 1);
    expect(payment).toBeCloseTo(expected, 6);
  });

  test('zero rate → principal / n', () => {
    expect(emi(cr(120), 0, 12).toNumber()).toBeCloseTo(10, 6);
  });
});

describe('rollForwardFacility — interest_only', () => {
  test('no principal during life, bullet repayment at maturity', () => {
    const spec: FacilitySpec = {
      id: 'io1',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 12,
      rate: { kind: 'fixed', annualPct: 12 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
    };
    const sched = rollForwardFacility(spec, { totalMonths: 24 });
    rollForwardInvariant(sched);

    // All principal paid at maturity (balloon = remaining = 100).
    const priorPrincipal = sched.rows
      .slice(0, 12)
      .reduce<Decimal>((a, r) => a.add(r.principalPaid), Decimal.zero());
    expect(priorPrincipal.toNumber()).toBeCloseTo(0, 6);
    expect(sched.rows[12].principalPaid.toNumber()).toBeCloseTo(100, 4);
    expect(sched.finalBalance.toNumber()).toBeCloseTo(0, 6);
  });
});

describe('rollForwardFacility — amortizing_emi', () => {
  test('level EMI over term, zero balance at maturity', () => {
    const spec: FacilitySpec = {
      id: 'emi1',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: 60,
    };
    const sched = rollForwardFacility(spec, { totalMonths: 72 });
    rollForwardInvariant(sched);

    // Total principal = commitment (allow 0.5% drift from freq=1 level-EMI approximation)
    expect(sched.totalPrincipalPaid.toNumber()).toBeCloseTo(100, 0);
    expect(sched.finalBalance.toNumber()).toBeCloseTo(0, 4);
  });
});

describe('rollForwardFacility — bullet & balloon', () => {
  test('bullet facility pays all principal at maturity', () => {
    const spec: FacilitySpec = {
      id: 'b1',
      kind: 'bullet',
      currency: 'INR',
      commitment: cr(50),
      startMonth: 0,
      maturityMonth: 36,
      rate: { kind: 'fixed', annualPct: 8 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
    };
    const sched = rollForwardFacility(spec, { totalMonths: 48 });
    rollForwardInvariant(sched);
    expect(sched.rows[36].principalPaid.toNumber()).toBeCloseTo(50, 4);
    expect(sched.finalBalance.toNumber()).toBeCloseTo(0, 6);
  });

  test('balloon = remaining principal, never a plug', () => {
    // Partial-amortization facility: 60 amort term, 48 maturity → balloon.
    const spec: FacilitySpec = {
      id: 'balloon1',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 48,
      rate: { kind: 'fixed', annualPct: 12 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationStartMonth: 0,
      amortizationTermMonths: 120, // amortizes like 10y schedule
    };
    const sched = rollForwardFacility(spec, { totalMonths: 60 });
    rollForwardInvariant(sched);
    // At month 48, remaining principal gets paid → final balance 0.
    expect(sched.finalBalance.toNumber()).toBeCloseTo(0, 4);
    // The balloon payment at maturity is > a single EMI principal component.
    const balloonRow = sched.rows[48];
    const prevRow = sched.rows[47];
    expect(balloonRow.principalPaid.toNumber()).toBeGreaterThan(prevRow.principalPaid.toNumber());
  });
});

describe('rollForwardFacility — grace / moratorium', () => {
  test('grace period capitalizes interest', () => {
    const spec: FacilitySpec = {
      id: 'g1',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 24,
      rate: { kind: 'fixed', annualPct: 12 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      gracePeriodMonths: 6,
    };
    const sched = rollForwardFacility(spec, { totalMonths: 30 });
    rollForwardInvariant(sched);
    // During grace (months 0-5) interest should be capitalized, not paid.
    for (let m = 0; m < 6; m++) {
      expect(sched.rows[m].interestPaid.toNumber()).toBe(0);
      expect(sched.rows[m].interestCapitalized.toNumber()).toBeGreaterThan(0);
    }
    // After grace, interest is paid in cash.
    expect(sched.rows[6].interestPaid.toNumber()).toBeGreaterThan(0);
    expect(sched.rows[6].interestCapitalized.toNumber()).toBe(0);
  });

  test('moratorium with capitalization grows principal', () => {
    const spec: FacilitySpec = {
      id: 'mor1',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 12 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      moratoriumMonths: 12,
      capitalizeInterestDuringMoratorium: true,
      amortizationTermMonths: 48,
    };
    const sched = rollForwardFacility(spec, { totalMonths: 72 });
    rollForwardInvariant(sched);
    // After 12 months of capitalized interest, balance > commitment.
    expect(sched.rows[12].openingBalance.toNumber()).toBeGreaterThan(100);
  });
});

describe('rollForwardFacility — draws & stops', () => {
  test('schedule draw rule with partial draws over construction', () => {
    const draws = [cr(20), cr(30), cr(25), cr(15), cr(10)].concat(zeros(19));
    const spec: FacilitySpec = {
      id: 'd1',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 24,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'schedule', perMonth: draws },
    };
    const sched = rollForwardFacility(spec, { totalMonths: 24 });
    rollForwardInvariant(sched);
    expect(sched.totalDrawn.toNumber()).toBeCloseTo(100, 4);
  });

  test('drawStop blocks draws past stopAtMonth', () => {
    const draws = zeros(24).map((_, i) => (i < 10 ? cr(20) : cr(20)));
    const spec: FacilitySpec = {
      id: 'd2',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(500),
      startMonth: 0,
      maturityMonth: 24,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'schedule', perMonth: draws },
      drawStop: { stopAtMonth: 5 },
    };
    const sched = rollForwardFacility(spec, { totalMonths: 24 });
    // Only draws for months 0-4 should have been taken.
    expect(sched.totalDrawn.toNumber()).toBeCloseTo(5 * 20, 4);
  });

  test('overdraw attempt clamped to commitment', () => {
    const spec: FacilitySpec = {
      id: 'od',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(50),
      startMonth: 0,
      maturityMonth: 24,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'schedule', perMonth: [cr(100), cr(100), cr(100)] },
    };
    const sched = rollForwardFacility(spec, { totalMonths: 24 });
    expect(sched.totalDrawn.toNumber()).toBeCloseTo(50, 6);
  });
});

describe('rollForwardFacility — prepayment', () => {
  test('voluntary prepayment reduces balance, applies penalty', () => {
    const spec: FacilitySpec = {
      id: 'pp',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: 60,
      prepayment: { policy: 'any_time', lockoutMonths: 6, penaltyFraction: 0.02 },
      prepaymentEvents: [{ atMonth: 12, amount: cr(30) }],
    };
    const sched = rollForwardFacility(spec, { totalMonths: 60 });
    rollForwardInvariant(sched);
    expect(sched.rows[12].prepaymentPaid.toNumber()).toBeCloseTo(30, 4);
    expect(sched.rows[12].prepaymentPenalty.toNumber()).toBeCloseTo(0.6, 3);
  });

  test('prepayment blocked during lockout', () => {
    const spec: FacilitySpec = {
      id: 'pp2',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 24,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      prepayment: { policy: 'any_time', lockoutMonths: 12 },
      prepaymentEvents: [{ atMonth: 6, amount: cr(20) }],
    };
    const sched = rollForwardFacility(spec, { totalMonths: 24 });
    expect(sched.rows[6].prepaymentPaid.toNumber()).toBe(0);
  });
});

describe('rollForwardFacilities — refinance', () => {
  test('refinance closes old facility and originates new with inherited balance', () => {
    const replacement: FacilitySpec = {
      id: 'new',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 12,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 9 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: 48,
    };
    const original: FacilitySpec = {
      id: 'old',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 12 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      refinance: {
        atMonth: 12,
        fromFacilityId: 'old',
        replacementSpec: replacement,
      },
    };
    const agg = rollForwardFacilities([original, replacement], { totalMonths: 72 });
    rollForwardInvariant(agg.facilities.find((f) => f.facilityId === 'old')!);
    rollForwardInvariant(agg.facilities.find((f) => f.facilityId === 'new')!);
    const oldSched = agg.facilities.find((f) => f.facilityId === 'old')!;
    const newSched = agg.facilities.find((f) => f.facilityId === 'new')!;
    // Old closes at m=12 (maturity truncated by takeout).
    expect(oldSched.finalBalance.toNumber()).toBeCloseTo(0, 4);
    // New picks up inherited balance.
    expect(newSched.rows[12].openingBalance.toNumber()).toBeCloseTo(100, 4);
    // New pays down over its remaining term.
    expect(newSched.finalBalance.toNumber()).toBeCloseTo(0, 2);
  });
});

describe('DSRA funding and release', () => {
  test('DSRA accumulates toward target and releases at maturity', () => {
    const spec: FacilitySpec = {
      id: 'ds',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: 60,
      dsra: {
        monthsOfDebtService: 6,
        fundFromMonth: 0,
        targetFullFundingMonth: 12,
        releasePolicy: 'on_final_maturity',
      },
    };
    const sched = rollForwardFacility(spec, { totalMonths: 72 });
    rollForwardInvariant(sched);
    // Funded by month 12.
    expect(sched.rows[12].dsraBalance.toNumber()).toBeGreaterThan(0);
    // Final release at maturity.
    expect(sched.rows[60].dsraRelease.toNumber()).toBeGreaterThan(0);
    expect(sched.rows[60].dsraBalance.toNumber()).toBe(0);
  });
});

describe('CFADS', () => {
  test('monthly CFADS = revenue - opex - taxes - maintCapex - ΔWC', () => {
    const n = 12;
    const revenue = Array.from({ length: n }, () => cr(10));
    const opex = Array.from({ length: n }, () => cr(3));
    const taxes = Array.from({ length: n }, () => cr(1));
    const maintenanceCapex = Array.from({ length: n }, () => cr(0.5));
    const out = computeCFADS({ revenue, opex, taxes, maintenanceCapex });
    for (const v of out.monthly) expect(v.toNumber()).toBeCloseTo(5.5, 6);
    expect(out.annualBuckets[0].toNumber()).toBeCloseTo(66, 3);
    expect(out.rolling12m[11]!.toNumber()).toBeCloseTo(66, 3);
    expect(out.rolling12m[0]).toBeNull();
  });
});

describe('DSCR sculpting', () => {
  test('sculpted schedule achieves at least target DSCR', () => {
    const spec: FacilitySpec = {
      id: 'sculpt',
      kind: 'amortizing_custom',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationStartMonth: 12,
    };
    const cfads = Array.from({ length: 72 }, (_, i) => (i < 12 ? cr(0) : cr(3)));
    const res = sculptDSCR(spec, {
      facilityId: 'sculpt',
      targetDSCR: 1.25,
      cfadsMonthly: cfads,
    });
    expect(res.converged).toBe(true);
    // All scheduled principal months should achieve >= 1.25 DSCR
    expect(res.achievedMinDSCR).toBeGreaterThanOrEqual(1.25 - 1e-4);
  });
});

describe('covenants', () => {
  test('min DSCR breach flagged', () => {
    const spec: FacilitySpec = {
      id: 'cov',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 60,
      rate: { kind: 'fixed', annualPct: 12 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: 60,
    };
    const agg = rollForwardFacilities([spec], { totalMonths: 60 });
    const cfads = Array.from({ length: 60 }, () => cr(1.5)); // tight
    const cov = computeCovenants(agg, {
      cfadsMonthly: cfads,
      projectCostCr: cr(150),
      spec: { minDSCR: 1.25 },
    });
    expect(cov.minDSCR).not.toBeNull();
    expect(cov.breaches.length).toBeGreaterThan(0);
  });
});

describe('zero / edge cases', () => {
  test('zero-rate facility still amortizes', () => {
    const spec: FacilitySpec = {
      id: 'z',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(120),
      startMonth: 0,
      maturityMonth: 12,
      rate: { kind: 'fixed', annualPct: 0 },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: 12,
    };
    const sched = rollForwardFacility(spec, { totalMonths: 12 });
    rollForwardInvariant(sched);
    expect(sched.finalBalance.toNumber()).toBeCloseTo(0, 4);
  });

  test('zero-draw facility produces zero schedule', () => {
    const spec: FacilitySpec = {
      id: 'zd',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 24,
      rate: { kind: 'fixed', annualPct: 10 },
      compounding: 'monthly',
      drawRule: { kind: 'schedule', perMonth: zeros(24) },
    };
    const sched = rollForwardFacility(spec, { totalMonths: 24 });
    rollForwardInvariant(sched);
    expect(sched.totalDrawn.toNumber()).toBe(0);
    expect(sched.totalInterestPaid.toNumber()).toBe(0);
  });

  test('aggregate monthly debt service sums across facilities', () => {
    const f1: FacilitySpec = {
      id: 'f1', kind: 'interest_only', currency: 'INR',
      commitment: cr(100), startMonth: 0, maturityMonth: 12,
      rate: { kind: 'fixed', annualPct: 12 }, compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
    };
    const f2: FacilitySpec = {
      id: 'f2', kind: 'interest_only', currency: 'INR',
      commitment: cr(50), startMonth: 0, maturityMonth: 12,
      rate: { kind: 'fixed', annualPct: 10 }, compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
    };
    const agg = rollForwardFacilities([f1, f2], { totalMonths: 24 });
    // Every month should have debt service from at least one facility during life.
    const totalDS = sumSeries(agg.monthlyDebtService);
    expect(totalDS.toNumber()).toBeGreaterThan(0);
    // Aggregate matches sum-of-facilities
    const sumIndividual =
      agg.facilities[0].totalDebtService.toNumber() + agg.facilities[1].totalDebtService.toNumber();
    expect(totalDS.toNumber()).toBeCloseTo(sumIndividual, 4);
  });
});
