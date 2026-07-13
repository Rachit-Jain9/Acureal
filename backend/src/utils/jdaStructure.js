'use strict';

// ── JDA / Development-Management structure adjustment ────────────────────────
//
// The single biggest structural accuracy fix in the model. A Joint Development
// Agreement (JDA) — the most common Bengaluru deal structure — does NOT buy the
// land. The landowner CONTRIBUTES it in exchange for a share of the project's
// revenue (revenue-share) or built-up area (area-share). Every generic model
// (and, until now, REDIP's kernel) charges the developer the full land cost, as
// if they bought it — which overstates project uses and understates the
// developer's return, often massively.
//
// The correct model (operator-confirmed 2026-07-13):
//   • Land cost = 0 — contributed, not purchased. Stamp duty (a % of land cost)
//     zeroes out with it automatically.
//   • The developer keeps (1 − share) of revenue, built on the FULL area.
//
// Revenue-share and area-share are ECONOMICALLY IDENTICAL for the developer:
//   revenue-share → sells all area at full rate, remits `share` of revenue
//                   → net = fullArea × rate × (1 − share)
//   area-share    → sells (1 − share) of area at full rate, builds all area
//                   → net = fullArea × rate × (1 − share)
// Both collapse to a single revenue-side factor (1 − share) on full-area
// construction, so the math needs no per-deal basis — the basis only affects
// presentation and GST/TDS treatment (a separate, later concern).
//
// TRIGGER: the presence of a valid landowner share (0 < share < 1) IS the JDA
// signal — an outright purchase never carries one (the export QA validator flags
// that contradiction). This lets the adjustment live at the single kernel-service
// boundary and cover every compute path without threading `deal_structure`
// through each call-site.
//
// The kernel already handles `landCostCr = 0` safely (income and no-land deals
// use it), and requires `sellingRatePerSqft > 0` — guaranteed since share < 1.
// Pure and side-effect-free: returns a NEW input object, never mutates.

const asShare = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Accept 0.25 or 25 → 0.25; reject nonsense (>= 1 as a decimal, > 100 as pct).
  const share = n > 1 ? n / 100 : n;
  return share > 0 && share < 1 ? share : null;
};

// Resolve the landowner's revenue/area share from whichever field carries it.
const resolveLandownerShare = (input) => {
  if (!input || typeof input !== 'object') return null;
  for (const key of ['landownerSharePct', 'landownerRevenueShare', 'landownerAreaSharePct', 'landownerAreaShare']) {
    const share = asShare(input[key]);
    if (share != null) return share;
  }
  return null;
};

// Returns { input, adjustment }. `adjustment` is null when nothing was applied
// (no valid share → not a JDA, or an outright deal) — the input passes through
// unchanged. When applied, `adjustment` is an auditable record of the transform.
const applyJdaStructureAdjustment = (input) => {
  const share = resolveLandownerShare(input);
  if (share == null) return { input, adjustment: null };

  const keep = 1 - share;
  const next = { ...input, landCostCr: 0 };

  const rate = Number(input.sellingRatePerSqft);
  if (Number.isFinite(rate) && rate > 0) next.sellingRatePerSqft = rate * keep;

  const rent = Number(input.baseRentPerSqftMonth);
  if (Number.isFinite(rent) && rent > 0) next.baseRentPerSqftMonth = rent * keep;

  return {
    input: next,
    adjustment: {
      applied: true,
      landownerShare: share,
      revenueKeepFactor: keep,
      landContributed: true,
      grossLandCostCr: Number(input.landCostCr) || 0,
      note: `JDA structure: land contributed (0 cost); developer keeps ${(keep * 100).toFixed(0)}% of revenue (landowner share ${(share * 100).toFixed(0)}%).`,
    },
  };
};

module.exports = { asShare, resolveLandownerShare, applyJdaStructureAdjustment };
