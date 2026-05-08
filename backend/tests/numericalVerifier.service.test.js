'use strict';

const verifier = require('../src/services/numericalVerifier.service');

// ──────────────────────────────────────────────────────────────────────────
// parseNumeric — the one helper that everything else depends on
// ──────────────────────────────────────────────────────────────────────────

describe('parseNumeric', () => {
  test('parses plain integers and decimals', () => {
    expect(verifier.parseNumeric('42')).toBe(42);
    expect(verifier.parseNumeric('22.4')).toBe(22.4);
    expect(verifier.parseNumeric('  18  ')).toBe(18);
  });
  test('handles US comma grouping', () => {
    expect(verifier.parseNumeric('1,200')).toBe(1200);
  });
  test('handles Indian comma grouping', () => {
    expect(verifier.parseNumeric('1,20,000')).toBe(120000);
    expect(verifier.parseNumeric('2,80,000')).toBe(280000);
  });
  test('returns null on garbage', () => {
    expect(verifier.parseNumeric('xyz')).toBeNull();
    expect(verifier.parseNumeric(null)).toBeNull();
    expect(verifier.parseNumeric('')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Field-specific extractors — exercise the regex shapes against the kinds of
// narratives Claude actually produces for Indian RE deal analyses.
// ──────────────────────────────────────────────────────────────────────────

describe('findIrrClaim', () => {
  test('finds "IRR of 22.4%"', () => {
    const r = verifier.findIrrClaim('The deal delivers an IRR of 22.4% on a 5-year hold.');
    expect(r?.value).toBe(22.4);
  });
  test('finds "22% IRR"', () => {
    const r = verifier.findIrrClaim('We see a 22% IRR with the current pricing.');
    expect(r?.value).toBe(22);
  });
  test('finds "internal rate of return ... 18 percent"', () => {
    const r = verifier.findIrrClaim('Projected internal rate of return is 18 percent.');
    expect(r?.value).toBe(18);
  });
  test('returns null when IRR not mentioned near a number', () => {
    expect(verifier.findIrrClaim('The deal has strong fundamentals and good cash flows.')).toBeNull();
  });
  test('does not capture "5-year" as a percentage', () => {
    const r = verifier.findIrrClaim('IRR was reviewed over a 5-year period.');
    expect(r).toBeNull(); // "5-year" has no % so should not match
  });
});

describe('findRevenueClaim', () => {
  test('finds ₹ Cr revenue claims', () => {
    const r = verifier.findRevenueClaim('Total revenue of ₹250 Cr is projected.');
    expect(r?.value).toBe(250);
  });
  test('finds GDV claims', () => {
    const r = verifier.findRevenueClaim('GDV stands at ₹ 320 crore for this project.');
    expect(r?.value).toBe(320);
  });
  test('handles "Rs 175.5 Cr" and "INR 200 crores"', () => {
    expect(verifier.findRevenueClaim('Topline of Rs 175.5 Cr expected.')?.value).toBe(175.5);
    expect(verifier.findRevenueClaim('Project value INR 200 crores at completion.')?.value).toBe(200);
  });
  test('returns null when no revenue keyword present', () => {
    expect(verifier.findRevenueClaim('The site is well-located with good access.')).toBeNull();
  });
});

describe('findCostClaim', () => {
  test('finds total project cost', () => {
    const r = verifier.findCostClaim('Total project cost is ₹120 Cr including land and construction.');
    expect(r?.value).toBe(120);
  });
  test('finds land cost', () => {
    const r = verifier.findCostClaim('The land cost of ₹48 Cr is in line with comparable transactions.');
    expect(r?.value).toBe(48);
  });
});

describe('findLandAreaClaim', () => {
  test('finds acres claims', () => {
    expect(verifier.findLandAreaClaim('The 2.5 acres parcel is well-zoned.')?.value).toBe(2.5);
  });
  test('finds sqft claims', () => {
    const r = verifier.findLandAreaClaim('Site area is 1,20,000 sqft.');
    expect(r?.value).toBe(120000);
    expect(r?.unit).toBe('sqft');
  });
  test('prefers acres over sqft when both present', () => {
    const r = verifier.findLandAreaClaim('Land area: 5 acres (~2,17,800 sqft).');
    expect(r?.unit).toBe('acres');
    expect(r?.value).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// verifyDealAnalysis — full orchestrator
// ──────────────────────────────────────────────────────────────────────────

describe('verifyDealAnalysis', () => {
  test('returns empty drifts when narrative matches snapshot exactly', () => {
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd: 'The deal delivers an IRR of 18.5% on revenue of ₹250 Cr.',
      snapshot: { irr_pct: 18.5, total_revenue_cr: 250 },
    });
    expect(drifts).toEqual([]);
  });

  test('flags HIGH severity when IRR drift > 10%', () => {
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd: 'The deal delivers an IRR of 22% on a 5-year hold.',
      snapshot: { irr_pct: 18 }, // 22 vs 18 = 22% drift
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].field).toBe('irr_pct');
    expect(drifts[0].claimed).toBe(22);
    expect(drifts[0].snapshot).toBe(18);
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].delta_pct).toBeGreaterThan(20);
    expect(drifts[0].claim_context).toContain('IRR of 22%');
  });

  test('flags MEDIUM severity when revenue drift is 5-10%', () => {
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd: 'Total revenue of ₹260 Cr is projected.',
      snapshot: { total_revenue_cr: 245 }, // 260 vs 245 = ~6.1% drift
    });
    const rev = drifts.find((d) => d.field === 'total_revenue_cr');
    expect(rev).toBeTruthy();
    expect(rev.severity).toBe('medium');
  });

  test('drops sub-1% drifts as not worth flagging', () => {
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd: 'IRR projected at 18.5%.',
      snapshot: { irr_pct: 18.55 },
    });
    expect(drifts).toEqual([]);
  });

  test('skips fields the LLM did not mention', () => {
    // Narrative talks about IRR only; cost is in snapshot but not text.
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd: 'The IRR of 19% is acceptable.',
      snapshot: { irr_pct: 19, total_cost_cr: 120 },
    });
    // 19 vs 19 = 0% drift on IRR, cost not mentioned → no drifts at all.
    expect(drifts).toEqual([]);
  });

  test('flags low-severity drift when LLM cites a number with no snapshot baseline', () => {
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd: 'Project IRR of 25% looks compelling.',
      snapshot: { irr_pct: null },
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].field).toBe('irr_pct');
    expect(drifts[0].claimed).toBe(25);
    expect(drifts[0].snapshot).toBeNull();
    expect(drifts[0].reason).toBe('no_snapshot_value');
  });

  test('normalizes sqft claims to acres before comparison', () => {
    // Snapshot says 5 acres; narrative says 2,17,800 sqft (= 5 acres exactly).
    // After normalization, drift should be ~0% → no flag.
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd: 'The site spans 2,17,800 sqft.',
      snapshot: { land_area_acres: 5 },
    });
    expect(drifts.find((d) => d.field === 'land_area_acres')).toBeFalsy();
  });

  test('handles multiple simultaneous drifts in one narrative', () => {
    const { drifts } = verifier.verifyDealAnalysis({
      contentMd:
        'The deal delivers an IRR of 25% on revenue of ₹300 Cr against a total project cost of ₹150 Cr.',
      snapshot: {
        irr_pct: 18,
        total_revenue_cr: 245,
        total_cost_cr: 120,
      },
    });
    const fields = drifts.map((d) => d.field).sort();
    expect(fields).toEqual(['irr_pct', 'total_cost_cr', 'total_revenue_cr']);
    for (const d of drifts) {
      expect(['high', 'medium']).toContain(d.severity);
    }
  });

  test('returns ISO timestamp for verifiedAt', () => {
    const { verifiedAt } = verifier.verifyDealAnalysis({
      contentMd: 'Empty narrative.',
      snapshot: {},
    });
    expect(verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('handles empty content gracefully', () => {
    expect(verifier.verifyDealAnalysis({ contentMd: '', snapshot: {} }).drifts).toEqual([]);
    expect(verifier.verifyDealAnalysis({ contentMd: null, snapshot: {} }).drifts).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// snapshotFromDealAnalysisInput — convenience helper
// ──────────────────────────────────────────────────────────────────────────

describe('snapshotFromDealAnalysisInput', () => {
  test('extracts the four canonical fields the verifier checks', () => {
    const input = {
      deal: { name: 'X', land_area_acres: 2.5 },
      financials: { irr_pct: 18.4, total_revenue_cr: 245, total_cost_cr: 180 },
    };
    expect(verifier.snapshotFromDealAnalysisInput(input)).toEqual({
      irr_pct: 18.4,
      total_revenue_cr: 245,
      total_cost_cr: 180,
      land_area_acres: 2.5,
    });
  });

  test('returns null fields when source is missing', () => {
    expect(verifier.snapshotFromDealAnalysisInput({})).toEqual({
      irr_pct: null,
      total_revenue_cr: null,
      total_cost_cr: null,
      land_area_acres: null,
    });
  });

  test('returns null when input is null/undefined', () => {
    expect(verifier.snapshotFromDealAnalysisInput(null)).toBeNull();
    expect(verifier.snapshotFromDealAnalysisInput(undefined)).toBeNull();
  });
});
