/**
 * Hospitality — keys-based model. ADR + occupancy → EBITDA → exit.
 */

import { Decimal } from '../decimal';
import { bulletInflow, bulletOutflow } from '../cashflow';
import { buildPeriodIndex } from '../periods';
import type { AreaBreakdown, DealInputs, KernelResult, MonthlyLineItem } from '../types';
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

export function computeHospitality(inputs: DealInputs): KernelResult {
  const raw = inputs.raw;

  const keys = Math.max(1, Math.round(num(raw.keys, 100)));
  const constructionCostPerKey = num(raw.constructionCostPerKey, 8_000_000);
  const landCostCr = num(raw.landCostCr);
  const preOpeningCostPerKey = num(raw.preOpeningCostPerKey, 300_000);
  const adr = num(raw.adr, 6000);
  const adrGrowthPct = num(raw.adrGrowthPct, 5);
  const stabilizedOccPct = num(raw.stabilizedOccPct, 65);
  const holdPeriodYears = num(raw.holdPeriodYears, 8);
  const fbRevPct = num(raw.fbRevPct, 25);
  const otherRevPct = num(raw.otherRevPct, 10);
  const gopMarginPct = num(raw.gopMarginPct, 35);
  const ebitdaMarginPct = num(raw.ebitdaMarginPct, 28);
  const exitCapRatePct = num(raw.exitCapRate, 9);
  const discountRatePct = num(raw.discountRatePct, 15);
  const contingencyPct = num(raw.contingencyPct, 5);
  const constructionMonths = num(raw.projectDurationMonths, 30);

  if (adr <= 0 || stabilizedOccPct <= 0 || stabilizedOccPct > 100 || exitCapRatePct <= 0) {
    throw new Error('Hospitality kernel: invalid inputs (adr, occupancy, exitCapRate)');
  }

  const holdMonths = Math.max(0, Math.round(holdPeriodYears * 12));
  const period = buildPeriodIndex({
    effectiveDate: typeof raw.effectiveDate === 'string' ? raw.effectiveDate : undefined,
    projectDurationMonths: constructionMonths,
    constructionStartMonth: 0,
    constructionEndMonth: constructionMonths,
    holdMonths,
  });

  const constructionCostCr = D((keys * constructionCostPerKey) / CRORE);
  const gstRate = num(raw.gstPct, DEFAULT_GST_BY_ASSET.hospitality * 100) / 100;
  const gstCr = constructionCostCr.mulNumber(gstRate);
  const contingencyCr = constructionCostCr.mulNumber(contingencyPct / 100);
  const preOpeningCr = D((keys * preOpeningCostPerKey) / CRORE);
  const stampDutyCr = D(landCostCr * STAMP_DUTY_RATE);
  const approvalCostCr = num(raw.approvalCostPerSqft, 0) > 0
    ? D((keys * 600 * num(raw.approvalCostPerSqft)) / CRORE)
    : D(num(raw.approvalCostCr));

  const hardCostCr = constructionCostCr.add(gstCr).add(contingencyCr);
  const totalDevCostCr = D(landCostCr)
    .add(stampDutyCr)
    .add(hardCostCr)
    .add(preOpeningCr)
    .add(approvalCostCr);

  const revPARStabilised = adr * (stabilizedOccPct / 100);
  const roomsRevY1Cr = D((keys * revPARStabilised * 365) / CRORE);
  const totalRevY1Cr = roomsRevY1Cr.mulNumber(1 + fbRevPct / 100 + otherRevPct / 100);
  const gopCr = totalRevY1Cr.mulNumber(gopMarginPct / 100);
  const ebitdaY1Cr = totalRevY1Cr.mulNumber(ebitdaMarginPct / 100);
  const yieldOnCost = totalDevCostCr.isPositive()
    ? ebitdaY1Cr.toNumber() / totalDevCostCr.toNumber() * 100
    : 0;
  const exitEBITDA = ebitdaY1Cr.mulNumber(Math.pow(1 + adrGrowthPct / 100, holdPeriodYears));
  const exitValueCr = D(exitEBITDA.toNumber() / (exitCapRatePct / 100));
  const entryValueCr = D(ebitdaY1Cr.toNumber() / (exitCapRatePct / 100));

  const items: MonthlyLineItem[] = [
    landAndStamp({ period, land: D(landCostCr), stampDuty: stampDutyCr }),
    ...approvalsSchedule({ period, amount: approvalCostCr }),
    hardCostItem({ period, amount: hardCostCr }),
    // Pre-opening costs: final 2 months of construction.
    bulletOutflow({
      period,
      month: Math.max(0, period.constructionEndMonth - 1),
      amount: preOpeningCr.mulNumber(0.5),
      category: 'soft_cost',
      subcategory: 'pre_opening_1',
    }),
    bulletOutflow({
      period,
      month: Math.max(0, period.constructionEndMonth),
      amount: preOpeningCr.mulNumber(0.5),
      category: 'soft_cost',
      subcategory: 'pre_opening_2',
    }),
  ];

  const ramp = [0.4, 0.55, stabilizedOccPct / 100];
  const operatingStart = period.constructionEndMonth + 1;
  const operatingEnd = period.totalMonths;
  for (let month = operatingStart; month <= operatingEnd; month++) {
    const monthsIntoOps = month - operatingStart;
    const yearIdx = Math.ceil((monthsIntoOps + 1) / 12);
    const occ = yearIdx <= 1 ? ramp[0] : yearIdx === 2 ? ramp[1] : ramp[2];
    const adrThis = adr * Math.pow(1 + adrGrowthPct / 100, yearIdx - 1);
    const revPAR = adrThis * occ;
    const monthRoomsRev = D((keys * revPAR * (365 / 12)) / CRORE);
    const monthTotalRev = monthRoomsRev.mulNumber(1 + fbRevPct / 100 + otherRevPct / 100);
    const monthEBITDA = monthTotalRev.mulNumber(ebitdaMarginPct / 100);
    items.push(
      bulletInflow({
        period,
        month,
        amount: monthEBITDA,
        category: 'revenue',
        subcategory: `ebitda_month_${month}`,
      }),
    );
  }
  items.push(
    bulletInflow({
      period,
      month: period.totalMonths,
      amount: exitValueCr,
      category: 'revenue',
      subcategory: 'exit',
      provenance: [prov('cashflow.exit', 'exit EBITDA / exitCapRate')],
    }),
  );

  const financing = maybeFinancing({
    totalCost: totalDevCostCr,
    debtableBase: hardCostCr,
    debtLTV: Math.max(0, Math.min(1, num(raw.debtCoverage, 0))),
    debtRatePct: num(raw.interestRatePct, 10.5),
    constructionMonths,
  });

  const areas: AreaBreakdown = {
    grossBuiltUpSqft: keys * 600,
    saleableSqft: null,
    carpetSqft: null,
    superBuiltUpSqft: null,
    leasableSqft: null,
    extras: Object.freeze({ keys }),
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
      preOpeningCr,
    },
  });

  const kpiExtras: Record<string, number | null> = {
    noi: ebitdaY1Cr.toNumber(),
    yieldOnCost,
    exitValue: exitValueCr.toNumber(),
    entryValue: entryValueCr.toNumber(),
    revPAR: revPARStabilised,
    gopMargin: gopMarginPct,
    devCostPerKey: (totalDevCostCr.toNumber() * CRORE) / keys,
    revenuePerKey: (totalRevY1Cr.toNumber() * CRORE) / keys,
    ebitdaPerKey: (ebitdaY1Cr.toNumber() * CRORE) / keys,
    gopPAR: (gopCr.toNumber() * CRORE) / (keys * 365),
    tRevPAR: (totalRevY1Cr.toNumber() * CRORE) / (keys * 365),
  };

  return finalizeResult({
    assetClass: 'hospitality',
    period,
    areas,
    costs,
    revenue: {
      totalRevenueCr: totalRevY1Cr,
      stabilizedNOICr: ebitdaY1Cr,
      exitValueCr,
      extras: Object.freeze({
        revPAR: D(revPARStabilised),
        roomsRevenue: roomsRevY1Cr,
        gop: gopCr,
        ebitda: ebitdaY1Cr,
      }),
    },
    items,
    discountRatePct,
    financing,
    equityReturnsMode: 'income',
    kpiExtras,
  });
}
