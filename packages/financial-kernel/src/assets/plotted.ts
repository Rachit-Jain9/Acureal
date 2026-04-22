/**
 * Plotted development — land subdivision, plot-sale revenue,
 * light development cost (road, utility, boundary).
 */

import { Decimal } from '../decimal';
import { buildPeriodIndex } from '../periods';
import { buildDrawSchedule } from '../debtSchedule';
import { parseCurveOverride, resolveCurveWeights } from '../curves';
import type { AreaBreakdown, DealInputs, KernelResult, MonthlyLineItem } from '../types';
import { prov } from '../provenance';
import { frontLoadedSales } from '../cashflow';
import {
  CRORE,
  D,
  DEFAULT_GST_BY_ASSET,
  STAMP_DUTY_RATE,
  approvalsSchedule,
  assembleCosts,
  finalizeResult,
  financeDrag,
  hardCostItem,
  landAndStamp,
  marketingSchedule,
  maybeFinancing,
  num,
} from './common';

export function computePlotted(inputs: DealInputs): KernelResult {
  const raw = inputs.raw;

  const totalLandSqft = num(raw.totalLandSqft);
  const saleableLandPct = num(raw.saleableLandPct, 55);
  const avgPlotSizeSqft = num(raw.avgPlotSizeSqft, 1200);
  const sellingRatePerSqft = num(raw.sellingRatePerSqft) > 0
    ? num(raw.sellingRatePerSqft)
    : num(raw.sellingRatePerSqyd) > 0
      ? num(raw.sellingRatePerSqyd) / 9
      : 0;
  const landCostCr = num(raw.landCostCr);
  const devCostPerSqft = num(raw.devCostPerSqft, 250);
  const marketingCostPct = num(raw.marketingCostPct, 4);
  const financeCostPct = num(raw.financeCostPct, 12);
  const discountRatePct = num(raw.discountRatePct, 14);
  const contingencyPct = num(raw.contingencyPct, 3);

  if (totalLandSqft <= 0 || sellingRatePerSqft <= 0 || avgPlotSizeSqft <= 0) {
    throw new Error('Plotted kernel: required input missing (totalLandSqft, sellingRatePerSqft, avgPlotSizeSqft)');
  }

  const durationMonths = num(raw.projectDurationMonths, 24);
  const period = buildPeriodIndex({
    effectiveDate: typeof raw.effectiveDate === 'string' ? raw.effectiveDate : undefined,
    projectDurationMonths: durationMonths,
    constructionStartMonth: 0,
    constructionEndMonth: Math.round(durationMonths * 0.7),
  });

  const saleableLandSqft = totalLandSqft * (saleableLandPct / 100);
  const totalPlots = Math.floor(saleableLandSqft / avgPlotSizeSqft);
  const totalRevenueCr = D((totalPlots * avgPlotSizeSqft * sellingRatePerSqft) / CRORE);

  const devCostCr = D((totalLandSqft * devCostPerSqft) / CRORE);
  const gstRate = num(raw.gstPct, DEFAULT_GST_BY_ASSET.plotted_development * 100) / 100;
  const gstCr = devCostCr.mulNumber(gstRate);
  const contingencyCr = devCostCr.mulNumber(contingencyPct / 100);
  const stampDutyCr = D(landCostCr * STAMP_DUTY_RATE);
  const approvalCostCr = num(raw.approvalCostPerSqft, 0) > 0
    ? D((totalLandSqft * num(raw.approvalCostPerSqft)) / CRORE)
    : D(num(raw.approvalCostCr));
  const marketingCr = totalRevenueCr.mulNumber(marketingCostPct / 100);

  const hardCostCr = devCostCr.add(gstCr).add(contingencyCr);

  // Finance cost: match legacy plotted — quarterly compound land carry,
  // S-curve dev draws with capitalised interest over ~70% of duration.
  const totalQPlotted = Math.max(1, Math.ceil(durationMonths / 3));
  const plottedDevEndQ = Math.max(2, Math.ceil((durationMonths * 0.70) / 3));
  const debtTenorYearsRaw = num(raw.debtTenorYears, 0);
  const debtTenorMonthsPlot = debtTenorYearsRaw > 0
    ? debtTenorYearsRaw * 12
    : Math.min(durationMonths, durationMonths * 0.70 + 3);
  const carryQPlot = Math.min(totalQPlotted, Math.max(1, Math.ceil(debtTenorMonthsPlot / 3)));
  const qFinRatePlot = Math.pow(1 + financeCostPct / 100, 0.25) - 1;
  const landFinanceCr = landCostCr > 0 && carryQPlot > 0
    ? D(landCostCr * (Math.pow(1 + qFinRatePlot, carryQPlot) - 1))
    : D(0);
  const plottedSchedule = buildDrawSchedule({
    principalCr: devCostCr.toNumber(),
    annualRatePct: financeCostPct,
    totalQuarters: carryQPlot,
    drawStartQ: 1,
    drawEndQ: Math.min(plottedDevEndQ, carryQPlot),
    capitalizeInterest: true,
  });
  const constFinanceCr = D(plottedSchedule.totalInterestCr);
  const financeCr = landFinanceCr.add(constFinanceCr);

  const areas: AreaBreakdown = {
    grossBuiltUpSqft: totalLandSqft,
    saleableSqft: saleableLandSqft,
    carpetSqft: null,
    superBuiltUpSqft: null,
    leasableSqft: null,
    extras: Object.freeze({
      totalPlots,
      avgPlotSizeSqft,
    }),
  };

  const costs = assembleCosts({
    land: D(landCostCr),
    construction: devCostCr,
    gst: gstCr,
    contingency: contingencyCr,
    stampDuty: stampDutyCr,
    approval: approvalCostCr,
    architecture: null,
    pmc: null,
    marketing: marketingCr,
    finance: financeCr,
  });

  // Optional per-deal curve overrides — see packages/financial-kernel/src/curves.ts
  const constructionCurve = parseCurveOverride(raw.constructionCurve);
  const salesCurve = parseCurveOverride(raw.salesCurve);
  const salesWindowMonths = Math.max(1, period.totalMonths - 1 + 1);
  const salesResolved = resolveCurveWeights(salesWindowMonths, 'frontLoaded', salesCurve ?? null);
  const salesProvLabel =
    salesResolved.source === 'default'
      ? 'front-loaded launch sales'
      : salesResolved.source === 'explicit'
        ? 'deal-override explicit launch sales'
        : `deal-override ${salesResolved.kind} launch sales`;

  const items: MonthlyLineItem[] = [
    landAndStamp({ period, land: D(landCostCr), stampDuty: stampDutyCr }),
    ...approvalsSchedule({ period, amount: approvalCostCr }),
    hardCostItem({ period, amount: hardCostCr, curveOverride: constructionCurve }),
    marketingSchedule({ period, amount: marketingCr }),
    financeDrag({ period, amount: financeCr }),
    frontLoadedSales({
      period,
      amount: totalRevenueCr,
      startMonth: 1,
      endMonth: period.totalMonths,
      provenance: [prov('cashflow.revenue.plotted', salesProvLabel)],
      curveOverride: salesCurve,
    }),
  ];

  const debtLTVin = Math.max(0, Math.min(1, num(raw.debtLTV, 0)));
  const debtLTCin = num(raw.debtLTC, 0);
  const debtTenorYears = num(raw.debtTenorYears, 0);
  const debtTenorMonths = debtTenorYears > 0 ? debtTenorYears * 12 : undefined;

  const financing = maybeFinancing({
    totalCost: costs.totalCr,
    debtableBase: hardCostCr,
    debtLTV: debtLTVin,
    debtLTC: debtLTCin > 0 ? debtLTCin : undefined,
    debtRatePct: num(raw.debtRatePct, 10.5),
    constructionMonths: durationMonths,
    debtTenorMonths,
  });

  const debtDrawnNum = financing?.debtDrawn.toNumber() ?? 0;
  const debtInterestNum = financing?.debtInterest.toNumber() ?? 0;
  const totalDebtService = debtDrawnNum + debtInterestNum;
  const dscr = totalDebtService > 0 ? totalRevenueCr.toNumber() / totalDebtService : null;

  const kpiExtras: Record<string, number | null> = {
    revenuePerPlot: totalPlots > 0 ? (totalRevenueCr.toNumber() * CRORE) / totalPlots : null,
    costPerPlot: totalPlots > 0 ? (costs.totalCr.toNumber() * CRORE) / totalPlots : null,
    revenuePerSqft: saleableLandSqft > 0 ? (totalRevenueCr.toNumber() * CRORE) / saleableLandSqft : null,
    landCostPerSqft: totalLandSqft > 0 ? (landCostCr * CRORE) / totalLandSqft : null,
    dscr,
  };

  return finalizeResult({
    assetClass: 'plotted_development',
    period,
    areas,
    costs,
    revenue: {
      totalRevenueCr,
      stabilizedNOICr: null,
      exitValueCr: null,
      extras: Object.freeze({}),
    },
    items,
    discountRatePct,
    financing,
    developerMarginPct: num(raw.developerMarginPct, 20),
    kpiExtras,
  });
}
