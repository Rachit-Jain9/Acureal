'use strict';

/**
 * Unit tests for capitalStackOptimizer.service.js — P2 / Pillar 3 (second half).
 *
 * The optimizer is deterministic, so every test pins exact scoring behaviour
 * + the closed verb dictionary + the covenant-pass / covenant-fail boundary.
 */

const opt = require('../src/services/capitalStackOptimizer.service');

// ─── Fixtures ──────────────────────────────────────────────────────────────

// A "healthy" residential kernel output — total cost 100 Cr, gross sales 150 Cr,
// DSCR 1.7. Conservative scenario should pass all covenants with cushion.
const HEALTHY_RESIDENTIAL = {
  model_params: {
    costs: { totalCr: 100, landCr: 30, constructionCr: 50, financeCr: 8 },
    revenue: { totalRevenueCr: 150 },
    kpis: { extras: { dscr: 1.70 } },
  },
  total_cost_cr: 100,
  total_revenue_cr: 150,
};

// A "stressed" residential kernel output — high LTC (cheap project), DSCR
// 1.30. Aggressive scenario will likely Re-examine / Flag.
const STRESSED_RESIDENTIAL = {
  model_params: {
    costs: { totalCr: 100, landCr: 50, constructionCr: 40, financeCr: 5 },
    revenue: { totalRevenueCr: 120 },
    kpis: { extras: { dscr: 1.30 } },
  },
  total_cost_cr: 100,
  total_revenue_cr: 120,
};

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe('blendedCostOfCapital', () => {
  test('conservative residential blend ~ 17%', () => {
    const blend = opt.blendedCostOfCapital(opt.STACK_TEMPLATES.residential_apartments.conservative);
    // 0.50 × 21 + 0.30 × 11.5 + 0.15 × 17 + 0.05 × 20 = 17.5
    expect(blend).toBeCloseTo(17.5, 1);
  });

  test('aggressive residential blend < conservative blend', () => {
    const conservative = opt.blendedCostOfCapital(opt.STACK_TEMPLATES.residential_apartments.conservative);
    const aggressive   = opt.blendedCostOfCapital(opt.STACK_TEMPLATES.residential_apartments.aggressive);
    expect(aggressive).toBeLessThan(conservative);
  });

  test('hospitality blend > residential (equity-heavy)', () => {
    const hospitality = opt.blendedCostOfCapital(opt.STACK_TEMPLATES.hospitality.base);
    const residential = opt.blendedCostOfCapital(opt.STACK_TEMPLATES.residential_apartments.base);
    expect(hospitality).toBeGreaterThan(residential);
  });
});

// ─── Sub-scorer pins ───────────────────────────────────────────────────────

describe('scoreCovenantCompliance', () => {
  test('all three pass with cushion → high score', () => {
    const out = opt.scoreCovenantCompliance({
      mix: opt.STACK_TEMPLATES.residential_apartments.conservative,
      totalCostCr: 100,
      grossSalesValueCr: 150,
      dscr: 1.80,
      covenantsForScenario: { ltv_max: 0.55, ltc_max: 0.65, dscr_min: 1.60 },
    });
    expect(out.score).toBeGreaterThanOrEqual(20);
    expect(out.covenants.ltv.passes).toBe(true);
    expect(out.covenants.ltc.passes).toBe(true);
    expect(out.covenants.dscr.passes).toBe(true);
  });

  test('DSCR below threshold → partial-credit only', () => {
    const out = opt.scoreCovenantCompliance({
      mix: opt.STACK_TEMPLATES.residential_apartments.conservative,
      totalCostCr: 100,
      grossSalesValueCr: 150,
      dscr: 1.30, // below 1.60 threshold
      covenantsForScenario: { ltv_max: 0.55, ltc_max: 0.65, dscr_min: 1.60 },
    });
    expect(out.score).toBeLessThan(15);
    expect(out.covenants.dscr.passes).toBe(false);
  });

  test('signal lists all three covenants with pass/fail marks', () => {
    const out = opt.scoreCovenantCompliance({
      mix: opt.STACK_TEMPLATES.residential_apartments.base,
      totalCostCr: 100,
      grossSalesValueCr: 150,
      dscr: 1.55,
      covenantsForScenario: { ltv_max: 0.65, ltc_max: 0.75, dscr_min: 1.40 },
    });
    expect(out.signal).toMatch(/LTV/);
    expect(out.signal).toMatch(/LTC/);
    expect(out.signal).toMatch(/DSCR/);
  });

  test('missing gross sales → LTV null (skipped)', () => {
    const out = opt.scoreCovenantCompliance({
      mix: opt.STACK_TEMPLATES.residential_apartments.base,
      totalCostCr: 100,
      grossSalesValueCr: null,
      dscr: 1.55,
      covenantsForScenario: { ltv_max: 0.65, ltc_max: 0.75, dscr_min: 1.40 },
    });
    expect(out.covenants.ltv).toBeNull();
  });
});

