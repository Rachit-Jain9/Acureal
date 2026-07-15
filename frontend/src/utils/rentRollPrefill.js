// Mirror of backend/src/utils/rentRollPrefill.js. Keep in lockstep — run
// backend/tests/rentRollPrefill.parity.test.js.
//
// Register → financial-model prefill mapper. A thin, pure layer over the
// deterministic metric engines — it maps already-computed aggregates onto the
// kernel's canonical inputs and NEVER re-derives math (CLAUDE.md hard rule).
//
// Mirrored at frontend/src/utils/rentRollPrefill.js — keep in lockstep, run
// backend/tests/rentRollPrefill.parity.test.js.
//
// Two families seed a model today:
//   • lease_income (office / retail / industrial) → in-place rent, occupancy,
//     escalation, opex. GROSS rent (the kernel's JDA/JV transform nets
//     ownership downstream — never pre-net).
//   • sales_collections (plotted development) → sold-plot realization rate and
//     mean plot size for the merchant-sale model.
// Every other class returns { supported: false } with an honest reason.

import { computeLeaseMetrics, computeSaleMetrics, METRICS_VERSION } from './rentRollMetrics';

export const INCOME_PREFILL_CLASSES = new Set([
  'commercial_office', 'retail', 'industrial_warehousing',
]);
export const SALES_PREFILL_CLASSES = new Set(['plotted_development']);

const round = (v, dp) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const f = 10 ** dp;
  return Math.round(Number(v) * f) / f;
};

// The modal passes the whole kind-map ({ lease, sale, ... }); older income
// callers/tests pass a bare lease-row array. Tolerate both.
const leaseRowsOf = (records) => (Array.isArray(records) ? records : (records?.lease || []));
const saleRowsOf = (records) => (Array.isArray(records) ? [] : (records?.sale || []));

const pushField = (fields) => (name, label, derived, unit, note) => {
  if (derived === null) return;
  fields.push({ name, label, derived, unit, note });
};

// ── lease_income → income model ─────────────────────────────────────────────
const buildIncomePrefill = ({ records, register, assetClass }) => {
  const metrics = computeLeaseMetrics(leaseRowsOf(records), register || {});
  const { occupancy, revenue, counts } = metrics;
  const fields = [];
  const push = pushField(fields);

  const areaDerivable = occupancy.denominatorSqft !== null
    && (occupancy.denominatorSource === 'register_total' || occupancy.denominatorSource === 'sum_of_rows');
  push(
    'leasableAreaSqft', 'Leasable Area (sqft)',
    areaDerivable ? Math.round(occupancy.denominatorSqft) : null, 'sqft',
    occupancy.denominatorSource === 'register_total'
      ? 'Register total leasable area'
      : 'Sum of recorded lease areas (incl. vacant)',
  );
  // Retail: the kernel's baseRentPerSqftMonth is the INLINE (non-anchor)
  // rate — it applies the anchor discount itself (blendedFactor). Seeding the
  // blended register rate would double-count the discount, so retail uses the
  // ex-anchor weighted rate (rows flagged Anchor / Mini anchor excluded).
  const isRetail = assetClass === 'retail';
  push(
    'baseRentPerSqftMonth', 'Base Rent (₹/sqft/month)',
    round(isRetail
      ? revenue.inPlaceRentPerSqftMonthExAnchor
      : revenue.inPlaceRentPerSqftMonth, 2), '₹/sqft/mo',
    isRetail
      ? 'Inline (non-anchor) in-place rent — the model blends the anchor discount itself; gross, before any ownership share'
      : 'Area-weighted in-place rent — gross, before any ownership share',
  );
  push(
    'vacancyPct', 'Vacancy (%)',
    occupancy.committedPct === null
      ? null
      : round(Math.min(Math.max(100 - occupancy.committedPct, 0), 100), 2), '%',
    `100 − committed occupancy (LOI policy: ${occupancy.loiPolicy})`,
  );
  push(
    'rentEscalationPct', 'Rent Escalation (% pa)',
    round(revenue.weightedEscalationPctAnnual, 2), '%',
    'Rent-weighted, annualized from each lease’s escalation terms',
  );
  push(
    'opexPct', 'Operating Expenses (%)',
    round(revenue.opexPctOfEgrBasis, 2), '%',
    'All recorded owner opex ÷ contracted (+LOI) base rent — the model’s effective-gross basis',
  );

  return {
    supported: true,
    fields,
    provenance: {
      source: 'rent_roll',
      basisCount: counts.contracted,
      basisNoun: 'lease',
      totalRecords: counts.total,
      asOfDate: metrics.asOf,
      metricsVersion: METRICS_VERSION,
    },
  };
};

