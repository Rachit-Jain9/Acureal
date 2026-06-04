'use strict';

/**
 * Unit tests for the deterministic K-RERA rule engine (Phase 4 substrate):
 * ruleEvaluator, applicability, feeEstimator, requirementComposer, and the
 * blocker / milestone behaviour of composeReadiness.
 */

const { evaluatePredicate, evaluateAll } = require('../src/services/rera/ruleEvaluator');
const { assessApplicability } = require('../src/services/rera/applicability');
const { estimateRegistrationFee } = require('../src/services/rera/feeEstimator');
const { composeRequirements } = require('../src/services/rera/requirementComposer');
const { buildReraContext, deriveLandAreaSqm, deriveIsJoint } = require('../src/services/rera/complianceContext');
const r = require('../src/services/karnatakaReraReadiness.service');

const itemIds = (out) => out.buckets.flatMap((b) => b.items.map((i) => i.id));

// ─── ruleEvaluator ──────────────────────────────────────────────────────────
describe('ruleEvaluator', () => {
  test('numeric comparisons', () => {
    expect(evaluatePredicate({ field: 'a', op: 'gt', value: 5 }, { a: 10 }).result).toBe(true);
    expect(evaluatePredicate({ field: 'a', op: 'gt', value: 5 }, { a: 2 }).result).toBe(false);
    expect(evaluatePredicate({ field: 'a', op: 'gte', value: 5 }, { a: 5 }).result).toBe(true);
    expect(evaluatePredicate({ field: 'a', op: 'lt', value: 5 }, { a: 2 }).result).toBe(true);
    expect(evaluatePredicate({ field: 'a', op: 'lte', value: 5 }, { a: 5 }).result).toBe(true);
  });

  test('numeric comparison on an unknown field is UNKNOWN (null), never false', () => {
    expect(evaluatePredicate({ field: 'a', op: 'gt', value: 5 }, {}).result).toBeNull();
    expect(evaluatePredicate({ field: 'a', op: 'gt', value: 5 }, { a: null }).result).toBeNull();
  });

  test('eq / neq / in / nin', () => {
    expect(evaluatePredicate({ field: 'x', op: 'eq', value: 'a' }, { x: 'a' }).result).toBe(true);
    expect(evaluatePredicate({ field: 'x', op: 'neq', value: 'a' }, { x: 'b' }).result).toBe(true);
    expect(evaluatePredicate({ field: 'x', op: 'in', value: ['a', 'b'] }, { x: 'a' }).result).toBe(true);
    expect(evaluatePredicate({ field: 'x', op: 'nin', value: ['a', 'b'] }, { x: 'c' }).result).toBe(true);
  });

  test('exists / truthy are meaningful on absence', () => {
    expect(evaluatePredicate({ field: 'x', op: 'exists' }, { x: 'v' }).result).toBe(true);
    expect(evaluatePredicate({ field: 'x', op: 'exists' }, {}).result).toBe(false);
    expect(evaluatePredicate({ field: 'x', op: 'truthy' }, { x: true }).result).toBe(true);
    expect(evaluatePredicate({ field: 'x', op: 'truthy' }, { x: false }).result).toBe(false);
  });

  test('evaluateAll is an AND with a human-readable trace', () => {
    const ctx = { assetClass: 'residential_apartments', isJoint: true };
    const res = evaluateAll(
      [
        { field: 'assetClass', op: 'in', value: ['residential_apartments', 'villas'] },
        { field: 'isJoint', op: 'eq', value: true },
      ],
      ctx,
    );
    expect(res.passed).toBe(true);
    expect(res.trace).toHaveLength(2);
    expect(typeof res.trace[0].text).toBe('string');
  });

  test('evaluateAll fails when any predicate fails or is unknown', () => {
    expect(evaluateAll([{ field: 'isJoint', op: 'eq', value: true }], { isJoint: false }).passed).toBe(false);
    const unknown = evaluateAll([{ field: 'landAreaSqm', op: 'gt', value: 500 }], {});
    expect(unknown.passed).toBe(false);
    expect(unknown.anyUnknown).toBe(true);
  });
});

