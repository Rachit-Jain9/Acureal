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

  test('development-family classes are honestly unsupported', () => {
    for (const cls of ['residential_apartments', 'villas', 'mixed_use', 'raw_land']) {
      const r = backend.buildRegisterPrefill({ records: RECORDS, register: REGISTER, assetClass: cls });
      expect(r.supported).toBe(false);
      expect(r.reason).toMatch(/development-family/);
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
      contractedLeases: 2,
      totalRecords: 3,
      asOfDate: '2026-07-14',
    });
    expect(result.provenance.metricsVersion).toBeTruthy();
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
