/**
 * Asset-class golden tests. For every supported class we assert the
 * kernel produces finite, sign-correct, self-consistent outputs —
 * revenue ≥ 0, total cost ≥ 0, gross profit = revenue - totalCost,
 * net cash-flow aggregates sensibly, and IRR/NPV are finite where
 * cash flows alternate signs.
 *
 * We deliberately avoid hard-coded KPI targets for every class until
 * reconciliation is complete; the intent is to lock *shape* here and
 * add numeric targets incrementally per `reconciliation.test.ts`.
 */

import { computeDeal, SUPPORTED_ASSET_CLASSES } from '../src';
import { allFixtures } from './fixtures';

describe('computeDeal — per-asset-class shape tests', () => {
  for (const assetClass of SUPPORTED_ASSET_CLASSES) {
    test(`${assetClass} produces a well-formed KernelResult`, () => {
      const result = computeDeal(allFixtures[assetClass]);

      expect(result.assetClass).toBe(assetClass);
      expect(result.period.totalMonths).toBeGreaterThan(0);

      // Costs
      expect(result.costs.totalCr.isNegative()).toBe(false);
      expect(result.costs.hardCostTotalCr.isNegative()).toBe(false);
      expect(result.costs.softCostTotalCr.isNegative()).toBe(false);

      // Revenue vs profit consistency
      const rev = result.kpis.revenue.toNumber();
      const cost = result.kpis.totalCost.toNumber();
      const gp = result.kpis.grossProfit.toNumber();
      expect(gp).toBeCloseTo(rev - cost, 2);

      // Net cash-flow length = totalMonths + 1
      expect(result.cashFlow.net.length).toBe(result.period.totalMonths + 1);

      // IRR, when returned, is a finite number
      if (result.kpis.irr != null) {
        expect(Number.isFinite(result.kpis.irr)).toBe(true);
      }

      // NPV is always finite
      expect(Number.isFinite(result.kpis.npv.toNumber())).toBe(true);

      // Provenance present
      expect(result.provenance.length).toBeGreaterThan(0);
    });
  }
});

describe('computeDeal — sign invariants', () => {
  test('residential has land outflow in month 0', () => {
    const r = computeDeal(allFixtures.residential_apartments);
    expect(r.cashFlow.net[0].isNegative()).toBe(true);
  });

  test('residential has at least one positive month (sales)', () => {
    const r = computeDeal(allFixtures.residential_apartments);
    expect(r.cashFlow.net.some((v) => v.isPositive())).toBe(true);
  });

  test('commercial has exit proceeds on final month', () => {
    const r = computeDeal(allFixtures.commercial_office);
    expect(r.cashFlow.net[r.cashFlow.net.length - 1].isPositive()).toBe(true);
  });
});

/**
 * Numeric reconciliation against the legacy engine. Tolerances are tight on
 * cost/revenue (which are integrator-free), and wider on IRR/NPV because the
 * kernel uses monthly compounding where the legacy engine is quarterly.
 * These targets are captured against `calculateFullFinancials` in
 * `backend/src/engines/financial.engine.js` at the point of V2 kernel creation.
 */
describe('computeDeal — Jigani residential reconciliation', () => {
  const r = computeDeal(allFixtures.residential_apartments);

  test('revenue = 362.25 Cr', () => {
    expect(r.kpis.revenue.toNumber()).toBeCloseTo(362.25, 2);
  });

  test('totalCost = 306.00 Cr', () => {
    expect(r.kpis.totalCost.toNumber()).toBeCloseTo(306.0036, 2);
  });

  test('grossProfit = 56.25 Cr', () => {
    expect(r.kpis.grossProfit.toNumber()).toBeCloseTo(56.2464, 2);
  });

  test('grossMargin ≈ 15.53%', () => {
    expect(r.kpis.grossMarginPct).toBeCloseTo(15.527, 1);
  });

  test('equityMultiple ≈ 1.18×', () => {
    expect(r.kpis.equityMultiple).not.toBeNull();
    expect(r.kpis.equityMultiple!).toBeCloseTo(1.1838, 2);
  });

  test('residualLandValue ≈ 182.50 Cr', () => {
    expect(r.kpis.residualLandValue).not.toBeNull();
    expect(r.kpis.residualLandValue!.toNumber()).toBeCloseTo(182.5, 0);
  });

  test('IRR within 2pp of legacy 9.51%', () => {
    expect(r.kpis.irr).not.toBeNull();
    expect(Math.abs(r.kpis.irr! - 9.5064)).toBeLessThan(2);
  });

  test('NPV within 3 Cr of legacy -11.71 Cr', () => {
    expect(Math.abs(r.kpis.npv.toNumber() - -11.714)).toBeLessThan(3);
  });
});