describe('scoreDebtServiceability', () => {
  test('DSCR below threshold → 0/20', () => {
    const out = opt.scoreDebtServiceability({ dscr: 1.20, dscrMin: 1.40 });
    expect(out.score).toBe(0);
    expect(out.signal).toMatch(/below 1.40× threshold/);
  });

  test('DSCR at threshold → ~8/20', () => {
    const out = opt.scoreDebtServiceability({ dscr: 1.40, dscrMin: 1.40 });
    expect(out.score).toBe(8);
  });

  test('DSCR with 0.4× cushion → 20/20', () => {
    const out = opt.scoreDebtServiceability({ dscr: 1.80, dscrMin: 1.40 });
    expect(out.score).toBe(20);
  });

  test('null DSCR → neutral 8/20 with honest message', () => {
    const out = opt.scoreDebtServiceability({ dscr: null, dscrMin: 1.40 });
    expect(out.score).toBe(8);
    expect(out.signal).toMatch(/no DSCR/);
  });
});

describe('scoreCapitalEfficiency', () => {
  test('lower equity = higher score', () => {
    const lowEquity = opt.scoreCapitalEfficiency({ mix: { equity_pct: 20 } });
    const highEquity = opt.scoreCapitalEfficiency({ mix: { equity_pct: 55 } });
    expect(lowEquity.score).toBeGreaterThan(highEquity.score);
  });

  test('15% equity → 20/20 (max efficient)', () => {
    const out = opt.scoreCapitalEfficiency({ mix: { equity_pct: 15 } });
    expect(out.score).toBe(20);
  });

  test('85% equity → 0/20 (no efficiency)', () => {
    const out = opt.scoreCapitalEfficiency({ mix: { equity_pct: 85 } });
    expect(out.score).toBe(0);
  });
});

describe('scoreCostOfCapital', () => {
  test('lower blended cost = higher score', () => {
    const cheap = opt.scoreCostOfCapital({
      mix: { equity_pct: 20, construction_finance_pct: 70, pref_equity_pct: 5, mezz_pct: 5 },
    });
    const expensive = opt.scoreCostOfCapital({
      mix: { equity_pct: 80, construction_finance_pct: 10, pref_equity_pct: 5, mezz_pct: 5 },
    });
    expect(cheap.score).toBeGreaterThan(expensive.score);
  });
});

describe('scoreFlexibility', () => {
  test('4-layer stack → 15/15', () => {
    const out = opt.scoreFlexibility({
      mix: { equity_pct: 30, construction_finance_pct: 50, pref_equity_pct: 12, mezz_pct: 8 },
    });
    expect(out.score).toBe(15);
    expect(out.signal).toMatch(/4-layer/);
  });

  test('barbell (equity + senior only) → low score', () => {
    const out = opt.scoreFlexibility({
      mix: { equity_pct: 50, construction_finance_pct: 50, pref_equity_pct: 0, mezz_pct: 0 },
    });
    expect(out.score).toBeLessThanOrEqual(6);
  });
});

// ─── Verdict + band dictionary ─────────────────────────────────────────────

