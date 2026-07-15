'use strict';

// Parity guard: backend and frontend each ship a copy of rentRollMetrics.js
// (CommonJS for backend, ESM for the SPA). The two are read by different
// runtimes so we can't import from one place — but they MUST stay identical.
// This test reads the frontend file as text, strips the ESM `export ` keywords,
// evals it under a CommonJS shim, and runs both implementations through the
// same fixtures. Any divergence fails the build.
// (Same pattern as parcelBuildability.parity.test.js.)

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/utils/rentRollMetrics');

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'rentRollMetrics.js'),
  'utf8',
);

const exportNames = [];
const stripped = frontendSrc.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
  exportNames.push(name);
  return `${kind} ${name}`;
});
const cjsSource = `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`;

const m = new Module('frontend-rentRollMetrics');
m._compile(cjsSource, 'frontend/src/utils/rentRollMetrics.js');
const frontend = m.exports;

const AS_OF = '2026-07-14';
const PARENT = { as_of_date: AS_OF, total_leasable_area_sqft: 100000, settings: {} };
const FIXTURE = [
  {
    id: 1, status: 'occupied', tenant_name: 'Anchor Tech Ltd', rent_basis: 'per_sqft_month',
    chargeable_area_sqft: 40000, base_rent_rate: 100, cam_rate: 20, cam_treatment: 'recovery',
    escalation_pct: 15, escalation_every_months: 36,
    lease_start: '2024-01-01', rent_commencement: '2024-04-01',
    lease_expiry: '2031-03-31', lockin_end: '2029-03-31',
    market_rent_rate: 120, owner_opex_annual: 2400000, collection_pct: 98,
    deposit_months: 6, security_deposit_amount: 26000000,
  },
  {
    id: 2, status: 'committed', tenant_name: 'Mid Corp', rent_basis: 'per_sqft_month',
    chargeable_area_sqft: 20000, base_rent_rate: 110, cam_treatment: 'owner_borne',
    lease_expiry: '2033-06-30', market_rent_rate: 115, owner_opex_annual: 1200000,
    collection_pct: 100, deposit_months: 6,
  },
  { id: 3, status: 'vacant', rent_basis: 'per_sqft_month', chargeable_area_sqft: 25000, base_rent_rate: 120, market_rent_rate: 125 },
  { id: 4, status: 'loi', tenant_name: 'LOI Retail', rent_basis: 'per_sqft_month', chargeable_area_sqft: 10000, base_rent_rate: 105, lease_expiry: '2029-12-31' },
  { id: 5, status: 'occupied', tenant_name: 'Small Co', rent_basis: 'per_sqft_month', chargeable_area_sqft: 5000, base_rent_rate: 90, market_rent_rate: 100 },
];

describe('rentRollMetrics backend ↔ frontend parity', () => {
  test('the frontend mirror is pure ESM (no CommonJS artifact that would crash the browser)', () => {
    // A stray `module.exports` / `require` / bare `module` survives bundling
    // (valid syntax) but throws "module is not defined" when the browser
    // evaluates the ES module. Reject it at the source-text level; the live
    // import in frontend/src/utils/__tests__/rentRollMetrics.test.js is the
    // second line of defence.
    expect(frontendSrc).not.toMatch(/\bmodule\.exports\b/);
    expect(frontendSrc).not.toMatch(/\brequire\s*\(/);
    expect(frontendSrc).not.toMatch(/^\s*module\b/m);
    expect(frontendSrc).not.toMatch(/\b(process|__dirname|__filename)\b/);
  });

  test('both sides export the same API surface', () => {
    expect(Object.keys(frontend).sort()).toEqual(Object.keys(backend).sort());
  });

  test('METRICS_VERSION matches', () => {
    expect(frontend.METRICS_VERSION).toBe(backend.METRICS_VERSION);
  });

  test('computeLeaseMetrics is identical on the golden fixture', () => {
    const b = backend.computeLeaseMetrics(FIXTURE, PARENT);
    const f = frontend.computeLeaseMetrics(FIXTURE, PARENT);
    expect(f).toEqual(b);
  });

  test('validateLeaseRoll is identical (incl. model-drift finding)', () => {
    const inputs = { baseRentPerSqftMonth: 80 };
    expect(frontend.validateLeaseRoll(FIXTURE, PARENT, inputs))
      .toEqual(backend.validateLeaseRoll(FIXTURE, PARENT, inputs));
  });

  test('computeOccupantMetrics + validateOccupantRoll are identical on a redevelopment fixture', () => {
    const occ = [
      {
        id: 1, status: 'vacated', existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600,
        additional_area_sqft: 50, transit_rent_monthly: 30000, transit_rent_start: '2025-07-01',
        transit_rent_end: '2027-07-01', transit_rent_escalation_pct: 5,
        corpus_amount: 100000, shifting_allowance: 20000, brokerage_amount: 30000, documentation_risk: 'low',
      },
      {
        // In-place, escalating, NO transit_start — exercises the projected-
        // vacation escalation anchor on both mirrors.
        id: 2, status: 'in_place', existing_carpet_area_sqft: 300, rehab_entitlement_sqft: 300,
        transit_rent_monthly: 40000, transit_rent_escalation_pct: 8,
        rehab_possession_target: '2029-07-14', documentation_risk: 'high',
      },
      { id: 3, status: 'disputed', existing_carpet_area_sqft: 450, rehab_entitlement_sqft: 400 },
    ];
    const parent = { as_of_date: AS_OF, settings: {} };
    expect(frontend.computeOccupantMetrics(occ, parent)).toEqual(backend.computeOccupantMetrics(occ, parent));
    expect(frontend.validateOccupantRoll(occ)).toEqual(backend.validateOccupantRoll(occ));
    expect(frontend.transitRentRemainingPaise(occ[0], frontend.parseDate(AS_OF)))
      .toBe(backend.transitRentRemainingPaise(occ[0], backend.parseDate(AS_OF)));
  });

  test('per-record functions are identical', () => {
    const lease = FIXTURE[0];
    expect(frontend.effectiveRentRate({
      base_rent_rate: 100, rent_commencement: '2025-01-01', lease_expiry: '2028-01-01',
      escalation_pct: 10, escalation_every_months: 12, rent_free_months: 3,
    })).toBe(backend.effectiveRentRate({
      base_rent_rate: 100, rent_commencement: '2025-01-01', lease_expiry: '2028-01-01',
      escalation_pct: 10, escalation_every_months: 12, rent_free_months: 3,
    }));
    expect(frontend.securityDeposit(lease)).toEqual(backend.securityDeposit(lease));
    expect(frontend.nextEscalation(lease, backend.parseDate(AS_OF)))
      .toEqual(backend.nextEscalation(lease, frontend.parseDate(AS_OF)));
    expect(frontend.fyLabel(frontend.parseDate('2027-04-01')))
      .toBe(backend.fyLabel(backend.parseDate('2027-04-01')));
    expect(frontend.toLeaseExtract(FIXTURE, { asOf: AS_OF }))
      .toEqual(backend.toLeaseExtract(FIXTURE, { asOf: AS_OF }));
  });
});
