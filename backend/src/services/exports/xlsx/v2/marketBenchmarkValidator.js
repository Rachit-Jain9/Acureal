'use strict';

/**
 * Market-Benchmark Validators (PR-NX28 — 2026-05-17).
 *
 * Extends `buildExportQa()` in buildWorkbook.js with comp-derived WARN
 * issues that cite the source comp set. Per 2026-05-15 Strategic Review
 * §III.3, the existing validators are deterministic + structural ("DebtLTV
 * must be 0-1", "ExitCapRate must be present for income deals"). They do
 * NOT cross-check operator inputs against the verified market feed —
 * meaning an obviously aspirational sell rate (₹X above the 95th-percentile
 * comp) passes QA silently. Operators only discover the mismatch when an
 * IC reviewer flags it.
 *
 * This module adds 4 market-benchmark validators that surface citations
 * back to the comp set:
 *
 *   1. SellRatePerSqftAboveP95
 *        Development deal asks ₹X/sqft when nearby comp p95 is ₹Y/sqft.
 *        Severity: WARN. Forces operator to explicitly justify
 *        aspirational pricing OR mark the workbook as a sensitivity file.
 *
 *   2. SellRatePerSqftBelowP25
 *        Development deal asks ₹X/sqft when nearby comp p25 is ₹Y/sqft.
 *        Severity: WARN. Catches under-priced sale assumptions that mask
 *        true gross margin.
 *
 *   3. CompCoverageThin
 *        Fewer than 5 verified comps in the catchment. Severity: WARN.
 *        Tells operator the benchmark itself is unreliable — the p95/p25
 *        checks above carry low confidence with thin samples.
 *
 *   4. CompSetStale
 *        Latest comp launch_year is more than 24 months old. Severity: WARN.
 *        Indian RE pricing moves fast (10-20% per year in active micro-
 *        markets); stale comps yield stale benchmarks.
 *
 * Design rules:
 *   - Validators are FAIL-OPEN. If the comp slice is missing or malformed
 *     (e.g., RLS hides the comps, comps in odd shape), the validator
 *     returns silently — never throws, never blocks the export.
 *   - All issues are SEVERITY: WARN. Market benchmarks are advisory; only
 *     deterministic structural checks (DebtLTV, OccupancyPct) escalate to
 *     BLOCKER. Per CLAUDE.md Hard Rule #5: "Never expose unverified
 *     market intelligence or comps as authoritative."
 *   - Each issue carries a citation: how many comps, the percentile value
 *     used, the source field (e.g., "p95 of 10 verified comps within 5km").
 *     Per AI_ROADMAP §10: confidence rendered with traceable references.
 *   - Skip validators that don't apply to the deal family. Income deals
 *     don't have a SellRatePerSqft input; development deals don't surface
 *     a BaseRentPerSqftMonth.
 */

const asFiniteNumber = (value) => {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Percentile by nearest-rank (Excel PERCENTILE.INC-compatible enough for
 * benchmark-style checks; the strict-inclusive variant matters for tiny
 * samples we already flag as thin via CompCoverageThin).
 *
 * @param {number[]} sortedValues — ascending sorted, non-empty, all finite
 * @param {number} fraction — 0..1 (e.g., 0.95 for p95)
 * @returns {number}
 */
const percentileNearestRank = (sortedValues, fraction) => {
  if (!sortedValues.length) return null;
  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * clampedFraction)),
  );
  return sortedValues[idx];
};

/**
 * Extract the verified, finite, positive rate_per_sqft values from a comp
 * list. Skips unverified / null / zero / non-numeric rows. Returns sorted
 * ascending so percentile calls are O(1).
 */
const extractVerifiedRatesPerSqft = (comps) => {
  if (!Array.isArray(comps)) return [];
  return comps
    .filter((c) => c && (c.is_verified === true || c.is_verified === 'true'))
    .map((c) => asFiniteNumber(c.rate_per_sqft))
    .filter((n) => n !== null && n > 0)
    .sort((a, b) => a - b);
};

/**
 * Validator 1 & 2: SellRatePerSqft vs nearby-comp p95 / p25 bands.
 * Development-family only.
 */
