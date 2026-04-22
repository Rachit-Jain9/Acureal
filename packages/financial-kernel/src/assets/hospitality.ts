/**
 * Hospitality — keys-based model. ADR + occupancy → EBITDA → exit.
 *
 * Cost model mirrors the legacy JS engine so parity against
 * `calculateHospitality` holds to within epsilon:
 *   - Per-sqft hard cost (keys × sqftPerKey × ₹/sqft), derivable from
 *     the legacy `constructionCostPerKey` input for backward compat.
 *   - Karnataka stamp + registration at 6.6% (legacy KARNATAKA_STAMP_REG_RATE),
 *     plus 3% betterment charge (Bengaluru default).
 *   - Soft design (architect, PMC, consultants) as % of hard cost.
 *   - Approvals as % of hard cost (or per-sqft / explicit Cr if provided).
 *   - FF&E, OS&E and pre-opening as per-key capex.
 *   - Working capital default ≈ keys × ₹50k.
 *   - Contingency applied against (hard + softDesign + approvals + FF&E + OS&E).
 *   - IDC via legacy's mid-draw-average formula: principal × 0.5 × rate × years
 *     plus upfront loan fees.
 *
 * Revenue contract matches legacy's flattener (`_legacy.total_revenue_cr`):
 * `totalRevenueCr` is the effective exit value (stabilised NOI / exit cap
 * with ADR growth applied over the hold). Stabilised Y1 figures remain
 * exposed through `revenue.extras` and `kpis.extras` for UI consumption.
 */

import { Decimal } from '../decimal';
import { bulletInflow, bulletOutflow } from '../cashflow';
import { buildAmortizingSchedule } from '../debtSchedule';
import { buildPeriodIndex } from '../periods';
import { parseCurveOverride } from '../curves';
import type { AreaBreakdown, DealInputs, KernelResult, MonthlyLineItem } from '../types';
import { prov } from '../provenance';
import { INDIA_CONFIG } from '../config';
import {
  CRORE,
  D,
  DEFAULT_GST_BY_ASSET,
  approvalsSchedule,
  assembleCosts,
  finalizeResult,
  hardCostItem,
  landAndStamp,
  maybeFinancing,
  num,
} from './common';

const HOSP_DEFAULT_SQFT_PER_KEY = 550;
const HOSP_DEFAULT_HARD_COST_PER_SQFT = 11_000;
const HOSP_DEFAULT_FFE_PER_KEY = 2_500_000;
const HOSP_DEFAULT_OSE_PER_KEY = 400_000;
const HOSP_DEFAULT_PREOPENING_PER_KEY = 350_000;
const HOSP_DEFAULT_WC_PER_KEY = 50_000;

