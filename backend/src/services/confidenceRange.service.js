'use strict';

/**
 * Confidence Range — Workstream A (Provenance Spine), slice 2.
 *
 * Model Confidence (slice 1) reports how many key inputs are set for the deal
 * versus running on REDIP's benchmark library. This slice answers the natural
 * next question: "so what does that uncertainty do to the headline numbers?"
 *
 * For each headline KPI (IRR, NPV, equity multiple) it reports a deterministic
 * RANGE — what the KPI becomes when every still-unverified assumption is moved
 * to the cautious / favourable edge of its cited benchmark band. The point
 * estimate the kernel produces is real; the range says how exposed that point
 * is to the assumptions nobody has verified yet.
 *
 * Approaches considered:
 *   1. Full interval / Monte-Carlo uncertainty inside the kernel — rejected:
 *      a multi-week rewrite of the deterministic kernel, high regression risk,
 *      and it would invent a probability distribution REDIP cannot defend.
 *   2. Re-run the existing kernel with perturbed inputs — CHOSEN. No kernel
 *      change; it reuses the exact machinery financial.service already uses
 *      for sensitivity / scenarios / the provenance graph.
 *   3. Reuse the stored 2-variable sensitivity_matrix — rejected as the basis:
 *      it covers only selling rate × construction cost and is not tied to
 *      verification status.
 *
 * Honesty boundaries:
 *   - Every range endpoint is a real, reproducible kernel run. The range is a
 *     precise conditional ("IF every unverified assumption sits at the edge of
 *     its plausible band THEN ...") — never a fabricated probability interval.
 *   - Only UNVERIFIED inputs (assumptions still on the benchmark default)
 *     widen the range. An input the analyst set for the deal is trusted and
 *     contributes nothing — so verifying inputs visibly tightens the range.
 *
 * Fully deterministic. No AI. Read-side — changes no math, stores nothing.
 */

const financialService = require('./financial.service');
const { resolveFinancialModelClass } = require('../constants/assetClasses');
const { computeFullFinancials } = require('../engines/kernel.service');
const { MATERIAL_INPUTS_BY_CLASS } = require('./modelConfidence.service');

// The kernel carries the cited benchmark registry. Load it the same fail-soft
// way kernel.service.js does — a missing dist degrades to "unavailable".
let kernel = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  kernel = require('../../../packages/financial-kernel/dist');
} catch (err) {
  kernel = null;
}

// The headline KPIs whose ranges we report. `dp` is the display precision.
const HEADLINE_KPIS = [
  { key: 'irr', label: 'IRR', unit: 'pct', dp: 1 },
  { key: 'npv', label: 'NPV', unit: 'inr_cr', dp: 2 },
  { key: 'equityMultiple', label: 'Equity multiple', unit: 'x', dp: 2 },
];

