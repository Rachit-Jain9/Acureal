'use strict';

/**
 * Model Confidence — Workstream A (Provenance Spine), first read-side slice.
 *
 * Answers one honest question about a saved financial model:
 *
 *   "How much of this underwriting rests on numbers set specifically for
 *    THIS deal, versus numbers still running on Acureal's benchmark library?"
 *
 * It is a *read-side* classifier. It changes no math, touches no kernel, and
 * stores nothing. It reads the persisted `model_params.inputs` (exactly the
 * input set the analyst's form submitted — the kernel applies its own
 * defaults internally and never persists them) and classifies each material
 * input as:
 *
 *   - 'deal-set'  — a deal-specific fact the analyst entered (plot area, land
 *                   cost, selling rate …), OR a benchmark assumption the
 *                   analyst moved off Acureal's cited default.
 *   - 'default'   — a benchmark assumption still sitting on Acureal's cited
 *                   default (or left blank, so the kernel will default it).
 *
 * Honesty boundaries — deliberately conservative:
 *   - "deal-set" means "set for this deal", NOT "verified against a source
 *     document". Document-grade provenance is the deeper A1 work; this slice
 *     does not claim it, and the UI copy says so.
 *   - An assumption only counts as 'deal-set' when we can *prove* it departs
 *     from the kernel's cited benchmark (`getDefaultMeta`). Optional inputs
 *     we cannot compare are treated as 'default' — we under-claim confidence
 *     rather than over-claim it.
 *
 * All classification is deterministic. No AI, no scoring model — this honours
 * the hard rule that AI never drives a rule-engine decision.
 */

const financialService = require('./financial.service');
const { resolveFinancialModelClass } = require('../constants/assetClasses');

// The kernel carries the single source of truth for benchmark defaults and
// their citations. Load it the same fail-soft way kernel.service.js does — if
// dist/ is not built the feature degrades to "unavailable" instead of 500ing.
let kernel = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  kernel = require('../../../packages/financial-kernel/dist');
} catch (err) {
  kernel = null;
}

