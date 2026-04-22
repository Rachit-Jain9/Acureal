/**
 * Raw land parcel — holding cost model. No construction, no revenue during
 * hold; appreciation and an exit sale at a target cap/cap-like multiple.
 *
 * We intentionally keep this minimal: a land-only adapter exists so a deal
 * stage earlier than design can still produce IRR/NPV/holding-economics
 * before construction math is applicable.
 */

import { Decimal } from '../decimal';
import { bulletInflow } from '../cashflow';
import { buildPeriodIndex } from '../periods';
import type { AreaBreakdown, DealInputs, KernelResult, MonthlyLineItem } from '../types';
import { prov } from '../provenance';
import {
  CRORE,
  D,
  STAMP_DUTY_RATE,
  approvalsSchedule,
  assembleCosts,
  finalizeResult,
  landAndStamp,
  maybeFinancing,
  num,
  uniformAcrossProject,
} from './common';

export function computeLandParcel(inputs: DealInputs): KernelResult {
  const raw = inputs.raw;

  const landCostCr = num(raw.landCostCr);
  const totalLandSqft = num(raw.totalLandSqft, 0);
  const holdYears = num(raw.holdPeriodYears, 3);
  const discountRatePct = num(raw.discountRatePct, 14);
  const appreciationPct = num(raw.landAppreciationPct, 8);
  const holdingCostPerYearCr = num(raw.holdingCostPerYearCr, 0);
  const holdMonths = Math.max(12, Math.round(holdYears * 12));

  if (landCostCr <= 0) {
    throw new Error('Land-parcel kernel: landCostCr is required');
  }

  const period = buildPeriodIndex({
    effectiveDate: typeof raw.effectiveDate === 'string' ? raw.effectiveDate : undefined,
    projectDurationMonths: holdMonths,
    constructionStartMonth: 0,
    constructionEndMonth: holdMonths,
  });

  const stampDutyCr = D(landCostCr).mulNumber(STAMP_DUTY_RATE);
  const approvalCostCr = D(num(raw.approvalCostCr));
  const holdingCostTotalCr = D(holdingCostPerYearCr).mulNumber(holdYears);
  const exitValueCr = D(landCostCr).mulNumber(Math.pow(1 + appreciationPct / 100, holdYears));

  const items: MonthlyLineItem[] = [
    landAndStamp({ period, land: D(landCostCr), stampDuty: stampDutyCr }),
    ...approvalsSchedule({ period, amount: approvalCostCr }),
    uniformAcrossProject({
      period,
      amount: holdingCostTotalCr,
      category: 'soft_cost',
      subcategory: 'holding_cost',
      provenance: [prov('cashflow.holdingCost', 'uniform over hold')],
    }),
    bulletInflow({
      period,
      month: period.totalMonths,
      amount: exitValueCr,
      category: 'revenue',
      subcategory: 'land_sale',
      provenance: [prov('cashflow.exit', 'landCost × (1+appreciation)^years')],
    }),
  ];

  const areas: AreaBreakdown = {
    grossBuiltUpSqft: totalLandSqft > 0 ? totalLandSqft : null,
    saleableSqft: null,
    carpetSqft: null,
    superBuiltUpSqft: null,
    leasableSqft: null,
    extras: Object.freeze({}),
  };

  const costs = assembleCosts({
    land: D(landCostCr),
    construction: Decimal.zero(),
    gst: Decimal.zero(),
    contingency: Decimal.zero(),
    stampDuty: stampDutyCr,
    approval: approvalCostCr,
    architecture: null,
    pmc: null,
    marketing: null,
    finance: null,
    extras: {
      holdingCostsCr: holdingCostTotalCr,
    },
  });

  const financing = maybeFinancing({
    totalCost: costs.totalCr,
    debtableBase: D(landCostCr),
    debtLTV: Math.max(0, Math.min(1, num(raw.debtLTV, 0))),
    debtRatePct: num(raw.debtRatePct, 10.5),
    constructionMonths: holdMonths,
  });

  const kpiExtras: Record<string, number | null> = {
    exitValue: exitValueCr.toNumber(),
    landAppreciationPct: appreciationPct,
    holdYears,
    landCostPerSqft: totalLandSqft > 0 ? (landCostCr * CRORE) / totalLandSqft : null,
  };

  return finalizeResult({
    assetClass: 'land_parcel',
    period,
    areas,
    costs,
    revenue: {
      totalRevenueCr: exitValueCr,
      stabilizedNOICr: null,
      exitValueCr,
      extras: Object.freeze({}),
    },
    items,
    discountRatePct,
    financing,
    equityReturnsMode: 'income',
    kpiExtras,
  });
}
