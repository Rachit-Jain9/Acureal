'use strict';

/**
 * Deterministic, linear-interpolated percentile — the "type-7" method used by
 * Excel PERCENTILE and NumPy's default. No LLM, no rounding surprises.
 *
 * Why interpolate: a naive `sorted[floor(n * p)]` returns the upper-middle
 * value for even-length sets (e.g. [12000, 18000] → 18000 = max, not 15000),
 * biasing pricing benchmarks upward on the small, even-sized comp sets that are
 * the norm for a single Bengaluru micro-market. The median of an even set must
 * average the two central values; p25/p75 must interpolate between ranks.
 *
 * @param {number[]} values - numeric array (unsorted ok; non-finite entries dropped).
 * @param {number} p - quantile in [0, 1] (0.5 = median, 0.25 = p25, 0.75 = p75).
 * @returns {number|null} interpolated percentile, or null for an empty set.
 */
function percentile(values, p) {
  if (!Array.isArray(values)) return null;
  const sorted = values
    .map(Number)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const q = Math.min(1, Math.max(0, Number(p)));
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/** Convenience: the median (p50). */
const median = (values) => percentile(values, 0.5);

module.exports = { percentile, median };
