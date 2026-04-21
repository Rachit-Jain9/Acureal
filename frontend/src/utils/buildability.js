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

import { SQFT_PER_ACRE } from '../config/india';

const SQFT_PER_SQM = 10.76391041671;
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

// INR compact formatter — ₹1.23 Cr, ₹45.6 L, ₹12,345
export function fmtInr(n) {
  if (n == null || !Number.isFinite(Number(n))) return '\u2014';
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1e7) return `\u20b9${(v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (abs >= 1e5) return `\u20b9${(v / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `\u20b9${Math.round(v).toLocaleString('en-IN')}`;
}

// ---------------------------------------------------------------------------
// ASSET-CLASS PROFILES
// ---------------------------------------------------------------------------
// Per-class ratios, cost benchmarks, and market defaults for Bengaluru 2026.
// These are deliberately explicit so the programme output is transparent.
// Users can override via property/deal fields; these are never secrets.
// Sources: RERA Karnataka (carpet ratios), BBMP building bye-laws (parking,
// lifts), CBRE/Knight Frank 2025 Bengaluru reports (market rents, cap rates,
// construction costs), Karnataka Town & Country Planning Act + RMP 2031 Draft.
const ASSET_CLASS_PROFILES = {
  residential_apartments: {
    label: 'Residential apartments',
    group: 'residential',
    efficiency_carpet: 0.72,          // RERA carpet / super built-up ratio
    super_built_up_factor: 1.00,      // treating realized BUA as saleable / SBUA
    floor_plate_sqft: 12000,          // typical tower floor plate
    amenity_land_pct: 0.10,           // 10% of land for amenities
    build_cost_per_sqft: 4200,        // ₹/sqft BUA (2026 mid-segment)
    market_rate_per_sqft_sbua: 8500,  // ₹/sqft super built-up mid-segment
    lifts_per_units: 50,              // 1 lift per 50 DUs
    parking_per_unit: 1.0,
    visitor_parking_pct: 0.10,
    unit_mix: [
      { type: '1BHK',         share: 0.15, carpet_sqft: 600  },
      { type: '2BHK',         share: 0.55, carpet_sqft: 1050 },
      { type: '3BHK',         share: 0.25, carpet_sqft: 1500 },
      { type: 'Luxury 3/4BHK',share: 0.05, carpet_sqft: 2200 },
    ],
  },
  residential_villas: {
    label: 'Residential villas',
    group: 'residential',
    efficiency_carpet: 0.85,
    super_built_up_factor: 1.00,
    typical_plot_sqft: 2400,          // 40x60 Bengaluru norm
    villa_bua_per_plot_sqft: 2800,
    net_developable_pct: 0.60,        // 60% of land after roads/amenity
    build_cost_per_sqft: 3800,
    market_rate_per_sqft_sbua: 9500,
    parking_per_unit: 2.0,
  },
  plotted_development: {
    label: 'Plotted development',
    group: 'plotted',
    typical_plot_sqft: 1800,          // 30x60
    net_developable_pct: 0.55,        // 55% after roads, civic amenity sites
    build_cost_per_sqft_infra: 450,   // infra cost (roads, drainage) per sqft LAND
    market_rate_per_sqft_plot: 4500,
  },
  commercial_office: {
    label: 'Commercial office',
    group: 'commercial',
    efficiency_leasable: 0.85,        // leasable / BUA — IPMS Core
    floor_plate_sqft: 25000,          // Grade A benchmark
    workstation_sqft: 80,
    build_cost_per_sqft: 6500,
    market_rent_per_sqft_month: 95,   // ₹/sqft/month Grade A Bengaluru
    cap_rate: 0.075,
    parking_per_1000_sqft_leasable: 1.2,
    lifts_per_sqft: 40000,
  },
  commercial_retail: {
    label: 'Retail',
    group: 'commercial',
    efficiency_gla: 0.80,             // GLA / BUA (malls)
    anchor_share: 0.40,
    line_share: 0.60,
    frontage_critical: true,
    floor_plate_sqft: 30000,
    build_cost_per_sqft: 5800,
    market_rent_per_sqft_month: 140,
    cap_rate: 0.08,
  },
  mixed_use: {
    label: 'Mixed-use',
    group: 'mixed',
    residential_share: 0.60,
    commercial_share: 0.40,
    notes: 'Split modelled as residential + office components per share',
  },
  industrial: {
    label: 'Industrial',
    group: 'industrial',
    typical_coverage_pct: 0.45,       // 45% coverage typical
    utility_land_pct: 0.10,
    build_cost_per_sqft: 2100,
    market_rent_per_sqft_month: 28,
    clear_height_m_min: 7.5,
  },
  warehousing: {
    label: 'Warehousing / Logistics',
    group: 'industrial',
    efficiency_clear_usable: 0.92,
    clear_height_m_min: 10.0,         // Grade A Bengaluru
    dock_per_sqft: 10000,             // 1 dock per 10k sqft usable
    truck_court_depth_m: 35,
    build_cost_per_sqft: 2400,
    market_rent_per_sqft_month: 26,
    cap_rate: 0.085,
  },
  hospitality: {
    label: 'Hospitality',
    group: 'hospitality',
    key_bua_sqft: 500,                // includes common area share
    fnb_share: 0.12,                  // 12% of BUA
    boh_share: 0.20,                  // 20% back-of-house
    ballroom_mice_share: 0.05,
    build_cost_per_sqft: 8500,        // mid-scale full-service
    adr_inr: 8000,                    // average daily rate mid-scale BLR
    occupancy: 0.65,
  },
  data_center: {
    label: 'Data centre',
    group: 'specialised',
    it_load_w_per_sqft: 180,
    pue: 1.5,
    mep_share: 0.40,
    build_cost_per_sqft: 12000,
    it_load_per_mw_sqft: 8000,        // ~8k IT sqft per MW
  },
  senior_living: {
    label: 'Senior living',
    group: 'residential',
    unit_bua_sqft: 650,
    care_area_share: 0.18,
    build_cost_per_sqft: 5200,
    market_rate_per_sqft_sbua: 7800,
  },
  student_housing: {
    label: 'Student housing',
    group: 'residential',
    bed_bua_sqft: 250,
    common_share: 0.25,
    build_cost_per_sqft: 3200,
    monthly_rent_per_bed: 16000,
  },
  healthcare: {
    label: 'Healthcare',
    group: 'institutional',
    bed_bua_sqft: 500,
    ot_icu_share: 0.20,
    diagnostics_share: 0.15,
    build_cost_per_sqft: 9500,
  },
  education: {
    label: 'Education',
    group: 'institutional',
    seat_sqft: 60,
    lab_uplift: 0.20,
    open_space_min_pct: 0.40,
    build_cost_per_sqft: 3800,
  },
};

export function assetClassProfile(assetClass) {
  return ASSET_CLASS_PROFILES[assetClass] || null;
}

// ---------------------------------------------------------------------------
// PREMIUM FAR COST ESTIMATE
// ---------------------------------------------------------------------------
// Karnataka Premium FAR rules (Bengaluru): additional FAR over the base is
// purchased from the planning authority. The fee is a percentage of the
// prevailing Sub-Registrar guidance value applied to the PREMIUM built-up
// component. Different road-width tiers attract different rates; we use a
// blended 40% as a planning-grade default.
//
// Inputs: circle_rate_per_sqft (₹/sqft guidance value proxy from property),
//         premium_bua_sqft (sqft added by premium FAR).
// Returns: { fee_inr, fee_per_sqft_inr, rate_pct, note }
export function estimatePremiumFarCost({ property, premium_bua_sqft }) {
  const guidanceSqft = toNum(property?.circle_rate_per_sqft);
  const bua = toNum(premium_bua_sqft);
  if (bua == null || bua <= 0) {
    return { fee_inr: 0, fee_per_sqft_inr: 0, rate_pct: 0, note: 'No premium FAR used' };
  }
  const ratePct = 0.40; // blended 40% of guidance; varies by tier under RMP 2031
  if (guidanceSqft == null) {
    return {
      fee_inr: null,
      fee_per_sqft_inr: null,
      rate_pct: ratePct,
      note: 'Set circle rate on the parcel to estimate BDA premium fee',
    };
  }
  const feePerSqft = ratePct * guidanceSqft;
  return {
    fee_inr: feePerSqft * bua,
    fee_per_sqft_inr: feePerSqft,
    rate_pct: ratePct,
    note: `${Math.round(ratePct * 100)}% of guidance \u20b9${fmtNum(guidanceSqft, 0)}/sqft × ${fmtNum(bua, 0)} sqft premium BUA`,
  };
}

// ---------------------------------------------------------------------------
// PROGRAMME ENGINE
// ---------------------------------------------------------------------------
// Turns a buildability envelope into an asset-class-specific programme:
// efficiency-adjusted rentable / saleable area, unit mix, cost & revenue
// envelope. Returns a structure the UI can render per asset class, and that
// the Financial tab can read to pre-populate underwriting inputs.
export function computeProgramme({ buildability, property, options = {} }) {
  if (!buildability) return null;
  const assetClass = buildability.asset_class;
  const profile = assetClassProfile(assetClass);
  const realizedBua = toNum(buildability.realized_built_up_sqft);
  const landSqft = toNum(buildability.land_sqft);
  const floors = buildability.max_floors;

  if (!profile || realizedBua == null) {
    return {
      asset_class: assetClass,
      profile: profile ?? null,
      has_programme: false,
      note: !profile
        ? `No programme profile registered for asset class \"${assetClass}\"`
        : 'Need realized built-up area to compute programme',
    };
  }

  const out = {
    asset_class: assetClass,
    profile_label: profile.label,
    group: profile.group,
    realized_bua_sqft: realizedBua,
    has_programme: true,
    // populated below
    saleable_sqft: null,
    leasable_sqft: null,
    carpet_sqft: null,
    unit_mix: null,
    floor_plate_sqft: null,
    tower_count: null,
    lifts: null,
    workstations: null,
    keys: null,
    docks: null,
    clear_height_m: null,
    fnb_sqft: null,
    boh_sqft: null,
    it_load_mw: null,
    plot_yield: null,
    build_cost_inr: null,
    build_cost_per_sqft: profile.build_cost_per_sqft ?? profile.build_cost_per_sqft_infra ?? null,
    gross_revenue_inr: null,
    cap_rate: profile.cap_rate ?? null,
    stabilised_value_inr: null,
    metrics: [],          // [{label, value, unit, hint}] — UI-rendered highlights
    assumptions: [],      // [{label, value}] — transparency row
  };

  const pushMetric = (m) => out.metrics.push(m);
  const pushAssumption = (a) => out.assumptions.push(a);

  switch (assetClass) {
    case 'residential_apartments':
    case 'mixed_use': {
      const resShare = assetClass === 'mixed_use' ? (profile.residential_share ?? 0.6) : 1;
      const residentialBua = realizedBua * resShare;
      const saleable = residentialBua * (profile.super_built_up_factor ?? 1);
      const carpet   = residentialBua * (ASSET_CLASS_PROFILES.residential_apartments.efficiency_carpet);
      const floorPlate = Math.min(
        ASSET_CLASS_PROFILES.residential_apartments.floor_plate_sqft,
        buildability.typical_footprint_sqft ?? Infinity,
      );
      const towers = (floors && floorPlate)
        ? Math.max(1, Math.ceil(residentialBua / (floors * floorPlate)))
        : null;

      // Unit mix
      const mix = ASSET_CLASS_PROFILES.residential_apartments.unit_mix.map((m) => {
        const carpetAlloc = carpet * m.share;
        const count = floorInt(carpetAlloc / m.carpet_sqft);
        return { ...m, count, carpet_total_sqft: count * m.carpet_sqft };
      });
      const totalUnits = mix.reduce((s, m) => s + (m.count || 0), 0);
      const lifts = Math.max(1, Math.ceil(totalUnits / ASSET_CLASS_PROFILES.residential_apartments.lifts_per_units));

      out.saleable_sqft = saleable;
      out.carpet_sqft = carpet;
      out.unit_mix = mix;
      out.unit_count = totalUnits;
      out.floor_plate_sqft = floorPlate;
      out.tower_count = towers;
      out.lifts = lifts;

      const costRate = ASSET_CLASS_PROFILES.residential_apartments.build_cost_per_sqft;
      const mktRate = ASSET_CLASS_PROFILES.residential_apartments.market_rate_per_sqft_sbua;
      out.build_cost_per_sqft = costRate;
      out.build_cost_inr = residentialBua * costRate;
      out.gross_revenue_inr = saleable * mktRate;

      pushMetric({ label: 'Saleable (SBUA)',  value: fmtNum(saleable), unit: 'sqft', hint: `${fmtNum(resShare * 100, 0)}% residential share` });
      pushMetric({ label: 'Carpet (RERA)',    value: fmtNum(carpet),   unit: 'sqft', hint: '72% efficiency' });
      pushMetric({ label: 'Total units',      value: fmtNum(totalUnits, 0), unit: 'DUs', hint: `${towers ?? '\u2014'} tower${towers === 1 ? '' : 's'}` });
      pushMetric({ label: 'Lifts required',   value: fmtNum(lifts, 0), unit: 'cars', hint: '1 per 50 DU' });

      pushAssumption({ label: 'Super built-up → carpet', value: '72%' });
      pushAssumption({ label: 'Floor plate', value: `${fmtNum(floorPlate)} sqft` });
      pushAssumption({ label: 'Build cost',  value: `\u20b9${fmtNum(costRate)}/sqft BUA` });
      pushAssumption({ label: 'Market rate', value: `\u20b9${fmtNum(mktRate)}/sqft SBUA (mid-segment)` });
      break;
    }

    case 'residential_villas': {
      const netDevSqft = landSqft != null ? landSqft * profile.net_developable_pct : null;
      const villaCount = netDevSqft != null ? floorInt(netDevSqft / profile.typical_plot_sqft) : null;
      const villaBua = villaCount != null ? villaCount * profile.villa_bua_per_plot_sqft : null;
      const carpet = villaBua != null ? villaBua * profile.efficiency_carpet : null;

      out.unit_count = villaCount;
      out.saleable_sqft = villaBua;
      out.carpet_sqft = carpet;
      out.build_cost_inr = villaBua != null ? villaBua * profile.build_cost_per_sqft : null;
      out.gross_revenue_inr = villaBua != null ? villaBua * profile.market_rate_per_sqft_sbua : null;

      pushMetric({ label: 'Villas', value: fmtNum(villaCount, 0), unit: 'plots' });
      pushMetric({ label: 'BUA/villa', value: fmtNum(profile.villa_bua_per_plot_sqft), unit: 'sqft' });
      pushMetric({ label: 'Saleable',   value: fmtNum(villaBua), unit: 'sqft' });
      pushMetric({ label: 'Net devl.',  value: fmtNum(netDevSqft), unit: 'sqft', hint: `${fmtNum(profile.net_developable_pct * 100, 0)}% of land` });

      pushAssumption({ label: 'Typical plot', value: `${fmtNum(profile.typical_plot_sqft)} sqft (40×60)` });
      pushAssumption({ label: 'Net developable', value: `${fmtNum(profile.net_developable_pct * 100, 0)}% after roads/amenity` });
      pushAssumption({ label: 'Build cost',  value: `\u20b9${fmtNum(profile.build_cost_per_sqft)}/sqft BUA` });
      break;
    }

    case 'plotted_development': {
      const netDevSqft = landSqft != null ? landSqft * profile.net_developable_pct : null;
      const plots = netDevSqft != null ? floorInt(netDevSqft / profile.typical_plot_sqft) : null;
      const saleablePlotSqft = plots != null ? plots * profile.typical_plot_sqft : null;

      out.unit_count = plots;
      out.saleable_sqft = saleablePlotSqft;
      out.plot_yield = plots;
      out.build_cost_inr = landSqft != null ? landSqft * profile.build_cost_per_sqft_infra : null;
      out.gross_revenue_inr = saleablePlotSqft != null ? saleablePlotSqft * profile.market_rate_per_sqft_plot : null;

      pushMetric({ label: 'Plot yield', value: fmtNum(plots, 0), unit: 'plots', hint: `${fmtNum(profile.typical_plot_sqft)} sqft each` });
      pushMetric({ label: 'Saleable land', value: fmtNum(saleablePlotSqft), unit: 'sqft' });
      pushMetric({ label: 'Civic take-out', value: fmtNum(landSqft - saleablePlotSqft), unit: 'sqft', hint: 'roads + parks + OSR' });

      pushAssumption({ label: 'Plot size', value: `${fmtNum(profile.typical_plot_sqft)} sqft (30×60)` });
      pushAssumption({ label: 'Net developable', value: `${fmtNum(profile.net_developable_pct * 100, 0)}%` });
      pushAssumption({ label: 'Infra cost', value: `\u20b9${fmtNum(profile.build_cost_per_sqft_infra)}/sqft land` });
      break;
    }

    case 'commercial_office': {
      const leasable = realizedBua * profile.efficiency_leasable;
      const floorPlate = Math.min(profile.floor_plate_sqft, buildability.typical_footprint_sqft ?? Infinity);
      const workstations = floorInt(leasable / profile.workstation_sqft);
      const parkingCars = floorInt((leasable / 1000) * profile.parking_per_1000_sqft_leasable);
      const lifts = Math.max(2, Math.ceil(realizedBua / profile.lifts_per_sqft));
      const rentAnnual = leasable * profile.market_rent_per_sqft_month * 12;
      const stabilised = rentAnnual / profile.cap_rate;

      out.leasable_sqft = leasable;
      out.floor_plate_sqft = floorPlate;
      out.workstations = workstations;
      out.lifts = lifts;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      out.gross_revenue_inr = rentAnnual;
      out.stabilised_value_inr = stabilised;

      pushMetric({ label: 'Leasable area', value: fmtNum(leasable), unit: 'sqft', hint: `${Math.round(profile.efficiency_leasable * 100)}% efficiency (IPMS)` });
      pushMetric({ label: 'Floor plate',   value: fmtNum(floorPlate), unit: 'sqft', hint: 'Grade A target' });
      pushMetric({ label: 'Workstations',  value: fmtNum(workstations, 0), unit: 'seats', hint: '1/80 sqft' });
      pushMetric({ label: 'Parking cars',  value: fmtNum(parkingCars, 0), unit: 'bays', hint: `${profile.parking_per_1000_sqft_leasable}/1,000 sqft leasable` });

      pushAssumption({ label: 'Rent',      value: `\u20b9${fmtNum(profile.market_rent_per_sqft_month)}/sqft/mo Grade A` });
      pushAssumption({ label: 'Cap rate',  value: `${fmtNum(profile.cap_rate * 100, 1)}%` });
      pushAssumption({ label: 'Build cost', value: `\u20b9${fmtNum(profile.build_cost_per_sqft)}/sqft BUA` });
      break;
    }

    case 'commercial_retail': {
      const gla = realizedBua * profile.efficiency_gla;
      const anchor = gla * profile.anchor_share;
      const line = gla * profile.line_share;
      const rentAnnual = gla * profile.market_rent_per_sqft_month * 12;
      const stabilised = rentAnnual / profile.cap_rate;

      out.leasable_sqft = gla;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      out.gross_revenue_inr = rentAnnual;
      out.stabilised_value_inr = stabilised;

      pushMetric({ label: 'GLA',           value: fmtNum(gla), unit: 'sqft', hint: `${Math.round(profile.efficiency_gla * 100)}% of BUA` });
      pushMetric({ label: 'Anchor share',  value: fmtNum(anchor), unit: 'sqft', hint: `${Math.round(profile.anchor_share * 100)}%` });
      pushMetric({ label: 'Line shops',    value: fmtNum(line),   unit: 'sqft', hint: `${Math.round(profile.line_share * 100)}%` });
      pushMetric({ label: 'Stab. revenue', value: fmtInr(rentAnnual), hint: 'annual' });

      pushAssumption({ label: 'Rent', value: `\u20b9${fmtNum(profile.market_rent_per_sqft_month)}/sqft/mo (high-street/mall)` });
      pushAssumption({ label: 'Cap rate', value: `${fmtNum(profile.cap_rate * 100, 1)}%` });
      break;
    }

    case 'hospitality': {
      const keys = floorInt(realizedBua / profile.key_bua_sqft);
      const fnb = realizedBua * profile.fnb_share;
      const boh = realizedBua * profile.boh_share;
      const ballroom = realizedBua * profile.ballroom_mice_share;
      const revParAnnual = keys * profile.adr_inr * profile.occupancy * 365;

      out.keys = keys;
      out.fnb_sqft = fnb;
      out.boh_sqft = boh;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      out.gross_revenue_inr = revParAnnual;

      pushMetric({ label: 'Hotel keys', value: fmtNum(keys, 0), unit: 'keys', hint: `${profile.key_bua_sqft} sqft/key` });
      pushMetric({ label: 'F&B',        value: fmtNum(fnb),    unit: 'sqft', hint: `${Math.round(profile.fnb_share * 100)}%` });
      pushMetric({ label: 'MICE / ballroom', value: fmtNum(ballroom), unit: 'sqft', hint: `${Math.round(profile.ballroom_mice_share * 100)}%` });
      pushMetric({ label: 'Back of house',   value: fmtNum(boh), unit: 'sqft', hint: `${Math.round(profile.boh_share * 100)}%` });

      pushAssumption({ label: 'ADR',   value: `\u20b9${fmtNum(profile.adr_inr)}/night (mid-scale BLR)` });
      pushAssumption({ label: 'Occupancy', value: `${Math.round(profile.occupancy * 100)}%` });
      pushAssumption({ label: 'Build cost', value: `\u20b9${fmtNum(profile.build_cost_per_sqft)}/sqft BUA` });
      break;
    }

    case 'warehousing': {
      const clearUsable = realizedBua * profile.efficiency_clear_usable;
      const dockCount = floorInt(clearUsable / profile.dock_per_sqft);
      const clearH = Math.max(profile.clear_height_m_min, buildability.max_height_m ?? 0);
      const rentAnnual = clearUsable * profile.market_rent_per_sqft_month * 12;
      const stabilised = rentAnnual / profile.cap_rate;

      out.leasable_sqft = clearUsable;
      out.docks = dockCount;
      out.clear_height_m = clearH;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      out.gross_revenue_inr = rentAnnual;
      out.stabilised_value_inr = stabilised;

      pushMetric({ label: 'Clear usable', value: fmtNum(clearUsable), unit: 'sqft', hint: `${Math.round(profile.efficiency_clear_usable * 100)}% efficiency` });
      pushMetric({ label: 'Clear height', value: fmtNum(clearH, 1), unit: 'm',    hint: `${profile.clear_height_m_min} m min Grade A` });
      pushMetric({ label: 'Dock doors',   value: fmtNum(dockCount, 0), unit: 'docks', hint: `1 per ${fmtNum(profile.dock_per_sqft)} sqft` });
      pushMetric({ label: 'Truck court',  value: `${profile.truck_court_depth_m} m`, hint: 'min depth Grade A' });

      pushAssumption({ label: 'Rent',     value: `\u20b9${fmtNum(profile.market_rent_per_sqft_month)}/sqft/mo` });
      pushAssumption({ label: 'Cap rate', value: `${fmtNum(profile.cap_rate * 100, 1)}%` });
      pushAssumption({ label: 'FSI is usually NOT binding', value: 'coverage + clear height drive envelope' });
      break;
    }

    case 'industrial': {
      const coverageSqft = landSqft != null ? landSqft * profile.typical_coverage_pct : null;
      out.saleable_sqft = realizedBua;
      out.clear_height_m = profile.clear_height_m_min;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      out.gross_revenue_inr = realizedBua * profile.market_rent_per_sqft_month * 12;

      pushMetric({ label: 'Coverage', value: fmtNum(coverageSqft), unit: 'sqft', hint: `${Math.round(profile.typical_coverage_pct * 100)}% typical` });
      pushMetric({ label: 'Clear height', value: fmtNum(profile.clear_height_m_min, 1), unit: 'm', hint: 'minimum' });
      pushMetric({ label: 'Utility land', value: fmtNum(landSqft * profile.utility_land_pct), unit: 'sqft', hint: 'substation / ETP' });

      pushAssumption({ label: 'Rent', value: `\u20b9${fmtNum(profile.market_rent_per_sqft_month)}/sqft/mo` });
      break;
    }

    case 'data_center': {
      const itSqft = realizedBua * (1 - profile.mep_share);
      const itLoadMw = itSqft / profile.it_load_per_mw_sqft;
      const totalMw = itLoadMw * profile.pue;

      out.it_load_mw = itLoadMw;
      out.leasable_sqft = itSqft;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;

      pushMetric({ label: 'IT load',      value: fmtNum(itLoadMw, 1), unit: 'MW', hint: `${fmtNum(profile.it_load_w_per_sqft)} W/sqft IT` });
      pushMetric({ label: 'Total power',  value: fmtNum(totalMw, 1), unit: 'MW', hint: `PUE ${profile.pue}` });
      pushMetric({ label: 'IT floor area', value: fmtNum(itSqft), unit: 'sqft', hint: `${Math.round((1 - profile.mep_share) * 100)}% of BUA` });
      pushMetric({ label: 'MEP area',     value: fmtNum(realizedBua * profile.mep_share), unit: 'sqft', hint: 'cooling + electrical' });

      pushAssumption({ label: 'PUE target', value: String(profile.pue) });
      pushAssumption({ label: 'Build cost', value: `\u20b9${fmtNum(profile.build_cost_per_sqft)}/sqft (shell + MEP)` });
      break;
    }

    case 'senior_living': {
      const units = floorInt(realizedBua * (1 - profile.care_area_share) / profile.unit_bua_sqft);
      out.unit_count = units;
      out.saleable_sqft = realizedBua;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      out.gross_revenue_inr = realizedBua * profile.market_rate_per_sqft_sbua;
      pushMetric({ label: 'Care units',    value: fmtNum(units, 0), unit: 'units' });
      pushMetric({ label: 'Unit size',     value: fmtNum(profile.unit_bua_sqft), unit: 'sqft BUA' });
      pushMetric({ label: 'Care area',     value: fmtNum(realizedBua * profile.care_area_share), unit: 'sqft', hint: `${Math.round(profile.care_area_share * 100)}%` });
      break;
    }

    case 'student_housing': {
      const beds = floorInt(realizedBua * (1 - profile.common_share) / profile.bed_bua_sqft);
      out.unit_count = beds;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      out.gross_revenue_inr = beds * profile.monthly_rent_per_bed * 12 * 0.9; // 90% occupancy
      pushMetric({ label: 'Beds',       value: fmtNum(beds, 0), unit: 'beds' });
      pushMetric({ label: 'Common',     value: fmtNum(realizedBua * profile.common_share), unit: 'sqft', hint: `${Math.round(profile.common_share * 100)}% dining/common` });
      pushMetric({ label: 'Rent/bed/mo', value: fmtInr(profile.monthly_rent_per_bed) });
      break;
    }

    case 'healthcare': {
      const clinicalSqft = realizedBua * (1 - profile.ot_icu_share - profile.diagnostics_share);
      const beds = floorInt(clinicalSqft / profile.bed_bua_sqft);
      out.unit_count = beds;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      pushMetric({ label: 'Beds',         value: fmtNum(beds, 0), unit: 'beds', hint: `${profile.bed_bua_sqft} sqft/bed` });
      pushMetric({ label: 'OT + ICU',     value: fmtNum(realizedBua * profile.ot_icu_share), unit: 'sqft' });
      pushMetric({ label: 'Diagnostics',  value: fmtNum(realizedBua * profile.diagnostics_share), unit: 'sqft' });
      break;
    }

    case 'education': {
      const coreSeats = realizedBua / profile.seat_sqft;
      const seats = floorInt(coreSeats / (1 + profile.lab_uplift));
      out.unit_count = seats;
      out.build_cost_inr = realizedBua * profile.build_cost_per_sqft;
      pushMetric({ label: 'Student seats', value: fmtNum(seats, 0), unit: 'seats', hint: `${profile.seat_sqft} sqft/seat` });
      pushMetric({ label: 'Open space',    value: fmtNum(landSqft * profile.open_space_min_pct), unit: 'sqft', hint: `${Math.round(profile.open_space_min_pct * 100)}% of land min` });
      break;
    }

    default:
      out.has_programme = false;
  }

  return out;
}

// ---------------------------------------------------------------------------
// SCENARIO COMPARISON
// ---------------------------------------------------------------------------
// Base FSI only vs With Premium FAR — so users can decide whether premium
// is worth the BDA fee. Returns matched pair of buildabilities + diff.
export function computeScenarios({ zone, property, assetClass, options = {} }) {
  const baseOnly = computeBuildability({
    zone, property, assetClass,
    options: { ...options, usePremiumFar: false },
  });
  const withPremium = computeBuildability({
    zone, property, assetClass,
    options: { ...options, usePremiumFar: true },
  });

  const deltaBuaSqft = (withPremium.realized_built_up_sqft ?? 0) - (baseOnly.realized_built_up_sqft ?? 0);
  const premiumBuaSqft = withPremium.premium_built_up_sqft ?? 0;
  const feeEstimate = estimatePremiumFarCost({ property, premium_bua_sqft: premiumBuaSqft });

  const baseProg = computeProgramme({ buildability: baseOnly, property });
  const premiumProg = computeProgramme({ buildability: withPremium, property });
  const revenueDelta = (premiumProg?.gross_revenue_inr ?? 0) - (baseProg?.gross_revenue_inr ?? 0);
  const valueDelta = (premiumProg?.stabilised_value_inr ?? 0) - (baseProg?.stabilised_value_inr ?? 0);

  const has_premium_available = (withPremium.premium_fsi_available ?? 0) > 0.01;

  return {
    base_only: baseOnly,
    with_premium: withPremium,
    base_programme: baseProg,
    premium_programme: premiumProg,
    delta_bua_sqft: deltaBuaSqft,
    premium_bua_sqft: premiumBuaSqft,
    premium_fee_estimate: feeEstimate,
    revenue_delta_inr: revenueDelta,
    value_delta_inr: valueDelta,
    net_uplift_inr: (valueDelta || revenueDelta) - (feeEstimate.fee_inr ?? 0),
    has_premium_available,
  };
}
