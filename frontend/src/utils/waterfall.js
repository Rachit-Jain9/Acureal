'use strict';

/**
 * REDIP Waterfall Engine
 * Handles JDA (Joint Development Agreement) and JV (Joint Venture) profit distribution.
 * All monetary values in Crores (₹ Cr).
 *
 * JDA: Landowner delivers land; Developer builds and bears all costs.
 *      Output (area or revenue) is split by an agreed share %.
 *
 * JV:  Landowner contributes land at an agreed valuation; Developer contributes cash.
 *      Profit flows through tranches: capital return → preferred return → promote → residual.
 */

const round2 = (n) => (n != null && !isNaN(n) ? Math.round(n * 100) / 100 : null);
const round4 = (n) => (n != null && !isNaN(n) ? Math.round(n * 10000) / 10000 : null);

// ─── JDA / DEVELOPMENT AGREEMENT ─────────────────────────────────────────────

/**
 * Calculates the JDA waterfall.
 *
 * @param {object} params
 * @param {number} params.totalRevenueCr         - Total project revenue (₹ Cr)
 * @param {number} params.totalConstructionCostCr - Hard construction cost (₹ Cr)
 * @param {number} [params.approvalCostCr]        - Statutory + plan sanction costs
 * @param {number} [params.marketingCostCr]       - Sales & marketing costs
 * @param {number} [params.financeCostCr]         - Project finance/debt cost
 * @param {number} [params.landCostCr]            - Any upfront land payment by developer (partial)
 * @param {number} params.landownerSharePct       - Landowner's % share (0–100)
 * @param {string} [params.structureType]         - 'area_share' | 'revenue_share'
 */
export function calculateJDAWaterfall({
  totalRevenueCr,
  totalConstructionCostCr,
  approvalCostCr = 0,
  marketingCostCr = 0,
  financeCostCr = 0,
  landCostCr = 0,
  landownerSharePct,
  structureType = 'area_share',
}) {
  if (!(totalRevenueCr > 0)) return null;
  if (!(landownerSharePct >= 0 && landownerSharePct <= 100)) return null;

  const landownerRevenueCr = round2(totalRevenueCr * (landownerSharePct / 100));
  const developerRevenueCr = round2(totalRevenueCr - landownerRevenueCr);

  const devCostCr = round2(
    (totalConstructionCostCr || 0) +
    (approvalCostCr || 0) +
    (marketingCostCr || 0) +
    (financeCostCr || 0) +
    (landCostCr || 0)
  );

  const developerProfitCr = round2(developerRevenueCr - devCostCr);
  const developerMarginPct =
    developerRevenueCr > 0
      ? round2((developerProfitCr / developerRevenueCr) * 100)
      : null;
  const projectProfitCr = round2(totalRevenueCr - devCostCr);
  const projectMarginPct =
    totalRevenueCr > 0
      ? round2((projectProfitCr / totalRevenueCr) * 100)
      : null;

  // Effective land value implied by the area given away
  const implicitLandValueCr = landownerRevenueCr;

  return {
    structureType,
    landownerSharePct,
    developerSharePct: round2(100 - landownerSharePct),
    waterfall: [
      {
        party: 'Landowner',
        label: structureType === 'revenue_share' ? 'Revenue Share' : 'Area Allocation',
        grossCr: landownerRevenueCr,
        costCr: 0,
        netCr: landownerRevenueCr,
        marginPct: null,
      },
      {
        party: 'Developer',
        label: 'Developer Share (net of all costs)',
        grossCr: developerRevenueCr,
        costCr: devCostCr,
        netCr: developerProfitCr,
        marginPct: developerMarginPct,
      },
    ],
    summary: {
      totalRevenueCr: round2(totalRevenueCr),
      devCostCr,
      projectProfitCr,
      projectMarginPct,
      landownerNetCr: landownerRevenueCr,
      developerNetCr: developerProfitCr,
      developerMarginPct,
      implicitLandValueCr: round2(implicitLandValueCr),
    },
    costBreakdown: {
      construction: round2(totalConstructionCostCr),
      approval: round2(approvalCostCr),
      marketing: round2(marketingCostCr),
      finance: round2(financeCostCr),
      land: round2(landCostCr),
      total: devCostCr,
    },
  };
}

// ─── JOINT VENTURE ────────────────────────────────────────────────────────────