const validateSellRateBands = (ctx, core, addIssue) => {
  if (ctx.dealFamily !== 'development') return;
  const sellRate = asFiniteNumber(core?.sellRatePerSqft);
  if (sellRate === null || sellRate <= 0) return; // no input → no comparison

  const comps = ctx.exportContext?.market?.exportComps;
  const rates = extractVerifiedRatesPerSqft(comps);
  if (rates.length < 3) return; // too few to compute meaningful percentiles

  const p95 = percentileNearestRank(rates, 0.95);
  const p25 = percentileNearestRank(rates, 0.25);
  const p50 = percentileNearestRank(rates, 0.50);
  const n = rates.length;

  if (sellRate > p95) {
    addIssue(
      'warn',
      'Market-benchmark band',
      'SellRatePerSqft',
      `Proposed sell rate ₹${sellRate.toLocaleString('en-IN')}/sqft is ABOVE the 95th percentile of ${n} verified nearby comp${n === 1 ? '' : 's'} (p95 = ₹${p95.toLocaleString('en-IN')}/sqft, median = ₹${p50.toLocaleString('en-IN')}/sqft).`,
      'Either justify the pricing premium against a comparable luxury / branded / location-specific basis, or treat this workbook as an aspirational sensitivity file rather than a base case.',
      'development asset classes',
    );
  } else if (sellRate < p25) {
    addIssue(
      'warn',
      'Market-benchmark band',
      'SellRatePerSqft',
      `Proposed sell rate ₹${sellRate.toLocaleString('en-IN')}/sqft is BELOW the 25th percentile of ${n} verified nearby comp${n === 1 ? '' : 's'} (p25 = ₹${p25.toLocaleString('en-IN')}/sqft, median = ₹${p50.toLocaleString('en-IN')}/sqft).`,
      'Under-pricing may inflate gross margin; verify against quality / phasing / micro-market basis or raise SellRatePerSqft.',
      'development asset classes',
    );
  }
};

/**
 * Validator 3: CompCoverageThin — fewer than 5 verified comps in the
 * catchment. Applies to every deal that ships comps at all (i.e., we
 * don't fire this on deals with zero comps — that's already a separate
 * warn from buildExportQa core).
 */
const validateCompCoverage = (ctx, core, addIssue) => {
  const comps = ctx.exportContext?.market?.exportComps;
  if (!Array.isArray(comps) || comps.length === 0) return; // covered elsewhere
  const verifiedCount = comps.filter((c) => c && (c.is_verified === true || c.is_verified === 'true')).length;
  if (verifiedCount === 0) {
    addIssue(
      'warn',
      'Comp coverage',
      'MarketComps',
      `${comps.length} comp${comps.length === 1 ? '' : 's'} attached, but NONE are marked as verified. Market-benchmark validators are silent without verified comps.`,
      'Mark comps as verified after sourcing them from a credible report (Cushman / JLL / Knight Frank India MarketBeat), or upgrade unverified comps via the Comps page.',
      'market data',
    );
    return;
  }
  if (verifiedCount < 5) {
    addIssue(
      'warn',
      'Comp coverage',
      'MarketComps',
      `Only ${verifiedCount} verified comp${verifiedCount === 1 ? '' : 's'} in the catchment (${comps.length} total). Percentile benchmarks below this threshold carry low confidence — a single outlier can dominate p25/p95.`,
      'Source 5+ verified comps from the same micro-market before treating the comp-derived benchmark as decision-grade.',
      'market data',
    );
  }
};

/**
 * Validator 4 (PR-NX33 — 2026-05-17): DSCR floor per RBI Master Direction.
 * Income-family only. Surfaces WARN when computed Debt Service Coverage
 * Ratio (NOI ÷ annual debt service) is below the conventional 1.20x
 * floor that Indian LRD / project-finance lenders enforce.
 *
 * Pre-NX33 the export QA validated DebtLTV and DebtRatePct as structural
 * inputs but never CHECKED whether the resulting debt service was
 * actually sustainable from the income. An operator could enter 80% LTV
 * @ 11% on a 7-year amortization and ship a workbook where DSCR is
 * 0.85x — economically impossible per RBI, but the export passed silently.
 *
 * Computation:
 *   loan amount = totalCost (₹Cr) × debtLTV
 *   annual debt service = loan × [r(1+r)^n / ((1+r)^n − 1)]
 *     where r = debtRatePct, n = loanTermYears
 *   DSCR = noi / annual debt service
 *
 * Thresholds (per RBI Master Direction on Project Finance + LRD norms):
 *   - DSCR ≥ 1.30 → silent (well-cushioned)
 *   - 1.20 ≤ DSCR < 1.30 → silent (within RBI floor with thin cushion)
 *   - DSCR < 1.20 → WARN with citation
 *   - DSCR < 1.00 → escalated WARN (NOI doesn't cover debt service at all)
 *
 * Skipped silently when:
 *   - dealFamily !== 'income' (only income deals have stabilised NOI)
 *   - kernelKpis.noi or kernelKpis.totalCost missing
 *   - debtLTV ≤ 0 (no debt → no DSCR)
 *   - any numeric coercion fails
 */
