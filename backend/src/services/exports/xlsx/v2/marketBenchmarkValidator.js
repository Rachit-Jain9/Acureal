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
 * Validator 4: CompSetStale — latest comp launch_year is more than 24
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
  },
};
