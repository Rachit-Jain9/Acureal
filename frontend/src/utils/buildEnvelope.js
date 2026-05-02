// Mirror of backend/src/utils/buildEnvelope.js. Keep in lockstep — change
// one, change both, run the parity test in
// backend/tests/buildEnvelope.parity.test.js.
//
// Pure deterministic JS — encodes Volume 6 Tables 1 and 2 plus per-zone
// FAR road-width rules. No AI involvement. Used by the Decision Strip UI
// in MasterPlanAdminPage to compute the build envelope for a chosen zone.

export const FRONT_SETBACK_BY_ROAD_WIDTH = [
  { road_width_m:  6.0, front_m: 1.0, building_line_from_centre_m:  4.00 },
  { road_width_m:  7.5, front_m: 1.0, building_line_from_centre_m:  4.75 },
  { road_width_m:  9.0, front_m: 1.75, building_line_from_centre_m: 6.25 },
  { road_width_m: 12.0, front_m: 2.0, building_line_from_centre_m:  8.00 },
  { road_width_m: 15.0, front_m: 2.5, building_line_from_centre_m: 10.00 },
  { road_width_m: 18.0, front_m: 3.5, building_line_from_centre_m: 12.50 },
  { road_width_m: 24.0, front_m: 3.5, building_line_from_centre_m: 15.50 },
  { road_width_m: 30.0, front_m: 4.0, building_line_from_centre_m: 19.00 },
  { road_width_m: 45.0, front_m: 6.0, building_line_from_centre_m: 28.50 },
  { road_width_m: 60.0, front_m: 6.0, building_line_from_centre_m: 36.00 },
];

export const SETBACK_BY_HEIGHT = [
  { max_height_m:  9.5,  max_floors_label: 'G+1',           plot_area_sqm_max:  60, front_m: 1.0, rear_m: 0.5, side_m: 0.5 },
  { max_height_m:  9.5,  max_floors_label: 'G+1 / Stilt+2', plot_area_sqm_max: 120, front_m: 1.0, rear_m: 1.0, side_m: 1.0 },
  { max_height_m: 12.5,  max_floors_label: 'G+2 / Stilt+3', plot_area_sqm_max: 240, front_m: 2.0, rear_m: 2.0, side_m: 2.0 },
  { max_height_m: 15.0,  max_floors_label: 'G+3 / Stilt+4', plot_area_sqm_max: 360, front_m: 3.0, rear_m: 3.0, side_m: 3.0 },
  { max_height_m: 15.0,  max_floors_label: 'G+4 / Stilt+4', plot_area_sqm_max: null, front_m: 4.0, rear_m: 4.0, side_m: 4.0 },
  { max_height_m: 18.0,  max_floors_label: 'G+5',           plot_area_sqm_max: null, front_m: 6.0, rear_m: 6.0, side_m: 6.0 },
  { max_height_m: 21.0,  max_floors_label: 'G+6',           plot_area_sqm_max: null, front_m: 7.0, rear_m: 7.0, side_m: 7.0 },
  { max_height_m: 24.0,  max_floors_label: 'G+7',           plot_area_sqm_max: null, front_m: 8.0, rear_m: 8.0, side_m: 8.0 },
  { max_height_m: 27.0,  max_floors_label: 'G+8',           plot_area_sqm_max: null, front_m: 9.0, rear_m: 9.0, side_m: 9.0 },
  { max_height_m: 30.0,  max_floors_label: 'G+9',           plot_area_sqm_max: null, front_m: 10.0, rear_m: 10.0, side_m: 10.0 },
  { max_height_m: 36.0,  max_floors_label: 'G+11',          plot_area_sqm_max: null, front_m: 11.0, rear_m: 11.0, side_m: 11.0 },
  { max_height_m: 42.0,  max_floors_label: 'G+13',          plot_area_sqm_max: null, front_m: 12.0, rear_m: 12.0, side_m: 12.0 },
  { max_height_m: 48.0,  max_floors_label: 'G+15',          plot_area_sqm_max: null, front_m: 13.0, rear_m: 13.0, side_m: 13.0 },
  { max_height_m: 54.0,  max_floors_label: 'G+17',          plot_area_sqm_max: null, front_m: 14.0, rear_m: 14.0, side_m: 14.0 },
  { max_height_m: 60.0,  max_floors_label: 'G+19',          plot_area_sqm_max: null, front_m: 15.0, rear_m: 15.0, side_m: 15.0 },
  { max_height_m: 999.0, max_floors_label: 'Above G+19',    plot_area_sqm_max: null, front_m: 16.0, rear_m: 16.0, side_m: 16.0 },
];

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function frontSetbackByRoadWidth(roadWidthM) {
  const w = toNumber(roadWidthM);
  if (w === null || w <= 0) return null;
  let match = null;
  for (const tier of FRONT_SETBACK_BY_ROAD_WIDTH) {
    if (w >= tier.road_width_m) match = tier;
  }
  return match
    ? { front_m: match.front_m, building_line_from_centre_m: match.building_line_from_centre_m, source_tier_m: match.road_width_m }
    : { front_m: FRONT_SETBACK_BY_ROAD_WIDTH[0].front_m, building_line_from_centre_m: FRONT_SETBACK_BY_ROAD_WIDTH[0].building_line_from_centre_m, source_tier_m: FRONT_SETBACK_BY_ROAD_WIDTH[0].road_width_m };
}

