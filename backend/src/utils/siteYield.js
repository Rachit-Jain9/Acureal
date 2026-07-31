'use strict';

// Deterministic site-yield engine — the "programme producer".
//
// Pure deterministic JS — NO AI involvement, per the Acureal hard rule that all
// area/yield/financial math is computed by code, never by a model. AI may only
// PROPOSE the editable assumptions fed in here and EXPLAIN the result; it may
// never compute a number in this file.
//
// Mirrors frontend/src/utils/siteYield.js verbatim (only the export syntax
// differs). Change one, change both, and run the parity test in
// backend/tests/siteYield.parity.test.js.
//
// What it does: takes a regulatory ENVELOPE (the FAR / coverage / height /
// setback facts already computed deterministically by buildEnvelope.js or
// parcelBuildability.js) plus a set of EDITABLE programme ASSUMPTIONS, and
// produces a screening development programme for the deal's asset class —
// realized GFA, the binding constraint, an area schedule, a unit / key / plot
// count, and a parking demand. It then emits `programme` + `buildability`
// objects in the exact shapes that frontend/src/utils/programmeToInputs.js
// consumes, so a chosen scheme flows one click into the Financial Engine.
//
// IMPORTANT — kernel contract: the engine emits DRIVERS (effective FSI,
// avg unit size, leasable area, keys …). The financial kernel derives gross /
// saleable area from FSI itself. The engine must not feed a pre-computed GFA
// into the kernel as an independent input, or one deal carries two GFA numbers.
//
// IMPORTANT — provenance: every ratio below (loading, efficiency, parking norm,
// unit mix, plot size, saleable-land fraction) is a SCREENING DEFAULT, not a
// statutory fact. Each is overridable via `assumptions`, and outputs carry a
// `basis` of 'default' | 'assumption' so the UI can show what the analyst set
// vs what was assumed. Parking norms in particular vary by RMP 2015 annexure —
// these defaults are directional and flagged for verification, never asserted
// as the legal requirement.

const SQFT_PER_SQM = 10.76391041671;

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toPositive = (value) => {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
};

const round = (value, precision = 2) => {
  const n = toNumber(value);
  if (n === null) return null;
  const f = 10 ** precision;
  return Math.round(n * f) / f;
};

