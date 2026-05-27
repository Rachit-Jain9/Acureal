'use strict';

/**
 * Unit tests for icReadiness.service.js — Phase 3 / Pillar 5.
 *
 * Same patterns as Pillar 4's readiness tests — deterministic composer,
 * every detect function exercised, bucket summarisation pinned, empty
 * states honest.
 */

const r = require('../src/services/icReadiness.service');

describe('composeReadiness — applicability + shape', () => {
  test('returns applicable=true for every deal regardless of asset class', () => {
    for (const ac of ['residential_apartments', 'commercial_office', 'industrial_warehousing', 'hospitality', 'plotted_development', null, undefined]) {
      const out = r.composeReadiness({ deal: { asset_class: ac } });
      expect(out.applicable).toBe(true);
      expect(out.buckets.length).toBe(7);
    }
  });

  test('every item has required fields after composition', () => {
    const out = r.composeReadiness({ deal: { asset_class: 'residential_apartments' } });
    for (const bucket of out.buckets) {
      expect(bucket.id).toBeTruthy();
      expect(bucket.label).toBeTruthy();
      for (const item of bucket.items) {
        expect(item.id).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(typeof item.weight).toBe('number');
        expect(item.evidence).toBeDefined();
        expect(item.evidence.status).toBeTruthy();
        expect(item.status_label).toBeTruthy();
      }
    }
  });

  test('total weight across all items sums to exactly 100', () => {
    let total = 0;
    for (const bucket of r.BUCKETS) {
      for (const item of bucket.items) {
        total += item.weight;
      }
    }
    expect(total).toBe(100);
  });

  test('item ids are unique across all buckets', () => {
    const seen = new Set();
    for (const bucket of r.BUCKETS) {
      for (const item of bucket.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
    }
  });

  test('exposes the CLAUDE.md disclaimer', () => {
    const out = r.composeReadiness({ deal: { asset_class: 'residential_apartments' } });
    expect(out.disclaimer).toMatch(/organisation aid/i);
    expect(out.disclaimer).toMatch(/NOT represent.*Investment Committee/i);
  });
});

// ─── Empty-state composition ───────────────────────────────────────────────

describe('composeReadiness — empty data', () => {
  test('completely empty ctx → very low completeness; tier "early"', () => {
    const out = r.composeReadiness({ deal: { asset_class: 'residential_apartments' } });
    // A few items correctly resolve to "verified" via not-applicable
    // paths (e.g., JDA/PoA for non-JDA/JV deals) — so we expect a low
    // but non-zero score. Anything ≤15% is still "early" tier.
    expect(out.overall.completeness_pct).toBeLessThanOrEqual(15);
    expect(out.overall.readiness_tier).toBe('early');
    expect(out.overall.by_status.missing).toBeGreaterThan(0);
  });

  test('gaps list is sorted by weight descending', () => {
    const out = r.composeReadiness({ deal: { asset_class: 'residential_apartments' } });
    for (let i = 1; i < out.gaps.length; i += 1) {
      expect(out.gaps[i].weight).toBeLessThanOrEqual(out.gaps[i - 1].weight);
    }
  });

  test('top gaps include the critical items (weight ≥ 5)', () => {
    const out = r.composeReadiness({ deal: { asset_class: 'residential_apartments' } });
    const criticalGaps = out.gaps.filter((g) => g.severity === 'critical');
    expect(criticalGaps.length).toBeGreaterThan(0);
    // Some specific items I'd expect to be critical when missing
    const ids = criticalGaps.map((g) => g.item_id);
    expect(ids).toEqual(expect.arrayContaining(['kernel_ran', 'title_deed', 'encumbrance_certificate']));
  });
});

// ─── Financial Underwriting bucket detect functions ────────────────────────

describe('Financial Underwriting detect functions', () => {
  test('kernel_ran is verified when costs + revenue both present', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      financial: {
        summary: {
          model_params: {
            costs: { totalCr: 100, landCr: 30, constructionCr: 50 },
            revenue: { totalRevenueCr: 150 },
            kpis: { irr: 18.5, dscr: 1.7 },
          },
          irr_pct: 18.5,
        },
        scenarios: { base: { irr_pct: 18.5 }, bull: { irr_pct: 22 }, bear: { irr_pct: 12 } },
      },
    });
    const finBucket = out.buckets.find((b) => b.id === 'financial_underwriting');
    const kernel = finBucket.items.find((i) => i.id === 'kernel_ran');
    expect(kernel.evidence.status).toBe('verified');
    const irr = finBucket.items.find((i) => i.id === 'irr_present');
    expect(irr.evidence.status).toBe('verified');
    expect(irr.evidence.evidence_label).toMatch(/18.50%/);
    const dscr = finBucket.items.find((i) => i.id === 'dscr_present');
    expect(dscr.evidence.status).toBe('verified');
    const scenarios = finBucket.items.find((i) => i.id === 'scenarios_run');
    expect(scenarios.evidence.status).toBe('verified');
    expect(scenarios.evidence.evidence_label).toMatch(/3 of 3/);
  });

  test('scenarios_run is uploaded when only some scenarios present', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      financial: {
        scenarios: { base: { kpis: { irr: 18 } } }, // only base
      },
    });
    const item = out.buckets
      .find((b) => b.id === 'financial_underwriting')
      .items.find((i) => i.id === 'scenarios_run');
    expect(item.evidence.status).toBe('uploaded');
    expect(item.evidence.evidence_label).toMatch(/1 of 3/);
  });

  test('land_cost_isolated is missing when land cost is null or zero', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      financial: { summary: { model_params: { costs: { totalCr: 100 } } } },
    });
    const item = out.buckets
      .find((b) => b.id === 'financial_underwriting')
      .items.find((i) => i.id === 'land_cost_isolated');
    expect(item.evidence.status).toBe('missing');
  });
});

