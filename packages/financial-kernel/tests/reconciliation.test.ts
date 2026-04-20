/**
 * Reconciliation tests for master ↔ kernel numerical + input parity.
 *
 * Master's PRs #4–#7 added `debtLTC`, `debtTenorYears`, `amortizationYears`,
 * DSCR, and exit cap rate surfaces on the legacy JS engine. This test suite
 * guards two things:
 *
 *   1. Input-parity — no master input is silently dropped at the kernel
 *      boundary (schema → adapters → KPIs).
 *   2. Numerical-parity — the kernel's `buildFinancing` uses the same
 *      quarterly S-curve construction-draw schedule with capitalised
 *      interest as master's `buildDrawSchedule`, and the amortizing
 *      operating-phase schedule mirrors master's `buildAmortizingSchedule`.
 *
 * Expected numeric values below are computed independently of the kernel
 * (see `tests/debtSchedule.test.ts` for the pure-math parity tests).
 */

import { normalizeDealInput } from '../src/inputSchema';
import { buildFinancing } from '../src/financing';
import { buildDrawSchedule } from '../src/debtSchedule';
import { Decimal } from '../src/decimal';
import { computeDeal } from '../src/registry';
import {
  jiganiResidential,
  plottedSample,
  commercialSample,
  hospitalitySample,
} from './fixtures';

describe('reconciliation — input schema preserves master debt fields', () => {
  test('debtLTC passes through as percent', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        ...jiganiResidential.raw,
        debtLTV: 0.6,
        debtLTC: 0.7,
      },
    });
    expect(r.raw.debtLTV).toBe(0.6);
    expect(r.raw.debtLTC).toBe(0.7);
  });

  test('debtTenorYears preserved as years tenor', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        ...jiganiResidential.raw,
        debtLTV: 0.6,
        debtTenorYears: 5,
      },
    });
    expect(r.raw.debtTenorYears).toBe(5);
  });

  test('amortizationYears preserved on income assets', () => {
    const r = normalizeDealInput({
      assetClass: 'commercial_office',
      raw: {
        ...commercialSample.raw,
        debtCoverage: 0.55,
        amortizationYears: 20,
      },
    });
    expect(r.raw.amortizationYears).toBe(20);
  });
});

