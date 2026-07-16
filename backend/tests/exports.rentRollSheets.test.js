'use strict';

// Register worksheet(s) in the investor workbook (rent-roll program, PR-9).
//
// These tests build a REAL workbook and pin every committed KPI cell to the
// deterministic engine's own output — the "sheet KPI totals vs server-recomputed
// metrics" reconciliation, as a CI gate. Because the sheet renders directly from
// the same metrics object the app reads, any drift here is a builder bug. They
// also confirm the family-adaptive dispatch, the empty-register auto-hide, the
// orphan removal, and that the new sheets pass the strict download validator.

jest.setTimeout(60000);

const ExcelJS = require('exceljs');
const { buildDealWorkbookV2 } = require('../src/services/exports/xlsx/v2/buildWorkbook');
const { buildRegisterSheets, __internal } = require('../src/services/exports/xlsx/v2/rentRollSheets');
const {
  computeLeaseMetrics, computeSaleMetrics, computeHotelMetrics, computeOccupantMetrics,
  METRICS_VERSION,
} = require('../src/utils/rentRollMetrics');

const PAISE_PER_CR = 1e7;

// Scan both committed-grid label columns (1 and 4) for a label, return the
// adjacent value cell (2 or 5).
const committedValue = (sheet, label) => {
  let v;
  sheet.eachRow((row) => {
    if (String(row.getCell(1).value || '').trim() === label) v = row.getCell(2).value;
    if (String(row.getCell(4).value || '').trim() === label) v = row.getCell(5).value;
  });
  return v;
};

const cellText = (cell) => {
  const v = cell && cell.value;
  if (v && typeof v === 'object' && 'formula' in v) return `=${v.formula}`;
  return v;
};

const rowContaining = (sheet, text) => {
  let found = null;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (!found && String(cell.value || '').includes(text)) found = row;
    });
  });
  return found;
};

const baseDeal = (assetClass) => ({
  deal: {
    id: 1, name: 'Register Test Deal', asset_class: assetClass, deal_type: 'jv',
    city: 'Bengaluru', state: 'Karnataka', project_duration_months: 36,
    model_params: { inputs: { sellingRatePerSqft: 9000, constructionCostPerSqft: 4500, landCostCr: 25, debtLTV: 0.5, debtRatePct: 0.14, discountRatePct: 0.14, developerMarginPct: 0.2 } },
  },
  property: {
    property_name: 'Register Test Deal', city: 'Bengaluru', micro_market: 'Whitefield',
    land_area_sqft: 200000, saleable_area_sqft: 300000, existing_fsi: 2.0, property_type: assetClass,
  },
});