// ─── Title & Legal bucket detect functions ─────────────────────────────────

describe('Title & Legal detect functions', () => {
  test('title_deed picks up sale-deed document by name', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      documents: [{ id: 'd1', name: 'Sale_Deed_Whitefield.pdf' }],
    });
    const item = out.buckets
      .find((b) => b.id === 'title_legal')
      .items.find((i) => i.id === 'title_deed');
    expect(item.evidence.status).toBe('uploaded');
    expect(item.evidence.evidence_label).toMatch(/title-deed doc/);
  });

  test('khata_or_mutation picks up Khata approval over Khata doc', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      approvals: [{ id: 1, approval_type: 'khata', name: 'Khata Certificate', is_validated: true }],
      documents: [{ id: 'd1', name: 'Khata_Extract.pdf' }],
    });
    const item = out.buckets
      .find((b) => b.id === 'title_legal')
      .items.find((i) => i.id === 'khata_or_mutation');
    // Approval source preferred over document
    expect(item.evidence.status).toBe('verified');
    expect(item.evidence.source).toBe('approval');
  });

  test('jda_or_poa is verified (not applicable) for outright deals', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments', deal_structure: 'outright' },
    });
    const item = out.buckets
      .find((b) => b.id === 'title_legal')
      .items.find((i) => i.id === 'jda_or_poa_registered');
    expect(item.evidence.status).toBe('verified');
    expect(item.evidence.evidence_label).toMatch(/Not applicable/);
  });

  test('jda_or_poa is missing for JDA structure without docs', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments', deal_structure: 'jda' },
    });
    const item = out.buckets
      .find((b) => b.id === 'title_legal')
      .items.find((i) => i.id === 'jda_or_poa_registered');
    expect(item.evidence.status).toBe('missing');
  });
});

// ─── Statutory Approvals bucket detect functions ───────────────────────────

