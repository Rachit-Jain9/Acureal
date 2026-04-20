import { DealInputError, normalizeDealInput } from '../src/inputSchema';
import { computeDeal } from '../src/registry';

describe('normalizeDealInput — area units', () => {
  test('accepts direct sqft', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaSqft: 25000,
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
      },
    });
    expect(r.raw.plotAreaSqft).toBe(25000);
  });

  test('accepts legacy plotAreaAcres', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaAcres: 1,
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
      },
    });
    expect(r.raw.plotAreaSqft).toBeCloseTo(43560, 0);
  });

  test('accepts {value, unit} tuple', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaSqft: { value: 1000, unit: 'sqm' },
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
      },
    });
    expect(r.raw.plotAreaSqft).toBeCloseTo(10_763.9, 0);
  });
});

describe('normalizeDealInput — money units', () => {
  test('accepts direct Cr', () => {
    const r = normalizeDealInput({
      assetClass: 'land_parcel',
      raw: { landCostCr: 50 },
    });
    expect(r.raw.landCostCr).toBe(50);
  });

  test('accepts landCostLakh alias', () => {
    const r = normalizeDealInput({
      assetClass: 'land_parcel',
      raw: { landCostLakh: 500 },
    });
    expect(r.raw.landCostCr).toBe(5);
  });
});

describe('normalizeDealInput — rate coercion', () => {
  test('accepts percent form', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaSqft: 25000,
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
        financeCostPct: 12,
      },
    });
    expect(r.raw.financeCostPct).toBe(12);
  });

  test('accepts fraction form', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaSqft: 25000,
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
        financeCostPct: 0.12,
      },
    });
    expect(r.raw.financeCostPct).toBe(12);
  });
});

describe('normalizeDealInput — required fields', () => {
  test('throws DealInputError when landCostCr missing', () => {
    expect(() =>
      normalizeDealInput({
        assetClass: 'residential_apartments',
        raw: {
          plotAreaSqft: 25000,
          fsi: 3,
          constructionCostPerSqft: 4500,
          sellingRatePerSqft: 42000,
        },
      }),
    ).toThrow(DealInputError);
  });

  test('land_parcel requires only landCostCr', () => {
    const r = normalizeDealInput({ assetClass: 'land_parcel', raw: { landCostCr: 50 } });
    expect(r.raw.landCostCr).toBe(50);
  });
});

describe('normalizeDealInput — assumption hierarchy', () => {
  test('backfills global defaults when deal omits them', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaSqft: 25000,
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
      },
    });
    // contingencyPct from GLOBAL_DEFAULTS
    expect(r.raw.contingencyPct).toBe(5);
    // discountRatePct from GLOBAL_DEFAULTS
    expect(r.raw.discountRatePct).toBe(14);
  });

  test('deal override wins over default', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaSqft: 25000,
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
        discountRatePct: 9,
      },
    });
    expect(r.raw.discountRatePct).toBe(9);
  });

  test('scenario override wins over deal', () => {
    const r = normalizeDealInput({
      assetClass: 'residential_apartments',
      raw: {
        plotAreaSqft: 25000,
        fsi: 3,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 100,
        discountRatePct: 9,
      },
      scenarioOverrides: { discountRatePct: 18 },
    });
    expect(r.raw.discountRatePct).toBe(18);
  });
});

describe('computeDeal — normalises inputs end-to-end', () => {
  test('accepts mixed-unit raw inputs and produces a well-formed result', () => {
    const result = computeDeal({
      assetClass: 'residential_apartments',
      raw: {
        effectiveDate: '2026-01-01',
        plotAreaAcres: 25_000 / 43_560, // legacy alias ≈ 0.574 acres
        fsi: 3,
        loadingFactor: 15, // passed as pct form
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 155,
        approvalCostCr: 8.5,
        marketingCostPct: 0.035, // fraction form
        financeCostPct: 12,
        developerMarginPct: 20,
        projectDurationYears: 3.5, // legacy months alias
        contingencyPct: 5,
        architectFeePct: 2,
        pmcFeePct: 1.5,
        constructionStartMonths: 3,
        constructionEndMonths: 36,
        avgUnitSizeSqft: 1450,
      },
    });

    // Revenue + total cost should match the canonical fixture to 1 decimal Cr
    expect(result.kpis.revenue.toNumber()).toBeCloseTo(362.25, 1);
    expect(result.kpis.totalCost.toNumber()).toBeCloseTo(306.0, 0);
  });

  test('scenario override changes discount rate → NPV changes', () => {
    const base = {
      assetClass: 'residential_apartments' as const,
      raw: {
        effectiveDate: '2026-01-01',
        plotAreaSqft: 25000,
        fsi: 3,
        loadingFactor: 0.15,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 155,
        approvalCostCr: 8.5,
        marketingCostPct: 3.5,
        financeCostPct: 12,
        developerMarginPct: 20,
        projectDurationMonths: 42,
        discountRatePct: 12,
        contingencyPct: 5,
        architectFeePct: 2,
        pmcFeePct: 1.5,
        constructionStartMonths: 3,
        constructionEndMonths: 36,
        avgUnitSizeSqft: 1450,
      },
    };
    const baseResult = computeDeal(base);
    const scenarioResult = computeDeal(base, { scenarioOverrides: { discountRatePct: 18 } });
    expect(scenarioResult.kpis.npv.toNumber()).toBeLessThan(baseResult.kpis.npv.toNumber());
  });
});
