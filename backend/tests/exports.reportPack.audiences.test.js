'use strict';

/**
 * RP2 — investor + buyer audience tests (composer assertions + render smoke).
 */

const JSZip = require('jszip');
const { composePack } = require('../src/services/exports/reportPack/composePack');
const { buildReportPackDocx } = require('../src/services/exports/docx/buildReportPackDocx');

const extractDocumentXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  return file ? file.async('string') : null;
};

const fullWorkspace = () => ({
  deal: {
    name: 'Whitefield Heights', asset_class: 'residential_apartments', city: 'Bengaluru', state: 'Karnataka',
    stage: 'evaluation', rera_number: 'PRM/KA/RERA/1251/446/PR/000123', land_area_sqft: 130000,
    rera_inputs: { completion_date: '2028-12-31' },
  },
  financial: {
    summary: { total_cost_cr: 442, total_revenue_cr: 637, gross_margin_pct: 30.6, irr_pct: 18.5, equity_multiple: 2.1, npv_cr: 120, exit_value_cr: 700, yield_on_cost_pct: 9.2, noi_cr: 41, project_duration_months: 36 },
    scenarios: {
      base: { kpis: { irr: 18.5, equityMultiple: 2.1, grossMarginPct: 30.6, npv: 120 } },
      bull: { kpis: { irr: 23.0, equityMultiple: 2.5, grossMarginPct: 34.0, npv: 180 } },
      bear: { kpis: { irr: 11.2, equityMultiple: 1.4, grossMarginPct: 18.0, npv: 40 } },
    },
  },
  capital_stack_optimizer: {
    scenarios: [
      { scenario: 'conservative', label: 'Conservative', debt_cr: 150, blended_cost_of_capital_pct: 12.0, band: 'high', verdict: 'Recommend', mix: { equity_pct: 55 }, covenants: {} },
      { scenario: 'base', label: 'Base', debt_cr: 200, blended_cost_of_capital_pct: 13.5, band: 'medium', verdict: 'Consider', mix: { equity_pct: 40 }, covenants: {} },
    ],
  },
  micro_market: {
    benchmarks: [
      { metric_kind: 'sale_rate_per_sqft_inr', p25: 6800, p50: 7400, p75: 8100, n_observations: 42, confidence: 'high', source_ref: 'Knight Frank Q1 2026', last_verified_at: '2026-03-31' },
    ],
  },
  comps: { entries: [{ id: 'c1', is_verified: true }, { id: 'c2', is_verified: true }] },
  best_use: { scores: [{ asset_class: 'residential_apartments', score: 82, label: 'Strong suitability' }] },
  promoter: {
    promoter_name: 'Prestige Estates', years_active: 18, total_projects: 40, delivered_on_time: 34, delivered_delayed: 6, rera_registered: true,
    assessment: { posture: 'cleared', signals: [{ tone: 'positive', text: '34 of 40 projects delivered on time' }, { tone: 'warn', text: '6 delayed projects on record' }] },
  },
  ic_readiness: {
    applicable: true,
    overall: { completeness_pct: 64, readiness_tier: 'pre_ic', by_status: { verified: 12 }, total_items: 30 },
    buckets: [{ label: 'Financial Underwriting', completeness_pct: 80, bucket_status: 'complete' }, { label: 'Title & Legal', completeness_pct: 40, bucket_status: 'partial' }],
  },
  recommendations: {
    recommendations: [
      { verb: 'Stress-test', topic_label: 'Absorption', headline: 'Absorption assumption above micro-market benchmark', detail: 'Sell-through pace exceeds the verified band.', severity_base: 'high', ai_narratable: true },
      { verb: 'Flag', topic_label: 'Title chain', headline: 'Title verification outstanding', detail: 'Legal lane.', severity_base: 'critical', ai_narratable: false },
    ],
  },
  karnataka_rera_readiness: {
    applicable: true, applicability: { status: 'in_scope' }, milestone: { phase: 'pre_registration' },
    overall: { completeness_pct: 55, readiness_tier: 'partial', blockers: [{ item_id: 'cc', item_label: 'Commencement Certificate' }] },
    buckets: [
      { id: 'title_ownership', label: 'Title & Ownership', items: [{ id: 'title_deed', label: 'Registered title deed', evidence: { status: 'uploaded', evidence_label: 'Title_Deed.pdf' } }] },
      { id: 'professional_certificates', label: 'Professional Certificates', items: [{ id: 'architect_appointment', label: 'Architect appointment + Form-2', evidence: { status: 'verified', source: 'signoff', evidence_label: 'Architect sign-off (Form-2)' } }] },
    ],
  },
  approvals: [{ id: 1, approval_type: 'building_plan', name: 'Sanctioned Building Plan', is_available: true }],
  risk: { flags: [{ id: 'r1', severity: 'high', status: 'open', title: 'Approach road widening pending' }] },
});

const findSection = (m, id) => m.sections.find((s) => s.id === id);
const blocksOf = (m, id) => (findSection(m, id) || {}).blocks || [];
const firstBlock = (m, id, type) => blocksOf(m, id).find((b) => b.type === type);

