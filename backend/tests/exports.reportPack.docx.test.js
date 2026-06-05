'use strict';

/**
 * Renderer tests for the audience report-pack DOCX (RP1 — lender).
 * Mirrors the buildIcReadiness test: JSZip-extract word/document.xml and
 * substring-search the XML.
 */

const JSZip = require('jszip');
const { buildReportPackDocx } = require('../src/services/exports/docx/buildReportPackDocx');
const { composePack } = require('../src/services/exports/reportPack/composePack');

const extractDocumentXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  return file ? file.async('string') : null;
};

const richWorkspace = () => ({
  deal: { name: 'Whitefield Heights', asset_class: 'residential_apartments', city: 'Bengaluru', state: 'Karnataka', stage: 'evaluation', rera_number: 'PRM/KA/RERA/1251' },
  financial: {
    summary: { total_cost_cr: 442, total_revenue_cr: 637, gross_margin_pct: 30.6, exit_value_cr: 700, yield_on_cost_pct: 9.2, noi_cr: 41, project_duration_months: 36 },
    scenarios: { base: { kpis: { irr: 18.5, equityMultiple: 2.1, grossMarginPct: 30.6, npv: 120 } }, bear: { kpis: { irr: 11.2, equityMultiple: 1.4, grossMarginPct: 18.0, npv: 40 } } },
  },
  capital_stack_optimizer: {
    scenarios: [{ scenario: 'base', label: 'Base', debt_cr: 200, blended_cost_of_capital_pct: 13.5, mix: { equity_pct: 40 }, covenants: { ltv: { value: 0.45, threshold: 0.6, passes: true }, ltc: { value: 0.5, threshold: 0.65, passes: true }, dscr: { value: 1.45, threshold: 1.2, passes: true } } }],
  },
  karnataka_rera_readiness: {
    applicable: true, applicability: { status: 'in_scope' }, milestone: { phase: 'pre_registration' },
    overall: { completeness_pct: 55, readiness_tier: 'partial', blockers: [{ item_id: 'cc', item_label: 'Commencement Certificate' }] },
    buckets: [{ id: 'title_ownership', label: 'Title & Ownership', items: [{ id: 'title_deed', label: 'Registered title deed', evidence: { status: 'uploaded', evidence_label: 'Title_Deed.pdf' } }] }],
  },
  approvals: [{ id: 1, approval_type: 'fire_noc', name: 'Fire NOC (KFES)', is_available: true }],
  risk: { flags: [{ id: 'r1', severity: 'critical', status: 'open', title: 'Access road width below norm' }] },
});

describe('buildReportPackDocx — lender', () => {
  test('produces a non-empty Buffer', async () => {
    const model = composePack(richWorkspace(), 'lender');
    const buffer = await buildReportPackDocx(model, { brandName: 'REDIP', userName: 'Rachit Jain', generatedAt: '2026-06-05T03:30:00Z' });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(3000);
  });

  test('cover surfaces brand, deal name + lender framing', async () => {
    const buffer = await buildReportPackDocx(composePack(richWorkspace(), 'lender'), {});
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('REDIP');
    expect(xml).toContain('Whitefield Heights');
    expect(xml).toContain('Lender Briefing');
  });

  test('renders lender section headings + covenant verdict', async () => {
    const buffer = await buildReportPackDocx(composePack(richWorkspace(), 'lender'), {});
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Credit Summary');
    expect(xml).toContain('Covenant Posture');
    expect(xml).toContain('Downside &amp; Stress');
    expect(xml).toContain('Within covenant');
    expect(xml).toContain('60%'); // LTV covenant threshold
    expect(xml).toContain('Commencement Certificate'); // RERA fatal blocker
  });

  test('carries the quiet kernel/AI disclaimer + legal-four caveat', async () => {
    const buffer = await buildReportPackDocx(composePack(richWorkspace(), 'lender'), {});
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('no figures are model-generated');
    expect(xml).toContain('not a legal opinion');
    expect(xml).toContain('not a credit decision'); // closing disclaimer
  });

  test('empty workspace → short "not enough data" pack (no fabricated sections)', async () => {
    // applicable RERA off + no financial → most sections become notes, but the model still has them;
    // force a truly empty model to exercise the renderer fallback.
    const buffer = await buildReportPackDocx({ meta: { title: 'Empty Deal', docTitle: 'Lender Briefing' }, sections: [] }, {});
    const xml = await extractDocumentXml(buffer);
    expect(xml).toContain('Not enough data yet');
    expect(xml).not.toContain('Credit Summary');
  });

  test('throws without a pack model', async () => {
    await expect(buildReportPackDocx(null)).rejects.toThrow(/pack model is required/);
  });
});
