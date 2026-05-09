'use strict';

// Pure smoke + helpers test for the deal tear-sheet PDF builder.
//
// We mock the upstream context loader so the service can be exercised
// without a database. The PDF itself is binary, so we assert on (a)
// it parses as a valid PDF, (b) it has the expected page count, and
// (c) it carries the deal name in the file name. Layout regressions
// are caught visually downstream — pdf-lib's text rendering is well-
// covered by upstream tests.

jest.mock('../src/services/dealExport.service', () => ({
  getDealExportContext: jest.fn(),
}));

jest.mock('../src/services/aiArtifacts.service', () => ({
  getLatestArtifact: jest.fn(),
}));

const { getDealExportContext } = require('../src/services/dealExport.service');
const aiArtifacts = require('../src/services/aiArtifacts.service');
const tearSheet = require('../src/services/dealTearSheet.service');

beforeEach(() => {
  jest.clearAllMocks();
});

const makeContext = (overrides = {}) => ({
  deal: {
    name: 'Whitefield Plot 22',
    stage: 'underwriting',
    priority: 'high',
    asset_class: 'residential_apartments',
    deal_type: 'land_purchase',
    deal_structure: 'outright',
    rera_number: 'PR/KA/RERA/1234/2026',
    property_name: 'Whitefield Plot 22',
    property_address: '22 Whitefield Main Rd',
    city: 'Bengaluru',
    state: 'Karnataka',
    land_area_sqft: 130680, // 3 acres
    land_area_acres: 3,
    zoning: 'Residential (Main)',
    permissible_fsi: '2.5',
    owner_name: 'Acme Holdings Pvt Ltd',
    survey_number: '22/4',
    encumbrance_status: 'clean',
    land_ask_price_cr: 12.5,
    negotiated_price_cr: 11.8,
    land_cost_cr: 11.8,
    construction_cost_cr: 28.0,
    total_cost_cr: 42.5,
    total_revenue_cr: 75.0,
    gross_profit_cr: 32.5,
    gross_margin_pct: 43.3,
    irr_pct: 22.4,
    npv_cr: 14.5,
    equity_multiple: 1.85,
    residual_land_value_cr: 13.2,
    saleable_area_sqft: 240000,
    discount_rate_pct: 14,
  },
  dd: { summary: { completion_pct: 65, total_required: 20, completed_required: 13, open_deal_breakers: 0 }, items: [] },
  risks: {
    summary: { critical: 1, high: 2, medium: 1, low: 0 },
    items: [
      { title: 'EC mismatch with sale deed seller name', severity: 'critical', category: 'legal_title', status: 'open' },
      { title: 'BBMP plan sanction expiring in 60 days',  severity: 'high',     category: 'regulatory',  status: 'flagged' },
      { title: 'Master plan zone draft only',              severity: 'medium',   category: 'regulatory',  status: 'open' },
    ],
    recommendation: { recommendation: 'pursue_with_caution' },
  },
  market: {
    exportComps: [
      { project_name: 'Comp A', locality: 'Whitefield', rate_per_sqft: 9200, source: 'broker', is_verified: true },
      { project_name: 'Comp B', locality: 'KR Puram', rate_per_sqft: 8500, source: 'listing', is_verified: false },
    ],
    benchmarks: { median_rate_per_sqft: 8800, count: 2 },
  },
  approvals: { summary: { required: 5, validated: 3 }, items: [] },
  readiness: { label: 'IC ready' },
  ...overrides,
});

const parsePdfHeader = (buffer) => buffer.slice(0, 5).toString('ascii');

const countPagesInPdf = async (buffer) => {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
};

