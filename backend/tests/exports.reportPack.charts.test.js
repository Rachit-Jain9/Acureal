'use strict';

/**
 * RP4 — cinematic SVG charts in the report packs.
 *
 * Two layers under test:
 *   1) Pure composer chart-SPEC builders (donut / cashflow / tornado) — they
 *      must read kernel data correctly, null out honestly when data is thin,
 *      and never produce a misleading half-truth chart.
 *   2) The renderer's chart-block dispatch + ImageRun embedding — produces a
 *      valid DOCX with the SVG embedded (or omits the block entirely; never
 *      throws into the doc).
 */

const JSZip = require('jszip');
const {
  composePack,
  capitalStackDonutBlock, cashflowTrendBlock, sensitivityTornadoBlock,
} = require('../src/services/exports/reportPack/composePack');
const {
  buildReportPackDocx, CHART_RENDERERS,
} = require('../src/services/exports/docx/buildReportPackDocx');

const extractDocumentXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  return file ? file.async('string') : null;
};

const richInvestorWorkspace = () => ({
  deal: { name: 'Whitefield Heights', asset_class: 'residential_apartments', city: 'Bengaluru', state: 'Karnataka' },
  financial: {
    summary: {
      total_cost_cr: 442, total_revenue_cr: 637, gross_margin_pct: 30.6,
      irr_pct: 18.5, equity_multiple: 2.1, npv_cr: 120, project_duration_months: 36,
      cash_flows: {
        quarterly: [
          { quarter: 1, label: 'Q1', net: -120 },
          { quarter: 2, label: 'Q2', net: -80 },
          { quarter: 3, label: 'Q3', net: 30 },
          { quarter: 4, label: 'Q4', net: 80 },
          { quarter: 5, label: 'Q5', net: 220 },
        ],
      },
      sensitivity_matrix: {
        sellingRates: [6500, 7000, 7500, 8000, 8500],
        constructionCosts: [12500, 13000, 13500, 14000, 14500],
        irrGrid: [
          [25.0, 24.0, 23.0, 22.0, 21.0], // lowest cost row
          [23.0, 22.0, 21.0, 20.0, 19.0],
          [21.0, 20.0, 18.5, 17.0, 15.0], // base IRR at center
          [19.0, 17.0, 15.0, 13.0, 11.0],
          [16.0, 14.0, 12.0,  9.0,  7.0],
        ],
      },
    },
    scenarios: {
      base: { kpis: { irr: 18.5, equityMultiple: 2.1, grossMarginPct: 30.6, npv: 120 } },
      bull: { kpis: { irr: 23.0, equityMultiple: 2.5, grossMarginPct: 34.0, npv: 180 } },
      bear: { kpis: { irr: 11.2, equityMultiple: 1.4, grossMarginPct: 18.0, npv: 40 } },
    },
  },
  capital_stack_optimizer: {
    scenarios: [{ scenario: 'base', label: 'Base', debt_cr: 200, blended_cost_of_capital_pct: 13.5, total_cost_cr: 442, mix: { equity_pct: 40 }, amounts_cr: { equity: 242 }, covenants: { ltv: { value: 0.45, threshold: 0.6, passes: true }, dscr: { value: 1.45, threshold: 1.2, passes: true } } }],
  },
});

// ───────────────────────────────────────────────────────────────────────────
// capitalStackDonutBlock
// ───────────────────────────────────────────────────────────────────────────