describe('Statutory Approvals detect functions', () => {
  test('required_approvals_baseline at 100% Available+ → verified', () => {
    const approvals = [
      { id: 1, approval_type: 'fire_noc', name: 'Fire NOC', is_required: true, is_available: true },
      { id: 2, approval_type: 'building_plan', name: 'Sanctioned Plan', is_required: true, is_uploaded: true },
      { id: 3, approval_type: 'khata', name: 'Khata Cert', is_required: true, is_validated: true },
    ];
    const out = r.composeReadiness({ deal: { asset_class: 'residential_apartments' }, approvals });
    const item = out.buckets
      .find((b) => b.id === 'statutory_approvals')
      .items.find((i) => i.id === 'required_approvals_baseline');
    expect(item.evidence.status).toBe('verified');
  });

  test('rera_readiness_threshold is verified (not applicable) for commercial deals', () => {
    const out = r.composeReadiness({ deal: { asset_class: 'commercial_office' } });
    const item = out.buckets
      .find((b) => b.id === 'statutory_approvals')
      .items.find((i) => i.id === 'rera_readiness_threshold');
    expect(item.evidence.status).toBe('verified');
    expect(item.evidence.evidence_label).toMatch(/not applicable/i);
  });

  test('rera_readiness_threshold uses the readiness pct band', () => {
    const cases = [
      { pct: 90, expected: 'verified' },
      { pct: 60, expected: 'uploaded' },
      { pct: 30, expected: 'pending' },
      { pct: 10, expected: 'missing' },
    ];
    for (const c of cases) {
      const out = r.composeReadiness({
        deal: { asset_class: 'residential_apartments' },
        rera_readiness: { overall: { completeness_pct: c.pct } },
      });
      const item = out.buckets
        .find((b) => b.id === 'statutory_approvals')
        .items.find((i) => i.id === 'rera_readiness_threshold');
      expect(item.evidence.status).toBe(c.expected);
    }
  });
});

// ─── Market & Comps detect functions ───────────────────────────────────────

describe('Market & Comps detect functions', () => {
  test('micro_market_briefing is verified with locality + 4+ benchmarks', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      micro_market: {
        locality: { name: 'Whitefield (East ORR)', tier: 'prime' },
        benchmarks: [
          { metric_kind: 'sale_rate_per_sqft_inr' },
          { metric_kind: 'absorption_quarters' },
          { metric_kind: 'absorption_pressure', p50: 0.95 },
          { metric_kind: 'price_yoy_pct' },
        ],
      },
    });
    const item = out.buckets
      .find((b) => b.id === 'market_comps')
      .items.find((i) => i.id === 'micro_market_briefing');
    expect(item.evidence.status).toBe('verified');
  });

  test('comps_validated reflects comp count band', () => {
    const cases = [
      { n: 7, expected: 'verified' },
      { n: 3, expected: 'uploaded' },
      { n: 1, expected: 'pending' },
      { n: 0, expected: 'missing' },
    ];
    for (const c of cases) {
      const out = r.composeReadiness({
        deal: { asset_class: 'residential_apartments' },
        comps_count: c.n,
      });
      const item = out.buckets
        .find((b) => b.id === 'market_comps')
        .items.find((i) => i.id === 'comps_validated');
      expect(item.evidence.status).toBe(c.expected);
    }
  });

  test('best_use_score uses the chosen asset class entry', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      best_use: {
        scores: [
          { asset_class: 'residential_apartments', label: 'Residential Apartments', score: 80, verdict: 'Recommend' },
          { asset_class: 'commercial_office', label: 'Commercial Office', score: 45, verdict: 'Re-examine' },
        ],
      },
    });
    const item = out.buckets
      .find((b) => b.id === 'market_comps')
      .items.find((i) => i.id === 'best_use_score');
    expect(item.evidence.status).toBe('verified');
    expect(item.evidence.evidence_label).toMatch(/Residential Apartments 80/);
  });

  test('no_oversupply_flag pending when absorption pressure > 1.15', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      micro_market: {
        locality: { name: 'X' },
        benchmarks: [
          { asset_class: 'residential_apartments', metric_kind: 'absorption_pressure', p50: 1.25 },
        ],
      },
    });
    const item = out.buckets
      .find((b) => b.id === 'market_comps')
      .items.find((i) => i.id === 'no_oversupply_flag');
    expect(item.evidence.status).toBe('pending');
    expect(item.evidence.evidence_label).toMatch(/oversupply risk/);
  });
});