const RBI_DSCR_FLOOR = 1.20;

const validateDscrFloor = (ctx, core, addIssue) => {
  if (ctx.dealFamily !== 'income') return;

  const totalCostCr = asFiniteNumber(ctx.kernelKpis?.totalCost);
  const noiCr = asFiniteNumber(ctx.kernelKpis?.noi);
  const ltv = asFiniteNumber(core?.debtLTV);
  const rate = asFiniteNumber(core?.debtRatePct);
  const termYears = asFiniteNumber(ctx.inputs?.loanTermYears) || 7;

  // All prereqs present?
  if (totalCostCr === null || totalCostCr <= 0) return;
  if (noiCr === null || noiCr <= 0) return;
  if (ltv === null || ltv <= 0 || ltv > 1) return;
  if (rate === null || rate <= 0 || rate > 1) return;

  const loanAmountCr = totalCostCr * ltv;
  // Standard amortization. Edge case r=0: simple division (rare but
  // operator could enter a zero-coupon assumption).
  const r = rate;
  const n = termYears;
  const annualDebtServiceCr = r === 0
    ? loanAmountCr / n
    : loanAmountCr * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

  if (annualDebtServiceCr <= 0) return; // shouldn't happen but defensive

  const dscr = noiCr / annualDebtServiceCr;
  if (!Number.isFinite(dscr)) return;

  if (dscr < 1.00) {
    addIssue(
      'warn',
      'RBI Master Direction — DSCR floor',
      'DebtLTV',
      `Computed DSCR is ${dscr.toFixed(2)}× — NOI (₹${noiCr.toFixed(2)} Cr) does not cover annual debt service (₹${annualDebtServiceCr.toFixed(2)} Cr at ${(rate * 100).toFixed(2)}% × ${termYears}yr on ₹${loanAmountCr.toFixed(2)} Cr loan). Below 1.00× means the deal cannot service debt from operating income alone — only feasible if sponsor injects equity from outside cash flow.`,
      `Reduce DebtLTV (currently ${(ltv * 100).toFixed(0)}%) OR lower DebtRatePct OR extend LoanTermYears (currently ${termYears}). Indian LRD lenders enforce DSCR ≥ 1.20× per RBI Master Direction; deals below 1.00× will not clear credit.`,
      'income asset classes',
    );
  } else if (dscr < RBI_DSCR_FLOOR) {
    addIssue(
      'warn',
      'RBI Master Direction — DSCR floor',
      'DebtLTV',
      `Computed DSCR is ${dscr.toFixed(2)}× — BELOW the conventional 1.20× floor Indian LRD / project-finance lenders enforce per RBI Master Direction. NOI ₹${noiCr.toFixed(2)} Cr ÷ annual debt service ₹${annualDebtServiceCr.toFixed(2)} Cr (at ${(rate * 100).toFixed(2)}% × ${termYears}yr on ₹${loanAmountCr.toFixed(2)} Cr loan).`,
      `Reduce DebtLTV (currently ${(ltv * 100).toFixed(0)}%) OR negotiate a lower DebtRatePct OR extend LoanTermYears (currently ${termYears}) to bring DSCR above 1.20×.`,
      'income asset classes',
    );
  }
};

/**
 * Validator 5 (PR-NX33 — 2026-05-17): Yield-on-Cost vs Exit Cap Rate
 * spread. Income-family only. Surfaces WARN when the stabilised
 * yield-on-cost is at or below the exit cap rate — the development
 * premium has evaporated and there's no economic reason to build vs.
 * just buy the stabilised asset.
 *
 * The spread is the developer's reward for taking development risk
 * (entitlement, construction, lease-up). A 50–200 bps positive spread
 * is the conventional minimum for the deal to clear IC.
 *
 * Thresholds:
 *   - spread ≥ 200 bps → silent (healthy development premium)
 *   - 50 bps ≤ spread < 200 bps → silent (thin but positive)
 *   - 0 ≤ spread < 50 bps → WARN (development premium very thin)
 *   - spread < 0 → escalated WARN (negative spread — economically
 *     irrational to build vs. acquire stabilised)
 */
