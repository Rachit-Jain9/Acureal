/**
 * Representative fixture inputs for every asset class. Used by golden
 * tests to guard against unintended drift when primitives change.
 *
 * `jiganiResidential` stands in for the flagship Bengaluru / Jigani
 * residential case. No proprietary comps are encoded here — the values
 * exercise plausible Bengaluru ranges and are not meant to be precise
 * forecasts for any real deal.
 */

import type { AssetClass, DealInputs } from '../src/types';

export const jiganiResidential: DealInputs = {
  assetClass: 'residential_apartments',
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

export const plottedSample: DealInputs = {
  assetClass: 'plotted_development',
  raw: {
    effectiveDate: '2026-01-01',
    totalLandSqft: 400000,
    saleableLandPct: 55,
    avgPlotSizeSqft: 1500,
    sellingRatePerSqft: 3800,
    landCostCr: 40,
    devCostPerSqft: 350,
    approvalCostCr: 3,
    projectDurationMonths: 24,
    marketingCostPct: 4,
    financeCostPct: 12,
    discountRatePct: 14,
  },
};

export const commercialSample: DealInputs = {
  assetClass: 'commercial_office',
  raw: {
    effectiveDate: '2026-01-01',
    leasableAreaSqft: 300_000,
    constructionCostPerSqft: 5500,
    landCostCr: 75,
    baseRentPerSqftMonth: 95,
    rentEscalationPct: 5,
    vacancyPct: 10,
    opexPct: 22,
    tiPerSqft: 800,
    lcMonths: 4,
    exitCapRate: 7.5,
    entryCapRate: 8,
    holdPeriodYears: 5,
    projectDurationMonths: 36,
    discountRatePct: 14,
    contingencyPct: 4,
    approvalCostCr: 4,
  },
};

export const retailSample: DealInputs = {
  assetClass: 'retail',
  raw: {
    ...commercialSample.raw,
    baseRentPerSqftMonth: 140,
    anchorPct: 40,
    anchorRentDiscount: 20,
    opexPct: 25,
    exitCapRate: 8,
  },
};

export const industrialSample: DealInputs = {
  assetClass: 'industrial_warehousing',
  raw: {
    effectiveDate: '2026-01-01',
    leasableAreaSqft: 500_000,
    constructionCostPerSqft: 2200,
    landCostCr: 45,
    baseRentPerSqftMonth: 26,
    rentEscalationPct: 5,
    vacancyPct: 8,
    opexPct: 15,
    tiPerSqft: 150,
    lcMonths: 2,
    exitCapRate: 8.5,
    entryCapRate: 9,
    holdPeriodYears: 5,
    projectDurationMonths: 18,
    discountRatePct: 13,
    contingencyPct: 4,
    approvalCostCr: 2,
  },
};

export const hospitalitySample: DealInputs = {
  assetClass: 'hospitality',
  raw: {
    effectiveDate: '2026-01-01',
    keys: 180,
    constructionCostPerKey: 9_500_000,
    landCostCr: 60,
    preOpeningCostPerKey: 350_000,
    adr: 7500,
    adrGrowthPct: 5,
    stabilizedOccPct: 68,
    holdPeriodYears: 8,
    fbRevPct: 28,
    otherRevPct: 10,
    gopMarginPct: 36,
    ebitdaMarginPct: 28,
    exitCapRate: 9,
    discountRatePct: 15,
    projectDurationMonths: 30,
    approvalCostCr: 3,
  },
};

export const mixedUseSample: DealInputs = {
  assetClass: 'mixed_use',
  raw: {
    ...jiganiResidential.raw,
    sellingRatePerSqft: 38000,
  },
};

export const landParcelSample: DealInputs = {
  assetClass: 'land_parcel',
  raw: {
    effectiveDate: '2026-01-01',
    landCostCr: 50,
    totalLandSqft: 100_000,
    holdPeriodYears: 3,
    landAppreciationPct: 12,
    holdingCostPerYearCr: 0.4,
    discountRatePct: 14,
    approvalCostCr: 1,
  },
};

export const villasSample: DealInputs = {
  assetClass: 'villas',
  raw: {
    ...jiganiResidential.raw,
    fsi: 0.8,
    loadingFactor: 0.05,
    sellingRatePerSqft: 13_500,
    constructionCostPerSqft: 3800,
    avgUnitSizeSqft: 3500,
  },
};

export const redevelopmentSample: DealInputs = {
  assetClass: 'redevelopment',
  raw: {
    ...jiganiResidential.raw,
    rehousingCostCr: 6,
  },
};

export const allFixtures: Record<AssetClass, DealInputs> = {
  residential_apartments: jiganiResidential,
  plotted_development: plottedSample,
  commercial_office: commercialSample,
  retail: retailSample,
  industrial_warehousing: industrialSample,
  hospitality: hospitalitySample,
  mixed_use: mixedUseSample,
  land_parcel: landParcelSample,
  villas: villasSample,
  redevelopment: redevelopmentSample,
};
