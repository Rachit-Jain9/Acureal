'use strict';

/**
 * Unit tests for karnatakaReraReadiness.service.js — Phase 3 / Pillar 4.
 *
 * The composer is deterministic — every test pins exact behaviour for
 * detection, evidence-tier composition, bucket summarisation, and the
 * applicable / not-applicable empty states.
 */

const r = require('../src/services/karnatakaReraReadiness.service');

// ─── Applicability ─────────────────────────────────────────────────────────

describe('composeReadiness — applicability', () => {
  test('residential_apartments is applicable', () => {
    const out = r.composeReadiness({ assetClass: 'residential_apartments' });
    expect(out.applicable).toBe(true);
    expect(out.reason_if_not).toBeNull();
    expect(out.buckets.length).toBeGreaterThan(0);
  });

  test('plotted_development is applicable', () => {
    const out = r.composeReadiness({ assetClass: 'plotted_development' });
    expect(out.applicable).toBe(true);
  });

  test('villas / mixed_use / redevelopment are applicable', () => {
    expect(r.composeReadiness({ assetClass: 'villas' }).applicable).toBe(true);
    expect(r.composeReadiness({ assetClass: 'mixed_use' }).applicable).toBe(true);
    expect(r.composeReadiness({ assetClass: 'redevelopment' }).applicable).toBe(true);
  });

  test('hospitality / raw_land are NOT applicable by nature (operated / held, not unit-sold)', () => {
    for (const ac of ['hospitality', 'raw_land']) {
      const out = r.composeReadiness({ assetClass: ac });
      expect(out.applicable).toBe(false);
      expect(out.applicability.status).toBe('likely_exempt');
      expect(out.reason_if_not).toBeTruthy();
      expect(out.buckets).toEqual([]);
    }
  });

  test('commercial / retail / industrial are NOT auto-exempt — uncertain until sale-intent is known', () => {
    // The old behaviour wrongly treated these as always out-of-scope. A
    // commercial unit-sale that crosses thresholds IS in scope, so with no
    // inputs we stay conservatively applicable and show the checklist as a guide.
    for (const ac of ['commercial_office', 'retail', 'industrial_warehousing']) {
      const out = r.composeReadiness({ assetClass: ac });
      expect(out.applicable).toBe(true);
      expect(out.applicability.status).toBe('uncertain');
      expect(out.buckets.length).toBeGreaterThan(0);
    }
  });

  test('HARD RULE: commercial + sale-intent + area > 500 sqm is IN SCOPE, never exempt', () => {
    const out = r.composeReadiness({ assetClass: 'commercial_office', landAreaSqm: 1200, saleIntent: true });
    expect(out.applicable).toBe(true);
    expect(out.applicability.status).toBe('in_scope');
  });

  test('unknown asset class is NOT applicable with an honest message', () => {
    const out = r.composeReadiness({ assetClass: 'space_elevator' });
    expect(out.applicable).toBe(false);
    expect(out.reason_if_not).toMatch(/space_elevator/);
  });

  test('null / undefined asset class is NOT applicable', () => {
    expect(r.composeReadiness({ assetClass: null }).applicable).toBe(false);
    expect(r.composeReadiness({}).applicable).toBe(false);
  });
});

// ─── Empty state — applicable but no data ──────────────────────────────────

describe('composeReadiness — applicable + empty data', () => {
  test('residential with no approvals / docs returns full checklist all missing', () => {
    const out = r.composeReadiness({ assetClass: 'residential_apartments' });
    expect(out.applicable).toBe(true);
    expect(out.overall.completeness_pct).toBe(0);
    expect(out.overall.readiness_tier).toBe('early');
    // Every item should be missing
    for (const b of out.buckets) {
      for (const it of b.items) {
        expect(it.evidence.status).toBe('missing');
      }
    }
    // Top gaps include the highest-weight items
    expect(out.gaps.length).toBeGreaterThan(0);
    expect(out.gaps[0].severity).toBe('critical');
  });

  test('exposes a disclaimer respecting CLAUDE.md no-legal-verdicts rule', () => {
    const out = r.composeReadiness({ assetClass: 'residential_apartments' });
    expect(out.disclaimer).toMatch(/organisation aid/i);
    expect(out.disclaimer).toMatch(/NOT represent.*compliance verdict/i);
  });
});

