/**
 * Residential apartments (also the base model for villas, mixed_use,
 * and redevelopment — see their adapters for the per-class overrides).
 *
 * Mirrors the legacy engine's shape: FSI → gross → loading → saleable,
 * S-curve hard costs, milestone sales, residual land value.
 */

import { Decimal, sum as decSum } from '../decimal';
import { buildPeriodIndex } from '../periods';
import { buildDrawSchedule } from '../debtSchedule';
import type { AreaBreakdown, AssetClass, DealInputs, KernelResult, MonthlyLineItem } from '../types';
import { prov } from '../provenance';
import {
  CARPET_RATIO,
  CRORE,
  D,
  DEFAULT_LOADING_FACTOR,
  DEFAULT_GST_BY_ASSET,
  STAMP_DUTY_RATE,
  assembleCosts,
  approvalsSchedule,
  finalizeResult,
  financeDrag,
  hardCostItem,
  landAndStamp,
  marketingSchedule,
  maybeFinancing,
  num,
  preConstructionSoftCosts,
  salesMilestoneCollections,
} from './common';

export interface ResidentialOptions {
  readonly assetClassOverride?: AssetClass;
}

export function computeResidential(
  inputs: DealInputs,
  options: ResidentialOptions = {},
): KernelResult {
  const raw = inputs.raw;
  const assetClass = options.assetClassOverride ?? inputs.assetClass;

  const plotAreaSqft = num(raw.plotAreaSqft);
  const fsi = num(raw.fsi);
  const loadingFactor = raw.loadingFactor != null ? num(raw.loadingFactor, DEFAULT_LOADING_FACTOR) : DEFAULT_LOADING_FACTOR;
  const constructionCostPerSqft = num(raw.constructionCostPerSqft);
  const sellingRatePerSqft = num(raw.sellingRatePerSqft);
  const landCostCr = num(raw.landCostCr);
  const marketingCostPct = num(raw.marketingCostPct, 5);
  const financeCostPct = num(raw.financeCostPct, 12);
  const developerMarginPct = num(raw.developerMarginPct, 20);
  const discountRatePct = num(raw.discountRatePct, 14);
  const pricingEscalationPct = num(raw.pricingEscalationPct, 0);
  const contingencyPct = num(raw.contingencyPct, 5);
  const architectFeePct = num(raw.architectFeePct, 2);
  const pmcFeePct = num(raw.pmcFeePct, 1.5);
  const debtLTV = Math.max(0, Math.min(1, num(raw.debtLTV, 0)));
  const debtLTC = num(raw.debtLTC, 0);
  const debtRatePct = num(raw.debtRatePct, 10.5);
  const debtTenorYears = num(raw.debtTenorYears, 0);
  const debtTenorMonths = debtTenorYears > 0 ? debtTenorYears * 12 : undefined;

  const durationMonthsRaw = num(raw.projectDurationMonths, 36);
  const constructionStartMonthsRaw = raw.constructionStartMonths != null
    ? num(raw.constructionStartMonths, 3)
    : num(raw.constructionStartYears, 0.25) * 12;
  const constructionEndMonthsRaw = raw.constructionEndMonths != null
    ? num(raw.constructionEndMonths, Math.round(durationMonthsRaw * 0.85))
    : num(raw.constructionEndYears, durationMonthsRaw / 12 * 0.85) * 12;

  if (plotAreaSqft <= 0 || fsi <= 0 || constructionCostPerSqft <= 0 || sellingRatePerSqft <= 0) {
    throw new Error('Residential kernel: required input missing (plotAreaSqft, fsi, constructionCostPerSqft, sellingRatePerSqft)');
  }
  if (fsi > 20) throw new Error('Residential kernel: FSI out of range (0–20)');
  if (loadingFactor < 0 || loadingFactor > 1) throw new Error('Residential kernel: loadingFactor must be 0–1');

  const period = buildPeriodIndex({
    effectiveDate: typeof raw.effectiveDate === 'string' ? raw.effectiveDate : undefined,
    projectDurationMonths: durationMonthsRaw,
    constructionStartMonth: Math.round(constructionStartMonthsRaw),
    constructionEndMonth: Math.round(constructionEndMonthsRaw),
  });

  const grossAreaSqft = plotAreaSqft * fsi;
  const saleableAreaSqft = grossAreaSqft * (1 + loadingFactor);
  const carpetAreaSqft = grossAreaSqft * CARPET_RATIO;
  const avgUnitSize = num(raw.avgUnitSizeSqft, 0);
  const numberOfUnits = avgUnitSize > 0 ? Math.max(1, Math.round(saleableAreaSqft / avgUnitSize)) : null;

  // Revenue with compound pricing escalation (average effective rate over sell window).
  const durationYears = period.totalMonths / 12;
  const avgPriceEsc =
    pricingEscalationPct > 0
      ? (Math.pow(1 + pricingEscalationPct / 100, durationYears) - 1) /
        ((pricingEscalationPct / 100) * durationYears)
      : 1;
  const effectiveRate = sellingRatePerSqft * avgPriceEsc;
  const totalRevenueCr = D((saleableAreaSqft * effectiveRate) / CRORE);

  // HARD + GST
  const constructionCostCr = D((saleableAreaSqft * constructionCostPerSqft) / CRORE);
  const gstRate =
    num(raw.gstPct, DEFAULT_GST_BY_ASSET[assetClass] * 100) / 100;
  const gstCr = constructionCostCr.mulNumber(gstRate);
  const contingencyCr = constructionCostCr.mulNumber(contingencyPct / 100);
  const stampDutyCr = D(landCostCr * STAMP_DUTY_RATE);

  // SOFT
  const architectCr = constructionCostCr.mulNumber(architectFeePct / 100);
  const pmcCr = constructionCostCr.mulNumber(pmcFeePct / 100);
  const approvalCostCr = num(raw.approvalCostPerSqft, 0) > 0
    ? D((grossAreaSqft * num(raw.approvalCostPerSqft)) / CRORE)
    : D(num(raw.approvalCostCr));
  const marketingCr = totalRevenueCr.mulNumber(marketingCostPct / 100);

  const hardCostCr = constructionCostCr.add(gstCr).add(contingencyCr);
  const constructionTenorMonths = Math.max(
    1,
    period.constructionEndMonth - period.constructionStartMonth,
  );

  // Finance cost: actual accrual on outstanding balance each quarter.
  // Land funded at acquisition, accrues quarterly-compounding until loan
  // maturity (or construction-end + 1 qtr if no tenor given).
  // Construction drawn on S-curve; interest capitalises on actual balance
  // each quarter. Mirrors legacy residential engine byte-for-byte so parity
  // holds — simple ×0.5 shortcut was an approximation, this is the real cost.
  const totalQResidential = Math.max(1, Math.ceil(period.totalMonths / 3));
  const constStartQRes = Math.max(1, Math.floor(period.constructionStartMonth / 3) + 1);
  const constEndQRes = Math.min(
    totalQResidential,
    Math.max(constStartQRes, Math.ceil(period.constructionEndMonth / 3)),
  );
  const debtTenorMonthsIn = debtTenorMonths && debtTenorMonths > 0
    ? debtTenorMonths
    : Math.min(period.totalMonths, period.constructionEndMonth + 3);
  const carryQRes = Math.min(totalQResidential, Math.max(1, Math.ceil(debtTenorMonthsIn / 3)));
  const qFinRate = Math.pow(1 + financeCostPct / 100, 0.25) - 1;
  const landFinanceCr = landCostCr > 0 && carryQRes > 0
    ? D(landCostCr * (Math.pow(1 + qFinRate, carryQRes) - 1))
    : D(0);
  const constSchedule = buildDrawSchedule({
    principalCr: hardCostCr.toNumber(),
    annualRatePct: financeCostPct,
    totalQuarters: carryQRes,
    drawStartQ: constStartQRes,
    drawEndQ: Math.min(constEndQRes, carryQRes),
    capitalizeInterest: true,
  });
  const constFinanceCr = D(constSchedule.totalInterestCr);
  const financeCr = landFinanceCr.add(constFinanceCr);

  // Areas
  const areas: AreaBreakdown = {
    grossBuiltUpSqft: grossAreaSqft,
    saleableSqft: saleableAreaSqft,
    carpetSqft: carpetAreaSqft,
    superBuiltUpSqft: saleableAreaSqft,
    leasableSqft: null,
    extras: Object.freeze({
      numberOfUnits: numberOfUnits != null ? numberOfUnits : null,
      avgUnitSizeSqft: avgUnitSize > 0 ? avgUnitSize : null,
    }),
  };

  const costs = assembleCosts({
    land: D(landCostCr),
    construction: constructionCostCr,
    gst: gstCr,
    contingency: contingencyCr,
    stampDuty: stampDutyCr,
    approval: approvalCostCr,
    architecture: architectCr,
    pmc: pmcCr,
    marketing: marketingCr,
    finance: financeCr,
  });

  // Cash-flow items (shared primitives only)
  const items: MonthlyLineItem[] = [
    landAndStamp({ period, land: D(landCostCr), stampDuty: stampDutyCr }),
    ...approvalsSchedule({ period, amount: approvalCostCr }),
    preConstructionSoftCosts({ period, architect: architectCr, pmc: pmcCr }),
    hardCostItem({ period, amount: hardCostCr }),
    marketingSchedule({ period, amount: marketingCr }),
    financeDrag({ period, amount: financeCr }),
    salesMilestoneCollections({
      period,
      amount: totalRevenueCr,
      startMonth: Math.max(1, period.constructionStartMonth),
      endMonth: period.totalMonths,
    }),
  ];

  const financing = maybeFinancing({
    totalCost: costs.totalCr,
    debtableBase: hardCostCr,
    debtLTV,
    debtLTC: debtLTC > 0 ? debtLTC : undefined,
    debtRatePct,
    constructionMonths: constructionTenorMonths,
    debtTenorMonths,
  });

  // Merchant-sale DSCR — sellout proceeds ÷ total debt service (principal + capitalised interest).
  // Mirrors master's PR #7 definition so kernel exports stay comparable.
  const debtDrawnNum = financing?.debtDrawn.toNumber() ?? 0;
  const debtInterestNum = financing?.debtInterest.toNumber() ?? 0;
  const totalDebtService = debtDrawnNum + debtInterestNum;
  const dscr = totalDebtService > 0 ? totalRevenueCr.toNumber() / totalDebtService : null;

  const kpiExtras: Record<string, number | null> = {
    costPerSqft: saleableAreaSqft > 0 ? (costs.totalCr.toNumber() * CRORE) / saleableAreaSqft : null,
    revenuePerSqft: saleableAreaSqft > 0 ? (totalRevenueCr.toNumber() * CRORE) / saleableAreaSqft : null,
    profitPerSqft: saleableAreaSqft > 0 ? (totalRevenueCr.sub(costs.totalCr).toNumber() * CRORE) / saleableAreaSqft : null,
    landCostPerSqft: plotAreaSqft > 0 ? (landCostCr * CRORE) / plotAreaSqft : null,
    dscr,
  };

  const inputProv = [
    prov('input.saleableSqft', 'input.plotAreaSqft × fsi × (1+loading)'),
    prov('revenue.totalRevenueCr', 'input.saleableSqft × effectiveRate / 1e7'),
    prov('costs.construction', 'input.saleableSqft × constructionCostPerSqft / 1e7'),
    prov('costs.gst', 'derived.constructionCr × gstRate'),
    prov('costs.stampDuty', 'input.landCostCr × STAMP_DUTY_RATE'),
    prov('costs.finance', 'landFinance (quarterly compound) + construction (S-curve draws + capitalised interest)'),
  ];

  return finalizeResult({
    assetClass,
    period,
    areas,
    costs,
    revenue: {
      totalRevenueCr,
      stabilizedNOICr: null,
      exitValueCr: null,
      extras: Object.freeze({
        effectiveRatePerSqft: D(effectiveRate),
      }),
    },
    items,
    discountRatePct,
    financing,
    developerMarginPct,
    kpiExtras,
    extraProvenance: inputProv,
  });
}

/** Re-export convenience — `decSum` is only pulled in here for typing. */
export const _internal = { decSum };
