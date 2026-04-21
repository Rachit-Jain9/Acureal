/**
 * Unit tests for the capitalStack post-processor.
 *
 * Covers:
 *   - Null branches (debtLTV === 0, debtCoverage === 0)
 *   - Exact shape match (every key present, no extras)
 *   - Rounding parity with legacy (round4 / round2 semantics)
 *   - Waterfall math — tier allocations, equity multiples, zero-equity edge
 *
 * A separate `backend/tests/kernel.parity.test.js` file (to be added in
 * the parity-test step) asserts that the TS output matches the legacy
 * JS engine for all 10 asset classes on a fixed fixture deal.
 */

import {
  buildConstructionLoanCapitalStack,
  buildIncomeAmortizingCapitalStack,
  buildHospitalityCapitalStack,
  buildHospitalityWaterfall,
} from '../src/postprocess/capitalStack';

describe('buildConstructionLoanCapitalStack', () => {
  it('returns null when debtLTV is 0', () => {
    const out = buildConstructionLoanCapitalStack({
      totalCostCr: 100,
      debtDrawnCr: 0,
      debtInterestCr: 0,
      debtLTV: 0,
      debtRatePct: 12,
      debtTenorYears: 5,
    });
    expect(out).toBeNull();
  });

  it('returns null when debtLTV is negative (sanity — legacy treats !>0 as no-debt)', () => {
    const out = buildConstructionLoanCapitalStack({
      totalCostCr: 100,
      debtDrawnCr: 0,
      debtInterestCr: 0,
      debtLTV: -0.1,
      debtRatePct: 12,
      debtTenorYears: 5,
    });
    expect(out).toBeNull();
  });

  it('produces the exact shape legacy emits', () => {
    const out = buildConstructionLoanCapitalStack({
      totalCostCr: 250,
      debtDrawnCr: 162.5,
      debtInterestCr: 18.75,
      debtLTV: 0.65,
      debtRatePct: 12,
      debtTenorYears: 5,
    });
    expect(out).not.toBeNull();
    expect(Object.keys(out!).sort()).toEqual(
      [
        'debtCr',
        'debtInterestCr',
        'debtLTV',
        'debtPct',
        'debtRatePct',
        'debtTenorYears',
        'equityCr',
        'equityPct',
        'totalCostCr',
      ].sort(),
    );
  });

  it('computes equity/debt splits correctly', () => {
    const out = buildConstructionLoanCapitalStack({
      totalCostCr: 250,
      debtDrawnCr: 162.5,
      debtInterestCr: 18.75,
      debtLTV: 0.65,
      debtRatePct: 12,
      debtTenorYears: 5,
    })!;
    expect(out.totalCostCr).toBe(250);
    expect(out.debtCr).toBe(162.5);
    expect(out.equityCr).toBe(87.5);
    expect(out.debtPct).toBe(65);
    expect(out.equityPct).toBe(35);
    expect(out.debtInterestCr).toBe(18.75);
    expect(out.debtLTV).toBe(0.65);
    expect(out.debtRatePct).toBe(12);
    expect(out.debtTenorYears).toBe(5);
  });

  it('rounds money to 4dp and percents to 2dp', () => {
    const out = buildConstructionLoanCapitalStack({
      totalCostCr: 123.456789,
      debtDrawnCr: 80.234567,
      debtInterestCr: 9.123456,
      debtLTV: 0.6487, // 64.87% → should round to 64.87
      debtRatePct: 12,
      debtTenorYears: 5,
    })!;
    // Money — 4dp
    expect(out.totalCostCr).toBe(123.4568);
    expect(out.debtCr).toBe(80.2346);
    expect(out.equityCr).toBe(43.2222);
    expect(out.debtInterestCr).toBe(9.1235);
    // Percents — 2dp
    expect(out.debtPct).toBe(64.87);
    expect(out.equityPct).toBe(35.13);
  });

  it('nulls debtTenorYears when invalid (0, null, negative)', () => {
    for (const tenor of [0, null, -1]) {
      const out = buildConstructionLoanCapitalStack({
        totalCostCr: 100,
        debtDrawnCr: 60,
        debtInterestCr: 5,
        debtLTV: 0.6,
        debtRatePct: 12,
        debtTenorYears: tenor as number | null,
      })!;
      expect(out.debtTenorYears).toBeNull();
    }
  });
});

