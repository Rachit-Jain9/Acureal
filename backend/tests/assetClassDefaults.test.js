'use strict';

// PR-NX11 (2026-05-15) — tests for the KPI_BENCHMARKS table + benchmarkFor()
// precedence chain. The Dashboard's icon-set conditional formatting depends
// on these benchmarks; a broken precedence chain breaks the entire KPI-tile
// health-coloring system.

const {
  KPI_BENCHMARKS,
  benchmarkFor,
  defaultsForAssetClass,
  ASSET_CLASS_DEFAULTS,
} = require('../src/services/exports/xlsx/v2/assetClassDefaults');

describe('exports/xlsx/v2/assetClassDefaults', () => {
  describe('KPI_BENCHMARKS structure', () => {
    test('exposes income + development family defaults', () => {
      expect(KPI_BENCHMARKS.__income).toBeDefined();
      expect(KPI_BENCHMARKS.__development).toBeDefined();
    });

    test('every income benchmark has the canonical six KPIs', () => {
      const required = ['noi', 'yieldOnCost', 'cashOnCash', 'minDscr', 'netSaleProceeds', 'exitCapRate'];
      required.forEach((kpi) => {
        expect(KPI_BENCHMARKS.__income[kpi]).toBeDefined();
      });
    });

    test('every development benchmark has the canonical six KPIs', () => {
      const required = ['revenue', 'cost', 'netCashFlow', 'grossMargin', 'minDscr', 'residualLand'];
      required.forEach((kpi) => {
        expect(KPI_BENCHMARKS.__development[kpi]).toBeDefined();
      });
    });

    test('every benchmark entry carries low, mid, high, direction, citation', () => {
      // Spot-check across all benchmark sets that the shape is consistent.
      const allBenchmarks = [];
      Object.values(KPI_BENCHMARKS).forEach((family) => {
        Object.values(family).forEach((bm) => allBenchmarks.push(bm));
      });
      expect(allBenchmarks.length).toBeGreaterThan(15);
      allBenchmarks.forEach((bm) => {
        expect(bm.low).toBeDefined();
        expect(bm.mid).toBeDefined();
        expect(bm.high).toBeDefined();
        expect(['up', 'down']).toContain(bm.direction);
        expect(typeof bm.citation).toBe('string');
        expect(bm.citation.length).toBeGreaterThan(10); // non-trivial source attribution
      });
    });

    test('up-direction benchmarks are monotonic (low < mid < high)', () => {
      Object.values(KPI_BENCHMARKS).forEach((family) => {
        Object.entries(family).forEach(([kpi, bm]) => {
          if (bm.direction === 'up') {
            expect(bm.low).toBeLessThan(bm.mid);
            expect(bm.mid).toBeLessThan(bm.high);
          }
        });
      });
    });

    test('down-direction benchmarks are monotonic (low > mid > high)', () => {
      // Down-is-good (e.g. cap rate): lower cap = green, higher cap = red.
      // Stored as [low (worst), mid, high (best)] = [largest, mid, smallest].
      Object.values(KPI_BENCHMARKS).forEach((family) => {
        Object.entries(family).forEach(([kpi, bm]) => {
          if (bm.direction === 'down') {
            expect(bm.low).toBeGreaterThan(bm.mid);
            expect(bm.mid).toBeGreaterThan(bm.high);
          }
        });
      });
    });
  });

  describe('benchmarkFor precedence chain', () => {
    test('asset-class-specific override wins over family default', () => {
      // commercial_office has a yieldOnCost override at 0.080/0.095/0.110.
      // Family default is 0.075/0.090/0.105.
      const bm = benchmarkFor('commercial_office', 'income', 'yieldOnCost');
      expect(bm).toBeDefined();
      expect(bm.low).toBe(0.080);
      expect(bm.high).toBe(0.110);
    });

    test('asset class without override falls back to family default', () => {
      // mixed_use does not override `minDscr` — should fall back to __development.
      const bm = benchmarkFor('mixed_use', 'development', 'minDscr');
      expect(bm).toBeDefined();
      expect(bm.low).toBe(1.20);
      expect(bm.high).toBe(1.50);
    });

    test('unknown asset class falls through to family default', () => {
      const bm = benchmarkFor('not_a_real_class', 'income', 'minDscr');
      expect(bm).toBeDefined();
      expect(bm.low).toBe(1.20);
    });

    test('unknown KPI returns null (caller must skip iconSet)', () => {
      const bm = benchmarkFor('commercial_office', 'income', 'not_a_real_kpi');
      expect(bm).toBeNull();
    });

    test('cross-family KPI does not bleed (income asset asking for dev KPI returns family default for income only)', () => {
      // grossMargin is a development KPI. Asking for it with family=income
      // should fall through the precedence chain and return null
      // (no asset-class override + no __income default for grossMargin).
      const bm = benchmarkFor('commercial_office', 'income', 'grossMargin');
      // commercial_office has no `grossMargin` override; __income has no
      // `grossMargin` entry; should return null.
      expect(bm).toBeNull();
    });

    test('exit cap rate benchmark is direction: down (lower is better)', () => {
      const bm = benchmarkFor('commercial_office', 'income', 'exitCapRate');
      expect(bm.direction).toBe('down');
    });

    test('yield-on-cost benchmark is direction: up (higher is better)', () => {
      const bm = benchmarkFor('commercial_office', 'income', 'yieldOnCost');
      expect(bm.direction).toBe('up');
    });
  });

  describe('defaultsForAssetClass (PR-NX6, pre-existing)', () => {
    test('returns the residential_apartments defaults object', () => {
      const d = defaultsForAssetClass('residential_apartments');
      expect(d.saleableAreaSqft).toBe(350000);
      expect(d.constructionCostPerSqft).toBe(4500);
    });

    test('returns empty object for unknown asset class (no throw)', () => {
      const d = defaultsForAssetClass('not_a_real_class');
      expect(d).toEqual({});
    });
  });

  describe('ASSET_CLASS_DEFAULTS — Bengaluru-priority coverage', () => {
    test('covers both development and income families', () => {
      // Development
      expect(ASSET_CLASS_DEFAULTS.residential_apartments).toBeDefined();
      expect(ASSET_CLASS_DEFAULTS.villas).toBeDefined();
      expect(ASSET_CLASS_DEFAULTS.mixed_use).toBeDefined();
      // Income
      expect(ASSET_CLASS_DEFAULTS.commercial_office).toBeDefined();
      expect(ASSET_CLASS_DEFAULTS.retail).toBeDefined();
      expect(ASSET_CLASS_DEFAULTS.hospitality).toBeDefined();
    });

    test('immutable (Object.freeze ensures no runtime mutation)', () => {
      expect(Object.isFrozen(ASSET_CLASS_DEFAULTS)).toBe(true);
    });
  });
});