/**
 * Calculates the JV equity waterfall with preferred return and developer promote.
 *
 * Tranche order:
 *  1. Return of contributed capital (proportional to equity %)
 *  2. Preferred return (hurdle rate × hold period on equity)
 *  3. Developer promote (% of residual above promote threshold)
 *  4. Residual profit split by equity %
 *
 * @param {object} params
 * @param {number} params.totalRevenueCr              - Total project revenue (₹ Cr)
 * @param {number} params.totalCostCr                 - Total project cost (₹ Cr)
 * @param {number} params.landownerEquityCr           - Land value contributed (₹ Cr)
 * @param {number} params.developerEquityCr           - Cash / construction equity (₹ Cr)
 * @param {number} [params.preferredReturnPct]        - Hurdle rate % pa (default 8)
 * @param {number} [params.holdPeriodYears]           - Project/hold duration in years (default 3)
 * @param {number} [params.developerPromotePct]       - Developer carry above threshold (default 20)
 * @param {number} [params.promoteThresholdMultiple]  - Equity multiple to trigger promote (default 1.5)
 */
export function calculateJVWaterfall({
  totalRevenueCr,
  totalCostCr,
  landownerEquityCr,
  developerEquityCr,
  preferredReturnPct = 8,
  holdPeriodYears = 3,
  developerPromotePct = 20,
  promoteThresholdMultiple = 1.5,
}) {
  if (!(totalRevenueCr > 0) || !(totalCostCr > 0)) return null;
  if (!(landownerEquityCr >= 0) || !(developerEquityCr >= 0)) return null;

  const totalEquityCr = round2(landownerEquityCr + developerEquityCr);
  if (!(totalEquityCr > 0)) return null;

  const landownerEquityPct = round4((landownerEquityCr / totalEquityCr) * 100);
  const developerEquityPct = round4(100 - landownerEquityPct);
  const totalProjectProfitCr = round2(totalRevenueCr - totalCostCr);
  const totalReturnMultiple = round2((totalEquityCr + Math.max(0, totalProjectProfitCr)) / totalEquityCr);

  const waterfall = [];
  let remaining = Math.max(0, totalProjectProfitCr);

  // ── Tranche 1: Return of Capital ────────────────────────────────────────────
  waterfall.push({
    tranche: 'Return of Capital',
    landownerCr: round2(landownerEquityCr),
    developerCr: round2(developerEquityCr),
    totalCr: round2(totalEquityCr),
    note: 'Equity contribution returned pro-rata',
    fromProfit: false,
  });

  // ── Tranche 2: Preferred Return ──────────────────────────────────────────────
  const prefTotal = round2(totalEquityCr * (preferredReturnPct / 100) * holdPeriodYears);
  const actualPref = round2(Math.min(prefTotal, remaining));
  const prefLandowner = round2(actualPref * (landownerEquityPct / 100));
  const prefDeveloper = round2(actualPref - prefLandowner);
  const prefFunded = remaining >= prefTotal;
  waterfall.push({
    tranche: `Preferred Return (${preferredReturnPct}% pa × ${holdPeriodYears} yr)`,
    landownerCr: prefLandowner,
    developerCr: prefDeveloper,
    totalCr: actualPref,
    note: prefFunded ? 'Fully funded' : 'Partially funded — profit shortfall',
    fromProfit: true,
  });
  remaining = round2(remaining - actualPref);

  // ── Tranche 3: Developer Promote ─────────────────────────────────────────────
  let promoteTriggered = false;
  if (remaining > 0.001 && totalReturnMultiple >= promoteThresholdMultiple && developerPromotePct > 0) {
    const promoteCr = round2(remaining * (developerPromotePct / 100));
    promoteTriggered = true;
    waterfall.push({
      tranche: `Developer Promote (${developerPromotePct}% above ${promoteThresholdMultiple}x)`,
      landownerCr: 0,
      developerCr: promoteCr,
      totalCr: promoteCr,
      note: `${totalReturnMultiple.toFixed(2)}x ≥ ${promoteThresholdMultiple}x threshold — promote triggered`,
      fromProfit: true,
    });
    remaining = round2(remaining - promoteCr);
  }

  // ── Tranche 4: Residual Profit Split ─────────────────────────────────────────
  if (remaining > 0.001) {
    const residLandowner = round2(remaining * (landownerEquityPct / 100));
    const residDeveloper = round2(remaining - residLandowner);
    waterfall.push({
      tranche: 'Residual Profit',
      landownerCr: residLandowner,
      developerCr: residDeveloper,
      totalCr: round2(remaining),
      note: `${round2(landownerEquityPct).toFixed(1)} / ${round2(developerEquityPct).toFixed(1)} equity split`,
      fromProfit: true,
    });
  }

  // ── Totals ────────────────────────────────────────────────────────────────────
  const profitTranches = waterfall.filter((t) => t.fromProfit);
  const landownerProfit = round2(profitTranches.reduce((s, t) => s + (t.landownerCr || 0), 0));
  const developerProfit = round2(profitTranches.reduce((s, t) => s + (t.developerCr || 0), 0));
  const landownerTotal = round2(landownerEquityCr + landownerProfit);
  const developerTotal = round2(developerEquityCr + developerProfit);

  return {
    landownerEquityPct: round2(landownerEquityPct),
    developerEquityPct: round2(developerEquityPct),
    totalEquityCr,
    totalProjectProfitCr,
    totalReturnMultiple,
    promoteTriggered,
    waterfall,
    summary: {
      totalRevenueCr: round2(totalRevenueCr),
      totalCostCr: round2(totalCostCr),
      totalProjectProfitCr,
      landownerProfit,
      developerProfit,
      landownerTotal,
      developerTotal,
      landownerMultiple: landownerEquityCr > 0 ? round2(landownerTotal / landownerEquityCr) : null,
      developerMultiple: developerEquityCr > 0 ? round2(developerTotal / developerEquityCr) : null,
    },
  };
}

