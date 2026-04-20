// Deterministic buildability engine.
// Given a master plan zone + property parcel fields, computes the regulated
// envelope: effective FSI, max built-up area, ground-coverage limit, net plot
// after setbacks, max floors by coverage and by height, and asset-class
// alignment flags. Mirrors backend/services/masterplan.service.js
// calculateEffectiveFSI() so frontend stays consistent with the Postgres rules
// engine (regulatory_data.effective_fsi).

const SQFT_PER_SQM = 10.76391041671;
const FLOOR_HEIGHT_M = 3.0;

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function calculateEffectiveFSI(zone, roadWidthM) {
  if (!zone) return null;
  const base = toNum(zone.permissible_fsi_base);
  const rw = toNum(roadWidthM);
  const rules = Array.isArray(zone.fsi_road_width_rules) ? zone.fsi_road_width_rules : [];
  if (!rules.length || rw == null) return base;

  const applicable = rules
    .map((r) => ({ rw: toNum(r?.road_width_m), fsi: toNum(r?.fsi) }))
    .filter((r) => r.rw != null && r.rw <= rw)
    .sort((a, b) => b.rw - a.rw);

  return applicable[0]?.fsi ?? base;
}

// Find which tier in the zone matches the given road width.
// Returns { index, rule } or null if no tier matches / tiers are absent.
export function matchedTier(zone, roadWidthM) {
  if (!zone || !Array.isArray(zone.fsi_road_width_rules)) return null;
  const rw = toNum(roadWidthM);
  if (rw == null) return null;

  const indexed = zone.fsi_road_width_rules
    .map((rule, index) => ({ index, rule }))
    .filter(({ rule }) => toNum(rule?.road_width_m) != null && toNum(rule.road_width_m) <= rw)
    .sort((a, b) => toNum(b.rule.road_width_m) - toNum(a.rule.road_width_m));

  return indexed[0] || null;
}

// Heuristic net-plot calculation assuming a square plot footprint.
// Useful as a planning-grade estimate; actual setback geometry depends on the
// parcel's real dimensions, which the user can override.
function netPlotAfterSetbacks({ landSqft, frontM, rearM, sideM }) {
  if (!landSqft || landSqft <= 0) return null;
  const landSqm = landSqft / SQFT_PER_SQM;
  const side = Math.sqrt(landSqm);
  const front = toNum(frontM) ?? 0;
  const rear  = toNum(rearM)  ?? 0;
  const sideSet = toNum(sideM) ?? 0;
  const length = Math.max(0, side - front - rear);
  const width  = Math.max(0, side - 2 * sideSet);
  const netSqm = length * width;
  return {
    net_plot_sqm: netSqm,
    net_plot_sqft: netSqm * SQFT_PER_SQM,
    assumed_side_m: side,
    net_length_m: length,
    net_width_m: width,
  };
}

// Check whether the deal's asset class is permitted by the zone.
// Soft match: we look for keyword overlap between the asset class and the
// zone's permissible_uses list. If either side is missing we return "unknown".
const ASSET_CLASS_KEYWORDS = {
  residential_apartments: ['apartment', 'residential', 'villa', 'plotted', 'group housing'],
  residential_villas:     ['villa', 'row', 'plotted', 'residential'],
  plotted_development:    ['plotted', 'residential', 'villa'],
  commercial_office:      ['office', 'commercial', 'it', 'bpo'],
  commercial_retail:      ['retail', 'shopping', 'commercial'],
  mixed_use:              ['mixed', 'residential', 'commercial'],
  industrial:             ['industrial'],
  hospitality:            ['hotel', 'hospitality', 'resort'],
  warehousing:            ['warehouse', 'logistics', 'industrial'],
  data_center:            ['data', 'it', 'bpo', 'industrial', 'service'],
  senior_living:          ['senior', 'residential', 'pg', 'hostel'],
  student_housing:        ['hostel', 'pg', 'residential'],
  healthcare:             ['hospital', 'health', 'institution'],
  education:              ['education', 'school', 'institution'],
};

