/**
 * Income-producing assets — Commercial Office, Retail, Industrial/Warehousing.
 * Shared implementation; per-class tuning is applied via the options struct.
 *
 * Model: construction phase (S-curve) → operating phase (monthly NOI with
 * ramp-up, rent escalation, vacancy), exit at cap rate.
 */

import { Decimal } from '../decimal';
import { bulletInflow, bulletOutflow, uniformFlow } from '../cashflow';
import { buildAmortizingSchedule } from '../debtSchedule';
import { buildPeriodIndex } from '../periods';
import { parseCurveOverride } from '../curves';
import type {
  AreaBreakdown,
  AssetClass,
  DealInputs,
  KernelResult,
  MonthlyLineItem,
} from '../types';
import { prov } from '../provenance';
import {
  CRORE,
  D,
  DEFAULT_GST_BY_ASSET,
  STAMP_DUTY_RATE,
  approvalsSchedule,
  assembleCosts,
  finalizeResult,
  hardCostItem,
  landAndStamp,
  maybeFinancing,
  num,
} from './common';

export interface IncomeOptions {
  readonly assetClass: AssetClass;
  /**
   * Retail-only tuning — fraction of space let to anchors and the rent
   * discount that anchors receive. Ignored for non-retail calls.
   */
  readonly anchorPct?: number;
  readonly anchorRentDiscountPct?: number;
}