// ─── DEBT SCHEDULE ────────────────────────────────────────────────────────────

/**
 * Builds a quarterly debt draw-and-repayment schedule.
 * Draws follow an S-curve during the construction window.
 * Repayment is a balloon at the end of the project (typical Indian construction finance).
 *
 * @param {object} params
 * @param {number} params.debtDrawnCr              - Total debt facility drawn (₹ Cr)
 * @param {number} params.debtRatePct              - Annual interest rate (%)
 * @param {number} params.projectDurationMonths    - Total project duration in months
 * @param {number} [params.constructionStartMonths] - Month when construction begins
 * @param {number} [params.constructionEndMonths]   - Month when construction completes
 */
export function buildDebtSchedule({
  debtDrawnCr,
  debtRatePct,
  projectDurationMonths,
  constructionStartMonths = 0,
  constructionEndMonths,
}) {
  if (!(debtDrawnCr > 0) || !(debtRatePct > 0) || !(projectDurationMonths > 0)) return null;

  const totalQ = Math.ceil(projectDurationMonths / 3);
  const constStartQ = Math.max(0, Math.floor(constructionStartMonths / 3));
  const constEndQ = Math.min(totalQ, Math.ceil((constructionEndMonths || projectDurationMonths * 0.85) / 3));
  const constDurQ = Math.max(2, constEndQ - constStartQ);
  const quarterlyRate = debtRatePct / 100 / 4;

  // S-curve weights for draw schedule
  const weights = Array.from({ length: constDurQ }, (_, q) => {
    const p = (q + 1) / constDurQ;
    return Math.max(0.01, Math.sin(p * Math.PI) * 1.5);
  });
  const wTotal = weights.reduce((a, b) => a + b, 0);
  const normWeights = weights.map((w) => w / wTotal);

  let balance = 0;
  let cumulativeInterest = 0;
  const rows = [];

  for (let q = 0; q <= totalQ; q++) {
    const drawIdx = q - constStartQ - 1;
    const draw =
      q > constStartQ && q <= constEndQ && normWeights[drawIdx] != null
        ? round2(debtDrawnCr * normWeights[drawIdx])
        : 0;

    const isRepaymentQ = q === totalQ;
    const repayment = isRepaymentQ ? round2(-balance - draw) : 0;

    const openingBalance = balance;
    balance = round2(balance + draw + repayment);
    const interest = round2(Math.max(0, openingBalance + draw) * quarterlyRate);
    cumulativeInterest = round2(cumulativeInterest + interest);

    if (draw !== 0 || repayment !== 0 || openingBalance !== 0) {
      rows.push({
        quarter: q,
        draw: draw || 0,
        repayment: repayment || 0,
        openingBalance: openingBalance || 0,
        closingBalance: balance || 0,
        interest,
        cumulativeInterest,
      });
    }
  }

  return {
    totalDebtCr: round2(debtDrawnCr),
    totalInterestCr: round2(cumulativeInterest),
    debtRatePct,
    rows,
  };
}
