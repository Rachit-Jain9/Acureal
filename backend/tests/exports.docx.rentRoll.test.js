'use strict';

// Deal Register section in the DOCX underwriting report (rent-roll program, PR-10).
// Builds a real report with a register slice per family and asserts the section
// renders real records + committed metrics — and that the deleted synthetic
// tenants never appear. Deterministic; no AI prose in the section.

const JSZip = require('jszip');
const { buildDealReportDocx, __internal } = require('../src/services/exports/docx/buildReport');
const {
  computeLeaseMetrics, computeSaleMetrics, computeHotelMetrics, computeOccupantMetrics, METRICS_VERSION,
} = require('../src/utils/rentRollMetrics');

const extractText = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  return xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
};

const baseCtx = () => ({
  deal: { id: 1, name: 'Register DOCX Deal', asset_class: 'commercial_office', deal_type: 'jv', stage: 'underwriting', city: 'Bengaluru', state: 'Karnataka' },
  property: { property_name: 'Register DOCX Deal', city: 'Bengaluru', micro_market: 'Whitefield', land_area_sqft: 200000, saleable_area_sqft: 300000, existing_fsi: 2 },
});

const slice = (family, records, metrics, asOf = '2026-07-14') => ({
  family, asOfDate: asOf, totalLeasableAreaSqft: 100000, settings: {},
  records, metrics, warnings: [], dataHash: 'c'.repeat(64), metricsVersion: METRICS_VERSION, updatedAt: `${asOf}T00:00:00Z`,
});

const LEASE_PARENT = { as_of_date: '2026-07-14', total_leasable_area_sqft: 100000, settings: {} };
const LEASE_RECORDS = [
  { id: 1, status: 'occupied', tenant_name: 'Anchor Tech Ltd', record_label: 'A-101', rent_basis: 'per_sqft_month', chargeable_area_sqft: 40000, base_rent_rate: 100, cam_rate: 20, cam_treatment: 'recovery', lease_expiry: '2031-03-31', lockin_end: '2029-03-31', market_rent_rate: 120, owner_opex_annual: 2400000, collection_pct: 98 },
  { id: 2, status: 'committed', tenant_name: 'Mid Corp', record_label: 'A-201', rent_basis: 'per_sqft_month', chargeable_area_sqft: 20000, base_rent_rate: 110, cam_treatment: 'owner_borne', lease_expiry: '2033-06-30', market_rent_rate: 115, owner_opex_annual: 1200000, collection_pct: 100 },
  { id: 3, status: 'vacant', record_label: 'A-301', rent_basis: 'per_sqft_month', chargeable_area_sqft: 25000, market_rent_rate: 125 },
];

const SALE_RECORDS = [
  { id: 1, status: 'sold', record_label: 'PLOT-7', block_phase: 'Phase 1', area_sqft: 1500, base_price_per_sqft: 7200, agreement_value: 11500000, amount_collected: 9500000 },
  { id: 2, status: 'unsold', record_label: 'PLOT-8', area_sqft: 1200, base_price_per_sqft: 6900, current_market_rate: 8000 },
];

const HOTEL_RECORDS = {
  hotel_key_block: [{ id: 1, room_type: 'Deluxe King', keys_count: 100, operational: true, ooo_pct: 0 }],
  hotel_contract: [{ id: 10, record_label: 'HMA-001', operator_name: 'Marriott', brand: 'Courtyard', contract_type: 'hma', base_fee_pct: 3, keys_covered: 100 }],
  hotel_operating_month: [
    { id: 100, month: '2026-06-01', occupancy_pct: 60, adr: 6000, room_revenue: 10800000, fnb_revenue: 2700000, other_revenue: 1080000, gop: 5000000, owner_noi: 3500000 },
    { id: 101, month: '2026-07-01', occupancy_pct: 80, adr: 6000, room_revenue: 14880000, fnb_revenue: 3720000, other_revenue: 1488000, gop: 8000000, owner_noi: 5000000 },
  ],
};

