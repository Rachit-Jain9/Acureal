// Mirror of backend/src/utils/buildEnvelope.js. Keep in lockstep — change one,
// change both, and run the parity test in backend/tests/buildEnvelope.parity.test.js.
//
// Pure deterministic JS — no AI involvement. All figures come from the
// OPERATIVE Revised Master Plan 2015, Volume III (Zoning of Land Use and
// Regulations; Bangalore Development Authority, approved vide G.O. UDD 540
// BEM AA SE 2004 dated 22-06-2007):
//   - FAR / ground coverage: per-zone fsi_road_width_rules JSONB on master_plan_zones.
//   - Setbacks, height <= 11.5 m: Table 8 — percentage-based on the site's
//     width (left/right) and depth (front/rear); plot > 4000 sqm = 5 m all sides.
//   - Setbacks, height  > 11.5 m: Table 9 — uniform all-around setback by height.
// Used by the Decision Strip + Buildability Lab in MasterPlanAdminPage.

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round2 = (value) => {
  const n = toNumber(value);
  return n === null ? null : Math.round(n * 100) / 100;
};

// RMP 2015 Vol III, Table 9: uniform all-around setback (m) for buildings of
// height > 11.5 m, by height band (upper-inclusive). 11.5-15 -> 5.0 ... >50 -> 16.0.
export const HIGH_RISE_SETBACK_BY_HEIGHT = [
  { max_height_m: 15.0, setback_m: 5.0 },
  { max_height_m: 18.0, setback_m: 6.0 },
  { max_height_m: 21.0, setback_m: 7.0 },
  { max_height_m: 24.0, setback_m: 8.0 },
  { max_height_m: 27.0, setback_m: 9.0 },
  { max_height_m: 30.0, setback_m: 10.0 },
  { max_height_m: 35.0, setback_m: 11.0 },
  { max_height_m: 40.0, setback_m: 12.0 },
  { max_height_m: 45.0, setback_m: 13.0 },
  { max_height_m: 50.0, setback_m: 14.0 },
  { max_height_m: 9999.0, setback_m: 16.0 },
];

// RMP 2015 Vol III, Table 8 thresholds (height <= 11.5 m, plot <= 4000 sqm).
const LOW_RISE_HEIGHT_MAX_M = 11.5;
const LARGE_PLOT_SQM = 4000;
const LARGE_PLOT_SETBACK_M = 5.0;
const TABLE8_PCT = { right: 0.08, left: 0.08, front: 0.12, rear: 0.08 };

// Table 8 — left/right setback is referenced to the site WIDTH.
//   width <= 6.0 m  -> right 1.0 / left 0
//   6.0 < width <= 9.0 -> 1.0 m each
//   width > 9.0 m   -> 8% of width each
function widthReferencedSetback(siteWidthM) {
  const w = toNumber(siteWidthM);
  if (w === null) return { right_m: null, left_m: null };
  if (w <= 6.0) return { right_m: 1.0, left_m: 0.0 };
  if (w <= 9.0) return { right_m: 1.0, left_m: 1.0 };
  return { right_m: round2(TABLE8_PCT.right * w), left_m: round2(TABLE8_PCT.left * w) };
}

// Table 8 — front/rear setback is referenced to the site DEPTH.
//   depth <= 6.0 m  -> front 1.0 / rear 0
//   6.0 < depth <= 9.0 -> 1.0 m each
//   depth > 9.0 m   -> front 12% / rear 8% of depth
function depthReferencedSetback(siteDepthM) {
  const d = toNumber(siteDepthM);
  if (d === null) return { front_m: null, rear_m: null };
  if (d <= 6.0) return { front_m: 1.0, rear_m: 0.0 };
  if (d <= 9.0) return { front_m: 1.0, rear_m: 1.0 };
  return { front_m: round2(TABLE8_PCT.front * d), rear_m: round2(TABLE8_PCT.rear * d) };
}

// RMP 2015 Vol III Table 8 — low-rise (height <= 11.5 m). Setbacks depend on
// the site's width (left/right) and depth (front/rear). Plot > 4000 sqm gets a
// flat 5 m on all sides (Table 8 note).
export function lowRiseSetback({ siteWidthM, siteDepthM, plotAreaSqm } = {}) {
  const area = toNumber(plotAreaSqm);
  if (area !== null && area > LARGE_PLOT_SQM) {
    return {
      front_m: LARGE_PLOT_SETBACK_M,
      rear_m: LARGE_PLOT_SETBACK_M,
      left_m: LARGE_PLOT_SETBACK_M,
      right_m: LARGE_PLOT_SETBACK_M,
      basis: 'RMP 2015 Vol III Table 8 note (plot > 4000 sqm: 5 m all sides)',
      model: 'low_rise',
    };
  }
  const wr = widthReferencedSetback(siteWidthM);
  const dr = depthReferencedSetback(siteDepthM);
  return {
    front_m: dr.front_m,
    rear_m: dr.rear_m,
    left_m: wr.left_m,
    right_m: wr.right_m,
    basis: 'RMP 2015 Vol III Table 8 (low-rise; front/rear = % of depth, left/right = % of width)',
    model: 'low_rise',
  };
}

