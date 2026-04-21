'use strict';

/**
 * REDIP Financial Engine — Institutional Grade
 * Multi-asset-class: Residential, Plotted, Commercial Office, Retail, Industrial
 * All monetary values in Crores (₹ Cr) | All areas in sqft
 * Supports: capital stack, contingency, soft costs, scenario analysis
 */

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const {
  STAMP_DUTY_RATE,
  KARNATAKA_STAMP_REG_RATE,
  GST_CONSTRUCTION_STANDARD,
} = require('../config/india');

const CARPET_RATIO    = 0.70;  // Carpet / Saleable area
const MIN_PROJECT_DURATION_YEARS = 1;
const MAX_PROJECT_DURATION_YEARS = 15;
const DEFAULT_GST_PCT_BY_ASSET_CLASS = Object.freeze({
  residential_apartments: 18,
  plotted_development: 12,
  commercial_office: 18,
  retail: 18,
  industrial_warehousing: 18,
  hospitality: 18,
});
const SUPPORTED_EXIT_STRATEGIES = new Set(['cap_rate_sale', 'lrd', 'forward_purchase']);

// Terminal value methodologies for income-producing / hospitality assets.
// - exit_cap_rate:    TV = NOI_exit / exitCapRate                          (default)
// - exit_multiple:    TV = NOI_stabilized * exitMultiple                   (EBITDA × multiple, etc.)
// - perpetuity_growth: TV = NOI_exit * (1+g) / (discountRate - g)          (Gordon growth)
// - forward_purchase: TV = forwardPurchasePriceCr                          (contractual exit)
const SUPPORTED_TERMINAL_VALUE_METHODS = new Set([
  'exit_cap_rate',
  'exit_multiple',
  'perpetuity_growth',
  'forward_purchase',
]);

// Scenario presets: adjustments applied to base inputs
const SCENARIO_PRESETS = {
  base: {
    label: 'Base Case',
    color: 'slate',
    revenueMultiplier: 1.00,
    hardCostMultiplier: 1.00,
    durationMultiplier: 1.00,
    financeDelta: 0,
    exitCapRateDelta: 0,
    vacancyDelta: 0,
  },
  bull: {
    label: 'Bull Case',
    color: 'green',
    revenueMultiplier: 1.10,    // +10% selling rate / rent
    hardCostMultiplier: 0.95,   // -5% construction cost (strong procurement)
    durationMultiplier: 0.90,   // -10% duration (faster delivery)
    financeDelta: -1.0,         // -1% pa finance/debt rate
    exitCapRateDelta: -0.50,    // -50bps tighter cap rate (income assets)
    vacancyDelta: -3,           // -3% lower vacancy (income assets)
  },
  bear: {
    label: 'Bear Case',
    color: 'red',
    revenueMultiplier: 0.88,    // -12% selling rate / rent
    hardCostMultiplier: 1.10,   // +10% cost overrun
    durationMultiplier: 1.20,   // +20% delays
    financeDelta: +2.0,         // +2% pa finance/debt rate
    exitCapRateDelta: +0.75,    // +75bps wider cap rate (income assets)
    vacancyDelta: +5,           // +5% higher vacancy (income assets)
  },
};

// ─── CORE MATH ───────────────────────────────────────────────────────────────

function calculateNPV(cashFlows, annualDiscountRate) {
  if (!cashFlows || cashFlows.length === 0) return 0;
  if (annualDiscountRate < 0 || annualDiscountRate > 10) throw new Error('Discount rate must be between 0 and 1000%');
  const qr = Math.pow(1 + annualDiscountRate, 0.25) - 1;
  return cashFlows.reduce((npv, cf, t) => npv + cf / Math.pow(1 + qr, t), 0);
}

function calculateIRR(cashFlows) {
  if (!cashFlows || cashFlows.length < 2) throw new Error('At least 2 cash flows required');
  if (!cashFlows.some((c) => c < 0) || !cashFlows.some((c) => c > 0))
    throw new Error('Cash flows must have both negative and positive values');

  const MAX_ITER = 1000;
  const PREC = 1e-10;
  const npv  = (r) => cashFlows.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);
  const dnpv = (r) => cashFlows.reduce((s, c, t) => (t === 0 ? s : s - (t * c) / Math.pow(1 + r, t + 1)), 0);

  for (const r0 of [0.05, 0.02, 0.10, 0.15, 0.01, 0.20]) {
    let r = r0;
    for (let i = 0; i < MAX_ITER; i++) {
      const d = dnpv(r);
      if (Math.abs(d) < 1e-15) break;
      const rNew = r - npv(r) / d;
      if (rNew <= -1) break;
      if (Math.abs(rNew - r) < PREC) {
        if (Math.abs(npv(rNew)) < 0.001) {
          return Math.round((Math.pow(1 + rNew, 4) - 1) * 1e8) / 1e6;
        }
      }
      r = rNew;
    }
  }

  // Bisection fallback
  let lo = -0.9999, hi = 10;
  for (let h = 0.5; h <= 50; h += 0.5) {
    if (npv(-0.9999) * npv(h) < 0) { hi = h; break; }
  }
  for (let i = 0; i < MAX_ITER * 2; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(npv(mid)) < PREC || (hi - lo) / 2 < PREC) {
      return Math.round((Math.pow(1 + mid, 4) - 1) * 1e8) / 1e6;
    }
    npv(lo) * npv(mid) < 0 ? (hi = mid) : (lo = mid);
  }
  return Math.round((Math.pow(1 + (lo + hi) / 2, 4) - 1) * 1e8) / 1e6;
}

function calculateResidualLandValue({ totalRevenueCr, totalConstructionCostCr, gstCostCr, approvalCostCr, marketingCostCr, financeCostCr, developerMarginPct = 20 }) {
  return (totalRevenueCr - totalConstructionCostCr - gstCostCr - approvalCostCr - marketingCostCr - financeCostCr) / (1 + developerMarginPct / 100);
}

// S-curve weights for construction spend distribution
function sCurveWeights(n) {
  const weights = Array.from({ length: n }, (_, q) => {
    const p = (q + 1) / n;
    return Math.max(0.01, Math.sin(p * Math.PI) * 1.5);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

/**
 * Build a quarterly debt draw + interest accrual schedule.
 * Draws follow an S-curve across the construction window; interest accrues on
 * the actual outstanding balance each quarter (opening balance + draw that quarter).
 * Balloon repayment at the end of the horizon.
 *
 * @param {object} params
 * @param {number} params.principalCr        Total principal drawn across construction (₹ Cr)
 * @param {number} params.annualRatePct      Interest rate %/yr
 * @param {number} params.totalQuarters      Total quarters in the cash-flow horizon
 * @param {number} params.drawStartQ         First quarter index where draws can occur (1-based into CFs)
 * @param {number} params.drawEndQ           Last quarter where draws may occur
 * @param {number} [params.repaymentQ]       Quarter for balloon repayment (default = totalQuarters)
 * @param {boolean} [params.capitalizeInterest=true]  Roll interest into balance (vs. cash pay)
 * @returns {{draws:number[], balances:number[], interest:number[], totalInterestCr:number, totalPrincipalCr:number, repaymentQ:number}}
 */
function buildDrawSchedule({
  principalCr,
  annualRatePct,
  totalQuarters,
  drawStartQ,
  drawEndQ,
  repaymentQ,
  capitalizeInterest = true,
}) {
  const draws = new Array(totalQuarters + 1).fill(0);
  const balances = new Array(totalQuarters + 1).fill(0);
  const interest = new Array(totalQuarters + 1).fill(0);

  if (!(principalCr > 0) || !(annualRatePct >= 0) || !(totalQuarters >= 1)) {
    return { draws, balances, interest, totalInterestCr: 0, totalPrincipalCr: 0, repaymentQ: repaymentQ ?? totalQuarters };
  }

  const qRate = Math.pow(1 + annualRatePct / 100, 0.25) - 1; // effective quarterly rate
  const startQ = Math.max(1, Math.floor(drawStartQ));
  const endQ = Math.max(startQ, Math.min(totalQuarters, Math.ceil(drawEndQ)));
  const durationQ = Math.max(1, endQ - startQ + 1);
  const weights = sCurveWeights(durationQ);
  for (let i = 0; i < durationQ; i++) {
    const q = startQ + i;
    if (q <= totalQuarters) draws[q] = principalCr * weights[i];
  }

  let balance = 0;
  let totalInterest = 0;
  for (let q = 0; q <= totalQuarters; q++) {
    const opening = balance;
    balance += draws[q];
    const accr = balance * qRate;
    interest[q] = accr;
    totalInterest += accr;
    balance += capitalizeInterest ? accr : 0;
    balances[q] = balance;
    // record opening not strictly needed here; balances[] stores closing
    void opening;
  }

  return {
    draws,
    balances,
    interest,
    totalInterestCr: totalInterest,
    totalPrincipalCr: principalCr,
    repaymentQ: repaymentQ ?? totalQuarters,
  };
}

/**
 * Build an amortizing (annuity) debt schedule for income-producing hold phases.
 * Emits quarterly level debt service during operation; remaining principal balloons at exit.
 *
 * @param {object} params
 * @param {number} params.principalCr              Initial funded principal (₹ Cr)
 * @param {number} params.annualRatePct            Interest rate %/yr
 * @param {number} params.amortizationYears        Amortization period (years) — typical 15–20 for CRE term loans
 * @param {number} params.drawQ                    Quarter when loan funds (1-based)
 * @param {number} params.operatingStartQ          First quarter amortizing P&I payments begin
 * @param {number} params.exitQ                    Quarter the loan is fully repaid (balloon of remaining balance)
 * @param {number} params.totalQuarters            Horizon length
 * @returns {{draws:number[], interestPayments:number[], principalPayments:number[],
 *            debtService:number[], balances:number[], balloonRepaymentCr:number,
 *            totalInterestCr:number, quarterlyPayment:number}}
 */
function buildAmortizingSchedule({
  principalCr,
  annualRatePct,
  amortizationYears,
  drawQ,
  operatingStartQ,
  exitQ,
  totalQuarters,
}) {
  const draws = new Array(totalQuarters + 1).fill(0);
  const interestPayments = new Array(totalQuarters + 1).fill(0);
  const principalPayments = new Array(totalQuarters + 1).fill(0);
  const debtService = new Array(totalQuarters + 1).fill(0);
  const balances = new Array(totalQuarters + 1).fill(0);

  if (!(principalCr > 0) || !(annualRatePct > 0)) {
    return {
      draws, interestPayments, principalPayments, debtService, balances,
      balloonRepaymentCr: 0, totalInterestCr: 0, quarterlyPayment: 0,
    };
  }

  const qRate = Math.pow(1 + annualRatePct / 100, 0.25) - 1;
  const nQ = Math.max(4, Math.round(amortizationYears * 4));
  // Annuity quarterly payment — covers P&I as if amortized over full amort period
  const quarterlyPayment = qRate > 0
    ? principalCr * (qRate * Math.pow(1 + qRate, nQ)) / (Math.pow(1 + qRate, nQ) - 1)
    : principalCr / nQ;

  const fundQ = Math.max(1, Math.floor(drawQ));
  const opStart = Math.max(fundQ, Math.floor(operatingStartQ));
  const opEnd = Math.min(totalQuarters, Math.floor(exitQ));
  draws[fundQ] = principalCr;

  let balance = 0;
  let totalInterest = 0;
  for (let q = 0; q <= totalQuarters; q++) {
    // Fund the loan
    balance += draws[q];

    if (q >= opStart && q <= opEnd && balance > 0) {
      const interest = balance * qRate;
      const principal = Math.max(0, Math.min(balance, quarterlyPayment - interest));
      interestPayments[q] = interest;
      principalPayments[q] = principal;
      debtService[q] = interest + principal;
      balance -= principal;
      totalInterest += interest;
    }

    balances[q] = balance;
  }

  // Balloon remaining balance at exit
  const balloonRepaymentCr = balances[opEnd] || 0;
  if (opEnd >= 0 && opEnd <= totalQuarters) {
    principalPayments[opEnd] += balloonRepaymentCr;
    debtService[opEnd] += balloonRepaymentCr;
    balances[opEnd] = 0;
    for (let q = opEnd + 1; q <= totalQuarters; q++) balances[q] = 0;
  }

  return {
    draws,
    interestPayments,
    principalPayments,
    debtService,
    balances,
    balloonRepaymentCr,
    totalInterestCr: totalInterest,
    quarterlyPayment,
  };
}

const round4 = (n) => (n != null && !isNaN(n) ? Math.round(n * 10000) / 10000 : null);
const round2 = (n) => (n != null && !isNaN(n) ? Math.round(n * 100) / 100 : null);
const roundQuarterYear = (n) => (n != null && !isNaN(n) ? Math.round(n * 4) / 4 : null);

function resolveGstRate(input, assetClass) {
  const gstPct = Number(input.gstPct);
  if (Number.isFinite(gstPct) && gstPct >= 0) {
    return gstPct / 100;
  }

  return (DEFAULT_GST_PCT_BY_ASSET_CLASS[assetClass] || 0) / 100;
}

function resolveDebtRatio(value, fallback = 0) {
  const ratio = Number(value);
  const safeRatio = Number.isFinite(ratio) ? ratio : fallback;
  return Math.min(1, Math.max(0, safeRatio));
}

function resolveExitStrategy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_EXIT_STRATEGIES.has(normalized) ? normalized : 'cap_rate_sale';
}

function resolveTerminalValueMethod(value, { exitStrategy, forwardPurchasePriceCr } = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUPPORTED_TERMINAL_VALUE_METHODS.has(normalized)) return normalized;
  // Infer from exit strategy when explicit method is not provided
  if (exitStrategy === 'forward_purchase' && Number(forwardPurchasePriceCr) > 0) {
    return 'forward_purchase';
  }
  return 'exit_cap_rate';
}

/**
 * Unified terminal value calculator.
 * Applies the selected methodology and returns both the nominal terminal value
 * and its present value discounted to the effective date (t = 0).
 *
 * @param {object} p
 * @param {string} p.method                      - one of SUPPORTED_TERMINAL_VALUE_METHODS
 * @param {number} p.stabilizedNOICr             - stabilized NOI (or EBITDA) in ₹ Cr
 * @param {number} p.noiAtExitCr                 - NOI/EBITDA grown to exit year
 * @param {number} p.exitCapRatePct              - exit cap rate (%)
 * @param {number} p.exitMultiple                - exit multiple (×)
 * @param {number} p.perpetuityGrowthPct         - perpetuity growth rate (%)
 * @param {number} p.discountRatePct             - unlevered discount rate (%)
 * @param {number} p.forwardPurchasePriceCr      - contractual forward purchase price (₹ Cr)
 * @param {number} p.holdPeriodYears             - hold period in years (for PV calc)
 * @returns {{ method, terminalValueCr, terminalValuePVCr, formula, inputs }}
 */
function computeTerminalValue({
  method,
  stabilizedNOICr,
  noiAtExitCr,
  exitCapRatePct,
  exitMultiple,
  perpetuityGrowthPct,
  discountRatePct,
  forwardPurchasePriceCr,
  holdPeriodYears,
}) {
  const safe = (n) => (Number.isFinite(n) ? n : 0);
  const method_ = SUPPORTED_TERMINAL_VALUE_METHODS.has(method) ? method : 'exit_cap_rate';
  const noiExit = safe(noiAtExitCr);
  const noiStab = safe(stabilizedNOICr);
  const capPct  = safe(exitCapRatePct);
  const mult    = safe(exitMultiple);
  const gPct    = safe(perpetuityGrowthPct);
  const dPct    = safe(discountRatePct);
  const fwdCr   = safe(forwardPurchasePriceCr);
  const tYears  = safe(holdPeriodYears);

  let tvCr = 0;
  let formula = '';
  const inputs = {};
  switch (method_) {
    case 'exit_multiple':
      tvCr = noiStab * mult;
      formula = 'Stabilized NOI × Exit Multiple';
      inputs.stabilizedNOICr = round4(noiStab);
      inputs.exitMultiple = round2(mult);
      break;
    case 'perpetuity_growth': {
      const spread = (dPct - gPct) / 100;
      if (spread > 0) {
        tvCr = (noiExit * (1 + gPct / 100)) / spread;
      } else {
        // Fallback to cap rate method when spread is invalid (g >= r)
        tvCr = capPct > 0 ? noiExit / (capPct / 100) : 0;
      }
      formula = 'NOI_exit × (1+g) / (r − g)';
      inputs.noiAtExitCr = round4(noiExit);
      inputs.perpetuityGrowthPct = round2(gPct);
      inputs.discountRatePct = round2(dPct);
      inputs.spreadPct = round2(dPct - gPct);
      break;
    }
    case 'forward_purchase':
      tvCr = fwdCr;
      formula = 'Contractual Forward Purchase Price';
      inputs.forwardPurchasePriceCr = round4(fwdCr);
      break;
    case 'exit_cap_rate':
    default:
      tvCr = capPct > 0 ? noiExit / (capPct / 100) : 0;
      formula = 'NOI_exit ÷ Exit Cap Rate';
      inputs.noiAtExitCr = round4(noiExit);
      inputs.exitCapRatePct = round2(capPct);
      break;
  }

  const tvPVCr = dPct >= 0 && Number.isFinite(tYears) && tYears >= 0
    ? tvCr / Math.pow(1 + dPct / 100, tYears)
    : tvCr;

  return {
    method: method_,
    terminalValueCr: tvCr,
    terminalValuePVCr: tvPVCr,
    formula,
    inputs,
  };
}

function safeCashFlows(cfs) {
  return cfs.map((v) => Math.round((isFinite(v) ? v : 0) * 100) / 100);
}

function normalizeEffectiveDate(value) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  const candidate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return candidate.toISOString().slice(0, 10);
}

function addUtcDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addUtcMonths(dateStr, months) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function toValidYearInput(value, fallbackYears) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallbackYears;
  }

  return numeric;
}

function resolveTimelineInput(input, {
  defaultDurationYears,
  defaultConstructionStartYears = 0,
  defaultConstructionEndRatio = 0.85,
}) {
  const durationYearsRaw = input.projectDurationYears != null
    ? Number(input.projectDurationYears)
    : (Number(input.projectDurationMonths) || defaultDurationYears * 12) / 12;

  const durationYears = roundQuarterYear(toValidYearInput(durationYearsRaw, defaultDurationYears));
  const durationMonths = Math.round(durationYears * 12);

  // Construction timing is naturally month-level. Prefer direct month input so
  // users get exact 14/18/22-month schedules instead of silent quarter-year drift.
  const constructionStartMonthsRaw = input.constructionStartMonths != null
    ? Number(input.constructionStartMonths)
    : (input.constructionStartYears != null
      ? Number(input.constructionStartYears) * 12
      : defaultConstructionStartYears * 12);
  const constructionStartMonths = Math.max(0, Math.min(
    durationMonths,
    Math.round(Number.isFinite(constructionStartMonthsRaw) ? constructionStartMonthsRaw : 0)
  ));
  const constructionStartYears = constructionStartMonths / 12;

  const defaultConstructionEndMonths = Math.round(durationMonths * defaultConstructionEndRatio);
  const constructionEndMonthsRaw = input.constructionEndMonths != null
    ? Number(input.constructionEndMonths)
    : (input.constructionEndYears != null
      ? Number(input.constructionEndYears) * 12
      : defaultConstructionEndMonths);
  const constructionEndMonths = Math.max(
    constructionStartMonths + 1,
    Math.min(
      durationMonths,
      Math.round(Number.isFinite(constructionEndMonthsRaw) && constructionEndMonthsRaw > 0
        ? constructionEndMonthsRaw
        : defaultConstructionEndMonths)
    )
  );
  const constructionEndYears = constructionEndMonths / 12;

  return {
    effectiveDate: normalizeEffectiveDate(input.effectiveDate),
    projectDurationYears: durationYears,
    projectDurationMonths: durationMonths,
    constructionStartYears,
    constructionStartMonths,
    constructionEndYears,
    constructionEndMonths,
  };
}

function buildTimeline({
  effectiveDate,
  projectDurationYears,
  projectDurationMonths,
  constructionStartYears = 0,
  constructionStartMonths = 0,
  constructionEndYears = projectDurationYears,
  constructionEndMonths = projectDurationMonths,
  holdPeriodYears = 0,
}) {
  const totalModelMonths = projectDurationMonths + Math.max(0, Math.round((Number(holdPeriodYears) || 0) * 12));

  return {
    effectiveDate,
    projectDurationYears: roundQuarterYear(projectDurationYears),
    projectDurationMonths,
    constructionStartYears: roundQuarterYear(constructionStartYears),
    constructionStartMonths,
    constructionEndYears: roundQuarterYear(constructionEndYears),
    constructionEndMonths,
    holdPeriodYears: roundQuarterYear(Number(holdPeriodYears) || 0),
    constructionStartDate: addUtcMonths(effectiveDate, constructionStartMonths),
    constructionEndDate: addUtcDays(addUtcMonths(effectiveDate, constructionEndMonths), -1),
    modelEndDate: addUtcDays(addUtcMonths(effectiveDate, totalModelMonths), -1),
  };
}

function structureCashFlows(cfs, timeline = {}) {
  const effectiveDate = normalizeEffectiveDate(timeline.effectiveDate);
  const quarterly = cfs.map((net, quarter) => {
    if (quarter === 0) {
      return {
        quarter,
        label: 'Effective Date',
        startDate: effectiveDate,
        endDate: effectiveDate,
        period: effectiveDate,
        net,
      };
    }

    const startDate = addUtcMonths(effectiveDate, (quarter - 1) * 3);
    const endDate = addUtcDays(addUtcMonths(effectiveDate, quarter * 3), -1);

    return {
      quarter,
      label: `Q${quarter}`,
      startDate,
      endDate,
      period: `${startDate} to ${endDate}`,
      net,
    };
  });

  const yearly = [];
  if (cfs[0] !== 0) {
    yearly.push({
      year: 0,
      label: 'Effective Date',
      startDate: effectiveDate,
      endDate: effectiveDate,
      period: effectiveDate,
      net: round2(cfs[0]),
    });
  }

  for (let y = 0; y < Math.ceil((cfs.length - 1) / 4); y++) {
    const s = y * 4 + 1;
    const e = Math.min(s + 3, cfs.length - 1);
    const net = round2(cfs.slice(s, e + 1).reduce((a, b) => a + b, 0));
    yearly.push({
      year: y + 1,
      label: `Year ${y + 1}`,
      startDate: quarterly[s]?.startDate || effectiveDate,
      endDate: quarterly[e]?.endDate || effectiveDate,
      period: quarterly[s]?.startDate && quarterly[e]?.endDate
        ? `${quarterly[s].startDate} to ${quarterly[e].endDate}`
        : effectiveDate,
      net,
    });
  }

  return {
    quarterly,
    yearly,
    summary: {
      totalInflow:  round2(cfs.filter((c) => c > 0).reduce((a, b) => a + b, 0)),
      totalOutflow: round2(Math.abs(cfs.filter((c) => c < 0).reduce((a, b) => a + b, 0))),
    },
  };
}

// ─── RESIDENTIAL APARTMENTS ──────────────────────────────────────────────────

function calculateResidentialApartments(input) {
  const skipSensitivity = input.skipSensitivity === true;
  const plotAreaSqft         = Number(input.plotAreaSqft);
  const fsi                  = Number(input.fsi);
  const loadingFactor        = input.loadingFactor != null && !isNaN(Number(input.loadingFactor))
    ? Number(input.loadingFactor)
    : 0.15;
  const constructionCostSqft = Number(input.constructionCostPerSqft);
  const sellingRateSqft      = Number(input.sellingRatePerSqft);
  const landCostCr           = Number(input.landCostCr) || 0;
  const marketingCostPct     = Number(input.marketingCostPct) || 5;
  const financeCostPct       = Number(input.financeCostPct) > 0
    ? Number(input.financeCostPct)
    : (Number(input.debtRatePct) > 0 ? Number(input.debtRatePct) : 12);
  const developerMarginPct   = Number(input.developerMarginPct) || 20;
  const discountRatePct      = Number(input.discountRatePct) || 14;
  const pricingEscalationPct = Number(input.pricingEscalationPct) || 0;
  const avgUnitSizeSqftRaw   = Number(input.avgUnitSizeSqft);
  const avgUnitSizeSqft      = Number.isFinite(avgUnitSizeSqftRaw) && avgUnitSizeSqftRaw > 0
    ? avgUnitSizeSqftRaw
    : null;
  const timeline = resolveTimelineInput(input, {
    defaultDurationYears: 3,
    defaultConstructionStartYears: 0.25,
    defaultConstructionEndRatio: 0.85,
  });
  const durationMonths = timeline.projectDurationMonths;

  // Soft costs (% of construction cost)
  const contingencyPct  = Number(input.contingencyPct)  || 5;   // 5% default contingency
  const architectFeePct = Number(input.architectFeePct) || 2;   // design + architecture
  const pmcFeePct       = Number(input.pmcFeePct)       || 1.5; // project management

  // Construction phasing
  const constructionStartMonths = timeline.constructionStartMonths;
  const constructionEndMonths = timeline.constructionEndMonths;

  // Capital stack
  const debtLTV     = resolveDebtRatio(input.debtLTV, 0);
  const debtRatePct = Number(input.debtRatePct) || 10.5;

  if (
    !Number.isFinite(plotAreaSqft)
    || !Number.isFinite(fsi)
    || !Number.isFinite(constructionCostSqft)
    || !Number.isFinite(sellingRateSqft)
  ) {
    throw new Error('Required field missing');
  }
  if (plotAreaSqft <= 0) throw new Error('Plot area must be greater than 0');
  if (fsi <= 0 || fsi > 20) throw new Error('FSI must be between 0 and 20');
  if (timeline.projectDurationYears < MIN_PROJECT_DURATION_YEARS || timeline.projectDurationYears > MAX_PROJECT_DURATION_YEARS) {
    throw new Error(`Project duration must be between ${MIN_PROJECT_DURATION_YEARS} and ${MAX_PROJECT_DURATION_YEARS} years`);
  }
  if (loadingFactor < 0 || loadingFactor > 1)   throw new Error('Loading factor must be between 0 and 1 (e.g. 0.15 = 15% loading)');
  if (constructionCostSqft <= 0) throw new Error('Construction cost must be positive');
  if (sellingRateSqft <= 0)      throw new Error('Selling rate must be positive');

  // Areas — Indian convention: FSI defines buildable/FAR area (gross),
  // loading adds balconies, common areas, terraces etc. on top to get saleable
  // e.g. plot 100sf × FSI 2.5 × (1 + 0.15 loading) = 287.5 sf saleable
  const grossAreaSqft    = plotAreaSqft * fsi;
  const saleableAreaSqft = grossAreaSqft * (1 + loadingFactor);
  const carpetAreaSqft   = grossAreaSqft * CARPET_RATIO;
  const superBuiltupSqft = saleableAreaSqft;
  const numberOfUnits    = avgUnitSizeSqft ? Math.max(1, Math.round(saleableAreaSqft / avgUnitSizeSqft)) : null;

  // Approval cost: ₹/sqft of GFA or legacy Cr
  const approvalCostCr = Number(input.approvalCostPerSqft) > 0
    ? (grossAreaSqft * Number(input.approvalCostPerSqft)) / 1e7
    : Number(input.approvalCostCr) || 0;

  // Revenue with compound pricing escalation
  // Average effective rate over the selling period using compound growth
  const durationYears     = durationMonths / 12;
  const avgPriceEsc       = pricingEscalationPct > 0
    ? ((Math.pow(1 + pricingEscalationPct / 100, durationYears) - 1) / (pricingEscalationPct / 100 * durationYears))
    : 1;
  const effectiveRate     = sellingRateSqft * avgPriceEsc;
  const totalRevenueCr    = (saleableAreaSqft * effectiveRate) / 1e7;

  // HARD COSTS
  const constructionCostCr = (saleableAreaSqft * constructionCostSqft) / 1e7;
  const gstRateInput       = resolveGstRate(input, 'residential_apartments');
  const gstCostCr          = constructionCostCr * gstRateInput;
  const contingencyCr      = constructionCostCr * (contingencyPct / 100);
  const stampDutyCr        = landCostCr * STAMP_DUTY_RATE;
  const hardCostCr         = constructionCostCr + gstCostCr + contingencyCr;

  // SOFT COSTS
  const architectCr      = constructionCostCr * (architectFeePct / 100);
  const pmcCr            = constructionCostCr * (pmcFeePct / 100);
  const marketingCostCr  = totalRevenueCr * (marketingCostPct / 100);
  // Finance cost: actual accrual on outstanding balance each quarter.
  //   Land: outstanding from Q0 until project exit (funded at acquisition).
  //   Construction: drawn on S-curve during construction window; interest
  //   capitalizes on the actual balance each quarter rather than an averaged ×0.5 shortcut.
  const totalQResidential = Math.ceil(durationMonths / 3);
  const constStartQRes    = Math.max(1, Math.floor(constructionStartMonths / 3) + 1);
  const constEndQRes      = Math.min(totalQResidential, Math.ceil(constructionEndMonths / 3));
  // Finance carry caps at loan term if set, else at construction end + 1 qtr
  // (typical: construction loan repaid from sales proceeds shortly after handover).
  const debtTenorMonthsIn = Number(input.debtTenorYears) > 0
    ? Number(input.debtTenorYears) * 12
    : Math.min(durationMonths, constructionEndMonths + 3);
  const carryQRes = Math.min(totalQResidential, Math.ceil(debtTenorMonthsIn / 3));
  const qFinRate          = Math.pow(1 + financeCostPct / 100, 0.25) - 1;
  // Land financing: interest accrues quarterly on the fixed land balance, capped at loan term
  const landFinanceCr     = landCostCr > 0 && carryQRes > 0
    ? landCostCr * (Math.pow(1 + qFinRate, carryQRes) - 1)
    : 0;
  const constSchedule = buildDrawSchedule({
    principalCr: hardCostCr,
    annualRatePct: financeCostPct,
    totalQuarters: carryQRes,
    drawStartQ: constStartQRes,
    drawEndQ: Math.min(constEndQRes, carryQRes),
    capitalizeInterest: true,
  });
  const constFinanceCr   = constSchedule.totalInterestCr;
  const financeCostCr    = landFinanceCr + constFinanceCr;
  const softCostCr       = architectCr + pmcCr + approvalCostCr + marketingCostCr + financeCostCr;

  const totalCostCr   = landCostCr + stampDutyCr + hardCostCr + softCostCr;
  const grossProfitCr = totalRevenueCr - totalCostCr;
  const grossMarginPct = totalRevenueCr > 0 ? (grossProfitCr / totalRevenueCr) * 100 : 0;

  // RLV = max land price to still achieve developer margin
  const rlvCr = (totalRevenueCr - hardCostCr - approvalCostCr - marketingCostCr - financeCostCr - architectCr - pmcCr) /
                (1 + developerMarginPct / 100);

  // Capital stack
  const debtableBase = hardCostCr; // banks lend against construction, not land
  const debtDrawnCr  = debtableBase * debtLTV;
  const debtInterestCr = debtLTV > 0 ? debtDrawnCr * (debtRatePct / 100) * (constructionEndMonths / 12) : 0;
  const equityInvestedCr = totalCostCr - debtDrawnCr + debtInterestCr;
  const equityMultiple   = equityInvestedCr > 0
    ? (equityInvestedCr + grossProfitCr) / equityInvestedCr
    : null;

  // ── UNLEVERED CASH FLOWS ──────────────────────────────────────────────────
  const totalQ      = Math.ceil(durationMonths / 3);
  const constStartQ = Math.max(0, Math.floor(constructionStartMonths / 3));
  const constEndQ   = Math.min(totalQ, Math.ceil(constructionEndMonths / 3));
  const constDurQ   = Math.max(2, constEndQ - constStartQ);
  const cfs         = new Array(totalQ + 1).fill(0);

  // Q0: land + stamp + 25% approval
  cfs[0] -= landCostCr + stampDutyCr + approvalCostCr * 0.25;

  // Remaining 75% approval in pre-construction quarters
  const approvalRem = approvalCostCr * 0.75;
  if (constStartQ >= 2) {
    for (let q = 1; q <= constStartQ && q <= totalQ; q++) cfs[q] -= approvalRem / constStartQ;
  } else if (totalQ >= 3) {
    cfs[1] -= approvalRem * 0.5; cfs[2] -= approvalRem * 0.5;
  } else if (totalQ >= 2) {
    cfs[1] -= approvalRem;
  }

  // Architecture & PMC: evenly during design/pre-construction
  const softPreCostCr = architectCr + pmcCr;
  const softDur = Math.max(1, constStartQ + 1);
  for (let q = 0; q <= constStartQ && q <= totalQ; q++) cfs[q] -= softPreCostCr / softDur;

  // Construction: S-curve
  const cweights = sCurveWeights(constDurQ);
  for (let q = 0; q < constDurQ; q++) {
    const cfIdx = constStartQ + q + 1;
    if (cfIdx <= totalQ) cfs[cfIdx] -= (hardCostCr) * cweights[q];
  }

  // Marketing: spread from mid-project
  const mktStart = Math.max(constStartQ + 2, Math.floor(totalQ * 0.25));
  const mktEnd   = totalQ - 1;
  const mktDur   = mktEnd - mktStart + 1;
  if (mktDur > 0) for (let q = mktStart; q <= mktEnd; q++) cfs[q] -= marketingCostCr / mktDur;

  // Finance cost: emit actual quarterly accrual so CF timing reflects true draw schedule
  if (financeCostCr > 0 && totalQ >= 1) {
    const qFinRateCF = Math.pow(1 + financeCostPct / 100, 0.25) - 1;
    for (let q = 1; q <= totalQ; q++) {
      // Land interest accrues every quarter on fixed land balance
      const landQ = landCostCr * qFinRateCF;
      // Construction interest from schedule (aligned on same quarter index)
      const constQ = constSchedule.interest[q] || 0;
      cfs[q] -= landQ + constQ;
    }
  }

  // Revenue: right-skewed logistic — Indian milestone-linked collections
  const revStart = Math.max(1, constStartQ);
  const revEnd   = totalQ;
  const revDur   = revEnd - revStart + 1;
  if (revDur > 0) {
    const rweights = Array.from({ length: revDur }, (_, q) => {
      const p = (q + 1) / revDur;
      return Math.max(0.04, 1 / (1 + Math.exp(-7 * (p - 0.60))));
    });
    const rtotal = rweights.reduce((a, b) => a + b, 0);
    for (let q = 0; q < revDur; q++) {
      const cfIdx = revStart + q;
      if (cfIdx <= totalQ) cfs[cfIdx] += totalRevenueCr * (rweights[q] / rtotal);
    }
  }

  const cashFlows = safeCashFlows(cfs);

  // ── LEVERED CASH FLOWS (equity perspective) ───────────────────────────────
  let leveredIrrPct = null, leveredNpvCr = null;
  if (debtLTV > 0 && debtDrawnCr > 0) {
    const levCfs = [...cfs];
    // During construction: debt covers debtLTV portion of hard costs
    for (let q = 0; q < constDurQ; q++) {
      const cfIdx = constStartQ + q + 1;
      if (cfIdx <= totalQ) levCfs[cfIdx] += hardCostCr * cweights[q] * debtLTV; // debt draw reduces equity out
    }
    // Repay debt + capitalized interest at end
    const totalRepayment = debtDrawnCr + debtInterestCr;
    levCfs[totalQ] -= totalRepayment;

    const leveredCashFlows = safeCashFlows(levCfs);
    try { leveredIrrPct = calculateIRR(leveredCashFlows); } catch { /* skip */ }
    try { leveredNpvCr  = calculateNPV(leveredCashFlows, discountRatePct / 100); } catch { /* skip */ }
  }

  let irrPct = null, npvCr = null;
  try { irrPct = calculateIRR(cashFlows); } catch { /* skip */ }
  try { npvCr  = calculateNPV(cashFlows, discountRatePct / 100); } catch { /* skip */ }

  const sensitivity = skipSensitivity
    ? null
    : buildResidentialSensitivity({
        ...input,
        constructionCostPerSqft: constructionCostSqft,
        sellingRatePerSqft: sellingRateSqft,
      });

  const outputTimeline = buildTimeline(timeline);

  return {
    assetClass: 'residential_apartments',
    inputs: {
      plotAreaSqft, fsi, loadingFactor, constructionCostPerSqft: constructionCostSqft,
      sellingRatePerSqft: sellingRateSqft, landCostCr, approvalCostCr,
      approvalCostPerSqft: Number(input.approvalCostPerSqft) || null,
      gstPct: round2(gstRateInput * 100),
      marketingCostPct, financeCostPct, developerMarginPct,
      effectiveDate: outputTimeline.effectiveDate,
      projectDurationYears: outputTimeline.projectDurationYears,
      projectDurationMonths: durationMonths,
      discountRatePct, pricingEscalationPct,
      constructionStartYears: outputTimeline.constructionStartYears,
      constructionStartMonths,
      constructionEndYears: outputTimeline.constructionEndYears,
      constructionEndMonths,
      contingencyPct, architectFeePct, pmcFeePct, debtLTV, debtRatePct,
      debtTenorYears: Number(input.debtTenorYears) > 0 ? Number(input.debtTenorYears) : null,
      avgUnitSizeSqft,
    },
    kpis: {
      irr:           round4(irrPct),
      npv:           round4(npvCr),
      equityMultiple: round4(equityMultiple),
      rlv:           round4(rlvCr),
      grossMarginPct: round4(grossMarginPct),
      leveredIrr:    round4(leveredIrrPct),
      leveredNpv:    round4(leveredNpvCr),
      // Per-unit metrics
      costPerSqft:     saleableAreaSqft > 0 ? round2((totalCostCr * 1e7) / saleableAreaSqft) : null,
      revenuePerSqft:  saleableAreaSqft > 0 ? round2((totalRevenueCr * 1e7) / saleableAreaSqft) : null,
      profitPerSqft:   saleableAreaSqft > 0 ? round2((grossProfitCr * 1e7) / saleableAreaSqft) : null,
      landCostPerSqft: plotAreaSqft > 0 ? round2((landCostCr * 1e7) / plotAreaSqft) : null,
      moic:            equityInvestedCr > 0 ? round4((equityInvestedCr + grossProfitCr) / equityInvestedCr) : null,
      // Project DSCR = sellout proceeds ÷ total debt service (principal + interest).
      // >1.0x means sales cover the debt with margin; <1.0x means shortfall at maturity.
      dscr: debtLTV > 0 && (debtDrawnCr + debtInterestCr) > 0
              ? round4(totalRevenueCr / (debtDrawnCr + debtInterestCr))
              : null,
      noi: null, yieldOnCost: null, exitValue: null, entryValue: null,
    },
    areas: {
      grossBuiltUp: round2(grossAreaSqft),
      saleable:     round2(saleableAreaSqft),
      carpet:       round2(carpetAreaSqft),
      superBuiltUp: round2(superBuiltupSqft),
      leasable:     null,
      numberOfUnits,
      avgUnitSizeSqft,
    },
    costs: {
      land:               round4(landCostCr),
      construction:       round4(constructionCostCr),
      gst:                round4(gstCostCr),
      contingency:        round4(contingencyCr),
      stampDuty:          round4(stampDutyCr),
      approval:           round4(approvalCostCr),
      architecture:       round4(architectCr),
      pmc:                round4(pmcCr),
      marketing:          round4(marketingCostCr),
      finance:            round4(financeCostCr),
      hardCostTotal:      round4(hardCostCr + stampDutyCr + landCostCr),
      softCostTotal:      round4(softCostCr),
      total:              round4(totalCostCr),
      tenantImprovements: null,
      leasingCommissions: null,
    },
    revenue: {
      totalRevenueCr:  round4(totalRevenueCr),
      grossProfitCr:   round4(grossProfitCr),
      grossMarginPct:  round4(grossMarginPct),
      annualNOI:       null,
      stabilizedNOI:   null,
      exitValue:       null,
    },
    capitalStack: debtLTV > 0 ? {
      totalCostCr:     round4(totalCostCr),
      debtCr:          round4(debtDrawnCr),
      equityCr:        round4(totalCostCr - debtDrawnCr),
      debtPct:         round2(debtLTV * 100),
      equityPct:       round2((1 - debtLTV) * 100),
      debtInterestCr:  round4(debtInterestCr),
      debtLTV,
      debtRatePct,
      debtTenorYears:  Number(input.debtTenorYears) > 0 ? Number(input.debtTenorYears) : null,
    } : null,
    timeline: outputTimeline,
    cashFlows: structureCashFlows(cashFlows, outputTimeline),
    sensitivityMatrix: sensitivity,
    _legacy: {
      plot_area_sqft: plotAreaSqft, fsi, loading_factor: loadingFactor,
      construction_cost_per_sqft: constructionCostSqft, selling_rate_per_sqft: sellingRateSqft,
      land_cost_cr: landCostCr, approval_cost_cr: approvalCostCr,
      marketing_cost_pct: marketingCostPct, finance_cost_pct: financeCostPct,
      developer_margin_pct: developerMarginPct, project_duration_months: durationMonths,
      gross_area_sqft: round2(grossAreaSqft), saleable_area_sqft: round2(saleableAreaSqft),
      carpet_area_sqft: round2(carpetAreaSqft), super_builtup_area_sqft: round2(superBuiltupSqft),
      total_construction_cost_cr: round4(constructionCostCr), gst_cost_cr: round4(gstCostCr),
      stamp_duty_cr: round4(stampDutyCr), marketing_cost_cr: round4(marketingCostCr),
      finance_cost_cr: round4(financeCostCr), total_cost_cr: round4(totalCostCr),
      total_revenue_cr: round4(totalRevenueCr), gross_profit_cr: round4(grossProfitCr),
      gross_margin_pct: round4(grossMarginPct),
      developer_profit_cr: round4(totalRevenueCr * developerMarginPct / 100),
      npv_cr: round4(npvCr), irr_pct: round4(irrPct),
      residual_land_value_cr: round4(rlvCr), equity_multiple: round4(equityMultiple),
      discount_rate_pct: discountRatePct,
      avg_unit_size_sqft: avgUnitSizeSqft,
      number_of_units: numberOfUnits,
    },
  };
}