// ── Material-input catalogue ────────────────────────────────────────────────
//
// Per financial-model class, the inputs that actually move the headline KPIs.
// Keyed by the *model* class (`model_params.financialModelClass`) so the keys
// line up with what the InputForm for that class submits.
//
//   kind 'fact'       — a deal-specific input. 'deal-set' whenever a value is
//                       present (the form blanks these; the analyst must type
//                       them — they can never be a silent default).
//   kind 'assumption' — a benchmark assumption. 'deal-set' only when its value
//                       departs from the kernel benchmark named by defaultKey;
//                       otherwise 'default'.
//
// `defaultKey` is the kernel registry key for a clean, same-unit benchmark
// comparison. Assumptions without one are always treated as 'default'.
const MATERIAL_INPUTS_BY_CLASS = Object.freeze({
  residential_apartments: [
    { key: 'plotAreaSqft',            label: 'Plot area',               category: 'Site & area',        kind: 'fact' },
    { key: 'fsi',                     label: 'FSI / FAR',               category: 'Site & area',        kind: 'fact' },
    { key: 'loadingFactor',           label: 'Loading factor',          category: 'Site & area',        kind: 'assumption', defaultKey: 'loadingFactor' },
    { key: 'landCostCr',              label: 'Land cost',               category: 'Costs',              kind: 'fact' },
    { key: 'constructionCostPerSqft', label: 'Construction cost / sqft', category: 'Costs',             kind: 'fact' },
    { key: 'contingencyPct',          label: 'Contingency',             category: 'Costs',              kind: 'assumption', defaultKey: 'contingencyPct' },
    { key: 'marketingCostPct',        label: 'Marketing cost',          category: 'Costs',              kind: 'assumption', defaultKey: 'marketingCostPct' },
    { key: 'sellingRatePerSqft',      label: 'Selling rate / sqft',     category: 'Revenue & pricing',  kind: 'fact' },
    { key: 'developerMarginPct',      label: 'Developer margin',        category: 'Revenue & pricing',  kind: 'assumption', defaultKey: 'developerMarginPct' },
    { key: 'discountRatePct',         label: 'Discount rate',           category: 'Financing',          kind: 'assumption', defaultKey: 'discountRatePct' },
  ],
  plotted_development: [
    { key: 'totalLandSqft',      label: 'Total land area',         category: 'Site & area',       kind: 'fact' },
    { key: 'saleableLandPct',    label: 'Saleable land %',         category: 'Site & area',       kind: 'assumption', defaultKey: 'saleableLandPct' },
    { key: 'avgPlotSizeSqft',    label: 'Average plot size',       category: 'Site & area',       kind: 'fact' },
    { key: 'landCostCr',         label: 'Land cost',               category: 'Costs',             kind: 'fact' },
    { key: 'devCostPerSqft',     label: 'Development cost / sqft',  category: 'Costs',             kind: 'fact' },
    { key: 'marketingCostPct',   label: 'Marketing cost',          category: 'Costs',             kind: 'assumption', defaultKey: 'marketingCostPct' },
    { key: 'sellingRatePerSqft', label: 'Selling rate / sqft',     category: 'Revenue & pricing', kind: 'fact' },
    { key: 'discountRatePct',    label: 'Discount rate',           category: 'Financing',         kind: 'assumption', defaultKey: 'discountRatePct' },
  ],
  commercial_office: [
    { key: 'leasableAreaSqft',        label: 'Leasable area',           category: 'Site & area',       kind: 'fact' },
    { key: 'landCostCr',              label: 'Land cost',               category: 'Costs',             kind: 'fact' },
    { key: 'constructionCostPerSqft', label: 'Construction cost / sqft', category: 'Costs',            kind: 'fact' },
    { key: 'opexPct',                 label: 'Operating expenses',      category: 'Costs',             kind: 'assumption', defaultKey: 'opexPct' },
    { key: 'baseRentPerSqftMonth',    label: 'Base rent / sqft / month', category: 'Revenue & pricing', kind: 'fact' },
    { key: 'rentEscalationPct',       label: 'Rent escalation',         category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'rentEscalationPct' },
    { key: 'vacancyPct',              label: 'Vacancy',                 category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'vacancyPct' },
    { key: 'exitCapRate',             label: 'Exit cap rate',           category: 'Financing',         kind: 'assumption', defaultKey: 'exitCapRatePct' },
    { key: 'discountRatePct',         label: 'Discount rate',           category: 'Financing',         kind: 'assumption', defaultKey: 'discountRatePct' },
  ],
  retail: [
    { key: 'leasableAreaSqft',        label: 'Leasable area',           category: 'Site & area',       kind: 'fact' },
    { key: 'landCostCr',              label: 'Land cost',               category: 'Costs',             kind: 'fact' },
    { key: 'constructionCostPerSqft', label: 'Construction cost / sqft', category: 'Costs',            kind: 'fact' },
    { key: 'opexPct',                 label: 'Operating expenses',      category: 'Costs',             kind: 'assumption', defaultKey: 'opexPct' },
    { key: 'baseRentPerSqftMonth',    label: 'Inline tenant rent',      category: 'Revenue & pricing', kind: 'fact' },
    { key: 'anchorPct',               label: 'Anchor tenant area',      category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'anchorPct' },
    { key: 'vacancyPct',              label: 'Vacancy',                 category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'vacancyPct' },
    { key: 'exitCapRate',             label: 'Exit cap rate',           category: 'Financing',         kind: 'assumption', defaultKey: 'exitCapRatePct' },
    { key: 'discountRatePct',         label: 'Discount rate',           category: 'Financing',         kind: 'assumption', defaultKey: 'discountRatePct' },
  ],
  industrial_warehousing: [
    { key: 'leasableAreaSqft',        label: 'Industrial floor area',   category: 'Site & area',       kind: 'fact' },
    { key: 'landCostCr',              label: 'Land cost',               category: 'Costs',             kind: 'fact' },
    { key: 'constructionCostPerSqft', label: 'Construction cost / sqft', category: 'Costs',            kind: 'fact' },
    { key: 'opexPct',                 label: 'Operating expenses',      category: 'Costs',             kind: 'assumption', defaultKey: 'opexPct' },
    { key: 'baseRentPerSqftMonth',    label: 'Base rent / sqft / month', category: 'Revenue & pricing', kind: 'fact' },
    { key: 'rentEscalationPct',       label: 'Rent escalation',         category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'rentEscalationPct' },
    { key: 'vacancyPct',              label: 'Vacancy',                 category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'vacancyPct' },
    { key: 'exitCapRate',             label: 'Exit cap rate',           category: 'Financing',         kind: 'assumption', defaultKey: 'exitCapRatePct' },
    { key: 'discountRatePct',         label: 'Discount rate',           category: 'Financing',         kind: 'assumption', defaultKey: 'discountRatePct' },
  ],
  hospitality: [
    { key: 'keys',               label: 'Number of keys',         category: 'Site & area',       kind: 'fact' },
    { key: 'constructionCostPerKey', label: 'Construction cost / key', category: 'Costs',         kind: 'fact' },
    { key: 'landCostCr',         label: 'Land cost',              category: 'Costs',             kind: 'fact' },
    { key: 'gopMarginPct',       label: 'GOP margin',             category: 'Costs',             kind: 'assumption', defaultKey: 'gopMarginPct' },
    { key: 'adr',                label: 'Average daily rate',     category: 'Revenue & pricing', kind: 'fact' },
    { key: 'stabilizedOccPct',   label: 'Stabilized occupancy',   category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'stabilizedOccPct' },
    { key: 'fbRevPct',           label: 'F&B revenue',            category: 'Revenue & pricing', kind: 'assumption', defaultKey: 'fbRevPct' },
    { key: 'exitCapRate',        label: 'Exit cap rate',          category: 'Financing',         kind: 'assumption', defaultKey: 'exitCapRatePct' },
    { key: 'discountRatePct',    label: 'Discount rate',          category: 'Financing',         kind: 'assumption', defaultKey: 'discountRatePct' },
  ],
});