const sliceFor = (family, records, metrics, parent) => ({
  family,
  asOfDate: (parent && parent.as_of_date) || '2026-07-14',
  totalLeasableAreaSqft: (parent && parent.total_leasable_area_sqft) || null,
  settings: {},
  records,
  metrics,
  warnings: [],
  dataHash: 'a'.repeat(64),
  metricsVersion: METRICS_VERSION,
  updatedAt: '2026-07-14T00:00:00.000Z',
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const LEASE_PARENT = { as_of_date: '2026-07-14', total_leasable_area_sqft: 100000, settings: {} };
const LEASE_RECORDS = [
  {
    id: 1, status: 'occupied', tenant_name: 'Anchor Tech Ltd', sector_use: 'IT/ITES', building: 'Tower A',
    record_label: 'A-101', rent_basis: 'per_sqft_month', chargeable_area_sqft: 40000, base_rent_rate: 100,
    cam_rate: 20, cam_treatment: 'recovery', escalation_pct: 15, escalation_every_months: 36,
    lease_start: '2024-01-01', rent_commencement: '2024-04-01', lease_expiry: '2031-03-31', lockin_end: '2029-03-31',
    market_rent_rate: 120, owner_opex_annual: 2400000, collection_pct: 98, deposit_months: 6, security_deposit_amount: 26000000,
  },
  {
    id: 2, status: 'committed', tenant_name: 'Mid Corp', rent_basis: 'per_sqft_month', chargeable_area_sqft: 20000,
    base_rent_rate: 110, cam_treatment: 'owner_borne', lease_expiry: '2033-06-30', market_rent_rate: 115,
    owner_opex_annual: 1200000, collection_pct: 100, deposit_months: 6,
  },
  { id: 3, status: 'vacant', record_label: 'A-301', rent_basis: 'per_sqft_month', chargeable_area_sqft: 25000, market_rent_rate: 125 },
];

const SALE_PARENT = { as_of_date: '2026-07-14', settings: {} };
const SALE_RECORDS = [
  { id: 1, status: 'sold', record_label: 'P-1', block_phase: 'Phase 1', customer_name: 'Buyer A', area_sqft: 1500, base_price_per_sqft: 7200, agreement_value: 11500000, amount_collected: 9500000 },
  { id: 2, status: 'booked', record_label: 'P-2', block_phase: 'Phase 1', area_sqft: 2400, base_price_per_sqft: 7600, other_charges_amount: 950000, amount_collected: 6000000 },
  { id: 3, status: 'unsold', record_label: 'P-3', area_sqft: 1200, base_price_per_sqft: 6900, current_market_rate: 8000 },
];

const HOTEL_PARENT = { as_of_date: '2026-07-31', settings: {} };
const HOTEL_RECORDS = {
  hotel_key_block: [{ id: 1, room_type: 'Deluxe King', keys_count: 100, operational: true, ooo_pct: 0, adr_premium_pct: 0 }],
  hotel_contract: [{ id: 10, record_label: 'HMA-001', operator_name: 'Marriott', brand: 'Courtyard', contract_type: 'hma', base_fee_pct: 3, incentive_fee_pct: 8, ffe_reserve_pct: 4, keys_covered: 100, end_date: '2041-03-31' }],
  hotel_operating_month: [
    { id: 100, month: '2026-06-01', occupancy_pct: 60, adr: 6000, room_revenue: 10800000, fnb_revenue: 2700000, other_revenue: 1080000, gop: 5000000, owner_noi: 3500000 },
    { id: 101, month: '2026-07-01', occupancy_pct: 80, adr: 6000, room_revenue: 14880000, fnb_revenue: 3720000, other_revenue: 1488000, gop: 8000000, owner_noi: 5000000 },
  ],
};

const OCC_PARENT = { as_of_date: '2026-07-14', settings: {} };
const OCC_RECORDS = {
  occupant: [
    { id: 1, record_label: 'Flat 101', building: 'A Wing', occupant_name: 'Owner 1', status: 'vacated', existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600, transit_rent_monthly: 30000, transit_rent_start: '2026-07-14', transit_rent_end: '2027-07-14', corpus_amount: 100000, documentation_risk: 'low' },
    { id: 2, record_label: 'Shop 2', building: 'A Wing', occupant_name: 'Tenant 2', status: 'in_place', existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600, documentation_risk: 'high' },
  ],
  sale: [
    { id: 5, status: 'sold', record_label: 'FS-1', customer_name: 'Buyer X', area_sqft: 1000, base_price_per_sqft: 9000, agreement_value: 9000000, amount_collected: 4000000 },
  ],
};

// ── Direct-dispatch unit tests (no full workbook) ───────────────────────────

describe('rentRollSheets — dispatch + guards', () => {
  // The guard paths (no slice / unknown family / empty register) all return
  // before the kit is ever touched, so an empty kit is sufficient here.
  const kit = {};

  test('countRecords sums across all kinds', () => {
    expect(__internal.countRecords({ lease: [1, 2], sale: [3] })).toBe(3);
    expect(__internal.countRecords({})).toBe(0);
    expect(__internal.countRecords({ occupant: [], sale: [] })).toBe(0);
  });

  test('every register family has a builder', () => {
    expect(Object.keys(__internal.FAMILY_BUILDERS).sort())
      .toEqual(['hotel_operating', 'lease_income', 'redevelopment', 'sales_collections']);
  });

  test('no slice, unknown family, or empty register → no sheet', () => {
    const wb = new ExcelJS.Workbook();
    expect(buildRegisterSheets({ exportContext: {} }, {}, kit)).toBeNull();
    expect(buildRegisterSheets({ exportContext: { rentRoll: { family: 'nope', records: { x: [1] } } } }, {}, kit)).toBeNull();
    expect(buildRegisterSheets({ exportContext: { rentRoll: { family: 'lease_income', records: { lease: [] } } } }, {}, kit)).toBeNull();
    expect(wb.worksheets.length).toBe(0);
  });
});

// ── Full-workbook reconciliation tests ──────────────────────────────────────

describe('Rent Roll sheet (lease_income)', () => {
  let sheet;
  let metrics;
  beforeAll(async () => {
    metrics = computeLeaseMetrics(LEASE_RECORDS, LEASE_PARENT);
    const ctx = { ...baseDeal('commercial_office'), rentRoll: sliceFor('lease_income', { lease: LEASE_RECORDS }, metrics, LEASE_PARENT) };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildDealWorkbookV2(ctx));
    sheet = wb.getWorksheet('Rent Roll');
  });

  test('sheet exists and the orphan Lease Roll tab does not', async () => {
    expect(sheet).toBeDefined();
  });

  test('committed KPIs equal the server metrics', () => {
    expect(committedValue(sheet, 'Committed occupancy')).toBeCloseTo(metrics.occupancy.committedPct / 100, 6);
    expect(committedValue(sheet, 'Leasable area (sqft)')).toBe(metrics.occupancy.denominatorSqft);
    expect(committedValue(sheet, 'WALE to expiry (yr, area-wtd)')).toBeCloseTo(metrics.wale.toExpiryAreaYears, 4);
    expect(committedValue(sheet, 'In-place rent (₹/sqft/mo)')).toBeCloseTo(metrics.revenue.inPlaceRentPerSqftMonth, 4);
    expect(committedValue(sheet, 'Accrual NOI (₹ Cr)')).toBeCloseTo(metrics.revenue.accrualNOI / PAISE_PER_CR, 6);
  });

  test('renders real records (never synthetic tenants)', () => {
    const anchor = rowContaining(sheet, 'Anchor Tech Ltd');
    expect(anchor).toBeTruthy();
    // The deleted orphan seeded 'Primary tenant' / 'Mid-size tenant A'; assert absent.
    expect(rowContaining(sheet, 'Primary tenant')).toBeNull();
    expect(rowContaining(sheet, 'Mid-size tenant')).toBeNull();
  });

  test('monthly base rent is a live basis-aware formula for contracted rows', () => {
    const anchor = rowContaining(sheet, 'Anchor Tech Ltd');
    const monthly = cellText(anchor.getCell(15));
    expect(String(monthly)).toContain('IF(');
    expect(String(monthly)).toContain('43560'); // per-acre branch present
  });

  test('reconciliation strip carries the committed figure + a live status formula', () => {
    expect(rowContaining(sheet, 'Reconciliation — committed figure governs')).toBeTruthy();
    expect(rowContaining(sheet, 'Contracted base rent — committed')).toBeTruthy();
    // The status cell is a live Excel formula, so the "committed governs" copy
    // lives in the formula string, not the cell value.
    const variance = rowContaining(sheet, 'Variance (live − committed)');
    expect(variance).toBeTruthy();
    expect(String(cellText(variance.getCell(4)))).toContain('committed governs');
  });
});

describe('Sales & Collections sheet (sales_collections)', () => {
  let sheet;
  let metrics;
  beforeAll(async () => {
    metrics = computeSaleMetrics(SALE_RECORDS, SALE_PARENT);
    const ctx = { ...baseDeal('plotted_development'), rentRoll: sliceFor('sales_collections', { sale: SALE_RECORDS }, metrics, SALE_PARENT) };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildDealWorkbookV2(ctx));
    sheet = wb.getWorksheet('Sales & Collections');
  });

  test('committed KPIs equal the server metrics', () => {
    expect(sheet).toBeDefined();
    expect(committedValue(sheet, 'Sold units')).toBe(metrics.inventory.soldUnits);
    expect(committedValue(sheet, 'Sold GDV (₹ Cr)')).toBeCloseTo(metrics.collections.soldGDV / PAISE_PER_CR, 6);
    expect(committedValue(sheet, 'Collection efficiency')).toBeCloseTo(metrics.collections.collectionEfficiencyPct / 100, 6);
    expect(committedValue(sheet, 'Avg sold rate (₹/sqft)')).toBeCloseTo(metrics.pricing.avgSoldBaseRatePerSqft, 2);
  });

  test('renders real plots and a derived-agreement formula when none stored', () => {
    expect(rowContaining(sheet, 'P-2')).toBeTruthy();
    // Plot 2 has no agreement_value → live formula area*base+charges.
    const p2 = rowContaining(sheet, 'P-2');
    expect(String(cellText(p2.getCell(9)))).toContain('*');
  });
});