/** Coerce a stored input to a finite number, or null when blank/garbage. */
function numericOrNull(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Round to `dp` decimals; null for non-finite. */
function round(v, dp) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Kernel benchmark metadata for a default key, fail-soft on unknown keys. */
function benchmarkMeta(modelClass, defaultKey) {
  if (!kernel || !defaultKey || typeof kernel.getDefaultMeta !== 'function') return null;
  try {
    const meta = kernel.getDefaultMeta(modelClass, defaultKey);
    return meta && typeof meta.value === 'number' ? meta : null;
  } catch (err) {
    return null;
  }
}

/**
 * Lean kernel re-run — skips the sensitivity grid, proforma and provenance
 * graph (none are needed for a KPI read). Returns the flat KPI block, or null
 * when a perturbed input set fails to compute (caller skips that run).
 */
function runKpis(inputs) {
  try {
    const r = computeFullFinancials({
      ...inputs,
      skipSensitivity: true,
      skipProforma: true,
      skipGraph: true,
    });
    return r && r.kpis ? r.kpis : null;
  } catch (err) {
    return null;
  }
}

const finite = (v) => v != null && Number.isFinite(v);

/**
 * Build the confidence-range summary for a deal's saved financial model.
 *
 * Returns `{ available: false, reason }` (never throws for an expected gap)
 * when the deal has no model, the kernel build is missing, the class is not
 * catalogued, or the base model fails to compute — the panel hides itself.
 *
 * The 404 visibility gate is inherited from `financialService.getFinancials`.
 */
async function getConfidenceRange(dealId) {
  let fin;
  try {
    fin = await financialService.getFinancials(dealId);
  } catch (err) {
    if (err && (err.statusCode === 404 || err.status === 404)) {
      return { available: false, reason: 'no financial model on this deal yet' };
    }
    throw err;
  }

  const mp = fin.model_params || {};
  const inputs = mp.inputs || {};
  const selectedClass = fin.asset_class || 'residential_apartments';
  const modelClass = mp.financialModelClass || resolveFinancialModelClass(selectedClass);

  if (!kernel) return { available: false, reason: 'financial kernel build unavailable' };
  if (!inputs || Object.keys(inputs).length === 0) {
    return { available: false, reason: 'no saved model inputs' };
  }
  const catalogue = MATERIAL_INPUTS_BY_CLASS[modelClass];
  if (!catalogue) {
    return { available: false, reason: `confidence range not yet catalogued for "${modelClass}"` };
  }

  const base = runKpis(inputs);
  if (!base) return { available: false, reason: 'base model did not compute' };

  // Unverified inputs = benchmark assumptions still on (or blank vs) the cited
  // default, that carry a usable [lo, hi] plausible band.
  const unverified = [];
  for (const spec of catalogue) {
    if (spec.kind !== 'assumption' || !spec.defaultKey) continue;
    const meta = benchmarkMeta(modelClass, spec.defaultKey);
    if (!meta || !Array.isArray(meta.range) || meta.range.length !== 2) continue;
    const [lo, hi] = meta.range;
    if (!finite(lo) || !finite(hi) || hi <= lo) continue;
    const value = numericOrNull(inputs[spec.key]);
    // Still unverified when blank, or sitting exactly on the cited benchmark.
    const onBenchmark = value === null || Math.abs(value - meta.value) < 1e-6;
    if (!onBenchmark) continue; // analyst set it for the deal — trusted, no range contribution
    unverified.push({
      key: spec.key,
      label: spec.label,
      category: spec.category,
      lo,
      hi,
      benchmarkSource: meta.source || null,
    });
  }

  // The primary KPI drives the cautious/favourable direction probe.
  const primary = finite(base.irr) ? 'irr' : 'npv';

  // Per-input probe — run the model with each unverified input at each end of
  // its band (others held at base). Doubles as the direction probe.
  const probes = unverified.map((u) => ({
    ...u,
    atLo: runKpis({ ...inputs, [u.key]: u.lo }),
    atHi: runKpis({ ...inputs, [u.key]: u.hi }),
  }));

  // Combined edge runs — every unverified input simultaneously at its
  // primary-KPI-cautious end, then at its favourable end.
  const cautious = { ...inputs };
  const favourable = { ...inputs };
  for (const p of probes) {
    const lv = p.atLo ? p.atLo[primary] : null;
    const hv = p.atHi ? p.atHi[primary] : null;
    if (!finite(lv) || !finite(hv)) continue; // probe failed — leave this input at base
    if (lv <= hv) {
      cautious[p.key] = p.lo;
      favourable[p.key] = p.hi;
    } else {
      cautious[p.key] = p.hi;
      favourable[p.key] = p.lo;
    }
  }
  const cautiousKpis = runKpis(cautious);
  const favourableKpis = runKpis(favourable);

  // Headline KPI bands. The band always contains the base value.
  const kpis = [];
  for (const k of HEADLINE_KPIS) {
    const b = base[k.key];
    if (!finite(b)) continue;
    const ends = [
      cautiousKpis ? cautiousKpis[k.key] : null,
      favourableKpis ? favourableKpis[k.key] : null,
    ].filter(finite);
    const low = round(ends.length ? Math.min(b, ...ends) : b, k.dp);
    const high = round(ends.length ? Math.max(b, ...ends) : b, k.dp);
    kpis.push({
      key: k.key,
      label: k.label,
      unit: k.unit,
      base: round(b, k.dp),
      low,
      high,
      swing: round(high - low, k.dp),
    });
  }

  // Per-input drivers, measured on the primary KPI, biggest exposure first —
  // this is the honest "go verify THIS assumption next" list.
  const driverDp = primary === 'irr' ? 1 : 2;
  const drivers = [];
  for (const p of probes) {
    const lv = p.atLo ? p.atLo[primary] : null;
    const hv = p.atHi ? p.atHi[primary] : null;
    if (!finite(lv) || !finite(hv)) continue;
    drivers.push({
      key: p.key,
      label: p.label,
      category: p.category,
      benchmarkSource: p.benchmarkSource,
      low: round(Math.min(lv, hv), driverDp),
      high: round(Math.max(lv, hv), driverDp),
      swing: round(Math.abs(hv - lv), driverDp),
    });
  }
  drivers.sort((a, b) => (b.swing || 0) - (a.swing || 0));

  return {
    available: true,
    assetClass: selectedClass,
    modelClass,
    primaryKpi: primary,
    unverifiedCount: unverified.length,
    kpis,
    drivers,
    computedAt: new Date().toISOString(),
  };
}

module.exports = {
  getConfidenceRange,
  // Exported for unit tests.
  _internal: { runKpis, round, numericOrNull, HEADLINE_KPIS },
};