// ─── Promoter & Execution detect functions ─────────────────────────────────

describe('Promoter & Execution detect functions', () => {
  test('promoter_not_flagged: cleared → verified, unverified → pending, flagged → missing', () => {
    const cases = [
      { posture: 'cleared', expected: 'verified' },
      { posture: 'unverified', expected: 'pending' },
      { posture: 'flagged', expected: 'missing' },
    ];
    for (const c of cases) {
      const out = r.composeReadiness({
        deal: { asset_class: 'residential_apartments' },
        promoter: { profile: { promoter_name: 'Prestige' }, assessment: { posture: c.posture } },
      });
      const item = out.buckets
        .find((b) => b.id === 'promoter_execution')
        .items.find((i) => i.id === 'promoter_not_flagged');
      expect(item.evidence.status).toBe(c.expected);
    }
  });

  test('on_time_delivery band — verified at ≥80%, uploaded ≥60%, pending below', () => {
    const cases = [
      { pct: 90, total: 10, expected: 'verified' },
      { pct: 70, total: 10, expected: 'uploaded' },
      { pct: 40, total: 10, expected: 'pending' },
    ];
    for (const c of cases) {
      const out = r.composeReadiness({
        deal: { asset_class: 'residential_apartments' },
        promoter: {
          profile: { promoter_name: 'X' },
          assessment: { posture: 'cleared', summary: { delivered_total: c.total, on_time_pct: c.pct } },
        },
      });
      const item = out.buckets
        .find((b) => b.id === 'promoter_execution')
        .items.find((i) => i.id === 'on_time_delivery');
      expect(item.evidence.status).toBe(c.expected);
    }
  });

  test('krera_linkage is verified (not applicable) for non-residential', () => {
    const out = r.composeReadiness({ deal: { asset_class: 'commercial_office' } });
    const item = out.buckets
      .find((b) => b.id === 'promoter_execution')
      .items.find((i) => i.id === 'krera_linkage');
    expect(item.evidence.status).toBe('verified');
  });
});

// ─── Risk & Diagnosis detect functions ─────────────────────────────────────

describe('Risk & Diagnosis detect functions', () => {
  test('risk_radar_posture is verified when 0 flagged categories', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      risk: { score: 25, flagged_count: 0, categories: [] },
    });
    const item = out.buckets
      .find((b) => b.id === 'risk_diagnosis')
      .items.find((i) => i.id === 'risk_radar_posture');
    expect(item.evidence.status).toBe('verified');
  });

  test('deal_doctor_critical pending with critical findings', () => {
    const out = r.composeReadiness({
      deal: { asset_class: 'residential_apartments' },
      deal_doctor: {
        findings: [
          { label: 'X', severity: 5 },
          { label: 'Y', severity: 4 },
        ],
      },
    });
    const item = out.buckets
      .find((b) => b.id === 'risk_diagnosis')
      .items.find((i) => i.id === 'deal_doctor_critical');
    expect(item.evidence.status).toBe('pending');
  });

  test('dd_score band — verified ≥80%, uploaded ≥60%, pending ≥30%', () => {
    const cases = [
      { score: 90, expected: 'verified' },
      { score: 65, expected: 'uploaded' },
      { score: 40, expected: 'pending' },
      { score: 10, expected: 'missing' },
    ];
    for (const c of cases) {
      const out = r.composeReadiness({
        deal: { asset_class: 'residential_apartments' },
        dd: { score: { score: c.score } },
      });
      const item = out.buckets
        .find((b) => b.id === 'risk_diagnosis')
        .items.find((i) => i.id === 'dd_score');
      expect(item.evidence.status).toBe(c.expected);
    }
  });
});