// RMP 2015 Vol III Table 9 — high-rise (height > 11.5 m), uniform all-around.
export function highRiseSetback(buildingHeightM) {
  const h = toNumber(buildingHeightM);
  if (h === null) return null;
  let tier = null;
  for (const t of HIGH_RISE_SETBACK_BY_HEIGHT) {
    if (h <= t.max_height_m) { tier = t; break; }
  }
  if (!tier) tier = HIGH_RISE_SETBACK_BY_HEIGHT[HIGH_RISE_SETBACK_BY_HEIGHT.length - 1];
  return {
    front_m: tier.setback_m,
    rear_m: tier.setback_m,
    left_m: tier.setback_m,
    right_m: tier.setback_m,
    tier_max_height_m: tier.max_height_m,
    basis: 'RMP 2015 Vol III Table 9 (high-rise; uniform all-around by height)',
    model: 'high_rise',
  };
}

// Pick the RMP 2015 setback model by building height. Height <= 11.5 m (or
// unknown height) -> Table 8; height > 11.5 m -> Table 9.
export function setbacksForBuilding({ buildingHeightM, siteWidthM, siteDepthM, plotAreaSqm } = {}) {
  const h = toNumber(buildingHeightM);
  if (h !== null && h > LOW_RISE_HEIGHT_MAX_M) return highRiseSetback(h);
  return lowRiseSetback({ siteWidthM, siteDepthM, plotAreaSqm });
}

// Derive site width & depth from area when not explicitly supplied. Table 8 is
// dimension-driven, so the Decision Strip estimates a square plot from the area
// unless the caller passes a real frontage/depth.
export function deriveSiteDimensions({ plotAreaSqm, siteWidthM, siteDepthM } = {}) {
  const area = toNumber(plotAreaSqm);
  const w = toNumber(siteWidthM);
  const d = toNumber(siteDepthM);
  if (w !== null && d !== null) return { width_m: w, depth_m: d, method: 'provided' };
  if (area === null || area <= 0) return { width_m: w, depth_m: d, method: 'incomplete' };
  if (w !== null) return { width_m: w, depth_m: round2(area / w), method: 'width_derived_depth' };
  if (d !== null) return { width_m: round2(area / d), depth_m: d, method: 'depth_derived_width' };
  const side = round2(Math.sqrt(area));
  return { width_m: side, depth_m: side, method: 'square_estimate' };
}

// Look up the FAR + ground-coverage tier from the zone's road-width rules for a
// given road width. Mirrors the JSONB seeded from RMP 2015 Vol III (each tier
// carries fsi + max_ground_coverage_pct + optional tdr_addition).
export function effectiveFARFromZone(zone, roadWidthM) {
  if (!zone) return null;
  const w = toNumber(roadWidthM);
  const baseFsi = toNumber(zone.permissible_fsi_base);
  const maxFsi = toNumber(zone.permissible_fsi_max);
  const rules = Array.isArray(zone.fsi_road_width_rules) ? zone.fsi_road_width_rules : [];

  if (w === null || w <= 0 || rules.length === 0) {
    return {
      base_fsi: baseFsi,
      max_fsi: maxFsi,
      tdr_addition: null,
      ground_coverage_pct: toNumber(zone.ground_coverage_pct),
      tier_road_width_m: null,
      tier_note: rules.length === 0 ? 'No road-width tiers configured for this zone' : 'No road width supplied',
    };
  }

  let match = null;
  const sorted = [...rules]
    .map((r) => ({
      road_width_m: toNumber(r.road_width_m),
      fsi: toNumber(r.fsi),
      ground_coverage_pct: toNumber(r.max_ground_coverage_pct),
      tdr_addition: toNumber(r.tdr_addition),
      note: r.note || null,
    }))
    .filter((r) => r.road_width_m !== null && r.fsi !== null)
    .sort((a, b) => a.road_width_m - b.road_width_m);

  for (const tier of sorted) {
    if (w >= tier.road_width_m) match = tier;
  }
  if (!match) match = sorted[0] || null;

  if (!match) {
    return { base_fsi: baseFsi, max_fsi: maxFsi, tdr_addition: null, ground_coverage_pct: toNumber(zone.ground_coverage_pct), tier_road_width_m: null };
  }

  return {
    base_fsi: match.fsi,
    max_fsi: match.tdr_addition !== null ? match.fsi + match.tdr_addition : match.fsi,
    tdr_addition: match.tdr_addition,
    ground_coverage_pct: match.ground_coverage_pct !== null ? match.ground_coverage_pct : toNumber(zone.ground_coverage_pct),
    tier_road_width_m: match.road_width_m,
    tier_note: match.note,
  };
}