// ── sales_collections → plotted merchant-sale model ─────────────────────────
const buildSalesPrefill = ({ records, register }) => {
  const metrics = computeSaleMetrics(saleRowsOf(records), register || {});
  const { pricing, inventory } = metrics;
  const fields = [];
  const push = pushField(fields);

  // The kernel's revenue = totalPlots × avgPlotSize × sellingRate, all on the
  // BASE list rate (charges like PLC/infra live outside it). Seed the weighted
  // base rate on sold plots, not the charge-inclusive realization.
  push(
    'sellingRatePerSqft', 'Selling Rate (₹/sqft)',
    round(pricing.avgSoldBaseRatePerSqft, 0), '₹/sqft',
    'Area-weighted base list rate on sold plots (excl. PLC / infra / other charges)',
  );
  push(
    'avgPlotSizeSqft', 'Avg Plot Size (sqft)',
    round(pricing.avgSoldPlotSizeSqft, 0), 'sqft',
    'Mean saleable area across sold plots',
  );
  // Deliberately NOT seeded: totalLandSqft / saleableLandPct describe the whole
  // project (plots are ~50–60% of gross land) — summing plot areas would
  // understate the land base. The operator owns those inputs.

  return {
    supported: true,
    fields,
    provenance: {
      source: 'rent_roll',
      basisCount: inventory.soldUnits,
      basisNoun: 'sold unit',
      totalRecords: metrics.counts.total,
      asOfDate: metrics.asOf,
      metricsVersion: METRICS_VERSION,
    },
  };
};

/**
 * Build the field-by-field prefill proposal for the Apply-to-Financials
 * comparison. Returns { supported: false, reason } for classes with no
 * register bridge yet, else { supported: true, fields, provenance }.
 *
 * @param {object} args
 * @param {object|Array} args.records  the register's kind-map, or a bare
 *   lease-row array (income back-compat)
 * @param {object} args.register       the deal_registers row
 * @param {string} args.assetClass
 */
export const buildRegisterPrefill = ({ records, register, assetClass }) => {
  if (INCOME_PREFILL_CLASSES.has(assetClass)) {
    return buildIncomePrefill({ records, register, assetClass });
  }
  if (SALES_PREFILL_CLASSES.has(assetClass)) {
    return buildSalesPrefill({ records, register });
  }
  return {
    supported: false,
    reason: 'This deal type does not have a register → model bridge yet. '
      + 'The register remains the evidence layer; its family bridge ships separately.',
  };
};

// Relative tolerance for "the model still reflects the seeding" — generous
// enough to absorb display rounding, tight enough that a real hand-edit
// (operator overriding a seeded assumption) breaks the citation.
const PROVENANCE_MATCH_TOLERANCE = 0.005;

/**
 * Decide which rent-roll provenance (if any) a freshly saved model should
 * carry. Deterministic, pure:
 *  - a calculate that arrives WITH provenance (the Apply flow) cites it;
 *  - otherwise the previously saved citation is carried forward ONLY while
 *    every accepted field's current input still matches the accepted value —
 *    the moment the operator hand-edits a seeded assumption, the model is no
 *    longer traceable to the snapshot and the citation is dropped, never
 *    left dangling.
 */
export const reconcileRentRollProvenance = (previous, incoming, kernelInputs) => {
  if (incoming) return incoming;
  if (!previous) return null;
  const accepted = Array.isArray(previous.acceptedFields) ? previous.acceptedFields : [];
  if (accepted.length === 0) return null;
  for (const f of accepted) {
    const current = Number(kernelInputs?.[f.name]);
    const acceptedValue = Number(f.value);
    if (!Number.isFinite(current) || !Number.isFinite(acceptedValue)) return null;
    const tolerance = Math.max(Math.abs(acceptedValue) * PROVENANCE_MATCH_TOLERANCE, 0.005);
    if (Math.abs(current - acceptedValue) > tolerance) return null;
  }
  return previous;
};

