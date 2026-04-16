'use strict';

/**
 * REDIP Financial Engine — Institutional Grade
 * Multi-asset-class: Residential, Plotted, Commercial Office, Retail, Industrial
 * All monetary values in Crores (₹ Cr) | All areas in sqft
 * Supports: capital stack, contingency, soft costs, scenario analysis
 */

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const STAMP_DUTY_RATE = 0.05;  // Stamp duty on land (avg India, varies 3-8%)
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
  const financeCostPct       = Number(input.financeCostPct) || 12;
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
  // Finance cost: weighted by average outstanding balance over construction period
  // Land is outstanding from day 0; construction draws down over time (avg ~50% outstanding)
  const landFinanceCr    = landCostCr * (financeCostPct / 100) * (durationMonths / 12);
  const constFinanceCr   = hardCostCr * (financeCostPct / 100) * ((constructionEndMonths - constructionStartMonths) / 12) * 0.5;
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

  // Finance cost: spread across project
  if (financeCostCr > 0 && totalQ >= 1) {
    for (let q = 1; q <= totalQ; q++) cfs[q] -= financeCostCr / totalQ;
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
        plotAreaSqft, fsi, loadingFactor, constructionCostSqft, sellingRateSqft,
        landCostCr, approvalCostCr, marketingCostPct, financeCostPct,
        durationMonths, discountRatePct, developerMarginPct,
        contingencyPct, architectFeePct, pmcFeePct,
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
      noi: null, yieldOnCost: null, dscr: null, exitValue: null, entryValue: null,
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
  const financeCostPct     = Number(input.financeCostPct) || 12;
  const discountRatePct    = Number(input.discountRatePct) || 14;
  const contingencyPct     = Number(input.contingencyPct) || 3;
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
  // Finance cost: duration-weighted — land from day 0, dev costs drawn over time
  const landFinPlotCr   = landCostCr * (financeCostPct / 100) * (durationMonths / 12);
  const devFinPlotCr    = devCostCr * (financeCostPct / 100) * (durationMonths / 12) * 0.5;
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
    for (let q = 1; q <= totalQ; q++) cfs[q] -= financeCostCr / totalQ;
  }

  const cashFlows = safeCashFlows(cfs);
  let irrPct = null, npvCr = null;
  try { irrPct = calculateIRR(cashFlows); } catch { /* skip */ }
  try { npvCr  = calculateNPV(cashFlows, discountRatePct / 100); } catch { /* skip */ }

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
    },
    kpis: {
      irr: round4(irrPct), npv: round4(npvCr),
      equityMultiple: round4(equityMultiple), rlv: round4(rlvCr),
      grossMarginPct: round4(grossMarginPct),
      leveredIrr: null, leveredNpv: null,
      // Per-plot / per-sqft metrics
      revenuePerPlot: totalPlots > 0 ? round2((totalRevenueCr * 1e7) / totalPlots) : null,
      costPerPlot:    totalPlots > 0 ? round2((totalCostCr * 1e7) / totalPlots) : null,
      profitPerPlot:  totalPlots > 0 ? round2((grossProfitCr * 1e7) / totalPlots) : null,
      landCostPerSqft: totalLandSqft > 0 ? round2((landCostCr * 1e7) / totalLandSqft) : null,
      revenuePerSqft:  saleableLandSqft > 0 ? round2((totalRevenueCr * 1e7) / saleableLandSqft) : null,
      noi: null, yieldOnCost: null, dscr: null, exitValue: null, entryValue: null,
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
    capitalStack: null,
    timeline: outputTimeline,
    cashFlows: structureCashFlows(cashFlows, outputTimeline),
    sensitivityMatrix: skipSensitivity
      ? null
      : buildPlottedSensitivity({
          totalLandSqft, saleableLandPct, avgPlotSizeSqft,
          sellingRatePerSqft, landCostCr, devCostPerSqft, approvalCostCr,
          marketingCostPct, financeCostPct, durationMonths, discountRatePct, contingencyPct,
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
  const contingencyPct         = Number(input.contingencyPct) || 4;
  const exitStrategy           = resolveExitStrategy(input.exitStrategy);
  const lrdLTV                 = resolveDebtRatio(input.lrdLTV, 0.65);
  const lrdInterestRatePct     = Number(input.lrdInterestRatePct) || 9;
  const maxRefinanceYear       = Math.max(1, holdPeriodYears - 1);
  const lrdRefinanceYear       = Number(input.lrdRefinanceYear) > 0
    ? Math.min(Number(input.lrdRefinanceYear), maxRefinanceYear)
    : Math.max(1, Math.floor(holdPeriodYears / 2));
  const forwardPurchasePriceCr = Number(input.forwardPurchasePriceCr) || 0;
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
  const exitValueCr            = noiAtExit / (exitCapRate / 100);
  const effectiveExitValueCr   = exitStrategy === 'forward_purchase' && forwardPurchasePriceCr > 0
    ? forwardPurchasePriceCr : exitValueCr;

  const constQ = Math.ceil(constructionMonths / 3);
  const opQ    = holdPeriodYears * 4;
  const totalQ = constQ + opQ;
  const cfs    = new Array(totalQ + 1).fill(0);
  const lrdRefinanceQ  = exitStrategy === 'lrd' ? Math.min(constQ + lrdRefinanceYear * 4, totalQ) : 0;
  const lrdProceeds    = exitStrategy === 'lrd' ? lrdLTV * entryValueCr : 0;
  const lrdQInterest   = exitStrategy === 'lrd' ? (lrdProceeds * (lrdInterestRatePct / 100)) / 4 : 0;

  cfs[0] -= landCostCr + stampDutyCr + approvalCostCr * 0.25;
  if (constQ >= 2) { cfs[1] -= approvalCostCr * 0.375; cfs[2] -= approvalCostCr * 0.375; }

  const cweights = sCurveWeights(constQ);
  for (let q = 0; q < constQ && q + 1 <= totalQ; q++) {
    cfs[q + 1] -= (constructionCostCr + gstCostCr + contingencyCr) * cweights[q];
  }
  if (constQ >= 1) cfs[constQ] -= tiCostCr + lcCostCr;
  if (!input._phase1Mode && exitStrategy === 'lrd' && lrdRefinanceQ > 0) cfs[lrdRefinanceQ] += lrdProceeds;

  // Operating phase with lease-up ramp
  for (let q = 1; q <= opQ; q++) {
    const yearIdx         = Math.ceil(q / 4);
    const occupancyFactor = q <= 2 ? 0.60 : q === 3 ? 0.80 : (1 - vacancyPct / 100);
    const rentEsc         = Math.pow(1 + rentEscalationPct / 100, yearIdx - 1);
    const qRent           = (leasableAreaSqft * effectiveBaseRent * 3 * rentEsc * occupancyFactor) / 1e7;
    const qNOI            = qRent * (1 - opexPct / 100);
    const cfIdx           = constQ + q;
    if (cfIdx <= totalQ) {
      cfs[cfIdx] += qNOI;
      if (!input._phase1Mode && exitStrategy === 'lrd' && lrdQInterest > 0 && cfIdx >= lrdRefinanceQ) {
        cfs[cfIdx] -= lrdQInterest;
      }
    }
  }
  if (!input._phase1Mode) {
    cfs[totalQ] += exitStrategy === 'lrd' ? effectiveExitValueCr - lrdProceeds : effectiveExitValueCr;
  }
  const rawCFs = [...cfs];

  const cashFlows  = safeCashFlows(cfs);
  let irrPct = null, npvCr = null;
  try { irrPct = calculateIRR(cashFlows); } catch { /* skip */ }
  try { npvCr  = calculateNPV(cashFlows, discountRatePct / 100); } catch { /* skip */ }

  const totalReturns   = cashFlows.filter((c) => c > 0).reduce((a, b) => a + b, 0);
  const equityMultiple = totalDevCostCr > 0 ? totalReturns / totalDevCostCr : null;

  // DSCR
  let dscr = null;
  if (debtCoverage > 0 && interestRatePct > 0) {
    const debtAmt          = totalDevCostCr * debtCoverage;
    const r                = interestRatePct / 100;
    const n                = holdPeriodYears;
    const annualDebtService = debtAmt * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    dscr = annualDebtService > 0 ? round2(stabilizedNOICr / annualDebtService) : null;
  }

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
      discountRatePct, debtCoverage, interestRatePct,
      exitStrategy,
      lrdLTV: exitStrategy === 'lrd' ? lrdLTV : null,
      lrdInterestRatePct: exitStrategy === 'lrd' ? lrdInterestRatePct : null,
      lrdRefinanceYear: exitStrategy === 'lrd' ? lrdRefinanceYear : null,
      forwardPurchasePriceCr: exitStrategy === 'forward_purchase' ? forwardPurchasePriceCr : null,
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
      yieldOnCost:   round4(yieldOnCost),
      dscr,
      exitValue:     round4(effectiveExitValueCr),
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
      exitValue:        round4(effectiveExitValueCr),
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
      dscr,
    } : null,
    timeline: outputTimeline,
    cashFlows: structureCashFlows(cashFlows, outputTimeline),
    sensitivityMatrix: sensitivity,
    _legacy: {
      land_cost_cr: landCostCr,
      total_cost_cr: round4(totalDevCostCr),
      total_revenue_cr: round4(exitValueCr),
      gross_profit_cr: round4(exitValueCr - totalDevCostCr),
      gross_margin_pct: totalDevCostCr > 0 ? round4((exitValueCr - totalDevCostCr) / exitValueCr * 100) : null,
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
  const sellingRates      = vars.map((v) => Math.round(p.sellingRateSqft * (1 + v)));
  const constructionCosts = vars.map((v) => Math.round(p.constructionCostSqft * (1 + v)));
  const irrGrid = constructionCosts.map((cc) =>
    sellingRates.map((sr) => {
      try {
        const r = calculateResidentialApartments({
          ...p,
          constructionCostPerSqft: cc,
          sellingRatePerSqft: sr,
          contingencyPct: p.contingencyPct,
          architectFeePct: p.architectFeePct,
          pmcFeePct: p.pmcFeePct,
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
  const sellingRates = vars.map((v) => Math.round(p.sellingRatePerSqft * (1 + v)));
  const devCosts     = vars.map((v) => Math.round(p.devCostPerSqft * (1 + v)));
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

// ─── HOSPITALITY ─────────────────────────────────────────────────────────────
// Hotel underwriting: keys-based model, RevPAR → GOP → EBITDA → Exit

function calculateHospitality(input) {
  const keys                 = Math.round(Number(input.keys) || 100);
  const constructionCostKey  = Number(input.constructionCostPerKey) || 8000000; // ₹ per key (not Cr)
  const landCostCr           = Number(input.landCostCr) || 0;
  const preOpeningCostKey    = Number(input.preOpeningCostPerKey) || 300000;    // ₹ per key
  const adr                  = Number(input.adr) || 6000;                      // Average Daily Rate ₹
  const adrGrowthPct         = Number(input.adrGrowthPct) || 5;
  const stabilizedOccPct     = Number(input.stabilizedOccPct) || 65;
  const holdPeriodYears      = Number(input.holdPeriodYears) || 8;
  const fbRevPct             = Number(input.fbRevPct) || 25;                   // F&B as % of rooms rev
  const otherRevPct          = Number(input.otherRevPct) || 10;                // Other revenue as %
  const gopMarginPct         = Number(input.gopMarginPct) || 35;               // GOP % of total revenue
  const ebitdaMarginPct      = Number(input.ebitdaMarginPct) || 28;            // EBITDA after mgmt fee
  const exitCapRate          = Number(input.exitCapRate) || 9;
  const discountRatePct      = Number(input.discountRatePct) || 15;
  const debtCoverage         = resolveDebtRatio(input.debtCoverage, 0);
  const interestRatePct      = Number(input.interestRatePct) || 10.5;
  const contingencyPct       = Number(input.contingencyPct) || 5;
  const exitStrategy         = resolveExitStrategy(input.exitStrategy);
  const lrdLTV               = resolveDebtRatio(input.lrdLTV, 0.55);
  const lrdInterestRatePct   = Number(input.lrdInterestRatePct) || 9.5;
  const maxRefinanceYear     = Math.max(1, holdPeriodYears - 1);
  const lrdRefinanceYear     = Number(input.lrdRefinanceYear) > 0
    ? Math.min(Number(input.lrdRefinanceYear), maxRefinanceYear)
    : Math.max(1, Math.floor(holdPeriodYears / 2));
  const forwardPurchasePriceCr = Number(input.forwardPurchasePriceCr) || 0;
  const timeline = resolveTimelineInput(input, {
    defaultDurationYears: 2.5,
    defaultConstructionStartYears: 0,
    defaultConstructionEndRatio: 1,
  });
  const constructionMonths = timeline.projectDurationMonths;

  if (keys <= 0)                   throw new Error('Number of keys must be positive');
  if (constructionCostKey <= 0)    throw new Error('Construction cost per key must be positive');
  if (adr <= 0)                    throw new Error('ADR must be positive');
  if (stabilizedOccPct <= 0 || stabilizedOccPct > 100) throw new Error('Occupancy must be 0–100%');
  if (exitCapRate <= 0 || exitCapRate > 30) throw new Error('Exit cap rate must be 0–30%');
  if (timeline.projectDurationYears < MIN_PROJECT_DURATION_YEARS || timeline.projectDurationYears > MAX_PROJECT_DURATION_YEARS) {
    throw new Error(`Project duration must be between ${MIN_PROJECT_DURATION_YEARS} and ${MAX_PROJECT_DURATION_YEARS} years`);
  }

  // Development costs
  const constructionCostCr = (keys * constructionCostKey) / 1e7;
  const gstRateInput       = resolveGstRate(input, 'hospitality');
  const gstCostCr          = constructionCostCr * gstRateInput;
  const contingencyCr      = constructionCostCr * (contingencyPct / 100);
  const preOpeningCostCr   = (keys * preOpeningCostKey) / 1e7;
  const stampDutyCr        = landCostCr * STAMP_DUTY_RATE;
  const approvalCostCr     = Number(input.approvalCostPerSqft) > 0
    ? (keys * 600 * Number(input.approvalCostPerSqft)) / 1e7
    : Number(input.approvalCostCr) || 0;
  const hardCostCr         = constructionCostCr + gstCostCr + contingencyCr;
  const totalDevCostCr     = landCostCr + stampDutyCr + hardCostCr + preOpeningCostCr + approvalCostCr;

  // Stabilized Year 1 Operating Model
  // Ramp-up schedule: 40% occ Y1, 55% Y2, stabilized from Y3
  const occupancyRamp = [0.40, 0.55, stabilizedOccPct / 100];

  const revPARStabilized  = adr * (stabilizedOccPct / 100);                    // ₹/key/night
  const roomsRevCrY1Stab  = (keys * revPARStabilized * 365) / 1e7;
  const fbRevCrY1Stab     = roomsRevCrY1Stab * (fbRevPct / 100);
  const otherRevCrY1Stab  = roomsRevCrY1Stab * (otherRevPct / 100);
  const totalRevCrY1Stab  = roomsRevCrY1Stab + fbRevCrY1Stab + otherRevCrY1Stab;
  const gopCrY1Stab       = totalRevCrY1Stab * (gopMarginPct / 100);
  const ebitdaCrY1Stab    = totalRevCrY1Stab * (ebitdaMarginPct / 100);

  const yieldOnCost   = totalDevCostCr > 0 ? (ebitdaCrY1Stab / totalDevCostCr) * 100 : 0;
  const exitEBITDA    = ebitdaCrY1Stab * Math.pow(1 + adrGrowthPct / 100, holdPeriodYears);
  const exitValueCr   = exitEBITDA / (exitCapRate / 100);
  const entryValueCr  = ebitdaCrY1Stab / (exitCapRate / 100);
  const effectiveExitValueCr = exitStrategy === 'forward_purchase' && forwardPurchasePriceCr > 0
    ? forwardPurchasePriceCr
    : exitValueCr;

  // Cash flows
  const constQ   = Math.ceil(constructionMonths / 3);
  const opQ      = holdPeriodYears * 4;
  const totalQ   = constQ + opQ;
  const cfs      = new Array(totalQ + 1).fill(0);
  const lrdRefinanceQ = exitStrategy === 'lrd' ? Math.min(constQ + lrdRefinanceYear * 4, totalQ) : 0;
  const lrdProceeds = exitStrategy === 'lrd' ? lrdLTV * entryValueCr : 0;
  const lrdQInterest = exitStrategy === 'lrd' ? (lrdProceeds * (lrdInterestRatePct / 100)) / 4 : 0;

  // Development phase
  cfs[0] -= landCostCr + stampDutyCr + approvalCostCr * 0.25;
  if (constQ >= 2) { cfs[1] -= approvalCostCr * 0.375; }
  if (constQ >= 3) { cfs[2] -= approvalCostCr * 0.375; }
  // Pre-opening costs in final 2 construction quarters
  const preOpenQ = Math.min(2, constQ);
  for (let q = constQ - preOpenQ; q < constQ; q++) {
    if (q + 1 <= totalQ) cfs[q + 1] -= preOpeningCostCr / preOpenQ;
  }
  // Construction S-curve (hard costs)
  const cweights = sCurveWeights(constQ);
  for (let q = 0; q < constQ && q + 1 <= totalQ; q++) {
    cfs[q + 1] -= hardCostCr * cweights[q];
  }
  if (exitStrategy === 'lrd' && lrdRefinanceQ > 0) {
    cfs[lrdRefinanceQ] += lrdProceeds;
  }

  // Operating phase with ramp-up and annual ADR growth
  for (let q = 1; q <= opQ; q++) {
    const yearIdx = Math.ceil(q / 4); // 1-based
    const occ     = yearIdx <= 1 ? occupancyRamp[0] : yearIdx === 2 ? occupancyRamp[1] : occupancyRamp[2];
    const adrThis = adr * Math.pow(1 + adrGrowthPct / 100, yearIdx - 1);
    const revPAR  = adrThis * occ;
    const qRoomsRev = (keys * revPAR * 91.25) / 1e7;                          // ~91.25 days/quarter
    const qTotalRev = qRoomsRev * (1 + fbRevPct / 100 + otherRevPct / 100);
    const qEBITDA   = qTotalRev * (ebitdaMarginPct / 100);
    const cfIdx     = constQ + q;
    if (cfIdx <= totalQ) {
      cfs[cfIdx] += qEBITDA;
      if (exitStrategy === 'lrd' && lrdQInterest > 0 && cfIdx >= lrdRefinanceQ) {
        cfs[cfIdx] -= lrdQInterest;
      }
    }
  }
  cfs[totalQ] += exitStrategy === 'lrd' ? effectiveExitValueCr - lrdProceeds : effectiveExitValueCr;

  const cashFlows = safeCashFlows(cfs);
  let irrPct = null, npvCr = null;
  try { irrPct = calculateIRR(cashFlows); } catch { /* skip */ }
  try { npvCr  = calculateNPV(cashFlows, discountRatePct / 100); } catch { /* skip */ }

  const totalReturns   = cashFlows.filter((c) => c > 0).reduce((a, b) => a + b, 0);
  const equityMultiple = totalDevCostCr > 0 ? totalReturns / totalDevCostCr : null;

  let dscr = null;
  if (debtCoverage > 0 && interestRatePct > 0) {
    const debtAmt          = totalDevCostCr * debtCoverage;
    const r                = interestRatePct / 100;
    const n                = holdPeriodYears;
    const annualDebtService = debtAmt * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    dscr = annualDebtService > 0 ? round2(ebitdaCrY1Stab / annualDebtService) : null;
  }

  // Sensitivity: rows = occupancy, columns = ADR
  const occVars  = [-15, -10, 0, 10, 15].map((d) => Math.max(20, Math.min(95, stabilizedOccPct + d)));
  const adrVars  = [-0.20, -0.10, 0, 0.10, 0.20].map((v) => Math.round(adr * (1 + v)));
  const irrGrid  = occVars.map((occ) =>
    adrVars.map((a) => {
      try {
        return calculateIRR(safeCashFlows(buildHospitalityQuickCFs({
          keys, constructionCostCr: hardCostCr, landCostCr, stampDutyCr, approvalCostCr,
          preOpeningCostCr, adr: a, stabilizedOccPct: occ, adrGrowthPct,
          fbRevPct, otherRevPct, ebitdaMarginPct, exitCapRate, holdPeriodYears, constQ, opQ,
        })));
      } catch { return null; }
    })
  );

  const outputTimeline = buildTimeline({
    ...timeline,
    holdPeriodYears,
  });

  return {
    assetClass: 'hospitality',
    inputs: {
      keys, constructionCostPerKey: constructionCostKey, landCostCr, approvalCostCr,
      approvalCostPerSqft: Number(input.approvalCostPerSqft) || null,
      gstPct: round2(gstRateInput * 100),
      preOpeningCostPerKey: preOpeningCostKey, adr, adrGrowthPct, stabilizedOccPct,
      effectiveDate: outputTimeline.effectiveDate,
      projectDurationYears: outputTimeline.projectDurationYears,
      projectDurationMonths: constructionMonths,
      holdPeriodYears, fbRevPct, otherRevPct,
      gopMarginPct, ebitdaMarginPct, exitCapRate, discountRatePct, debtCoverage,
      interestRatePct, contingencyPct,
      exitStrategy,
      lrdLTV: exitStrategy === 'lrd' ? lrdLTV : null,
      lrdInterestRatePct: exitStrategy === 'lrd' ? lrdInterestRatePct : null,
      lrdRefinanceYear: exitStrategy === 'lrd' ? lrdRefinanceYear : null,
      forwardPurchasePriceCr: exitStrategy === 'forward_purchase' ? forwardPurchasePriceCr : null,
    },
    kpis: {
      irr:           round4(irrPct),
      npv:           round4(npvCr),
      equityMultiple: round4(equityMultiple),
      rlv:           null,
      grossMarginPct: round4(ebitdaMarginPct),
      leveredIrr:    null,
      leveredNpv:    null,
      noi:           round4(ebitdaCrY1Stab),
      yieldOnCost:   round4(yieldOnCost),
      dscr,
      exitValue:     round4(effectiveExitValueCr),
      entryValue:    round4(entryValueCr),
      revPAR:        round2(revPARStabilized),
      gopMargin:     round2(gopMarginPct),
      // Per-key metrics
      devCostPerKey:   keys > 0 ? round2((totalDevCostCr * 1e7) / keys) : null,
      revenuePerKey:   keys > 0 ? round2((totalRevCrY1Stab * 1e7) / keys) : null,
      ebitdaPerKey:    keys > 0 ? round2((ebitdaCrY1Stab * 1e7) / keys) : null,
      gopPAR:          keys > 0 ? round2((gopCrY1Stab * 1e7) / (keys * 365)) : null,
      tRevPAR:         keys > 0 ? round2((totalRevCrY1Stab * 1e7) / (keys * 365)) : null,
    },
    areas: {
      leasable:    null,
      grossBuiltUp: round2(keys * 600),
      saleable:    null, carpet: null, superBuiltUp: null,
      keys,
    },
    costs: {
      land:           round4(landCostCr),
      construction:   round4(constructionCostCr),
      gst:            round4(gstCostCr),
      contingency:    round4(contingencyCr),
      stampDuty:      round4(stampDutyCr),
      approval:       round4(approvalCostCr),
      preOpening:     round4(preOpeningCostCr),
      architecture:   null, pmc: null, marketing: null, finance: null,
      hardCostTotal:  round4(landCostCr + stampDutyCr + hardCostCr),
      softCostTotal:  round4(approvalCostCr + preOpeningCostCr),
      total:          round4(totalDevCostCr),
      tenantImprovements: null, leasingCommissions: null,
    },
    revenue: {
      totalRevenueCr:     round4(totalRevCrY1Stab),
      grossProfitCr:      null,
      grossMarginPct:     null,
      annualNOI:          round4(ebitdaCrY1Stab),
      stabilizedNOI:      round4(ebitdaCrY1Stab),
      exitValue:          round4(effectiveExitValueCr),
      revPAR:             round2(revPARStabilized),
      roomsRevenue:       round4(roomsRevCrY1Stab),
      fbRevenue:          round4(fbRevCrY1Stab),
      gop:                round4(gopCrY1Stab),
      ebitda:             round4(ebitdaCrY1Stab),
    },
    capitalStack: debtCoverage > 0 ? {
      totalCostCr: round4(totalDevCostCr),
      debtCr:      round4(totalDevCostCr * debtCoverage),
      equityCr:    round4(totalDevCostCr * (1 - debtCoverage)),
      debtPct:     round2(debtCoverage * 100),
      equityPct:   round2((1 - debtCoverage) * 100),
      dscr,
    } : null,
    timeline: outputTimeline,
    cashFlows: structureCashFlows(cashFlows, outputTimeline),
    sensitivityMatrix: { sellingRates: adrVars, constructionCosts: occVars, irrGrid, axis: ['Occupancy (%)', 'ADR (₹)'], variations: occVars.map((o) => `${o}%`) },
    _legacy: {
      land_cost_cr:          landCostCr,
      total_cost_cr:         round4(totalDevCostCr),
      total_revenue_cr:      round4(exitValueCr),
      gross_profit_cr:       round4(exitValueCr - totalDevCostCr),
      gross_margin_pct:      round4(ebitdaMarginPct),
      npv_cr:                round4(npvCr),
      irr_pct:               round4(irrPct),
      equity_multiple:       round4(equityMultiple),
      project_duration_months: constructionMonths,
      discount_rate_pct:     discountRatePct,
    },
  };
}

function buildHospitalityQuickCFs(p) {
  const { keys, constructionCostCr, landCostCr, stampDutyCr, approvalCostCr,
    preOpeningCostCr, adr, stabilizedOccPct, adrGrowthPct, fbRevPct, otherRevPct,
    ebitdaMarginPct, exitCapRate, holdPeriodYears, constQ, opQ } = p;
  const totalQ = constQ + opQ;
  const cfs = new Array(totalQ + 1).fill(0);
  cfs[0] = -(landCostCr + stampDutyCr + approvalCostCr + constructionCostCr + preOpeningCostCr);
  const ramp = [0.40, 0.55, stabilizedOccPct / 100];
  for (let q = 1; q <= opQ; q++) {
    const yi    = Math.ceil(q / 4);
    const occ   = yi <= 1 ? ramp[0] : yi === 2 ? ramp[1] : ramp[2];
    const aDR   = adr * Math.pow(1 + adrGrowthPct / 100, yi - 1);
    const rev   = (keys * aDR * occ * 91.25) / 1e7 * (1 + fbRevPct / 100 + otherRevPct / 100);
    const ebi   = rev * (ebitdaMarginPct / 100);
    if (constQ + q <= totalQ) cfs[constQ + q] = ebi;
  }
  const stab = (keys * adr * (stabilizedOccPct/100) * 365 / 1e7) * (1 + fbRevPct/100 + otherRevPct/100);
  const exitE = stab * (ebitdaMarginPct/100) * Math.pow(1 + adrGrowthPct/100, holdPeriodYears);
  cfs[totalQ] += exitE / (exitCapRate / 100);
  return safeCashFlows(cfs);
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
    plotAreaSqft:         baseParams.plotAreaSqft,
    fsi:                  baseParams.fsi,
    loadingFactor:        baseParams.loadingFactor,
    constructionCostSqft: baseParams.constructionCostPerSqft,
    sellingRateSqft:      baseParams.sellingRatePerSqft,
    landCostCr:           baseParams.landCostCr,
    approvalCostCr:       baseParams.approvalCostCr,
    marketingCostPct:     baseParams.marketingCostPct,
    financeCostPct:       baseParams.financeCostPct,
    durationMonths:       baseParams.projectDurationMonths,
    discountRatePct:      baseParams.discountRatePct,
    developerMarginPct:   baseParams.developerMarginPct,
    contingencyPct:       baseParams.contingencyPct || 5,
    architectFeePct:      baseParams.architectFeePct || 2,
    pmcFeePct:            baseParams.pmcFeePct || 1.5,
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
};
