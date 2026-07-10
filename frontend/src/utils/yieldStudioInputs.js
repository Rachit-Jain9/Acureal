// Converts the UI-shaped Yield Studio assumptions (what the editor + the saved
// study store: loadingFactorPct, mix, …) into the ENGINE-shaped assumptions
// computeSiteYield consumes (loadingFactor fraction, unitMix, …). Lives here —
// not in the tab — so the server can apply the same conversion when it
// recomputes a saved study for exports.
//
// Mirror of backend/src/utils/yieldStudioInputs.js. Keep in lockstep — change
// one, change both, and run backend/tests/yieldStudioInputs.parity.test.js.

export const numOrUndef = (v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Clamp a percent-shaped input to [0, 100]. The engine's defensive ">1 means
// percent" heuristic re-divides any fraction above 1.0, so an unclamped 101%
// (fraction 1.01) collapsed to 0.0101 — a hard discontinuity right above 100.
// Loading beyond 100% isn't a real screening input; clamp at the boundary.
const clampPct = (n) => Math.min(100, Math.max(0, n));

// Map UI assumption state → engine assumptions (with correct units). A CLEARED
// field ('') is gated out via numOrUndef so the engine falls back to its own
// default instead of receiving an explicit 0.
export function buildEngineAssumptions(family, a = {}) {
  const out = {};
  if (family === 'residential') {
    if (numOrUndef(a.loadingFactorPct) != null) out.loadingFactor = clampPct(Number(a.loadingFactorPct)) / 100;
    if (numOrUndef(a.parkingEcsPerUnit) != null) out.parkingEcsPerUnit = Number(a.parkingEcsPerUnit);
    if (Array.isArray(a.mix)) out.unitMix = a.mix.map((m) => ({ ...m, share_pct: numOrUndef(m.share_pct) ?? 0 }));
  } else if (family === 'commercial' || family === 'industrial') {
    if (numOrUndef(a.leasableEfficiencyPct) != null) out.leasableEfficiency = Number(a.leasableEfficiencyPct) / 100;
    if (numOrUndef(a.parkingEcsPer100Sqm) != null) out.parkingEcsPer100Sqm = Number(a.parkingEcsPer100Sqm);
  } else if (family === 'hospitality') {
    if (numOrUndef(a.grossAreaPerKeySqft) != null) out.grossAreaPerKeySqft = Number(a.grossAreaPerKeySqft);
    if (numOrUndef(a.parkingEcsPerKey) != null) out.parkingEcsPerKey = Number(a.parkingEcsPerKey);
  } else if (family === 'plotted') {
    if (numOrUndef(a.saleableLandPct) != null) out.saleableLandPct = Number(a.saleableLandPct) / 100;
    if (numOrUndef(a.avgPlotSizeSqft) != null) out.avgPlotSizeSqft = Number(a.avgPlotSizeSqft);
    if (numOrUndef(a.villaPlotCoveragePct) != null) out.villaPlotCoveragePct = Number(a.villaPlotCoveragePct);
    if (numOrUndef(a.villaFloors) != null) out.villaFloors = Number(a.villaFloors);
  }
  return out;
}
