'use strict';

/**
 * Capital-Stack Optimizer — Phase 2 / Pillar 3 (second half) — closes Phase 2.
 *
 * Given a deal's kernel-computed financial output (total project cost, asset
 * class, stabilized DSCR, IRR, project duration), proposes three capital-stack
 * scenarios and scores each on:
 *
 *   - covenant compliance against Indian-bank lending bands (LTV, LTC, DSCR)
 *   - debt serviceability (DSCR margin vs threshold)
 *   - capital efficiency (equity tie-up — lower = more efficient)
 *   - blended cost of capital (lower = better, but tied to higher leverage)
 *   - structural flexibility (multi-layer stack = more optionality)
 *
 * Three scenarios per asset class — Conservative / Base / Aggressive — with
 * deterministic Indian-market templates. Each scenario is a different slicing
 * of (equity, construction finance, preferred equity, mezzanine). The optimizer
 * does NOT re-run the kernel — it overlays alternate capital-stack assumptions
 * on the project's known funding need.
 *
 * Output per scenario:
 *   {
 *     scenario: 'conservative' | 'base' | 'aggressive',
 *     label, score (0-100), band, verdict (closed dict),
 *     mix: { equity_pct, construction_finance_pct, pref_equity_pct, mezz_pct },
 *     amounts_cr: { equity, construction_finance, pref_equity, mezz },
 *     covenants: { ltv, ltc, dscr } with { value, threshold, passes },
 *     blended_cost_of_capital_pct,
 *     rationale (3 lines),
 *     factors (5 sub-scores),
 *   }
 *
 * Verdict from the closed verb dictionary per CLAUDE.md — Recommend / Consider
 * / Re-examine / Stress-test / Flag. Absolute verbs forbidden.
 *
 * Pure compute over the workspace.financials slice. No DB calls. No AI.
 *
 * Honest empty states:
 *   - no asset class           → 'no_asset_class'
 *   - no kernel run yet         → 'no_financial_model'
 *   - kernel missing total cost → 'incomplete_kernel_output'
 *
 * This closes Pillar 3 of the property-consultant quarter. The three Phase 2
 * ranking panels (Best Use × Deal Structure × Capital Stack) together answer
 * the property-consultant trio: what to build × how to structure × how to
 * finance.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Per-asset-class covenant bands — Indian-market norms for Bengaluru deals
//
//  ltv_max_*:  Loan-to-Value ceiling (against project gross sales value)
//  ltc_max_*:  Loan-to-Cost ceiling (against project total cost)
//  dscr_min_*: stabilized DSCR floor (kernel-computed)
//
//  These are the operator-known typical Indian-bank lending norms for
//  Bengaluru deals — not promises. The optimizer surfaces the relative band;
//  the deal team negotiates the actual terms with their bank.
//
//  Sources: HDFC / Axis / ICICI public lending norms; published JLL / Knight
//  Frank construction-finance notes. Conservative / Base / Aggressive are
//  the three operator-known points across the band.
// ─────────────────────────────────────────────────────────────────────────────

const COVENANT_BANDS = Object.freeze({
  residential_apartments: {
    ltv_max_conservative: 0.55, ltv_max_base: 0.65, ltv_max_aggressive: 0.70,
    ltc_max_conservative: 0.65, ltc_max_base: 0.75, ltc_max_aggressive: 0.80,
    dscr_min_conservative: 1.60, dscr_min_base: 1.40, dscr_min_aggressive: 1.25,
  },
  plotted_development: {
    ltv_max_conservative: 0.50, ltv_max_base: 0.60, ltv_max_aggressive: 0.65,
    ltc_max_conservative: 0.55, ltc_max_base: 0.65, ltc_max_aggressive: 0.75,
    dscr_min_conservative: 1.70, dscr_min_base: 1.50, dscr_min_aggressive: 1.30,
  },
  commercial_office: {
    ltv_max_conservative: 0.50, ltv_max_base: 0.60, ltv_max_aggressive: 0.65,
    ltc_max_conservative: 0.60, ltc_max_base: 0.70, ltc_max_aggressive: 0.75,
    dscr_min_conservative: 1.50, dscr_min_base: 1.35, dscr_min_aggressive: 1.20,
  },
  retail: {
    ltv_max_conservative: 0.50, ltv_max_base: 0.60, ltv_max_aggressive: 0.65,
    ltc_max_conservative: 0.60, ltc_max_base: 0.70, ltc_max_aggressive: 0.75,
    dscr_min_conservative: 1.55, dscr_min_base: 1.40, dscr_min_aggressive: 1.25,
  },
  industrial_warehousing: {
    ltv_max_conservative: 0.55, ltv_max_base: 0.65, ltv_max_aggressive: 0.70,
    ltc_max_conservative: 0.65, ltc_max_base: 0.75, ltc_max_aggressive: 0.80,
    dscr_min_conservative: 1.50, dscr_min_base: 1.35, dscr_min_aggressive: 1.20,
  },
  hospitality: {
    ltv_max_conservative: 0.45, ltv_max_base: 0.55, ltv_max_aggressive: 0.60,
    ltc_max_conservative: 0.55, ltc_max_base: 0.65, ltc_max_aggressive: 0.70,
    dscr_min_conservative: 1.70, dscr_min_base: 1.50, dscr_min_aggressive: 1.30,
  },
  mixed_use: {
    ltv_max_conservative: 0.50, ltv_max_base: 0.60, ltv_max_aggressive: 0.68,
    ltc_max_conservative: 0.60, ltc_max_base: 0.70, ltc_max_aggressive: 0.78,
    dscr_min_conservative: 1.55, dscr_min_base: 1.40, dscr_min_aggressive: 1.25,
  },
  villas: {
    ltv_max_conservative: 0.55, ltv_max_base: 0.65, ltv_max_aggressive: 0.70,
    ltc_max_conservative: 0.65, ltc_max_base: 0.75, ltc_max_aggressive: 0.80,
    dscr_min_conservative: 1.60, dscr_min_base: 1.40, dscr_min_aggressive: 1.25,
  },
  redevelopment: {
    ltv_max_conservative: 0.50, ltv_max_base: 0.60, ltv_max_aggressive: 0.65,
    ltc_max_conservative: 0.60, ltc_max_base: 0.70, ltc_max_aggressive: 0.78,
    dscr_min_conservative: 1.60, dscr_min_base: 1.40, dscr_min_aggressive: 1.25,
  },
  raw_land: {
    ltv_max_conservative: 0.40, ltv_max_base: 0.50, ltv_max_aggressive: 0.55,
    ltc_max_conservative: 0.45, ltc_max_base: 0.55, ltc_max_aggressive: 0.65,
    dscr_min_conservative: 1.80, dscr_min_base: 1.60, dscr_min_aggressive: 1.40,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Per-asset-class capital-stack templates
//
//  Each template defines the three operator-known points across the Indian
//  capital-stack band: Conservative (equity-heavy, low LTV), Base (typical
//  mid-market), Aggressive (high leverage, narrow covenant cushion).
//
//  All percentages sum to 100. Cost-of-capital is the layer-blended cost
//  used by the optimizer to compute the WACC for each scenario.
// ─────────────────────────────────────────────────────────────────────────────

const COST_OF_CAPITAL_PCT = Object.freeze({
  equity:               21.0, // developer hurdle IRR
  construction_finance: 11.5, // typical Indian bank construction-finance rate
  pref_equity:          17.0, // preferred-equity IRR target
  mezz:                 20.0, // mezzanine IRR target
});

const STACK_TEMPLATES = Object.freeze({
  residential_apartments: {
    conservative: { equity_pct: 50, construction_finance_pct: 30, pref_equity_pct: 15, mezz_pct: 5  },
    base:         { equity_pct: 30, construction_finance_pct: 50, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 20, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 10 },
  },
  plotted_development: {
    conservative: { equity_pct: 60, construction_finance_pct: 25, pref_equity_pct: 12, mezz_pct: 3  },
    base:         { equity_pct: 40, construction_finance_pct: 40, pref_equity_pct: 15, mezz_pct: 5  },
    aggressive:   { equity_pct: 30, construction_finance_pct: 50, pref_equity_pct: 15, mezz_pct: 5  },
  },
  commercial_office: {
    conservative: { equity_pct: 55, construction_finance_pct: 25, pref_equity_pct: 15, mezz_pct: 5  },
    base:         { equity_pct: 35, construction_finance_pct: 45, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 25, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 5  },
  },
  retail: {
    conservative: { equity_pct: 55, construction_finance_pct: 25, pref_equity_pct: 15, mezz_pct: 5  },
    base:         { equity_pct: 35, construction_finance_pct: 45, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 25, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 5  },
  },
  industrial_warehousing: {
    conservative: { equity_pct: 50, construction_finance_pct: 30, pref_equity_pct: 15, mezz_pct: 5  },
    base:         { equity_pct: 30, construction_finance_pct: 50, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 22, construction_finance_pct: 58, pref_equity_pct: 12, mezz_pct: 8  },
  },
  hospitality: {
    conservative: { equity_pct: 60, construction_finance_pct: 22, pref_equity_pct: 13, mezz_pct: 5  },
    base:         { equity_pct: 40, construction_finance_pct: 40, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 30, construction_finance_pct: 50, pref_equity_pct: 12, mezz_pct: 8  },
  },
  mixed_use: {
    conservative: { equity_pct: 55, construction_finance_pct: 25, pref_equity_pct: 15, mezz_pct: 5  },
    base:         { equity_pct: 32, construction_finance_pct: 48, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 22, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 8  },
  },
  villas: {
    conservative: { equity_pct: 55, construction_finance_pct: 25, pref_equity_pct: 15, mezz_pct: 5  },
    base:         { equity_pct: 32, construction_finance_pct: 48, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 22, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 8  },
  },
  redevelopment: {
    conservative: { equity_pct: 55, construction_finance_pct: 25, pref_equity_pct: 15, mezz_pct: 5  },
    base:         { equity_pct: 35, construction_finance_pct: 45, pref_equity_pct: 12, mezz_pct: 8  },
    aggressive:   { equity_pct: 25, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 5  },
  },
  raw_land: {
    conservative: { equity_pct: 70, construction_finance_pct: 15, pref_equity_pct: 12, mezz_pct: 3  },
    base:         { equity_pct: 55, construction_finance_pct: 30, pref_equity_pct: 12, mezz_pct: 3  },
    aggressive:   { equity_pct: 45, construction_finance_pct: 40, pref_equity_pct: 12, mezz_pct: 3  },
  },
});

const DEFAULT_TEMPLATE = STACK_TEMPLATES.residential_apartments;
const DEFAULT_COVENANT = COVENANT_BANDS.residential_apartments;
const SCENARIOS = Object.freeze(['conservative', 'base', 'aggressive']);

const SCENARIO_LABELS = Object.freeze({
  conservative: 'Conservative',
  base:         'Base',
  aggressive:   'Aggressive',
});

// ─────────────────────────────────────────────────────────────────────────────
//  Verdict + band mapping — closed verb dictionary per CLAUDE.md
// ─────────────────────────────────────────────────────────────────────────────

const VERDICT_DICT = Object.freeze(['Recommend', 'Consider', 'Re-examine', 'Stress-test', 'Flag']);

const verdictFor = (score) => {
  if (score >= 75) return 'Recommend';
  if (score >= 55) return 'Consider';
  if (score >= 35) return 'Re-examine';
  if (score >= 15) return 'Stress-test';
  return 'Flag';
};

const bandFor = (score) => {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
};

// ─────────────────────────────────────────────────────────────────────────────
//  Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round = (n, places = 2) => {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

const inrCr = (n) => `₹${round(n, 2)?.toLocaleString('en-IN') ?? '—'} Cr`;

// Compute blended cost of capital from a mix (weights in %).
const blendedCostOfCapital = (mix) => {
  const w = (p) => (p || 0) / 100;
  return (
    w(mix.equity_pct)               * COST_OF_CAPITAL_PCT.equity +
    w(mix.construction_finance_pct) * COST_OF_CAPITAL_PCT.construction_finance +
    w(mix.pref_equity_pct)          * COST_OF_CAPITAL_PCT.pref_equity +
    w(mix.mezz_pct)                 * COST_OF_CAPITAL_PCT.mezz
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-scorers
// ─────────────────────────────────────────────────────────────────────────────

// Factor 1: Covenant compliance (0-25). All three covenants (LTV, LTC,
// stabilized DSCR) must pass against the scenario's asset-class band.
// Cushion above the threshold adds to the score.
const scoreCovenantCompliance = ({ mix, totalCostCr, grossSalesValueCr, dscr, covenantsForScenario }) => {
  const debtCr = totalCostCr * ((mix.construction_finance_pct + mix.mezz_pct + mix.pref_equity_pct) / 100);
  const cfOnlyCr = totalCostCr * (mix.construction_finance_pct / 100); // senior debt only for LTV/LTC

  const ltv = grossSalesValueCr && grossSalesValueCr > 0 ? cfOnlyCr / grossSalesValueCr : null;
  const ltc = totalCostCr > 0 ? cfOnlyCr / totalCostCr : null;
  const stabilizedDscr = toNum(dscr);

  const ltvPass = ltv != null && ltv <= covenantsForScenario.ltv_max;
  const ltcPass = ltc != null && ltc <= covenantsForScenario.ltc_max;
  const dscrPass = stabilizedDscr != null && stabilizedDscr >= covenantsForScenario.dscr_min;

  let passes = 0;
  if (ltvPass) passes += 1;
  if (ltcPass) passes += 1;
  if (dscrPass) passes += 1;

  // Cushion: each metric beyond the threshold adds bonus
  let cushion = 0;
  if (ltvPass && ltv != null) cushion += Math.max(0, (covenantsForScenario.ltv_max - ltv) * 20);
  if (ltcPass && ltc != null) cushion += Math.max(0, (covenantsForScenario.ltc_max - ltc) * 20);
  if (dscrPass && stabilizedDscr != null) {
    cushion += Math.max(0, (stabilizedDscr - covenantsForScenario.dscr_min) * 3);
  }

  // Score: 0 if any fail, 15-25 if all pass (with cushion)
  let score;
  if (passes < 3) score = passes * 4; // partial credit
  else score = Math.min(25, 15 + Math.round(cushion));

  // Build signal
  const parts = [];
  if (ltv != null) parts.push(`LTV ${Math.round(ltv * 100)}% ${ltvPass ? '✓' : '✗'} (≤${Math.round(covenantsForScenario.ltv_max * 100)}%)`);
  if (ltc != null) parts.push(`LTC ${Math.round(ltc * 100)}% ${ltcPass ? '✓' : '✗'} (≤${Math.round(covenantsForScenario.ltc_max * 100)}%)`);
  if (stabilizedDscr != null) parts.push(`DSCR ${stabilizedDscr.toFixed(2)}× ${dscrPass ? '✓' : '✗'} (≥${covenantsForScenario.dscr_min.toFixed(2)}×)`);

  return {
    score,
    of: 25,
    signal: parts.length ? parts.join('; ') : 'no covenant inputs',
    covenants: {
      ltv: ltv != null ? { value: round(ltv, 3), threshold: covenantsForScenario.ltv_max, passes: ltvPass } : null,
      ltc: ltc != null ? { value: round(ltc, 3), threshold: covenantsForScenario.ltc_max, passes: ltcPass } : null,
      dscr: stabilizedDscr != null
        ? { value: round(stabilizedDscr, 2), threshold: covenantsForScenario.dscr_min, passes: dscrPass }
        : null,
    },
    debt_cr: round(debtCr, 2),
    senior_debt_cr: round(cfOnlyCr, 2),
  };
};

// Factor 2: Debt serviceability (0-20). DSCR margin vs the scenario's
// asset-class minimum — generous cushion = high score.
const scoreDebtServiceability = ({ dscr, dscrMin }) => {
  const d = toNum(dscr);
  if (d == null) {
    return { score: 8, of: 20, signal: 'no DSCR from kernel — neutral assumption' };
  }
  // Scoring: at threshold = 8/20; 0.2× cushion = 14/20; 0.4× cushion = 20/20.
  // Below threshold drops fast.
  if (d < dscrMin) {
    return { score: 0, of: 20, signal: `DSCR ${d.toFixed(2)}× below ${dscrMin.toFixed(2)}× threshold` };
  }
  const cushion = d - dscrMin;
  const score = Math.min(20, Math.round(8 + cushion * 30));
  return {
    score,
    of: 20,
    signal: `DSCR ${d.toFixed(2)}× — ${(cushion).toFixed(2)} above ${dscrMin.toFixed(2)}× threshold`,
  };
};

// Factor 3: Capital efficiency (0-20). Lower equity tie-up = higher score.
// 20% equity = 20/20 (max efficient); 50% = 10/20; 80%+ = 0.
const scoreCapitalEfficiency = ({ mix }) => {
  const eq = mix.equity_pct;
  // Score is inverse-linear: 20 at 15% equity, 10 at 50%, 0 at 85%+
  const raw = 20 - ((eq - 15) / 70) * 20;
  const score = Math.max(0, Math.min(20, Math.round(raw)));
  return {
    score,
    of: 20,
    signal: `${eq}% equity tied${eq >= 50 ? ' — high equity lock' : eq >= 30 ? ' — moderate equity lock' : ' — capital-efficient'}`,
  };
};

// Factor 4: Cost of capital (0-20). Lower blended cost = higher score.
// 11% blended = 20/20; 15% = 12/20; 18% = 4/20; 20%+ = 0.
const scoreCostOfCapital = ({ mix }) => {
  const blended = blendedCostOfCapital(mix);
  const raw = 20 - (blended - 11) * 2;
  const score = Math.max(0, Math.min(20, Math.round(raw)));
  return {
    score,
    of: 20,
    signal: `blended cost ${blended.toFixed(1)}%`,
    blended_pct: round(blended, 2),
  };
};

// Factor 5: Structural flexibility (0-15). A diversified stack with all four
// layers present scores higher than a 2-layer barbell — more optionality
// for replacement, refinance, takeout.
const scoreFlexibility = ({ mix }) => {
  let layers = 0;
  if (mix.equity_pct >= 5) layers += 1;
  if (mix.construction_finance_pct >= 5) layers += 1;
  if (mix.pref_equity_pct >= 5) layers += 1;
  if (mix.mezz_pct >= 3) layers += 1;
  // 4 layers = 15, 3 = 11, 2 = 6, 1 = 2.
  const score = layers === 4 ? 15 : layers === 3 ? 11 : layers === 2 ? 6 : layers === 1 ? 2 : 0;
  return {
    score,
    of: 15,
    signal: `${layers}-layer stack${layers >= 3 ? ' — flexible' : ' — limited optionality'}`,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Composer
// ─────────────────────────────────────────────────────────────────────────────

const scoreScenario = ({ scenario, assetClass, totalCostCr, grossSalesValueCr, dscr }) => {
  const template = STACK_TEMPLATES[assetClass] || DEFAULT_TEMPLATE;
  const covenantBand = COVENANT_BANDS[assetClass] || DEFAULT_COVENANT;
  const mix = template[scenario];
  if (!mix) return null;

  const covenantsForScenario = {
    ltv_max:  covenantBand[`ltv_max_${scenario}`],
    ltc_max:  covenantBand[`ltc_max_${scenario}`],
    dscr_min: covenantBand[`dscr_min_${scenario}`],
  };

  const ctx = { mix, totalCostCr, grossSalesValueCr, dscr, covenantsForScenario };

  const f1 = scoreCovenantCompliance(ctx);
  const f2 = scoreDebtServiceability({ dscr, dscrMin: covenantsForScenario.dscr_min });
  const f3 = scoreCapitalEfficiency({ mix });
  const f4 = scoreCostOfCapital({ mix });
  const f5 = scoreFlexibility({ mix });

  const total = f1.score + f2.score + f3.score + f4.score + f5.score;

  // Compute amounts
  const amounts_cr = {
    equity:               round(totalCostCr * mix.equity_pct / 100, 2),
    construction_finance: round(totalCostCr * mix.construction_finance_pct / 100, 2),
    pref_equity:          round(totalCostCr * mix.pref_equity_pct / 100, 2),
    mezz:                 round(totalCostCr * mix.mezz_pct / 100, 2),
  };

  // Compose 3-line rationale
  const rationale = [
    `${SCENARIO_LABELS[scenario]} stack: ${mix.equity_pct}% equity / ${mix.construction_finance_pct}% CF / ${mix.pref_equity_pct}% pref / ${mix.mezz_pct}% mezz.`,
    f1.signal,
    f4.signal,
  ];

  return {
    scenario,
    label: SCENARIO_LABELS[scenario],
    score: total,
    band: bandFor(total),
    verdict: verdictFor(total),
    mix,
    amounts_cr,
    covenants: f1.covenants,
    blended_cost_of_capital_pct: f4.blended_pct,
    debt_cr: f1.debt_cr,
    senior_debt_cr: f1.senior_debt_cr,
    total_cost_cr: round(totalCostCr, 2),
    rationale,
    factors: {
      covenant_compliance: f1,
      debt_serviceability: f2,
      capital_efficiency:  f3,
      cost_of_capital:     f4,
      flexibility:         f5,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure scorer — extracts the necessary kernel outputs from a financials row
 * and runs the three scenarios. Used by the workspace slice (no DB calls).
 *
 * Args:
 *   assetClass — required; the deal's asset class
 *   financials — the row from public.financials, or the workspace financial
 *                slice (whichever shape carries total cost + DSCR). May be
 *                null when the kernel hasn't run yet.
 *
 * Returns: { scenarios: [...] } sorted desc by score, or empty with a
 * `reason` for honest empty-state rendering.
 */
