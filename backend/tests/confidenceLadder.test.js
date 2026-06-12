const { deriveConfidenceTier, deriveRoadWidthBasis, CONFIDENCE_TIERS } = require('../src/utils/confidenceLadder');

const reviewedClean = {
  zone: { zone_code: 'R' },
  buildability: { status: 'reference_match' },
  jurisdiction: { resolved: true, needs_authority_confirmation: false },
};

describe('deriveConfidenceTier', () => {
  test('a high score on reviewed, conflict-free inputs earns Verified', () => {
    const t = deriveConfidenceTier({ overall: 0.85, ...reviewedClean });
    expect(t.key).toBe('verified');
    expect(t.band).toBe('success');
  });

  test('Verified is capped to High when no zone is assigned', () => {
    const t = deriveConfidenceTier({ overall: 0.9, zone: null, buildability: { status: 'reference_match' } });
    expect(t.key).toBe('high');
  });

  test('Verified is capped to High when FAR is not reference-matched', () => {
    const t = deriveConfidenceTier({ overall: 0.9, zone: { zone_code: 'R' }, buildability: { status: 'needs_verification' } });
    expect(t.key).toBe('high');
  });

  test('Verified is capped to High when the authority needs confirmation', () => {
    const t = deriveConfidenceTier({
      overall: 0.9,
      zone: { zone_code: 'R' },
      buildability: { status: 'reference_match' },
      jurisdiction: { resolved: true, needs_authority_confirmation: true },
    });
    expect(t.key).toBe('high');
  });

  test.each([
    [0.7, 'high'],
    [0.5, 'indicative'],
    [0.45, 'indicative'],
    [0.35, 'low'],
    [0.3, 'low'],
    [0.1, 'not_reliable'],
    [0, 'not_reliable'],
  ])('overall %s → %s', (overall, expected) => {
    expect(deriveConfidenceTier({ overall }).key).toBe(expected);
  });

  test('clamps out-of-range and non-numeric input', () => {
    expect(deriveConfidenceTier({ overall: 5, ...reviewedClean }).key).toBe('verified');
    expect(deriveConfidenceTier({ overall: -1 }).key).toBe('not_reliable');
    expect(deriveConfidenceTier({ overall: null }).key).toBe('not_reliable');
  });

  test('every tier carries a non-empty rationale', () => {
    for (const t of CONFIDENCE_TIERS) {
      expect(typeof t.rationale).toBe('string');
      expect(t.rationale.length).toBeGreaterThan(10);
    }
  });
});

describe('deriveRoadWidthBasis', () => {
  test('operator-entered width → basis "user", not authority-verified', () => {
    const r = deriveRoadWidthBasis({ property: { road_width_mtrs: 18 }, osmRoad: { inferred_width_m: 9 } });
    expect(r.basis).toBe('user');
    expect(r.width_m).toBe(18);
    expect(r.authority_verified).toBe(false);
  });

  test('no operator width but OSM inferred → basis "inferred"', () => {
    const r = deriveRoadWidthBasis({ property: { road_width_mtrs: null }, osmRoad: { inferred_width_m: 9.5 } });
    expect(r.basis).toBe('inferred');
    expect(r.width_m).toBe(9.5);
  });

  test('no width anywhere → basis "missing"', () => {
    const r = deriveRoadWidthBasis({ property: {}, osmRoad: null });
    expect(r.basis).toBe('missing');
    expect(r.width_m).toBeNull();
  });

  test('a zero operator width is still treated as entered (finite)', () => {
    const r = deriveRoadWidthBasis({ property: { road_width_mtrs: 0 }, osmRoad: null });
    expect(r.basis).toBe('user');
    expect(r.width_m).toBe(0);
  });
});