describe('composePack — investor', () => {
  const model = composePack(fullWorkspace(), 'investor');

  test('meta + section order', () => {
    expect(model.meta.docTitle).toBe('Investor Briefing');
    expect(model.sections.map((s) => s.id)).toEqual([
      'returns_summary', 'scenarios', 'capital_stack', 'market_context',
      'promoter', 'ic_readiness', 'recommendations', 'risk_register', 'closing',
    ]);
  });

  test('returns summary reads kernel KPIs', () => {
    const grid = firstBlock(model, 'returns_summary', 'kpiGrid');
    expect(grid.items.find((i) => i.label === 'Project IRR').value).toBe('18.5%');
    expect(grid.items.find((i) => i.label === 'Equity multiple').value).toBe('2.1x');
  });

  test('scenarios table spans bear/base/bull', () => {
    const t = firstBlock(model, 'scenarios', 'table');
    const irr = t.rows.find((r) => r[0] === 'IRR');
    expect(irr[1].text).toBe('11.2%'); // bear
    expect(irr[2].text).toBe('18.5%'); // base
    expect(irr[3].text).toBe('23%');   // bull
  });

  test('market context: benchmark table + sourced freshness note', () => {
    const t = firstBlock(model, 'market_context', 'table');
    expect(t.rows[0][2]).toBe('7,400'); // median
    const src = firstBlock(model, 'market_context', 'sourceNote');
    expect(src.source).toContain('benchmark');
    expect(src.confidence).toBe('high');
  });

  test('promoter: facts + posture + signals', () => {
    const kv = firstBlock(model, 'promoter', 'keyValue');
    expect(kv.rows.find((r) => r[0] === 'Promoter')[1]).toBe('Prestige Estates');
    const posture = blocksOf(model, 'promoter').find((b) => b.type === 'paragraph');
    expect(posture.text).toMatch(/Cleared/);
    expect(posture.tone).toBe('positive');
  });

  test('recommendations exclude the legal-four card + cap', () => {
    const callouts = firstBlock(model, 'recommendations', 'callouts');
    expect(callouts.items).toHaveLength(1); // the ai_narratable:false (title) card is dropped
    expect(callouts.items[0].verb).toBe('Stress-test');
    // no legal headline leaks in
    expect(callouts.items.some((i) => /title/i.test(i.headline))).toBe(false);
  });

  test('market context with no verified feed → honest empty sourceNote', () => {
    const ws = fullWorkspace(); ws.micro_market = { benchmarks: [] };
    const m = composePack(ws, 'investor');
    const blocks = blocksOf(m, 'market_context');
    const src = blocks.find((b) => b.type === 'sourceNote');
    expect(src.source).toBeUndefined();
  });
});

describe('composePack — buyer', () => {
  const model = composePack(fullWorkspace(), 'buyer');

  test('meta + section order (consumer-transparency lens)', () => {
    expect(model.meta.docTitle).toBe('Buyer Information Pack');
    expect(model.sections.map((s) => s.id)).toEqual([
      'project_overview', 'rera_registration', 'statutory_approvals',
      'security_title', 'professional_signoffs', 'closing',
    ]);
  });

  test('project overview surfaces RERA number + declared completion', () => {
    const kv = firstBlock(model, 'project_overview', 'keyValue');
    expect(kv.rows.find((r) => r[0] === 'RERA registration')[1]).toContain('PRM/KA/RERA');
    expect(kv.rows.find((r) => r[0] === 'Declared completion')[1]).toMatch(/2028/);
  });

  test('professional sign-offs derived from signed cockpit items', () => {
    const sl = firstBlock(model, 'professional_signoffs', 'statusList');
    expect(sl.items).toHaveLength(1);
    expect(sl.items[0].label).toMatch(/Architect/);
    expect(sl.items[0].status).toBe('signed');
  });

  test('no investor/lender internals leak into the buyer pack', () => {
    const ids = model.sections.map((s) => s.id);
    expect(ids).not.toContain('returns_summary');
    expect(ids).not.toContain('credit_summary');
    expect(ids).not.toContain('risk_register');
    // buyer pack must carry no AI call-outs at all
    expect(model.sections.some((s) => s.blocks.some((b) => b.type === 'callouts'))).toBe(false);
  });

  test('closing disclaimer is consumer-protection grade', () => {
    const para = firstBlock(model, 'closing', 'paragraph');
    expect(para.text).toMatch(/rera\.karnataka\.gov\.in/i);
    expect(para.text).toMatch(/not the promoter/i);
    expect(para.text).toMatch(/engage your own advocate/i);
  });
});

describe('buildReportPackDocx — investor + buyer render', () => {
  test('investor pack renders with returns + market + diagnostic headings', async () => {
    const buffer = await buildReportPackDocx(composePack(fullWorkspace(), 'investor'), {});
    expect(buffer.length).toBeGreaterThan(3000);
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Investor Briefing');
    expect(xml).toContain('Return Profile');
    expect(xml).toContain('Market Context');
    expect(xml).toContain('Knight Frank Q1 2026');
    expect(xml).toContain('Diagnostic Call-outs');
    expect(xml).toContain('no figures are model-generated');
  });

  test('buyer pack renders consumer headings + portal disclaimer', async () => {
    const buffer = await buildReportPackDocx(composePack(fullWorkspace(), 'buyer'), {});
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Buyer Information Pack');
    expect(xml).toContain('Project Overview');
    expect(xml).toContain('Professional Sign-offs');
    expect(xml).toContain('rera.karnataka.gov.in');
  });
});