const OCC_RECORDS = {
  occupant: [
    { id: 1, record_label: 'Flat 101', occupant_name: 'Owner One', status: 'vacated', existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600, transit_rent_monthly: 30000, transit_rent_start: '2026-07-14', transit_rent_end: '2027-07-14', corpus_amount: 100000, documentation_risk: 'low' },
    { id: 2, record_label: 'Shop 2', occupant_name: 'Tenant Two', status: 'in_place', existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600, documentation_risk: 'high' },
  ],
  sale: [{ id: 5, status: 'sold', record_label: 'FS-1', area_sqft: 1000, base_price_per_sqft: 9000, agreement_value: 9000000, amount_collected: 4000000 }],
};

describe('DOCX Deal Register section', () => {
  test('lease register renders real tenants, committed metrics, and no synthetic rows', async () => {
    const ctx = { ...baseCtx(), rentRoll: slice('lease_income', { lease: LEASE_RECORDS }, computeLeaseMetrics(LEASE_RECORDS, LEASE_PARENT)) };
    const text = await extractText(await buildDealReportDocx(ctx));
    expect(text).toContain('Deal Register');
    expect(text).toContain('RENT ROLL · AS OF');
    expect(text).toContain('Anchor Tech Ltd');
    expect(text).toContain('Committed occupancy');
    expect(text).toContain('Accrual NOI');
    // The deleted orphan seeded these — must never appear.
    expect(text).not.toContain('Primary tenant');
    expect(text).not.toContain('Mid-size tenant');
  });

  test('sales register renders inventory + collections', async () => {
    const ctx = { ...baseCtx(), rentRoll: slice('sales_collections', { sale: SALE_RECORDS }, computeSaleMetrics(SALE_RECORDS, { as_of_date: '2026-07-14', settings: {} })) };
    const text = await extractText(await buildDealReportDocx(ctx));
    expect(text).toContain('SALES & COLLECTIONS · AS OF');
    expect(text).toContain('PLOT-7');
    expect(text).toContain('Sold GDV');
    expect(text).toContain('Collection efficiency');
  });

  test('hotel register renders keys, contract and TTM operating metrics', async () => {
    const ctx = { ...baseCtx(), rentRoll: slice('hotel_operating', HOTEL_RECORDS, computeHotelMetrics(HOTEL_RECORDS, { as_of_date: '2026-07-31', settings: {} }), '2026-07-31') };
    const text = await extractText(await buildDealReportDocx(ctx));
    expect(text).toContain('OPERATING ROLL · AS OF');
    expect(text).toContain('Governing contract');
    expect(text).toContain('HMA · Marriott');
    expect(text).toContain('TTM occupancy');
    expect(text).toContain('OPERATING HISTORY');
  });

  test('redevelopment register renders occupants, rehousing obligations, and free-sale line', async () => {
    const occ = computeOccupantMetrics(OCC_RECORDS.occupant, { as_of_date: '2026-07-14', settings: {} });
    const sale = computeSaleMetrics(OCC_RECORDS.sale, { as_of_date: '2026-07-14', settings: {} });
    const ctx = { ...baseCtx(), rentRoll: slice('redevelopment', OCC_RECORDS, { occupant: occ, sale }) };
    const text = await extractText(await buildDealReportDocx(ctx));
    expect(text).toContain('OCCUPANTS & SALES · AS OF');
    expect(text).toContain('Flat 101');
    expect(text).toContain('Total rehousing obligation');
    expect(text).toContain('Free sale:');
  });

  test('a deal with no register renders an honest empty-state (never fabricates data)', async () => {
    const text = await extractText(await buildDealReportDocx(baseCtx()));
    expect(text).toContain('Deal Register');
    expect(text).toContain('No register has been created for this deal yet');
    expect(text).not.toContain('Primary tenant');
  });
});
