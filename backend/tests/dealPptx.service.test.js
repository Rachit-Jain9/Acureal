const { execFileSync } = require('child_process');
const { __testables } = require('../src/services/dealPptx.service');

const createExportContext = () => ({
  deal: {
    id: 1,
    name: 'North Gate Logistics Park',
    property_name: 'North Gate Logistics Park',
    property_address: 'Old Madras Road, Hoskote',
    property_lat: 13.07,
    property_lng: 77.79,
    deal_type: 'acquisition',
    deal_structure: 'outright',
    asset_class: 'industrial_warehousing',
    city: 'Bengaluru',
    state: 'Karnataka',
    stage: 'underwriting',
    priority: 'high',
    owner_name: 'North Gate SPV',
    ownership_type: 'Freehold',
    land_ask_price_cr: 145,
    negotiated_price_cr: 138,
    occupancy_pct: 92,
    total_cost_cr: 158,
    total_revenue_cr: 196,
    irr_pct: 18.4,
    npv_cr: 21.2,
    equity_multiple: 1.7,
    gross_margin_pct: 19.2,
    noi_cr: 14.6,
    stabilized_noi_cr: 16.2,
    exit_value_cr: 182,
    entry_value_cr: 140,
    yield_on_cost_pct: 10.3,
    investment_thesis: 'Institutional warehousing park in an established east Bengaluru logistics corridor.',
    use_of_funds: 'Acquisition and final fit-out capex.',
    planned_exit: 'Core capital sale on stabilization.',
  },
  property: {
    property_name: 'North Gate Logistics Park',
    address: 'Old Madras Road, Hoskote',
    city: 'Bengaluru',
    micro_market: 'Hoskote',
    coordinates: { latitude: 13.07, longitude: 77.79 },
    land_area_sqft: 522720,
    land_area_acres: 12,
    built_up_area_sqft: 310000,
    saleable_area_sqft: 310000,
    super_builtup_area_sqft: 320000,
    property_type: 'industrial_warehousing',
    project_status: 'Near completion',
    ownership_type: 'Freehold',
    title_status: 'Clear and marketable',
    encumbrance_status: 'No encumbrance reported',
    existing_fsi: 1.2,
    road_width_mtrs: 24,
    setback_details: 'As per sanctioned plan',
    notes: 'Grade A warehousing park with multiple access points.',
  },
  market: {
    cityBenchmarks: [
      {
        metric_name: 'avg_land_rate_psf',
        metric_display_name: 'Avg land rate',
        value_numeric: 3200,
        unit: 'INR/sqft',
        source_name: 'Internal benchmark',
      },
      {
        metric_name: 'avg_rent_psf_month',
        metric_display_name: 'Avg rent',
        value_numeric: 29,
        unit: 'INR/sqft/month',
        source_name: 'Internal benchmark',
      },
    ],
    exportComps: [
      { project_name: 'Park A', project_type: 'Warehouse', rate_per_sqft: 31 },
      { project_name: 'Park B', project_type: 'Warehouse', rate_per_sqft: 28 },
    ],
    benchmarks: {
      median_rate_per_sqft: 3200,
      avg_rent_psf_month: 29,
      avg_yield_pct: 8.2,
    },
  },
  approvals: {
    summary: { approved: 4, pending: 1, rejected: 0, total: 5 },
    items: [
      { approval_name: 'Plan sanction', status: 'approved', authority: 'BMRDA' },
      { approval_name: 'Fire NOC', status: 'pending', authority: 'Fire Department' },
    ],
  },
  documents: {
    summary: { availableCount: 3, missingCount: 1 },
    items: [
      { document_name: 'Title report', document_type: 'Legal', status: 'available' },
      { document_name: 'Lease abstracts', document_type: 'Commercial', status: 'available' },
    ],
  },
  risks: {
    summary: {
      total: 2,
      open: 2,
      critical: 0,
      high: 1,
      medium: 1,
      low: 0,
      topItems: [{ title: 'Pending fire NOC' }],
    },
    recommendation: {
      label: 'Proceed with conditions',
      reason: 'One construction readiness item remains open.',
      tone: 'caution',
    },
    items: [
      { title: 'Pending fire NOC', severity: 'high', mitigation: 'Expected before handover.' },
      { title: 'Lease-up concentration', severity: 'medium', mitigation: 'Anchor tenant signed; active pipeline for balance area.' },
    ],
  },
  dd: {
    summary: { openItems: 2, completedItems: 6, dealBreakersOpen: 0 },
    items: [{ item_name: 'Fire NOC', status: 'pending', category: 'Approvals' }],
  },
  readiness: {
    score: 78,
    label: 'Committee ready with conditions',
    summary: 'Core commercial and diligence fields are populated, with one approval item pending.',
    blockers: ['Fire NOC pending'],
    strengths: ['Title documentation available', 'Underwriting populated'],
    missingItems: ['Final fire NOC'],
  },
  nextSteps: [
    { group: 'Immediate DD Actions', items: ['Close pending fire NOC', 'Confirm final operating readiness sign-offs'] },
    { group: 'Financing / Investor Actions', items: ['Refresh lender diligence tracker', 'Confirm exit underwriting'] },
  ],
  cashFlows: {
    yearly: [
      { period_label: 'FY26', net: -140 },
      { period_label: 'FY27', net: 18 },
      { period_label: 'FY28', net: 24 },
      { period_label: 'FY29', net: 182 },
    ],
    quarterly: [],
  },
  sensitivity: {
    constructionCosts: [1800, 1900, 2000, 2100, 2200],
    sellingRates: [6000, 6200, 6400, 6600, 6800],
    irrGrid: [
      [14.2, 15.0, 15.9, 16.8, 17.6],
      [13.4, 14.2, 15.1, 15.9, 16.8],
      [12.7, 13.5, 14.3, 15.2, 16.0],
      [11.9, 12.7, 13.5, 14.4, 15.2],
      [11.1, 11.9, 12.8, 13.6, 14.4],
    ],
  },
  ai: { available: false, ic_opinion: null, next_steps: [], top_risks: [] },
});