export function computeHospitality(inputs: DealInputs): KernelResult {
  const raw = inputs.raw;

  // ── Physical / operational inputs ─────────────────────────────────────────
  const keys = Math.max(1, Math.round(num(raw.keys, 100)));
  const sqftPerKey = num(raw.sqftPerKey, HOSP_DEFAULT_SQFT_PER_KEY);
  const totalBuaSqft = keys * sqftPerKey;

  // Hard cost: per-BUA-sqft model (matches legacy). `constructionCostPerKey` in
  // legacy is an *output*, not an input — we ignore it for hard-cost sizing
  // and route callers to `hardCostPerSqft` instead.
  const hardCostPerSqft = num(raw.hardCostPerSqft) > 0
    ? num(raw.hardCostPerSqft)
    : HOSP_DEFAULT_HARD_COST_PER_SQFT;

  const landCostCr = num(raw.landCostCr);
  const stampRegPctRaw = num(raw.stampRegPct);
  const stampRegPct = stampRegPctRaw > 0
    ? stampRegPctRaw / 100
    : INDIA_CONFIG.KARNATAKA_STAMP_REG_RATE;
  const bettermentPct = num(raw.bettermentPct, 3);

  // Soft design (% of hard cost)
  const architectPctHard = num(raw.architectPctOfHard, 4);
  const pmcPctHard = num(raw.pmcPctOfHard, 2);
  const consultantsPctHard = num(raw.consultantsPctOfHard, 3.5);
  const approvalsPctHard = num(raw.approvalsPctOfHard, 2);

  // Per-key capex
  const ffePerKey = num(raw.ffePerKey, HOSP_DEFAULT_FFE_PER_KEY);
  const osePerKey = num(raw.osePerKey, HOSP_DEFAULT_OSE_PER_KEY);
  const preOpeningPerKey = num(
    raw.preOpeningPerKey ?? raw.preOpeningCostPerKey,
    HOSP_DEFAULT_PREOPENING_PER_KEY,
  );
  const workingCapitalCrIn = num(raw.workingCapitalCr);
  const workingCapitalCr = workingCapitalCrIn > 0
    ? workingCapitalCrIn
    : (keys * HOSP_DEFAULT_WC_PER_KEY) / CRORE;

  const contingencyPct = num(raw.contingencyPct, 5);

  // Construction-loan terms for IDC
  const constLoanLTC = Math.min(0.80, Math.max(0, num(raw.constLoanLTC, 0.55)));
  const constLoanRatePct = num(raw.constLoanRatePct, 10.5);
  const constLoanFeesPct = num(raw.constLoanFeesPct, 1.0);

  // ── Revenue / operating inputs ────────────────────────────────────────────
  // Defaults align with a typical USALI mid-scale Indian hotel (matches legacy
  // USALI-computed output for the canonical parity deal):
  //   F&B/other revenue as % of rooms: 30% / 9%
  //   GOP margin: ~30%, EBITDA margin: ~22%, NOI margin: ~18% (EBITDA − 4% FF&E)
  const adr = num(raw.adr, 6000);
  const adrGrowthPct = num(raw.adrGrowthPct, 5);
  const stabilizedOccPct = num(raw.stabilizedOccPct, 65);
  const holdPeriodYears = num(raw.holdPeriodYears, 8);
  const fbRevPct = num(raw.fbRevPct, 30);
  const otherRevPct = num(raw.otherRevPct, 9);
  const gopMarginPct = num(raw.gopMarginPct, 30);
  const ebitdaMarginPct = num(raw.ebitdaMarginPct, 22);
  const exitCapRatePct = num(raw.exitCapRate, 9);
  const discountRatePct = num(raw.discountRatePct, 15);
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

  // ── Costs (matching legacy bucket semantics) ──────────────────────────────
  const hardCostCr = D((totalBuaSqft * hardCostPerSqft) / CRORE);
  const gstRate = num(raw.gstPct, DEFAULT_GST_BY_ASSET.hospitality * 100) / 100;
  const gstCr = hardCostCr.mulNumber(gstRate);

  const stampDutyCr = D(landCostCr * stampRegPct);
  const bettermentCr = D((landCostCr * bettermentPct) / 100);

  const architectCr = hardCostCr.mulNumber(architectPctHard / 100);
  const pmcCr = hardCostCr.mulNumber(pmcPctHard / 100);
  const consultantsCr = hardCostCr.mulNumber(consultantsPctHard / 100);
  const softDesignCr = architectCr.add(pmcCr).add(consultantsCr);

  // Approval cost resolution (legacy priority: per-sqft → explicit Cr → % of hard)
  const approvalCostCr =
    num(raw.approvalCostPerSqft, 0) > 0
      ? D((totalBuaSqft * num(raw.approvalCostPerSqft)) / CRORE)
      : num(raw.approvalCostCr, 0) > 0
        ? D(num(raw.approvalCostCr))
        : hardCostCr.mulNumber(approvalsPctHard / 100);

  const ffeCr = D((keys * ffePerKey) / CRORE);
  const oseCr = D((keys * osePerKey) / CRORE);
  const preOpeningCr = D((keys * preOpeningPerKey) / CRORE);
  const workingCapitalDec = D(workingCapitalCr);

  // Contingency base: hard + softDesign + approvals + FF&E + OS&E (matches legacy)
  const contingencyBase = hardCostCr
    .add(softDesignCr)
    .add(approvalCostCr)
    .add(ffeCr)
    .add(oseCr);
  const contingencyCr = contingencyBase.mulNumber(contingencyPct / 100);

  // Total uses ex-IDC — used for IDC principal estimate, just like legacy.
  const totalUsesExIDCCr = D(landCostCr)
    .add(stampDutyCr)
    .add(bettermentCr)
    .add(hardCostCr)
    .add(gstCr)
    .add(softDesignCr)
    .add(approvalCostCr)
    .add(ffeCr)
    .add(oseCr)
    .add(preOpeningCr)
    .add(workingCapitalDec)
    .add(contingencyCr);

  // IDC: legacy formula — principal × 0.5 × rate × years + principal × fees
  const idcYears = constructionMonths / 12;
  const constLoanPrincipalEstimate = totalUsesExIDCCr.toNumber() * constLoanLTC;
  const idcCr = D(
    constLoanPrincipalEstimate * 0.5 * (constLoanRatePct / 100) * idcYears +
      constLoanPrincipalEstimate * (constLoanFeesPct / 100),
  );

  // ── Revenue model (simple margin-based, stabilised Y1) ────────────────────
  const revPARStabilised = adr * (stabilizedOccPct / 100);
  const roomsRevY1Cr = D((keys * revPARStabilised * 365) / CRORE);
  const totalRevY1Cr = roomsRevY1Cr.mulNumber(1 + fbRevPct / 100 + otherRevPct / 100);
  const gopCr = totalRevY1Cr.mulNumber(gopMarginPct / 100);
  const ebitdaY1Cr = totalRevY1Cr.mulNumber(ebitdaMarginPct / 100);

  // NOI = EBITDA − FF&E reserve (legacy convention, 4% of revenue default).
  const ffeReservePct = num(raw.ffeReservePct, 4);
  const ffeReserveY1Cr = totalRevY1Cr.mulNumber(ffeReservePct / 100);
  const noiY1Cr = ebitdaY1Cr.sub(ffeReserveY1Cr);

  // Exit value uses NOI (not EBITDA) / exit cap, matching legacy semantics.
  const exitNOICr = noiY1Cr.mulNumber(Math.pow(1 + adrGrowthPct / 100, holdPeriodYears - 1));
  const exitValueCr = exitCapRatePct > 0 ? D(exitNOICr.toNumber() / (exitCapRatePct / 100)) : D(0);
  const entryValueCr = exitCapRatePct > 0 ? D(noiY1Cr.toNumber() / (exitCapRatePct / 100)) : D(0);

  const totalDevCostCr = totalUsesExIDCCr.add(idcCr);
  const yieldOnCost = totalDevCostCr.isPositive()
    ? (noiY1Cr.toNumber() / totalDevCostCr.toNumber()) * 100
    : 0;

  // Optional per-deal curve overrides — see packages/financial-kernel/src/curves.ts
  const constructionCurve = parseCurveOverride(raw.constructionCurve);

  // ── Cash-flow line items ──────────────────────────────────────────────────
  const items: MonthlyLineItem[] = [
    landAndStamp({ period, land: D(landCostCr), stampDuty: stampDutyCr.add(bettermentCr) }),
    ...approvalsSchedule({ period, amount: approvalCostCr }),
    hardCostItem({ period, amount: hardCostCr.add(gstCr).add(softDesignCr).add(contingencyCr), curveOverride: constructionCurve }),
    // FF&E + OS&E in the final 2 construction months.
    bulletOutflow({
      period,
      month: Math.max(0, period.constructionEndMonth - 1),
      amount: ffeCr.add(oseCr).mulNumber(0.5),
      category: 'hard_cost',
      subcategory: 'ffe_ose_1',
    }),
    bulletOutflow({
      period,
      month: Math.max(0, period.constructionEndMonth),
      amount: ffeCr.add(oseCr).mulNumber(0.5),
      category: 'hard_cost',
      subcategory: 'ffe_ose_2',
    }),
    // Pre-opening + working capital at end of construction.
    bulletOutflow({
      period,
      month: Math.max(0, period.constructionEndMonth),
      amount: preOpeningCr.add(workingCapitalDec),
      category: 'soft_cost',
      subcategory: 'pre_opening_wc',
    }),
    // IDC spread uniformly across construction window.
    bulletOutflow({
      period,
      month: Math.max(0, period.constructionEndMonth),
      amount: idcCr,
      category: 'finance_cost',
      subcategory: 'idc',
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
    const monthFFEReserve = monthTotalRev.mulNumber(ffeReservePct / 100);
    const monthNOI = monthEBITDA.sub(monthFFEReserve);
    items.push(
      bulletInflow({
        period,
        month,
        amount: monthNOI,
        category: 'revenue',
        subcategory: `noi_month_${month}`,
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
      provenance: [prov('cashflow.exit', 'exit NOI / exitCapRate')],
    }),
  );

  const debtLTVin = Math.max(0, Math.min(1, num(raw.debtCoverage, 0)));
  const debtLTCin = num(raw.debtLTC, 0);
  const debtTenorYears = num(raw.debtTenorYears, 0);
  const debtTenorMonths = debtTenorYears > 0 ? debtTenorYears * 12 : undefined;
  const amortizationYearsIn = num(raw.amortizationYears, 0);
  const debtRatePctIn = num(raw.interestRatePct, constLoanRatePct);
  const financing = maybeFinancing({
    totalCost: totalDevCostCr,
    debtableBase: hardCostCr,
    debtLTV: debtLTVin,
    debtLTC: debtLTCin > 0 ? debtLTCin : constLoanLTC,
    debtRatePct: debtRatePctIn,
    constructionMonths,
    debtTenorMonths,
    amortizationYears: amortizationYearsIn > 0 ? amortizationYearsIn : undefined,
  });

  const areas: AreaBreakdown = {
    grossBuiltUpSqft: totalBuaSqft,
    saleableSqft: null,
    carpetSqft: null,
    superBuiltUpSqft: null,
    leasableSqft: null,
    extras: Object.freeze({ keys, sqftPerKey }),
  };

  const costs = assembleCosts({
    land: D(landCostCr),
    construction: hardCostCr,
    gst: gstCr,
    contingency: contingencyCr,
    stampDuty: stampDutyCr,
    approval: approvalCostCr,
    architecture: architectCr,
    pmc: pmcCr,
    marketing: null,
    finance: idcCr,
    extras: {
      bettermentCr,
      consultantsCr,
      ffeCr,
      oseCr,
      preOpeningCr,
      workingCapitalCr: workingCapitalDec,
    },
  });

  // Amortizing-schedule DSCR — Y1 EBITDA ÷ annual debt service (P&I).
  const drawnNumHosp = financing?.debtDrawn.toNumber() ?? 0;
  let dscr: number | null = null;
  if (drawnNumHosp > 0 && debtRatePctIn > 0) {
    const amortYearsForDscr = amortizationYearsIn > 0 ? amortizationYearsIn : 20;
    const totalQH = Math.max(4, Math.ceil(period.totalMonths / 3));
    const opStartQ = Math.max(1, Math.ceil((period.constructionEndMonth + 1) / 3));
    const sched = buildAmortizingSchedule({
      principalCr: drawnNumHosp,
      annualRatePct: debtRatePctIn,
      amortizationYears: amortYearsForDscr,
      drawQ: opStartQ,
      operatingStartQ: opStartQ,
      exitQ: totalQH,
      totalQuarters: totalQH,
    });
    const y1End = Math.min(opStartQ + 3, totalQH - 1);
    let y1DebtService = 0;
    for (let q = opStartQ; q <= y1End; q++) y1DebtService += sched.debtService[q];
    dscr = y1DebtService > 0 ? ebitdaY1Cr.toNumber() / y1DebtService : null;
  }

  const kpiExtras: Record<string, number | null> = {
    noi: noiY1Cr.toNumber(),
    ebitda: ebitdaY1Cr.toNumber(),
    yieldOnCost,
    exitValue: exitValueCr.toNumber(),
    entryValue: entryValueCr.toNumber(),
    exitCapRate: exitCapRatePct,
    dscr,
    revPAR: revPARStabilised,
    revPar: revPARStabilised,
    gopMargin: gopMarginPct,
    ebitdaMarginPct,
    ffeReservePct,
    devCostPerKey: (totalDevCostCr.toNumber() * CRORE) / keys,
    revenuePerKey: (totalRevY1Cr.toNumber() * CRORE) / keys,
    ebitdaPerKey: (ebitdaY1Cr.toNumber() * CRORE) / keys,
    gopPAR: (gopCr.toNumber() * CRORE) / (keys * 365),
    tRevPAR: (totalRevY1Cr.toNumber() * CRORE) / (keys * 365),
    idcCr: idcCr.toNumber(),
    ffeCr: ffeCr.toNumber(),
    oseCr: oseCr.toNumber(),
  };

  return finalizeResult({
    assetClass: 'hospitality',
    period,
    areas,
    costs,
    revenue: {
      // Match legacy flattener semantics: totalRevenueCr == effective exit value
      // for hold-for-sale income assets. Stabilised Y1 revenue is preserved in
      // `revenue.extras.stabilizedRevenueCr` / `kpis.extras.revenuePerKey`.
      totalRevenueCr: exitValueCr,
      stabilizedNOICr: noiY1Cr,
      exitValueCr,
      extras: Object.freeze({
        revPAR: D(revPARStabilised),
        roomsRevenue: roomsRevY1Cr,
        gop: gopCr,
        ebitda: ebitdaY1Cr,
        stabilizedRevenueCr: totalRevY1Cr,
      }),
    },
    items,
    discountRatePct,
    financing,
    equityReturnsMode: 'income',
    // Hospitality's "grossMargin" semantic matches USALI EBITDA margin
    // rather than `(revenue - totalCost) / revenue` — otherwise the number
    // is meaningless because "revenue" here is the exit sale price, not
    // operating revenue.
    grossMarginPctOverride: ebitdaMarginPct,
    kpiExtras,
    extraProvenance: [
      prov('costs.hardCost', `${totalBuaSqft.toLocaleString('en-IN')} sqft × ₹${hardCostPerSqft}/sqft`),
      prov('costs.idc', 'mid-draw avg: principal × 0.5 × rate × years + principal × fees%'),
      prov('costs.stampDuty', `${(stampRegPct * 100).toFixed(2)}% Karnataka stamp + registration`),
      prov('revenue.totalRevenue', 'effective exit value (NOI / exit cap)'),
      prov('revenue.NOI', 'EBITDA − FF&E reserve'),
      prov('kpis.grossMarginPct', 'hospitality convention: USALI EBITDA margin'),
    ],
  });
}
