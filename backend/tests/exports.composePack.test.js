'use strict';

/**
 * Unit tests for the pure report-pack composer (lender audience — RP1).
 * No docx, no DB — just workspace payload → normalized pack model.
 */

const {
  composePack, SECTION_COMPOSERS, baseCapitalScenario, scenarioKpis, approvalStatus, finSummary,
} = require('../src/services/exports/reportPack/composePack');

const richWorkspace = () => ({
  deal: {
    name: 'Whitefield Heights', asset_class: 'residential_apartments',
    city: 'Bengaluru', state: 'Karnataka', stage: 'evaluation',
    parcel_address: 'Survey 12, Whitefield', rera_number: 'PRM/KA/RERA/1251/446/PR/000123',
  },
  financial: {
    summary: {
      total_cost_cr: 442, total_revenue_cr: 637, gross_margin_pct: 30.6,
      exit_value_cr: 700, yield_on_cost_pct: 9.2, noi_cr: 41, project_duration_months: 36,
    },
    scenarios: {
      base: { kpis: { irr: 18.5, equityMultiple: 2.1, grossMarginPct: 30.6, npv: 120 } },
      bear: { kpis: { irr: 11.2, equityMultiple: 1.4, grossMarginPct: 18.0, npv: 40 } },
    },
  },
  capital_stack_optimizer: {
    scenarios: [{
      scenario: 'base', label: 'Base', debt_cr: 200, blended_cost_of_capital_pct: 13.5,
      mix: { equity_pct: 40 },
      covenants: {
        ltv: { value: 0.45, threshold: 0.6, passes: true },
        ltc: { value: 0.5, threshold: 0.65, passes: true },
        dscr: { value: 1.45, threshold: 1.2, passes: true },
      },
    }],
  },
  karnataka_rera_readiness: {
    applicable: true,
    applicability: { status: 'in_scope' },
    milestone: { phase: 'pre_registration' },
    overall: { completeness_pct: 55, readiness_tier: 'partial', blockers: [{ item_id: 'commencement_certificate', item_label: 'Commencement Certificate' }] },
    buckets: [{
      id: 'title_ownership', label: 'Title & Ownership',
      items: [
        { id: 'title_deed', label: 'Registered title deed', evidence: { status: 'uploaded', evidence_label: 'Title_Deed.pdf' }, recommended_action: 'Upload the registered deed' },
        { id: 'ec', label: 'Encumbrance certificate', evidence: { status: 'missing' }, recommended_action: 'Obtain a 30-year EC' },
      ],
    }],
  },
  approvals: [
    { id: 1, approval_type: 'fire_noc', name: 'Fire NOC (KFES)', is_available: true, reference_number: 'KFES-22', expiry_date: '2027-03-31' },
    { id: 2, approval_type: 'khata', name: 'Khata Certificate', is_validated: true },
  ],
  risk: {
    flags: [
      { id: 'r1', severity: 'critical', status: 'open', title: 'Access road width below norm', mitigation: 'Confirm BBMP road widening' },
      { id: 'r2', severity: 'low', status: 'open', title: 'Minor naming mismatch' },
    ],
  },
});

const findSection = (model, id) => model.sections.find((s) => s.id === id);
const blocksOf = (model, id) => (findSection(model, id) || {}).blocks || [];
const firstBlock = (model, id, type) => blocksOf(model, id).find((b) => b.type === type);

describe('composePack — accessors', () => {
  test('approvalStatus maps evidence-maturity flags', () => {
    expect(approvalStatus({ is_validated: true })).toBe('verified');
    expect(approvalStatus({ is_uploaded: true })).toBe('uploaded');
    expect(approvalStatus({ is_available: true })).toBe('available');
    expect(approvalStatus({})).toBe('pending');
  });
  test('baseCapitalScenario prefers the base scenario', () => {
    const ws = richWorkspace();
    expect(baseCapitalScenario(ws).scenario).toBe('base');
    expect(baseCapitalScenario({})).toBeNull();
  });
  test('scenarioKpis reads the requested scenario', () => {
    expect(scenarioKpis(richWorkspace(), 'bear').irr).toBe(11.2);
    expect(scenarioKpis({}, 'bear')).toBeNull();
  });
});