describe('buildIncomeAmortizingCapitalStack', () => {
  it('returns null when debtCoverage is 0', () => {
    const out = buildIncomeAmortizingCapitalStack({
      totalCostCr: 200,
      debtCoverage: 0,
      interestRatePct: 11,
      amortizationYears: 15,
      dscr: 1.3,
      debtSchedule: [],
    });
    expect(out).toBeNull();
  });

  it('produces the exact income-amortizing shape', () => {
    const schedule = [{ year: 1, principal: 2, interest: 10 }];
    const out = buildIncomeAmortizingCapitalStack({
      totalCostCr: 200,
      debtCoverage: 0.6,
      interestRatePct: 11,
      amortizationYears: 15,
      dscr: 1.3,
      debtSchedule: schedule,
    })!;

    expect(Object.keys(out).sort()).toEqual(
      [
        'amortizationYears',
        'debtCr',
        'debtPct',
        'debtSchedule',
        'dscr',
        'equityCr',
        'equityPct',
        'interestRatePct',
        'totalCostCr',
      ].sort(),
    );

    expect(out.totalCostCr).toBe(200);
    expect(out.debtCr).toBe(120);
    expect(out.equityCr).toBe(80);
    expect(out.debtPct).toBe(60);
    expect(out.equityPct).toBe(40);
    expect(out.interestRatePct).toBe(11);
    expect(out.amortizationYears).toBe(15);
    expect(out.dscr).toBe(1.3);
    expect(out.debtSchedule).toBe(schedule);
  });
});