export function computeIncomeAsset(
  inputs: DealInputs,
  options: IncomeOptions,
): KernelResult {
  const raw = inputs.raw;
  const assetClass = options.assetClass;

  const leasableAreaSqft = num(raw.leasableAreaSqft);
  const constructionCostPerSqft = num(raw.constructionCostPerSqft);
  const landCostCr = num(raw.landCostCr);
  const baseRentPerSqftMonth = num(raw.baseRentPerSqftMonth);
  const rentEscalationPct = num(raw.rentEscalationPct, 5);
  const vacancyPct = num(raw.vacancyPct, 10);
  const opexPct = num(raw.opexPct, 20);
  const tiPerSqft = num(raw.tiPerSqft, 0);
  const lcMonths = num(raw.lcMonths, 0);
  const exitCapRatePct = num(raw.exitCapRate, 7);
  const entryCapRatePct = num(raw.entryCapRate, exitCapRatePct);
  const holdPeriodYears = num(raw.holdPeriodYears, 5);
  const discountRatePct = num(raw.discountRatePct, 14);
  const contingencyPct = num(raw.contingencyPct, 4);
  const constructionMonths = num(raw.projectDurationMonths, 36);

  if (leasableAreaSqft <= 0 || constructionCostPerSqft <= 0 || baseRentPerSqftMonth <= 0) {
    throw new Error('Income-asset kernel: required input missing (leasableAreaSqft, constructionCostPerSqft, baseRentPerSqftMonth)');
  }
  if (exitCapRatePct <= 0 || exitCapRatePct > 30) {
    throw new Error('Income-asset kernel: exitCapRate must be 0–30%');
  }

  const holdMonths = Math.max(0, Math.round(holdPeriodYears * 12));
  const period = buildPeriodIndex({
    effectiveDate: typeof raw.effectiveDate === 'string' ? raw.effectiveDate : undefined,
    projectDurationMonths: constructionMonths,
    constructionStartMonth: 0,
    constructionEndMonth: constructionMonths,
    holdMonths,
  });

  const anchorPct = assetClass === 'retail' ? (options.anchorPct ?? num(raw.anchorPct, 40)) : 0;
  const anchorDiscount =
    assetClass === 'retail' ? (options.anchorRentDiscountPct ?? num(raw.anchorRentDiscount, 20)) : 0;
  const blendedFactor =
    assetClass === 'retail'
      ? (anchorPct / 100) * (1 - anchorDiscount / 100) + (1 - anchorPct / 100)
      : 1;
  const effectiveBaseRent = baseRentPerSqftMonth * blendedFactor;

  const constructionCostCr = D((leasableAreaSqft * constructionCostPerSqft) / CRORE);
  const gstRate = num(raw.gstPct, DEFAULT_GST_BY_ASSET[assetClass] * 100) / 100;
  const gstCr = constructionCostCr.mulNumber(gstRate);
  const contingencyCr = constructionCostCr.mulNumber(contingencyPct / 100);
  const stampDutyCr = D(landCostCr).mulNumber(STAMP_DUTY_RATE);
  const tiCostCr = D((leasableAreaSqft * tiPerSqft) / CRORE);
  const lcCostCr = D((leasableAreaSqft * effectiveBaseRent * lcMonths) / CRORE);
  const approvalCostCr = num(raw.approvalCostPerSqft, 0) > 0
    ? D((leasableAreaSqft * num(raw.approvalCostPerSqft)) / CRORE)
    : D(num(raw.approvalCostCr));

  const hardCostCr = constructionCostCr.add(gstCr).add(contingencyCr);
  const totalDevCostCr = D(landCostCr)
    .add(stampDutyCr)
    .add(hardCostCr)
    .add(approvalCostCr)
    .add(tiCostCr)
    .add(lcCostCr);

  // Stabilised Year-1 figures.
  const grossRevY1Cr = D((leasableAreaSqft * effectiveBaseRent * 12) / CRORE);
  const effectiveGrossRevCr = grossRevY1Cr.mulNumber(1 - vacancyPct / 100);
  const opexCr = effectiveGrossRevCr.mulNumber(opexPct / 100);
  const stabilizedNOICr = effectiveGrossRevCr.sub(opexCr);
  const yieldOnCost = totalDevCostCr.isPositive()
    ? stabilizedNOICr.toNumber() / totalDevCostCr.toNumber() * 100
    : 0;
  const entryValueCr = D(stabilizedNOICr.toNumber() / (entryCapRatePct / 100));
  const noiAtExit = stabilizedNOICr.mulNumber(Math.pow(1 + rentEscalationPct / 100, holdPeriodYears));
  const exitValueCr = D(noiAtExit.toNumber() / (exitCapRatePct / 100));

  // Optional per-deal curve override — see packages/financial-kernel/src/curves.ts
  const constructionCurve = parseCurveOverride(raw.constructionCurve);

  const items: MonthlyLineItem[] = [
    landAndStamp({ period, land: D(landCostCr), stampDuty: stampDutyCr }),
    ...approvalsSchedule({ period, amount: approvalCostCr }),
    hardCostItem({ period, amount: hardCostCr, curveOverride: constructionCurve }),
    bulletOutflow({
      period,
      month: period.constructionEndMonth,
      amount: tiCostCr.add(lcCostCr),
      category: 'soft_cost',
      subcategory: 'TI+LC',
      provenance: [prov('cashflow.TI+LC', 'tenant improvements + leasing commissions at handover')],
    }),
  ];

  // Operating-phase NOI, month-by-month with 3-year lease-up ramp.
  const operatingStart = period.constructionEndMonth + 1;
  const operatingEnd = period.totalMonths;
  for (let month = operatingStart; month <= operatingEnd; month++) {
    const monthsIntoOps = month - operatingStart;
    const yearIdx = Math.ceil((monthsIntoOps + 1) / 12);
    const occupancy = yearIdx <= 1 ? 0.6 : yearIdx === 2 ? 0.8 : 1 - vacancyPct / 100;
    const rentEsc = Math.pow(1 + rentEscalationPct / 100, yearIdx - 1);
    const monthlyRent = D((leasableAreaSqft * effectiveBaseRent * rentEsc * occupancy) / CRORE);
    const monthlyNOI = monthlyRent.mulNumber(1 - opexPct / 100);
    items.push(
      bulletInflow({
        period,
        month,
        amount: monthlyNOI,
        category: 'revenue',
        subcategory: 'operations',
      }),
    );
  }
  // Exit proceeds.
  items.push(
    bulletInflow({
      period,
      month: period.totalMonths,
      amount: exitValueCr,
      category: 'revenue',
      subcategory: 'exit',
      provenance: [prov('cashflow.exit', 'NOI_at_exit / exitCapRate')],
    }),
  );

  const debtLTVin = Math.max(0, Math.min(1, num(raw.debtCoverage, 0)));
  const debtLTCin = num(raw.debtLTC, 0);
  const debtTenorYears = num(raw.debtTenorYears, 0);
  const debtTenorMonths = debtTenorYears > 0 ? debtTenorYears * 12 : undefined;
  const amortizationYearsIn = num(raw.amortizationYears, 0);
  const debtRatePctIn = num(raw.interestRatePct, 10);
  const financing = maybeFinancing({
    totalCost: totalDevCostCr,
    debtableBase: hardCostCr,
    debtLTV: debtLTVin,
    debtLTC: debtLTCin > 0 ? debtLTCin : undefined,
    debtRatePct: debtRatePctIn,
    constructionMonths: constructionMonths,
    debtTenorMonths,
    amortizationYears: amortizationYearsIn > 0 ? amortizationYearsIn : undefined,
  });

  const areas: AreaBreakdown = {
    grossBuiltUpSqft: leasableAreaSqft / 0.85,
    saleableSqft: null,
    carpetSqft: null,
    superBuiltUpSqft: null,
    leasableSqft: leasableAreaSqft,
    extras: Object.freeze({}),
  };

  const costs = assembleCosts({
    land: D(landCostCr),
    construction: constructionCostCr,
    gst: gstCr,
    contingency: contingencyCr,
    stampDuty: stampDutyCr,
    approval: approvalCostCr,
    architecture: null,
    pmc: null,
    marketing: null,
    finance: null,
    extras: {
      tenantImprovementsCr: tiCostCr,
      leasingCommissionsCr: lcCostCr,
    },
  });

  // Amortizing-schedule DSCR — mirrors master's `buildAmortizingSchedule` on
  // the operating phase. DSCR = stabilised NOI ÷ annualised debt service
  // (interest + principal) for the first full operating year.
  const drawnNumInc = financing?.debtDrawn.toNumber() ?? 0;
  let dscr: number | null = null;
  if (drawnNumInc > 0 && debtRatePctIn > 0) {
    const amortYearsForDscr = amortizationYearsIn > 0 ? amortizationYearsIn : 20;
    const totalQInc = Math.max(4, Math.ceil(period.totalMonths / 3));
    const opStartQ = Math.max(1, Math.ceil((period.constructionEndMonth + 1) / 3));
    const sched = buildAmortizingSchedule({
      principalCr: drawnNumInc,
      annualRatePct: debtRatePctIn,
      amortizationYears: amortYearsForDscr,
      drawQ: opStartQ,
      operatingStartQ: opStartQ,
      exitQ: totalQInc,
      totalQuarters: totalQInc,
    });
    // First 4 quarters of operations approximate stabilised-year debt service
    // (principal + interest, pre-balloon). Exclude the exit quarter so the
    // balloon doesn't distort Y1 DSCR.
    const y1End = Math.min(opStartQ + 3, totalQInc - 1);
    let y1DebtService = 0;
    for (let q = opStartQ; q <= y1End; q++) y1DebtService += sched.debtService[q];
    dscr = y1DebtService > 0 ? stabilizedNOICr.toNumber() / y1DebtService : null;
  }

  const kpiExtras: Record<string, number | null> = {
    noi: stabilizedNOICr.toNumber(),
    yieldOnCost,
    exitValue: exitValueCr.toNumber(),
    entryValue: entryValueCr.toNumber(),
    exitCapRate: exitCapRatePct,
    entryCapRate: entryCapRatePct,
    dscr,
    devCostPerSqft: leasableAreaSqft > 0 ? (totalDevCostCr.toNumber() * CRORE) / leasableAreaSqft : null,
    rentPerSqftAnnual: effectiveBaseRent * 12,
    noiPerSqft: leasableAreaSqft > 0 ? (stabilizedNOICr.toNumber() * CRORE) / leasableAreaSqft : null,
    spreadOverCost: yieldOnCost - exitCapRatePct,
    ...(assetClass === 'retail'
      ? {
          blendedRentFactor: blendedFactor,
          anchorRentDiscount: anchorDiscount,
        }
      : {}),
  };

  return finalizeResult({
    assetClass,
    period,
    areas,
    costs,
    revenue: {
      totalRevenueCr: exitValueCr,
      stabilizedNOICr,
      exitValueCr,
      extras: Object.freeze({
        grossFirstYearRent: grossRevY1Cr,
        effectiveGrossRev: effectiveGrossRevCr,
        opex: opexCr,
      }),
    },
    items,
    discountRatePct,
    financing,
    equityReturnsMode: 'income',
    kpiExtras,
    extraProvenance: [
      prov('revenue.NOI', 'leasable × rent × (1-vacancy) × (1-opex)'),
      prov('revenue.exit', 'NOI_at_exit / exitCapRate'),
    ],
  });
}

/** Suppress the unused-import warning for uniformFlow — kept available for */
/** future asset-class extensions (e.g. CAM recovery schedules). */
export const _unused_uniformFlow = uniformFlow;