describe('composePack — lender, rich workspace', () => {
  const model = composePack(richWorkspace(), 'lender');

  test('meta is framed for the lender', () => {
    expect(model.audience).toBe('lender');
    expect(model.meta.docTitle).toBe('Lender Briefing');
    expect(model.meta.title).toBe('Whitefield Heights');
    expect(model.meta.subtitle).toContain('Residential Apartments');
    expect(model.meta.subtitle).toContain('Bengaluru, Karnataka');
  });

  test('emits the expected lender sections in order', () => {
    const ids = model.sections.map((s) => s.id);
    expect(ids).toEqual([
      'credit_summary', 'covenant_posture', 'downside_stress', 'security_title',
      'statutory_approvals', 'rera_registration', 'risk_register', 'repayment_exit', 'closing',
    ]);
  });

  test('credit summary KPI grid carries kernel numbers + covenant tone', () => {
    const grid = firstBlock(model, 'credit_summary', 'kpiGrid');
    expect(grid).toBeTruthy();
    const ltv = grid.items.find((i) => i.label === 'LTV (base)');
    expect(ltv.value).toBe('45%');
    expect(ltv.tone).toBe('positive');
    const dscr = grid.items.find((i) => i.label === 'DSCR (base)');
    expect(dscr.value).toBe('1.45x');
    expect(grid.items.find((i) => i.label === 'Project cost').value).toBe('INR 442 Cr');
  });

  test('covenant posture table formats ratios and flags pass/fail', () => {
    const table = firstBlock(model, 'covenant_posture', 'table');
    const ltvRow = table.rows.find((r) => r[0] === 'Loan-to-value (LTV)');
    expect(ltvRow[1]).toBe('45%');
    expect(ltvRow[2]).toBe('≤ 60%');
    expect(ltvRow[3].text).toBe('Within covenant');
    expect(ltvRow[3].tone).toBe('positive');
    const dscrRow = table.rows.find((r) => r[0].includes('DSCR'));
    expect(dscrRow[1]).toBe('1.45x');
    expect(dscrRow[2]).toBe('≥ 1.2x');
  });

  test('downside table contrasts base vs bear', () => {
    const table = firstBlock(model, 'downside_stress', 'table');
    const irrRow = table.rows.find((r) => r[0] === 'IRR');
    expect(irrRow[1].text).toBe('18.5%');
    expect(irrRow[2].text).toBe('11.2%');
    expect(irrRow[2].tone).toBe('warning');
  });

  test('security & title is documentary status only + carries the counsel caveat', () => {
    const blocks = blocksOf(model, 'security_title');
    const statusList = blocks.find((b) => b.type === 'statusList');
    expect(statusList.items).toHaveLength(2);
    expect(statusList.items[0].status).toBe('uploaded');
    // no callouts / paragraph-recommendations on the legal-four lane
    expect(blocks.some((b) => b.type === 'callouts')).toBe(false);
    expect(blocks.some((b) => b.type === 'note' && /not a legal opinion/i.test(b.text))).toBe(true);
  });

  test('RERA registration shows status + fatal blocker, never a verdict', () => {
    const kv = firstBlock(model, 'rera_registration', 'keyValue');
    expect(kv.rows.find((r) => r[0] === 'Registration number')[1]).toContain('PRM/KA/RERA');
    const flags = firstBlock(model, 'rera_registration', 'flagList');
    expect(flags.items).toHaveLength(1);
    expect(flags.items[0].title).toBe('Commencement Certificate');
    const blocks = blocksOf(model, 'rera_registration');
    expect(blocks.some((b) => b.type === 'note' && /never a statement/i.test(b.text))).toBe(true);
  });

  test('risk register keeps only open critical/high flags', () => {
    const flags = firstBlock(model, 'risk_register', 'flagList');
    expect(flags.items).toHaveLength(1);
    expect(flags.items[0].severity).toBe('critical');
  });

  test('closing section carries the lender disclaimer', () => {
    const para = firstBlock(model, 'closing', 'paragraph');
    expect(para.text).toMatch(/organisation aid/i);
    expect(para.text).toMatch(/not a credit decision/i);
  });
});

describe('composePack — honest empty states', () => {
  test('empty workspace still renders sections with honest notes; omits RERA', () => {
    const model = composePack({}, 'lender');
    const ids = model.sections.map((s) => s.id);
    expect(ids).toContain('credit_summary');
    expect(ids).not.toContain('rera_registration'); // not applicable → omitted
    const credit = blocksOf(model, 'credit_summary');
    expect(credit.some((b) => b.type === 'note' && /not yet run/i.test(b.text))).toBe(true);
    // risk register shows the positive empty state
    const flags = firstBlock(model, 'risk_register', 'flagList');
    expect(flags.items).toHaveLength(0);
    expect(flags.emptyText).toMatch(/no open critical/i);
  });

  test('unknown audience throws', () => {
    expect(() => composePack(richWorkspace(), 'nope')).toThrow(/unknown audience/i);
  });

  test('every catalogued section id has a composer', () => {
    // guards against a catalog entry with no matching composer
    const ws = richWorkspace();
    for (const s of composePack(ws, 'lender').sections) {
      expect(typeof SECTION_COMPOSERS[s.id]).toBe('function');
    }
  });
});

describe('composePack — finSummary accessor', () => {
  test('reads the kernel summary', () => {
    expect(finSummary(richWorkspace()).total_cost_cr).toBe(442);
    expect(finSummary({})).toBeNull();
  });
});