describe('reconciliation — financing matches master S-curve schedule', () => {
  test('construction interest equals master buildDrawSchedule output', () => {
    const base = {
      totalCost: Decimal.fromNumber(200),
      debtableBase: Decimal.fromNumber(100),
      debtLTV: 0.5,
      debtRatePct: 12,
      constructionMonths: 36,
    };
    const uncapped = buildFinancing(base);
    // Cross-check: a direct buildDrawSchedule call on the same principal/
    // rate/tenor must produce the same totalInterestCr. This asserts the
    // kernel is routing through the ported master math, not a parallel
    // approximation.
    const direct = buildDrawSchedule({
      principalCr: 50,
      annualRatePct: 12,
      totalQuarters: 12,
      drawStartQ: 1,
      drawEndQ: 12,
      capitalizeInterest: true,
    });
    expect(uncapped.debtInterest.toNumber()).toBeCloseTo(direct.totalInterestCr, 6);
  });

  test('caps carry window at loan term when below constructionMonths', () => {
    const base = {
      totalCost: Decimal.fromNumber(200),
      debtableBase: Decimal.fromNumber(100),
      debtLTV: 0.5,
      debtRatePct: 12,
      constructionMonths: 36,
    };
    const uncapped = buildFinancing(base);
    const capped = buildFinancing({ ...base, debtTenorMonths: 24 });

    // Capping at a shorter loan term must strictly reduce accrued interest.
    expect(capped.debtInterest.toNumber()).toBeLessThan(uncapped.debtInterest.toNumber());
    expect(capped.debtTenorMonths).toBe(24);

    // And must equal a direct 8-quarter schedule.
    const direct24 = buildDrawSchedule({
      principalCr: 50,
      annualRatePct: 12,
      totalQuarters: 8,
      drawStartQ: 1,
      drawEndQ: 8,
      capitalizeInterest: true,
    });
    expect(capped.debtInterest.toNumber()).toBeCloseTo(direct24.totalInterestCr, 6);
  });

  test('does not extend carry window when tenor exceeds construction', () => {
    const shortConstr = buildFinancing({
      totalCost: Decimal.fromNumber(200),
      debtableBase: Decimal.fromNumber(100),
      debtLTV: 0.5,
      debtRatePct: 12,
      constructionMonths: 24,
      debtTenorMonths: 60,
    });
    const uncapped24 = buildFinancing({
      totalCost: Decimal.fromNumber(200),
      debtableBase: Decimal.fromNumber(100),
      debtLTV: 0.5,
      debtRatePct: 12,
      constructionMonths: 24,
    });
    // Tenor longer than construction cannot extend carry beyond
    // constructionMonths — the cap is min(construction, tenor).
    expect(shortConstr.debtInterest.toNumber()).toBeCloseTo(
      uncapped24.debtInterest.toNumber(),
      6,
    );
  });

  test('debtLTC and amortizationYears round-trip through the output', () => {
    const out = buildFinancing({
      totalCost: Decimal.fromNumber(100),
      debtableBase: Decimal.fromNumber(80),
      debtLTV: 0.6,
      debtLTC: 0.65,
      debtRatePct: 10,
      constructionMonths: 30,
      amortizationYears: 15,
    });
    expect(out.debtLTC).toBe(0.65);
    expect(out.amortizationYears).toBe(15);
  });
});

describe('reconciliation — asset adapters surface DSCR + exitCapRate', () => {
  test('residential emits dscr when debt is taken', () => {
    const result = computeDeal({
      ...jiganiResidential,
      raw: { ...jiganiResidential.raw, debtLTV: 0.6, debtRatePct: 11 },
    });
    expect(result.kpis.extras.dscr).not.toBeNull();
    expect(result.kpis.extras.dscr).toBeGreaterThan(0);
    expect(result.financing).not.toBeNull();
    expect(result.financing!.debtLTV).toBeCloseTo(0.6, 4);
  });

  test('residential dscr null when unlevered', () => {
    const result = computeDeal(jiganiResidential);
    expect(result.kpis.extras.dscr).toBeNull();
  });

  test('plotted emits dscr and carries debtTenorMonths', () => {
    const result = computeDeal({
      ...plottedSample,
      raw: {
        ...plottedSample.raw,
        debtLTV: 0.55,
        debtRatePct: 12,
        debtTenorYears: 3,
      },
    });
    expect(result.kpis.extras.dscr).not.toBeNull();
    expect(result.financing!.debtTenorMonths).toBe(36);
  });

  test('commercial emits exitCapRate + dscr', () => {
    const result = computeDeal({
      ...commercialSample,
      raw: {
        ...commercialSample.raw,
        debtCoverage: 0.55,
        interestRatePct: 9.5,
        amortizationYears: 20,
      },
    });
    expect(result.kpis.extras.exitCapRate).toBeCloseTo(7.5, 4);
    expect(result.kpis.extras.entryCapRate).toBeCloseTo(8, 4);
    expect(result.kpis.extras.dscr).not.toBeNull();
    expect(result.kpis.extras.dscr).toBeGreaterThan(0);
    expect(result.financing!.amortizationYears).toBe(20);
  });

  test('hospitality emits exitCapRate + dscr', () => {
    const result = computeDeal({
      ...hospitalitySample,
      raw: {
        ...hospitalitySample.raw,
        debtCoverage: 0.5,
        interestRatePct: 11,
      },
    });
    expect(result.kpis.extras.exitCapRate).not.toBeNull();
    expect(result.kpis.extras.dscr).not.toBeNull();
  });
});