// Combine FAR + ground-coverage + RMP 2015 setbacks + buildable-area into one
// verdict object. The Decision Strip UI consumes this directly.
export function calculateBuildEnvelope(zone, inputs = {}) {
  const roadWidthM = toNumber(inputs.roadWidthM);
  const plotAreaSqm = toNumber(inputs.plotAreaSqm);
  const buildingHeightM = toNumber(inputs.buildingHeightM);

  if (!zone) {
    return { ok: false, error: 'Zone is required for build envelope calculation.' };
  }

  const far = effectiveFARFromZone(zone, roadWidthM);

  const dims = deriveSiteDimensions({ plotAreaSqm, siteWidthM: inputs.siteWidthM, siteDepthM: inputs.siteDepthM });
  const sb = (buildingHeightM !== null || dims.width_m !== null || dims.depth_m !== null || plotAreaSqm !== null)
    ? setbacksForBuilding({ buildingHeightM, siteWidthM: dims.width_m, siteDepthM: dims.depth_m, plotAreaSqm })
    : null;

  const frontM = sb ? sb.front_m : null;
  const rearM = sb ? sb.rear_m : null;
  const leftM = sb ? sb.left_m : null;
  const rightM = sb ? sb.right_m : null;
  const sideCandidates = [leftM, rightM].filter((v) => v !== null);
  const sideM = sideCandidates.length ? Math.max(...sideCandidates) : null;

  const baseFsi = far ? far.base_fsi : null;
  const maxFsi = far ? far.max_fsi : null;
  const groundCoveragePct = far ? far.ground_coverage_pct : toNumber(zone.ground_coverage_pct);

  const buildableBaseSqm = (plotAreaSqm !== null && baseFsi !== null) ? plotAreaSqm * baseFsi : null;
  const buildableMaxSqm = (plotAreaSqm !== null && maxFsi !== null) ? plotAreaSqm * maxFsi : null;
  const footprintCapSqm = (plotAreaSqm !== null && groundCoveragePct !== null)
    ? plotAreaSqm * (groundCoveragePct / 100)
    : null;

  // Screening height ceiling: 1.5 x road width + front setback. This is a
  // conservative screening heuristic, NOT a specific RMP 2015 clause — labelled
  // as such in `sources`. RMP 2015 governs height via setbacks (Table 9) +
  // zone/road conditions + airport/fire NOCs; verify per parcel.
  const heightCapByRoadM = (roadWidthM !== null && frontM !== null)
    ? round2((1.5 * roadWidthM) + frontM)
    : null;

  const buildingHeightMaxM = toNumber(zone.building_height_max_m);
  const allowedHeightM = (() => {
    const candidates = [];
    if (buildingHeightMaxM !== null) candidates.push(buildingHeightMaxM);
    if (heightCapByRoadM !== null) candidates.push(heightCapByRoadM);
    return candidates.length ? Math.min(...candidates) : null;
  })();

  return {
    ok: true,
    zone: {
      id: zone.id,
      zone_code: zone.zone_code,
      zone_name: zone.zone_name,
      plan_version: zone.plan_version,
      source_page: zone.source_page,
      source_section: zone.source_section,
    },
    inputs: {
      road_width_m: roadWidthM,
      plot_area_sqm: plotAreaSqm,
      building_height_m: buildingHeightM,
      site_width_m: dims.width_m,
      site_depth_m: dims.depth_m,
      dimension_method: dims.method,
    },
    far: {
      base_fsi: baseFsi,
      max_fsi: maxFsi,
      tdr_addition: far ? far.tdr_addition : null,
      tier_road_width_m: far ? far.tier_road_width_m : null,
      tier_note: far ? far.tier_note : null,
    },
    ground_coverage_pct: groundCoveragePct,
    setbacks: {
      front_m: frontM,
      rear_m: rearM,
      side_m: sideM,
      left_m: leftM,
      right_m: rightM,
      basis: sb ? sb.basis : null,
      model: sb ? sb.model : null,
    },
    height: {
      zone_max_m: buildingHeightMaxM,
      road_cap_m: heightCapByRoadM,
      allowed_max_m: allowedHeightM,
    },
    capacity: {
      buildable_base_sqm: buildableBaseSqm,
      buildable_max_sqm: buildableMaxSqm,
      footprint_cap_sqm: footprintCapSqm,
    },
    sources: {
      far_table: zone.source_section || 'RMP 2015 Vol III (zone FAR/coverage rules)',
      low_rise_setback_table: 'RMP 2015 Vol III Table 8 (setbacks, height <= 11.5 m)',
      high_rise_setback_table: 'RMP 2015 Vol III Table 9 (setbacks, height > 11.5 m)',
      max_height_rule: 'Screening heuristic: 1.5 x road width + front setback (not a specific RMP 2015 clause - verify)',
    },
    disclaimer: 'Deterministic screening estimate. FAR, ground coverage and setbacks are computed from the operative RMP 2015 Vol III (Tables 8, 9 and the per-zone FAR/road-width tables). Setbacks for buildings up to 11.5 m are percentage-based on site width/depth; verify against the rulebook and a site survey before quoting in IC memos.',
  };
}