const clampFraction = (value) => {
  const n = toNumber(value);
  if (n === null) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

// Canonical deal asset class -> programme "family". A family shares the same
// yield logic; per-class nuances live in the per-family builders below.
const FAMILY_BY_ASSET_CLASS = {
  residential_apartments: 'residential',
  mixed_use: 'residential', // sized as a residential-led stack at screening; refine per-block later
  redevelopment: 'residential',
  villas: 'plotted',
  plotted_development: 'plotted',
  raw_land: 'plotted',
  commercial_office: 'commercial',
  retail: 'commercial',
  industrial_warehousing: 'industrial',
  hospitality: 'hospitality',
};

const resolveFamily = (assetClass) => FAMILY_BY_ASSET_CLASS[assetClass] || 'residential';

// ── Screening defaults (all overridable via `assumptions`) ──────────────────
// Floor-to-floor heights (m) used to convert a height ceiling into a floor
// count. Directional industry screening values, not code minimums.
const FLOOR_TO_FLOOR_M = {
  residential: 3.2,
  commercial: 3.9,
  industrial: 7.5, // warehouse clear height dominates; "floors" usually 1–2
  hospitality: 3.4,
  plotted: 3.2,
};

// Efficiency = leasable-or-NSA / GFA. Carpet efficiency for residential is the
// carpet / GFA fraction after walls, cores, services and common areas.
const EFFICIENCY = {
  residential: { carpetOverGfa: 0.62, label: 'Carpet ÷ GFA (residential screening)' },
  commercial: { leasableOverGfa: 0.80, label: 'Leasable ÷ GFA (office/retail screening)' },
  industrial: { leasableOverGfa: 0.90, label: 'Leasable ÷ GFA (warehouse screening)' },
  hospitality: { nsaOverGfa: 0.68, label: 'Net saleable ÷ GFA (hospitality screening)' },
};

// Residential loading: super-built-up (saleable) = carpet × (1 + loading).
const DEFAULT_RESIDENTIAL_LOADING = 0.30;

// Default residential unit mix (Bengaluru mid-income screening). `carpet_sqft`
// is per-unit carpet; `share_pct` of the carpet pool goes to that type.
const DEFAULT_RESIDENTIAL_MIX = [
  { key: '1bhk', label: '1 BHK', carpet_sqft: 600, share_pct: 10 },
  { key: '2bhk', label: '2 BHK', carpet_sqft: 1000, share_pct: 55 },
  { key: '3bhk', label: '3 BHK', carpet_sqft: 1450, share_pct: 35 },
];

// Parking — directional screening norms; verify against RMP 2015 parking
// annexure per zone before quoting. ECS = equivalent car space.
const DEFAULT_PARKING = {
  residential_ecs_per_unit: 1.3,
  commercial_ecs_per_100sqm_gfa: 1.6,
  industrial_ecs_per_100sqm_gfa: 0.4,
  hospitality_ecs_per_key: 0.5,
};

// Plotted / villa screening defaults.
const DEFAULT_PLOTTED = {
  saleable_land_pct: 0.55, // net of roads, parks, civic amenities (typical layout)
  avg_plot_sqft: 1200, // ~30×40 ft site
  villa_avg_plot_sqft: 2400,
  villa_plot_coverage_pct: 50, // built-up per villa plot, screening
  villa_floors: 2,
};

// Default screening build cost (₹ / sqft) by family — directional only; the
// Financial Engine is where the analyst sets the real number. Emitted so the
// prefill has a sane starting value, never as a quoted cost.
const DEFAULT_BUILD_COST_PER_SQFT = {
  residential: 2600,
  commercial: 3000,
  industrial: 1800,
  hospitality: 4200,
  plotted_infra: 600, // infra cost per saleable sqft for plotted dev
};

// Integer apportionment by largest remainder — distributes a total across
// shares so the rounded parts sum exactly to the (floored) total. Used so unit
// counts never silently drift from the area pool.
function largestRemainderCounts(targets) {
  // targets: [{ key, exact }] where exact is the fractional ideal count
  const floored = targets.map((t) => ({ ...t, base: Math.floor(t.exact), rem: t.exact - Math.floor(t.exact) }));
  const totalFloor = floored.reduce((s, t) => s + t.base, 0);
  const totalExact = Math.round(targets.reduce((s, t) => s + t.exact, 0));
  let remainder = totalExact - totalFloor;
  const byRemDesc = [...floored].sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < byRemDesc.length && remainder > 0; i += 1) {
    byRemDesc[i].base += 1;
    remainder -= 1;
  }
  const out = {};
  for (const t of floored) out[t.key] = t.base;
  return out;
}

// Normalize the regulatory envelope into the few fields the yield math needs.
// Accepts either a buildEnvelope.js result, a parcelBuildability.js
// `values` block, or a flat hand-built object.
function normalizeEnvelope(envelope = {}) {
  const e = envelope || {};
  const inp = e.inputs || {}; // buildEnvelope nests plot dims under `inputs`
  const sqmToSqftLocal = (v) => (toPositive(v) != null ? toPositive(v) * SQFT_PER_SQM : null);
  // land area (sqft) — accept flat keys, parcelBuildability values, or a raw
  // buildEnvelope result (sqm under `inputs`).
  const landAreaSqft =
    toPositive(e.landAreaSqft) ??
    toPositive(e.land_sqft) ??
    toPositive(e.land_area_sqft) ??
    toPositive(e.plot_area_sqft) ??
    toPositive(inp.plot_area_sqft) ??
    sqmToSqftLocal(e.plot_area_sqm) ??
    sqmToSqftLocal(e.land_area_sqm) ??
    sqmToSqftLocal(inp.plot_area_sqm);

  // effective FSI to realize
  const effectiveFsi =
    toPositive(e.effectiveFsi) ??
    toPositive(e.effective_fsi) ??
    toPositive(e.base_far) ??
    toPositive(e.max_far) ??
    (e.far ? (toPositive(e.far.base_fsi) ?? toPositive(e.far.max_fsi)) : null);

  // ground coverage %
  const groundCoveragePct =
    toPositive(e.groundCoveragePct) ??
    toPositive(e.ground_coverage_pct) ??
    null;

  // allowed height (m)
  const allowedHeightM =
    toPositive(e.allowedHeightM) ??
    (e.height ? (toPositive(e.height.allowed_max_m) ?? toPositive(e.height.zone_max_m)) : null) ??
    null;

  // permitted GFA may be supplied directly; else derived below from FSI
  const permittedGfaSqft =
    toPositive(e.permittedGfaSqft) ??
    toPositive(e.gross_max_buildable_area_sqft) ??
    toPositive(e.base_buildable_area_sqft) ??
    null;

  return { landAreaSqft, effectiveFsi, groundCoveragePct, allowedHeightM, permittedGfaSqft };
}