// ─── PLOTTED DEVELOPMENT ─────────────────────────────────────────────────────

function calculatePlottedDevelopment(input) {
  const skipSensitivity = input.skipSensitivity === true;
  const totalLandSqft      = Number(input.totalLandSqft);
  const saleableLandPct    = Number(input.saleableLandPct) || 55;
  const avgPlotSizeSqft    = Number(input.avgPlotSizeSqft) || 1200;
  // Accept INR/sqft only (unit is sqft everywhere in REDIP)
  // Legacy: if sellingRatePerSqyd was stored convert it (1 sqyd = 9 sqft → sqft rate = sqyd rate / 9)
  const sellingRatePerSqft = Number(input.sellingRatePerSqft) > 0
    ? Number(input.sellingRatePerSqft)
    : Number(input.sellingRatePerSqyd) > 0
      ? Number(input.sellingRatePerSqyd) / 9  // legacy conversion
      : 0;
  const landCostCr         = Number(input.landCostCr) || 0;
  const devCostPerSqft     = Number(input.devCostPerSqft) || 250;
  const marketingCostPct   = Number(input.marketingCostPct) || 4;
  const financeCostPct     = Number(input.financeCostPct) > 0
    ? Number(input.financeCostPct)
    : (Number(input.debtRatePct) > 0 ? Number(input.debtRatePct) : 12);
  const discountRatePct    = Number(input.discountRatePct) || 14;
  const contingencyPct     = Number(input.contingencyPct) || 3;
  const debtLTV            = resolveDebtRatio(input.debtLTV, 0);
  const debtRatePct        = Number(input.debtRatePct) || 13;
  const timeline = resolveTimelineInput(input, {
    defaultDurationYears: 2,
    defaultConstructionStartYears: 0,
    defaultConstructionEndRatio: 0.70,
  });
  const durationMonths = timeline.projectDurationMonths;

  if (totalLandSqft <= 0)      throw new Error('Total land area must be positive');
  if (sellingRatePerSqft <= 0) throw new Error('Selling rate must be positive');
  if (avgPlotSizeSqft <= 0)    throw new Error('Average plot size must be positive');
  if (timeline.projectDurationYears < MIN_PROJECT_DURATION_YEARS || timeline.projectDurationYears > MAX_PROJECT_DURATION_YEARS) {
    throw new Error(`Project duration must be between ${MIN_PROJECT_DURATION_YEARS} and ${MAX_PROJECT_DURATION_YEARS} years`);
  }

  // Approval cost: ₹/sqft of total land OR legacy Cr
  const approvalCostCr = Number(input.approvalCostPerSqft) > 0
    ? (totalLandSqft * Number(input.approvalCostPerSqft)) / 1e7
    : Number(input.approvalCostCr) || 0;

  const saleableLandSqft = totalLandSqft * (saleableLandPct / 100);
  const totalPlots       = Math.floor(saleableLandSqft / avgPlotSizeSqft);

  // Revenue computed in sqft throughout — no sqyd conversion needed
  const totalRevenueCr   = (totalPlots * avgPlotSizeSqft * sellingRatePerSqft) / 1e7;
  const stampDutyCr      = landCostCr * STAMP_DUTY_RATE;
  const devCostCr        = (totalLandSqft * devCostPerSqft) / 1e7;
  const gstRateInput     = resolveGstRate(input, 'plotted_development');
  const gstCostCr        = devCostCr * gstRateInput;
  const contingencyCr    = devCostCr * (contingencyPct / 100);
  const marketingCostCr  = totalRevenueCr * (marketingCostPct / 100);
  // Finance cost: actual accrual on outstanding balance each quarter.
  //   Land is funded at Q0 and carried until exit; dev costs draw via S-curve over ~70% of duration.
  const totalQPlotted     = Math.ceil(durationMonths / 3);
  const plottedDevEndQ    = Math.max(2, Math.ceil((durationMonths * 0.70) / 3));
  const debtTenorMonthsPlot = Number(input.debtTenorYears) > 0
    ? Number(input.debtTenorYears) * 12
    : Math.min(durationMonths, durationMonths * 0.70 + 3);
  const carryQPlot        = Math.min(totalQPlotted, Math.ceil(debtTenorMonthsPlot / 3));
  const qFinRatePlot      = Math.pow(1 + financeCostPct / 100, 0.25) - 1;
  const landFinPlotCr     = landCostCr > 0 && carryQPlot > 0
    ? landCostCr * (Math.pow(1 + qFinRatePlot, carryQPlot) - 1)
    : 0;
  const plottedSchedule = buildDrawSchedule({
    principalCr: devCostCr,
    annualRatePct: financeCostPct,
    totalQuarters: carryQPlot,
    drawStartQ: 1,
    drawEndQ: Math.min(plottedDevEndQ, carryQPlot),
    capitalizeInterest: true,
  });
  const devFinPlotCr    = plottedSchedule.totalInterestCr;
  const financeCostCr   = landFinPlotCr + devFinPlotCr;
  const totalCostCr     = landCostCr + devCostCr + gstCostCr + stampDutyCr +
                          contingencyCr + approvalCostCr + marketingCostCr + financeCostCr;

  const grossProfitCr  = totalRevenueCr - totalCostCr;
  const grossMarginPct = totalRevenueCr > 0 ? (grossProfitCr / totalRevenueCr) * 100 : 0;
  const equityMultiple = totalCostCr > 0 ? (totalCostCr + grossProfitCr) / totalCostCr : null;
  const rlvCr          = (totalRevenueCr - devCostCr - gstCostCr - contingencyCr - approvalCostCr - marketingCostCr - financeCostCr) / 1.20;

  const totalQ  = Math.ceil(durationMonths / 3);
  const cfs     = new Array(totalQ + 1).fill(0);

  cfs[0] -= landCostCr + stampDutyCr + approvalCostCr * 0.25;
  if (totalQ >= 2) { cfs[1] -= approvalCostCr * 0.375; }
  if (totalQ >= 3) { cfs[2] -= approvalCostCr * 0.375; }

  const devQ     = Math.max(2, Math.ceil(durationMonths * 0.70 / 3));
  const dweights = sCurveWeights(devQ);
  for (let q = 0; q < devQ && q + 1 <= totalQ; q++) {
    cfs[q + 1] -= (devCostCr + gstCostCr + contingencyCr) * dweights[q];
  }

  const mktDur = Math.max(1, totalQ - 2);
  for (let q = 2; q <= totalQ; q++) cfs[q] -= marketingCostCr / mktDur;

  // Revenue: plotted front-loaded (launch bookings heavy)
  const rweights = Array.from({ length: totalQ }, (_, q) => {
    const p = (q + 1) / totalQ;
    return Math.max(0.06, Math.exp(-4 * (p - 0.35) ** 2) + 0.10);
  });
  const rtotal = rweights.reduce((a, b) => a + b, 0);
  for (let q = 0; q < totalQ; q++) cfs[q + 1] += totalRevenueCr * (rweights[q] / rtotal);

  if (financeCostCr > 0 && totalQ >= 1) {
    const qFinRateCF = Math.pow(1 + financeCostPct / 100, 0.25) - 1;
    for (let q = 1; q <= totalQ; q++) {
      const landQ = landCostCr * qFinRateCF;
      const devQ  = plottedSchedule.interest[q] || 0;
      cfs[q] -= landQ + devQ;
    }
  }

  const cashFlows = safeCashFlows(cfs);
  let irrPct = null, npvCr = null;
  try { irrPct = calculateIRR(cashFlows); } catch { /* skip */ }
  try { npvCr  = calculateNPV(cashFlows, discountRatePct / 100); } catch { /* skip */ }

  // ── LEVERED CASH FLOWS (equity perspective) ───────────────────────────────
  const debtableBasePlotCr = landCostCr + devCostCr + gstCostCr + contingencyCr + approvalCostCr;
  const debtDrawnCrPlot    = debtableBasePlotCr * debtLTV;
  const debtInterestCrPlot = debtLTV > 0
    ? debtDrawnCrPlot * (debtRatePct / 100) * (durationMonths / 12) * 0.55  // ~55% avg-balance factor across S-curve draw
    : 0;
  let leveredIrrPct = null, leveredNpvCr = null;
  if (debtLTV > 0 && debtDrawnCrPlot > 0) {
    const levCfs = [...cfs];
    levCfs[0] += landCostCr * debtLTV;                // land debt draw at Q0
    for (let q = 0; q < devQ && q + 1 <= totalQ; q++) {
      levCfs[q + 1] += (devCostCr + gstCostCr + contingencyCr) * dweights[q] * debtLTV;
    }
    levCfs[0] += approvalCostCr * 0.25 * debtLTV;
    if (totalQ >= 2) levCfs[1] += approvalCostCr * 0.375 * debtLTV;
    if (totalQ >= 3) levCfs[2] += approvalCostCr * 0.375 * debtLTV;
    levCfs[totalQ] -= debtDrawnCrPlot + debtInterestCrPlot;
    const leveredCashFlows = safeCashFlows(levCfs);
    try { leveredIrrPct = calculateIRR(leveredCashFlows); } catch { /* skip */ }
    try { leveredNpvCr  = calculateNPV(leveredCashFlows, discountRatePct / 100); } catch { /* skip */ }
  }

  const outputTimeline = buildTimeline(timeline);

  return {
    assetClass: 'plotted_development',
    inputs: {
      totalLandSqft, saleableLandPct, avgPlotSizeSqft, sellingRatePerSqft,
      landCostCr, devCostPerSqft, approvalCostCr,
      approvalCostPerSqft: Number(input.approvalCostPerSqft) || null,
      gstPct: round2(gstRateInput * 100),
      marketingCostPct, financeCostPct,
      effectiveDate: outputTimeline.effectiveDate,
      projectDurationYears: outputTimeline.projectDurationYears,
      projectDurationMonths: durationMonths,
      discountRatePct,
      contingencyPct,
      debtLTV, debtRatePct,
      debtTenorYears: Number(input.debtTenorYears) > 0 ? Number(input.debtTenorYears) : null,
    },
    kpis: {
      irr: round4(irrPct), npv: round4(npvCr),
      equityMultiple: round4(equityMultiple), rlv: round4(rlvCr),
      grossMarginPct: round4(grossMarginPct),
      leveredIrr: round4(leveredIrrPct), leveredNpv: round4(leveredNpvCr),
      // Per-plot / per-sqft metrics
      revenuePerPlot: totalPlots > 0 ? round2((totalRevenueCr * 1e7) / totalPlots) : null,
      costPerPlot:    totalPlots > 0 ? round2((totalCostCr * 1e7) / totalPlots) : null,
      profitPerPlot:  totalPlots > 0 ? round2((grossProfitCr * 1e7) / totalPlots) : null,
      landCostPerSqft: totalLandSqft > 0 ? round2((landCostCr * 1e7) / totalLandSqft) : null,
      revenuePerSqft:  saleableLandSqft > 0 ? round2((totalRevenueCr * 1e7) / saleableLandSqft) : null,
      dscr: debtLTV > 0 && (debtDrawnCrPlot + debtInterestCrPlot) > 0
              ? round4(totalRevenueCr / (debtDrawnCrPlot + debtInterestCrPlot))
              : null,
      noi: null, yieldOnCost: null, exitValue: null, entryValue: null,
    },
    areas: {
      grossBuiltUp: round2(totalLandSqft),
      saleable:     round2(saleableLandSqft),
      carpet: null, superBuiltUp: null, leasable: null,
      totalPlots,
      avgPlotSizeSqft: round2(avgPlotSizeSqft),
    },
    costs: {
      land:           round4(landCostCr),
      construction:   round4(devCostCr),
      gst:            round4(gstCostCr),
      contingency:    round4(contingencyCr),
      stampDuty:      round4(stampDutyCr),
      approval:       round4(approvalCostCr),
      architecture:   null,
      pmc:            null,
      marketing:      round4(marketingCostCr),
      finance:        round4(financeCostCr),
      hardCostTotal:  round4(landCostCr + stampDutyCr + devCostCr + gstCostCr + contingencyCr),
      softCostTotal:  round4(approvalCostCr + marketingCostCr + financeCostCr),
      total:          round4(totalCostCr),
      tenantImprovements: null, leasingCommissions: null,
    },
    revenue: {
      totalRevenueCr: round4(totalRevenueCr),
      grossProfitCr:  round4(grossProfitCr),
      grossMarginPct: round4(grossMarginPct),
      annualNOI: null, stabilizedNOI: null, exitValue: null,
    },
    capitalStack: debtLTV > 0 ? {
      totalCostCr:    round4(totalCostCr),
      debtCr:         round4(debtDrawnCrPlot),
      equityCr:       round4(totalCostCr - debtDrawnCrPlot),
      debtPct:        round2(debtLTV * 100),
      equityPct:      round2((1 - debtLTV) * 100),
      debtInterestCr: round4(debtInterestCrPlot),
      debtLTV,
      debtRatePct,
      debtTenorYears: Number(input.debtTenorYears) > 0 ? Number(input.debtTenorYears) : null,
    } : null,
    timeline: outputTimeline,
    cashFlows: structureCashFlows(cashFlows, outputTimeline),
    sensitivityMatrix: skipSensitivity
      ? null
      : buildPlottedSensitivity({
          ...input,
          sellingRatePerSqft,
          devCostPerSqft,
        }),
    _legacy: {
      plot_area_sqft: totalLandSqft, fsi: 1, loading_factor: saleableLandPct / 100,
      land_cost_cr: landCostCr, approval_cost_cr: approvalCostCr,
      marketing_cost_pct: marketingCostPct, finance_cost_pct: financeCostPct,
      total_cost_cr: round4(totalCostCr), total_revenue_cr: round4(totalRevenueCr),
      gross_profit_cr: round4(grossProfitCr), gross_margin_pct: round4(grossMarginPct),
      npv_cr: round4(npvCr), irr_pct: round4(irrPct),
      residual_land_value_cr: round4(rlvCr), equity_multiple: round4(equityMultiple),
      project_duration_months: durationMonths, discount_rate_pct: discountRatePct,
    },
  };
}