// ─── applicability ─────────────────────────────────────────────────────────
describe('assessApplicability', () => {
  test('registrable + area over threshold → in_scope', () => {
    const a = assessApplicability({ assetClass: 'residential_apartments', landAreaSqm: 1200 });
    expect(a.status).toBe('in_scope');
    expect(Array.isArray(a.rule_trace)).toBe(true);
  });

  test('registrable + units over threshold → in_scope', () => {
    expect(assessApplicability({ assetClass: 'villas', unitOrPlotCount: 12 }).status).toBe('in_scope');
  });

  test('both thresholds known and below → likely_exempt', () => {
    const a = assessApplicability({ assetClass: 'residential_apartments', landAreaSqm: 300, unitOrPlotCount: 4 });
    expect(a.status).toBe('likely_exempt');
  });

  test('sale-intent explicitly false → likely_exempt', () => {
    expect(assessApplicability({ assetClass: 'residential_apartments', saleIntent: false }).status).toBe('likely_exempt');
  });

  test('no inputs → uncertain (conservative)', () => {
    expect(assessApplicability({ assetClass: 'residential_apartments' }).status).toBe('uncertain');
  });

  test('unmapped / missing asset class → na', () => {
    expect(assessApplicability({ assetClass: 'space_elevator' }).status).toBe('na');
    expect(assessApplicability({}).status).toBe('na');
  });

  test('already-registered (RERA number) → in_scope with signal', () => {
    const a = assessApplicability({ assetClass: 'residential_apartments', reraNumber: 'PRM/KA/RERA/1251/446/PR/0001' });
    expect(a.status).toBe('in_scope');
    expect(a.signals.already_registered).toBe(true);
  });

  test('HARD RULE: commercial + sale-intent + area over 500 → in_scope (not exempt)', () => {
    expect(assessApplicability({ assetClass: 'commercial_office', landAreaSqm: 900, saleIntent: true }).status).toBe('in_scope');
  });

  test('hospitality with no positive sale-intent → likely_exempt by nature', () => {
    expect(assessApplicability({ assetClass: 'hospitality' }).status).toBe('likely_exempt');
  });
});

// ─── feeEstimator ───────────────────────────────────────────────────────────
describe('estimateRegistrationFee', () => {
  test('group housing ≤1000 sqm → ₹5/sqm', () => {
    const f = estimateRegistrationFee({ assetClass: 'residential_apartments', landAreaSqm: 800 });
    expect(f.rate_applied_inr_per_sqm).toBe(5);
    expect(f.fee_inr).toBe(4000);
    expect(f.category).toBe('group_housing');
  });

  test('group housing >1000 sqm → ₹10/sqm', () => {
    const f = estimateRegistrationFee({ assetClass: 'residential_apartments', landAreaSqm: 1500 });
    expect(f.rate_applied_inr_per_sqm).toBe(10);
    expect(f.fee_inr).toBe(15000);
  });

  test('fee is capped', () => {
    const f = estimateRegistrationFee({ assetClass: 'residential_apartments', landAreaSqm: 200000 });
    expect(f.capped).toBe(true);
    expect(f.fee_inr).toBe(500000);
  });

  test('commercial uses the higher rates + cap', () => {
    const f = estimateRegistrationFee({ assetClass: 'commercial_office', landAreaSqm: 2000 });
    expect(f.rate_applied_inr_per_sqm).toBe(25);
    expect(f.fee_inr).toBe(50000);
  });

  test('manual override is honoured + recorded', () => {
    const f = estimateRegistrationFee({ assetClass: 'mixed_use', landAreaSqm: 1500, feeOverrides: { amount_inr: 123456, note: 'as quoted' } });
    expect(f.is_overridden).toBe(true);
    expect(f.fee_inr).toBe(123456);
  });

  test('null area → no fee + reason', () => {
    const f = estimateRegistrationFee({ assetClass: 'residential_apartments', landAreaSqm: null });
    expect(f.fee_inr).toBeNull();
    expect(f.reason).toMatch(/land area/i);
  });

  test('no fee category for hospitality / raw_land', () => {
    expect(estimateRegistrationFee({ assetClass: 'hospitality', landAreaSqm: 5000 }).fee_inr).toBeNull();
  });

  test('carries schedule provenance + disclaimer', () => {
    const f = estimateRegistrationFee({ assetClass: 'plotted_development', landAreaSqm: 800 });
    expect(f.version).toBeTruthy();
    expect(f.last_verified).toBeTruthy();
    expect(f.disclaimer).toMatch(/estimate/i);
  });
});

// ─── requirementComposer — asset-class + JDA tailoring ─────────────────────
describe('composeRequirements tailoring', () => {
  test('apartments get the sanctioned building plan, NOT the plotted layout approval', () => {
    const ids = composeRequirements({ assetClass: 'residential_apartments' }).flatMap((b) => b.items.map((i) => i.id));
    expect(ids).toContain('sanctioned_building_plan');
    expect(ids).not.toContain('layout_approval');
  });

  test('plotted development gets layout approval + plot schedule, NOT the building plan', () => {
    const ids = composeRequirements({ assetClass: 'plotted_development' }).flatMap((b) => b.items.map((i) => i.id));
    expect(ids).toContain('layout_approval');
    expect(ids).toContain('plot_schedule');
    expect(ids).not.toContain('sanctioned_building_plan');
  });

  test('JDA overlay appears only for a joint development', () => {
    const joint = composeRequirements({ assetClass: 'residential_apartments', isJoint: true }).flatMap((b) => b.items.map((i) => i.id));
    const solo = composeRequirements({ assetClass: 'residential_apartments', isJoint: false }).flatMap((b) => b.items.map((i) => i.id));
    expect(joint).toContain('registered_jda');
    expect(solo).not.toContain('registered_jda');
  });
});