// Compute realized GFA and identify the binding constraint. Realized GFA is
// the lesser of (FAR cap) and (ground-coverage footprint × floors). Whichever
// is smaller binds; if height/coverage are unknown, FAR binds with a note.
function computeRealizedGfa(env, { floorToFloorM } = {}) {
  const { landAreaSqft, effectiveFsi, groundCoveragePct, allowedHeightM } = env;
  if (landAreaSqft === null) {
    return { ok: false, reason: 'missing_land_area' };
  }

  const farGfaSqft = effectiveFsi !== null
    ? round(landAreaSqft * effectiveFsi, 0)
    : (env.permittedGfaSqft ?? null);

  const footprintCapSqft = groundCoveragePct !== null
    ? round(landAreaSqft * (groundCoveragePct / 100), 0)
    : null;

  const f2f = toPositive(floorToFloorM);
  const floors = (allowedHeightM !== null && f2f) ? Math.max(1, Math.floor(allowedHeightM / f2f)) : null;
  const coverageGfaSqft = (footprintCapSqft !== null && floors !== null)
    ? round(footprintCapSqft * floors, 0)
    : null;

  const candidates = [];
  if (farGfaSqft !== null) candidates.push({ key: 'far', value: farGfaSqft });
  if (coverageGfaSqft !== null) candidates.push({ key: 'coverage_height', value: coverageGfaSqft });

  if (candidates.length === 0) {
    return { ok: false, reason: 'insufficient_envelope' };
  }

  const binding = candidates.reduce((min, c) => (c.value < min.value ? c : min), candidates[0]);
  return {
    ok: true,
    farGfaSqft,
    footprintCapSqft,
    floors,
    coverageGfaSqft,
    realizedGfaSqft: binding.value,
    bindingConstraint: binding.key,
    unrealizedFarPct: (farGfaSqft && binding.value < farGfaSqft)
      ? round(((farGfaSqft - binding.value) / farGfaSqft) * 100, 1)
      : 0,
  };
}

// ── Per-family programme builders ───────────────────────────────────────────

function buildResidentialProgramme({ realizedGfaSqft, assetClass, assumptions }) {
  const carpetEff = clampFraction(assumptions.carpetEfficiency) ?? EFFICIENCY.residential.carpetOverGfa;
  const loading = toNumber(assumptions.loadingFactor);
  const loadingFactor = loading !== null ? (loading > 1 ? loading / 100 : loading) : DEFAULT_RESIDENTIAL_LOADING;

  const carpetPoolSqft = round(realizedGfaSqft * carpetEff, 0);
  const saleableSqft = round(carpetPoolSqft * (1 + loadingFactor), 0);

  const mix = Array.isArray(assumptions.unitMix) && assumptions.unitMix.length
    ? assumptions.unitMix
    : DEFAULT_RESIDENTIAL_MIX;
  const shareTotal = mix.reduce((s, m) => s + (toPositive(m.share_pct) || 0), 0) || 1;

  // exact ideal counts per type = (carpet pool × share) / per-unit carpet
  const targets = mix
    .map((m) => {
      const unitCarpet = toPositive(m.carpet_sqft);
      const share = (toPositive(m.share_pct) || 0) / shareTotal;
      if (!unitCarpet) return null;
      return { key: m.key, label: m.label, carpet_sqft: unitCarpet, exact: (carpetPoolSqft * share) / unitCarpet };
    })
    .filter(Boolean);

  const counts = largestRemainderCounts(targets);
  const unit_mix = targets.map((t) => ({
    key: t.key,
    label: t.label,
    count: counts[t.key] || 0,
    carpet_sqft: t.carpet_sqft,
    carpet_total_sqft: round((counts[t.key] || 0) * t.carpet_sqft, 0),
  }));
  const totalUnits = unit_mix.reduce((s, u) => s + u.count, 0);

  const ecsPerUnit = toPositive(assumptions.parkingEcsPerUnit) ?? DEFAULT_PARKING.residential_ecs_per_unit;
  const parkingEcs = Math.ceil(totalUnits * ecsPerUnit);

  const buildCost = toPositive(assumptions.buildCostPerSqft) ?? DEFAULT_BUILD_COST_PER_SQFT.residential;

  return {
    family: 'residential',
    areaSchedule: {
      gfa_sqft: realizedGfaSqft,
      carpet_sqft: carpetPoolSqft,
      saleable_sqft: saleableSqft,
      carpet_efficiency_pct: round(carpetEff * 100, 1),
      loading_factor_pct: round(loadingFactor * 100, 1),
    },
    unitMix: unit_mix,
    totals: { units: totalUnits },
    parking: {
      required_ecs: parkingEcs,
      norm: `${ecsPerUnit} ECS / unit`,
      basis: toPositive(assumptions.parkingEcsPerUnit) ? 'assumption' : 'default',
    },
    // Shapes for programmeToInputs.js (consumer expects these keys).
    programme: {
      unit_mix: unit_mix.map((u) => ({ count: u.count, carpet_total_sqft: u.carpet_total_sqft })),
      build_cost_per_sqft: buildCost,
      saleable_sqft: saleableSqft,
    },
  };
}