// ─── INCOME-PRODUCING ASSETS (Office / Retail / Industrial) ──────────────────

function calculateIncomeAsset(input) {
  const assetClass           = input.assetClass;
  const leasableAreaSqft     = Number(input.leasableAreaSqft);
  const constructionCostSqft = Number(input.constructionCostPerSqft);
  const landCostCr           = Number(input.landCostCr) || 0;
  const approvalCostCr       = Number(input.approvalCostPerSqft) > 0
    ? (leasableAreaSqft * Number(input.approvalCostPerSqft)) / 1e7
    : Number(input.approvalCostCr) || 0;
  const baseRentMonth        = Number(input.baseRentPerSqftMonth);
  const rentEscalationPct    = Number(input.rentEscalationPct) || 5;
  const vacancyPct           = Number(input.vacancyPct) || 10;
  const opexPct              = Number(input.opexPct) || 20;
  const tiPerSqft            = Number(input.tiPerSqft) || 0;
  const lcMonths             = Number(input.lcMonths) || 0;
  const exitCapRate          = Number(input.exitCapRate) || 7;
  const entryCapRate         = Number(input.entryCapRate) || exitCapRate;
  const holdPeriodYears      = Number(input.holdPeriodYears) || 5;
  const discountRatePct      = Number(input.discountRatePct) || 14;
  const debtCoverage         = resolveDebtRatio(input.debtCoverage, 0);
  const interestRatePct      = Number(input.interestRatePct) || 10;
  const amortizationYears    = Math.max(5, Math.min(30, Number(input.amortizationYears) || 20));
  const contingencyPct         = Number(input.contingencyPct) || 4;
  const exitStrategy           = resolveExitStrategy(input.exitStrategy);
  const lrdLTV                 = resolveDebtRatio(input.lrdLTV, 0.65);
  const lrdInterestRatePct     = Number(input.lrdInterestRatePct) || 9;
  const maxRefinanceYear       = Math.max(1, holdPeriodYears - 1);
  const lrdRefinanceYear       = Number(input.lrdRefinanceYear) > 0
    ? Math.min(Number(input.lrdRefinanceYear), maxRefinanceYear)
    : Math.max(1, Math.floor(holdPeriodYears / 2));
  const forwardPurchasePriceCr = Number(input.forwardPurchasePriceCr) || 0;
  const exitMultipleInput      = Number(input.exitMultiple) || 0;
  const perpetuityGrowthPct    = Number(input.perpetuityGrowthPct);
  const terminalValueMethod    = resolveTerminalValueMethod(input.terminalValueMethod, {
    exitStrategy: resolveExitStrategy(input.exitStrategy),
    forwardPurchasePriceCr,
  });
  const timeline = resolveTimelineInput(input, {
    defaultDurationYears: 3,
    defaultConstructionStartYears: 0,
    defaultConstructionEndRatio: 1,
  });
  const constructionMonths = timeline.projectDurationMonths;

  // Retail-specific anchor blended rent
  const anchorPct          = assetClass === 'retail' ? (Number(input.anchorPct) || 40) : 0;
  const anchorRentDiscount = assetClass === 'retail' ? (Number(input.anchorRentDiscount) || 20) : 0;
  const blendedRentFactor  = assetClass === 'retail'
    ? (anchorPct / 100) * (1 - anchorRentDiscount / 100) + (1 - anchorPct / 100)
    : 1;
  const effectiveBaseRent  = baseRentMonth * blendedRentFactor;

  if (leasableAreaSqft <= 0)             throw new Error('Leasable area must be positive');
  if (constructionCostSqft <= 0)         throw new Error('Construction cost must be positive');
  if (baseRentMonth <= 0)                throw new Error('Base rent must be positive');
  if (exitCapRate <= 0 || exitCapRate > 30) throw new Error('Exit cap rate must be 0–30%');
  if (timeline.projectDurationYears < MIN_PROJECT_DURATION_YEARS || timeline.projectDurationYears > MAX_PROJECT_DURATION_YEARS) {
    throw new Error(`Project duration must be between ${MIN_PROJECT_DURATION_YEARS} and ${MAX_PROJECT_DURATION_YEARS} years`);
  }

  const constructionCostCr = (leasableAreaSqft * constructionCostSqft) / 1e7;
  const gstRateInput       = resolveGstRate(input, assetClass);
  const gstCostCr          = constructionCostCr * gstRateInput;
  const contingencyCr      = constructionCostCr * (contingencyPct / 100);
  const stampDutyCr        = landCostCr * STAMP_DUTY_RATE;
  const tiCostCr           = (leasableAreaSqft * tiPerSqft) / 1e7;
  const lcCostCr           = (leasableAreaSqft * effectiveBaseRent * lcMonths) / 1e7;
  const totalDevCostCr     = landCostCr + constructionCostCr + gstCostCr + stampDutyCr +
                             contingencyCr + approvalCostCr + tiCostCr + lcCostCr;

  // Operating model: PGI → EGI → NOI
  const grossRevY1Cr         = (leasableAreaSqft * effectiveBaseRent * 12) / 1e7;
  const effectiveGrossRevCr  = grossRevY1Cr * (1 - vacancyPct / 100);
  const opexCr               = effectiveGrossRevCr * (opexPct / 100);
  const stabilizedNOICr      = effectiveGrossRevCr - opexCr;

  const yieldOnCost  = totalDevCostCr > 0 ? (stabilizedNOICr / totalDevCostCr) * 100 : 0;
  const entryValueCr = stabilizedNOICr / (entryCapRate / 100);
  const noiAtExit              = stabilizedNOICr * Math.pow(1 + rentEscalationPct / 100, holdPeriodYears);
  const capRateTvCr            = noiAtExit / (exitCapRate / 100);

  const tv = computeTerminalValue({
    method: terminalValueMethod,
    stabilizedNOICr,
    noiAtExitCr: noiAtExit,
    exitCapRatePct: exitCapRate,
    exitMultiple: exitMultipleInput,
    perpetuityGrowthPct: Number.isFinite(perpetuityGrowthPct) ? perpetuityGrowthPct : 0,
    discountRatePct,
    forwardPurchasePriceCr,
    holdPeriodYears,
  });
  const exitValueCr          = capRateTvCr;  // Always retain cap-rate sale value for benchmarking
  const effectiveExitValueCr = tv.terminalValueCr;
  const terminalValuePVCr    = tv.terminalValuePVCr;

  const constQ = Math.ceil(constructionMonths / 3);
  const opQ    = holdPeriodYears * 4;
  const totalQ = constQ + opQ;
  const cfs    = new Array(totalQ + 1).fill(0);
  const lrdRefinanceQ  = exitStrategy === 'lrd' ? Math.min(constQ + lrdRefinanceYear * 4, totalQ) : 0;
  const lrdProceeds    = exitStrategy === 'lrd' ? lrdLTV * entryValueCr : 0;

  // ── Operating-phase amortizing debt schedule (term loan) ──────────────────
  // Principal sizes to debtCoverage × total dev cost; funded at construction
  // completion; amortizes over `amortizationYears` with quarterly P&I service;
  // balloon remaining balance at exit. For LRD, layer a separate refinance
  // tranche that amortizes from the refinance quarter.
  const termLoanPrincipalCr = debtCoverage > 0 ? totalDevCostCr * debtCoverage : 0;
  const termLoanSchedule = termLoanPrincipalCr > 0
    ? buildAmortizingSchedule({
        principalCr: termLoanPrincipalCr,
        annualRatePct: interestRatePct,
        amortizationYears,
        drawQ: constQ,
        operatingStartQ: constQ + 1,
        exitQ: totalQ,
        totalQuarters: totalQ,
      })
    : null;

  const lrdSchedule = (exitStrategy === 'lrd' && lrdProceeds > 0 && lrdRefinanceQ > 0)
    ? buildAmortizingSchedule({
        principalCr: lrdProceeds,
        annualRatePct: lrdInterestRatePct,
        amortizationYears,
        drawQ: lrdRefinanceQ,
        operatingStartQ: lrdRefinanceQ + 1,
        exitQ: totalQ,
        totalQuarters: totalQ,
      })
    : null;

  cfs[0] -= landCostCr + stampDutyCr + approvalCostCr * 0.25;
  if (constQ >= 2) { cfs[1] -= approvalCostCr * 0.375; cfs[2] -= approvalCostCr * 0.375; }

  const cweights = sCurveWeights(constQ);
  for (let q = 0; q < constQ && q + 1 <= totalQ; q++) {
    cfs[q + 1] -= (constructionCostCr + gstCostCr + contingencyCr) * cweights[q];
  }
  if (constQ >= 1) cfs[constQ] -= tiCostCr + lcCostCr;

  // Term loan proceeds at construction completion — reduce equity outflow.
  // Keeps unlevered NOI on the asset line; the amortizing service is added below.
  if (!input._phase1Mode && termLoanSchedule) {
    for (let q = 0; q <= totalQ; q++) {
      if (termLoanSchedule.draws[q] > 0) cfs[q] += termLoanSchedule.draws[q];
    }
  }
  if (!input._phase1Mode && lrdSchedule) {
    for (let q = 0; q <= totalQ; q++) {
      if (lrdSchedule.draws[q] > 0) cfs[q] += lrdSchedule.draws[q];
    }
  }

  // Operating phase with lease-up ramp + amortizing debt service
  for (let q = 1; q <= opQ; q++) {
    const yearIdx         = Math.ceil(q / 4);
    const occupancyFactor = q <= 2 ? 0.60 : q === 3 ? 0.80 : (1 - vacancyPct / 100);
    const rentEsc         = Math.pow(1 + rentEscalationPct / 100, yearIdx - 1);
    const qRent           = (leasableAreaSqft * effectiveBaseRent * 3 * rentEsc * occupancyFactor) / 1e7;
    const qNOI            = qRent * (1 - opexPct / 100);
    const cfIdx           = constQ + q;
    if (cfIdx <= totalQ) {
      cfs[cfIdx] += qNOI;
      if (!input._phase1Mode) {
        if (termLoanSchedule && termLoanSchedule.debtService[cfIdx] > 0) {
          cfs[cfIdx] -= termLoanSchedule.debtService[cfIdx];
        }
        if (lrdSchedule && lrdSchedule.debtService[cfIdx] > 0) {
          cfs[cfIdx] -= lrdSchedule.debtService[cfIdx];
        }
      }
    }
  }
  if (!input._phase1Mode) {
    // Exit value nets out any debt balloon that's still captured in the schedule
    // (buildAmortizingSchedule already booked the balloon at exitQ).
    cfs[totalQ] += effectiveExitValueCr;
  }
  const rawCFs = [...cfs];

  const cashFlows  = safeCashFlows(cfs);
  let irrPct = null, npvCr = null;
  try { irrPct = calculateIRR(cashFlows); } catch { /* skip */ }
  try { npvCr  = calculateNPV(cashFlows, discountRatePct / 100); } catch { /* skip */ }

  const totalReturns   = cashFlows.filter((c) => c > 0).reduce((a, b) => a + b, 0);
  const equityMultiple = totalDevCostCr > 0 ? totalReturns / totalDevCostCr : null;

  // DSCR from the actual amortizing schedule (stabilized NOI / annualized debt service)
  let dscr = null;
  if (termLoanSchedule && termLoanSchedule.quarterlyPayment > 0) {
    const annualDebtService = termLoanSchedule.quarterlyPayment * 4;
    dscr = round2(stabilizedNOICr / annualDebtService);
  }

  // Expose debt schedule rows for UI / audit (skip the huge raw arrays)
  const debtSchedule = (termLoanSchedule || lrdSchedule) ? {
    termLoan: termLoanSchedule ? {
      principalCr: round4(termLoanPrincipalCr),
      annualRatePct: interestRatePct,
      amortizationYears,
      quarterlyPaymentCr: round4(termLoanSchedule.quarterlyPayment),
      annualDebtServiceCr: round4(termLoanSchedule.quarterlyPayment * 4),
      totalInterestCr: round4(termLoanSchedule.totalInterestCr),
      balloonRepaymentCr: round4(termLoanSchedule.balloonRepaymentCr),
    } : null,
    lrd: lrdSchedule ? {
      principalCr: round4(lrdProceeds),
      annualRatePct: lrdInterestRatePct,
      amortizationYears,
      quarterlyPaymentCr: round4(lrdSchedule.quarterlyPayment),
      annualDebtServiceCr: round4(lrdSchedule.quarterlyPayment * 4),
      totalInterestCr: round4(lrdSchedule.totalInterestCr),
      balloonRepaymentCr: round4(lrdSchedule.balloonRepaymentCr),
      refinanceQuarter: lrdRefinanceQ,
    } : null,
  } : null;

  const sensitivity = buildIncomeSensitivity({
    leasableAreaSqft, constructionCostSqft, landCostCr, stampDutyCr,
    approvalCostCr, tiCostCr, lcCostCr, opexPct, holdPeriodYears,
    constructionMonths, discountRatePct, rentEscalationPct, vacancyPct,
    baseRentMonth: effectiveBaseRent, baseExitCapRate: exitCapRate,
  });

  const outputTimeline = buildTimeline({
    ...timeline,
    holdPeriodYears,
  });

  return {
    assetClass,
    inputs: {
      leasableAreaSqft, constructionCostPerSqft: constructionCostSqft, landCostCr, approvalCostCr,
      approvalCostPerSqft: Number(input.approvalCostPerSqft) || null,
      gstPct: round2(gstRateInput * 100),
      baseRentPerSqftMonth: baseRentMonth, rentEscalationPct, vacancyPct, opexPct,
      tiPerSqft, lcMonths, entryCapRate, exitCapRate, holdPeriodYears,
      effectiveDate: outputTimeline.effectiveDate,
      projectDurationYears: outputTimeline.projectDurationYears,
      projectDurationMonths: constructionMonths,
      discountRatePct, debtCoverage, interestRatePct, amortizationYears,
      exitStrategy,
      lrdLTV: exitStrategy === 'lrd' ? lrdLTV : null,
      lrdInterestRatePct: exitStrategy === 'lrd' ? lrdInterestRatePct : null,
      lrdRefinanceYear: exitStrategy === 'lrd' ? lrdRefinanceYear : null,
      forwardPurchasePriceCr: exitStrategy === 'forward_purchase' ? forwardPurchasePriceCr : null,
      terminalValueMethod,
      exitMultiple: terminalValueMethod === 'exit_multiple' ? round2(exitMultipleInput) : null,
      perpetuityGrowthPct: terminalValueMethod === 'perpetuity_growth'
        ? round2(Number.isFinite(perpetuityGrowthPct) ? perpetuityGrowthPct : 0)
        : null,
      contingencyPct,
      ...(assetClass === 'retail' ? { anchorPct, anchorRentDiscount } : {}),
    },
    kpis: {
      irr:           round4(irrPct),
      npv:           round4(npvCr),
      equityMultiple: round4(equityMultiple),
      rlv:           null,
      grossMarginPct: null,
      leveredIrr:    null,
      leveredNpv:    null,
      noi:           round4(stabilizedNOICr),
      noiAtExit:     round4(noiAtExit),
      yieldOnCost:   round4(yieldOnCost),
      dscr,
      exitValue:        round4(effectiveExitValueCr),     // Applied terminal value (back-compat)
      terminalValue:    round4(effectiveExitValueCr),
      terminalValuePV:  round4(terminalValuePVCr),
      terminalValueMethod,
      terminalValueFormula: tv.formula,
      capRateValuationCr: round4(exitValueCr),            // Always-computed cap-rate benchmark
      exitCapRate:   round4(exitCapRate),
      entryValue:    round4(entryValueCr),
      // Per-sqft and per-unit metrics
      devCostPerSqft: leasableAreaSqft > 0 ? round2((totalDevCostCr * 1e7) / leasableAreaSqft) : null,
      rentPerSqftAnnual: round2(effectiveBaseRent * 12),
      noiPerSqft:    leasableAreaSqft > 0 ? round2((stabilizedNOICr * 1e7) / leasableAreaSqft) : null,
      spreadOverCost: round4(yieldOnCost - (exitCapRate || 0)), // positive = value creation
      // Asset-class-specific KPIs
      ...(assetClass === 'industrial_warehousing' ? {
        warehouseEfficiency: round2(leasableAreaSqft / (leasableAreaSqft / 0.85) * 100),
      } : {}),
      ...(assetClass === 'retail' ? {
        blendedRentFactor: round4(blendedRentFactor),
        anchorRentDiscount: round2(anchorRentDiscount),
      } : {}),
    },
    areas: {
      leasable:    round2(leasableAreaSqft),
      grossBuiltUp: round2(leasableAreaSqft / 0.85),
      saleable: null, carpet: null, superBuiltUp: null,
    },
    costs: {
      land:               round4(landCostCr),
      construction:       round4(constructionCostCr),
      gst:                round4(gstCostCr),
      contingency:        round4(contingencyCr),
      stampDuty:          round4(stampDutyCr),
      approval:           round4(approvalCostCr),
      architecture:       null,
      pmc:                null,
      marketing:          null,
      finance:            null,
      hardCostTotal:      round4(landCostCr + stampDutyCr + constructionCostCr + gstCostCr + contingencyCr),
      softCostTotal:      round4(approvalCostCr + tiCostCr + lcCostCr),
      total:              round4(totalDevCostCr),
      tenantImprovements: round4(tiCostCr),
      leasingCommissions: round4(lcCostCr),
    },
    revenue: {
      totalRevenueCr:   null,
      grossProfitCr:    null,
      grossMarginPct:   null,
      annualNOI:        round4(stabilizedNOICr),
      stabilizedNOI:    round4(stabilizedNOICr),
      noiAtExit:        round4(noiAtExit),
      exitValue:        round4(effectiveExitValueCr),
      terminalValue:    round4(effectiveExitValueCr),
      terminalValuePV:  round4(terminalValuePVCr),
      terminalValueMethod,
      terminalValueFormula: tv.formula,
      capRateValuationCr: round4(exitValueCr),
      grossFirstYearRent: round4(grossRevY1Cr),
      effectiveGrossRev: round4(effectiveGrossRevCr),
      opex:             round4(opexCr),
    },
    capitalStack: debtCoverage > 0 ? {
      totalCostCr: round4(totalDevCostCr),
      debtCr:      round4(totalDevCostCr * debtCoverage),
      equityCr:    round4(totalDevCostCr * (1 - debtCoverage)),
      debtPct:     round2(debtCoverage * 100),
      equityPct:   round2((1 - debtCoverage) * 100),
      interestRatePct,
      amortizationYears,
      dscr,
      debtSchedule,
    } : null,
    timeline: outputTimeline,
    cashFlows: structureCashFlows(cashFlows, outputTimeline),
    sensitivityMatrix: sensitivity,
    _legacy: {
      land_cost_cr: landCostCr,
      total_cost_cr: round4(totalDevCostCr),
      total_revenue_cr: round4(effectiveExitValueCr),
      gross_profit_cr: round4(effectiveExitValueCr - totalDevCostCr),
      gross_margin_pct: totalDevCostCr > 0 && effectiveExitValueCr > 0
        ? round4((effectiveExitValueCr - totalDevCostCr) / effectiveExitValueCr * 100) : null,
      npv_cr: round4(npvCr), irr_pct: round4(irrPct),
      equity_multiple: round4(equityMultiple),
      project_duration_months: constQ * 3,
      discount_rate_pct: discountRatePct,
    },
  };
}