const createNegativeExportContext = () => ({
  ...createExportContext(),
  deal: {
    ...createExportContext().deal,
    name: 'Gattahalli',
    property_name: 'Gattahalli',
    city: 'Bengaluru',
    state: 'Karnataka',
    deal_type: 'jv',
    deal_structure: 'outright',
    asset_class: 'residential_apartments',
    stage: 'ic_review',
    land_ask_price_cr: 160,
    negotiated_price_cr: null,
    total_cost_cr: 115.99,
    total_revenue_cr: 76.9,
    irr_pct: -18.6,
    npv_cr: -54.63,
    gross_margin_pct: -50.8,
    residual_land_value_cr: 110,
    yield_on_cost_pct: null,
    noi_cr: null,
    exit_value_cr: null,
    selling_rate_per_sqft: 10999,
    rera_number: null,
  },
  market: {
    ...createExportContext().market,
    benchmarks: {
      median_rate_per_sqft: 10930,
    },
  },
  risks: {
    summary: {
      total: 0,
      open: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      topItems: [],
    },
    recommendation: {
      label: 'Reprice / Rework',
      reason: 'Current underwriting is value-destructive at the stored price and program assumptions, so pricing, cost, or product mix must be reset before the deal is advanced.',
      tone: 'negative',
    },
    items: [],
  },
  dd: {
    summary: { open_deal_breakers: 0, completion_pct: 0 },
    items: [],
  },
  approvals: {
    summary: { total: 0, required: 0, validated: 0, pendingRequired: 0 },
    items: [],
  },
  readiness: {
    readiness_pct: 20,
    dd_completion_pct: 0,
    approval_completion_pct: 0,
  },
  nextSteps: [
    { group: 'Commercial / Negotiation Actions', items: ['Reset pricing, cost, or product assumptions before re-circulating the opportunity because the current underwriting is value-destructive.'] },
  ],
});