export function setbackByHeight(buildingHeightM, plotAreaSqm) {
  const h = toNumber(buildingHeightM);
  const a = toNumber(plotAreaSqm);
  if (h === null || h <= 0) return null;
  for (const tier of SETBACK_BY_HEIGHT) {
    if (h <= tier.max_height_m) {
      if (tier.plot_area_sqm_max !== null && a !== null && a > tier.plot_area_sqm_max) {
        continue;
      }
      return {
        front_m: tier.front_m,
        rear_m: tier.rear_m,
        side_m: tier.side_m,
        max_floors_label: tier.max_floors_label,
        max_height_m: tier.max_height_m,
        plot_area_sqm_cap: tier.plot_area_sqm_max,
      };
    }
  }
  const last = SETBACK_BY_HEIGHT[SETBACK_BY_HEIGHT.length - 1];
  return {
    front_m: last.front_m,
    rear_m: last.rear_m,
    side_m: last.side_m,
    max_floors_label: last.max_floors_label,
    max_height_m: last.max_height_m,
    plot_area_sqm_cap: last.plot_area_sqm_max,
  };
}

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
  if (!match) {
    match = sorted[0] || null;
  }

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

export function calculateBuildEnvelope(zone, inputs = {}) {
  const roadWidthM = toNumber(inputs.roadWidthM);
  const plotAreaSqm = toNumber(inputs.plotAreaSqm);
  const buildingHeightM = toNumber(inputs.buildingHeightM);

  if (!zone) {
    return {
      ok: false,
      error: 'Zone is required for build envelope calculation.',
    };
  }

  const far = effectiveFARFromZone(zone, roadWidthM);
  const heightSetbacks = buildingHeightM ? setbackByHeight(buildingHeightM, plotAreaSqm) : null;
  const roadFront = roadWidthM ? frontSetbackByRoadWidth(roadWidthM) : null;

  const effectiveFrontM = (() => {
    if (roadFront && heightSetbacks) return Math.max(roadFront.front_m, heightSetbacks.front_m);
    if (heightSetbacks) return heightSetbacks.front_m;
    if (roadFront) return roadFront.front_m;
    return null;
  })();

  const baseFsi = far ? far.base_fsi : null;
  const maxFsi  = far ? far.max_fsi  : null;
  const groundCoveragePct = far ? far.ground_coverage_pct : toNumber(zone.ground_coverage_pct);

  const buildableBaseSqm = (plotAreaSqm !== null && baseFsi !== null) ? plotAreaSqm * baseFsi : null;
  const buildableMaxSqm  = (plotAreaSqm !== null && maxFsi  !== null) ? plotAreaSqm * maxFsi  : null;

  const footprintCapSqm = (plotAreaSqm !== null && groundCoveragePct !== null)
    ? plotAreaSqm * (groundCoveragePct / 100)
    : null;

  const heightCapByRoadM = (roadWidthM !== null && roadFront)
    ? (1.5 * roadWidthM) + roadFront.front_m
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
      front_m: effectiveFrontM,
      rear_m: heightSetbacks ? heightSetbacks.rear_m : null,
      side_m: heightSetbacks ? heightSetbacks.side_m : null,
      front_road_tier: roadFront,
      height_tier: heightSetbacks,
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
      front_setback_table: 'Volume 6 Table 1 (p.38)',
      height_setback_table: 'Volume 6 Table 2 (p.39)',
      far_table: zone.source_section || 'Volume 6 §§5-6',
      max_height_rule: 'Volume 6 §4.5.ii (max height ≤ 1.5 × road width + front setback)',
    },
    disclaimer: 'AI-assisted preview — requires human review against the original Volume 6 tables before quoting in IC memos.',
  };
}
