'use strict';

// Deal Register slide in the PPTX deck (rent-roll program, PR-10).
// Asserts the manifest gates the slide on a real register, the family-adaptive
// title, and that the slide renders in the full deck without throwing.

const { execFileSync } = require('child_process');
const { __testables } = require('../src/services/dealPptx.service');
const {
  computeLeaseMetrics, computeOccupantMetrics, computeSaleMetrics, METRICS_VERSION,
} = require('../src/utils/rentRollMetrics');

const baseExportContext = (assetClass = 'redevelopment') => ({
  deal: { id: 1, name: 'Register Deck Deal', asset_class: assetClass, deal_type: 'jv', stage: 'underwriting', city: 'Bengaluru', state: 'Karnataka' },
  property: { property_name: 'Register Deck Deal', city: 'Bengaluru', micro_market: 'Whitefield', land_area_sqft: 200000, saleable_area_sqft: 300000, existing_fsi: 2 },
});

const slice = (family, records, metrics, asOf = '2026-07-14') => ({
  family, asOfDate: asOf, totalLeasableAreaSqft: 100000, settings: {},
  records, metrics, warnings: [], dataHash: 'd'.repeat(64), metricsVersion: METRICS_VERSION, updatedAt: `${asOf}T00:00:00Z`,
});

const OCC_RECORDS = {
  occupant: [
    { id: 1, record_label: 'Flat 101', occupant_name: 'Owner One', status: 'vacated', existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600, transit_rent_monthly: 30000, transit_rent_start: '2026-07-14', transit_rent_end: '2027-07-14', corpus_amount: 100000, documentation_risk: 'low' },
    { id: 2, record_label: 'Shop 2', occupant_name: 'Tenant Two', status: 'in_place', existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600, documentation_risk: 'high' },
  ],
  sale: [{ id: 5, status: 'sold', record_label: 'FS-1', area_sqft: 1000, base_price_per_sqft: 9000, agreement_value: 9000000, amount_collected: 4000000 }],
};
const LEASE_RECORDS = [
  { id: 1, status: 'occupied', tenant_name: 'Anchor Tech Ltd', record_label: 'A-101', rent_basis: 'per_sqft_month', chargeable_area_sqft: 40000, base_rent_rate: 100, lease_expiry: '2031-03-31', market_rent_rate: 120, owner_opex_annual: 2400000 },
];

const redevSlice = () => slice('redevelopment', OCC_RECORDS, {
  occupant: computeOccupantMetrics(OCC_RECORDS.occupant, { as_of_date: '2026-07-14', settings: {} }),
  sale: computeSaleMetrics(OCC_RECORDS.sale, { as_of_date: '2026-07-14', settings: {} }),
});

describe('PPTX deck — Deal Register slide', () => {
  test('manifest gates the register slide on a real register, with the family title', () => {
    const context = __testables.buildDeckContext(
      { ...baseExportContext('redevelopment'), rentRoll: redevSlice() },
      { brandName: 'REDIP', generatedAt: '2026-07-14T00:00:00Z' },
    );
    expect(context.hasRentRoll).toBe(true);
    expect(context.rentRollTitle).toBe('Occupants & Sales');
    expect(context.slideManifest.map((s) => s.title)).toContain('Occupants & Sales');
    expect(context.slideManifest.map((s) => s.key)).toContain('rentRoll');
  });

  test('family-adaptive title (lease → Rent Roll)', () => {
    const context = __testables.buildDeckContext(
      { ...baseExportContext('commercial_office'), rentRoll: slice('lease_income', { lease: LEASE_RECORDS }, computeLeaseMetrics(LEASE_RECORDS, { as_of_date: '2026-07-14', total_leasable_area_sqft: 100000, settings: {} })) },
      { brandName: 'REDIP', generatedAt: '2026-07-14T00:00:00Z' },
    );
    expect(context.rentRollTitle).toBe('Rent Roll');
    expect(context.slideManifest.map((s) => s.title)).toContain('Rent Roll');
  });

  test('no register → no register slide', () => {
    const context = __testables.buildDeckContext(baseExportContext('redevelopment'), { brandName: 'REDIP', generatedAt: '2026-07-14T00:00:00Z' });
    expect(context.hasRentRoll).toBe(false);
    expect(context.slideManifest.map((s) => s.key)).not.toContain('rentRoll');
  });

  test('empty register (family but zero records) → no register slide', () => {
    const context = __testables.buildDeckContext(
      { ...baseExportContext('redevelopment'), rentRoll: slice('redevelopment', { occupant: [], sale: [] }, { occupant: {}, sale: {} }) },
      { brandName: 'REDIP', generatedAt: '2026-07-14T00:00:00Z' },
    );
    expect(context.hasRentRoll).toBe(false);
    expect(context.slideManifest.map((s) => s.key)).not.toContain('rentRoll');
  });

  test('the register slide renders in the full deck without throwing (valid PK zip)', () => {
    const exportContext = { ...baseExportContext('redevelopment'), rentRoll: redevSlice() };
    const script = `
      const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
      const exportContext = ${JSON.stringify(exportContext)};
      (async () => {
        const buffer = await buildDealDeckPptx(exportContext, { brandName: 'REDIP', userName: 'Test', generatedAt: '2026-07-14T00:00:00Z' });
        process.stdout.write(JSON.stringify({ isBuffer: Buffer.isBuffer(buffer), signature: buffer.slice(0, 2).toString('utf8'), length: buffer.length }));
      })().catch((e) => { console.error(e); process.exit(1); });
    `;
    const output = execFileSync(process.execPath, ['-e', script], { cwd: require('path').resolve(__dirname, '..'), encoding: 'utf8' });
    const result = JSON.parse(output);
    expect(result.isBuffer).toBe(true);
    expect(result.signature).toBe('PK');
    expect(result.length).toBeGreaterThan(1000);
  });
});
