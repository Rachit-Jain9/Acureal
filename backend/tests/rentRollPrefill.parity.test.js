'use strict';

// Parity + behavior guard for the register → financial-model prefill mapper.
// Backend is CJS, frontend is ESM; the frontend copy is compiled under a CJS
// shim (import line rewritten to require) and both run the same fixtures.
// Also rejects CommonJS artifacts in the mirror source (the #981 bug class).

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/utils/rentRollPrefill');

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'rentRollPrefill.js'),
  'utf8',
);

// Resolve the shared metrics dependency by ABSOLUTE path — the synthetic
// module has no real filename, so relative resolution would fall back to cwd.
const metricsAbsPath = require.resolve('../src/utils/rentRollMetrics')
  .replace(/\\/g, '\\\\');

const exportNames = [];
const stripped = frontendSrc
  .replace(
    /^import\s+\{([^}]+)\}\s+from\s+'\.\/rentRollMetrics';$/m,
    `const {$1} = require('${metricsAbsPath}');`,
  )
  .replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
    exportNames.push(name);
    return `${kind} ${name}`;
  });
const cjsSource = `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`;

const m = new Module('frontend-rentRollPrefill');
m.paths = Module._nodeModulePaths(__dirname);
m._compile(cjsSource, path.join(__dirname, 'frontend-rentRollPrefill.js'));
const frontend = m.exports;

const REGISTER = { as_of_date: '2026-07-14', total_leasable_area_sqft: 100000, settings: {} };
const RECORDS = [
  {
    id: 1, status: 'occupied', tenant_name: 'Anchor', rent_basis: 'per_sqft_month',
    chargeable_area_sqft: 40000, base_rent_rate: 100, cam_treatment: 'recovery', cam_rate: 20,
    escalation_pct: 15, escalation_every_months: 36,
    lease_expiry: '2031-03-31', market_rent_rate: 120,
    owner_opex_annual: 2400000, collection_pct: 98,
  },
  {
    id: 2, status: 'committed', tenant_name: 'Mid', rent_basis: 'per_sqft_month',
    chargeable_area_sqft: 20000, base_rent_rate: 110, cam_treatment: 'owner_borne',
    lease_expiry: '2033-06-30', owner_opex_annual: 1200000,
  },
  { id: 3, status: 'vacant', rent_basis: 'per_sqft_month', chargeable_area_sqft: 40000, market_rent_rate: 125 },
];

