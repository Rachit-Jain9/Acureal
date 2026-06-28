'use strict';

// Correctness tests for the deterministic site-yield engine. The engine turns a
// regulatory envelope + editable assumptions into a screening programme. These
// lock the math (binding constraint, area schedule, unit/key/plot counts,
// parking) and the programmeToInputs.js output contract.

const {
  computeSiteYield,
  computeRealizedGfa,
  normalizeEnvelope,
  largestRemainderCounts,
  resolveFamily,
} = require('../src/utils/siteYield');

const ACRE_SQFT = 43560;

describe('resolveFamily', () => {
  test('maps every canonical asset class to a known family', () => {
    expect(resolveFamily('residential_apartments')).toBe('residential');
    expect(resolveFamily('mixed_use')).toBe('residential');
    expect(resolveFamily('redevelopment')).toBe('residential');
    expect(resolveFamily('villas')).toBe('plotted');
    expect(resolveFamily('plotted_development')).toBe('plotted');
    expect(resolveFamily('raw_land')).toBe('plotted');
    expect(resolveFamily('commercial_office')).toBe('commercial');
    expect(resolveFamily('retail')).toBe('commercial');
    expect(resolveFamily('industrial_warehousing')).toBe('industrial');
    expect(resolveFamily('hospitality')).toBe('hospitality');
  });

  test('unknown class falls back to residential (never throws)', () => {
    expect(resolveFamily('something_new')).toBe('residential');
    expect(resolveFamily(undefined)).toBe('residential');
  });
});

describe('largestRemainderCounts', () => {
  test('rounded parts sum exactly to the rounded total', () => {
    const counts = largestRemainderCounts([
      { key: 'a', exact: 11.253 },
      { key: 'b', exact: 37.135 },
      { key: 'c', exact: 16.298 },
    ]);
    expect(counts.a + counts.b + counts.c).toBe(65); // round(64.686)
    // the largest fractional remainder (c: .298) gets the +1
    expect(counts).toEqual({ a: 11, b: 37, c: 17 });
  });
});

describe('normalizeEnvelope', () => {
  test('reads buildEnvelope-style nested shape', () => {
    const env = normalizeEnvelope({
      inputs: { plot_area_sqm: 1000 },
      far: { base_fsi: 2.5, max_fsi: 3.25 },
      ground_coverage_pct: 60,
      height: { allowed_max_m: 32 },
    });
    expect(env.landAreaSqft).toBeCloseTo(1000 * 10.76391041671, 2);
    expect(env.effectiveFsi).toBe(2.5);
    expect(env.groundCoveragePct).toBe(60);
    expect(env.allowedHeightM).toBe(32);
  });

  test('reads flat shape and parcelBuildability values', () => {
    const env = normalizeEnvelope({ land_sqft: ACRE_SQFT, effective_fsi: 2.0 });
    expect(env.landAreaSqft).toBe(ACRE_SQFT);
    expect(env.effectiveFsi).toBe(2.0);
  });
});

describe('computeRealizedGfa — binding constraint', () => {
  test('FAR binds when coverage/height absent', () => {
    const out = computeRealizedGfa({ landAreaSqft: ACRE_SQFT, effectiveFsi: 2.5, groundCoveragePct: null, allowedHeightM: null }, { floorToFloorM: 3.2 });
    expect(out.ok).toBe(true);
    expect(out.farGfaSqft).toBe(Math.round(ACRE_SQFT * 2.5));
    expect(out.bindingConstraint).toBe('far');
    expect(out.realizedGfaSqft).toBe(out.farGfaSqft);
    expect(out.unrealizedFarPct).toBe(0);
  });

  test('coverage × height binds when smaller than FAR', () => {
    const out = computeRealizedGfa(
      { landAreaSqft: ACRE_SQFT, effectiveFsi: 3.25, groundCoveragePct: 40, allowedHeightM: 20 },
      { floorToFloorM: 3.2 },
    );
    // floors = floor(20/3.2) = 6 ; footprint = 0.40*43560 = 17424 ; coverageGfa = 104544
    expect(out.floors).toBe(6);
    expect(out.footprintCapSqft).toBe(17424);
    expect(out.coverageGfaSqft).toBe(104544);
    expect(out.farGfaSqft).toBe(Math.round(ACRE_SQFT * 3.25)); // 141570
    expect(out.bindingConstraint).toBe('coverage_height');
    expect(out.realizedGfaSqft).toBe(104544);
    expect(out.unrealizedFarPct).toBeGreaterThan(0);
  });

  test('insufficient envelope (no fsi, no coverage) → not ok', () => {
    const out = computeRealizedGfa({ landAreaSqft: ACRE_SQFT, effectiveFsi: null, groundCoveragePct: null, allowedHeightM: null }, { floorToFloorM: 3.2 });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('insufficient_envelope');
  });
});

