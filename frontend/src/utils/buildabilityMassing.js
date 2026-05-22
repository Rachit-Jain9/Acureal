/**
 * Buildability massing model — Workstream E (the spatial canvas).
 *
 * Turns the deterministic parcel-buildability numbers (FAR, ground
 * coverage, buildable area) into the spatial quantities a massing diagram
 * needs: the buildable footprint, and how many floors the legal FAR
 * spreads into over that footprint.
 *
 * Pure, deterministic — no AI. Every figure traces to the verified
 * buildability values; this module only re-expresses them spatially.
 *
 * The diagram drawn from this is a *schematic*: REDIP holds the parcel's
 * area but not its surveyed shape, so the plot is rendered as a
 * representative square. The proportions that carry meaning — coverage,
 * floor count, FAR utilisation — are exact.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Build the massing model from the buildability values + the plot area.
 *
 * @param {object} input
 * @param {object} input.values        the parcel-intelligence buildability
 *                                     values: ground_coverage_pct, max_far,
 *                                     max_buildable_area_sqft, …
 * @param {number} input.landAreaSqft  the plot area.
 * @returns {{ plotSqft, footprintSqft, coveragePct, openGroundPct, maxFar,
 *             maxBuildableSqft, floors, footprintRatio } | null}
 *          null when there is not enough verified data to draw a massing.
 */
export function buildMassingModel({ values, landAreaSqft } = {}) {
  const v = values || {};
  const plotSqft = num(landAreaSqft);
  const coverageRaw = num(v.ground_coverage_pct);

  // A massing needs a real plot area and a real ground-coverage rule —
  // without either, there is no honest footprint to draw.
  if (!plotSqft || plotSqft <= 0 || !coverageRaw || coverageRaw <= 0) return null;

  const coveragePct = Math.min(coverageRaw, 100);
  const footprintSqft = plotSqft * (coveragePct / 100);

  const maxFar = num(v.max_far);
  const maxBuildableSqft =
    num(v.max_buildable_area_sqft) || (maxFar ? plotSqft * maxFar : null);

  // Floors = total buildable area spread over the footprint. This is the
  // height of the massing — how tall the FAR forces the building to go
  // once ground coverage caps how wide it can be.
  const floorsRaw =
    maxBuildableSqft && footprintSqft > 0 ? maxBuildableSqft / footprintSqft : null;
  const floors = floorsRaw ? Math.max(1, Math.round(floorsRaw)) : 1;

  return {
    plotSqft,
    footprintSqft,
    coveragePct,
    openGroundPct: Math.max(0, Math.round(100 - coveragePct)),
    maxFar,
    maxBuildableSqft,
    floors,
    floorsRaw,
    // Side ratio of the (square-schematic) footprint vs the plot —
    // sqrt of the area ratio. Drives the diagram's inset.
    footprintRatio: Math.sqrt(coveragePct / 100),
  };
}

export default buildMassingModel;