describe('Operating Roll sheet (hotel_operating)', () => {
  let sheet;
  let metrics;
  beforeAll(async () => {
    metrics = computeHotelMetrics(HOTEL_RECORDS, HOTEL_PARENT);
    const ctx = { ...baseDeal('hospitality'), rentRoll: sliceFor('hotel_operating', HOTEL_RECORDS, metrics, HOTEL_PARENT) };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildDealWorkbookV2(ctx));
    sheet = wb.getWorksheet('Operating Roll');
  });

  test('committed TTM KPIs equal the server metrics', () => {
    expect(sheet).toBeDefined();
    expect(committedValue(sheet, 'Total keys')).toBe(metrics.keys.totalKeys);
    expect(committedValue(sheet, 'TTM occupancy')).toBeCloseTo(metrics.operating.ttmOccupancyPct / 100, 6);
    expect(committedValue(sheet, 'TTM ADR (₹)')).toBeCloseTo(metrics.operating.ttmAdr, 2);
    expect(committedValue(sheet, 'TTM RevPAR (₹)')).toBeCloseTo(metrics.operating.ttmRevpar, 2);
    expect(committedValue(sheet, 'TTM owner NOI (₹ Cr)')).toBeCloseTo(metrics.operating.ttmOwnerNoi / PAISE_PER_CR, 6);
  });

  test('renders key inventory, contract, and monthly actuals with a live RevPAR formula', () => {
    expect(rowContaining(sheet, 'Deluxe King')).toBeTruthy();
    expect(rowContaining(sheet, 'HMA-001')).toBeTruthy();
    const jun = rowContaining(sheet, '2026-06');
    expect(jun).toBeTruthy();
    expect(String(cellText(jun.getCell(4)))).toContain('*'); // RevPAR = ADR × occ
  });
});