describe('dealTearSheet.buildDealTearSheet', () => {
  test('produces a valid 2-page PDF for a fully-populated deal', async () => {
    getDealExportContext.mockResolvedValueOnce(makeContext());
    aiArtifacts.getLatestArtifact.mockResolvedValue({
      content_md: '# IC Memo\n\nWhitefield Plot 22 has clean title verified through extracted EC.\n\nIRR is 22.4% on the base case.',
      generated_at: '2026-05-08T10:00:00Z',
    });

    const result = await tearSheet.buildDealTearSheet({
      dealId: 'deal-uuid-1',
      generatedBy: 'analyst@redip.test',
    });

    expect(result.bytes).toBeInstanceOf(Buffer);
    expect(result.bytes.length).toBeGreaterThan(2000);
    expect(parsePdfHeader(result.bytes)).toBe('%PDF-');
    expect(await countPagesInPdf(result.bytes)).toBe(2);
    expect(result.fileName).toMatch(/whitefield_plot_22-tear-sheet-\d{4}-\d{2}-\d{2}\.pdf/i);
    expect(result.dealName).toBe('Whitefield Plot 22');
  });

  test('still produces a 2-page PDF when no AI artifacts exist', async () => {
    getDealExportContext.mockResolvedValueOnce(makeContext());
    aiArtifacts.getLatestArtifact.mockResolvedValue(null);

    const { bytes } = await tearSheet.buildDealTearSheet({ dealId: 'deal-uuid-2' });

    expect(parsePdfHeader(bytes)).toBe('%PDF-');
    expect(await countPagesInPdf(bytes)).toBe(2);
  });

  test('falls back to risk_brief when ic_memo is absent', async () => {
    getDealExportContext.mockResolvedValueOnce(makeContext());
    aiArtifacts.getLatestArtifact
      .mockResolvedValueOnce(null) // ic_memo
      .mockResolvedValueOnce({     // risk_brief
        content_md: '# Risk Brief\n\nThree open flags. Critical: title mismatch.',
        generated_at: '2026-05-07T10:00:00Z',
      });

    const { bytes } = await tearSheet.buildDealTearSheet({ dealId: 'deal-uuid-3' });
    expect(parsePdfHeader(bytes)).toBe('%PDF-');
  });

  test('throws 404 when deal not visible / missing', async () => {
    getDealExportContext.mockResolvedValueOnce(null);

    await expect(tearSheet.buildDealTearSheet({ dealId: 'missing' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 400 when dealId is missing', async () => {
    await expect(tearSheet.buildDealTearSheet({}))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('handles a sourcing-stage deal with mostly null financials', async () => {
    getDealExportContext.mockResolvedValueOnce(
      makeContext({
        deal: {
          ...makeContext().deal,
          stage: 'sourcing',
          irr_pct: null,
          npv_cr: null,
          equity_multiple: null,
          total_cost_cr: null,
          total_revenue_cr: null,
          gross_margin_pct: null,
          land_cost_cr: null,
          residual_land_value_cr: null,
        },
        risks: { summary: { critical: 0, high: 0, medium: 0, low: 0 }, items: [], recommendation: null },
        market: { exportComps: [], benchmarks: {} },
        dd: { summary: { completion_pct: 0, total_required: 0, completed_required: 0, open_deal_breakers: 0 } },
        approvals: { summary: { required: 0, validated: 0 } },
      }),
    );
    aiArtifacts.getLatestArtifact.mockResolvedValue(null);

    const { bytes } = await tearSheet.buildDealTearSheet({ dealId: 'deal-sourcing' });
    expect(parsePdfHeader(bytes)).toBe('%PDF-');
    expect(await countPagesInPdf(bytes)).toBe(2);
  });
});

describe('dealTearSheet._internal helpers', () => {
  const { safeText, fmtCr, fmtPct, fmtX, fmtArea, titleCase } = tearSheet._internal;

  test('safeText replaces non-printable chars + INR symbol', () => {
    expect(safeText('Hello — world ₹100')).toBe('Hello - world INR 100');
    expect(safeText(null)).toBe('-');
    expect(safeText(undefined)).toBe('-');
    expect(safeText('')).toBe('-');
  });

  test('fmtCr respects 2-decimal precision and adds INR / Cr suffix', () => {
    expect(fmtCr(12.5)).toBe('INR 12.50 Cr');
    expect(fmtCr(null)).toBe('-');
    expect(fmtCr(0)).toBe('INR 0.00 Cr');
  });

  test('fmtPct adds % and 1-decimal precision', () => {
    expect(fmtPct(22.4)).toBe('22.4%');
    expect(fmtPct(null)).toBe('-');
  });

  test('fmtX adds trailing x', () => {
    expect(fmtX(1.85)).toBe('1.85x');
    expect(fmtX(null)).toBe('-');
  });

  test('fmtArea converts sqft to acres when above 1 acre', () => {
    expect(fmtArea(43560)).toBe('1.00 ac (43,560 sqft)');
    expect(fmtArea(130680)).toBe('3.00 ac (1,30,680 sqft)');
    expect(fmtArea(15000)).toBe('15,000 sqft');
    expect(fmtArea(null)).toBe('-');
  });

  test('titleCase humanizes underscored values', () => {
    expect(titleCase('residential_apartments')).toBe('Residential Apartments');
    expect(titleCase('high')).toBe('High');
    expect(titleCase('')).toBe('');
  });
});