// ─── SENSITIVITY MATRICES ────────────────────────────────────────────────────

function buildResidentialSensitivity(p) {
  const vars = [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20];
  const baseSelling      = Number(p.sellingRatePerSqft);
  const baseConstruction = Number(p.constructionCostPerSqft);
  const sellingRates      = vars.map((v) => Math.round(baseSelling * (1 + v)));
  const constructionCosts = vars.map((v) => Math.round(baseConstruction * (1 + v)));
  const irrGrid = constructionCosts.map((cc) =>
    sellingRates.map((sr) => {
      try {
        const r = calculateResidentialApartments({
          ...p,
          constructionCostPerSqft: cc,
          sellingRatePerSqft: sr,
          skipSensitivity: true,
        });
        return r.kpis.irr;
      } catch { return null; }
    })
  );
  return {
    sellingRates, constructionCosts, irrGrid,
    axis: ['Constr. Cost/sqft', 'Selling Rate/sqft'],
    variations: vars.map((v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`),
  };
}

function buildPlottedSensitivity(p) {
  const vars = [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20];
  const baseSelling = Number(p.sellingRatePerSqft);
  const baseDev     = Number(p.devCostPerSqft);
  const sellingRates = vars.map((v) => Math.round(baseSelling * (1 + v)));
  const devCosts     = vars.map((v) => Math.round(baseDev * (1 + v)));
  const irrGrid = devCosts.map((dc) =>
    sellingRates.map((sr) => {
      try {
        const r = calculatePlottedDevelopment({
          ...p,
          sellingRatePerSqft: sr,
          devCostPerSqft: dc,
          skipSensitivity: true,
        });
        return r.kpis.irr;
      } catch { return null; }
    })
  );
  return {
    sellingRates, constructionCosts: devCosts, irrGrid,
    axis: ['Dev. Cost/sqft', 'Selling Rate/sqft'],
    variations: vars.map((v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`),
  };
}

function buildIncomeSensitivity(p) {
  const rentVars = [-0.20, -0.10, 0, 0.10, 0.20];
  const capVars  = [5, 6, 7, 8, 9];
  const rents    = rentVars.map((v) => Math.round(p.baseRentMonth * (1 + v) * 100) / 100);
  const capRates = capVars;
  const irrGrid  = capRates.map((cap) =>
    rents.map((rent) => {
      try {
        return calculateIRR(buildIncomeQuickCFs({ ...p, baseRentMonth: rent, exitCapRate: cap }));
      } catch { return null; }
    })
  );
  return {
    sellingRates: rents, constructionCosts: capRates, irrGrid,
    axis: ['Exit Cap Rate (%)', 'Base Rent/sqft/mo'],
    variations: capVars.map((c) => `${c}%`),
  };
}

function buildIncomeQuickCFs(p) {
  const {
    leasableAreaSqft, baseRentMonth, exitCapRate, rentEscalationPct = 5,
    vacancyPct = 10, opexPct = 20, holdPeriodYears = 5,
    constructionMonths = 36, constructionCostSqft, landCostCr,
    stampDutyCr = 0, approvalCostCr = 0, tiCostCr = 0, lcCostCr = 0,
  } = p;
  const constQ     = Math.ceil(constructionMonths / 3);
  const opQ        = holdPeriodYears * 4;
  const totalQ     = constQ + opQ;
  const cfs        = new Array(totalQ + 1).fill(0);
  const totalCost  = landCostCr + (leasableAreaSqft * constructionCostSqft) / 1e7 +
                     stampDutyCr + approvalCostCr + (tiCostCr || 0) + (lcCostCr || 0);
  cfs[0] = -totalCost;
  for (let q = 1; q <= opQ; q++) {
    const yearIdx = Math.ceil(q / 4);
    const occ     = q <= 2 ? 0.70 : (1 - vacancyPct / 100);
    const esc     = Math.pow(1 + rentEscalationPct / 100, yearIdx - 1);
    const qNOI    = (leasableAreaSqft * baseRentMonth * 3 * esc * occ * (1 - opexPct / 100)) / 1e7;
    if (constQ + q <= totalQ) cfs[constQ + q] += qNOI;
  }
  const noiExit = (leasableAreaSqft * baseRentMonth * 12 * (1 - vacancyPct / 100) * (1 - opexPct / 100)) /
                  1e7 * Math.pow(1 + rentEscalationPct / 100, holdPeriodYears);
  cfs[totalQ] += noiExit / (exitCapRate / 100);
  return safeCashFlows(cfs);
}

// ─── HOSPITALITY (USALI 11e, India / Bangalore) ──────────────────────────────
// Hotel underwriting adapted for Karnataka. Full USALI P&L with departmental,
// undistributed and fixed operating lines, India-specific Sources & Uses,
// construction loan → permanent refi capital stack, and LP/GP waterfall.
// Deterministic — see CLAUDE.md.
//
// Benchmarks referenced (2025-26, Bengaluru 5-star / upscale full service):
//  • Stamp + reg = 5.0 + 1.0 + cess/surcharge ≈ 6.6% (Karnataka urban)
//  • GST on hospitality construction = 18%
//  • Key BUA: 450–600 sqft (includes lobby / MEP / BOH / corridors)
//  • Hard cost: ₹9 000–14 000 / sqft
//  • FF&E:  ₹20–35 lakh / key   OS&E: ₹3–5 lakh / key
//  • Pre-opening: ₹3–5 lakh / key; Working cap: ₹0.5 lakh / key
//  • Mgmt fee: base 2.5–3.5 % of rev + incentive 8–10 % of GOP
//  • Brand: royalty 4–6 % of rooms + res/mkt 1.5–2.5 %
//  • Property tax (BBMP) 1.5–2.5 % of rev; Insurance 0.8–1.2 % of rev
//  • FF&E reserve: 3–4 % of total revenue (USALI)
// Sources: HVS India, JLL HotelIntel 2025, CBRE / Knight Frank Bangalore reports,
//          BBMP property tax circular 2024, RERA-K listings, Marriott / IHG HMAs.

const HOSP_DEFAULT_SQFT_PER_KEY = 550;
const HOSP_DAYS_PER_YEAR = 365;

function calculateHospitality(input) {
  // ─── 1. Read inputs ────────────────────────────────────────────────────────
  const keys                 = Math.round(Number(input.keys) || 200);
  const sqftPerKey           = Number(input.sqftPerKey) || HOSP_DEFAULT_SQFT_PER_KEY;
  const totalBuaSqft         = keys * sqftPerKey;

  const landCostCr           = Number(input.landCostCr) || 0;
  const stampRegPctInput     = Number(input.stampRegPct);
  const stampRegPct          = stampRegPctInput > 0 ? stampRegPctInput / 100 : KARNATAKA_STAMP_REG_RATE;
  const bettermentPct        = Number(input.bettermentPct) || 3;

  // Key mix — owner-rate (contracted / guaranteed-occ) + market-rate
  const ownerRateKeys        = Math.min(keys, Math.max(0, Math.round(Number(input.ownerRateKeys) || 0)));
  const marketRateKeys       = Math.max(0, keys - ownerRateKeys);
  const ownerRateADR         = Number(input.ownerRateADR) || 0;
  const ownerRateGuaranteedOcc = Math.min(1, Math.max(0, (Number(input.ownerRateGuaranteedOccPct) || 0) / 100));

  const adr                  = Number(input.adr) || 8500;
  const adrGrowthPct         = Number(input.adrGrowthPct) || 5;
  const stabilizedOccPct     = Number(input.stabilizedOccPct) || 70;
  const initialOccPct        = Number(input.initialOccPct) || 45;
  const stabilizationYear    = Math.max(2, Math.min(6, Number(input.stabilizationYear) || 4));
  const holdPeriodYears      = Math.max(5, Math.min(15, Number(input.holdPeriodYears) || 10));

  // Non-room revenue drivers (% of rooms revenue)
  const fbRestaurantPctRooms = Number(input.fbRestaurantPctOfRooms) || 18;
  const fbBanquetPctRooms    = Number(input.fbBanquetPctOfRooms) || 12;
  const otherOperatedPctRooms = Number(input.otherOperatedPctOfRooms) || 7;
  const parkingPctRooms      = Number(input.parkingPctOfRooms) || 2;
  const leaseIncomeCrPa      = Number(input.leaseIncomeCrPa) || 0;

  // USALI departmental expense ratios
  const roomsDeptCostPct     = Number(input.roomsDeptCostPct) || 28;
  const fbDeptCostPct        = Number(input.fbDeptCostPct) || 75;
  const otherDeptCostPct     = Number(input.otherDeptCostPct) || 52;

  // USALI undistributed expenses (% of total revenue)
  const aAndGPct             = Number(input.aAndGPct) || 7.5;
  const itPct                = Number(input.itPct) || 2.0;
  const smPct                = Number(input.smPct) || 5.5;
  const pomPct               = Number(input.pomPct) || 4.5;
  const utilitiesPct         = Number(input.utilitiesPct) || 5.0;

  // Management fee
  const mgmtBasePct          = Number(input.mgmtBasePct) || 3.0;
  const mgmtIncentivePct     = Number(input.mgmtIncentivePct) || 9.0;

  // Brand fees
  const brandRoyaltyPctRooms = Number(input.brandRoyaltyPctOfRooms) || 5.0;
  const brandMktReservPctRooms = Number(input.brandMktReservPctOfRooms) || 2.0;

  // Fixed expenses
  const propertyTaxPctRev    = Number(input.propertyTaxPctRev) || 2.0;
  const insurancePctRev      = Number(input.insurancePctRev) || 1.0;
  const groundLeaseCrPa      = Number(input.groundLeaseCrPa) || 0;

  // FF&E reserve
  const ffeReservePct        = Number(input.ffeReservePct) || 4.0;

  // Capex (India benchmarks)
  const hardCostPerSqft      = Number(input.hardCostPerSqft) || 11000;
  const architectPctHard     = Number(input.architectPctOfHard) || 4;
  const pmcPctHard           = Number(input.pmcPctOfHard) || 2;
  const consultantsPctHard   = Number(input.consultantsPctOfHard) || 3.5;
  const approvalsPctHard     = Number(input.approvalsPctOfHard) || 2;
  const ffePerKey            = Number(input.ffePerKey) || 2500000;
  const osePerKey            = Number(input.osePerKey) || 400000;
  const preOpeningPerKey     = Number(input.preOpeningPerKey) || 350000;
  const workingCapitalCr     = Number(input.workingCapitalCr) || (keys * 50000) / 1e7;
  const contingencyPct       = Number(input.contingencyPct) || 5;

  // Capital stack
  const constLoanLTC         = Math.min(0.80, Math.max(0, Number(input.constLoanLTC) || 0.55));
  const constLoanRatePct     = Number(input.constLoanRatePct) || 10.5;
  const constLoanFeesPct     = Number(input.constLoanFeesPct) || 1.0;
  const refiLTV              = Math.min(0.70, Math.max(0, Number(input.refiLTV) || 0.55));
  const refiCapRate          = Number(input.refiCapRatePct) || 8.5;
  const refiInterestRate     = Number(input.refiInterestRatePct) || 9.25;
  const refiIOYears          = Math.max(0, Number(input.refiIOYears) || 2);
  const refiAmortYears       = Math.max(10, Math.min(30, Number(input.refiAmortYears) || 20));
  const refiYear             = Math.max(stabilizationYear, Math.min(holdPeriodYears - 1, Number(input.refiYear) || stabilizationYear));

  // Exit + discount
  const exitCapRate          = Number(input.exitCapRate) || 8.25;
  const discountRatePct      = Number(input.discountRatePct) || 14;
  const saleExpPct           = Number(input.saleExpensesPct) || 4;

  // Legacy / compatibility fields
  const debtCoverage         = resolveDebtRatio(input.debtCoverage, constLoanLTC);
  const interestRatePct      = constLoanRatePct;
  const amortizationYearsHosp = refiAmortYears;
  const exitStrategy         = resolveExitStrategy(input.exitStrategy);
  const forwardPurchasePriceCr = Number(input.forwardPurchasePriceCr) || 0;
  const exitMultipleInput    = Number(input.exitMultiple) || 0;
  const perpetuityGrowthPct  = Number(input.perpetuityGrowthPct);
  const terminalValueMethod  = resolveTerminalValueMethod(input.terminalValueMethod, {
    exitStrategy, forwardPurchasePriceCr,
  });

  const timeline = resolveTimelineInput(input, {
    defaultDurationYears: 3,
    defaultConstructionStartYears: 0,
    defaultConstructionEndRatio: 1,
  });
  const constructionMonths = timeline.projectDurationMonths;

  if (keys <= 0) throw new Error('Number of keys must be positive');
  if (adr <= 0 && ownerRateADR <= 0) throw new Error('ADR must be positive');
  if (stabilizedOccPct <= 0 || stabilizedOccPct > 100) throw new Error('Occupancy must be 0–100%');
  if (exitCapRate <= 0 || exitCapRate > 30) throw new Error('Exit cap rate must be 0–30%');
  if (timeline.projectDurationYears < MIN_PROJECT_DURATION_YEARS || timeline.projectDurationYears > MAX_PROJECT_DURATION_YEARS) {
    throw new Error(`Project duration must be between ${MIN_PROJECT_DURATION_YEARS} and ${MAX_PROJECT_DURATION_YEARS} years`);
  }

  // ─── 2. Sources & Uses ────────────────────────────────────────────────────
  const stampDutyCr          = landCostCr * stampRegPct;
  const bettermentCr         = landCostCr * (bettermentPct / 100);
  const hardCostCr           = (totalBuaSqft * hardCostPerSqft) / 1e7;
  const gstRateInput         = resolveGstRate(input, 'hospitality');
  const gstCostCr            = hardCostCr * gstRateInput;
  const architectCr          = hardCostCr * (architectPctHard / 100);
  const pmcCr                = hardCostCr * (pmcPctHard / 100);
  const consultantsCr        = hardCostCr * (consultantsPctHard / 100);
  const softDesignCr         = architectCr + pmcCr + consultantsCr;
  const approvalsCr          = hardCostCr * (approvalsPctHard / 100);
  const ffeCapexCr           = (keys * ffePerKey) / 1e7;
  const oseCapexCr           = (keys * osePerKey) / 1e7;
  const preOpeningCr         = (keys * preOpeningPerKey) / 1e7;
  const contingencyBase      = hardCostCr + softDesignCr + approvalsCr + ffeCapexCr + oseCapexCr;
  const contingencyCr        = contingencyBase * (contingencyPct / 100);

  const totalUsesExIDCCr = landCostCr + stampDutyCr + bettermentCr
    + hardCostCr + gstCostCr + softDesignCr + approvalsCr
    + ffeCapexCr + oseCapexCr + preOpeningCr + workingCapitalCr + contingencyCr;

  // IDC on construction loan — mid-draw average method
  const idcYears = constructionMonths / 12;
  const constLoanPrincipalEstimate = totalUsesExIDCCr * constLoanLTC;
  const idcCr = constLoanPrincipalEstimate * 0.5 * (constLoanRatePct / 100) * idcYears
              + constLoanPrincipalEstimate * (constLoanFeesPct / 100);

  const totalDevCostCr = totalUsesExIDCCr + idcCr;
  const finalConstDebtCr = totalDevCostCr * constLoanLTC;
  const equityCr = Math.max(0, totalDevCostCr - finalConstDebtCr);

  // Legacy field — sum of "hard" cost bucket for back-compat
  const preOpeningCostCr = preOpeningCr;
  const approvalCostCr = approvalsCr;
  const constructionCostCr = hardCostCr;

  // ─── 3. Annual USALI P&L (10-year) ─────────────────────────────────────────
  const years = holdPeriodYears;
  const occRamp = hospOccRamp({ initialOccPct, stabilizedOccPct, stabilizationYear, years });

  const annual = [];
  for (let y = 1; y <= years; y++) {
    const mktOcc = occRamp[y - 1] / 100;
    const adrY   = adr * Math.pow(1 + adrGrowthPct / 100, y - 1);

    // Rooms revenue: owner-rate (contracted) + market-rate
    const ownerRoomsCr = (ownerRateKeys * ownerRateADR * ownerRateGuaranteedOcc * HOSP_DAYS_PER_YEAR) / 1e7;
    const mktRoomsCr   = (marketRateKeys * adrY * mktOcc * HOSP_DAYS_PER_YEAR) / 1e7;
    const roomsCr      = ownerRoomsCr + mktRoomsCr;

    const blendedOcc = keys > 0
      ? ((ownerRateKeys * ownerRateGuaranteedOcc) + (marketRateKeys * mktOcc)) / keys
      : mktOcc;
    const blendedADR = (blendedOcc > 0 && keys > 0)
      ? (roomsCr * 1e7) / (keys * HOSP_DAYS_PER_YEAR * blendedOcc)
      : adrY;
    const revPAR = keys > 0 ? (roomsCr * 1e7) / (keys * HOSP_DAYS_PER_YEAR) : 0;

    // Non-room revenue
    const fbRestCr  = roomsCr * (fbRestaurantPctRooms / 100);
    const fbBanqCr  = roomsCr * (fbBanquetPctRooms / 100);
    const fbCr      = fbRestCr + fbBanqCr;
    const otherOpCr = roomsCr * (otherOperatedPctRooms / 100);
    const parkingCr = roomsCr * (parkingPctRooms / 100);
    const leaseCr   = leaseIncomeCrPa;
    const totalRevCr = roomsCr + fbCr + otherOpCr + parkingCr + leaseCr;

    // Departmental expenses
    const roomsDeptExpCr = roomsCr * (roomsDeptCostPct / 100);
    const fbDeptExpCr    = fbCr * (fbDeptCostPct / 100);
    const otherDeptExpCr = (otherOpCr + parkingCr) * (otherDeptCostPct / 100);
    const totalDeptExpCr = roomsDeptExpCr + fbDeptExpCr + otherDeptExpCr;
    const totalDeptProfitCr = totalRevCr - leaseCr - totalDeptExpCr;

    // Undistributed expenses
    const aAndGCr = totalRevCr * (aAndGPct / 100);
    const itCr    = totalRevCr * (itPct / 100);
    const smCr    = totalRevCr * (smPct / 100);
    const pomCr   = totalRevCr * (pomPct / 100);
    const utilCr  = totalRevCr * (utilitiesPct / 100);
    const totalUndistCr = aAndGCr + itCr + smCr + pomCr + utilCr;

    // Brand fees
    const brandRoyaltyCr   = roomsCr * (brandRoyaltyPctRooms / 100);
    const brandMktReservCr = roomsCr * (brandMktReservPctRooms / 100);
    const totalBrandCr     = brandRoyaltyCr + brandMktReservCr;

    // GOP
    const gopCr = totalDeptProfitCr + leaseCr - totalUndistCr - totalBrandCr;

    // Management fees
    const mgmtBaseCr      = totalRevCr * (mgmtBasePct / 100);
    const mgmtIncentiveCr = Math.max(0, gopCr) * (mgmtIncentivePct / 100);
    const totalMgmtCr     = mgmtBaseCr + mgmtIncentiveCr;

    // IBFC → Fixed → EBITDA → FF&E reserve → NOI
    const ibfcCr       = gopCr - totalMgmtCr;
    const propTaxCr    = totalRevCr * (propertyTaxPctRev / 100);
    const insuranceCr  = totalRevCr * (insurancePctRev / 100);
    const groundLeaseCr = groundLeaseCrPa;
    const totalFixedCr = propTaxCr + insuranceCr + groundLeaseCr;
    const ebitdaCr     = ibfcCr - totalFixedCr;
    const ffeReserveCr = totalRevCr * (ffeReservePct / 100);
    const noiCr        = ebitdaCr - ffeReserveCr;

    annual.push({
      year: y,
      occupancy: round4(blendedOcc * 100),
      adr: round2(blendedADR),
      revPAR: round2(revPAR),
      trevPAR: keys > 0 ? round2((totalRevCr * 1e7) / (keys * HOSP_DAYS_PER_YEAR)) : null,
      roomsRevenueCr: round4(roomsCr),
      ownerRoomsCr: round4(ownerRoomsCr),
      marketRoomsCr: round4(mktRoomsCr),
      fbRevenueCr: round4(fbCr),
      fbRestaurantCr: round4(fbRestCr),
      fbBanquetCr: round4(fbBanqCr),
      otherOperatedCr: round4(otherOpCr),
      parkingCr: round4(parkingCr),
      leaseIncomeCr: round4(leaseCr),
      totalRevenueCr: round4(totalRevCr),
      roomsDeptExpCr: round4(roomsDeptExpCr),
      fbDeptExpCr: round4(fbDeptExpCr),
      otherDeptExpCr: round4(otherDeptExpCr),
      totalDeptExpCr: round4(totalDeptExpCr),
      deptProfitCr: round4(totalDeptProfitCr),
      deptProfitMarginPct: totalRevCr > 0 ? round2((totalDeptProfitCr / totalRevCr) * 100) : null,
      aAndGCr: round4(aAndGCr),
      itCr: round4(itCr),
      smCr: round4(smCr),
      pomCr: round4(pomCr),
      utilitiesCr: round4(utilCr),
      totalUndistCr: round4(totalUndistCr),
      brandRoyaltyCr: round4(brandRoyaltyCr),
      brandMktReservCr: round4(brandMktReservCr),
      gopCr: round4(gopCr),
      gopMarginPct: totalRevCr > 0 ? round2((gopCr / totalRevCr) * 100) : null,
      gopPAR: keys > 0 ? round2((gopCr * 1e7) / keys) : null,
      mgmtBaseCr: round4(mgmtBaseCr),
      mgmtIncentiveCr: round4(mgmtIncentiveCr),
      totalMgmtCr: round4(totalMgmtCr),
      ibfcCr: round4(ibfcCr),
      propTaxCr: round4(propTaxCr),
      insuranceCr: round4(insuranceCr),
      groundLeaseCr: round4(groundLeaseCr),
      totalFixedCr: round4(totalFixedCr),
      ebitdaCr: round4(ebitdaCr),
      ebitdaMarginPct: totalRevCr > 0 ? round2((ebitdaCr / totalRevCr) * 100) : null,
      ebitdaPAR: keys > 0 ? round2((ebitdaCr * 1e7) / keys) : null,
      ffeReserveCr: round4(ffeReserveCr),
      noiCr: round4(noiCr),
      noiMarginPct: totalRevCr > 0 ? round2((noiCr / totalRevCr) * 100) : null,
    });
  }

  const stabIdx = Math.min(annual.length - 1, Math.max(0, stabilizationYear - 1));
  const stab = annual[stabIdx];
  const stabilizedNOICr     = stab.noiCr;
  const stabilizedEBITDACr  = stab.ebitdaCr;
  const stabilizedRevCr     = stab.totalRevenueCr;
  const stabilizedGOPCr     = stab.gopCr;

  // Legacy Y1-stab aliases (for back-compat with old UI readouts)
  const totalRevCrY1Stab = stabilizedRevCr;
  const roomsRevCrY1Stab = stab.roomsRevenueCr;
  const fbRevCrY1Stab    = stab.fbRevenueCr;
  const gopCrY1Stab      = stabilizedGOPCr;
  const ebitdaCrY1Stab   = stabilizedEBITDACr;
  const revPARStabilized = stab.revPAR;
  const gopMarginPct     = stab.gopMarginPct;
  const ebitdaMarginPct  = stab.ebitdaMarginPct;
  const fbRevPct         = fbRestaurantPctRooms + fbBanquetPctRooms;
  const otherRevPct      = otherOperatedPctRooms + parkingPctRooms;

  const yieldOnCost = totalDevCostCr > 0 ? (stabilizedNOICr / totalDevCostCr) * 100 : 0;
  const exitYearNOI = annual[years - 1].noiCr;
  const exitYearEBITDA = annual[years - 1].ebitdaCr;
  const exitEBITDA = exitYearEBITDA;
  const grossExitValueCr = exitYearNOI / (exitCapRate / 100);
  const netExitValueCr = grossExitValueCr * (1 - saleExpPct / 100);
  const entryValueCr = stabilizedNOICr / (exitCapRate / 100);

  const tv = computeTerminalValue({
    method: terminalValueMethod,
    stabilizedNOICr,
    noiAtExitCr: exitYearNOI,
    exitCapRatePct: exitCapRate,
    exitMultiple: exitMultipleInput,
    perpetuityGrowthPct: Number.isFinite(perpetuityGrowthPct) ? perpetuityGrowthPct : 3,
    discountRatePct,
    forwardPurchasePriceCr,
    holdPeriodYears,
  });
  const exitValueCr = grossExitValueCr;
  const effectiveExitValueCr = tv.terminalValueCr;
  const terminalValuePVCr    = tv.terminalValuePVCr;

  // ─── 4. Cash flows ────────────────────────────────────────────────────────
  const constQ  = Math.max(1, Math.ceil(constructionMonths / 3));
  const opQ     = years * 4;
  const totalQ  = constQ + opQ;
  const cfs     = new Array(totalQ + 1).fill(0);
  const unleveredCfs = new Array(totalQ + 1).fill(0);

  // Development outflows
  cfs[0] -= landCostCr + stampDutyCr + bettermentCr;
  unleveredCfs[0] -= landCostCr + stampDutyCr + bettermentCr;

  // Approvals over first half of construction
  const approvalsEnd = Math.max(1, Math.ceil(constQ / 2));
  for (let q = 1; q <= approvalsEnd; q++) {
    cfs[q] -= approvalsCr / approvalsEnd;
    unleveredCfs[q] -= approvalsCr / approvalsEnd;
  }

  // Hard + GST + soft + contingency on S-curve
  const cweights = sCurveWeights(constQ);
  const scurveTotal = hardCostCr + gstCostCr + softDesignCr + contingencyCr;
  for (let q = 0; q < constQ && q + 1 <= totalQ; q++) {
    const spend = scurveTotal * cweights[q];
    cfs[q + 1] -= spend;
    unleveredCfs[q + 1] -= spend;
  }

  // FF&E + OS&E in final 2 construction quarters
  const ffePhaseQ = Math.min(2, constQ);
  for (let q = constQ - ffePhaseQ; q < constQ; q++) {
    if (q + 1 <= totalQ) {
      const spend = (ffeCapexCr + oseCapexCr) / ffePhaseQ;
      cfs[q + 1] -= spend;
      unleveredCfs[q + 1] -= spend;
    }
  }

  // Pre-opening + working capital at end of construction
  cfs[constQ] -= preOpeningCr + workingCapitalCr;
  unleveredCfs[constQ] -= preOpeningCr + workingCapitalCr;

  // Construction loan — draw at end of construction (simplified), paid off at refi
  const constLoanSched = finalConstDebtCr > 0 ? buildAmortizingSchedule({
    principalCr: finalConstDebtCr,
    annualRatePct: constLoanRatePct,
    amortizationYears: Math.max(2, refiYear),
    drawQ: constQ,
    operatingStartQ: constQ + 1,
    exitQ: constQ + refiYear * 4,
    totalQuarters: totalQ,
  }) : null;
  if (constLoanSched) {
    for (let q = 0; q <= totalQ; q++) {
      if (constLoanSched.draws[q] > 0) cfs[q] += constLoanSched.draws[q];
    }
  }

  // Operating NOI — spread annual NOI across 4 quarters
  for (let y = 1; y <= years; y++) {
    const yNoi = annual[y - 1].noiCr;
    for (let q = 1; q <= 4; q++) {
      const idx = constQ + (y - 1) * 4 + q;
      if (idx <= totalQ) {
        cfs[idx] += yNoi / 4;
        unleveredCfs[idx] += yNoi / 4;
      }
    }
  }

  // Permanent refinance at refiYear (sized off stabilized NOI / going-in cap × LTV)
  const stabilizedValueForRefi = stabilizedNOICr / (refiCapRate / 100);
  const refiPrincipalCr = stabilizedValueForRefi * refiLTV;
  const refiQ = Math.min(totalQ, constQ + refiYear * 4);
  const refiSched = refiPrincipalCr > 0 ? buildAmortizingSchedule({
    principalCr: refiPrincipalCr,
    annualRatePct: refiInterestRate,
    amortizationYears: refiAmortYears,
    drawQ: refiQ,
    operatingStartQ: refiQ + refiIOYears * 4 + 1,
    exitQ: totalQ,
    totalQuarters: totalQ,
  }) : null;

  // Construction-loan debt service until refi, plus balloon at refi
  if (constLoanSched) {
    for (let q = 0; q <= refiQ && q <= totalQ; q++) {
      if (constLoanSched.debtService[q] > 0) cfs[q] -= constLoanSched.debtService[q];
    }
  }
  // Refi proceeds, then refi service
  if (refiSched) {
    cfs[refiQ] += refiPrincipalCr;
    for (let q = refiQ + 1; q <= totalQ; q++) {
      if (refiSched.debtService[q] > 0) cfs[q] -= refiSched.debtService[q];
    }
  }

  // Exit (net of sale expenses + balloon repayment of permanent loan)
  const permBalanceAtExit = refiSched ? (refiSched.balances[totalQ - 1] || 0) : 0;
  cfs[totalQ] += netExitValueCr - permBalanceAtExit;
  unleveredCfs[totalQ] += netExitValueCr;

  const cashFlows = safeCashFlows(cfs);
  const unleveredCashFlows = safeCashFlows(unleveredCfs);

  let irrPct = null, unleveredIRR = null, npvCr = null;
  try { irrPct = calculateIRR(cashFlows); } catch { /* skip */ }
  try { unleveredIRR = calculateIRR(unleveredCashFlows); } catch { /* skip */ }
  try { npvCr = calculateNPV(cashFlows, discountRatePct / 100); } catch { /* skip */ }

  const totalReturns   = cashFlows.filter((c) => c > 0).reduce((a, b) => a + b, 0);
  const totalOutflows  = Math.abs(cashFlows.filter((c) => c < 0).reduce((a, b) => a + b, 0));
  const equityMultiple = totalOutflows > 0 ? totalReturns / totalOutflows : null;

  // DSCR at stabilization (permanent loan)
  let dscr = null, debtYieldPct = null, minDSCR = null;
  if (refiSched && refiSched.quarterlyPayment > 0) {
    const annDS = refiSched.quarterlyPayment * 4;
    dscr = round2(stabilizedNOICr / annDS);
    debtYieldPct = refiPrincipalCr > 0 ? round2((stabilizedNOICr / refiPrincipalCr) * 100) : null;
    let mn = Infinity;
    for (let y = refiYear + 1; y <= years; y++) {
      const r = annual[y - 1].noiCr / annDS;
      if (r < mn) mn = r;
    }
    minDSCR = isFinite(mn) ? round2(mn) : null;
  } else if (constLoanSched && constLoanSched.quarterlyPayment > 0) {
    dscr = round2(stabilizedNOICr / (constLoanSched.quarterlyPayment * 4));
  }

  // Debt schedule summary (back-compat wrapper)
  const debtScheduleHosp = (constLoanSched || refiSched) ? {
    termLoan: constLoanSched ? {
      principalCr: round4(finalConstDebtCr),
      annualRatePct: constLoanRatePct,
      amortizationYears: refiYear,
      quarterlyPaymentCr: round4(constLoanSched.quarterlyPayment),
      annualDebtServiceCr: round4(constLoanSched.quarterlyPayment * 4),
      totalInterestCr: round4(constLoanSched.totalInterestCr),
      balloonRepaymentCr: round4(constLoanSched.balloonRepaymentCr),
    } : null,
    lrd: refiSched ? {
      principalCr: round4(refiPrincipalCr),
      annualRatePct: refiInterestRate,
      amortizationYears: refiAmortYears,
      quarterlyPaymentCr: round4(refiSched.quarterlyPayment),
      annualDebtServiceCr: round4(refiSched.quarterlyPayment * 4),
      totalInterestCr: round4(refiSched.totalInterestCr),
      balloonRepaymentCr: round4(refiSched.balloonRepaymentCr),
      refinanceQuarter: refiQ,
    } : null,
  } : null;

  // ─── 5. Multi-axis sensitivity ────────────────────────────────────────────
  const sensitivity = buildHospSensitivity({
    baseInput: input,
    keys, sqftPerKey, adr, stabilizedOccPct, exitCapRate, constLoanRatePct,
  });

  // ─── 6. Waterfall ─────────────────────────────────────────────────────────
  const waterfall = buildHospWaterfall({
    equityCr, cashFlows, holdPeriodYears: years, constQ,
    lpPct: Number(input.lpPct) || 0.90,
    gpPct: Number(input.gpPct) || 0.10,
    tier2Hurdle: Number(input.tier2HurdlePct) || 10,
    tier3Hurdle: Number(input.tier3HurdlePct) || 15,
    tier4Hurdle: Number(input.tier4HurdlePct) || 20,
    tier2PromotePct: Number(input.tier2PromotePct) || 10,
    tier3PromotePct: Number(input.tier3PromotePct) || 20,
    tier4PromotePct: Number(input.tier4PromotePct) || 30,
  });

  const outputTimeline = buildTimeline({ ...timeline, holdPeriodYears });

  // ─── 7. Sources & Uses payload ────────────────────────────────────────────
  const sourcesUses = {
    uses: [
      { category: 'Land & Acquisition', subtotalCr: round4(landCostCr + stampDutyCr + bettermentCr), items: [
        { label: 'Land cost',                                              valueCr: round4(landCostCr) },
        { label: `Stamp + registration (${round2(stampRegPct * 100)}%)`,   valueCr: round4(stampDutyCr) },
        { label: `Betterment charges (${bettermentPct}%)`,                 valueCr: round4(bettermentCr) },
      ] },
      { category: 'Approvals', subtotalCr: round4(approvalsCr), items: [
        { label: 'BBMP / KSPCB / Fire / FSSAI / hotel classification',     valueCr: round4(approvalsCr) },
      ] },
      { category: 'Design & Soft Costs', subtotalCr: round4(softDesignCr), items: [
        { label: `Architect (${architectPctHard}% of hard)`,               valueCr: round4(architectCr) },
        { label: `PMC (${pmcPctHard}% of hard)`,                           valueCr: round4(pmcCr) },
        { label: `MEP + Structural + F&B + ID (${consultantsPctHard}%)`,    valueCr: round4(consultantsCr) },
      ] },
      { category: 'Hard Construction', subtotalCr: round4(hardCostCr + gstCostCr), items: [
        { label: `Hard cost (${Math.round(totalBuaSqft).toLocaleString('en-IN')} sqft × ₹${hardCostPerSqft}/sqft)`, valueCr: round4(hardCostCr) },
        { label: `GST on construction (${round2(gstRateInput * 100)}%)`,   valueCr: round4(gstCostCr) },
      ] },
      { category: 'FF&E + OS&E', subtotalCr: round4(ffeCapexCr + oseCapexCr), items: [
        { label: `FF&E (₹${(ffePerKey / 1e5).toFixed(1)} L/key × ${keys})`, valueCr: round4(ffeCapexCr) },
        { label: `OS&E (₹${(osePerKey / 1e5).toFixed(1)} L/key × ${keys})`, valueCr: round4(oseCapexCr) },
      ] },
      { category: 'Pre-opening & Working Capital', subtotalCr: round4(preOpeningCr + workingCapitalCr), items: [
        { label: `Pre-opening (₹${(preOpeningPerKey / 1e5).toFixed(1)} L/key)`, valueCr: round4(preOpeningCr) },
        { label: 'Working capital / opening inventory',                    valueCr: round4(workingCapitalCr) },
      ] },
      { category: 'Contingency', subtotalCr: round4(contingencyCr), items: [
        { label: `Contingency (${contingencyPct}% of hard + soft + FF&E)`, valueCr: round4(contingencyCr) },
      ] },
      { category: 'Interest During Construction', subtotalCr: round4(idcCr), items: [
        { label: `Capitalized interest + ${constLoanFeesPct}% loan fees`,  valueCr: round4(idcCr) },
      ] },
    ],
    usesTotalCr: round4(totalDevCostCr),
    sources: [
      { label: `Construction loan (${round2(constLoanLTC * 100)}% LTC @ ${constLoanRatePct}%)`, valueCr: round4(finalConstDebtCr), category: 'debt' },
      { label: 'Sponsor / LP equity',                                                            valueCr: round4(equityCr),         category: 'equity' },
    ],
    sourcesTotalCr: round4(totalDevCostCr),
    refinance: {
      refiYear,
      refiPrincipalCr:         round4(refiPrincipalCr),
      refiLTVPct:              round2(refiLTV * 100),
      refiCapRatePct:          refiCapRate,
      refiInterestRatePct:     refiInterestRate,
      refiIOYears, refiAmortYears,
      stabilizedValueForRefiCr: round4(stabilizedValueForRefi),
    },
  };

  return {
    assetClass: 'hospitality',
    inputs: {
      keys, sqftPerKey,
      totalBuaSqft: round2(totalBuaSqft),
      ownerRateKeys, marketRateKeys,
      ownerRateADR,
      ownerRateGuaranteedOccPct: round2(ownerRateGuaranteedOcc * 100),
      constructionCostPerKey: round2(hardCostPerSqft * sqftPerKey),
      landCostCr, approvalCostCr,
      approvalCostPerSqft: Number(input.approvalCostPerSqft) || null,
      stampRegPct: round2(stampRegPct * 100),
      bettermentPct,
      hardCostPerSqft,
      architectPctOfHard: architectPctHard,
      pmcPctOfHard: pmcPctHard,
      consultantsPctOfHard: consultantsPctHard,
      approvalsPctOfHard: approvalsPctHard,
      gstPct: round2(gstRateInput * 100),
      ffePerKey, osePerKey,
      preOpeningPerKey, preOpeningCostPerKey: preOpeningPerKey,
      workingCapitalCr: round4(workingCapitalCr),
      adr, adrGrowthPct, stabilizedOccPct, initialOccPct, stabilizationYear,
      fbRestaurantPctOfRooms: fbRestaurantPctRooms,
      fbBanquetPctOfRooms:    fbBanquetPctRooms,
      otherOperatedPctOfRooms: otherOperatedPctRooms,
      parkingPctOfRooms:      parkingPctRooms,
      leaseIncomeCrPa,
      roomsDeptCostPct, fbDeptCostPct, otherDeptCostPct,
      aAndGPct, itPct, smPct, pomPct, utilitiesPct,
      mgmtBasePct, mgmtIncentivePct,
      brandRoyaltyPctOfRooms:   brandRoyaltyPctRooms,
      brandMktReservPctOfRooms: brandMktReservPctRooms,
      propertyTaxPctRev, insurancePctRev, groundLeaseCrPa,
      ffeReservePct,
      effectiveDate: outputTimeline.effectiveDate,
      projectDurationYears: outputTimeline.projectDurationYears,
      projectDurationMonths: constructionMonths,
      holdPeriodYears,
      // Back-compat aliases
      fbRevPct, otherRevPct,
      gopMarginPct, ebitdaMarginPct,
      exitCapRate, discountRatePct, saleExpensesPct: saleExpPct,
      debtCoverage,
      interestRatePct,
      amortizationYears: amortizationYearsHosp,
      contingencyPct,
      constLoanLTC: round2(constLoanLTC * 100),
      constLoanRatePct, constLoanFeesPct,
      refiLTV: round2(refiLTV * 100),
      refiCapRatePct: refiCapRate,
      refiInterestRatePct: refiInterestRate,
      refiIOYears, refiAmortYears, refiYear,
      exitStrategy,
      forwardPurchasePriceCr: exitStrategy === 'forward_purchase' ? forwardPurchasePriceCr : null,
      terminalValueMethod,
      exitMultiple: terminalValueMethod === 'exit_multiple' ? round2(exitMultipleInput) : null,
      perpetuityGrowthPct: terminalValueMethod === 'perpetuity_growth'
        ? round2(Number.isFinite(perpetuityGrowthPct) ? perpetuityGrowthPct : 0)
        : null,
    },
    kpis: {
      irr:           round4(irrPct),
      leveredIrr:    round4(irrPct),
      unleveredIrr:  round4(unleveredIRR),
      leveredNpv:    round4(npvCr),
      npv:           round4(npvCr),
      equityMultiple: round4(equityMultiple),
      rlv:           null,
      grossMarginPct: round4(ebitdaMarginPct),
      noi:           round4(stabilizedNOICr),
      noiAtExit:     round4(exitYearNOI),
      stabilizedNOI: round4(stabilizedNOICr),
      stabilizedEBITDA: round4(stabilizedEBITDACr),
      stabilizedRevenue: round4(stabilizedRevCr),
      stabilizedOccupancy: round2(stab.occupancy),
      stabilizedADR:   round2(stab.adr),
      yieldOnCost:   round4(yieldOnCost),
      dscr, minDSCR, debtYieldPct,
      exitValue:        round4(effectiveExitValueCr),
      exitValueGross:   round4(grossExitValueCr),
      exitValueNet:     round4(netExitValueCr),
      terminalValue:    round4(effectiveExitValueCr),
      terminalValuePV:  round4(terminalValuePVCr),
      terminalValueMethod,
      terminalValueFormula: tv.formula,
      capRateValuationCr: round4(exitValueCr),
      exitCapRate:   round4(exitCapRate),
      entryValue:    round4(entryValueCr),
      revPAR:        round2(revPARStabilized),
      gopMargin:     round2(gopMarginPct),
      gopMarginPct:  round2(gopMarginPct),
      ebitdaMarginPct: round2(ebitdaMarginPct),
      noiMarginPct:  round2(stab.noiMarginPct),
      // Per-key metrics
      devCostPerKey: keys > 0 ? round2((totalDevCostCr * 1e7) / keys) : null,
      revenuePerKey: keys > 0 ? round2((totalRevCrY1Stab * 1e7) / keys) : null,
      ebitdaPerKey:  keys > 0 ? round2((stabilizedEBITDACr * 1e7) / keys) : null,
      gopPAR:        round2(stab.gopPAR),
      ebitdaPAR:     round2(stab.ebitdaPAR),
      tRevPAR:       round2(stab.trevPAR),
      trevPAR:       round2(stab.trevPAR),
    },
    areas: {
      leasable: null,
      grossBuiltUp: round2(totalBuaSqft),
      saleable: null, carpet: null, superBuiltUp: null,
      keys,
    },
    costs: {
      land:           round4(landCostCr),
      construction:   round4(constructionCostCr),
      gst:            round4(gstCostCr),
      contingency:    round4(contingencyCr),
      stampDuty:      round4(stampDutyCr),
      betterment:     round4(bettermentCr),
      approval:       round4(approvalCostCr),
      preOpening:     round4(preOpeningCostCr),
      ffe:            round4(ffeCapexCr),
      ose:            round4(oseCapexCr),
      workingCapital: round4(workingCapitalCr),
      idc:            round4(idcCr),
      architecture:   round4(architectCr),
      pmc:            round4(pmcCr),
      consultants:    round4(consultantsCr),
      marketing:      null,
      finance:        round4(idcCr),
      hardCostTotal:  round4(landCostCr + stampDutyCr + bettermentCr + hardCostCr + gstCostCr + ffeCapexCr + oseCapexCr),
      softCostTotal:  round4(softDesignCr + approvalsCr + preOpeningCostCr + workingCapitalCr + contingencyCr + idcCr),
      total:          round4(totalDevCostCr),
      tenantImprovements: null, leasingCommissions: null,
      sources_uses:   sourcesUses,
    },
    revenue: {
      totalRevenueCr:     round4(totalRevCrY1Stab),
      grossProfitCr:      round4(stabilizedEBITDACr),
      grossMarginPct:     round4(ebitdaMarginPct),
      annualNOI:          round4(stabilizedNOICr),
      stabilizedNOI:      round4(stabilizedNOICr),
      noiAtExit:          round4(exitYearNOI),
      exitValue:          round4(effectiveExitValueCr),
      terminalValue:      round4(effectiveExitValueCr),
      terminalValuePV:    round4(terminalValuePVCr),
      terminalValueMethod,
      terminalValueFormula: tv.formula,
      capRateValuationCr: round4(exitValueCr),
      revPAR:             round2(revPARStabilized),
      roomsRevenue:       round4(roomsRevCrY1Stab),
      fbRevenue:          round4(fbRevCrY1Stab),
      gop:                round4(gopCrY1Stab),
      ebitda:             round4(stabilizedEBITDACr),
      usali_pnl:          annual,
    },
    capitalStack: {
      totalCostCr: round4(totalDevCostCr),
      debtCr:      round4(finalConstDebtCr),
      equityCr:    round4(equityCr),
      debtPct:     totalDevCostCr > 0 ? round2((finalConstDebtCr / totalDevCostCr) * 100) : 0,
      equityPct:   totalDevCostCr > 0 ? round2((equityCr / totalDevCostCr) * 100) : 100,
      interestRatePct,
      amortizationYears: amortizationYearsHosp,
      dscr, minDSCR, debtYieldPct,
      debtSchedule: debtScheduleHosp,
      construction: constLoanSched ? {
        principalCr: round4(finalConstDebtCr),
        ltcPct:      round2(constLoanLTC * 100),
        ratePct:     constLoanRatePct,
        feesPct:     constLoanFeesPct,
        idcCr:       round4(idcCr),
        termYears:   refiYear,
      } : null,
      permanent: refiSched ? {
        principalCr:         round4(refiPrincipalCr),
        ltvPct:              round2(refiLTV * 100),
        ratePct:             refiInterestRate,
        ioYears:             refiIOYears,
        amortYears:          refiAmortYears,
        refiYear,
        sizingCapRate:       refiCapRate,
        stabilizedValueCr:   round4(stabilizedValueForRefi),
        quarterlyPaymentCr:  round4(refiSched.quarterlyPayment),
        annualDebtServiceCr: round4(refiSched.quarterlyPayment * 4),
        totalInterestCr:     round4(refiSched.totalInterestCr),
        balloonRepaymentCr:  round4(refiSched.balloonRepaymentCr),
      } : null,
      waterfall,
    },
    timeline: outputTimeline,
    cashFlows: structureCashFlows(cashFlows, outputTimeline),
    sensitivityMatrix: sensitivity,
    _legacy: {
      land_cost_cr:          landCostCr,
      total_cost_cr:         round4(totalDevCostCr),
      total_revenue_cr:      round4(effectiveExitValueCr),
      gross_profit_cr:       round4(effectiveExitValueCr - totalDevCostCr),
      gross_margin_pct:      round4(ebitdaMarginPct),
      npv_cr:                round4(npvCr),
      irr_pct:               round4(irrPct),
      equity_multiple:       round4(equityMultiple),
      project_duration_months: constructionMonths,
      discount_rate_pct:     discountRatePct,
    },
  };
}

// ─── Hospitality helpers ─────────────────────────────────────────────────────

function hospOccRamp({ initialOccPct, stabilizedOccPct, stabilizationYear, years }) {
  const out = [];
  const steps = Math.max(1, stabilizationYear - 1);
  const delta = (stabilizedOccPct - initialOccPct) / steps;
  for (let y = 1; y <= years; y++) {
    out.push(y < stabilizationYear ? initialOccPct + delta * (y - 1) : stabilizedOccPct);
  }
  return out;
}

// Lightweight IRR recompute used for sensitivity cells — deterministic, no
// full USALI walk. Good enough to show directional sensitivity without
// re-building the whole model per cell.
function hospQuickIRR({
  keys, sqftPerKey, adr, stabilizedOccPct, exitCapRate, constLoanRatePct,
  hardCostPerSqft, landCostCr, ffePerKey, osePerKey, preOpeningPerKey,
  holdPeriodYears, constQ, noiMarginPct,
}) {
  const bua = keys * (sqftPerKey || HOSP_DEFAULT_SQFT_PER_KEY);
  const hard = (bua * hardCostPerSqft) / 1e7;
  const gst  = hard * GST_CONSTRUCTION_STANDARD;
  const ffe  = (keys * ffePerKey) / 1e7;
  const ose  = (keys * osePerKey) / 1e7;
  const pre  = (keys * preOpeningPerKey) / 1e7;
  const soft = hard * 0.115;
  const appr = hard * 0.02;
  const base = hard + soft + appr + ffe + ose;
  const cont = base * 0.05;
  const idc  = (landCostCr * 1.066 + base + cont) * 0.55 * 0.5 * (constLoanRatePct / 100) * (constQ / 4)
             + (landCostCr * 1.066 + base + cont) * 0.55 * 0.01;
  const total = landCostCr * 1.066 + base + gst + cont + pre + idc;

  const opQ = holdPeriodYears * 4;
  const totalQ = constQ + opQ;
  const cfs = new Array(totalQ + 1).fill(0);
  cfs[0] = -total;

  const ramp = hospOccRamp({ initialOccPct: 45, stabilizedOccPct, stabilizationYear: 4, years: holdPeriodYears });
  for (let y = 1; y <= holdPeriodYears; y++) {
    const occ = ramp[y - 1] / 100;
    const adrY = adr * Math.pow(1.05, y - 1);
    const roomsRev = (keys * adrY * occ * HOSP_DAYS_PER_YEAR) / 1e7;
    const totalRev = roomsRev * 1.39;
    const noi = totalRev * (noiMarginPct / 100);
    for (let q = 1; q <= 4; q++) {
      if (constQ + (y - 1) * 4 + q <= totalQ) cfs[constQ + (y - 1) * 4 + q] += noi / 4;
    }
  }
  const exitOcc = stabilizedOccPct / 100;
  const exitADR = adr * Math.pow(1.05, holdPeriodYears - 1);
  const exitRooms = (keys * exitADR * exitOcc * HOSP_DAYS_PER_YEAR) / 1e7 * 1.39;
  const exitNoi = exitRooms * (noiMarginPct / 100);
  cfs[totalQ] += (exitNoi / (exitCapRate / 100)) * 0.96;  // net of 4% sale expenses
  try { return calculateIRR(safeCashFlows(cfs)); } catch { return null; }
}

function buildHospSensitivity({ baseInput, keys, sqftPerKey, adr, stabilizedOccPct, exitCapRate, constLoanRatePct }) {
  const baseParams = {
    keys, sqftPerKey, adr, stabilizedOccPct, exitCapRate, constLoanRatePct,
    hardCostPerSqft: Number(baseInput.hardCostPerSqft) || 11000,
    landCostCr:      Number(baseInput.landCostCr) || 0,
    ffePerKey:       Number(baseInput.ffePerKey) || 2500000,
    osePerKey:       Number(baseInput.osePerKey) || 400000,
    preOpeningPerKey: Number(baseInput.preOpeningPerKey) || 350000,
    holdPeriodYears: Math.max(5, Math.min(15, Number(baseInput.holdPeriodYears) || 10)),
    constQ: 12,
    noiMarginPct: 28,
  };
  const occVars = [-15, -10, 0, 10, 15].map((d) => Math.max(40, Math.min(90, stabilizedOccPct + d)));
  const adrVars = [-0.20, -0.10, 0, 0.10, 0.20].map((v) => Math.round(adr * (1 + v)));
  const occAdrIrrGrid = occVars.map((o) => adrVars.map((a) => hospQuickIRR({ ...baseParams, adr: a, stabilizedOccPct: o })));

  const hcVars = [-15, -10, 0, 10, 15];
  const irVars = [-150, -75, 0, 75, 150];
  const crVars = [-100, -50, 0, 50, 100];
  const hardCostIrr = hcVars.map((pct) => hospQuickIRR({ ...baseParams, hardCostPerSqft: baseParams.hardCostPerSqft * (1 + pct / 100) }));
  const interestIrr = irVars.map((bps) => hospQuickIRR({ ...baseParams, constLoanRatePct: baseParams.constLoanRatePct + bps / 100 }));
  const capRateIrr  = crVars.map((bps) => hospQuickIRR({ ...baseParams, exitCapRate: baseParams.exitCapRate + bps / 100 }));

  return {
    axis: ['Occupancy (%)', 'ADR (₹)'],
    sellingRates: adrVars,
    constructionCosts: occVars,
    variations: occVars.map((o) => `${Math.round(o)}%`),
    irrGrid: occAdrIrrGrid,
    occAdr:       { rows: occVars, cols: adrVars, irrGrid: occAdrIrrGrid, rowLabel: 'Occupancy (%)', colLabel: 'ADR (₹)' },
    hardCost:     { variations: hcVars.map((v) => `${v >= 0 ? '+' : ''}${v}%`), irr: hardCostIrr.map((n) => round4(n)) },
    interestRate: { variations: irVars.map((v) => `${v >= 0 ? '+' : ''}${v} bps`), irr: interestIrr.map((n) => round4(n)) },
    capRate:      { variations: crVars.map((v) => `${v >= 0 ? '+' : ''}${v} bps`), irr: capRateIrr.map((n) => round4(n)) },
  };
}

// European back-end waterfall — 4 tiers (RoC → 10% → 15% → 20%+). Returns
// LP and GP dollar allocations plus equity multiples.
function buildHospWaterfall({
  equityCr, cashFlows, holdPeriodYears, constQ,
  lpPct, gpPct,
  tier2Hurdle, tier3Hurdle, tier4Hurdle,
  tier2PromotePct, tier3PromotePct, tier4PromotePct,
}) {
  const annualLevered = new Array(holdPeriodYears + 1).fill(0);
  let initialOutflow = 0;
  for (let q = 0; q <= constQ; q++) initialOutflow += cashFlows[q] || 0;
  annualLevered[0] = initialOutflow;
  for (let y = 1; y <= holdPeriodYears; y++) {
    for (let q = 1; q <= 4; q++) {
      annualLevered[y] += cashFlows[constQ + (y - 1) * 4 + q] || 0;
    }
  }

  const lpCapital = equityCr * lpPct;
  const gpCapital = equityCr * gpPct;
  const totalDistributions = annualLevered.reduce((s, v, i) => i === 0 ? s : s + Math.max(0, v), 0);

  // Tier 1 — pro rata return of capital
  const t1 = Math.min(totalDistributions, equityCr);
  const t1LP = t1 * lpPct;
  const t1GP = t1 * gpPct;
  let remaining = Math.max(0, totalDistributions - t1);

  const hurdleGross = (rate) => lpCapital * (Math.pow(1 + rate / 100, holdPeriodYears) - 1);

  // Tier 2 — LP preferred return up to tier2 IRR, then promote kicks in
  const tier2Need = hurdleGross(tier2Hurdle) - hurdleGross(0);
  const tier2Pool = Math.min(remaining, tier2Need / Math.max(0.01, 1 - tier2PromotePct / 100));
  const t2LP = tier2Pool * (1 - tier2PromotePct / 100);
  const t2GP = tier2Pool * (tier2PromotePct / 100);
  remaining -= tier2Pool;

  // Tier 3
  const tier3Need = hurdleGross(tier3Hurdle) - hurdleGross(tier2Hurdle);
  const tier3Pool = Math.max(0, Math.min(remaining, tier3Need / Math.max(0.01, 1 - tier3PromotePct / 100)));
  const t3LP = tier3Pool * (1 - tier3PromotePct / 100);
  const t3GP = tier3Pool * (tier3PromotePct / 100);
  remaining -= tier3Pool;

  // Tier 4 — residual above tier3 hurdle
  const tier4Pool = Math.max(0, remaining);
  const t4LP = tier4Pool * (1 - tier4PromotePct / 100);
  const t4GP = tier4Pool * (tier4PromotePct / 100);

  const totalLP = t1LP + t2LP + t3LP + t4LP;
  const totalGP = t1GP + t2GP + t3GP + t4GP;

  return {
    lpPct: round2(lpPct * 100),
    gpPct: round2(gpPct * 100),
    totalEquityCr: round4(equityCr),
    lpCapitalCr:   round4(lpCapital),
    gpCapitalCr:   round4(gpCapital),
    totalDistributionsCr: round4(totalDistributions),
    tiers: [
      { name: 'Tier 1 — Return of Capital', hurdlePct: 0,          lpSharePct: round2(lpPct * 100),                   gpSharePct: round2(gpPct * 100),          lpCr: round4(t1LP), gpCr: round4(t1GP) },
      { name: `Tier 2 — to ${tier2Hurdle}% IRR`, hurdlePct: tier2Hurdle, lpSharePct: round2((1 - tier2PromotePct / 100) * 100), gpSharePct: round2(tier2PromotePct), lpCr: round4(t2LP), gpCr: round4(t2GP) },
      { name: `Tier 3 — to ${tier3Hurdle}% IRR`, hurdlePct: tier3Hurdle, lpSharePct: round2((1 - tier3PromotePct / 100) * 100), gpSharePct: round2(tier3PromotePct), lpCr: round4(t3LP), gpCr: round4(t3GP) },
      { name: `Tier 4 — above ${tier3Hurdle}% IRR`, hurdlePct: tier4Hurdle, lpSharePct: round2((1 - tier4PromotePct / 100) * 100), gpSharePct: round2(tier4PromotePct), lpCr: round4(t4LP), gpCr: round4(t4GP) },
    ],
    totalLPCr: round4(totalLP),
    totalGPCr: round4(totalGP),
    lpEquityMultiple: lpCapital > 0 ? round4(totalLP / lpCapital) : null,
    gpEquityMultiple: gpCapital > 0 ? round4(totalGP / gpCapital) : null,
  };
}

// ─── SCENARIO ANALYSIS ───────────────────────────────────────────────────────

function applyScenarioPreset(input, scenarioKey) {
  if (scenarioKey === 'base') return { ...input };
  const preset = SCENARIO_PRESETS[scenarioKey];
  if (!preset) return { ...input };

  const out = { ...input };

  // Revenue adjustments
  if (out.sellingRatePerSqft)    out.sellingRatePerSqft    = Math.round(out.sellingRatePerSqft    * preset.revenueMultiplier);
  if (out.sellingRatePerSqyd)    out.sellingRatePerSqyd    = Math.round(out.sellingRatePerSqyd    * preset.revenueMultiplier);
  if (out.baseRentPerSqftMonth)  out.baseRentPerSqftMonth  = Math.round(out.baseRentPerSqftMonth  * preset.revenueMultiplier * 100) / 100;

  // Hard cost adjustments
  if (out.constructionCostPerSqft) out.constructionCostPerSqft = Math.round(out.constructionCostPerSqft * preset.hardCostMultiplier);
  if (out.devCostPerSqft)          out.devCostPerSqft          = Math.round(out.devCostPerSqft          * preset.hardCostMultiplier);

  // Duration adjustments
  if (out.projectDurationMonths) {
    out.projectDurationMonths = Math.round(out.projectDurationMonths * preset.durationMultiplier);
    out.projectDurationMonths = Math.min(180, Math.max(12, out.projectDurationMonths));
    if (out.constructionEndMonths) {
      out.constructionEndMonths = Math.round(out.constructionEndMonths * preset.durationMultiplier);
      out.constructionEndMonths = Math.min(out.projectDurationMonths, out.constructionEndMonths);
    }
  }

  // Financing adjustments
  if (out.financeCostPct != null) out.financeCostPct = Math.max(0, (out.financeCostPct || 12) + preset.financeDelta);
  if (out.debtRatePct != null)    out.debtRatePct    = Math.max(0, (out.debtRatePct    || 10.5) + preset.financeDelta);

  // Income asset adjustments
  if (preset.exitCapRateDelta && out.exitCapRate != null) {
    out.exitCapRate = Math.max(3, out.exitCapRate + preset.exitCapRateDelta);
    if (out.entryCapRate) out.entryCapRate = Math.max(3, out.entryCapRate + preset.exitCapRateDelta * 0.5);
  }
  if (preset.vacancyDelta && out.vacancyPct != null) {
    out.vacancyPct = Math.max(0, Math.min(50, out.vacancyPct + preset.vacancyDelta));
  }

  return out;
}

function calculateScenarios(baseInput) {
  const scenarios = {};
  for (const key of ['base', 'bull', 'bear']) {
    try {
      const scenarioInput  = applyScenarioPreset(baseInput, key);
      const result         = calculateFullFinancials(scenarioInput);
      scenarios[key] = {
        label:     SCENARIO_PRESETS[key].label,
        color:     SCENARIO_PRESETS[key].color,
        adjustments: key === 'base' ? null : {
          revenue:      `${key === 'bull' ? '+' : ''}${((SCENARIO_PRESETS[key].revenueMultiplier - 1) * 100).toFixed(0)}%`,
          hardCost:     `${key === 'bull' ? '' : '+'}${((SCENARIO_PRESETS[key].hardCostMultiplier - 1) * 100).toFixed(0)}%`,
          duration:     `${key === 'bull' ? '' : '+'}${((SCENARIO_PRESETS[key].durationMultiplier - 1) * 100).toFixed(0)}%`,
          financeRate:  `${SCENARIO_PRESETS[key].financeDelta > 0 ? '+' : ''}${SCENARIO_PRESETS[key].financeDelta}% pa`,
        },
        kpis:     result.kpis,
        costs:    result.costs,
        revenue:  result.revenue,
        capitalStack: result.capitalStack,
      };
    } catch (err) {
      scenarios[key] = {
        label: SCENARIO_PRESETS[key].label,
        color: SCENARIO_PRESETS[key].color,
        error: err.message,
        kpis: null, costs: null, revenue: null,
      };
    }
  }
  return scenarios;
}

// ─── MASTER DISPATCHER ───────────────────────────────────────────────────────

function calculateFullFinancials(input) {
  const assetClass = input.assetClass || 'residential_apartments';
  let result;
  switch (assetClass) {
    case 'residential_apartments': result = calculateResidentialApartments(input); break;
    case 'plotted_development':    result = calculatePlottedDevelopment(input); break;
    case 'commercial_office':
    case 'retail':
    case 'industrial_warehousing': result = calculateIncomeAsset({ ...input, assetClass }); break;
    case 'hospitality':            result = calculateHospitality(input); break;
    default: throw new Error(`Unknown asset class: ${assetClass}`);
  }
  return withLegacyAliases(result);
}

// ─── LEGACY SENSITIVITY ALIAS ─────────────────────────────────────────────────

function buildSensitivityMatrix(baseParams) {
  return buildResidentialSensitivity({
    ...baseParams,
    constructionCostPerSqft: baseParams.constructionCostPerSqft,
    sellingRatePerSqft:      baseParams.sellingRatePerSqft,
    contingencyPct:          baseParams.contingencyPct || 5,
    architectFeePct:         baseParams.architectFeePct || 2,
    pmcFeePct:               baseParams.pmcFeePct || 1.5,
  });
}

function buildLegacyCashFlows(input = {}) {
  const quarters = Math.max(1, Math.ceil((Number(input.projectDurationMonths) || 12) / 3));
  const cfs = new Array(quarters + 1).fill(0);

  const landCostCr = Number(input.landCostCr) || 0;
  const stampDutyCr = Number(input.stampDutyCr) || 0;
  const totalConstructionCostCr = Number(input.totalConstructionCostCr) || 0;
  const gstCostCr = Number(input.gstCostCr) || 0;
  const approvalCostCr = Number(input.approvalCostCr) || 0;
  const marketingCostCr = Number(input.marketingCostCr) || 0;
  const financeCostPct = Number(input.financeParams?.financeCostPct) || 0;
  const totalRevenueCr = Number(input.totalRevenueCr) || 0;

  cfs[0] = -(landCostCr + stampDutyCr + (approvalCostCr * 0.25));

  const developmentCostCr =
    totalConstructionCostCr
    + gstCostCr
    + (approvalCostCr * 0.75)
    + marketingCostCr
    + (totalConstructionCostCr * (financeCostPct / 100) * (quarters / 4));

  const spendWeights = sCurveWeights(quarters);
  for (let quarter = 1; quarter <= quarters; quarter += 1) {
    cfs[quarter] -= developmentCostCr * spendWeights[quarter - 1];
  }

  const salesStartQuarter = Math.max(1, Math.ceil(quarters * 0.5));
  const salesQuarters = quarters - salesStartQuarter + 1;
  const salesWeights = Array.from({ length: salesQuarters }, (_, index) => index + 1);
  const salesWeightTotal = salesWeights.reduce((sum, weight) => sum + weight, 0);

  for (let quarter = salesStartQuarter; quarter <= quarters; quarter += 1) {
    const weight = salesWeights[quarter - salesStartQuarter];
    cfs[quarter] += totalRevenueCr * (weight / salesWeightTotal);
  }

  return safeCashFlows(cfs);
}

function withLegacyAliases(result) {
  return {
    ...result,
    grossAreaSqft: result._legacy?.gross_area_sqft ?? result.areas?.grossBuiltUp ?? null,
    saleableAreaSqft: result._legacy?.saleable_area_sqft ?? result.areas?.saleable ?? null,
    totalConstructionCostCr: result._legacy?.total_construction_cost_cr ?? result.costs?.construction ?? null,
    totalRevenueCr: result._legacy?.total_revenue_cr ?? result.revenue?.totalRevenueCr ?? null,
    totalCostCr: result._legacy?.total_cost_cr ?? result.costs?.total ?? null,
    grossProfitCr: result._legacy?.gross_profit_cr ?? result.revenue?.grossProfitCr ?? null,
    grossMarginPct: result._legacy?.gross_margin_pct ?? result.kpis?.grossMarginPct ?? null,
    irrPct: result._legacy?.irr_pct ?? result.kpis?.irr ?? null,
    npvCr: result._legacy?.npv_cr ?? result.kpis?.npv ?? null,
    residualLandValueCr: result._legacy?.residual_land_value_cr ?? result.kpis?.rlv ?? null,
    equityMultiple: result._legacy?.equity_multiple ?? result.kpis?.equityMultiple ?? null,
    gstCostCr: result._legacy?.gst_cost_cr ?? result.costs?.gst ?? null,
    stampDutyCr: result._legacy?.stamp_duty_cr ?? result.costs?.stampDuty ?? null,
  };
}

module.exports = {
  calculateIRR,
  calculateNPV,
  calculateResidualLandValue,
  calculateFullFinancials,
  calculateScenarios,
  buildSensitivityMatrix,
  buildCashFlows: buildLegacyCashFlows,
  computeTerminalValue,
  SUPPORTED_TERMINAL_VALUE_METHODS: Array.from(SUPPORTED_TERMINAL_VALUE_METHODS),
  SUPPORTED_EXIT_STRATEGIES: Array.from(SUPPORTED_EXIT_STRATEGIES),
};