// ─── Detection — approval evidence ─────────────────────────────────────────

describe('findApprovalEvidence', () => {
  test('matches by approval_type', () => {
    const item = { detect: { approvalTypes: ['fire_noc'] } };
    const approvals = [
      { id: 1, approval_type: 'rera', name: 'RERA Karnataka Registration' },
      { id: 2, approval_type: 'fire_noc', name: 'Fire NOC (KFES)' },
    ];
    expect(r.findApprovalEvidence(item, approvals).id).toBe(2);
  });

  test('matches by approval name pattern (case-insensitive)', () => {
    const item = { detect: { approvalNamePatterns: [/khata/i] } };
    const approvals = [
      { id: 5, approval_type: 'khata', name: 'Khata Certificate & Extract' },
    ];
    expect(r.findApprovalEvidence(item, approvals).id).toBe(5);
  });

  test('returns null when no detect spec', () => {
    expect(r.findApprovalEvidence({ detect: {} }, [{ id: 1 }])).toBeNull();
  });

  test('returns null when approvals is empty / not array', () => {
    expect(r.findApprovalEvidence({ detect: { approvalTypes: ['x'] } }, [])).toBeNull();
    expect(r.findApprovalEvidence({ detect: { approvalTypes: ['x'] } }, null)).toBeNull();
  });
});

// ─── Detection — document evidence ─────────────────────────────────────────

describe('findDocumentEvidence', () => {
  test('matches by document name pattern', () => {
    const item = { detect: { docNamePatterns: [/title.*deed/i] } };
    const docs = [{ id: 'd1', name: 'Sale Title Deed.pdf' }];
    expect(r.findDocumentEvidence(item, docs).id).toBe('d1');
  });

  test('matches by doc_category exact match', () => {
    const item = { detect: { docCategories: ['encumbrance_certificate'] } };
    const docs = [
      { id: 'd1', name: 'random.pdf', doc_category: 'encumbrance_certificate' },
    ];
    expect(r.findDocumentEvidence(item, docs).id).toBe('d1');
  });

  test('falls back to file_name / original_name', () => {
    const item = { detect: { docNamePatterns: [/khata/i] } };
    const docs = [{ id: 'd1', original_name: 'KHATA_extract.pdf' }];
    expect(r.findDocumentEvidence(item, docs).id).toBe('d1');
  });
});

// ─── Detection — extracted field evidence ──────────────────────────────────

describe('findExtractedFieldEvidence', () => {
  test('picks up extracted field with value', () => {
    const item = { detect: { extractedFields: ['promoter_pan'] } };
    const extracted = { promoter_pan: { value: 'ABCDE1234F', confidence: 0.85 } };
    const ev = r.findExtractedFieldEvidence(item, extracted);
    expect(ev.key).toBe('promoter_pan');
    expect(ev.value).toBe('ABCDE1234F');
    expect(ev.confidence).toBe(0.85);
  });

  test('skips empty / null values', () => {
    const item = { detect: { extractedFields: ['promoter_pan'] } };
    expect(r.findExtractedFieldEvidence(item, { promoter_pan: { value: '' } })).toBeNull();
    expect(r.findExtractedFieldEvidence(item, { promoter_pan: { value: null } })).toBeNull();
  });
});

// ─── computeItemEvidence — evidence-tier composition ───────────────────────