describe('buildHospitalityCapitalStack', () => {
  const baseWaterfall = {
    lpPct: 90,
    gpPct: 10,
    totalEquityCr: 100,
    lpCapitalCr: 90,
    gpCapitalCr: 10,
    totalDistributionsCr: 200,
    tiers: [
      { name: 'Tier 1 — Return of Capital', hurdlePct: 0, lpSharePct: 90, gpSharePct: 10, lpCr: 90, gpCr: 10 },
      { name: 'Tier 2 — to 10% IRR', hurdlePct: 10, lpSharePct: 90, gpSharePct: 10, lpCr: 27, gpCr: 3 },
      { name: 'Tier 3 — to 15% IRR', hurdlePct: 15, lpSharePct: 80, gpSharePct: 20, lpCr: 16, gpCr: 4 },
      { name: 'Tier 4 — above 15% IRR', hurdlePct: 20, lpSharePct: 70, gpSharePct: 30, lpCr: 35, gpCr: 15 },
    ] as const,
    totalLPCr: 168,
    totalGPCr: 32,
    lpEquityMultiple: 1.8667,
    gpEquityMultiple: 3.2,
  };

  it('is never null — always emits the full bundle', () => {
    const out = buildHospitalityCapitalStack({
      totalCostCr: 500,
      finalConstDebtCr: 300,
      equityCr: 200,
      interestRatePct: 11,
      amortizationYearsHosp: 25,
      dscr: 1.25,
      minDSCR: 1.1,
      debtYieldPct: 9.5,
      debtScheduleHosp: { termLoan: null, refi: null },
      construction: null,
      permanent: null,
      waterfall: baseWaterfall as never,
    });
    expect(out).not.toBeNull();
  });

  it('produces the exact hospitality shape including sub-bundles', () => {
    const out = buildHospitalityCapitalStack({
      totalCostCr: 500,
      finalConstDebtCr: 300,
      equityCr: 200,
      interestRatePct: 11,
      amortizationYearsHosp: 25,
      dscr: 1.25,
      minDSCR: 1.1,
      debtYieldPct: 9.5,
      debtScheduleHosp: {},
      construction: {
        finalConstDebtCr: 300,
        constLoanLTC: 0.6,
        constLoanRatePct: 13,
        constLoanFeesPct: 1.5,
        idcCr: 24,
        refiYear: 3,
      },
      permanent: {
        refiPrincipalCr: 350,
        refiLTV: 0.65,
        refiInterestRate: 10.5,
        refiIOYears: 2,
        refiAmortYears: 20,
        refiYear: 3,
        refiCapRate: 0.09,
        stabilizedValueForRefi: 538.4615,
        refiQuarterlyPayment: 9.75,
        refiTotalInterestCr: 295.1,
        refiBalloonRepaymentCr: 180.3,
      },
      waterfall: baseWaterfall as never,
    });

    expect(Object.keys(out).sort()).toEqual(
      [
        'amortizationYears',
        'construction',
        'debtCr',
        'debtPct',
        'debtSchedule',
        'debtYieldPct',
        'dscr',
        'equityCr',
        'equityPct',
        'interestRatePct',
        'minDSCR',
        'permanent',
        'totalCostCr',
        'waterfall',
      ].sort(),
    );

    expect(out.construction).toEqual({
      principalCr: 300,
      ltcPct: 60,
      ratePct: 13,
      feesPct: 1.5,
      idcCr: 24,
      termYears: 3,
    });

    expect(out.permanent).toEqual({
      principalCr: 350,
      ltvPct: 65,
      ratePct: 10.5,
      ioYears: 2,
      amortYears: 20,
      refiYear: 3,
      sizingCapRate: 0.09,
      stabilizedValueCr: 538.4615,
      quarterlyPaymentCr: 9.75,
      annualDebtServiceCr: 39,
      totalInterestCr: 295.1,
      balloonRepaymentCr: 180.3,
    });

    expect(out.waterfall).toBe(baseWaterfall);
  });

  it('zero-cost edge: emits 0% debt / 100% equity rather than NaN', () => {
    const out = buildHospitalityCapitalStack({
      totalCostCr: 0,
      finalConstDebtCr: 0,
      equityCr: 0,
      interestRatePct: 0,
      amortizationYearsHosp: 0,
      dscr: 0,
      minDSCR: null,
      debtYieldPct: null,
      debtScheduleHosp: null,
      construction: null,
      permanent: null,
      waterfall: baseWaterfall as never,
    });
    expect(out.debtPct).toBe(0);
    expect(out.equityPct).toBe(100);
  });
});

