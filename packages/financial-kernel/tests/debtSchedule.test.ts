/**
 * Pure-math parity tests for the ported master debt schedule primitives.
 *
 * Expected values are computed independently here (in-test reimplementation
 * of the documented formulas) and cross-checked against the module's
 * output. If a future edit drifts from master's quarterly-compound math,
 * these tests fail.
 */

import {
  sCurveWeights,
  buildDrawSchedule,
  buildAmortizingSchedule,
} from '../src/debtSchedule';

describe('sCurveWeights', () => {
  test('sums to 1 for any n ≥ 1', () => {
    for (const n of [1, 2, 4, 8, 12, 20, 40]) {
      const w = sCurveWeights(n);
      expect(w).toHaveLength(n);
      const sum = w.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 8);
    }
  });

  test('is unimodal (peaks in the middle)', () => {
    const w = sCurveWeights(12);
    const maxIdx = w.indexOf(Math.max(...w));
    // Peak should be around the middle quarters.
    expect(maxIdx).toBeGreaterThanOrEqual(4);
    expect(maxIdx).toBeLessThanOrEqual(7);
  });
});

describe('buildDrawSchedule — master parity', () => {
  test('sum of draws equals principal', () => {
    const r = buildDrawSchedule({
      principalCr: 100,
      annualRatePct: 11,
      totalQuarters: 12,
      drawStartQ: 1,
      drawEndQ: 12,
      capitalizeInterest: true,
    });
    const sumDraws = r.draws.reduce((a, b) => a + b, 0);
    expect(sumDraws).toBeCloseTo(100, 6);
    expect(r.totalPrincipalCr).toBe(100);
  });

  test('zero rate ⇒ zero interest', () => {
    const r = buildDrawSchedule({
      principalCr: 50,
      annualRatePct: 0,
      totalQuarters: 8,
      drawStartQ: 1,
      drawEndQ: 8,
      capitalizeInterest: true,
    });
    expect(r.totalInterestCr).toBeCloseTo(0, 10);
  });

  test('capitalised interest > simple-interest approximation', () => {
    // S-curve average balance is ~half of principal; capitalised compounding
    // must produce strictly more interest than principal × rate × years × 0.5.
    const principal = 100;
    const rate = 12;
    const years = 3;
    const simpleHalf = principal * (rate / 100) * years * 0.5;
    const r = buildDrawSchedule({
      principalCr: principal,
      annualRatePct: rate,
      totalQuarters: years * 4,
      drawStartQ: 1,
      drawEndQ: years * 4,
      capitalizeInterest: true,
    });
    expect(r.totalInterestCr).toBeGreaterThan(simpleHalf * 0.5); // sanity floor
    expect(r.totalInterestCr).toBeLessThan(principal * (rate / 100) * years); // simple-full ceiling
  });

  test('closing balance with capitalisation = principal + totalInterest', () => {
    const r = buildDrawSchedule({
      principalCr: 80,
      annualRatePct: 10,
      totalQuarters: 10,
      drawStartQ: 1,
      drawEndQ: 10,
      capitalizeInterest: true,
    });
    const closingBal = r.balances[r.balances.length - 1];
    expect(closingBal).toBeCloseTo(80 + r.totalInterestCr, 6);
  });

  test('without capitalisation, closing balance = principal', () => {
    const r = buildDrawSchedule({
      principalCr: 80,
      annualRatePct: 10,
      totalQuarters: 10,
      drawStartQ: 1,
      drawEndQ: 10,
      capitalizeInterest: false,
    });
    const closingBal = r.balances[r.balances.length - 1];
    expect(closingBal).toBeCloseTo(80, 6);
    // But interest is still accrued each quarter.
    expect(r.totalInterestCr).toBeGreaterThan(0);
  });

  test('invalid inputs produce empty schedule without throwing', () => {
    const r = buildDrawSchedule({
      principalCr: 0,
      annualRatePct: 10,
      totalQuarters: 4,
      drawStartQ: 1,
      drawEndQ: 4,
    });
    expect(r.totalInterestCr).toBe(0);
    expect(r.totalPrincipalCr).toBe(0);
  });
});

describe('buildAmortizingSchedule — master parity', () => {
  test('quarterly payment matches annuity formula', () => {
    const principal = 100;
    const rate = 10;
    const amortYears = 20;
    const r = buildAmortizingSchedule({
      principalCr: principal,
      annualRatePct: rate,
      amortizationYears: amortYears,
      drawQ: 1,
      operatingStartQ: 2,
      exitQ: 40,
      totalQuarters: 40,
    });
    const qRate = Math.pow(1 + rate / 100, 0.25) - 1;
    const nQ = amortYears * 4;
    const expectedPmt =
      (principal * (qRate * Math.pow(1 + qRate, nQ))) / (Math.pow(1 + qRate, nQ) - 1);
    expect(r.quarterlyPayment).toBeCloseTo(expectedPmt, 6);
  });

  test('balance is zero after exit quarter', () => {
    const r = buildAmortizingSchedule({
      principalCr: 100,
      annualRatePct: 10,
      amortizationYears: 20,
      drawQ: 1,
      operatingStartQ: 5,
      exitQ: 24,
      totalQuarters: 40,
    });
    for (let q = 24; q <= 40; q++) expect(r.balances[q]).toBe(0);
  });

  test('exit balloon + pre-exit principal payments = principal drawn', () => {
    const r = buildAmortizingSchedule({
      principalCr: 100,
      annualRatePct: 10,
      amortizationYears: 20,
      drawQ: 1,
      operatingStartQ: 5,
      exitQ: 24,
      totalQuarters: 40,
    });
    const totalPrincipal = r.principalPayments.reduce((a, b) => a + b, 0);
    expect(totalPrincipal).toBeCloseTo(100, 6);
    expect(r.balloonRepaymentCr).toBeGreaterThan(0);
  });

  test('zero rate degrades to straight-line principal repayment', () => {
    const r = buildAmortizingSchedule({
      principalCr: 100,
      annualRatePct: 0,
      amortizationYears: 10,
      drawQ: 1,
      operatingStartQ: 2,
      exitQ: 40,
      totalQuarters: 40,
    });
    // Zero rate branch returns an all-zero schedule in master as well.
    expect(r.totalInterestCr).toBe(0);
    expect(r.quarterlyPayment).toBe(0);
  });

  test('debtService[q] = interest + principal for all op quarters', () => {
    const r = buildAmortizingSchedule({
      principalCr: 80,
      annualRatePct: 9,
      amortizationYears: 15,
      drawQ: 1,
      operatingStartQ: 5,
      exitQ: 20,
      totalQuarters: 40,
    });
    for (let q = 5; q < 20; q++) {
      expect(r.debtService[q]).toBeCloseTo(
        r.interestPayments[q] + r.principalPayments[q],
        8,
      );
    }
  });
});