describe('computeItemEvidence — evidence tiers', () => {
  test('validated approval → verified', () => {
    const item = { detect: { approvalTypes: ['fire_noc'] } };
    const approvals = [{ id: 1, approval_type: 'fire_noc', name: 'Fire NOC', is_validated: true }];
    const ev = r.computeItemEvidence(item, { approvals, documents: [], extractedFields: {} });
    expect(ev.status).toBe('verified');
    expect(ev.source).toBe('approval');
  });

  test('uploaded approval (not validated) → uploaded', () => {
    const item = { detect: { approvalTypes: ['fire_noc'] } };
    const approvals = [{ id: 1, approval_type: 'fire_noc', name: 'Fire NOC', is_uploaded: true }];
    const ev = r.computeItemEvidence(item, { approvals, documents: [], extractedFields: {} });
    expect(ev.status).toBe('uploaded');
  });

  test('available approval → available', () => {
    const item = { detect: { approvalTypes: ['fire_noc'] } };
    const approvals = [{ id: 1, approval_type: 'fire_noc', name: 'Fire NOC', is_available: true }];
    const ev = r.computeItemEvidence(item, { approvals, documents: [], extractedFields: {} });
    expect(ev.status).toBe('available');
  });

  test('approval row with no flags → pending', () => {
    const item = { detect: { approvalTypes: ['fire_noc'] } };
    const approvals = [{ id: 1, approval_type: 'fire_noc', name: 'Fire NOC' }];
    const ev = r.computeItemEvidence(item, { approvals, documents: [], extractedFields: {} });
    expect(ev.status).toBe('pending');
  });

  test('extracted field with high confidence → verified', () => {
    const item = { detect: { extractedFields: ['promoter_pan'] } };
    const extracted = { promoter_pan: { value: 'ABCDE1234F', confidence: 0.9 } };
    const ev = r.computeItemEvidence(item, { approvals: [], documents: [], extractedFields: extracted });
    expect(ev.status).toBe('verified');
    expect(ev.source).toBe('extracted_field');
  });

  test('extracted field with low confidence → uploaded', () => {
    const item = { detect: { extractedFields: ['promoter_pan'] } };
    const extracted = { promoter_pan: { value: 'ABCDE1234F', confidence: 0.4 } };
    const ev = r.computeItemEvidence(item, { approvals: [], documents: [], extractedFields: extracted });
    expect(ev.status).toBe('uploaded');
  });

  test('document only → uploaded', () => {
    const item = { detect: { docNamePatterns: [/khata/i] } };
    const ev = r.computeItemEvidence(item, {
      approvals: [],
      documents: [{ id: 'd1', name: 'Khata.pdf' }],
      extractedFields: {},
    });
    expect(ev.status).toBe('uploaded');
    expect(ev.source).toBe('document');
  });

  test('nothing matches → missing', () => {
    const item = { detect: { approvalTypes: ['x'], docNamePatterns: [/y/] } };
    const ev = r.computeItemEvidence(item, { approvals: [], documents: [], extractedFields: {} });
    expect(ev.status).toBe('missing');
    expect(ev.source).toBeNull();
  });

  test('approval > document > extracted precedence', () => {
    // All three sources match — approval should win.
    const item = {
      detect: {
        approvalTypes: ['fire_noc'],
        docNamePatterns: [/fire/i],
        extractedFields: ['fire_noc_ref'],
      },
    };
    const ctx = {
      approvals: [{ id: 99, approval_type: 'fire_noc', name: 'Fire NOC', is_uploaded: true }],
      documents: [{ id: 'd1', name: 'Fire NOC scan.pdf' }],
      extractedFields: { fire_noc_ref: { value: 'KFES-2026-0042', confidence: 0.9 } },
    };
    expect(r.computeItemEvidence(item, ctx).source).toBe('approval');
  });
});

// ─── Bucket summarisation ──────────────────────────────────────────────────

describe('computeBucketSummary', () => {
  test('all verified → 100% complete', () => {
    const items = [
      { weight: 5, evidence: { status: 'verified' } },
      { weight: 3, evidence: { status: 'verified' } },
    ];
    const s = r.computeBucketSummary(items);
    expect(s.completeness_pct).toBe(100);
    expect(s.bucket_status).toBe('complete');
  });

  test('all missing → 0% missing', () => {
    const items = [
      { weight: 5, evidence: { status: 'missing' } },
      { weight: 3, evidence: { status: 'missing' } },
    ];
    const s = r.computeBucketSummary(items);
    expect(s.completeness_pct).toBe(0);
    expect(s.bucket_status).toBe('missing');
  });

  test('mixed → partial', () => {
    const items = [
      { weight: 5, evidence: { status: 'verified' } }, // 5 * 1 = 5
      { weight: 5, evidence: { status: 'missing' } },  // 0
    ];
    const s = r.computeBucketSummary(items);
    // 5 of 10 → 50% → partial
    expect(s.completeness_pct).toBe(50);
    expect(s.bucket_status).toBe('partial');
  });

  test('uploaded contributes 0.75 weight', () => {
    const items = [
      { weight: 4, evidence: { status: 'uploaded' } },
    ];
    expect(r.computeBucketSummary(items).completeness_pct).toBe(75);
  });
});