describe('buildHospitalityWaterfall', () => {
  it('return-of-capital tier 1 consumes distributions up to equity', () => {
    // 100 Cr equity, distributions exactly equal equity → all in tier 1
    const cashFlows = [
      -100, 0, 0, 0, 0, // constQ=0 + 4 quarters yr1 (yields 0)
      0, 0, 0, 0,       // yr2 — 0
      0, 0, 0, 0,       // yr3 — 0
      0, 0, 0, 0,       // yr4 — 0
      0, 0, 0, 100,     // yr5 — 100 returned
    ];
    const out = buildHospitalityWaterfall({
      equityCr: 100,
      cashFlows,
      holdPeriodYears: 5,
      constQ: 0,
      lpPct: 0.9,
      gpPct: 0.1,
      tier2Hurdle: 10,
      tier3Hurdle: 15,
      tier4Hurdle: 20,
      tier2PromotePct: 10,
      tier3PromotePct: 20,
      tier4PromotePct: 30,
    });

    expect(out.totalDistributionsCr).toBe(100);
    expect(out.tiers[0].lpCr).toBe(90);
    expect(out.tiers[0].gpCr).toBe(10);
    expect(out.tiers[1].lpCr).toBe(0);
    expect(out.tiers[2].lpCr).toBe(0);
    expect(out.tiers[3].lpCr).toBe(0);
    expect(out.totalLPCr).toBe(90);
    expect(out.totalGPCr).toBe(10);
    expect(out.lpEquityMultiple).toBe(1);
    expect(out.gpEquityMultiple).toBe(1);
  });

  it('tier labels reflect hurdle inputs', () => {
    const out = buildHospitalityWaterfall({
      equityCr: 100,
      cashFlows: [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200],
      holdPeriodYears: 5,
      constQ: 0,
      lpPct: 0.9,
      gpPct: 0.1,
      tier2Hurdle: 8,
      tier3Hurdle: 14,
      tier4Hurdle: 22,
      tier2PromotePct: 10,
      tier3PromotePct: 20,
      tier4PromotePct: 30,
    });
    expect(out.tiers[0].name).toBe('Tier 1 — Return of Capital');
    expect(out.tiers[1].name).toBe('Tier 2 — to 8% IRR');
    expect(out.tiers[2].name).toBe('Tier 3 — to 14% IRR');
    expect(out.tiers[3].name).toBe('Tier 4 — above 14% IRR');
  });

  it('zero LP capital → lpEquityMultiple is null (no divide-by-zero)', () => {
    const out = buildHospitalityWaterfall({
      equityCr: 100,
      cashFlows: [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
      holdPeriodYears: 5,
      constQ: 0,
      lpPct: 0,
      gpPct: 1.0,
      tier2Hurdle: 10,
      tier3Hurdle: 15,
      tier4Hurdle: 20,
      tier2PromotePct: 10,
      tier3PromotePct: 20,
      tier4PromotePct: 30,
    });
    expect(out.lpCapitalCr).toBe(0);
    expect(out.lpEquityMultiple).toBeNull();
    expect(out.gpEquityMultiple).not.toBeNull();
  });

  it('negative cash flow quarters do not contribute to distributions', () => {
    // Legacy: `totalDistributions = reduce((s,v,i) => i===0 ? s : s + Math.max(0, v))`
    // Negative operating quarters are clamped to 0 — they're not treated as returns-of-capital.
    const cashFlows = [-100, -5, 10, -5, 10, 0, 0, 0, 100]; // 1yr const + 2yr ops
    const out = buildHospitalityWaterfall({
      equityCr: 100,
      cashFlows,
      holdPeriodYears: 2,
      constQ: 0,
      lpPct: 0.9,
      gpPct: 0.1,
      tier2Hurdle: 10,
      tier3Hurdle: 15,
      tier4Hurdle: 20,
      tier2PromotePct: 10,
      tier3PromotePct: 20,
      tier4PromotePct: 30,
    });
    // annual[0] = -100 (ignored), annual[1] = max(-5+10-5+10, 0)=10 → contributes,
    //                               annual[2] = max(0+0+0+100, 0)=100 → contributes.
    // Sum = 110.
    expect(out.totalDistributionsCr).toBe(110);
  });

  it('yields 4 tiers with tier2+tier3+tier4 shares complementing promote splits', () => {
    const out = buildHospitalityWaterfall({
      equityCr: 100,
      cashFlows: [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200],
      holdPeriodYears: 5,
      constQ: 0,
      lpPct: 0.9,
      gpPct: 0.1,
      tier2Hurdle: 10,
      tier3Hurdle: 15,
      tier4Hurdle: 20,
      tier2PromotePct: 10,
      tier3PromotePct: 20,
      tier4PromotePct: 30,
    });
    // LP share + GP share within a tier = 100
    expect(out.tiers[1].lpSharePct + out.tiers[1].gpSharePct).toBe(100);
    expect(out.tiers[2].lpSharePct + out.tiers[2].gpSharePct).toBe(100);
    expect(out.tiers[3].lpSharePct + out.tiers[3].gpSharePct).toBe(100);
    // Promote percentages map directly
    expect(out.tiers[1].gpSharePct).toBe(10);
    expect(out.tiers[2].gpSharePct).toBe(20);
    expect(out.tiers[3].gpSharePct).toBe(30);
  });
});