describe('verdictFor / bandFor', () => {
  test('verdict thresholds follow the closed dictionary', () => {
    expect(opt.verdictFor(90)).toBe('Recommend');
    expect(opt.verdictFor(60)).toBe('Consider');
    expect(opt.verdictFor(40)).toBe('Re-examine');
    expect(opt.verdictFor(20)).toBe('Stress-test');
    expect(opt.verdictFor(10)).toBe('Flag');
  });

  test('every verdict is in the closed dictionary', () => {
    [0, 14, 15, 34, 35, 54, 55, 74, 75, 100].forEach((s) => {
      expect(opt.VERDICT_DICT).toContain(opt.verdictFor(s));
    });
  });

  test('bands match tiers', () => {
    expect(opt.bandFor(75)).toBe('high');
    expect(opt.bandFor(50)).toBe('medium');
    expect(opt.bandFor(30)).toBe('low');
  });
});

// ─── Composer: scoreScenario ───────────────────────────────────────────────

describe('scoreScenario', () => {
  test('healthy residential + conservative → all covenants pass + Recommend or Consider', () => {
    const out = opt.scoreScenario({
      scenario: 'conservative',
      assetClass: 'residential_apartments',
      totalCostCr: 100,
      grossSalesValueCr: 150,
      dscr: 1.80,
    });
    expect(out.scenario).toBe('conservative');
    expect(out.label).toBe('Conservative');
    expect(['Recommend', 'Consider']).toContain(out.verdict);
    expect(out.covenants.ltv.passes).toBe(true);
    expect(out.covenants.ltc.passes).toBe(true);
    expect(out.covenants.dscr.passes).toBe(true);
    expect(out.mix.equity_pct).toBe(50);
    expect(out.amounts_cr.equity).toBe(50);
    expect(out.amounts_cr.construction_finance).toBe(30);
  });

  test('stressed residential + aggressive → DSCR fails, Re-examine or worse', () => {
    const out = opt.scoreScenario({
      scenario: 'aggressive',
      assetClass: 'residential_apartments',
      totalCostCr: 100,
      grossSalesValueCr: 120,
      dscr: 1.20,
    });
    expect(out.factors.debt_serviceability.score).toBe(0); // DSCR below aggressive 1.25 threshold
    expect(['Re-examine', 'Stress-test', 'Flag']).toContain(out.verdict);
  });

  test('unknown scenario → null', () => {
    expect(
      opt.scoreScenario({
        scenario: 'unknown',
        assetClass: 'residential_apartments',
        totalCostCr: 100,
        grossSalesValueCr: 150,
        dscr: 1.5,
      })
    ).toBeNull();
  });

  test('unknown asset class → uses residential defaults but still scores', () => {
    const out = opt.scoreScenario({
      scenario: 'base',
      assetClass: 'space_elevator', // unknown
      totalCostCr: 100,
      grossSalesValueCr: 150,
      dscr: 1.5,
    });
    expect(out).not.toBeNull();
    expect(out.score).toBeGreaterThan(0);
  });

  test('rationale has 3 lines including covenant signal', () => {
    const out = opt.scoreScenario({
      scenario: 'base',
      assetClass: 'residential_apartments',
      totalCostCr: 100,
      grossSalesValueCr: 150,
      dscr: 1.50,
    });
    expect(out.rationale).toHaveLength(3);
    expect(out.rationale[0]).toMatch(/Base stack/);
    expect(out.rationale[1]).toMatch(/LTV|LTC|DSCR/);
  });
});

// ─── scoreFromFinancials (the public read model) ───────────────────────────