// ─── End-to-end on a Jigani-shaped fixture ─────────────────────────────────

describe('composeReadiness — Jigani-shaped end-to-end', () => {
  const JIGANI = {
    deal: {
      id: 'd1',
      name: 'Jigani Apartments',
      asset_class: 'residential_apartments',
      deal_structure: 'outright',
    },
    financial: {
      summary: {
        irr_pct: 13.58,
        model_params: {
          costs: { totalCr: 442, landCr: 80, constructionCr: 280 },
          revenue: { totalRevenueCr: 637 },
          kpis: { irr: 13.58, dscr: 4.77, extras: { dscr: 4.77 } },
        },
      },
      scenarios: {
        base: { kpis: { irr: 13.58 } },
        bull: { kpis: { irr: 16 } },
        bear: { kpis: { irr: 10 } },
      },
    },
    approvals: [
      { id: 1, approval_type: 'fire_noc', name: 'Fire NOC (KFES)', is_required: true, is_available: true },
      { id: 2, approval_type: 'khata', name: 'Khata Certificate', is_required: true, is_validated: true },
      { id: 3, approval_type: 'building_plan', name: 'Sanctioned Building Plan', is_required: true, is_available: true },
    ],
    documents: [
      { id: 'd1', name: 'Title_Deed.pdf' },
      { id: 'd2', name: 'EC_30yr.pdf' },
    ],
    micro_market: { locality: null },
    best_use: { scores: [] },
    rera_readiness: { overall: { completeness_pct: 35 } },
    dd: { score: { score: 25 } },
    risk: { score: 15, flagged_count: 1, categories: [] },
    deal_doctor: { findings: [] },
    promoter: { profile: null, assessment: { posture: 'unverified' } },
    comps_count: 0,
  };

  test('returns a real readiness score around 30-50% (Jigani is mid-stage)', () => {
    const out = r.composeReadiness(JIGANI);
    expect(out.overall.completeness_pct).toBeGreaterThan(20);
    expect(out.overall.completeness_pct).toBeLessThan(70);
    expect(['early', 'diligence', 'pre_ic']).toContain(out.overall.readiness_tier);
  });

  test('Jigani has critical gaps for the items the operator hasn\'t filled', () => {
    const out = r.composeReadiness(JIGANI);
    const ids = out.gaps.map((g) => g.item_id);
    expect(ids).toContain('promoter_recorded'); // promoter null
    expect(ids).toContain('micro_market_briefing'); // locality null (coords missing)
  });

  test('financial bucket scores high for Jigani (kernel ran, IRR + DSCR present)', () => {
    const out = r.composeReadiness(JIGANI);
    const finBucket = out.buckets.find((b) => b.id === 'financial_underwriting');
    expect(finBucket.completeness_pct).toBeGreaterThan(60);
  });
});

// ─── Bucket summarisation pinning ──────────────────────────────────────────

describe('computeBucketSummary', () => {
  test('100% verified → complete', () => {
    const items = [
      { weight: 5, evidence: { status: 'verified' } },
      { weight: 3, evidence: { status: 'verified' } },
    ];
    const s = r.computeBucketSummary(items);
    expect(s.completeness_pct).toBe(100);
    expect(s.bucket_status).toBe('complete');
  });

  test('mixed uploaded + missing → partial', () => {
    const items = [
      { weight: 4, evidence: { status: 'uploaded' } },
      { weight: 4, evidence: { status: 'missing' } },
    ];
    const s = r.computeBucketSummary(items);
    expect(s.completeness_pct).toBe(38); // 4*0.75 / 8 = 0.375
    expect(s.bucket_status).toBe('partial');
  });

  test('all missing → missing', () => {
    const items = [{ weight: 5, evidence: { status: 'missing' } }];
    expect(r.computeBucketSummary(items).bucket_status).toBe('missing');
  });
});
