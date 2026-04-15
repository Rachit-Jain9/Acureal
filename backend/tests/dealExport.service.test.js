const { __testables } = require('../src/services/dealExport.service');

describe('dealExport.service helpers', () => {
  const {
    deriveBenchmarks,
    computeRecommendation,
    summarizeCashFlows,
    mapAssetClassToCompType,
  } = __testables;

  test('maps asset classes to export comp types', () => {
    expect(mapAssetClassToCompType('commercial_office')).toBe('office');
    expect(mapAssetClassToCompType('industrial_warehousing')).toBe('industrial');
    expect(mapAssetClassToCompType('residential_apartments')).toBe('residential');
  });

  test('derives benchmark statistics from comp rates', () => {
    const summary = deriveBenchmarks([
      { rate_per_sqft: 8200 },
      { rate_per_sqft: 9100 },
      { rate_per_sqft: 10000 },
      { rate_per_sqft: 11000 },
    ]);

    expect(summary.available).toBe(true);
    expect(summary.count).toBe(4);
    expect(summary.min_rate_per_sqft).toBe(8200);
    expect(summary.max_rate_per_sqft).toBe(11000);
    expect(summary.median_rate_per_sqft).toBe(10000);
  });

  test('summarizes quarterly cash flows with cumulative metrics', () => {
    const result = summarizeCashFlows({
      quarterly: [
        { quarter: 0, label: 'Effective Date', net: -20 },
        { quarter: 1, label: 'Q1', net: -10 },
        { quarter: 2, label: 'Q2', net: 18 },
        { quarter: 3, label: 'Q3', net: 22 },
      ],
    });

    expect(result.quarterly).toHaveLength(4);
    expect(result.summary.totalInflow).toBe(40);
    expect(result.summary.totalOutflow).toBe(30);
    expect(result.summary.net).toBe(10);
    expect(result.summary.peakDeployment).toBe(30);
    expect(result.summary.firstPositiveLabel).toBe('Q3');
  });

  test('flags review recommendation when critical risks are open', () => {
    const recommendation = computeRecommendation({
      ddSummary: { open_deal_breakers: 0, completion_pct: 72 },
      riskSummary: { critical: 1, high: 0, medium: 0, low: 0 },
      hasFinancialModel: true,
      irrPct: 22,
      grossMarginPct: 24,
    });

    expect(recommendation.label).toBe('Requires Review');
  });

  test('flags incomplete underwriting when model outputs are missing', () => {
    const recommendation = computeRecommendation({
      ddSummary: { open_deal_breakers: 0, completion_pct: 80 },
      riskSummary: { critical: 0, high: 0, medium: 0, low: 0 },
      hasFinancialModel: false,
      irrPct: null,
      grossMarginPct: null,
    });

    expect(recommendation.label).toBe('Incomplete Underwriting');
  });

  test('flags reprice or rework when the stored underwriting is value-destructive', () => {
    const recommendation = computeRecommendation({
      ddSummary: { open_deal_breakers: 0, completion_pct: 80 },
      riskSummary: { critical: 0, high: 0, medium: 0, low: 0 },
      hasFinancialModel: true,
      irrPct: -18.6,
      grossMarginPct: -50.8,
      totalRevenueCr: 76.9,
      totalCostCr: 115.99,
      askPriceCr: 160,
      residualLandValueCr: 110,
    });

    expect(recommendation.label).toBe('Reprice / Rework');
    expect(recommendation.tone).toBe('negative');
  });
});