// Floating-point slack for "value equals the benchmark default".
const EPSILON = 1e-6;

/** Coerce a stored input to a finite number, or null when blank/garbage. */
function numericOrNull(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Look up the kernel benchmark metadata for a default key, fail-soft.
 * `getDefaultMeta` throws on an unknown key — we never want that to break a
 * read-side panel, so an unknown key resolves to null.
 */
function benchmarkMeta(modelClass, defaultKey) {
  if (!kernel || !defaultKey || typeof kernel.getDefaultMeta !== 'function') return null;
  try {
    const meta = kernel.getDefaultMeta(modelClass, defaultKey);
    return meta && typeof meta.value === 'number' ? meta : null;
  } catch (err) {
    return null;
  }
}

/** Classify one catalogue entry against the saved inputs. */
function classifyInput(spec, inputs, modelClass) {
  const value = numericOrNull(inputs[spec.key]);

  // Deal-specific fact — 'deal-set' whenever the analyst supplied a value.
  if (spec.kind === 'fact') {
    return {
      key: spec.key,
      label: spec.label,
      category: spec.category,
      kind: 'fact',
      status: value === null ? 'default' : 'deal-set',
      value,
      benchmarkValue: null,
      benchmarkSource: null,
      basis: value === null ? 'Not specified for this deal' : 'Entered for this deal',
    };
  }

  // Benchmark assumption — compare against the kernel's cited default.
  const meta = benchmarkMeta(modelClass, spec.defaultKey);
  const benchmarkValue = meta ? meta.value : null;
  const benchmarkSource = meta ? meta.source : null;

  // Blank, or matches the benchmark → still on the Acureal default.
  if (value === null) {
    return {
      key: spec.key,
      label: spec.label,
      category: spec.category,
      kind: 'assumption',
      status: 'default',
      value: null,
      benchmarkValue,
      benchmarkSource,
      basis: benchmarkSource
        ? `On the Acureal benchmark default — ${benchmarkSource}`
        : 'On the Acureal benchmark default',
    };
  }
  if (meta && Math.abs(value - benchmarkValue) < EPSILON) {
    return {
      key: spec.key,
      label: spec.label,
      category: spec.category,
      kind: 'assumption',
      status: 'default',
      value,
      benchmarkValue,
      benchmarkSource,
      basis: benchmarkSource
        ? `Matches the Acureal benchmark — ${benchmarkSource}`
        : 'Matches the Acureal benchmark default',
    };
  }
  // We could not prove a departure from the benchmark — under-claim and keep
  // it as 'default' rather than guessing the analyst tuned it deliberately.
  if (!meta) {
    return {
      key: spec.key,
      label: spec.label,
      category: spec.category,
      kind: 'assumption',
      status: 'default',
      value,
      benchmarkValue: null,
      benchmarkSource: null,
      basis: 'Treated as a benchmark assumption',
    };
  }
  // Value is present and provably departs from the cited benchmark.
  return {
    key: spec.key,
    label: spec.label,
    category: spec.category,
    kind: 'assumption',
    status: 'deal-set',
    value,
    benchmarkValue,
    benchmarkSource,
    basis: 'Adjusted for this deal, off the Acureal benchmark',
  };
}

/** Map a confidence percentage to a coarse, honest band. */
function bandFor(pct) {
  if (pct === null) return null;
  if (pct >= 70) return 'grounded';
  if (pct >= 40) return 'mixed';
  return 'assumption-led';
}

/**
 * Build the model-confidence summary for a deal's saved financial model.
 *
 * Returns `{ available: false, reason }` (never throws) when the deal has no
 * financial model, when the kernel dist is missing, or when the model class
 * is not yet catalogued — the panel simply hides itself in those cases.
 *
 * The 404 visibility gate is inherited from `financialService.getFinancials`:
 * a caller who cannot read the deal cannot read its model confidence.
 */
async function getModelConfidence(dealId) {
  let fin;
  try {
    fin = await financialService.getFinancials(dealId);
  } catch (err) {
    // No financial row yet → nothing to summarise. Soft-fail so the panel
    // hides instead of surfacing an error on a deal with no model.
    if (err && (err.statusCode === 404 || err.status === 404)) {
      return { available: false, reason: 'no financial model on this deal yet' };
    }
    throw err;
  }

  const mp = fin.model_params || {};
  const inputs = mp.inputs || {};
  const selectedClass = fin.asset_class || 'residential_apartments';
  const modelClass = mp.financialModelClass || resolveFinancialModelClass(selectedClass);

  if (!kernel) {
    return { available: false, reason: 'financial kernel build unavailable' };
  }

  const catalogue = MATERIAL_INPUTS_BY_CLASS[modelClass];
  if (!catalogue) {
    return {
      available: false,
      reason: `model confidence not yet catalogued for "${modelClass}"`,
    };
  }

  const classified = catalogue.map((spec) => classifyInput(spec, inputs, modelClass));

  const dealSetCount = classified.filter((c) => c.status === 'deal-set').length;
  const total = classified.length;
  const defaultCount = total - dealSetCount;
  const confidencePct = total > 0 ? Math.round((dealSetCount / total) * 100) : null;

  return {
    available: true,
    assetClass: selectedClass,
    modelClass,
    dealSetCount,
    defaultCount,
    total,
    confidencePct,
    band: bandFor(confidencePct),
    inputs: classified,
    computedAt: new Date().toISOString(),
  };
}

module.exports = {
  getModelConfidence,
  // The material-input catalogue is the shared source of truth for which
  // inputs are deal facts vs. benchmark assumptions. confidenceRange.service
  // consumes it so the two Provenance-Spine panels stay perfectly aligned.
  MATERIAL_INPUTS_BY_CLASS,
  // Exported for unit tests.
  _internal: { classifyInput, bandFor, numericOrNull, MATERIAL_INPUTS_BY_CLASS },
};