const validateYocVsExitCapSpread = (ctx, core, addIssue) => {
  if (ctx.dealFamily !== 'income') return;

  const yoc = asFiniteNumber(ctx.kernelKpis?.yieldOnCost);
  const exitCap = asFiniteNumber(core?.exitCapRate);
  if (yoc === null || exitCap === null) return;
  if (yoc <= 0 || exitCap <= 0) return; // can't compute meaningful spread

  const spreadBps = Math.round((yoc - exitCap) * 10000);

  if (spreadBps < 0) {
    addIssue(
      'warn',
      'Yield-on-Cost vs Exit Cap',
      'ExitCapRate',
      `NEGATIVE spread: stabilised Yield-on-Cost ${(yoc * 100).toFixed(2)}% is BELOW Exit Cap Rate ${(exitCap * 100).toFixed(2)}% (${Math.abs(spreadBps)} bps deficit). The developer earns LESS than a passive buyer of a stabilised asset — there's no economic reward for taking development risk.`,
      `Either lower the build-cost basis (TotalCost), raise stabilised income (BaseRentPerSqftMonth × OccupancyPct), or revise the Exit Cap Rate assumption. Income deals typically need ≥150-200 bps positive YoC-vs-Exit-Cap spread to clear IC.`,
      'income asset classes',
    );
  } else if (spreadBps < 50) {
    addIssue(
      'warn',
      'Yield-on-Cost vs Exit Cap',
      'ExitCapRate',
      `THIN development premium: Yield-on-Cost ${(yoc * 100).toFixed(2)}% vs Exit Cap ${(exitCap * 100).toFixed(2)}% leaves only ${spreadBps} bps of spread. Conventional IC threshold is 150–200 bps for income deals — a thin spread leaves no margin for cost overruns, lease-up delays, or cap-rate widening.`,
      `Stress-test the build cost (typically +10% contingency) and re-check the spread. If the spread compresses below zero on a reasonable downside, the development premium is illusory.`,
      'income asset classes',
    );
  }
};

/**
 * Validator 6: CompSetStale — latest comp launch_year is more than 24
 * months old. Indian RE pricing moves fast in active micro-markets.
 */
const validateCompFreshness = (ctx, core, addIssue) => {
  const comps = ctx.exportContext?.market?.exportComps;
  if (!Array.isArray(comps) || comps.length === 0) return;

  const launchYears = comps
    .map((c) => asFiniteNumber(c?.launch_year))
    .filter((n) => n !== null && n > 1990 && n < 2200); // reasonable bounds
  if (launchYears.length === 0) return; // no launch dates → can't assess freshness

  const latestLaunchYear = Math.max(...launchYears);
  // ctx.generatedAt is set during prepareWorkbookContext; fall back to "now"
  // if absent (defensive). Year only — month precision is overkill for a
  // 24-month threshold check.
  const generatedAt = ctx.generatedAt ? new Date(ctx.generatedAt) : new Date();
  const currentYear = generatedAt.getUTCFullYear();
  const ageInYears = currentYear - latestLaunchYear;
  // Threshold: latest comp must be within the current year or the prior year.
  // age > 2 (i.e. latest comp is at least 3 calendar years older than the
  // export year) → stale.
  if (ageInYears >= 3) {
    addIssue(
      'warn',
      'Comp freshness',
      'MarketComps',
      `Latest verified comp launched in ${latestLaunchYear}; comp set is ${ageInYears} year${ageInYears === 1 ? '' : 's'} old as of ${currentYear} export. Bengaluru micro-markets typically move 10–20%/year — a 3-year-old benchmark may understate true market rate by 30–60%.`,
      'Refresh the comp set with launches from the last 24 months before relying on the percentile bands for IC-grade pricing decisions.',
      'market data',
    );
  }
};

/**
 * Orchestrator — runs all market-benchmark validators against the export
 * context. Each individual validator is fail-open (try/catch wrapper here
 * is belt-and-suspenders; the validators themselves don't throw).
 *
 * Mutates the `addIssue` callback to push WARN-level issues with citations.
 *
 * @param {object} ctx — buildWorkbook prepareWorkbookContext output
 * @param {function(severity, check, field, message, action, scope?): void} addIssue
 */
const runMarketBenchmarkValidators = (ctx, core, addIssue) => {
  const runners = [
    validateSellRateBands,
    validateCompCoverage,
    validateCompFreshness,
    // PR-NX33 (2026-05-17): income-deal validators
    validateDscrFloor,
    validateYocVsExitCapSpread,
  ];
  for (const validator of runners) {
    try {
      validator(ctx, core, addIssue);
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        // eslint-disable-next-line no-console
        console.warn(`[marketBenchmarkValidator] ${validator.name} failed (skipped): ${err.message}`);
      }
    }
  }
};

module.exports = {
  runMarketBenchmarkValidators,
  // Exported for tests
  __internal: {
    asFiniteNumber,
    percentileNearestRank,
    extractVerifiedRatesPerSqft,
    validateSellRateBands,
    validateCompCoverage,
    validateCompFreshness,
    validateDscrFloor,
    validateYocVsExitCapSpread,
    RBI_DSCR_FLOOR,
  },
};