function buildCommercialProgramme({ realizedGfaSqft, assetClass, assumptions, family }) {
  const eff = clampFraction(assumptions.leasableEfficiency)
    ?? (family === 'industrial' ? EFFICIENCY.industrial.leasableOverGfa : EFFICIENCY.commercial.leasableOverGfa);
  const leasableSqft = round(realizedGfaSqft * eff, 0);

  const ecsPer100 = toPositive(assumptions.parkingEcsPer100Sqm)
    ?? (family === 'industrial' ? DEFAULT_PARKING.industrial_ecs_per_100sqm_gfa : DEFAULT_PARKING.commercial_ecs_per_100sqm_gfa);
  const gfaSqm = realizedGfaSqft / SQFT_PER_SQM;
  const parkingEcs = Math.ceil((gfaSqm / 100) * ecsPer100);

  const buildCost = toPositive(assumptions.buildCostPerSqft)
    ?? (family === 'industrial' ? DEFAULT_BUILD_COST_PER_SQFT.industrial : DEFAULT_BUILD_COST_PER_SQFT.commercial);

  const programme = {
    leasable_sqft: leasableSqft,
    build_cost_per_sqft: buildCost,
  };
  const rent = toPositive(assumptions.rentPerSqftPerMonth);
  if (rent) programme.rent_per_sqft_pm = rent;

  return {
    family,
    areaSchedule: {
      gfa_sqft: realizedGfaSqft,
      leasable_sqft: leasableSqft,
      leasable_efficiency_pct: round(eff * 100, 1),
    },
    totals: { leasable_sqft: leasableSqft },
    parking: {
      required_ecs: parkingEcs,
      norm: `${ecsPer100} ECS / 100 sqm GFA`,
      basis: toPositive(assumptions.parkingEcsPer100Sqm) ? 'assumption' : 'default',
    },
    programme,
  };
}

