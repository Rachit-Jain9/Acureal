// Deterministic buildability engine.
// Given a master plan zone + property parcel fields, computes the regulated
// envelope used across the deal workspace:
//   - effective FSI (with base + premium/additional FAR breakdown),
//   - max built-up area,
//   - ground-coverage cap,
//   - net plot after setbacks,
//   - max floors (height-capped, whole number),
//   - typical footprint at full FSI,
//   - unit count (whole number) per asset class,
//   - parking counts per asset class,
//   - asset-class permissibility vs. zone uses.
//
// Rules are deterministic — never delegate this to an LLM.
// Mirrors backend/src/services/masterplan.service.js calculateEffectiveFSI()
// and the Postgres rules engine at regulatory_data.effective_fsi().

const SQFT_PER_SQM = 10.76391041671;
const SQFT_PER_ACRE = 43560;
const FLOOR_HEIGHT_M_DEFAULT = 3.0; // typical floor-to-floor for residential
const EV_BAY_PCT = 0.05;            // Section 9.6: at least 5% EV charging
const VISITOR_PARK_PCT = 0.10;      // Section 9.6: 10% visitor for residential

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Round DOWN to whole number — floors, units, parking bays are integers.
function floorInt(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.floor(Number(n));
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

// Split the tier's effective FSI into base (granted) and premium (paid/additional).
// RMP 2031 Draft structure, e.g. Residential Zone A road ≥30.5m → base 1.80 + 0.90 premium = 2.70.
// We treat zone.permissible_fsi_base as the "free" component; anything above that
// at a given tier is Premium (additional) FAR purchased from BDA / via TDR.
function splitBaseAndPremium(zone, tierFsi) {
  const zoneBase = toNum(zone?.permissible_fsi_base);
  const t = toNum(tierFsi);
  if (t == null) return { base: null, premium: null };
  if (zoneBase == null) return { base: t, premium: 0 };
  const base = Math.min(zoneBase, t);
  const premium = Math.max(0, t - base);
  return { base, premium };
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

// Soft keyword match between asset class and zone permissible / prohibited uses.
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

// Unit-mix defaults per asset class. Sizes are typical BUA-per-unit assumptions
// for Bengaluru market, derived from the Master Plan + common developer practice.
// All callers may override via property/deal inputs. Always floor()'d to a whole
// number — you cannot build half an apartment.
const UNIT_MIX_DEFAULTS = {
  residential_apartments: { basis: 'apartments', label: 'Apartments', unit_size_sqft: 900,  note: 'Typical 2-BHK mix (900 sqft BUA/DU)' },
  residential_villas:     { basis: 'villas',     label: 'Villas',     unit_size_sqft: 2500, note: 'Typical villa (2,500 sqft BUA/unit)' },
  plotted_development:    { basis: 'plots',      label: 'Plots',      unit_size_sqft: 1800, note: 'Typical 30×60 plot (1,800 sqft/plot)' },
  commercial_office:      { basis: 'workstations', label: 'Workstations', unit_size_sqft: 80, note: '1 seat / 80 sqft leasable' },
  commercial_retail:      { basis: 'units',      label: 'Retail units', unit_size_sqft: 1000, note: 'Avg 1,000 sqft/shop' },
  mixed_use:              { basis: 'apartments', label: 'Apartments (residential share)', unit_size_sqft: 900, note: 'Residential share at 900 sqft/DU' },
  industrial:             { basis: 'bays',       label: 'Industrial bays', unit_size_sqft: 5000, note: 'Avg 5,000 sqft/bay' },
  hospitality:            { basis: 'keys',       label: 'Hotel keys', unit_size_sqft: 500, note: '500 sqft BUA/key (incl. common area share)' },
  warehousing:            { basis: 'bays',       label: 'Warehouse bays', unit_size_sqft: 10000, note: 'Avg 10,000 sqft/bay' },
  data_center:            { basis: 'mw',         label: 'IT capacity', unit_size_sqft: 20000, note: 'Indicative; real IT load depends on power' },
  senior_living:          { basis: 'units',      label: 'Care units', unit_size_sqft: 650, note: '650 sqft/unit (incl. common care area)' },
  student_housing:        { basis: 'beds',       label: 'Beds',       unit_size_sqft: 250, note: '250 sqft/bed (shared rooms + common)' },
  healthcare:             { basis: 'beds',       label: 'Hospital beds', unit_size_sqft: 500, note: '500 sqft BUA/bed (hospital mix)' },
  education:              { basis: 'seats',      label: 'Student seats', unit_size_sqft: 60, note: '60 sqft/seat (classroom + common)' },
};

export function unitMixDefault(assetClass) {
  return UNIT_MIX_DEFAULTS[assetClass] || null;
}

// Parking rules per asset class, mapped from Master Plan Section 9.6.
// Returns total cars + EV bays + (for residential) visitor parking.
// Uses sqm→sqft conversion inline for readability.
function computeParking({ assetClass, maxBuiltUpSqft, unitCount }) {
  if (maxBuiltUpSqft == null) return null;
  const sqftPer50Sqm  = 50 * SQFT_PER_SQM;   // ~538.2 sqft
  const sqftPer100Sqm = 100 * SQFT_PER_SQM;  // ~1076.4 sqft

  let cars = null;
  let visitor = 0;
  let basis = null;

  switch (assetClass) {
    case 'residential_apartments':
    case 'mixed_use':
    case 'senior_living':
    case 'student_housing': {
      cars = unitCount != null ? unitCount : Math.floor(maxBuiltUpSqft / sqftPer100Sqm);
      visitor = Math.floor((cars || 0) * VISITOR_PARK_PCT);
      basis = '1 car / dwelling unit + 10% visitor (MP §9.6)';
      break;
    }
    case 'residential_villas':
    case 'plotted_development': {
      cars = unitCount != null ? unitCount : Math.floor(maxBuiltUpSqft / sqftPer100Sqm);
      basis = '1 car / plot or villa (MP §9.6)';
      break;
    }
    case 'commercial_office':
    case 'commercial_retail':
    case 'hospitality': {
      cars = Math.floor(maxBuiltUpSqft / sqftPer50Sqm);
      basis = '1 car / 50 sqm BUA (MP §9.6)';
      break;
    }
    case 'industrial':
    case 'warehousing':
    case 'data_center': {
      cars = Math.floor(maxBuiltUpSqft / sqftPer100Sqm);
      basis = '1 car / 100 sqm BUA + lorry spaces (MP §9.6)';
      break;
    }
    case 'healthcare':
    case 'education': {
      cars = Math.floor(maxBuiltUpSqft / sqftPer50Sqm);
      basis = '1 car / 50 sqm BUA (institutional)';
      break;
    }
    default: {
      cars = Math.floor(maxBuiltUpSqft / sqftPer100Sqm);
      basis = 'Default 1 car / 100 sqm BUA';
    }
  }

  const evBays = Math.ceil((cars || 0) * EV_BAY_PCT); // ≥5% — round UP (MP requires minimum)
  return {
    cars,
    visitor_cars: visitor,
    ev_bays: evBays,
    basis,
  };
}

// Main engine entry.
// property is a partial object with at least:
//   land_area_sqft, road_width_mtrs, permissible_fsi (manual override), floor_height_m
//   unit_size_sqft_override (optional), use_premium_far (optional, default true)
// zone may be null — the engine still returns what it can from property fields.
export function computeBuildability({ zone, property, assetClass, options = {} }) {
  const landSqft  = toNum(property?.land_area_sqft);
  const landSqm   = landSqft != null ? landSqft / SQFT_PER_SQM : null;
  const landAcres = landSqft != null ? landSqft / SQFT_PER_ACRE : null;
  const roadWidthM = toNum(property?.road_width_mtrs ?? property?.road_width_m);
  const manualFsi = toNum(property?.permissible_fsi);
  const usePremium = options.usePremiumFar !== false; // default TRUE — show max envelope
  const floorHeightM = toNum(options.floorHeightM ?? property?.floor_height_m) ?? FLOOR_HEIGHT_M_DEFAULT;

  // --- FSI: tier → base + premium split
  const tierFsi = zone ? calculateEffectiveFSI(zone, roadWidthM) : null;
  const { base: baseFsi, premium: premiumFsi } = zone ? splitBaseAndPremium(zone, tierFsi) : { base: null, premium: null };
  const zoneFsi = tierFsi;
  const effectiveFsiFromZone = zoneFsi != null
    ? (usePremium ? zoneFsi : (baseFsi != null ? baseFsi : zoneFsi))
    : null;
  const effectiveFsi = effectiveFsiFromZone ?? manualFsi;
  const fsiSource = effectiveFsiFromZone != null ? 'zone' : (manualFsi != null ? 'manual' : 'none');
  const tier = zone ? matchedTier(zone, roadWidthM) : null;
  const zoneMaxFsi = toNum(zone?.permissible_fsi_max);

  // --- Ground coverage (zone value, else prudent default 40% per MP >4000 sqm Zone A)
  const zoneCoveragePct = toNum(zone?.ground_coverage_pct);
  const groundCovPct = zoneCoveragePct ?? 40;
  const coverageSource = zoneCoveragePct != null ? 'zone' : 'default';

  // --- Height cap from zone
  const maxHeightM = toNum(zone?.building_height_max_m);

  // --- Setbacks
  const setbacks = {
    front_m: toNum(zone?.setback_rules?.front_m),
    rear_m:  toNum(zone?.setback_rules?.rear_m),
    side_m:  toNum(zone?.setback_rules?.side_m),
  };
  const hasSetbacks = setbacks.front_m != null || setbacks.rear_m != null || setbacks.side_m != null;

  // --- Built-up (full envelope + base-only comparison)
  const maxBuiltUpSqft = landSqft != null && effectiveFsi != null ? landSqft * effectiveFsi : null;
  const maxBuiltUpSqm  = landSqm  != null && effectiveFsi != null ? landSqm  * effectiveFsi : null;
  const baseBuiltUpSqft = landSqft != null && baseFsi != null ? landSqft * baseFsi : null;
  const premiumBuiltUpSqft = premiumFsi != null && landSqft != null && usePremium
    ? landSqft * premiumFsi
    : 0;

  // --- Coverage absolute
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

  // --- Floors: height is the HARD CEILING. Coverage only matters if the
  // height-capped floors cannot absorb the FSI at the given coverage.
  const maxFloorsByHeightRaw = maxHeightM != null ? maxHeightM / floorHeightM : null;
  const maxFloorsByHeight = maxFloorsByHeightRaw != null ? floorInt(maxFloorsByHeightRaw) : null;

  // Min floors required to fit full BUA if footprint = full ground coverage.
  // If this > maxFloorsByHeight, then FSI isn't achievable under both caps.
  const minFloorsForFsi = (maxBuiltUpSqft != null && maxGroundCovSqft && maxGroundCovSqft > 0)
    ? Math.ceil(maxBuiltUpSqft / maxGroundCovSqft)
    : null;

  let maxFloors = null;
  let limitingFactor = null;
  let typicalFootprintSqft = null;
  let fsiAchievable = true;

  if (maxFloorsByHeight != null && maxBuiltUpSqft != null) {
    if (minFloorsForFsi != null && minFloorsForFsi > maxFloorsByHeight) {
      // Cannot achieve full FSI under height cap — coverage is too tight for
      // the available floors. Floors stay at the height cap, realized BUA drops.
      maxFloors = maxFloorsByHeight;
      limitingFactor = 'height + coverage';
      typicalFootprintSqft = maxGroundCovSqft;
      fsiAchievable = false;
    } else {
      maxFloors = maxFloorsByHeight;
      limitingFactor = 'height';
      typicalFootprintSqft = maxBuiltUpSqft / maxFloorsByHeight;
    }
  } else if (maxFloorsByHeight != null) {
    maxFloors = maxFloorsByHeight;
    limitingFactor = 'height';
  } else if (minFloorsForFsi != null && maxBuiltUpSqft != null) {
    // No height cap on zone — fall back to minimum needed to fit FSI at max coverage.
    maxFloors = minFloorsForFsi;
    limitingFactor = 'coverage';
    typicalFootprintSqft = maxGroundCovSqft;
  }

  // Realized (achievable) BUA honoring both caps.
  const realizedBuiltUpSqft = (maxFloors != null && typicalFootprintSqft != null)
    ? Math.min(maxBuiltUpSqft ?? Infinity, maxFloors * typicalFootprintSqft)
    : maxBuiltUpSqft;

  // --- Unit count per asset class (whole number, floor()'d)
  const mixDefault = unitMixDefault(assetClass);
  const unitSizeOverride = toNum(property?.unit_size_sqft_override);
  const unitSizeSqft = unitSizeOverride ?? mixDefault?.unit_size_sqft ?? null;
  const unitCount = (realizedBuiltUpSqft != null && unitSizeSqft != null && unitSizeSqft > 0)
    ? floorInt(realizedBuiltUpSqft / unitSizeSqft)
    : null;

  // --- Parking estimate
  const parking = computeParking({
    assetClass,
    maxBuiltUpSqft: realizedBuiltUpSqft,
    unitCount,
  });

  // --- Asset-class alignment vs. zone uses
  const alignment = assetClassAlignment(
    assetClass,
    zone?.permissible_uses,
    zone?.prohibited_uses,
  );

  // --- Flags
  const flags = [];
  if (zone?.road_width_min_m && roadWidthM != null && roadWidthM < Number(zone.road_width_min_m)) {
    flags.push({
      level: 'warning',
      title: 'Road width below zone minimum',
      detail: `Parcel road ${roadWidthM} m is under the zone\u2019s required ${zone.road_width_min_m} m minimum.`,
    });
  }
  if (roadWidthM != null && roadWidthM < 6) {
    flags.push({
      level: 'warning',
      title: 'Road <6 m — construction restricted',
      detail: 'MP §4.4: no construction unless widening to 6 m is surrendered free of cost. FAR applies only on the balance land.',
    });
  }
  if (roadWidthM != null && roadWidthM < 9.5 && maxHeightM != null) {
    flags.push({
      level: 'info',
      title: 'Height capped at Stilt+2 / GF+1',
      detail: 'MP §5.6: roads <9.5 m restrict residential height to 9.5 m (Stilt+2 / GF+1).',
    });
  }
  if (manualFsi != null && zoneFsi != null && Math.abs(manualFsi - zoneFsi) > 0.01) {
    flags.push({
      level: 'info',
      title: 'Manual FSI override in use',
      detail: `Parcel FSI ${manualFsi} differs from master plan ${zoneFsi} for this road width.`,
    });
  }
  if (premiumFsi != null && premiumFsi > 0 && usePremium) {
    flags.push({
      level: 'info',
      title: 'Premium FAR included',
      detail: `Envelope uses ${Number(premiumFsi).toFixed(2)} of additional (paid) FAR on top of the ${Number(baseFsi).toFixed(2)} base. Premium FAR requires BDA fee payment or TDR.`,
    });
  }
  if (!fsiAchievable) {
    flags.push({
      level: 'warning',
      title: 'Full FSI not achievable under height + coverage',
      detail: 'Given the zone\u2019s ground-coverage and height caps, full FSI cannot be realized. Realized built-up is lower than the FSI ceiling.',
    });
  }
  if (alignment.status === 'blocked') {
    flags.push({
      level: 'warning',
      title: 'Asset class conflicts with zone',
      detail: `Deal asset class is in the zone\u2019s prohibited uses: ${alignment.blocked.join(', ')}.`,
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

    // FSI — base + premium breakdown
    effective_fsi: effectiveFsi,
    zone_effective_fsi: zoneFsi,
    base_fsi: baseFsi,
    premium_fsi_available: premiumFsi,
    premium_fsi_used: usePremium ? premiumFsi : 0,
    use_premium_far: usePremium,
    zone_max_fsi: zoneMaxFsi,
    manual_fsi: manualFsi,
    fsi_source: fsiSource,
    matched_tier: tier,
    tier_count: Array.isArray(zone?.fsi_road_width_rules) ? zone.fsi_road_width_rules.length : 0,

    // Built-up
    max_built_up_sqft: maxBuiltUpSqft,
    max_built_up_sqm:  maxBuiltUpSqm,
    base_built_up_sqft: baseBuiltUpSqft,
    premium_built_up_sqft: premiumBuiltUpSqft,
    realized_built_up_sqft: realizedBuiltUpSqft,
    fsi_achievable: fsiAchievable,

    // Coverage
    ground_coverage_pct: groundCovPct,
    ground_coverage_source: coverageSource,
    max_ground_coverage_sqft: maxGroundCovSqft,
    max_ground_coverage_sqm:  maxGroundCovSqm,

    // Setbacks
    setbacks,
    has_setbacks: hasSetbacks,
    net_plot: setbackResult,

    // Floors & height (whole numbers where appropriate)
    max_height_m: maxHeightM,
    floor_height_m: floorHeightM,
    max_floors: maxFloors,                       // whole number
    max_floors_by_height: maxFloorsByHeight,     // whole number
    max_floors_by_height_raw: maxFloorsByHeightRaw,
    min_floors_for_fsi: minFloorsForFsi,         // whole number
    limiting_factor: limitingFactor,
    typical_footprint_sqft: typicalFootprintSqft,

    // Unit mix (whole number)
    unit_basis: mixDefault?.basis ?? null,
    unit_label: mixDefault?.label ?? null,
    unit_size_sqft: unitSizeSqft,
    unit_note: mixDefault?.note ?? null,
    unit_count: unitCount,

    // Parking (whole numbers)
    parking,

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
  if (n == null || !Number.isFinite(Number(n))) return '\u2014';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: decimals });
}

// Convert sqft → acres label
export function fmtAreaCompact(sqft, decimals = 2) {
  if (sqft == null || !Number.isFinite(Number(sqft))) return '\u2014';
  const acres = sqft / SQFT_PER_ACRE;
  if (acres >= 1) return `${fmtNum(acres, decimals)} ac`;
  return `${fmtNum(sqft, 0)} sqft`;
}
