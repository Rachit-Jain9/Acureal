/**
 * Reconciliation against the legacy single-EMI DSCR formula used in
 * `backend/src/engines/financial.engine.js`:
 *
 *   annualEMI = p * r * (1+r)^n / ((1+r)^n - 1)
 *   legacyDSCR = stabilizedNOI / annualEMI
 *
 * We confirm that the new facility-based engine produces the same total
 * debt service over a full year (within rounding tolerance) when
 * configured with equivalent inputs. Current deals are only used as
 * input-shape sanity cases, never as modelling assumptions.
 */

import { Decimal } from '../src/decimal';
import {
  rollForwardFacility,
  computeCFADS,
  computeCovenants,
  rollForwardFacilities,
} from '../src/debt-engine';
import type { FacilitySpec } from '../src/debt-engine';

const cr = (n: number) => Decimal.fromNumber(n);

describe('legacy DSCR parity', () => {
  test('annual debt service of an amortizing facility matches closed-form EMI * 12', () => {
    const principal = 100;
    const rateAnnualPct = 10;
    const termMonths = 60;

    const r = rateAnnualPct / 100 / 12;
    const monthlyEMI = (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
    const expectedAnnualDS = monthlyEMI * 12;

    const spec: FacilitySpec = {
      id: 'recon-emi',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(principal),
      startMonth: 0,
      maturityMonth: termMonths,
      rate: { kind: 'fixed', annualPct: rateAnnualPct },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: termMonths,
    };
    const sched = rollForwardFacility(spec, { totalMonths: termMonths });
    // Sum first-12-month debt service
    let y1 = 0;
    for (let m = 0; m < 12; m++) {
      y1 += sched.rows[m].interestPaid.toNumber() + sched.rows[m].principalPaid.toNumber();
    }
    // Allow 1% tolerance: the facility engine pays level-EMI principal
    // component each month; legacy uses level payment directly.
    expect(y1).toBeCloseTo(expectedAnnualDS, 0);
  });

  test('DSCR matches legacy formula for stabilized NOI', () => {
    const principal = 80;
    const rateAnnualPct = 9.5;
    const termMonths = 120;
    const stabilizedNOICr = 15;

    const r = rateAnnualPct / 100 / 12;
    const monthlyEMI = (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
    const legacyDSCR = stabilizedNOICr / (monthlyEMI * 12);

    const spec: FacilitySpec = {
      id: 'recon-dscr',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(principal),
      startMonth: 0,
      maturityMonth: termMonths,
      rate: { kind: 'fixed', annualPct: rateAnnualPct },
      compounding: 'monthly',
      drawRule: { kind: 'bullet_at_origination' },
      amortizationTermMonths: termMonths,
    };
    const agg = rollForwardFacilities([spec], { totalMonths: termMonths });
    const cfadsMonthly = Array.from({ length: termMonths }, () => cr(stabilizedNOICr / 12));
    const cov = computeCovenants(agg, { cfadsMonthly, projectCostCr: cr(150) });
    // Monthly DSCR from engine ≈ monthly NOI / monthly debt service
    const dscrAtMid = cov.monthly[Math.floor(termMonths / 2)].dscr;
    // Should match legacy to within 3%: legacy uses constant annual DS,
    // facility pays constant EMI so both produce the same DSCR.
    expect(dscrAtMid).toBeCloseTo(legacyDSCR, 2);
  });
});

describe('representative-deal CFADS shape', () => {
  test('Jigani-shaped IO + EMI refi schedule produces finite DSCR profile', () => {
    // Jigani is a development deal — treated here as a pattern check only.
    // Construction debt: IO during construction (36m), refinance at stabilization
    // into a 7-year amortizing facility.
    const construction: FacilitySpec = {
      id: 'cons',
      kind: 'interest_only',
      currency: 'INR',
      commitment: cr(100),
      startMonth: 0,
      maturityMonth: 42,
      rate: { kind: 'fixed', annualPct: 12 },
      compounding: 'monthly',
      drawRule: { kind: 'schedule', perMonth: Array.from({ length: 42 }, (_, i) => (i < 36 ? cr(100 / 36) : cr(0))) },
      refinance: {
        atMonth: 42,
        fromFacilityId: 'cons',
        replacementSpec: {
          id: 'term',
          kind: 'amortizing_emi',
          currency: 'INR',
          commitment: cr(100),
          startMonth: 42,
          maturityMonth: 42 + 84,
          rate: { kind: 'fixed', annualPct: 9 },
          compounding: 'monthly',
          drawRule: { kind: 'bullet_at_origination' },
          amortizationTermMonths: 84,
        },
      },
    };
    const replacement = construction.refinance!.replacementSpec;
    const horizon = 42 + 84;
    const agg = rollForwardFacilities([construction, replacement], { totalMonths: horizon });
    const cfads = computeCFADS({
      revenue: Array.from({ length: horizon }, (_, i) => (i >= 36 ? cr(2) : cr(0))),
      opex: Array.from({ length: horizon }, (_, i) => (i >= 36 ? cr(0.4) : cr(0))),
      taxes: Array.from({ length: horizon }, () => cr(0)),
      maintenanceCapex: Array.from({ length: horizon }, () => cr(0)),
    });
    const cov = computeCovenants(agg, { cfadsMonthly: cfads.monthly, projectCostCr: cr(150) });
    // DSCR during amortization window should be positive and finite.
    const midAmort = cov.monthly[60].dscr;
    expect(midAmort).not.toBeNull();
    expect(Number.isFinite(midAmort!)).toBe(true);
    expect(midAmort!).toBeGreaterThan(0);
  });
});
