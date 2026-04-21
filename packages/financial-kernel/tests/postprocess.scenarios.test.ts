/**
 * Unit tests for the scenarios post-processor.
 *
 * Asserts the base/bull/bear preset semantics, the perturbation math in
 * `applyScenarioPreset`, and that `buildScenarios` always returns all
 * three keys even if individual cells error out.
 */

import {
  buildScenarios,
  applyScenarioPreset,
  SCENARIO_PRESETS,
} from '../src/postprocess/scenarios';
import { allFixtures } from './fixtures';

describe('SCENARIO_PRESETS values', () => {
  it('base is a no-op', () => {
    expect(SCENARIO_PRESETS.base).toMatchObject({
      revenueMultiplier: 1.0,
      hardCostMultiplier: 1.0,
      durationMultiplier: 1.0,
      financeDelta: 0,
      exitCapRateDelta: 0,
      vacancyDelta: 0,
    });
  });

  it('bull is optimistic', () => {
    expect(SCENARIO_PRESETS.bull.revenueMultiplier).toBeGreaterThan(1);
    expect(SCENARIO_PRESETS.bull.hardCostMultiplier).toBeLessThan(1);
    expect(SCENARIO_PRESETS.bull.financeDelta).toBeLessThan(0);
  });

  it('bear is pessimistic', () => {
    expect(SCENARIO_PRESETS.bear.revenueMultiplier).toBeLessThan(1);
    expect(SCENARIO_PRESETS.bear.hardCostMultiplier).toBeGreaterThan(1);
    expect(SCENARIO_PRESETS.bear.financeDelta).toBeGreaterThan(0);
  });
});

describe('applyScenarioPreset', () => {
  const raw = {
    sellingRatePerSqft: 40000,
    constructionCostPerSqft: 5000,
    projectDurationMonths: 36,
    financeCostPct: 12,
    vacancyPct: 10,
    exitCapRate: 7.5,
    baseRentPerSqftMonth: 100,
  };

  it('base returns a shallow copy (unchanged values)', () => {
    const out = applyScenarioPreset(raw, 'base');
    expect(out).toEqual(raw);
    expect(out).not.toBe(raw); // new object
  });

  it('bull scales revenue +10% and hard cost -5%', () => {
    const out = applyScenarioPreset(raw, 'bull');
    expect(out.sellingRatePerSqft).toBe(44000); // 40000 * 1.10
    expect(out.constructionCostPerSqft).toBe(4750); // 5000 * 0.95
    expect(out.baseRentPerSqftMonth).toBe(110); // 100 * 1.10 (2dp)
  });

  it('bear scales revenue -12% and hard cost +10%', () => {
    const out = applyScenarioPreset(raw, 'bear');
    expect(out.sellingRatePerSqft).toBe(35200); // 40000 * 0.88
    expect(out.constructionCostPerSqft).toBe(5500); // 5000 * 1.10
  });

  it('adjusts duration within [12, 180] bounds', () => {
    const out = applyScenarioPreset(raw, 'bull');
    expect(out.projectDurationMonths).toBe(32); // 36 * 0.90 rounded
  });

  it('adjusts finance rate with delta (never below 0)', () => {
    const lowRate = applyScenarioPreset({ financeCostPct: 0.5 }, 'bull');
    expect(lowRate.financeCostPct).toBe(0); // 0.5 - 1.0 clamped to 0
  });

  it('clamps vacancy to [0, 50]', () => {
    const bear = applyScenarioPreset({ vacancyPct: 48 }, 'bear');
    expect(bear.vacancyPct).toBe(50); // 48 + 5 clamped to 50
    const bull = applyScenarioPreset({ vacancyPct: 2 }, 'bull');
    expect(bull.vacancyPct).toBe(0); // 2 - 3 clamped to 0
  });

  it('leaves unrelated fields untouched', () => {
    const out = applyScenarioPreset({ ...raw, someRandomKey: 'foo' }, 'bull');
    expect(out.someRandomKey).toBe('foo');
  });
});

describe('buildScenarios', () => {
  it('returns all 3 keys for a residential deal', () => {
    const out = buildScenarios({
      raw: allFixtures.residential_apartments.raw,
      assetClass: 'residential_apartments',
    });
    expect(Object.keys(out).sort()).toEqual(['base', 'bear', 'bull'].sort());
    expect(out.base.label).toBe('Base Case');
    expect(out.bull.label).toBe('Bull Case');
    expect(out.bear.label).toBe('Bear Case');
  });

  it('base has adjustments=null, bull/bear have adjustments set', () => {
    const out = buildScenarios({
      raw: allFixtures.residential_apartments.raw,
      assetClass: 'residential_apartments',
    });
    expect(out.base.adjustments).toBeNull();
    expect(out.bull.adjustments).not.toBeNull();
    expect(out.bear.adjustments).not.toBeNull();
    expect(out.bull.adjustments?.revenue).toBe('+10%');
    expect(out.bear.adjustments?.revenue).toBe('-12%');
  });

  it('each cell carries kpis/costs/revenue if the compute succeeds', () => {
    const out = buildScenarios({
      raw: allFixtures.residential_apartments.raw,
      assetClass: 'residential_apartments',
    });
    for (const key of ['base', 'bull', 'bear'] as const) {
      const cell = out[key];
      if (cell.error) continue; // error cells are allowed
      expect(cell.kpis).not.toBeNull();
      expect(cell.costs).not.toBeNull();
      expect(cell.revenue).not.toBeNull();
    }
  });

  it('bull IRR ≥ base IRR ≥ bear IRR (directional sanity)', () => {
    const out = buildScenarios({
      raw: allFixtures.residential_apartments.raw,
      assetClass: 'residential_apartments',
    });
    const baseIrr = out.base.kpis?.irr;
    const bullIrr = out.bull.kpis?.irr;
    const bearIrr = out.bear.kpis?.irr;
    if (baseIrr != null && bullIrr != null && bearIrr != null) {
      expect(bullIrr).toBeGreaterThanOrEqual(baseIrr - 1e-6);
      expect(bearIrr).toBeLessThanOrEqual(baseIrr + 1e-6);
    }
  });

  it('capitalStackFor is called with perturbed raw and result', () => {
    let calls = 0;
    const out = buildScenarios({
      raw: allFixtures.residential_apartments.raw,
      assetClass: 'residential_apartments',
      capitalStackFor: (perturbedRaw, result) => {
        calls += 1;
        expect(perturbedRaw).toBeDefined();
        expect(result.kpis).toBeDefined();
        return { mock: true };
      },
    });
    expect(calls).toBeGreaterThanOrEqual(1);
    const stacks = [out.base.capitalStack, out.bull.capitalStack, out.bear.capitalStack];
    const populated = stacks.filter((s) => s != null);
    expect(populated.length).toBeGreaterThanOrEqual(1);
  });

  it('returns a frozen bundle', () => {
    const out = buildScenarios({
      raw: allFixtures.residential_apartments.raw,
      assetClass: 'residential_apartments',
    });
    expect(Object.isFrozen(out)).toBe(true);
  });
});