describe('computeSiteYield — residential', () => {
  const res = computeSiteYield({
    assetClass: 'residential_apartments',
    envelope: { land_sqft: ACRE_SQFT, effective_fsi: 2.5 },
  });

  test('GFA = land × FSI and carpet/saleable derive from it', () => {
    expect(res.ok).toBe(true);
    expect(res.envelope.realized_gfa_sqft).toBe(Math.round(ACRE_SQFT * 2.5)); // 108900
    expect(res.areaSchedule.carpet_sqft).toBe(Math.round(108900 * 0.62)); // 67518
    expect(res.areaSchedule.saleable_sqft).toBe(Math.round(67518 * 1.3)); // 87773
  });

  test('unit mix counts are positive and parking scales with units', () => {
    const totalUnits = res.unitMix.reduce((s, u) => s + u.count, 0);
    expect(totalUnits).toBeGreaterThan(0);
    expect(res.totals.units).toBe(totalUnits);
    expect(res.parking.required_ecs).toBe(Math.ceil(totalUnits * 1.3));
  });

  test('emits programme + buildability in the programmeToInputs contract', () => {
    expect(Array.isArray(res.programme.unit_mix)).toBe(true);
    expect(res.programme.unit_mix[0]).toHaveProperty('count');
    expect(res.programme.unit_mix[0]).toHaveProperty('carpet_total_sqft');
    expect(res.programme.build_cost_per_sqft).toBeGreaterThan(0);
    expect(res.buildability).toEqual({
      realized_built_up_sqft: 108900,
      land_sqft: ACRE_SQFT,
      effective_fsi: 2.5,
    });
  });

  test('assumptions override defaults (loading + mix + parking)', () => {
    const custom = computeSiteYield({
      assetClass: 'residential_apartments',
      envelope: { land_sqft: ACRE_SQFT, effective_fsi: 2.5 },
      assumptions: {
        loadingFactor: 0.2,
        parkingEcsPerUnit: 2,
        unitMix: [{ key: '2bhk', label: '2 BHK', carpet_sqft: 1000, share_pct: 100 }],
      },
    });
    expect(custom.areaSchedule.loading_factor_pct).toBe(20);
    expect(custom.unitMix).toHaveLength(1);
    expect(custom.parking.basis).toBe('assumption');
    expect(custom.parking.required_ecs).toBe(Math.ceil(custom.totals.units * 2));
  });
});

describe('computeSiteYield — commercial & industrial', () => {
  test('office leasable = GFA × 0.80', () => {
    const out = computeSiteYield({ assetClass: 'commercial_office', envelope: { land_sqft: ACRE_SQFT, effective_fsi: 3.0 } });
    const gfa = Math.round(ACRE_SQFT * 3.0);
    expect(out.areaSchedule.leasable_sqft).toBe(Math.round(gfa * 0.8));
    expect(out.programme.leasable_sqft).toBe(Math.round(gfa * 0.8));
  });

  test('warehouse leasable = GFA × 0.90', () => {
    const out = computeSiteYield({ assetClass: 'industrial_warehousing', envelope: { land_sqft: ACRE_SQFT, effective_fsi: 1.5 } });
    const gfa = Math.round(ACRE_SQFT * 1.5);
    expect(out.areaSchedule.leasable_sqft).toBe(Math.round(gfa * 0.9));
  });
});

describe('computeSiteYield — hospitality', () => {
  test('keys = floor(GFA / gross-area-per-key)', () => {
    const out = computeSiteYield({ assetClass: 'hospitality', envelope: { land_sqft: ACRE_SQFT, effective_fsi: 3.0 } });
    const gfa = Math.round(ACRE_SQFT * 3.0); // 130680
    expect(out.totals.keys).toBe(Math.floor(gfa / 1000)); // 130
    expect(out.programme.keys).toBe(out.totals.keys);
  });
});

describe('computeSiteYield — plotted & villas', () => {
  test('plotted: plot count from saleable land ÷ avg plot', () => {
    const out = computeSiteYield({ assetClass: 'plotted_development', envelope: { land_sqft: ACRE_SQFT * 4 } });
    const saleable = Math.round(ACRE_SQFT * 4 * 0.55);
    expect(out.areaSchedule.saleable_plot_area_sqft).toBe(saleable);
    expect(out.totals.plots).toBe(Math.floor(saleable / 1200));
    expect(out.programme.build_cost_per_sqft_infra).toBeGreaterThan(0);
    expect(out.bindingConstraint).toBe('plot_subdivision');
  });

  test('villas: plot count + per-villa BUA', () => {
    const out = computeSiteYield({ assetClass: 'villas', envelope: { land_sqft: ACRE_SQFT * 4 } });
    expect(out.totals.villas).toBe(out.totals.plots);
    expect(out.areaSchedule.per_villa_bua_sqft).toBe(Math.round(2400 * 0.5 * 2)); // 2400
    expect(out.programme.build_cost_per_sqft).toBeGreaterThan(0);
  });

  test('raw_land: plotted yield with a guidance warning', () => {
    const out = computeSiteYield({ assetClass: 'raw_land', envelope: { land_sqft: ACRE_SQFT } });
    expect(out.ok).toBe(true);
    expect(out.warnings.join(' ')).toMatch(/raw land/i);
  });
});

describe('computeSiteYield — guards', () => {
  test('missing land area → ok:false with a clear message', () => {
    const out = computeSiteYield({ assetClass: 'residential_apartments', envelope: {} });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('missing_land_area');
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  test('residential without FSI or coverage → ok:false (needs envelope)', () => {
    const out = computeSiteYield({ assetClass: 'residential_apartments', envelope: { land_sqft: ACRE_SQFT } });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('insufficient_envelope');
  });

  test('every successful result carries the screening disclaimer', () => {
    const out = computeSiteYield({ assetClass: 'commercial_office', envelope: { land_sqft: ACRE_SQFT, effective_fsi: 2 } });
    expect(out.disclaimer).toMatch(/screening estimate/i);
  });
});
