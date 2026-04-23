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
import {
  INDIA_HOSPITALITY_PRESETS,
  buildUsaliPnl,
  buildUsaliSummary,
  type IndianHospitalityPresetKey,
  type UsaliPnlInputs,
  type UsaliPnlRow,
  type UsaliStabilisedSummary,
} from '../postprocess/usaliPnl';

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
  // If the caller selects an Indian hotel tier preset (`hotelTierPreset:
  // 'upscale_4star'` etc.), inject the preset defaults under the raw inputs —
  // any explicit raw value still wins, preserving user customisation.
  const tierPreset = typeof raw.hotelTierPreset === 'string'
    ? (raw.hotelTierPreset as IndianHospitalityPresetKey)
    : null;
  const presetDefaults =
    tierPreset && INDIA_HOSPITALITY_PRESETS[tierPreset]
      ? (INDIA_HOSPITALITY_PRESETS[tierPreset] as Record<string, number>)
      : {};
  const rawWithPreset: Record<string, unknown> = { ...presetDefaults, ...raw };

  const adr = num(rawWithPreset.adr, 6000);
  const adrGrowthPct = num(rawWithPreset.adrGrowthPct, 5);
  const stabilizedOccPct = num(rawWithPreset.stabilizedOccPct, 65);
  const initialOccPct = num(rawWithPreset.initialOccPct, 45);
  const stabilizationYear = num(rawWithPreset.stabilizationYear, 4);
  const holdPeriodYears = num(rawWithPreset.holdPeriodYears, 8);
  const fbRevPct = num(rawWithPreset.fbRevPct, 30);
  const otherRevPct = num(rawWithPreset.otherRevPct, 9);
  const gopMarginPct = num(rawWithPreset.gopMarginPct, 30);
  const ebitdaMarginPct = num(rawWithPreset.ebitdaMarginPct, 22);
  const exitCapRatePct = num(rawWithPreset.exitCapRate, 9);
  const discountRatePct = num(rawWithPreset.discountRatePct, 15);
  const constructionMonths = num(rawWithPreset.projectDurationMonths, 30);

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

  const stampDutyCr = D(landCostCr).mulNumber(stampRegPct);
  const bettermentCr = D(landCostCr).mulNumber(bettermentPct).divInt(100);

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

  // ── Revenue model ─────────────────────────────────────────────────────────
  // Default: simple blended-margin stabilised Y1 (matches legacy engine).
  // Upgrade path: when USALI drivers are present (POR-based opex or fixed
  // property-tax inputs), the 10-year USALI cascade becomes the authoritative
  // source for stabilised NOI. This lets Indian 4-star / 5-star deals priced
  // at a per-occupied-room level produce NOI consistent with the P&L the
  // frontend renders — no hand drift between the headline number and the
  // line-by-line table.
  const ffeReservePct = num(rawWithPreset.ffeReservePct, 4);

  const usaliInputs: UsaliPnlInputs = {
    keys,
    ownerRateKeys: num(rawWithPreset.ownerRateKeys),
    ownerRateADR: num(rawWithPreset.ownerRateADR),
    ownerRateGuaranteedOccPct: num(rawWithPreset.ownerRateGuaranteedOccPct),
    adr,
    adrGrowthPct,
    stabilizedOccPct,
    initialOccPct,
    stabilizationYear,
    holdPeriodYears: Math.max(5, Math.min(15, holdPeriodYears)),
    fbRestaurantPctOfRooms: num(rawWithPreset.fbRestaurantPctOfRooms),
    fbBanquetPctOfRooms: num(rawWithPreset.fbBanquetPctOfRooms),
    otherOperatedPctOfRooms: num(rawWithPreset.otherOperatedPctOfRooms),
    parkingPctOfRooms: num(rawWithPreset.parkingPctOfRooms),
    leaseIncomeCrPa: num(rawWithPreset.leaseIncomeCrPa),
    fbRestaurantPerPOR: num(rawWithPreset.fbRestaurantPerPOR),
    fbBanquetPerPOR: num(rawWithPreset.fbBanquetPerPOR),
    otherOperatedPerPOR: num(rawWithPreset.otherOperatedPerPOR),
    parkingPerPOR: num(rawWithPreset.parkingPerPOR),
    fbDeliveryPerPOR: num(rawWithPreset.fbDeliveryPerPOR),
    roomsDeptCostPct: num(rawWithPreset.roomsDeptCostPct),
    fbDeptCostPct: num(rawWithPreset.fbDeptCostPct),
    otherDeptCostPct: num(rawWithPreset.otherDeptCostPct),
    roomsFixedPct: num(rawWithPreset.roomsFixedPct),
    fbFixedPct: num(rawWithPreset.fbFixedPct),
    otherOpFixedPct: num(rawWithPreset.otherOpFixedPct),
    aAndGPct: num(rawWithPreset.aAndGPct),
    itPct: num(rawWithPreset.itPct),
    smPct: num(rawWithPreset.smPct),
    pomPct: num(rawWithPreset.pomPct),
    utilitiesPct: num(rawWithPreset.utilitiesPct),
    aAndGPerPOR: num(rawWithPreset.aAndGPerPOR),
    itPerPOR: num(rawWithPreset.itPerPOR),
    smPerPOR: num(rawWithPreset.smPerPOR),
    pomPerPOR: num(rawWithPreset.pomPerPOR),
    utilitiesPerPOR: num(rawWithPreset.utilitiesPerPOR),
    expenseInflationPct: num(rawWithPreset.expenseInflationPct),
    mgmtBasePct: num(rawWithPreset.mgmtBasePct),
    mgmtIncentivePct: num(rawWithPreset.mgmtIncentivePct),
    brandRoyaltyPctOfRooms: num(rawWithPreset.brandRoyaltyPctOfRooms),
    brandMktReservPctOfRooms: num(rawWithPreset.brandMktReservPctOfRooms),
    propertyTaxPctRev: num(rawWithPreset.propertyTaxPctRev),
    insurancePctRev: num(rawWithPreset.insurancePctRev),
    propertyTaxCrPa: num(rawWithPreset.propertyTaxCrPa),
    insuranceCrPa: num(rawWithPreset.insuranceCrPa),
    groundLeaseCrPa: num(rawWithPreset.groundLeaseCrPa),
    ffeReservePct,
    staffPerKey: num(rawWithPreset.staffPerKey),
    avgAnnualSalaryInr: num(rawWithPreset.avgAnnualSalaryInr),
  };

  const hasUsaliDrivers =
    num(rawWithPreset.aAndGPerPOR) > 0 ||
    num(rawWithPreset.pomPerPOR) > 0 ||
    num(rawWithPreset.utilitiesPerPOR) > 0 ||
    num(rawWithPreset.smPerPOR) > 0 ||
    num(rawWithPreset.itPerPOR) > 0 ||
    num(rawWithPreset.roomsFixedPct) > 0 ||
    num(rawWithPreset.propertyTaxCrPa) > 0;

  const usaliPnl: UsaliPnlRow[] = buildUsaliPnl(usaliInputs);
  const usaliSummary: UsaliStabilisedSummary | null = buildUsaliSummary(
    usaliInputs,
    usaliPnl,
  );

  const revPARStabilised = adr * (stabilizedOccPct / 100);
  const roomsRevY1LegacyCr = D((keys * revPARStabilised * 365) / CRORE);
  const totalRevY1LegacyCr = roomsRevY1LegacyCr.mulNumber(
    1 + fbRevPct / 100 + otherRevPct / 100,
  );
  const gopLegacyCr = totalRevY1LegacyCr.mulNumber(gopMarginPct / 100);
  const ebitdaY1LegacyCr = totalRevY1LegacyCr.mulNumber(ebitdaMarginPct / 100);
  const ffeReserveY1LegacyCr = totalRevY1LegacyCr.mulNumber(ffeReservePct / 100);
  const noiY1LegacyCr = ebitdaY1LegacyCr.sub(ffeReserveY1LegacyCr);

  // When USALI drivers are set, use the stabilised-year USALI row as the
  // authoritative NOI / EBITDA / GOP source. Otherwise, keep the legacy
  // blended-margin numbers so existing parity holds.
  const roomsRevY1Cr =
    hasUsaliDrivers && usaliSummary
      ? D(usaliSummary.stabilisedRoomsRevCr)
      : roomsRevY1LegacyCr;
  const totalRevY1Cr =
    hasUsaliDrivers && usaliSummary
      ? D(usaliSummary.stabilisedTotalRevCr)
      : totalRevY1LegacyCr;
  const gopCr =
    hasUsaliDrivers && usaliSummary
      ? D(usaliSummary.stabilisedGOPCr)
      : gopLegacyCr;
  const ebitdaY1Cr =
    hasUsaliDrivers && usaliSummary
      ? D(usaliSummary.stabilisedEBITDACr)
      : ebitdaY1LegacyCr;
  const ffeReserveY1Cr = totalRevY1Cr.mulNumber(ffeReservePct / 100);
  const noiY1Cr =
    hasUsaliDrivers && usaliSummary
      ? D(usaliSummary.stabilisedNOICr)
      : noiY1LegacyCr;

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

  // Monthly operating NOI line items. Two paths:
  //
  //   (a) USALI drivers present — annual NOI per year comes from the detailed
  //       USALI cascade (`usaliPnl[y].noiCr`). Divided evenly across the 12
  //       months of that operating year so the proforma's `Stabilised
  //       operations (NOI)` row reconciles line-for-line with the P&L the
  //       frontend renders. This is the path Indian 4-star/5-star deals take.
  //
  //   (b) Legacy blended-margin mode — simple 3-step occupancy ramp and
  //       `totalRev × ebitdaMargin` for deals that pre-date the USALI inputs.
  //       Preserved for parity with historical deals.
  //
  // Previously the monthly loop always used path (b), so USALI-priced deals
  // showed one NOI in the P&L (e.g. Y1 ≈ ₹1.97 Cr) and a *different* NOI in
  // the quarterly proforma (e.g. Y6 ≈ ₹3.97 Cr) because the cashflow stream
  // was computed from the blended 22% margin and a coarser ramp, while the
  // P&L used per-POR expenses and linear ramp. The two now agree.
  const operatingStart = period.constructionEndMonth + 1;
  const operatingEnd = period.totalMonths;
  const useUsaliCascade = hasUsaliDrivers && usaliPnl.length > 0;
  const legacyRamp = [0.4, 0.55, stabilizedOccPct / 100];
  for (let month = operatingStart; month <= operatingEnd; month++) {
    const monthsIntoOps = month - operatingStart;
    const yearIdx = Math.ceil((monthsIntoOps + 1) / 12); // 1-indexed operating year

    let monthNOI: Decimal;
    if (useUsaliCascade) {
      const yIdx = Math.min(Math.max(0, yearIdx - 1), usaliPnl.length - 1);
      const annualNOI = usaliPnl[yIdx]?.noiCr ?? 0;
      monthNOI = D(annualNOI / 12);
    } else {
      const occ =
        yearIdx <= 1 ? legacyRamp[0] : yearIdx === 2 ? legacyRamp[1] : legacyRamp[2];
      const adrThis = adr * Math.pow(1 + adrGrowthPct / 100, yearIdx - 1);
      const revPAR = adrThis * occ;
      const monthRoomsRev = D((keys * revPAR * (365 / 12)) / CRORE);
      const monthTotalRev = monthRoomsRev.mulNumber(1 + fbRevPct / 100 + otherRevPct / 100);
      const monthEBITDA = monthTotalRev.mulNumber(ebitdaMarginPct / 100);
      const monthFFEReserve = monthTotalRev.mulNumber(ffeReservePct / 100);
      monthNOI = monthEBITDA.sub(monthFFEReserve);
    }

    items.push(
      bulletInflow({
        period,
        month,
        amount: monthNOI,
        category: 'revenue',
        subcategory: 'operations',
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

  // Indian-specific hospitality KPIs derived from the USALI cascade.
  // `staffPerKey` × keys × avg salary gives an absolute labour cost even when
  // POR inputs are absent — the user can edit the surfaced number.
  const staffPerKey = num(rawWithPreset.staffPerKey);
  const avgAnnualSalaryInr = num(rawWithPreset.avgAnnualSalaryInr);
  const labourCostCrY1 =
    staffPerKey > 0 && avgAnnualSalaryInr > 0
      ? (keys * staffPerKey * avgAnnualSalaryInr) / CRORE
      : usaliSummary?.stabilisedLabourCostCr ?? null;
  const labourCostPerKeyInr =
    labourCostCrY1 != null ? (labourCostCrY1 * CRORE) / keys : null;

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
    // Header KPIs that the frontend reads directly from `kpis.*`
    stabilizedADR: usaliSummary?.stabilisedADR ?? adr,
    stabilizedOccupancy: usaliSummary?.stabilisedOccPct ?? stabilizedOccPct,
    stabilizedNOIMarginPct: usaliSummary?.stabilisedNOIMarginPct ?? null,
    stabilizedGOPMarginPct: usaliSummary?.stabilisedGOPMarginPct ?? gopMarginPct,
    stabilizedEBITDAMarginPct:
      usaliSummary?.stabilisedEBITDAMarginPct ?? ebitdaMarginPct,
    // India-specific operating KPIs
    costPerOccupiedRoom: usaliSummary?.stabilisedCPOR ?? null,
    breakEvenOccPct: usaliSummary?.breakEvenOccPct ?? null,
    breakEvenRevPAR: usaliSummary?.breakEvenRevPAR ?? null,
    flowThroughPct: usaliSummary?.avgFlowThroughPct ?? null,
    staffPerKey: staffPerKey > 0 ? staffPerKey : null,
    labourCostCr: labourCostCrY1,
    labourCostPerKey: labourCostPerKeyInr,
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
      // `usaliPnl` + `usaliSummary` ride alongside the numeric extras as
      // opaque pass-through payloads — `kernel.service.js::flattenRevenue`
      // recognises them by key name and emits them as `usali_pnl` /
      // `usali_summary` on the backend revenue object. The cast widens the
      // value type; TypeScript's strict `Decimal | null` on extras is still
      // enforced for every numeric extra here.
      totalRevenueCr: exitValueCr,
      stabilizedNOICr: noiY1Cr,
      exitValueCr,
      extras: Object.freeze({
        revPAR: D(revPARStabilised),
        roomsRevenue: roomsRevY1Cr,
        gop: gopCr,
        ebitda: ebitdaY1Cr,
        stabilizedRevenueCr: totalRevY1Cr,
        usaliPnl: usaliPnl as unknown as Decimal | null,
        usaliSummary: usaliSummary as unknown as Decimal | null,
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