describe('rentRollPrefill — parity', () => {
  test('mirror is pure ESM and exports the same surface', () => {
    expect(frontendSrc).not.toMatch(/\bmodule\.exports\b/);
    expect(frontendSrc).not.toMatch(/\brequire\s*\(/);
    expect(Object.keys(frontend).sort()).toEqual(Object.keys(backend).sort());
  });

  test('identical output on the fixture', () => {
    const args = { records: RECORDS, register: REGISTER, assetClass: 'commercial_office' };
    expect(frontend.buildRegisterPrefill(args)).toEqual(backend.buildRegisterPrefill(args));
  });
});

describe('rentRollPrefill — behavior (hand-computed)', () => {
  const result = backend.buildRegisterPrefill({
    records: RECORDS, register: REGISTER, assetClass: 'commercial_office',
  });
  const byName = Object.fromEntries(result.fields.map((f) => [f.name, f]));

  test('maps ONLY canonical income inputs, all grounded', () => {
    expect(result.supported).toBe(true);
    expect(result.fields.map((f) => f.name).sort()).toEqual([
      'baseRentPerSqftMonth', 'leasableAreaSqft', 'opexPct', 'rentEscalationPct', 'vacancyPct',
    ]);
  });

  test('leasable area from register total', () => {
    expect(byName.leasableAreaSqft.derived).toBe(100000);
    expect(byName.leasableAreaSqft.note).toMatch(/Register total/);
  });

  test('base rent is GROSS weighted in-place: (4.0M+2.2M)/60,000 = 103.33', () => {
    // JDA note: the register never pre-nets — the kernel's structure
    // transform applies (1 − landowner share) downstream.
    expect(byName.baseRentPerSqftMonth.derived).toBeCloseTo(103.33, 2);
    expect(byName.baseRentPerSqftMonth.note).toMatch(/gross/i);
  });

  test('vacancy = 100 − committed occupancy: 100 − 60% = 40%', () => {
    expect(byName.vacancyPct.derived).toBeCloseTo(40, 6);
  });

  test('escalation rent-weighted annualized: only L1 → 5% pa', () => {
    expect(byName.rentEscalationPct.derived).toBeCloseTo(5, 6);
  });

  test('opex = all owner opex ÷ EGR basis: 3.6M / 74.4M = 4.84% (no LOI here)', () => {
    expect(byName.opexPct.derived).toBeCloseTo(4.84, 2);
  });

  test('retail seeds the EX-ANCHOR rate — the kernel blends the anchor discount itself', () => {
    const retailRecords = [
      {
        id: 1, status: 'occupied', rent_basis: 'per_sqft_month',
        chargeable_area_sqft: 40000, base_rent_rate: 96,
        attributes: { anchor_inline: 'Anchor' },
      },
      {
        id: 2, status: 'occupied', rent_basis: 'per_sqft_month',
        chargeable_area_sqft: 60000, base_rent_rate: 120,
        attributes: { anchor_inline: 'Inline' },
      },
    ];
    const r = backend.buildRegisterPrefill({
      records: retailRecords, register: { settings: {} }, assetClass: 'retail',
    });
    const rent = r.fields.find((f) => f.name === 'baseRentPerSqftMonth');
    // Blended would be (3.84M+7.2M)/100k = 110.4 — seeding that would get the
    // ~0.92 blendedFactor applied AGAIN by the kernel. Inline-only is 120.
    expect(rent.derived).toBeCloseTo(120, 6);
    expect(rent.note).toMatch(/Inline \(non-anchor\)/);
    // Office keeps the blended figure (no anchor concept in that model).
    const office = backend.buildRegisterPrefill({
      records: retailRecords, register: { settings: {} }, assetClass: 'commercial_office',
    });
    expect(office.fields.find((f) => f.name === 'baseRentPerSqftMonth').derived)
      .toBeCloseTo(110.4, 6);
  });

  test('retail with ONLY anchor rows omits the rent field (inline rate underivable)', () => {
    const r = backend.buildRegisterPrefill({
      records: [{
        id: 1, status: 'occupied', rent_basis: 'per_sqft_month',
        chargeable_area_sqft: 40000, base_rent_rate: 96,
        attributes: { anchor_inline: 'Anchor' },
      }],
      register: { settings: {} },
      assetClass: 'retail',
    });
    expect(r.fields.map((f) => f.name)).not.toContain('baseRentPerSqftMonth');
  });

  test('classes without a bridge yet are honestly unsupported', () => {
    for (const cls of ['residential_apartments', 'villas', 'mixed_use', 'redevelopment']) {
      const r = backend.buildRegisterPrefill({ records: { lease: RECORDS }, register: REGISTER, assetClass: cls });
      expect(r.supported).toBe(false);
      expect(r.reason).toMatch(/does not have a register/);
    }
  });

  test('underivable fields are omitted, never proposed as zero', () => {
    const bare = backend.buildRegisterPrefill({
      records: [{ id: 9, status: 'occupied', rent_basis: 'per_sqft_month', chargeable_area_sqft: 1000, base_rent_rate: 50 }],
      register: { settings: {} },
      assetClass: 'retail',
    });
    const names = bare.fields.map((f) => f.name);
    expect(names).not.toContain('rentEscalationPct'); // no escalation recorded
    expect(names).not.toContain('opexPct');           // no opex recorded
    expect(names).toContain('baseRentPerSqftMonth');
  });

  test('provenance carries counts + as-of + metrics version', () => {
    expect(result.provenance).toMatchObject({
      source: 'rent_roll',
      basisCount: 2,
      basisNoun: 'lease',
      totalRecords: 3,
      asOfDate: '2026-07-14',
    });
    expect(result.provenance.metricsVersion).toBeTruthy();
  });
});

describe('rentRollPrefill — plotted (sales_collections) bridge', () => {
  const SALE_RECORDS = {
    sale: [
      { id: 1, status: 'sold', area_sqft: 1500, base_price_per_sqft: 7200, agreement_value: 11500000, amount_collected: 9500000 },
      { id: 2, status: 'booked', area_sqft: 2400, base_price_per_sqft: 7600, other_charges_amount: 950000, amount_collected: 6000000 },
      { id: 3, status: 'unsold', area_sqft: 1200, base_price_per_sqft: 6900, current_market_rate: 8000 },
    ],
  };
  const PARENT = { as_of_date: '2026-07-14', settings: {} };

  const result = backend.buildRegisterPrefill({
    records: SALE_RECORDS, register: PARENT, assetClass: 'plotted_development',
  });
  const byName = Object.fromEntries(result.fields.map((f) => [f.name, f]));

  test('parity: frontend agrees on the plotted proposal', () => {
    expect(frontend.buildRegisterPrefill({
      records: SALE_RECORDS, register: PARENT, assetClass: 'plotted_development',
    })).toEqual(result);
  });

  test('seeds selling rate (weighted sold base rate) + avg plot size only', () => {
    expect(result.supported).toBe(true);
    expect(result.fields.map((f) => f.name).sort()).toEqual(['avgPlotSizeSqft', 'sellingRatePerSqft']);
    // (7200×1500 + 7600×2400) / 3900 = 7446.15 → rounded to whole ₹
    expect(byName.sellingRatePerSqft.derived).toBe(7446);
    expect(byName.sellingRatePerSqft.note).toMatch(/base list rate/i);
    // mean of 1500 & 2400
    expect(byName.avgPlotSizeSqft.derived).toBe(1950);
  });

  test('provenance uses the sold-unit basis', () => {
    expect(result.provenance).toMatchObject({ source: 'rent_roll', basisCount: 2, basisNoun: 'sold unit' });
  });

  test('never seeds project land area from summed plot areas', () => {
    expect(result.fields.map((f) => f.name)).not.toContain('totalLandSqft');
    expect(result.fields.map((f) => f.name)).not.toContain('saleableLandPct');
  });
});

describe('rentRollPrefill — hospitality (hotel_operating) bridge', () => {
  const HOTEL_RECORDS = {
    hotel_key_block: [{ id: 1, keys_count: 100, operational: true, ooo_pct: 0 }],
    hotel_operating_month: [
      { id: 100, month: '2026-06-01', occupancy_pct: 60, adr: 6000, room_revenue: 10800000, fnb_revenue: 2700000, other_revenue: 1080000, gop: 5000000 },
      { id: 101, month: '2026-07-01', occupancy_pct: 80, adr: 6000, room_revenue: 14880000, fnb_revenue: 3720000, other_revenue: 1488000, gop: 8000000 },
    ],
  };
  const PARENT = { as_of_date: '2026-07-31', settings: {} };
  const result = backend.buildRegisterPrefill({ records: HOTEL_RECORDS, register: PARENT, assetClass: 'hospitality' });
  const byName = Object.fromEntries(result.fields.map((f) => [f.name, f]));

  test('parity: frontend agrees on the hotel proposal', () => {
    expect(frontend.buildRegisterPrefill({ records: HOTEL_RECORDS, register: PARENT, assetClass: 'hospitality' }))
      .toEqual(result);
  });

  test('seeds keys + ADR + occupancy + margins from TTM actuals', () => {
    expect(result.supported).toBe(true);
    expect(byName.keys.derived).toBe(100);             // available keys
    expect(byName.adr.derived).toBe(6000);             // room-revenue weighted
    expect(byName.stabilizedOccPct.derived).toBeCloseTo(70.2, 1); // 4280/6100
    expect(byName.gopMarginPct.derived).toBeCloseTo(37.5, 1);     // 13M/34.668M
    expect(byName.fbRevPct.derived).toBe(25);
    expect(byName.otherRevPct.derived).toBe(10);
    expect(byName.adr.note).toMatch(/room-night weighted/);
  });

  test('provenance uses the operating-month basis', () => {
    expect(result.provenance).toMatchObject({ source: 'rent_roll', basisCount: 2, basisNoun: 'operating month' });
  });

  test('keys omitted when no inventory recorded (never seeds a guess)', () => {
    const noKeys = backend.buildRegisterPrefill({
      records: { hotel_operating_month: HOTEL_RECORDS.hotel_operating_month },
      register: PARENT, assetClass: 'hospitality',
    });
    expect(noKeys.fields.map((f) => f.name)).not.toContain('keys');
    // ADR/occupancy still derive from the stored-average fallback.
    expect(noKeys.fields.map((f) => f.name)).toContain('adr');
  });

  test('keys seed from OPERATIONAL inventory, not the OOO-adjusted available count', () => {
    const withOoo = backend.buildRegisterPrefill({
      records: {
        hotel_key_block: [{ id: 1, keys_count: 100, operational: true, ooo_pct: 5 }],
        hotel_operating_month: HOTEL_RECORDS.hotel_operating_month,
      },
      register: PARENT, assetClass: 'hospitality',
    });
    const keys = withOoo.fields.find((f) => f.name === 'keys');
    // availableKeys would be 95; the permanent operating inventory is 100.
    expect(keys.derived).toBe(100);
    expect(keys.note).toMatch(/temporary haircut/i);
  });
});

describe('reconcileRentRollProvenance — citation lifecycle', () => {
  const { reconcileRentRollProvenance } = backend;
  const PROV = {
    snapshotId: 5,
    dataHash: 'h1',
    acceptedFields: [
      { name: 'baseRentPerSqftMonth', value: 103.33 },
      { name: 'vacancyPct', value: 40 },
    ],
  };

  test('a seeded Calculate always cites its incoming provenance', () => {
    expect(reconcileRentRollProvenance(null, PROV, {})).toBe(PROV);
    expect(reconcileRentRollProvenance({ snapshotId: 1 }, PROV, {})).toBe(PROV);
  });

  test('a manual recalc carries the citation while accepted values hold', () => {
    const inputs = { baseRentPerSqftMonth: 103.33, vacancyPct: 40, opexPct: 22 };
    expect(reconcileRentRollProvenance(PROV, null, inputs)).toBe(PROV);
    // Display-rounding wobble within tolerance still counts as holding.
    expect(reconcileRentRollProvenance(PROV, null, { ...inputs, baseRentPerSqftMonth: 103.3 })).toBe(PROV);
  });

  test('hand-editing a seeded assumption drops the citation', () => {
    const inputs = { baseRentPerSqftMonth: 150, vacancyPct: 40 };
    expect(reconcileRentRollProvenance(PROV, null, inputs)).toBeNull();
  });

  test('missing inputs or empty acceptance never dangle a citation', () => {
    expect(reconcileRentRollProvenance(PROV, null, {})).toBeNull();
    expect(reconcileRentRollProvenance({ snapshotId: 9, acceptedFields: [] }, null, { a: 1 })).toBeNull();
    expect(reconcileRentRollProvenance(null, null, { a: 1 })).toBeNull();
  });

  test('parity: frontend mirror agrees', () => {
    const inputs = { baseRentPerSqftMonth: 103.33, vacancyPct: 40 };
    expect(frontend.reconcileRentRollProvenance(PROV, null, inputs))
      .toEqual(backend.reconcileRentRollProvenance(PROV, null, inputs));
    expect(frontend.reconcileRentRollProvenance(PROV, null, { baseRentPerSqftMonth: 1 }))
      .toEqual(backend.reconcileRentRollProvenance(PROV, null, { baseRentPerSqftMonth: 1 }));
  });
});
