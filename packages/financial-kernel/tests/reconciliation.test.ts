/**
 * Reconciliation tests for master ↔ kernel input parity.
 *
 * Master's PRs #4–#7 added `debtLTC`, `debtTenorYears`, `amortizationYears`,
 * DSCR, and exit cap rate surfaces on the legacy JS engine. This test suite
 * guards that the kernel's input schema and asset adapters preserve those
 * inputs end-to-end and expose the equivalent KPIs via `kpis.extras`.
 *
 * Numerical parity with master's S-curve / amortizing schedules is out of
 * scope here — that work lands in the follow-up math-parity PR. This suite
 * only asserts that no master input is silently dropped at the kernel
 * boundary, so the merge does not regress user-visible behaviour.
 */

import { normalizeDealInput } from '../src/inputSchema';
import { buildFinancing } from '../src/financing';
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

describe('reconciliation — financing honours debtTenorMonths cap', () => {
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

    // Uncapped: 50 × 12% × 36/12 = 18 Cr interest
    // Capped:   50 × 12% × 24/12 = 12 Cr interest
    expect(uncapped.debtInterest.toNumber()).toBeCloseTo(18, 4);
    expect(capped.debtInterest.toNumber()).toBeCloseTo(12, 4);
    expect(capped.debtTenorMonths).toBe(24);
  });

  test('does not extend carry window when tenor exceeds construction', () => {
    const capped = buildFinancing({
      totalCost: Decimal.fromNumber(200),
      debtableBase: Decimal.fromNumber(100),
      debtLTV: 0.5,
      debtRatePct: 12,
      constructionMonths: 24,
      debtTenorMonths: 60,
    });
    // min(24, 60)/12 = 2 years → 50 × 12% × 2 = 12
    expect(capped.debtInterest.toNumber()).toBeCloseTo(12, 4);
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
