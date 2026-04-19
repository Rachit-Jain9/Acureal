'use strict';

/**
 * REDIP Waterfall Engine — Backend / Institutional Grade
 *
 * Supports:
 *   • JDA (Joint Development Agreement): area_share or revenue_share split
 *   • JV (Joint Venture): capital return → preferred return (simple | compound)
 *                         → GP catch-up (optional) → promote → residual equity split
 *   • Debt draw/repayment schedule (shared with frontend)
 *
 * All monetary values are in ₹ Crores. All percentages are percent (0–100), not fractional.
 */

const round2 = (n) => (n != null && !isNaN(n) ? Math.round(n * 100) / 100 : null);
const round4 = (n) => (n != null && !isNaN(n) ? Math.round(n * 10000) / 10000 : null);

const SUPPORTED_STRUCTURES = new Set(['area_share', 'revenue_share']);
const SUPPORTED_PREF_TYPES = new Set(['simple', 'compound']);

// ── JDA ────────────────────────────────────────────────────────────────────────

function calculateJDA(params) {
  const {
    totalRevenueCr,
    totalConstructionCostCr = 0,
    approvalCostCr = 0,
    marketingCostCr = 0,
    financeCostCr = 0,
    landCostCr = 0,
    landownerSharePct,
    structureType = 'area_share',
  } = params || {};

  if (!(totalRevenueCr > 0)) return null;
  if (!(landownerSharePct >= 0 && landownerSharePct <= 100)) return null;

  const effectiveStructure = SUPPORTED_STRUCTURES.has(structureType) ? structureType : 'area_share';
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
    developerRevenueCr > 0 ? round2((developerProfitCr / developerRevenueCr) * 100) : null;
  const projectProfitCr = round2(totalRevenueCr - devCostCr);
  const projectMarginPct = totalRevenueCr > 0 ? round2((projectProfitCr / totalRevenueCr) * 100) : null;

  return {
    kind: 'jda',
    structureType: effectiveStructure,
    landownerSharePct: round2(landownerSharePct),
    developerSharePct: round2(100 - landownerSharePct),
    waterfall: [
      {
        party: 'Landowner',
        label: effectiveStructure === 'revenue_share' ? 'Revenue Share' : 'Area Allocation',
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
      implicitLandValueCr: landownerRevenueCr,
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

// ── JV ─────────────────────────────────────────────────────────────────────────

/**
 * JV waterfall with configurable preferred return compounding and optional GP catch-up.
 *
 * Tranche order:
 *   1. Return of Capital — equity returned pro-rata
 *   2. Preferred Return — hurdle hurdle × hold period on equity
 *        simple:   equity × rate × years
 *        compound: equity × ((1 + rate)^years - 1)    (default, institutional standard)
 *   3. GP Catch-Up — (optional) developer catches up until split matches promote %
 *   4. Promote — developer takes `developerPromotePct` of residual above threshold
 *   5. Residual — remainder distributed by equity %
 */
function calculateJV(params) {
  const {
    totalRevenueCr,
    totalCostCr,
    landownerEquityCr,
    developerEquityCr,
    preferredReturnPct = 8,
    preferredReturnType = 'compound',
    holdPeriodYears = 3,
    developerPromotePct = 20,
    promoteThresholdMultiple = 1.5,
    useCatchUp = false,
  } = params || {};

  if (!(totalRevenueCr > 0) || !(totalCostCr > 0)) return null;
  if (!(landownerEquityCr >= 0) || !(developerEquityCr >= 0)) return null;

  const totalEquityCr = round2(Number(landownerEquityCr) + Number(developerEquityCr));
  if (!(totalEquityCr > 0)) return null;

  const prefType = SUPPORTED_PREF_TYPES.has(preferredReturnType) ? preferredReturnType : 'compound';
  const landownerEquityPct = round4((landownerEquityCr / totalEquityCr) * 100);
  const developerEquityPct = round4(100 - landownerEquityPct);
  const totalProjectProfitCr = round2(totalRevenueCr - totalCostCr);
  const totalReturnMultiple = round2(
    (totalEquityCr + Math.max(0, totalProjectProfitCr)) / totalEquityCr
  );

  const waterfall = [];
  let remaining = Math.max(0, totalProjectProfitCr);

  // T1: Return of Capital
  waterfall.push({
    tranche: 'Return of Capital',
    landownerCr: round2(Number(landownerEquityCr)),
    developerCr: round2(Number(developerEquityCr)),
    totalCr: round2(totalEquityCr),
    note: 'Equity contribution returned pro-rata',
    fromProfit: false,
  });

  // T2: Preferred Return
  const r = preferredReturnPct / 100;
  const prefTotal = prefType === 'compound'
    ? round2(totalEquityCr * (Math.pow(1 + r, holdPeriodYears) - 1))
    : round2(totalEquityCr * r * holdPeriodYears);
  const actualPref = round2(Math.min(prefTotal, remaining));
  const prefLandowner = round2(actualPref * (landownerEquityPct / 100));
  const prefDeveloper = round2(actualPref - prefLandowner);
  const prefFunded = remaining >= prefTotal;
  waterfall.push({
    tranche: `Preferred Return (${preferredReturnPct}% ${prefType === 'compound' ? 'cpd' : 'simple'} × ${holdPeriodYears} yr)`,
    landownerCr: prefLandowner,
    developerCr: prefDeveloper,
    totalCr: actualPref,
    note: prefFunded ? 'Fully funded' : 'Partially funded — profit shortfall',
    fromProfit: true,
  });
  remaining = round2(remaining - actualPref);

  // T3 (optional): GP Catch-Up — developer receives 100% of residual until LP/GP split
  // equals the promote % target. Standard institutional JV practice.
  let catchUpTriggered = false;
  if (
    useCatchUp &&
    remaining > 0.001 &&
    developerPromotePct > 0 &&
    developerPromotePct < 100
  ) {
    // Target: dev gets `developerPromotePct` of total above-pref distributions
    const promoteFrac = developerPromotePct / 100;
    // Catch-up amount C such that prefDeveloper + C = promoteFrac × (prefLandowner + prefDeveloper + C)
    const catchUp = round2(
      (promoteFrac * (prefLandowner + prefDeveloper) - prefDeveloper) / (1 - promoteFrac)
    );
    const actualCatchUp = Math.max(0, Math.min(catchUp, remaining));
    if (actualCatchUp > 0.001) {
      catchUpTriggered = true;
      waterfall.push({
        tranche: `GP Catch-Up (to ${developerPromotePct}% of above-pref)`,
        landownerCr: 0,
        developerCr: round2(actualCatchUp),
        totalCr: round2(actualCatchUp),
        note: 'Sponsor catches up to promote share',
        fromProfit: true,
      });
      remaining = round2(remaining - actualCatchUp);
    }
  }

  // T4: Promote
  let promoteTriggered = false;
  if (
    remaining > 0.001 &&
    totalReturnMultiple >= promoteThresholdMultiple &&
    developerPromotePct > 0
  ) {
    const promoteCr = round2(remaining * (developerPromotePct / 100));
    promoteTriggered = true;
    waterfall.push({
      tranche: `Developer Promote (${developerPromotePct}% above ${promoteThresholdMultiple}x)`,
      landownerCr: 0,
      developerCr: promoteCr,
      totalCr: promoteCr,
      note: `${totalReturnMultiple.toFixed(2)}x ≥ ${promoteThresholdMultiple}x threshold`,
      fromProfit: true,
    });
    remaining = round2(remaining - promoteCr);
  }

  // T5: Residual Split
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

  const profitTranches = waterfall.filter((t) => t.fromProfit);
  const landownerProfit = round2(profitTranches.reduce((s, t) => s + (t.landownerCr || 0), 0));
  const developerProfit = round2(profitTranches.reduce((s, t) => s + (t.developerCr || 0), 0));
  const landownerTotal = round2(Number(landownerEquityCr) + landownerProfit);
  const developerTotal = round2(Number(developerEquityCr) + developerProfit);

  return {
    kind: 'jv',
    preferredReturnType: prefType,
    useCatchUp: !!useCatchUp,
    landownerEquityPct: round2(landownerEquityPct),
    developerEquityPct: round2(developerEquityPct),
    totalEquityCr,
    totalProjectProfitCr,
    totalReturnMultiple,
    promoteTriggered,
    catchUpTriggered,
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

// ── Debt Schedule ──────────────────────────────────────────────────────────────

function buildDebtSchedule(params) {
  const {
    debtDrawnCr,
    debtRatePct,
    projectDurationMonths,
    constructionStartMonths = 0,
    constructionEndMonths,
  } = params || {};

  if (!(debtDrawnCr > 0) || !(debtRatePct > 0) || !(projectDurationMonths > 0)) return null;

  const totalQ = Math.ceil(projectDurationMonths / 3);
  const constStartQ = Math.max(0, Math.floor(constructionStartMonths / 3));
  const constEndQ = Math.min(totalQ, Math.ceil((constructionEndMonths || projectDurationMonths * 0.85) / 3));
  const constDurQ = Math.max(2, constEndQ - constStartQ);
  const quarterlyRate = Math.pow(1 + debtRatePct / 100, 0.25) - 1;

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

module.exports = {
  calculateJDA,
  calculateJV,
  buildDebtSchedule,
};