const scoreFromFinancials = ({ assetClass, financials }) => {
  if (!assetClass) return { scenarios: [], reason: 'no_asset_class' };
  if (!financials) return { scenarios: [], reason: 'no_financial_model' };

  // Extract total cost, gross sales value, stabilized DSCR — defensive on
  // every field shape (financials row OR model_params nested shape).
  const mp = financials.model_params || {};
  const costs = mp.costs || {};
  const revenue = mp.revenue || {};
  const kpis = mp.kpis || financials.kpis || {};
  const extras = kpis.extras || {};

  const totalCostCr =
    toNum(costs.totalCr) ??
    toNum(financials.total_cost_cr) ??
    toNum(revenue.totalCostCr);
  const grossSalesValueCr =
    toNum(revenue.totalRevenueCr) ??
    toNum(financials.total_revenue_cr);
  const dscr =
    toNum(extras.dscr) ??
    toNum(kpis.dscr) ??
    toNum(financials.dscr);

  if (totalCostCr == null || totalCostCr <= 0) {
    return { scenarios: [], reason: 'incomplete_kernel_output' };
  }

  const scenarios = SCENARIOS
    .map((s) =>
      scoreScenario({
        scenario: s,
        assetClass,
        totalCostCr,
        grossSalesValueCr,
        dscr,
      })
    )
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return {
    scenarios,
    inputs: {
      asset_class: assetClass,
      total_cost_cr: round(totalCostCr, 2),
      gross_sales_value_cr: grossSalesValueCr != null ? round(grossSalesValueCr, 2) : null,
      stabilized_dscr: dscr != null ? round(dscr, 2) : null,
    },
    reason: null,
  };
};

module.exports = {
  // Public
  scoreFromFinancials,
  // Exported for unit tests + workspace integration
  scoreScenario,
  scoreCovenantCompliance,
  scoreDebtServiceability,
  scoreCapitalEfficiency,
  scoreCostOfCapital,
  scoreFlexibility,
  blendedCostOfCapital,
  verdictFor,
  bandFor,
  COVENANT_BANDS,
  STACK_TEMPLATES,
  COST_OF_CAPITAL_PCT,
  SCENARIOS,
  VERDICT_DICT,
};
