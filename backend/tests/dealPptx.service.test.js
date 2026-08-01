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
    expect(slideTitles).toContain('Decision Frame & Composite Score');
    expect(slideTitles).toContain('City Benchmarking');
    expect(slideTitles).toContain('Structure & Counterparty');
    expect(slideTitles).toContain('Diligence & Operating Readiness');
    expect(slideTitles).toContain('Operating Economics');
    expect(slideTitles).toContain('Cash Flow & Sensitivity');
    expect(slideTitles).toContain('Transaction Summary');
    expect(slideTitles).toContain('Pros & Cons');
    expect(slideTitles).toContain('Key Assumptions & Sources');
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

  test('renders the Site Yield slide in the full deck without throwing', () => {
    const ctxObj = {
      ...createExportContext(),
      siteYield: {
        mode: 'saved',
        computed: {
          ok: true,
          envelope: { realized_gfa_sqft: 108900, effective_fsi: 2.5, floors: 14 },
          areaSchedule: { gfa_sqft: 108900, carpet_sqft: 67518, saleable_sqft: 87773, loading_factor_pct: 30 },
          totals: { units: 65 },
          parking: { required_ecs: 85, norm: '1.3 ECS / unit' },
          unitMix: [{ key: '2bhk', label: '2 BHK', count: 37, carpet_total_sqft: 37000 }],
          bindingConstraint: 'far',
          unrealizedFarPct: 0,
          disclaimer: 'Deterministic screening estimate.',
        },
        boundary: { source: 'kml', area_sqft: 43560, review_status: 'pending' },
      },
    };
    const script = `
      const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
      const exportContext = ${JSON.stringify(ctxObj)};
      (async () => {
        const buffer = await buildDealDeckPptx(exportContext, { brandName: 'REDIP', userName: 'Test', generatedAt: '2026-04-15T10:00:00Z' });
        process.stdout.write(JSON.stringify({ isBuffer: Buffer.isBuffer(buffer), signature: buffer.slice(0, 2).toString('utf8') }));
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: require('path').resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    const result = JSON.parse(output);
    expect(result.isBuffer).toBe(true);
    expect(result.signature).toBe('PK');
  });

  // The Cash Flow & Sensitivity slide previously rendered a single-series
  // column chart of net cash flow only. A reader couldn't see the
  // cumulative trajectory at a glance — when does the deal turn positive?
  // The combo chart (column for period + line for cumulative on a
  // secondary axis) is the standard analyst read on CBRE / JLL decks.
  // Asset-class branching only changes the series label / chart title.
  test('emits a bar+line combo chart on the Cash Flow & Sensitivity slide', () => {
    const script = `
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const JSZip = require('jszip');
      const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
      const exportContext = ${JSON.stringify(createExportContext())};
      (async () => {
        const buffer = await buildDealDeckPptx(exportContext, {
          brandName: 'REDIP', userName: 'Test', generatedAt: '2026-05-11T00:00:00Z',
        });
        const zip = await JSZip.loadAsync(buffer);
        const chartFiles = Object.keys(zip.files).filter((n) => /^ppt\\/charts\\/chart\\d+\\.xml$/.test(n));
        const chartTypes = await Promise.all(chartFiles.map(async (name) => {
          const xml = await zip.files[name].async('string');
          const types = (xml.match(/<c:(barChart|pieChart|doughnutChart|lineChart|scatterChart|areaChart)/g) || []).map((m) => m.slice(3));
          const titleMatch = xml.match(/<a:t>([^<]+Cash Flow[^<]*|[^<]+NOI[^<]*|[^<]+Cumulative[^<]*)<\\\/a:t>/);
          return { types: [...new Set(types)], title: titleMatch ? titleMatch[1] : null };
        }));
        process.stdout.write(JSON.stringify({ chartTypes }));
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: require('path').resolve(__dirname, '..'), encoding: 'utf8',
    });
    const result = JSON.parse(output);

    // At least one chart in the deck must be the combo (bar + line).
    const comboCharts = result.chartTypes.filter((c) =>
      c.types.includes('barChart') && c.types.includes('lineChart')
    );
    expect(comboCharts.length).toBeGreaterThanOrEqual(1);

    // And one of them must carry the asset-class-aware title. PPTX
    // charts encode "&" as "&amp;" in the title cell — match either form.
    const titles = result.chartTypes.map((c) => c.title).filter(Boolean);
    expect(titles.some((t) => /Period (Net Cash Flow|NOI) (&|&amp;) Cumulative/.test(t))).toBe(true);
  });

  // Slide 9 (City Benchmarking) previously rendered a single-series
  // horizontal bar chart of comp mid-point pricing. When the comp service
  // attaches distance_km (nearby-coordinate query), a scatter shows where
  // each comp sits relative to the site — far more useful for an analyst
  // than a sorted list of rates. The deal's modeled rate is plotted at
  // distance = 0 so the reader can see the price gap visually.
  test('renders a rate-vs-distance scatter on slide 9 when comp distances are present', () => {
    const script = `
      const JSZip = require('jszip');
      const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
      const ctx = ${JSON.stringify(createExportContext())};
      ctx.deal.selling_rate_per_sqft = 28;
      ctx.market.exportComps = [
        { project_name: 'Park A', rate_per_sqft: 31, distance_km: 1.4, is_verified: true },
        { project_name: 'Park B', rate_per_sqft: 28, distance_km: 2.6, is_verified: true },
        { project_name: 'Park C', rate_per_sqft: 29, distance_km: 3.8, is_verified: true },
      ];
      (async () => {
        const buffer = await buildDealDeckPptx(ctx, {
          brandName: 'REDIP', userName: 'Test', generatedAt: '2026-05-11T00:00:00Z',
        });
        const zip = await JSZip.loadAsync(buffer);
        const chartFiles = Object.keys(zip.files).filter((n) => /^ppt\\/charts\\/chart\\d+\\.xml$/.test(n));
        const chartTypes = await Promise.all(chartFiles.map(async (name) => {
          const xml = await zip.files[name].async('string');
          const types = (xml.match(/<c:(barChart|pieChart|doughnutChart|lineChart|scatterChart|areaChart)/g) || []).map((m) => m.slice(3));
          const hasRateVsDistance = /Rate vs Distance/.test(xml);
          return { types: [...new Set(types)], hasRateVsDistance };
        }));
        process.stdout.write(JSON.stringify({ chartTypes }));
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: require('path').resolve(__dirname, '..'), encoding: 'utf8',
    });
    const result = JSON.parse(output);

    // At least one chart must be a scatter, and must be the
    // rate-vs-distance one (not some other scatter we might add later).
    const scatterCharts = result.chartTypes.filter((c) =>
      c.types.includes('scatterChart') && c.hasRateVsDistance
    );
    expect(scatterCharts.length).toBeGreaterThanOrEqual(1);
  });

  // Slide 16 (Cash Flow & Sensitivity) previously rendered a 5×5 numeric
  // heatmap table of IRR by selling-rate × construction-cost combinations.
  // Informative but reads as a spreadsheet, not a chart. The tornado
  // (built from shape primitives — pptxgenjs has no native tornado type)
  // shows the same driver-impact ranges as horizontal bars centred on
  // base IRR, sorted by absolute impact.
  test('renders a sensitivity tornado on slide 16 (driver bars + base IRR axis)', () => {
    const script = `
      const JSZip = require('jszip');
      const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
      const ctx = ${JSON.stringify(createExportContext())};
      ctx.sensitivity = {
        constructionCosts: [1800, 1900, 2000, 2100, 2200],
        sellingRates: [6000, 6200, 6400, 6600, 6800],
        irrGrid: [
          [14.2, 15.0, 15.9, 16.8, 17.6],
          [13.4, 14.2, 15.1, 15.9, 16.8],
          [12.7, 13.5, 14.3, 15.2, 16.0],
          [11.9, 12.7, 13.5, 14.4, 15.2],
          [11.1, 11.9, 12.8, 13.6, 14.4],
        ],
      };
      (async () => {
        const buffer = await buildDealDeckPptx(ctx, {
          brandName: 'REDIP', userName: 'Test', generatedAt: '2026-05-11T00:00:00Z',
        });
        const zip = await JSZip.loadAsync(buffer);
        const slideNames = Object.keys(zip.files).filter((n) => /^ppt\\/slides\\/slide\\d+\\.xml$/.test(n));
        const xmls = await Promise.all(slideNames.map((n) => zip.files[n].async('string')));
        const tornadoSlide = xmls.find((xml) =>
          xml.includes('SENSITIVITY')
          && xml.includes('Selling Rate')
          && xml.includes('Construction Cost')
          && /Base IRR/.test(xml)
        );
        process.stdout.write(JSON.stringify({ hasTornado: !!tornadoSlide }));
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: require('path').resolve(__dirname, '..'), encoding: 'utf8',
    });
    const result = JSON.parse(output);

    expect(result.hasTornado).toBe(true);
  });

  // Capital stack (debt vs equity) used to appear only as a comma-
  // separated text row inside the commercial-terms table on the
  // Transaction Summary slide. Reader couldn't see the proportion
  // at a glance. Now: a horizontal stacked bar with both percent
  // and absolute INR Cr labels.
  test('renders a Capital Stack section on Transaction Summary with debt/equity labels', () => {
    const script = `
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const JSZip = require('jszip');
      const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
      const ctx = ${JSON.stringify(createExportContext())};
      ctx.deal.model_params = { capitalStack: { debtCr: 110, equityCr: 331 } };
      (async () => {
        const buffer = await buildDealDeckPptx(ctx, {
          brandName: 'REDIP', userName: 'Test', generatedAt: '2026-05-11T00:00:00Z',
        });
        const zip = await JSZip.loadAsync(buffer);
        const slideNames = Object.keys(zip.files).filter((n) => /^ppt\\/slides\\/slide\\d+\\.xml$/.test(n));
        const xmls = await Promise.all(slideNames.map((n) => zip.files[n].async('string')));
        const matches = xmls
          .filter((xml) => xml.includes('Transaction Summary'))
          .map((xml) => ({
            hasEyebrow: xml.includes('CAPITAL STACK'),
            hasDebtPct: /Debt \\d+%/.test(xml),
            hasEquityPct: /Equity \\d+%/.test(xml),
            hasDebtCr: /Debt INR/.test(xml),
            hasEquityCr: /Equity INR/.test(xml),
          }));
        process.stdout.write(JSON.stringify({ slidesWithCapStack: matches }));
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: require('path').resolve(__dirname, '..'), encoding: 'utf8',
    });
    const result = JSON.parse(output);
    const transactionSlides = result.slidesWithCapStack;

    expect(transactionSlides.length).toBeGreaterThanOrEqual(1);
    const fullSlide = transactionSlides.find((s) =>
      s.hasEyebrow && s.hasDebtPct && s.hasEquityPct && s.hasDebtCr && s.hasEquityCr
    );
    expect(fullSlide).toBeDefined();
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

  test('inserts a Planning Context slide when planning callouts are present', () => {
    const exportContext = {
      ...createExportContext(),
      planning: {
        callouts: [
          { type: 'sdz', key: 'special_development_zones', value: { count: 5, max_far: 3.5, locations: ['Bellary Road', 'Old Madras Road'] } },
          { type: 'environmental', key: 'ngt_drainage_classification', value: { buffer_m_primary: 50, buffer_m_secondary: 35, buffer_m_tertiary: 25, source: 'NGT' } },
          { type: 'heritage', key: 'heritage_zones', value: { count: 12, prohibited_radius_m: 100, regulated_radius_m: 200 } },
          { type: 'road_network', key: 'peripheral_ring_road', value: { width_m: 100, type: 'PRR', note: '100m corridor' } },
        ],
        zone: null,
        city: 'Bengaluru',
      },
    };
    const context = __testables.buildDeckContext(exportContext, {
      brandName: 'REDIP',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    expect(context.hasPlanningContext).toBe(true);
    expect(context.planningRows).toHaveLength(4);
    const rowLabels = context.planningRows.map((r) => r.label);
    expect(rowLabels).toEqual([
      'Special Development Zones',
      'NGT drain buffers',
      'Heritage zones',
      'Peripheral Ring Road',
    ]);

    // Slide manifest should include the new slide between location and asset.
    const slideTitles = context.slideManifest.map((s) => s.title);
    expect(slideTitles).toContain('Planning Context — RMP 2031 (Reference Only)');
    const planningIdx = slideTitles.indexOf('Planning Context — RMP 2031 (Reference Only)');
    const locationIdx = slideTitles.indexOf('Location & Site Context');
    const assetIdx = slideTitles.indexOf('About the Asset');
    expect(planningIdx).toBeGreaterThan(locationIdx);
    expect(planningIdx).toBeLessThan(assetIdx);

    // Credibility guard: the populated commentary must mark RMP 2031 as a
    // withdrawn draft / reference-only and must NOT imply it is operative or
    // "reviewer-approved" (RMP 2031's provisional approval was withdrawn in
    // July 2020; the operative plan is RMP 2015).
    const commentary = context.planningCommentary.join(' ');
    expect(commentary).toMatch(/withdrawn draft/i);
    expect(commentary).toMatch(/not operative/i);
    expect(commentary).not.toMatch(/reviewer-approved/i);
    expect(commentary).not.toMatch(/verified RMP 2031/i);
  });

  test('omits the Planning Context slide when no callouts are present', () => {
    const exportContext = {
      ...createExportContext(),
      planning: { callouts: [], zone: null, city: 'Bengaluru' },
    };
    const context = __testables.buildDeckContext(exportContext, {
      brandName: 'REDIP',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    expect(context.hasPlanningContext).toBe(false);
    const slideTitles = context.slideManifest.map((s) => s.title);
    expect(slideTitles).not.toContain('Planning Context — RMP 2031 (Reference Only)');

    // Even the empty-state commentary must carry the withdrawn / reference-only
    // framing — never present RMP 2031 as the authoritative plan to ingest.
    const commentary = context.planningCommentary.join(' ');
    expect(commentary).toMatch(/withdrawn draft/i);
    expect(commentary).toMatch(/operative plan is RMP 2015/i);
  });

  test('renders a defensive Planning Context slide when context is entirely missing', () => {
    // No `planning` key at all on the exportContext — the deck must not blow up.
    const exportContext = createExportContext();
    delete exportContext.planning;
    const context = __testables.buildDeckContext(exportContext, {
      brandName: 'REDIP',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    expect(context.planningRows).toEqual([]);
    expect(context.hasPlanningContext).toBe(false);
    const slideTitles = context.slideManifest.map((s) => s.title);
    expect(slideTitles).not.toContain('Planning Context — RMP 2031 (Reference Only)');
  });

  test('inserts a Site Yield slide after Asset Snapshot when a programme is present', () => {
    const exportContext = {
      ...createExportContext(),
      siteYield: {
        mode: 'saved',
        computed: {
          ok: true,
          envelope: { realized_gfa_sqft: 108900, effective_fsi: 2.5, floors: 14 },
          areaSchedule: { gfa_sqft: 108900, carpet_sqft: 67518, saleable_sqft: 87773, loading_factor_pct: 30 },
          totals: { units: 65 },
          parking: { required_ecs: 85, norm: '1.3 ECS / unit' },
          unitMix: [{ key: '2bhk', label: '2 BHK', count: 37, carpet_total_sqft: 37000 }],
          bindingConstraint: 'far',
          unrealizedFarPct: 0,
          disclaimer: 'Deterministic screening estimate.',
        },
        boundary: null,
      },
    };
    const context = __testables.buildDeckContext(exportContext, { brandName: 'REDIP', generatedAt: '2026-04-15T10:00:00Z' });
    expect(context.hasSiteYield).toBe(true);
    const titles = context.slideManifest.map((s) => s.title);
    expect(titles).toContain('Site Yield & Massing');
    expect(titles.indexOf('Site Yield & Massing')).toBeGreaterThan(titles.indexOf('Asset Snapshot'));
  });

  test('omits the Site Yield slide when no programme was computed', () => {
    const context = __testables.buildDeckContext(createExportContext(), { brandName: 'REDIP', generatedAt: '2026-04-15T10:00:00Z' });
    expect(context.hasSiteYield).toBe(false);
    expect(context.slideManifest.map((s) => s.title)).not.toContain('Site Yield & Massing');
  });

  describe('precomputeDeckAssets', () => {
    test('produces a score gauge and survives missing AI providers', async () => {
      // No GEMINI / ANTHROPIC / OPENAI keys → narrative falls back to
      // the deterministic path; gauge is local.
      const exportContext = createExportContext();
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-04-15T10:00:00Z',
      });
      const assets = await __testables.precomputeDeckAssets(
        exportContext,
        baseContext,
        { publicUrl: 'https://acureal.in' },
      );
      expect(assets.scoreGaugeDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(assets.dealScore).toBeDefined();
      expect(typeof assets.dealScore.score).toBe('number');
      expect(assets.dealScore.score).toBeGreaterThanOrEqual(0);
      expect(assets.dealScore.score).toBeLessThanOrEqual(100);
      // prosCons either available (with pros/cons arrays) or unavailable
      // (with reason). Either way, it's an object — never throws.
      expect(typeof assets.prosCons).toBe('object');
      expect(assets.prosCons).not.toBeNull();
      // Asset-class artwork — pure-SVG, always present.
      expect(assets.assetArtDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
      // Site-map status surfaces the actual reason when MAPBOX_TOKEN absent.
      expect(['ok', 'no_token', 'no_coords', 'fetch_failed']).toContain(assets.siteMapStatus);
    });

    test('still produces deck assets when no deal id present', async () => {
      const exportContext = createExportContext();
      delete exportContext.deal.id;
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-04-15T10:00:00Z',
      });
      const assets = await __testables.precomputeDeckAssets(
        exportContext,
        baseContext,
        { publicUrl: 'https://acureal.in' },
      );
      expect(assets.scoreGaugeDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(assets.dealScore).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR-NX18 (2026-05-16): AI-Assisted Briefing slide (cross-product parity)
  // ────────────────────────────────────────────────────────────────────
  // Same shared `generateDealBriefing` service used by XLSX (PR-NX7/12)
  // and DOCX (PR-NX18 sibling). All three render identical headline
  // language for the same deal.
  describe('PR-NX18: Executive Briefing slide', () => {
    test('slide manifest places briefing as slide 2 (right after Cover)', () => {
      const exportContext = createExportContext();
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-05-16T10:00:00Z',
      });
      const manifest = baseContext.slideManifest;
      expect(manifest[0].key).toBe('cover');
      expect(manifest[1].key).toBe('briefing');
      // PR-NX74 (2026-05-19) — was "AI-Assisted Briefing"; renamed to
      // "Executive Briefing" per operator policy (PPTX must not surface
      // AI usage anywhere).
      expect(manifest[1].title).toBe('Executive Briefing');
      expect(manifest[2].key).toBe('contents');
    });

    test('precomputeDeckAssets generates a briefing object', async () => {
      const exportContext = createExportContext();
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-05-16T10:00:00Z',
      });
      const assets = await __testables.precomputeDeckAssets(
        exportContext, baseContext, { publicUrl: 'https://acureal.in' },
      );
      expect(assets.briefing).toBeTruthy();
      expect(assets.briefing.bullets).toHaveLength(4);
      expect(typeof assets.briefing.riskNote).toBe('string');
      expect(typeof assets.briefing.summary).toBe('string');
    });

    test('briefing is asset-class-aware (industrial → warehouse language, not residential)', async () => {
      const exportContext = createExportContext(); // industrial_warehousing
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-05-16T10:00:00Z',
      });
      const assets = await __testables.precomputeDeckAssets(
        exportContext, baseContext, { publicUrl: 'https://acureal.in' },
      );
      const allText = `${assets.briefing.summary} ${assets.briefing.bullets.join(' ')} ${assets.briefing.riskNote}`;
      // Industrial economics bullet should mention warehouse / logistics
      expect(allText).toMatch(/Logistics|warehouse|industrial/i);
    });

    test('briefing renders cleanly when the deal has zero kernel KPIs (early-stage)', async () => {
      const exportContext = createExportContext();
      delete exportContext.deal.irr_pct;
      delete exportContext.deal.npv_cr;
      delete exportContext.deal.equity_multiple;
      delete exportContext.deal.gross_margin_pct;
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-05-16T10:00:00Z',
      });
      const assets = await __testables.precomputeDeckAssets(
        exportContext, baseContext, { publicUrl: 'https://acureal.in' },
      );
      expect(assets.briefing).toBeTruthy();
      expect(assets.briefing.bullets).toHaveLength(4);
      // No NaN / undefined leaks in the rendered text
      assets.briefing.bullets.forEach((b) => {
        expect(b).not.toMatch(/NaN|undefined|\[object Object\]/);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // PR-NX54 (2026-05-19) — 3 new AI narrative slides
  // ──────────────────────────────────────────────────────────────────
  describe('PR-NX54: 3 new AI narrative slides (cross-product parity with DOCX)', () => {
    test('slide manifest inserts sensitivityNarrative after cashFlowSensitivity', () => {
      const exportContext = createExportContext();
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-05-19T10:00:00Z',
      });
      const manifest = baseContext.slideManifest;
      const cashFlowIdx = manifest.findIndex((s) => s.key === 'cashFlowSensitivity');
      const sensNarrIdx = manifest.findIndex((s) => s.key === 'sensitivityNarrative');
      expect(cashFlowIdx).toBeGreaterThan(-1);
      expect(sensNarrIdx).toBe(cashFlowIdx + 1);
      expect(manifest[sensNarrIdx].title).toMatch(/Sensitivity Analysis.*Narrative/);
    });

    test('slide manifest inserts riskNarrative after risksMitigants', () => {
      const exportContext = createExportContext();
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-05-19T10:00:00Z',
      });
      const manifest = baseContext.slideManifest;
      const risksIdx = manifest.findIndex((s) => s.key === 'risksMitigants');
      const riskNarrIdx = manifest.findIndex((s) => s.key === 'riskNarrative');
      expect(risksIdx).toBeGreaterThan(-1);
      expect(riskNarrIdx).toBe(risksIdx + 1);
      expect(manifest[riskNarrIdx].title).toBe('Risk Profile Synthesis');
    });

    test('slide manifest inserts documentInsights after riskNarrative, before prosCons', () => {
      const exportContext = createExportContext();
      const baseContext = __testables.buildDeckContext(exportContext, {
        brandName: 'REDIP', generatedAt: '2026-05-19T10:00:00Z',
      });
      const manifest = baseContext.slideManifest;
      const riskNarrIdx = manifest.findIndex((s) => s.key === 'riskNarrative');
      const docInsightsIdx = manifest.findIndex((s) => s.key === 'documentInsights');
      const prosConsIdx = manifest.findIndex((s) => s.key === 'prosCons');
      expect(docInsightsIdx).toBe(riskNarrIdx + 1);
      expect(docInsightsIdx).toBeLessThan(prosConsIdx);
      expect(manifest[docInsightsIdx].title).toBe('Document-Derived Insights');
    });

    test('all 3 narrative slides render WITHOUT exception when narratives are present in exportContext', () => {
      const exportContext = createExportContext();
      // Populate the 3 new narratives in shape generateDealInsights returns
      exportContext.risks = exportContext.risks || {};
      exportContext.risks.narrative = {
        available: true,
        summary_paragraph: 'Risk profile dominated by legal exposure.',
        critical_spotlight_paragraph: 'Conversion order pending is the single dealbreaker.',
        confidence: 'high',
        provider: 'claude-sonnet-4-6',
        fallbackReason: null,
      };
      exportContext.sensitivityNarrative = {
        available: true,
        driver_decomposition_paragraph: 'Sell rate dominates with 800 bps IRR swing.',
        stress_test_paragraph: 'Stress 1: sell rate −10% takes IRR to 14%.',
        dominant_driver: 'Sell Rate',
        confidence: 'high',
        provider: 'gpt-5.4',
        fallbackReason: null,
      };
      exportContext.documents = exportContext.documents || {};
      exportContext.documents.insights = {
        available: true,
        summary_paragraph: '3 documents on file.',
        findings: [
          { title: 'Owner mismatch', severity: 'critical', description: 'sale deed vs RTC', recommendation: 'order khata' },
          { title: 'Area mismatch', severity: 'high', description: 'sale deed 12,500 vs khata 12,400', recommendation: 'survey' },
        ],
        confidence: 'high',
        provider: 'claude-sonnet-4-6',
        fallbackReason: null,
      };
      // Render the deck in a subprocess (pptxgenjs can't be required directly from this VM)
      const result = execFileSync(
        'node',
        ['-e', `(async () => {
          const { __testables } = require('./src/services/dealPptx.service');
          const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
          const exportContext = ${JSON.stringify(exportContext)};
          const buffer = await buildDealDeckPptx(exportContext, { brandName: 'REDIP', userName: 'test' });
          process.stdout.write(String(buffer.length));
        })().catch((e) => { console.error(e); process.exit(1); });`],
        { encoding: 'utf-8', cwd: process.cwd() },
      );
      const bufferLen = parseInt(result, 10);
      expect(bufferLen).toBeGreaterThan(10000); // PPTX always > 10KB
    });

    test('all 3 narrative slides render WITHOUT exception when narratives are unavailable (fallback path)', () => {
      const exportContext = createExportContext();
      // All 3 narratives unavailable → renderUnavailablePanel for each
      exportContext.risks = { narrative: { available: false, reason: 'no risks logged' } };
      exportContext.sensitivityNarrative = { available: false, reason: 'sparse grid' };
      exportContext.documents = { insights: { available: false, reason: 'no extractions' } };
      const result = execFileSync(
        'node',
        ['-e', `(async () => {
          const { buildDealDeckPptx } = require('./src/services/dealPptx.service');
          const exportContext = ${JSON.stringify(exportContext)};
          const buffer = await buildDealDeckPptx(exportContext, { brandName: 'REDIP', userName: 'test' });
          process.stdout.write(String(buffer.length));
        })().catch((e) => { console.error(e); process.exit(1); });`],
        { encoding: 'utf-8', cwd: process.cwd() },
      );
      const bufferLen = parseInt(result, 10);
      expect(bufferLen).toBeGreaterThan(10000);
    });
  });
});