// ─── End-to-end composer with realistic inputs ─────────────────────────────

describe('composeReadiness — end-to-end with Jigani-like inputs', () => {
  // Realistic fixture: residential deal with some approvals + docs.
  const APPROVALS = [
    { id: 1, approval_type: 'rera', name: 'RERA Karnataka Registration' }, // pending
    { id: 2, approval_type: 'building_plan', name: 'Sanctioned Building Plan (BDA / BBMP / BMICAPA)', is_available: true },
    { id: 3, approval_type: 'fire_noc', name: 'Fire NOC (Karnataka Fire & Emergency Services)', is_uploaded: true },
    { id: 4, approval_type: 'khata', name: 'Khata Certificate & Extract', is_validated: true },
    { id: 5, approval_type: 'power', name: 'BESCOM Power Connection / NOC', is_available: true },
    { id: 6, approval_type: 'water_sewage', name: 'BWSSB Water Connection / NOC', is_available: true },
    { id: 7, approval_type: 'water_sewage', name: 'BWSSB Sewage Connection / NOC', is_available: true },
    { id: 8, approval_type: 'conversion', name: 'DC Conversion Order (Agricultural to Non-Agricultural)', is_available: true },
  ];
  const DOCUMENTS = [
    { id: 'd1', name: 'Title_Deed_Jigani.pdf' },
    { id: 'd2', name: 'EC_30yr.pdf' },
  ];

  test('returns applicable with a real readiness score', () => {
    const out = r.composeReadiness({
      assetClass: 'residential_apartments',
      approvals: APPROVALS,
      documents: DOCUMENTS,
      dealName: 'Jigani Apartments',
    });
    expect(out.applicable).toBe(true);
    expect(out.deal_name).toBe('Jigani Apartments');
    expect(out.overall.completeness_pct).toBeGreaterThan(0);
    expect(out.overall.completeness_pct).toBeLessThan(100);
  });

  test('Khata = validated approval → that item is verified', () => {
    const out = r.composeReadiness({
      assetClass: 'residential_apartments',
      approvals: APPROVALS,
      documents: DOCUMENTS,
    });
    const khataItem = out.buckets
      .find((b) => b.id === 'title_ownership')
      .items.find((it) => it.id === 'khata_certificate');
    expect(khataItem.evidence.status).toBe('verified');
    expect(khataItem.evidence.source).toBe('approval');
  });

  test('Title deed document → uploaded status on title_deed item', () => {
    const out = r.composeReadiness({
      assetClass: 'residential_apartments',
      approvals: APPROVALS,
      documents: DOCUMENTS,
    });
    const titleItem = out.buckets
      .find((b) => b.id === 'title_ownership')
      .items.find((it) => it.id === 'title_deed');
    expect(titleItem.evidence.status).toBe('uploaded');
  });

  test('missing escrow account → highest-weight critical gap', () => {
    const out = r.composeReadiness({
      assetClass: 'residential_apartments',
      approvals: APPROVALS,
      documents: DOCUMENTS,
    });
    const escrowGap = out.gaps.find((g) => g.item_id === 'rera_escrow_account');
    expect(escrowGap).toBeDefined();
    expect(escrowGap.severity).toBe('critical');
    expect(escrowGap.recommended_action).toMatch(/escrow/i);
  });

  test('gaps sorted by weight desc — critical items lead', () => {
    const out = r.composeReadiness({
      assetClass: 'residential_apartments',
      approvals: APPROVALS,
      documents: DOCUMENTS,
    });
    for (let i = 1; i < out.gaps.length; i += 1) {
      expect(out.gaps[i].weight).toBeLessThanOrEqual(out.gaps[i - 1].weight);
    }
  });

  test('overall readiness_tier is "early" at low completeness', () => {
    const out = r.composeReadiness({
      assetClass: 'residential_apartments',
      approvals: [],
      documents: [],
    });
    expect(out.overall.readiness_tier).toBe('early');
  });

  test('overall readiness_tier scales with completeness', () => {
    // Fabricate a fully-validated approvals + docs set to push completeness up.
    const heavy = [
      ...APPROVALS.map((a) => ({ ...a, is_validated: true })),
    ];
    const heavyDocs = [
      { id: 'd1', name: 'Title_Deed.pdf' },
      { id: 'd2', name: 'EC_30yr.pdf' },
      { id: 'd3', name: 'Form-A_Application.pdf' },
      { id: 'd4', name: 'Form-B_Declaration.pdf' },
      { id: 'd5', name: 'Project_Affidavit.pdf' },
      { id: 'd6', name: 'Mutation_RTC.pdf' },
      { id: 'd7', name: 'Building_Commencement_Certificate.pdf' },
      { id: 'd8', name: 'CDP_Zoning_Certificate.pdf' },
      { id: 'd9', name: 'Layout_Plan_with_specs.pdf' },
      { id: 'd10', name: 'Amenities_list.pdf' },
      { id: 'd11', name: 'Project_Schedule_Gantt.pdf' },
      { id: 'd12', name: 'Promoter_PAN.pdf' },
      { id: 'd13', name: 'Promoter_GST_Certificate.pdf' },
      { id: 'd14', name: 'Director_PAN_Authorized_Signatory.pdf' },
      { id: 'd15', name: 'Board_Resolution.pdf' },
      { id: 'd16', name: 'Escrow_account_letter.pdf' },
      { id: 'd17', name: 'Project_Bank_account.pdf' },
      { id: 'd18', name: 'Architect_Appointment_COA.pdf' },
      { id: 'd19', name: 'Engineer_Appointment.pdf' },
      { id: 'd20', name: 'CA_Appointment_Chartered_Accountant.pdf' },
    ];
    const extracted = {
      promoter_pan: { value: 'ABCDE1234F', confidence: 0.9 },
      gstin: { value: '29ABCDE1234F1Z5', confidence: 0.9 },
      escrow_bank_account: { value: 'HDFC 50100123456789', confidence: 0.8 },
    };
    const out = r.composeReadiness({
      assetClass: 'residential_apartments',
      approvals: heavy,
      documents: heavyDocs,
      extractedFields: extracted,
    });
    // With the expanded statutory catalog the absolute % is lower than the old
    // 28-item list, so assert behaviour, not a brittle number: a near-complete
    // deck scores far above empty, satisfies every fatal blocker, and is never
    // shown as "blocked".
    const empty = r.composeReadiness({ assetClass: 'residential_apartments' });
    expect(out.overall.completeness_pct).toBeGreaterThan(empty.overall.completeness_pct);
    expect(out.overall.is_blocked).toBe(false);
    expect(out.overall.readiness_tier).not.toBe('blocked');
    expect(out.overall.readiness_tier).not.toBe('early');
  });
});