// ─── composeReadiness — blockers, fee, milestone (engine-level) ────────────
describe('composeReadiness — blockers / fee / milestone', () => {
  test('applicable payload carries applicability + fee_estimate + milestone', () => {
    const out = r.composeReadiness({ assetClass: 'residential_apartments', landAreaSqm: 1200, saleIntent: true });
    expect(out.applicability.status).toBe('in_scope');
    expect(out.fee_estimate).toBeTruthy();
    expect(out.fee_estimate.fee_inr).toBe(12000); // 1200 sqm × ₹10
    expect(out.milestone.phase).toBe('pre_registration');
  });

  test('a near-complete deck missing a fatal blocker is BLOCKED and score-capped', () => {
    // Cover lots of items via documents, but deliberately provide NO building
    // plan / commencement evidence (both fatal blockers for a building project).
    const documents = [
      { id: 'd1', name: 'Title_Deed.pdf' },
      { id: 'd2', name: 'EC_30yr.pdf' },
      { id: 'd3', name: 'Khata_extract.pdf' },
      { id: 'd4', name: 'Mutation_RTC.pdf' },
      { id: 'd5', name: 'Escrow_account_letter.pdf' },
      { id: 'd6', name: 'Promoter_PAN.pdf' },
      { id: 'd7', name: 'Promoter_GST.pdf' },
      { id: 'd8', name: 'Form-A_Application.pdf' },
      { id: 'd9', name: 'Form-B_Declaration.pdf' },
      { id: 'd10', name: 'Layout_Plan_with_specs.pdf' },
      { id: 'd11', name: 'Amenities_list.pdf' },
      { id: 'd12', name: 'Project_Schedule.pdf' },
      { id: 'd13', name: 'Architect_appointment.pdf' },
      { id: 'd14', name: 'Engineer_appointment.pdf' },
      { id: 'd15', name: 'CA_appointment.pdf' },
    ];
    const out = r.composeReadiness({ assetClass: 'residential_apartments', landAreaSqm: 1200, saleIntent: true, documents });
    // Blockers present: sanctioned_building_plan + commencement_certificate.
    expect(out.overall.is_blocked).toBe(true);
    expect(out.overall.blockers.map((b) => b.item_id)).toEqual(
      expect.arrayContaining(['sanctioned_building_plan', 'commencement_certificate']),
    );
    expect(out.overall.completeness_pct).toBe(Math.min(out.overall.raw_completeness_pct, r.BLOCK_CAP_PCT));
    if (out.overall.raw_completeness_pct > r.BLOCK_CAP_PCT) {
      expect(out.overall.readiness_tier).toBe('blocked');
    }
  });

  test('all blockers satisfied → not blocked', () => {
    const approvals = [
      { id: 1, approval_type: 'building_plan', name: 'Sanctioned Building Plan', is_validated: true },
    ];
    const documents = [
      { id: 'd1', name: 'Title_Deed.pdf' },
      { id: 'd2', name: 'Escrow_account_letter.pdf' },
    ];
    const out = r.composeReadiness({ assetClass: 'residential_apartments', landAreaSqm: 1200, saleIntent: true, approvals, documents });
    expect(out.overall.is_blocked).toBe(false);
  });

  test('milestone = post_registration when a RERA number is on file', () => {
    const out = r.composeReadiness({ assetClass: 'residential_apartments', reraNumber: 'PRM/KA/RERA/1251/446/PR/0001' });
    expect(out.milestone.phase).toBe('post_registration');
  });
});

// ─── complianceContext derivations ──────────────────────────────────────────
describe('buildReraContext', () => {
  test('derives land area in sqm from acres', () => {
    const sqm = deriveLandAreaSqm({ land_extent_input_value: 1, land_extent_input_unit: 'acre' });
    // 1 acre = 43,560 sqft ≈ 4046.86 sqm
    expect(Math.round(sqm)).toBe(4047);
  });

  test('derives joint-development from deal_type / structure / split', () => {
    expect(deriveIsJoint({ deal_type: 'jv' })).toBe(true);
    expect(deriveIsJoint({ deal_structure: 'jda_area_share' })).toBe(true);
    expect(deriveIsJoint({ jv_split_landowner_pct: 40 })).toBe(true);
    expect(deriveIsJoint({ deal_type: 'outright' })).toBe(false);
  });

  test('reads rera_inputs + rera number off the deal', () => {
    const ctx = buildReraContext(
      { asset_class: 'residential_apartments', rera_number: 'PRM/X', rera_inputs: { unit_or_plot_count: 40, sale_intent: true } },
      { approvals: [], documents: [] },
    );
    expect(ctx.assetClass).toBe('residential_apartments');
    expect(ctx.unitOrPlotCount).toBe(40);
    expect(ctx.saleIntent).toBe(true);
    expect(ctx.reraNumber).toBe('PRM/X');
  });
});