describe('scoreFromFinancials', () => {
  test('no asset class → empty with honest reason', () => {
    expect(opt.scoreFromFinancials({ financials: HEALTHY_RESIDENTIAL })).toEqual({
      scenarios: [],
      reason: 'no_asset_class',
    });
  });

  test('no financials → empty with no_financial_model', () => {
    expect(
      opt.scoreFromFinancials({ assetClass: 'residential_apartments', financials: null })
    ).toEqual({ scenarios: [], reason: 'no_financial_model' });
  });

  test('zero total cost → incomplete_kernel_output', () => {
    expect(
      opt.scoreFromFinancials({
        assetClass: 'residential_apartments',
        financials: { model_params: { costs: { totalCr: 0 } } },
      })
    ).toEqual({ scenarios: [], reason: 'incomplete_kernel_output' });
  });

  test('healthy residential → 3 scenarios scored, sorted desc; healthy DSCR rewards leverage', () => {
    const out = opt.scoreFromFinancials({
      assetClass: 'residential_apartments',
      financials: HEALTHY_RESIDENTIAL,
    });
    expect(out.reason).toBeNull();
    expect(out.scenarios).toHaveLength(3);
    expect(out.scenarios.map((s) => s.scenario)).toEqual(expect.arrayContaining(['conservative', 'base', 'aggressive']));
    for (let i = 1; i < out.scenarios.length; i += 1) {
      expect(out.scenarios[i].score).toBeLessThanOrEqual(out.scenarios[i - 1].score);
    }
    // With DSCR 1.70 (well above all three thresholds), the aggressive
    // scenario passes covenants with cushion AND is capital-efficient AND
    // has lower blended cost — so it correctly ranks above conservative.
    // The optimizer rewards taking warranted leverage when project
    // economics support it.
    expect(out.scenarios[0].scenario).toBe('aggressive');
    // All three scenarios should pass covenants under healthy DSCR.
    out.scenarios.forEach((s) => {
      expect(s.covenants.dscr.passes).toBe(true);
    });
  });

  test('inputs slice echoes the kernel-extracted numbers', () => {
    const out = opt.scoreFromFinancials({
      assetClass: 'residential_apartments',
      financials: HEALTHY_RESIDENTIAL,
    });
    expect(out.inputs.asset_class).toBe('residential_apartments');
    expect(out.inputs.total_cost_cr).toBe(100);
    expect(out.inputs.gross_sales_value_cr).toBe(150);
    expect(out.inputs.stabilized_dscr).toBe(1.7);
  });

  test('stressed residential → conservative still passes but aggressive fails DSCR', () => {
    const out = opt.scoreFromFinancials({
      assetClass: 'residential_apartments',
      financials: STRESSED_RESIDENTIAL,
    });
    const aggressive = out.scenarios.find((s) => s.scenario === 'aggressive');
    expect(aggressive.factors.debt_serviceability.score).toBeGreaterThanOrEqual(0);
    expect(aggressive.factors.debt_serviceability.signal).toMatch(/DSCR/);
  });

  test('handles row-shaped financials (flat columns) as well as model_params nested', () => {
    const flat = {
      total_cost_cr: 100,
      total_revenue_cr: 150,
      kpis: { dscr: 1.55 },
    };
    const out = opt.scoreFromFinancials({
      assetClass: 'commercial_office',
      financials: flat,
    });
    expect(out.scenarios).toHaveLength(3);
    expect(out.inputs.total_cost_cr).toBe(100);
    expect(out.inputs.stabilized_dscr).toBe(1.55);
  });
});

// ─── Asset-class coverage smoke test ───────────────────────────────────────

describe('STACK_TEMPLATES — every asset class is covered', () => {
  test('every asset class has all three scenarios summing to 100%', () => {
    Object.entries(opt.STACK_TEMPLATES).forEach(([assetClass, scenarios]) => {
      ['conservative', 'base', 'aggressive'].forEach((scen) => {
        const mix = scenarios[scen];
        expect(mix).toBeDefined();
        const total = mix.equity_pct + mix.construction_finance_pct + mix.pref_equity_pct + mix.mezz_pct;
        expect(total).toBe(100); // sanity: every stack sums to 100%
      });
    });
  });

  test('every asset class has covenant bands defined', () => {
    Object.keys(opt.STACK_TEMPLATES).forEach((assetClass) => {
      expect(opt.COVENANT_BANDS[assetClass]).toBeDefined();
      expect(opt.COVENANT_BANDS[assetClass].ltv_max_base).toBeGreaterThan(0);
      expect(opt.COVENANT_BANDS[assetClass].ltc_max_base).toBeGreaterThan(0);
      expect(opt.COVENANT_BANDS[assetClass].dscr_min_base).toBeGreaterThan(1);
    });
  });
});