describe('capitalStackDonutBlock', () => {
  test('uses base.amounts_cr.equity when present', () => {
    const b = capitalStackDonutBlock(richInvestorWorkspace());
    expect(b).toEqual({
      type: 'chart', chart: 'capital_stack_donut',
      data: { debtCr: 200, equityCr: 242 },
      caption: expect.stringMatching(/Debt vs equity/i),
    });
  });

  test('falls back to total_cost − debt when equity is absent', () => {
    const ws = richInvestorWorkspace();
    ws.capital_stack_optimizer.scenarios[0].amounts_cr = undefined;
    const b = capitalStackDonutBlock(ws);
    expect(b.data).toEqual({ debtCr: 200, equityCr: 242 }); // 442 - 200
  });

  test('returns null when there are no scenarios', () => {
    expect(capitalStackDonutBlock({})).toBeNull();
    expect(capitalStackDonutBlock({ capital_stack_optimizer: { scenarios: [] } })).toBeNull();
  });

  test('returns null when both debt and equity are zero / missing', () => {
    const ws = { capital_stack_optimizer: { scenarios: [{ scenario: 'base' }] } };
    expect(capitalStackDonutBlock(ws)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// cashflowTrendBlock
// ───────────────────────────────────────────────────────────────────────────

describe('cashflowTrendBlock', () => {
  test('produces rows with a computed running cumulative', () => {
    const b = cashflowTrendBlock(richInvestorWorkspace());
    expect(b.type).toBe('chart');
    expect(b.chart).toBe('cashflow_trend');
    expect(b.data.title).toMatch(/Cash Flow/i);
    expect(b.data.rows.map((r) => r.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
    // running sum: -120, -200, -170, -90, 130
    expect(b.data.rows.map((r) => r.cumulative)).toEqual([-120, -200, -170, -90, 130]);
  });

  test('honours a kernel-supplied cumulative if present', () => {
    const ws = richInvestorWorkspace();
    ws.financial.summary.cash_flows.quarterly = [
      { label: 'Q1', net: 10, cumulative: 999 },
      { label: 'Q2', net: 20, cumulative: 1019 },
    ];
    const b = cashflowTrendBlock(ws);
    expect(b.data.rows[0].cumulative).toBe(999);
    expect(b.data.rows[1].cumulative).toBe(1019);
  });

  test('falls back to yearly when quarterly is absent', () => {
    const ws = richInvestorWorkspace();
    ws.financial.summary.cash_flows = {
      yearly: [
        { year: 1, label: 'Year 1', net: -200 },
        { year: 2, label: 'Year 2', net: 100 },
        { year: 3, label: 'Year 3', net: 350 },
      ],
    };
    const b = cashflowTrendBlock(ws);
    expect(b.data.rows.map((r) => r.label)).toEqual(['Year 1', 'Year 2', 'Year 3']);
    expect(b.data.rows.map((r) => r.cumulative)).toEqual([-200, -100, 250]);
  });

  test('returns null when fewer than 2 periods are recorded (honest empty state)', () => {
    expect(cashflowTrendBlock({})).toBeNull();
    expect(cashflowTrendBlock({ financial: { summary: { cash_flows: { quarterly: [{ label: 'Q1', net: 10 }] } } } })).toBeNull();
    expect(cashflowTrendBlock({ financial: { summary: {} } })).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// sensitivityTornadoBlock
// ───────────────────────────────────────────────────────────────────────────

describe('sensitivityTornadoBlock', () => {
  test('extracts baseIrr and both drivers from the centre row/col of the grid', () => {
    const b = sensitivityTornadoBlock(richInvestorWorkspace());
    expect(b.type).toBe('chart');
    expect(b.chart).toBe('sensitivity_tornado');
    expect(b.data.baseIrr).toBe(18.5);
    expect(b.data.drivers).toHaveLength(2);
    const sell = b.data.drivers.find((d) => d.label === 'Selling Rate');
    expect(sell.low).toBe(21);   // mid row, first col
    expect(sell.high).toBe(15);  // mid row, last col
    expect(sell.subLabel).toContain('6,500');
    expect(sell.subLabel).toContain('8,500');
    const cost = b.data.drivers.find((d) => d.label === 'Construction Cost');
    expect(cost.low).toBe(12);   // last row (highest cost), mid col
    expect(cost.high).toBe(23);  // first row (lowest cost), mid col
  });

  test('returns null when grid axes are not dense enough (< 3 entries)', () => {
    const ws = richInvestorWorkspace();
    ws.financial.summary.sensitivity_matrix.sellingRates = [7000, 8000];
    expect(sensitivityTornadoBlock(ws)).toBeNull();
  });

  test('returns null when sensitivity_matrix is missing entirely', () => {
    expect(sensitivityTornadoBlock({})).toBeNull();
    expect(sensitivityTornadoBlock({ financial: { summary: {} } })).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Investor pack — chart blocks are wired into the right sections in order
// ───────────────────────────────────────────────────────────────────────────

const sectionBlocks = (model, id) => {
  const sec = model.sections.find((s) => s.id === id);
  return (sec && sec.blocks) || [];
};
const chartIn = (blocks) => blocks.find((b) => b.type === 'chart');

describe('composePack(investor) — chart wiring', () => {
  test('returns_summary section carries the cashflow chart AFTER the KPI grid', () => {
    const m = composePack(richInvestorWorkspace(), 'investor');
    const blocks = sectionBlocks(m, 'returns_summary');
    const kpiIdx = blocks.findIndex((b) => b.type === 'kpiGrid');
    const chartIdx = blocks.findIndex((b) => b.type === 'chart');
    expect(kpiIdx).toBeGreaterThanOrEqual(0);
    expect(chartIdx).toBeGreaterThan(kpiIdx);
    expect(blocks[chartIdx].chart).toBe('cashflow_trend');
  });

  test('scenarios section carries the sensitivity tornado AFTER the bear/base/bull table', () => {
    const m = composePack(richInvestorWorkspace(), 'investor');
    const blocks = sectionBlocks(m, 'scenarios');
    const tableIdx = blocks.findIndex((b) => b.type === 'table');
    const chartIdx = blocks.findIndex((b) => b.type === 'chart');
    expect(tableIdx).toBeGreaterThanOrEqual(0);
    expect(chartIdx).toBeGreaterThan(tableIdx);
    expect(blocks[chartIdx].chart).toBe('sensitivity_tornado');
  });

  test('capital_stack section leads with the donut, then the scenarios table', () => {
    const m = composePack(richInvestorWorkspace(), 'investor');
    const blocks = sectionBlocks(m, 'capital_stack');
    expect(blocks[0].type).toBe('chart');
    expect(blocks[0].chart).toBe('capital_stack_donut');
    expect(blocks.some((b) => b.type === 'table')).toBe(true);
  });

  test('when data is thin, chart blocks are silently omitted (no broken charts)', () => {
    const ws = richInvestorWorkspace();
    delete ws.financial.summary.cash_flows;
    delete ws.financial.summary.sensitivity_matrix;
    const m = composePack(ws, 'investor');
    expect(chartIn(sectionBlocks(m, 'returns_summary'))).toBeUndefined();
    expect(chartIn(sectionBlocks(m, 'scenarios'))).toBeUndefined();
    // Donut still draws from capital-stack-optimizer (still present)
    expect(chartIn(sectionBlocks(m, 'capital_stack'))).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Renderer — embedding, dispatch, robustness
// ───────────────────────────────────────────────────────────────────────────

describe('buildReportPackDocx — chart embedding', () => {
  test('wires three chart kinds with sensible default dimensions', () => {
    expect(Object.keys(CHART_RENDERERS).sort()).toEqual(
      ['capital_stack_donut', 'cashflow_trend', 'sensitivity_tornado'],
    );
    for (const kind of Object.keys(CHART_RENDERERS)) {
      expect(CHART_RENDERERS[kind].width).toBeGreaterThan(0);
      expect(CHART_RENDERERS[kind].height).toBeGreaterThan(0);
      expect(typeof CHART_RENDERERS[kind].fn).toBe('function');
    }
  });

  test('investor pack DOCX embeds three SVG images + their captions', async () => {
    const model = composePack(richInvestorWorkspace(), 'investor');
    const buffer = await buildReportPackDocx(model, {});
    const zip = await JSZip.loadAsync(buffer);
    // Each ImageRun lands as a media file inside the docx package.
    const mediaFiles = Object.keys(zip.files).filter((p) => /^word\/media\//.test(p));
    expect(mediaFiles.length).toBeGreaterThanOrEqual(3); // donut + cashflow + tornado
    const xml = await extractDocumentXml(buffer);
    expect(xml).toMatch(/Debt vs equity/i);
    expect(xml).toMatch(/cumulative position/i);
    expect(xml).toMatch(/inputs move IRR/i);
  });

  test('unknown chart kind → block is omitted (no throw, no broken doc)', async () => {
    const minimalModel = {
      meta: { title: 'X', docTitle: 'Test' },
      sections: [{
        id: 's', title: 'Section', lead: null,
        blocks: [
          { type: 'chart', chart: 'no_such_kind', data: {} },
          { type: 'paragraph', text: 'still here' },
        ],
      }],
    };
    const buffer = await buildReportPackDocx(minimalModel, {});
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('still here');
  });

  test('a chart whose generator throws is silently swallowed', async () => {
    const broken = {
      meta: { title: 'X', docTitle: 'Test' },
      sections: [{
        id: 's', title: 'Section', lead: null,
        blocks: [
          // Donut renderer receives the wrong shape — the try/catch in the
          // renderer should suppress the error and skip the block.
          { type: 'chart', chart: 'capital_stack_donut', data: null },
          { type: 'paragraph', text: 'next paragraph' },
        ],
      }],
    };
    const buffer = await buildReportPackDocx(broken, {});
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('next paragraph');
  });
});
