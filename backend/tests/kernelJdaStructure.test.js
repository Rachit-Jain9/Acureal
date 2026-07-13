'use strict';

// Integration guard for the JDA structure-aware kernel math (2026-07-13).
// A Joint Development Agreement contributes the land (zero cost) for a share of
// revenue; the kernel used to charge full land cost for every deal, misstating
// the most common Bengaluru structure. computeFullFinancials now applies the
// deterministic adjustment (land = 0, revenue x (1 - share)) around a fully
// structure-correct compute, while echoing the operator's RAW inputs.

const { computeFullFinancials } = require('../src/engines/kernel.service');

const baseDeal = () => ({
  assetClass: 'residential_apartments',
  plotAreaSqft: 100000, fsi: 2.5, loadingFactor: 0.15,
  constructionCostPerSqft: 4500, sellingRatePerSqft: 12000, landCostCr: 90,
  approvalCostCr: 8, marketingCostPct: 4, financeCostPct: 12, discountRatePct: 14,
  projectDurationMonths: 36, salesVelocityPct: 0.18, debtLTV: 0.55, debtRatePct: 11.5,
});

describe('kernel — JDA structure-aware math', () => {
  it('contributes the land (0 cost + 0 stamp duty) and nets revenue by the share', () => {
    const outright = computeFullFinancials(baseDeal());
    const jda = computeFullFinancials({ ...baseDeal(), landownerSharePct: 0.25 });

    // Land contributed → land line and stamp duty both zero (no purchase).
    expect(Number(jda.costs.land)).toBe(0);
    expect(Number(jda.costs.stampDuty)).toBe(0);
    expect(Number(outright.costs.land)).toBe(90); // control: outright still charges it

    // Developer keeps (1 - share) of revenue: 25% share → 0.75x.
    const ratio = Number(jda.revenue.totalRevenueCr) / Number(outright.revenue.totalRevenueCr);
    expect(ratio).toBeCloseTo(0.75, 4);

    // Removing a ₹90 Cr land cost turns this land-heavy deal from value-
    // destroying (outright) to viable (JDA) — the whole point.
    expect(Number(outright.kpis.npv)).toBeLessThan(0);
    expect(Number(jda.kpis.npv)).toBeGreaterThan(0);
  });

  it('records an auditable adjustment and echoes the RAW operator inputs', () => {
    const jda = computeFullFinancials({ ...baseDeal(), landownerSharePct: 0.25 });
    expect(jda.structureAdjustment).toMatchObject({
      applied: true, landownerShare: 0.25, revenueKeepFactor: 0.75, grossLandCostCr: 90,
    });
    // The app form must still see what the operator typed, not the net figures.
    expect(jda.inputs.landCostCr).toBe(90);
    expect(jda.inputs.sellingRatePerSqft).toBe(12000);
  });

  it('leaves an outright purchase completely unchanged (no adjustment)', () => {
    const outright = computeFullFinancials(baseDeal());
    expect(outright.structureAdjustment).toBeNull();
    expect(Number(outright.costs.land)).toBe(90);
  });

  it('does not throw when land is contributed (schema allows landCostCr = 0)', () => {
    expect(() => computeFullFinancials({ ...baseDeal(), landCostCr: 0 })).not.toThrow();
  });
});