// ─── Structural integrity smoke tests ──────────────────────────────────────

describe('READINESS_BUCKETS structural integrity', () => {
  test('every item has required fields', () => {
    for (const bucket of r.READINESS_BUCKETS) {
      for (const item of bucket.items) {
        expect(item.id).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(typeof item.weight).toBe('number');
        expect(item.weight).toBeGreaterThan(0);
        expect(item.recommended_action).toBeTruthy();
        expect(item.detect).toBeTruthy();
      }
    }
  });

  test('item ids are unique across all buckets', () => {
    const seen = new Set();
    for (const bucket of r.READINESS_BUCKETS) {
      for (const item of bucket.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
    }
  });

  test('every item has at least one detect spec', () => {
    for (const bucket of r.READINESS_BUCKETS) {
      for (const item of bucket.items) {
        const hasSomeDetect =
          (item.detect.approvalTypes && item.detect.approvalTypes.length > 0) ||
          (item.detect.approvalNamePatterns && item.detect.approvalNamePatterns.length > 0) ||
          (item.detect.docNamePatterns && item.detect.docNamePatterns.length > 0) ||
          (item.detect.docCategories && item.detect.docCategories.length > 0) ||
          (item.detect.extractedFields && item.detect.extractedFields.length > 0);
        expect(hasSomeDetect).toBe(true);
      }
    }
  });
});