function buildHospitalityProgramme({ realizedGfaSqft, assumptions }) {
  const nsaEff = clampFraction(assumptions.nsaEfficiency) ?? EFFICIENCY.hospitality.nsaOverGfa;
  const grossAreaPerKey = toPositive(assumptions.grossAreaPerKeySqft) ?? 1000; // GFA per key incl. BOH + common
  const keys = Math.max(0, Math.floor(realizedGfaSqft / grossAreaPerKey));
  const nsaSqft = round(realizedGfaSqft * nsaEff, 0);

  const ecsPerKey = toPositive(assumptions.parkingEcsPerKey) ?? DEFAULT_PARKING.hospitality_ecs_per_key;
  const parkingEcs = Math.ceil(keys * ecsPerKey);

  const buildCost = toPositive(assumptions.buildCostPerSqft) ?? DEFAULT_BUILD_COST_PER_SQFT.hospitality;

  const programme = {
    keys,
    build_cost_per_sqft: buildCost,
  };
  const adr = toPositive(assumptions.adrInr);
  if (adr) programme.adr_inr = adr;
  const occ = toNumber(assumptions.occupancy);
  if (occ !== null) programme.occupancy = occ > 1 ? occ / 100 : occ;

  return {
    family: 'hospitality',
    areaSchedule: {
      gfa_sqft: realizedGfaSqft,
      net_saleable_sqft: nsaSqft,
      nsa_efficiency_pct: round(nsaEff * 100, 1),
      gross_area_per_key_sqft: grossAreaPerKey,
    },
    totals: { keys },
    parking: {
      required_ecs: parkingEcs,
      norm: `${ecsPerKey} ECS / key`,
      basis: toPositive(assumptions.parkingEcsPerKey) ? 'assumption' : 'default',
    },
    programme,
  };
}

function buildPlottedProgramme({ env, assetClass, assumptions }) {
  const landAreaSqft = env.landAreaSqft;
  const isVilla = assetClass === 'villas';
  const saleablePct = clampFraction(assumptions.saleableLandPct) ?? DEFAULT_PLOTTED.saleable_land_pct;
  const avgPlot = toPositive(assumptions.avgPlotSizeSqft)
    ?? (isVilla ? DEFAULT_PLOTTED.villa_avg_plot_sqft : DEFAULT_PLOTTED.avg_plot_sqft);

  const saleablePlotAreaSqft = round(landAreaSqft * saleablePct, 0);
  const plotCount = Math.max(0, Math.floor(saleablePlotAreaSqft / avgPlot));

  const out = {
    family: 'plotted',
    areaSchedule: {
      land_sqft: round(landAreaSqft, 0),
      saleable_plot_area_sqft: saleablePlotAreaSqft,
      saleable_land_pct: round(saleablePct * 100, 1),
      avg_plot_sqft: avgPlot,
    },
    totals: { plots: plotCount },
    parking: { required_ecs: null, norm: 'In-plot (not aggregated for plotted dev)', basis: 'default' },
    programme: {},
  };

  if (isVilla) {
    const coverage = clampFraction((toNumber(assumptions.villaPlotCoveragePct) ?? DEFAULT_PLOTTED.villa_plot_coverage_pct) / 100);
    const floors = toPositive(assumptions.villaFloors) ?? DEFAULT_PLOTTED.villa_floors;
    const perVillaBua = round(avgPlot * coverage * floors, 0);
    const totalBua = round(perVillaBua * plotCount, 0);
    out.areaSchedule.per_villa_bua_sqft = perVillaBua;
    out.areaSchedule.total_villa_bua_sqft = totalBua;
    out.totals.villas = plotCount;
    const buildCost = toPositive(assumptions.buildCostPerSqft) ?? DEFAULT_BUILD_COST_PER_SQFT.residential;
    out.programme.build_cost_per_sqft = buildCost;
  } else {
    const infraCost = toPositive(assumptions.infraCostPerSqft) ?? DEFAULT_BUILD_COST_PER_SQFT.plotted_infra;
    out.programme.build_cost_per_sqft_infra = infraCost;
  }

  return out;
}

// ── Main entry point ────────────────────────────────────────────────────────

