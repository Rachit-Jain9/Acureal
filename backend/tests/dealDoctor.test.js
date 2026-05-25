'use strict';

const {
  DIAGNOSIS_VERBS,
  DIAGNOSTIC_GROUPS,
  DIAGNOSTIC_RULES,
  generateDiagnoses,
  generateForWorkspace,
} = require('../src/services/recommendation/dealDoctor');

const makeWorkspace = (overrides = {}) => ({
  deal: {
    id: 'deal-doctor-1',
    asset_class: 'residential_apartments',
    deal_structure: 'jda',
    stage: 'underwriting',
    ...overrides.deal,
  },
  financial: { summary: { kpis: overrides.kpis || null } },
  comps: { entries: overrides.comps || [] },
  approvals: overrides.approvals || [],
  dd: { items: overrides.ddItems || [] },
  risk: { flags: overrides.riskFlags || [] },
});

describe('Deal Doctor — verbs + groups', () => {
  test('uses the six allowed diagnostic verbs', () => {
    expect(DIAGNOSIS_VERBS).toEqual(
      expect.arrayContaining(['Diverges', 'Lacks support', 'Inconsistent', 'Below benchmark', 'Above benchmark', 'Missing']),
    );
    expect(DIAGNOSIS_VERBS.length).toBe(6);
  });

  test('every rule uses one of the six allowed verbs', () => {
    for (const rule of DIAGNOSTIC_RULES) {
      expect(DIAGNOSIS_VERBS).toContain(rule.verb);
    }
  });

  test('diagnostic groups exist with the expected keys', () => {
    expect(Object.keys(DIAGNOSTIC_GROUPS)).toEqual(
      expect.arrayContaining(['underwriting', 'market', 'execution', 'legal']),
    );
    expect(DIAGNOSTIC_GROUPS.legal.ai_narratable).toBe(false);
  });
});

describe('Deal Doctor — generateDiagnoses', () => {
  test('empty signals → empty findings + empty groups', () => {
    expect(generateDiagnoses([])).toEqual({ findings: [], groups: [] });
    expect(generateDiagnoses(null)).toEqual({ findings: [], groups: [] });
  });

  test('produces findings from a realistic signal set', () => {
    const signals = [
      { kind: 'land_cost_share_of_gdv', value: 0.38, evidence: [], meta: { ratio_pct: 38 } },
      { kind: 'irr_vs_hurdle', value: { irr: 0.12, hurdle: 0.16, gap: -0.04, gap_bps: -400 }, evidence: [], meta: { gap_bps: -400, hurdle: 0.16, irr: 0.12 } },
      { kind: 'price_vs_comp_band', value: { assumed: 13200, comp_median: 11200, deviation_pct: 0.179, n_comps: 5 }, evidence: [], meta: { assumed: 13200, comp_median: 11200, deviation_pct: 17.9, n_comps: 5 } },
      { kind: 'rera_registration_missing', value: { reason: 'no_entry' }, evidence: [], meta: { reason: 'no_entry' } },
    ];
    const { findings, groups } = generateDiagnoses(signals);
    expect(findings.length).toBeGreaterThanOrEqual(4);
    // Groups should contain at least underwriting, market, legal.
    const groupKeys = groups.map((g) => g.key);
    expect(groupKeys).toContain('underwriting');
    expect(groupKeys).toContain('market');
    expect(groupKeys).toContain('legal');
  });

  test('legal-carve-out findings have ai_narratable: false', () => {
    const signals = [
      { kind: 'rera_registration_missing', value: { reason: 'no_entry' }, evidence: [], meta: { reason: 'no_entry' } },
      { kind: 'approval_gap_count', value: { required_open: 3, required_total: 8 }, evidence: [], meta: {} },
    ];
    const { findings } = generateDiagnoses(signals);
    const legalFindings = findings.filter((f) => f.topic.startsWith('legal_'));
    expect(legalFindings.length).toBeGreaterThan(0);
    for (const f of legalFindings) {
      expect(f.ai_narratable).toBe(false);
    }
  });

  test('findings are sorted by severity descending', () => {
    const signals = [
      { kind: 'overdue_dd_count', value: { count: 1 }, evidence: [], meta: { count: 1 } },
      { kind: 'rera_registration_missing', value: { reason: 'no_entry' }, evidence: [], meta: { reason: 'no_entry' } },
    ];
    const { findings } = generateDiagnoses(signals);
    for (let i = 1; i < findings.length; i += 1) {
      expect(findings[i - 1].severity).toBeGreaterThanOrEqual(findings[i].severity);
    }
  });
});

describe('Deal Doctor — generateForWorkspace', () => {
  test('empty workspace yields zero findings', async () => {
    const out = await generateForWorkspace(null);
    expect(out.findings).toEqual([]);
    expect(out.groups).toEqual([]);
    expect(out.finding_count).toBe(0);
  });

  test('a realistic deal produces multi-group findings', async () => {
    const ws = makeWorkspace({
      deal: {
        asset_class: 'residential_apartments',
        sales_price_per_sqft: 13200,
        absorption_units_per_quarter: 28,
      },
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
      comps: [
        { price_per_sqft: 11000, absorption_units_per_quarter: 12 },
        { price_per_sqft: 11100, absorption_units_per_quarter: 13 },
        { price_per_sqft: 11200, absorption_units_per_quarter: 14 },
        { price_per_sqft: 11300, absorption_units_per_quarter: 13 },
      ],
      approvals: [],
    });
    const out = await generateForWorkspace(ws);
    expect(out.findings.length).toBeGreaterThanOrEqual(4);
    const groupKeys = out.groups.map((g) => g.key);
    expect(groupKeys).toContain('underwriting');
    expect(groupKeys).toContain('market');
    expect(groupKeys).toContain('legal'); // RERA missing
  });

  test('narrator hook is honoured only for ai_narratable findings', async () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'residential_apartments' },
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
      approvals: [],
    });
    const seen = [];
    const out = await generateForWorkspace(ws, {
      narrate: async (card) => {
        seen.push({ id: card.id, ai_narratable: card.ai_narratable });
        return { finding: `[N]${card.finding}`, why_it_matters: card.why_it_matters };
      },
    });
    // Legal findings must NOT be narrated
    const legalSeen = seen.filter((s) => s.id.startsWith('rera-') || s.id.startsWith('statutory-'));
    expect(legalSeen).toEqual([]);
    // At least one non-legal finding must be narrated
    const narratedFinding = out.findings.find((f) => f.finding?.startsWith('[N]'));
    expect(narratedFinding).toBeTruthy();
    expect(narratedFinding.narrated).toBe(true);
  });

  test('tone gate rejection falls back to the deterministic template', async () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'residential_apartments' },
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
      approvals: [],
    });
    const out = await generateForWorkspace(ws, {
      narrate: async (card) => ({ finding: `THIS DEAL IS DEAD ${card.finding}`, why_it_matters: card.why_it_matters }),
      toneGate: async () => false, // reject everything
    });
    // No finding should have the rejected narration; all should be deterministic templates.
    for (const f of out.findings.filter((f) => f.ai_narratable)) {
      expect(f.finding).not.toMatch(/^THIS DEAL IS DEAD/);
      expect(f.narrated).toBeUndefined();
    }
  });

  test('per-card narrator failure does not cascade', async () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'residential_apartments' },
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
    });
    const out = await generateForWorkspace(ws, {
      narrate: async () => { throw new Error('boom'); },
    });
    expect(out.findings.length).toBeGreaterThan(0);
  });
});
