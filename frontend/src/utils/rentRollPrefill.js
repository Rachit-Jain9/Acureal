// Mirror of backend/src/utils/rentRollPrefill.js. Keep in lockstep — change
// one, change both, run backend/tests/rentRollPrefill.parity.test.js.
//
// Register → financial-model prefill mapper. A thin, pure layer over
// computeLeaseMetrics — it maps already-computed aggregates onto the kernel's
// canonical income inputs and NEVER re-derives math (CLAUDE.md hard rule).
//
// Scope (plan v2): only the kernel's INCOME family consumes lease-register
// aggregates — the development-family models (residential/villas/mixed_use/
// raw_land route there) are merchant-sale models with no rent inputs to seed.
// Their bridges arrive with the sales/hospitality register PRs.
//
// The rent figure is GROSS (pre JDA/JV landowner share) by construction —
// the kernel's structure transform nets ownership downstream. Never pre-net.

import { computeLeaseMetrics, METRICS_VERSION } from './rentRollMetrics';

export const INCOME_PREFILL_CLASSES = new Set([
  'commercial_office', 'retail', 'industrial_warehousing',
]);

const round = (v, dp) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const f = 10 ** dp;
  return Math.round(Number(v) * f) / f;
};

/**
 * Build the field-by-field prefill proposal for the Apply-to-Financials
 * comparison. Returns { supported, reason? } for classes whose financial
 * model has no lease-income inputs, else { supported, fields, provenance }.
 *
 * Each field: { name (canonical kernel input), label, derived (number),
 * unit, note (how it was derived — shown under the comparison row) }.
 * Fields whose aggregate is underivable from the register are omitted —
 * the comparison never proposes a value it cannot ground.
 */
export const buildRegisterPrefill = ({ records, register, assetClass }) => {
  if (!INCOME_PREFILL_CLASSES.has(assetClass)) {
    return {
      supported: false,
      reason: 'This deal’s financial model is development-family — lease income does not seed it. '
        + 'The register remains the evidence layer; its own family bridge ships separately.',
    };
  }

  const metrics = computeLeaseMetrics(records || [], register || {});
  const { occupancy, revenue, counts } = metrics;

  const fields = [];
  const push = (name, label, derived, unit, note) => {
    if (derived === null) return;
    fields.push({ name, label, derived, unit, note });
  };

  // Occupancy denominator is only a defensible leasable-area figure when it
  // came from the register total or the summed rows — never echo back a
  // financial-inputs fallback as if the register measured it.
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
      contractedLeases: counts.contracted,
      totalRecords: counts.total,
      asOfDate: metrics.asOf,
      metricsVersion: METRICS_VERSION,
    },
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