export function assetClassAlignment(assetClass, permissibleUses = [], prohibitedUses = []) {
  if (!assetClass || !Array.isArray(permissibleUses)) {
    return { status: 'unknown', matched: [], blocked: [] };
  }
  const keywords = ASSET_CLASS_KEYWORDS[assetClass] || [String(assetClass).toLowerCase().split('_')[0]];
  const lc = (s) => String(s || '').toLowerCase();

  const matched = permissibleUses.filter((use) =>
    keywords.some((kw) => lc(use).includes(kw)),
  );
  const blocked = (prohibitedUses || []).filter((use) =>
    keywords.some((kw) => lc(use).includes(kw)),
  );

  if (blocked.length > 0) return { status: 'blocked', matched, blocked };
  if (matched.length > 0) return { status: 'aligned', matched, blocked };
  return { status: 'unclear', matched, blocked };
}

// Main engine entry.
// property is a partial object with at least:
//   land_area_sqft, road_width_mtrs, permissible_fsi (manual override)
// zone may be null — the engine still returns what it can from property fields.
export function computeBuildability({ zone, property, assetClass }) {
  const landSqft  = toNum(property?.land_area_sqft);
  const landSqm   = landSqft != null ? landSqft / SQFT_PER_SQM : null;
  const landAcres = landSqft != null ? landSqft / 43560 : null;
  const roadWidthM = toNum(property?.road_width_mtrs ?? property?.road_width_m);
  const manualFsi = toNum(property?.permissible_fsi);

  const zoneFsi = zone ? calculateEffectiveFSI(zone, roadWidthM) : null;
  const effectiveFsi = zoneFsi ?? manualFsi;
  const tier = zone ? matchedTier(zone, roadWidthM) : null;

  const zoneCoveragePct = toNum(zone?.ground_coverage_pct);
  const groundCovPct = zoneCoveragePct ?? 40;
  const coverageSource = zoneCoveragePct != null ? 'zone' : 'default';

  const maxHeightM = toNum(zone?.building_height_max_m);

  const setbacks = {
    front_m: toNum(zone?.setback_rules?.front_m),
    rear_m:  toNum(zone?.setback_rules?.rear_m),
    side_m:  toNum(zone?.setback_rules?.side_m),
  };
  const hasSetbacks = setbacks.front_m != null || setbacks.rear_m != null || setbacks.side_m != null;

  const maxBuiltUpSqft = landSqft != null && effectiveFsi != null ? landSqft * effectiveFsi : null;
  const maxBuiltUpSqm  = landSqm  != null && effectiveFsi != null ? landSqm  * effectiveFsi : null;

  const maxGroundCovSqft = landSqft != null ? landSqft * (groundCovPct / 100) : null;
  const maxGroundCovSqm  = landSqm  != null ? landSqm  * (groundCovPct / 100) : null;

  const setbackResult = (landSqft != null && hasSetbacks)
    ? netPlotAfterSetbacks({
        landSqft,
        frontM: setbacks.front_m,
        rearM: setbacks.rear_m,
        sideM: setbacks.side_m,
      })
    : null;

  const maxFloorsByCoverage = (maxBuiltUpSqft && maxGroundCovSqft && maxGroundCovSqft > 0)
    ? maxBuiltUpSqft / maxGroundCovSqft
    : null;
  const maxFloorsByHeight = maxHeightM ? maxHeightM / FLOOR_HEIGHT_M : null;
  const maxFloors = (maxFloorsByCoverage != null && maxFloorsByHeight != null)
    ? Math.min(maxFloorsByCoverage, maxFloorsByHeight)
    : (maxFloorsByCoverage ?? maxFloorsByHeight);
  const limitingFactor =
    maxFloorsByCoverage != null && maxFloorsByHeight != null
      ? (maxFloorsByHeight < maxFloorsByCoverage ? 'height' : 'coverage')
      : (maxFloorsByHeight != null ? 'height' : (maxFloorsByCoverage != null ? 'coverage' : null));

  const alignment = assetClassAlignment(
    assetClass,
    zone?.permissible_uses,
    zone?.prohibited_uses,
  );

  const flags = [];
  if (zone?.road_width_min_m && roadWidthM != null && roadWidthM < Number(zone.road_width_min_m)) {
    flags.push({
      level: 'warning',
      title: 'Road width below zone minimum',
      detail: `Parcel road ${roadWidthM} m is under the zone's required ${zone.road_width_min_m} m minimum.`,
    });
  }
  if (manualFsi != null && zoneFsi != null && Math.abs(manualFsi - zoneFsi) > 0.01) {
    flags.push({
      level: 'info',
      title: 'Manual FSI override in use',
      detail: `Parcel FSI ${manualFsi} differs from master plan ${zoneFsi} for this road width.`,
    });
  }
  if (alignment.status === 'blocked') {
    flags.push({
      level: 'warning',
      title: 'Asset class conflicts with zone',
      detail: `Deal asset class is in the zone's prohibited uses: ${alignment.blocked.join(', ')}.`,
    });
  } else if (alignment.status === 'unclear' && zone?.permissible_uses?.length) {
    flags.push({
      level: 'info',
      title: 'Asset class alignment unclear',
      detail: 'This asset class does not obviously match the zone\u2019s permissible uses. Verify with zoning authority.',
    });
  }

  const missing = [];
  if (landSqft == null) missing.push('Land area');
  if (roadWidthM == null) missing.push('Road width');
  if (!zone && effectiveFsi == null) missing.push('Zone or manual FSI');

  return {
    // inputs (echoed for display)
    land_sqft: landSqft,
    land_sqm: landSqm,
    land_acres: landAcres,
    road_width_m: roadWidthM,
    asset_class: assetClass ?? null,

    // FSI
    effective_fsi: effectiveFsi,
    zone_effective_fsi: zoneFsi,
    manual_fsi: manualFsi,
    fsi_source: zoneFsi != null ? 'zone' : (manualFsi != null ? 'manual' : 'none'),
    matched_tier: tier,
    tier_count: Array.isArray(zone?.fsi_road_width_rules) ? zone.fsi_road_width_rules.length : 0,

    // Built-up
    max_built_up_sqft: maxBuiltUpSqft,
    max_built_up_sqm:  maxBuiltUpSqm,

    // Coverage
    ground_coverage_pct: groundCovPct,
    ground_coverage_source: coverageSource,
    max_ground_coverage_sqft: maxGroundCovSqft,
    max_ground_coverage_sqm:  maxGroundCovSqm,

    // Setbacks
    setbacks,
    has_setbacks: hasSetbacks,
    net_plot: setbackResult,

    // Floors & height
    max_height_m: maxHeightM,
    max_floors: maxFloors,
    max_floors_by_coverage: maxFloorsByCoverage,
    max_floors_by_height: maxFloorsByHeight,
    limiting_factor: limitingFactor,

    // Asset class alignment
    alignment,

    // Quality signals
    flags,
    missing_inputs: missing,
    has_zone: !!zone,
    has_property_data: landSqft != null,

    // Zone echo for convenience
    zone: zone
      ? {
          id: zone.id,
          code: zone.zone_code,
          name: zone.zone_name,
          plan_version: zone.plan_version,
          source_page: zone.source_page,
          source_section: zone.source_section,
        }
      : null,
  };
}

// UI helper: IN-style number formatter with safe fallbacks.
export function fmtNum(n, decimals = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: decimals });
}

// Convert sqft → acres label
export function fmtAreaCompact(sqft, decimals = 2) {
  if (sqft == null || !Number.isFinite(Number(sqft))) return '—';
  const acres = sqft / 43560;
  if (acres >= 1) return `${fmtNum(acres, decimals)} ac`;
  return `${fmtNum(sqft, 0)} sqft`;
}