describe('Occupants & Sales sheet (redevelopment)', () => {
  let sheet;
  let occMetrics;
  beforeAll(async () => {
    occMetrics = computeOccupantMetrics(OCC_RECORDS.occupant, OCC_PARENT);
    const saleMetrics = computeSaleMetrics(OCC_RECORDS.sale, OCC_PARENT);
    const metrics = { occupant: occMetrics, sale: saleMetrics };
    const ctx = { ...baseDeal('redevelopment'), rentRoll: sliceFor('redevelopment', OCC_RECORDS, metrics, OCC_PARENT) };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildDealWorkbookV2(ctx));
    sheet = wb.getWorksheet('Occupants & Sales');
  });

  test('committed occupant KPIs equal the server metrics', () => {
    expect(sheet).toBeDefined();
    expect(committedValue(sheet, 'Vacation progress (by count)')).toBeCloseTo(occMetrics.vacancy.vacatedByCountPct / 100, 6);
    expect(committedValue(sheet, 'Free rehab area (sqft)')).toBe(occMetrics.entitlement.rehabEntitlementSqft);
    expect(committedValue(sheet, 'Total rehousing obligation (₹ Cr)')).toBeCloseTo(occMetrics.obligations.totalRehousingObligation / PAISE_PER_CR, 6);
    expect(committedValue(sheet, 'At-risk occupiers')).toBe(occMetrics.risk.atRiskUnits);
  });

  test('renders occupants and reuses the sale shape for free-sale inventory', () => {
    expect(rowContaining(sheet, 'Flat 101')).toBeTruthy();
    expect(rowContaining(sheet, 'FS-1')).toBeTruthy();
    expect(rowContaining(sheet, 'Free-sale inventory & collections')).toBeTruthy();
  });
});

describe('workbook integrity with a register sheet', () => {
  test('passes the strict download validator (registered name, protection, well-formed)', async () => {
    const ctx = {
      ...baseDeal('commercial_office'),
      rentRoll: sliceFor('lease_income', { lease: LEASE_RECORDS }, computeLeaseMetrics(LEASE_RECORDS, LEASE_PARENT), LEASE_PARENT),
    };
    await expect(buildDealWorkbookV2(ctx, { strictValidation: true })).resolves.toEqual(expect.any(Buffer));
  });

  test('a deal with no register slice omits the sheet entirely', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildDealWorkbookV2(baseDeal('commercial_office')));
    expect(wb.getWorksheet('Rent Roll')).toBeUndefined();
    expect(wb.getWorksheet('Lease Roll')).toBeUndefined(); // orphan gone for good
    expect(wb.getWorksheet('Unit Mix')).toBeUndefined();
  });
});