function computeSiteYield(input = {}) {
  const assetClass = input.assetClass || 'residential_apartments';
  const family = resolveFamily(assetClass);
  const assumptions = input.assumptions || {};
  const env = normalizeEnvelope(input.envelope || {});
  const warnings = [];

  if (env.landAreaSqft === null) {
    return {
      ok: false,
      assetClass,
      family,
      reason: 'missing_land_area',
      message: 'Land area is required before a site programme can be computed.',
      warnings: ['Land area is missing — enter a plot area or draw/upload a boundary.'],
    };
  }

  // Plotted / raw land don't use FSI/GFA — go straight to subdivision.
  if (family === 'plotted') {
    if (env.effectiveFsi === null && assetClass === 'raw_land') {
      warnings.push('Raw land: showing plot-subdivision yield only. Link a FAR rule to model built-up development.');
    }
    const built = buildPlottedProgramme({ env, assetClass, assumptions });
    return assembleResult({ assetClass, family, env, gfa: null, built, warnings });
  }

  const f2f = toPositive(assumptions.floorToFloorM) ?? FLOOR_TO_FLOOR_M[family] ?? 3.3;
  const gfa = computeRealizedGfa(env, { floorToFloorM: f2f });
  if (!gfa.ok) {
    return {
      ok: false,
      assetClass,
      family,
      reason: gfa.reason,
      message: gfa.reason === 'insufficient_envelope'
        ? 'Need at least an FSI or a coverage + height to compute buildable GFA.'
        : 'Land area is required.',
      warnings: ['Add an FSI (from the matched FAR rule) or a ground-coverage % and height to compute yield.'],
    };
  }

  if (env.effectiveFsi === null) {
    warnings.push('No effective FSI — GFA derived from ground coverage × floors only. Match a FAR rule for an FSI-based figure.');
  }
  if (gfa.bindingConstraint === 'coverage_height' && gfa.unrealizedFarPct > 0) {
    warnings.push(`Yield is constrained by ground coverage × height, not FAR — ${gfa.unrealizedFarPct}% of permitted FAR is unrealised at this height.`);
  }

  let built;
  if (family === 'hospitality') {
    built = buildHospitalityProgramme({ realizedGfaSqft: gfa.realizedGfaSqft, assumptions });
  } else if (family === 'commercial' || family === 'industrial') {
    built = buildCommercialProgramme({ realizedGfaSqft: gfa.realizedGfaSqft, assetClass, assumptions, family });
  } else {
    built = buildResidentialProgramme({ realizedGfaSqft: gfa.realizedGfaSqft, assetClass, assumptions });
  }

  return assembleResult({ assetClass, family, env, gfa, built, warnings });
}

// Assemble the public result: the programme + the `buildability` summary in the
// exact shape programmeToInputs.js reads, plus a screening disclaimer.
function assembleResult({ assetClass, family, env, gfa, built, warnings }) {
  const realizedGfaSqft = gfa ? gfa.realizedGfaSqft : null;
  const effectiveFsi = env.effectiveFsi;

  // buildability shape consumed by mapProgrammeToInputs:
  //   { realized_built_up_sqft, land_sqft, effective_fsi }
  const buildability = {
    realized_built_up_sqft: realizedGfaSqft,
    land_sqft: round(env.landAreaSqft, 0),
    effective_fsi: effectiveFsi,
  };

  return {
    ok: true,
    assetClass,
    family,
    envelope: {
      land_sqft: round(env.landAreaSqft, 0),
      effective_fsi: effectiveFsi,
      far_gfa_sqft: gfa ? gfa.farGfaSqft : null,
      footprint_cap_sqft: gfa ? gfa.footprintCapSqft : null,
      floors: gfa ? gfa.floors : null,
      coverage_gfa_sqft: gfa ? gfa.coverageGfaSqft : null,
      realized_gfa_sqft: realizedGfaSqft,
    },
    bindingConstraint: gfa ? gfa.bindingConstraint : 'plot_subdivision',
    unrealizedFarPct: gfa ? gfa.unrealizedFarPct : 0,
    areaSchedule: built.areaSchedule,
    unitMix: built.unitMix || null,
    totals: built.totals,
    parking: built.parking,
    programme: built.programme,
    buildability,
    warnings,
    disclaimer:
      'Deterministic screening estimate. Yield, area schedule, unit/key/plot counts and parking '
      + 'are computed from the regulatory envelope and editable screening assumptions — not a '
      + 'surveyed or sanctioned plan. Verify FAR, coverage, height, setbacks and parking norms '
      + 'against RMP 2015 and a site survey before quoting in IC memos.',
  };
}

module.exports = {
  SQFT_PER_SQM,
  FAMILY_BY_ASSET_CLASS,
  FLOOR_TO_FLOOR_M,
  EFFICIENCY,
  DEFAULT_RESIDENTIAL_MIX,
  DEFAULT_PARKING,
  DEFAULT_PLOTTED,
  DEFAULT_BUILD_COST_PER_SQFT,
  resolveFamily,
  largestRemainderCounts,
  normalizeEnvelope,
  computeRealizedGfa,
  computeSiteYield,
};