describe('dealPptx.service', () => {
  test('builds an institutional slide manifest for an income-producing deal', () => {
    const context = __testables.buildDeckContext(createExportContext(), {
      brandName: 'REDIP',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    const slideTitles = context.slideManifest.map((slide) => slide.title);

    expect(slideTitles[0]).toBe('North Gate Logistics Park');
    expect(slideTitles).toContain('Executive Summary');
    expect(slideTitles).toContain('City Benchmarking');
    expect(slideTitles).toContain('Structure & Counterparty');
    expect(slideTitles).toContain('Diligence & Operating Readiness');
    expect(slideTitles).toContain('Operating Economics');
    expect(slideTitles).toContain('Cash Flow & Sensitivity');
    expect(slideTitles).toContain('Transaction Summary');
    expect(slideTitles).toContain('Disclaimer');
  });

  test('returns a PPTX zip buffer for download in a plain node runtime', () => {
    const script = `
      const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
      const exportContext = ${JSON.stringify(createExportContext())};
      (async () => {
        const buffer = await buildDealDeckPptx(exportContext, {
          brandName: 'REDIP',
          userName: 'Test User',
          generatedAt: '2026-04-15T10:00:00Z',
        });
        process.stdout.write(JSON.stringify({
          isBuffer: Buffer.isBuffer(buffer),
          signature: buffer.slice(0, 2).toString('utf8'),
          length: buffer.length,
        }));
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `;

    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: require('path').resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    const result = JSON.parse(output);

    expect(result.isBuffer).toBe(true);
    expect(result.signature).toBe('PK');
    expect(result.length).toBeGreaterThan(1000);
  });

  test('derives recommendation and underwriting risks for a negative economics case', () => {
    const context = __testables.buildDeckContext(createNegativeExportContext(), {
      brandName: 'REDIP',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    expect(context.recommendations.label).toBe('Reprice / Rework');
    expect(context.riskRows.length).toBeGreaterThan(0);
    expect(context.riskRows.some((row) => /Negative project IRR|Modeled value below total cost/.test(row.title))).toBe(true);
    expect(context.executivePoints.some((point) => /value-destructive|Revenue trails total cost/i.test(point))).toBe(true);
  });

  test('infers retail classification and suppresses zero pricing markers when asset class is missing', () => {
    const exportContext = createExportContext();
    exportContext.deal = {
      ...exportContext.deal,
      name: 'Commercial Retail',
      property_name: 'Commercial Retail',
      asset_class: null,
      financial_asset_class: null,
      property_type: 'land',
      land_ask_price_cr: 0,
      negotiated_price_cr: 0,
      entry_value_cr: null,
      owner_name: null,
    };
    exportContext.market = {
      ...exportContext.market,
      benchmarks: {
        median_rate_per_sqft: 16660,
      },
    };
    exportContext.risks = {
      ...exportContext.risks,
      items: [],
      summary: { total: 0, open: 0, critical: 0, high: 0, medium: 0, low: 0 },
      recommendation: {
        label: 'Proceed With Conditions',
        tone: 'caution',
        reason: 'Readiness still needs tightening before circulation.',
      },
    };
    exportContext.dd = {
      summary: { open_deal_breakers: 0, completion_pct: 0 },
      items: [],
    };
    exportContext.readiness = {
      readiness_pct: 20,
      dd_completion_pct: 0,
    };
    exportContext.deal.model_params = {
      inputs: {
        baseRentPerSqftMonth: 95,
        vacancyPct: 12,
        exitCapRate: 7.5,
      },
      kpis: {},
      areas: {},
      costs: {},
      revenue: {},
      scenarios: {},
    };

    const context = __testables.buildDeckContext(exportContext, {
      brandName: 'REDIP',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    expect(context.assetClass).toBe('retail');
    expect(context.assetClassLabel).toBe('Retail');
    expect(context.isIncome).toBe(true);
    expect(context.askPrice).toBeNull();
    expect(context.commercialMarker).toBeNull();
  });
});
