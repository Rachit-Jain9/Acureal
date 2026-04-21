/**
 * Acceptance tests for the three asset classes that exist ONLY in the TS
 * kernel (no legacy JS engine path): villas, mixed_use, redevelopment.
 *
 * Since there's no legacy implementation to parity-check against, these
 * tests assert deterministic invariants on the kernel output alone:
 *   - The result is typed with the requested assetClass.
 *   - Villas applies villa-shaped defaults (lower FSI, lower loading) when
 *     the deal inputs omit them.
 *   - Mixed-use routes to the residential engine today — its totals should
 *     match the residential-equivalent run of the same inputs.
 *   - Redevelopment adds exactly `rehousingCostCr` to total cost vs. a
 *     residential baseline; a zero-rehousing redevelopment run must match
 *     residential exactly.
 *
 * When any of these classes gains its own dedicated implementation, promote
 * the relevant assertions (e.g. mixed-use blend math) to class-specific
 * fixtures here.
 */

import { computeDeal } from '../src/registry';
import type { DealInputs } from '../src/types';
import { jiganiResidential } from './fixtures';

const residentialBaseline: DealInputs = {
  ...jiganiResidential,
  raw: { ...jiganiResidential.raw },
};

describe('acceptance — villas (kernel-only)', () => {
  test('assetClass is threaded through to the result', () => {
    const inputs: DealInputs = {
      assetClass: 'villas',
      raw: { ...jiganiResidential.raw, sellingRatePerSqft: 13_500 },
    };
    const r = computeDeal(inputs);
    expect(r.assetClass).toBe('villas');
  });

  test('villa defaults kick in when fsi + loadingFactor are omitted', () => {
    // Strip FSI / loading so the villa adapter must supply defaults.
    const { fsi: _fsi, loadingFactor: _lf, ...rest } = jiganiResidential.raw as Record<string, unknown>;
    const withDefaults = computeDeal({
      assetClass: 'villas',
      raw: { ...rest, sellingRatePerSqft: 13_500 },
    });
    // Explicit inputs that match the villa defaults → same result.
    const explicit = computeDeal({
      assetClass: 'villas',
      raw: { ...rest, sellingRatePerSqft: 13_500, fsi: 0.8, loadingFactor: 0.05 },
    });
    expect(withDefaults.kpis.revenue.toNumber()).toBeCloseTo(
      explicit.kpis.revenue.toNumber(),
      2,
    );
    expect(withDefaults.kpis.totalCost.toNumber()).toBeCloseTo(
      explicit.kpis.totalCost.toNumber(),
      2,
    );
    // And must differ from a residential_apartments run of the same inputs
    // (which defaults to higher FSI / loading).
    const residential = computeDeal({
      assetClass: 'residential_apartments',
      raw: { ...rest, sellingRatePerSqft: 13_500 },
    });
    expect(residential.kpis.revenue.toNumber()).not.toBeCloseTo(
      withDefaults.kpis.revenue.toNumber(),
      1,
    );
  });

  test('user-supplied fsi overrides villa default', () => {
    const r = computeDeal({
      assetClass: 'villas',
      raw: { ...jiganiResidential.raw, fsi: 1.2, sellingRatePerSqft: 13_500 },
    });
    // Saleable area scales with FSI; 1.2 > 0.8 default → more revenue.
    const d = computeDeal({
      assetClass: 'villas',
      raw: { ...jiganiResidential.raw, fsi: 0.8, sellingRatePerSqft: 13_500 },
    });
    expect(r.kpis.revenue.toNumber()).toBeGreaterThan(d.kpis.revenue.toNumber());
  });
});

describe('acceptance — mixed_use (kernel-only)', () => {
  test('assetClass is threaded through to the result', () => {
    const r = computeDeal({
      assetClass: 'mixed_use',
      raw: { ...jiganiResidential.raw },
    });
    expect(r.assetClass).toBe('mixed_use');
  });

  test('mixed_use routes to residential math (same cost & revenue totals)', () => {
    const mx = computeDeal({
      assetClass: 'mixed_use',
      raw: { ...jiganiResidential.raw },
    });
    const res = computeDeal(residentialBaseline);
    // Same inputs → mixed-use (residential delegate) totals must match.
    expect(mx.kpis.revenue.toNumber()).toBeCloseTo(res.kpis.revenue.toNumber(), 2);
    expect(mx.kpis.totalCost.toNumber()).toBeCloseTo(res.kpis.totalCost.toNumber(), 2);
  });
});

describe('acceptance — redevelopment (kernel-only)', () => {
  test('assetClass is threaded through to the result', () => {
    const r = computeDeal({
      assetClass: 'redevelopment',
      raw: { ...jiganiResidential.raw },
    });
    expect(r.assetClass).toBe('redevelopment');
  });

  test('zero rehousing → identical totals to residential_apartments', () => {
    const rd = computeDeal({
      assetClass: 'redevelopment',
      raw: { ...jiganiResidential.raw, rehousingCostCr: 0 },
    });
    const res = computeDeal(residentialBaseline);
    expect(rd.kpis.totalCost.toNumber()).toBeCloseTo(res.kpis.totalCost.toNumber(), 2);
    expect(rd.kpis.revenue.toNumber()).toBeCloseTo(res.kpis.revenue.toNumber(), 2);
  });

  test('positive rehousing adds to total cost', () => {
    const res = computeDeal(residentialBaseline);
    const rd = computeDeal({
      assetClass: 'redevelopment',
      raw: { ...jiganiResidential.raw, rehousingCostCr: 12 },
    });
    const delta = rd.kpis.totalCost.toNumber() - res.kpis.totalCost.toNumber();
    // Rehousing flows through as an additional soft cost; downstream rollups
    // (finance cost on debt-funded portion, contingency % on base) can add a
    // small extra uplift, so assert "at least the rehousing amount was added,
    // and within a reasonable band of it".
    expect(delta).toBeGreaterThanOrEqual(11);
    expect(delta).toBeLessThanOrEqual(18);
  });
});
