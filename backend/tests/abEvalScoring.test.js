'use strict';

// Tier-2 #14 — pure scoring logic. Zero mocks, zero DB, zero LLM. Just
// strings + snapshots in, structured scores out.

const {
  scoreOutput,
  scoreHallucination,
  scoreTone,
  _internal,
} = require('../src/services/ai/abEvalScoring');

const { extractNumbers, collectSnapshotNumbers, matchesSnapshot } = _internal;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const cleanSnapshot = {
  parcel: {
    name: 'Whitefield Plot 22',
    address: 'Survey No. 22/4, Whitefield, Bengaluru',
    land_area_sqft: 13068,
    road_width_mtrs: 12,
  },
  buildability: { max_far: 2.5, base_far: 1.75, max_buildable_area_sqft: 32670 },
  guidance_value: { value_inr_per_sqft: 8500 },
  zoning: { zone_code: 'R', zone_name: 'Residential (Main)' },
};

// ──────────────────────────────────────────────────────────────────────────
// Number extraction
// ──────────────────────────────────────────────────────────────────────────

describe('extractNumbers', () => {
  test('finds basic numerics including comma-grouped Indian format', () => {
    const out = extractNumbers('FAR is 2.5, area 13,068 sqft, guidance INR 8500.');
    const values = out.map((o) => o.value);
    expect(values).toContain(2.5);
    expect(values).toContain(13068);
    expect(values).toContain(8500);
  });

  test('returns empty array on null/empty input', () => {
    expect(extractNumbers('')).toEqual([]);
    expect(extractNumbers(null)).toEqual([]);
  });

  test('captures context window around the number', () => {
    const out = extractNumbers('The IRR is 22.4% on the base case.');
    const irrMatch = out.find((o) => o.value === 22.4);
    expect(irrMatch).toBeDefined();
    expect(irrMatch.context).toContain('IRR');
  });
});

describe('collectSnapshotNumbers', () => {
  test('walks nested objects and arrays', () => {
    const set = collectSnapshotNumbers(cleanSnapshot);
    expect(set.has(2.5)).toBe(true);
    expect(set.has(13068)).toBe(true);
    expect(set.has(8500)).toBe(true);
    expect(set.has(12)).toBe(true);
    expect(set.has(32670)).toBe(true);
  });

  test('extracts numbers from string fields too', () => {
    const set = collectSnapshotNumbers({ note: 'Survey 22/4 with 1996 EC gap.' });
    expect(set.has(22)).toBe(true);
    expect(set.has(4)).toBe(true);
    expect(set.has(1996)).toBe(true);
  });

  test('rounds at 1, 2 decimals to forgive minor formatting', () => {
    const set = collectSnapshotNumbers({ irr: 22.4378 });
    expect(set.has(22.44)).toBe(true);
    expect(set.has(22.4)).toBe(true);
    expect(set.has(22)).toBe(true);
  });
});

describe('matchesSnapshot', () => {
  test('exact match returns true', () => {
    const set = new Set([100]);
    expect(matchesSnapshot(100, set)).toBe(true);
  });

  test('within 1% tolerance returns true', () => {
    const set = new Set([100]);
    expect(matchesSnapshot(100.5, set, 1)).toBe(true);
    expect(matchesSnapshot(99.5, set, 1)).toBe(true);
  });

  test('outside tolerance returns false', () => {
    const set = new Set([100]);
    expect(matchesSnapshot(110, set, 1)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Hallucination scoring
// ──────────────────────────────────────────────────────────────────────────

describe('scoreHallucination', () => {
  test('clean output (every number traceable to snapshot) → score 100', () => {
    const text = 'The Whitefield Plot 22 site at 13,068 sqft is zoned R with FAR 2.5 and guidance value INR 8500/sqft.';
    const result = scoreHallucination(text, cleanSnapshot);
    expect(result.score).toBe(100);
    expect(result.fabricated_numbers).toHaveLength(0);
  });

  test('flags fabricated rupee figure not in snapshot as high severity', () => {
    const text = 'The site has guidance value INR 12500 per sqft.';
    const result = scoreHallucination(text, cleanSnapshot);
    expect(result.fabricated_numbers.length).toBeGreaterThan(0);
    const fab = result.fabricated_numbers.find((f) => f.value === 12500);
    expect(fab).toBeDefined();
    expect(fab.severity).toBe('high'); // near "INR" / "per sqft"
    expect(result.score).toBeLessThan(100);
  });

  test('forgives years and small ordinals (e.g. "the 3 risks")', () => {
    const text = 'There are 3 open red flags and the verdict was issued in 2026.';
    const result = scoreHallucination(text, cleanSnapshot);
    expect(result.fabricated_numbers.length).toBe(0);
  });

  test('flags small integers if they sit next to a magnitude unit', () => {
    // Use 7 — not in snapshot's `22/4` survey reference, road width 12,
    // FAR 2.5, etc. so the harmless-integer forgiveness path doesn't
    // shadow the hallucination check.
    const text = 'The maximum FAR is 7 on this parcel.';
    const result = scoreHallucination(text, cleanSnapshot);
    const fab = result.fabricated_numbers.find((f) => f.value === 7);
    expect(fab).toBeDefined();
    expect(fab.severity).toBe('high');
  });

  test('flags fabricated zone code', () => {
    const text = 'The parcel falls under COM-3 zoning.';
    const result = scoreHallucination(text, cleanSnapshot);
    const zoneHit = result.fabricated_strings.find((s) => s.kind === 'zone_code');
    expect(zoneHit).toBeDefined();
  });

  test('flags fabricated RERA number', () => {
    const text = 'Project registered under PRM/KA/RERA/9999/2026.';
    const result = scoreHallucination(text, cleanSnapshot);
    const reraHit = result.fabricated_strings.find((s) => s.kind === 'rera_number');
    expect(reraHit).toBeDefined();
  });

  test('floors near 0 when many high-severity fabrications stack up', () => {
    const text = 'Guidance INR 12000/sqft, FAR 5.0, area 50000 sqft, IRR 35% on Whitefield Plot 99.';
    const result = scoreHallucination(text, cleanSnapshot);
    // Each fabrication is 14 points + a 25-point egregious bonus once
    // we hit 4 high-severity hits → score cratered.
    expect(result.score).toBeLessThanOrEqual(15);
    expect(result.fabricated_numbers.length).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Tone scoring
// ──────────────────────────────────────────────────────────────────────────

describe('scoreTone', () => {
  test('clean institutional prose → 100', () => {
    const text = 'Whitefield Plot 22 carries a clean title chain. The setback inputs are inferred from OSM and require survey-of-india validation before underwriting commits to a permissible FAR.';
    const result = scoreTone(text, { minWords: 20, maxWords: 200, disallowMarkdown: true });
    expect(result.score).toBe(100);
    expect(result.violations).toHaveLength(0);
  });

  test('flags forbidden marketing words', () => {
    const text = 'This is a groundbreaking opportunity to leverage best-in-class assets.';
    const result = scoreTone(text);
    const violations = result.violations.filter((v) => v.kind === 'forbidden_word');
    // 3 forbidden words → 18 × 3 = 54 penalty → score 46.
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(result.score).toBeLessThan(50);
  });

  test('flags markdown leakage when prose required', () => {
    const text = '## Summary\n\n* Bullet point one\n* Bullet point two\n\nThe **deal** is worth pursuing.';
    const result = scoreTone(text, { disallowMarkdown: true });
    const kinds = result.violations.map((v) => v.kind);
    expect(kinds).toContain('markdown_heading');
    expect(kinds).toContain('markdown_bullet');
    expect(kinds).toContain('markdown_bold');
  });

  test('does NOT flag markdown when caller allows it (IC memo case)', () => {
    const text = '## Summary\n\nThe deal is worth pursuing.';
    const result = scoreTone(text, { disallowMarkdown: false });
    const kinds = result.violations.map((v) => v.kind);
    expect(kinds).not.toContain('markdown_heading');
  });

  test('flags emoji presence', () => {
    const text = 'The deal looks great 🚀';
    const result = scoreTone(text);
    expect(result.violations.some((v) => v.kind === 'emoji_present')).toBe(true);
  });

  test('flags first-person voice', () => {
    const text = 'I recommend we pursue this deal. You should review the EC.';
    const result = scoreTone(text);
    expect(result.violations.some((v) => v.kind === 'first_person_voice')).toBe(true);
  });

  test('flags excess hedging (>3 hedge phrases per 100 words)', () => {
    const text = 'The deal is approximately 5 Cr. The FAR might be 2.5. The setback could be 6m. It may be that revenue is around 30 Cr. Perhaps we should verify.';
    const result = scoreTone(text);
    expect(result.violations.some((v) => v.kind === 'excess_hedging')).toBe(true);
  });

  test('flags too-short output', () => {
    const result = scoreTone('Short.', { minWords: 60 });
    expect(result.violations.some((v) => v.kind === 'too_short')).toBe(true);
  });

  test('flags too-long output', () => {
    const longText = 'The deal is on track. '.repeat(40); // ~200 words
    const result = scoreTone(longText, { maxWords: 100 });
    expect(result.violations.some((v) => v.kind === 'too_long')).toBe(true);
  });

  test('empty/null text gets score 0', () => {
    expect(scoreTone('').score).toBe(0);
    expect(scoreTone(null).score).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Composite scorer
// ──────────────────────────────────────────────────────────────────────────

describe('scoreOutput composite', () => {
  test('clean text scores high on overall', () => {
    const text = 'The Whitefield Plot 22 site at 13,068 sqft is zoned R with FAR 2.5 and guidance INR 8500/sqft. Setback inputs are inferred from OSM and need verification before underwriting commits to a permissible FAR. Encumbrance certificate is clean over the 30-year lookback. The next step is to obtain the survey-of-india validated road width.';
    const result = scoreOutput(text, cleanSnapshot, {
      minWords: 30,
      maxWords: 200,
      disallowMarkdown: true,
    });
    expect(result.overall).toBeGreaterThanOrEqual(95);
  });

  test('mixed text (some hallucination + tone slip) scores in middle range', () => {
    const text = 'This is a groundbreaking opportunity. Guidance value INR 12500/sqft on the 13,068 sqft site.';
    const result = scoreOutput(text, cleanSnapshot, { minWords: 10, maxWords: 200 });
    // Hallucination: 12500 fabricated near INR/sqft (-14) → 86
    // Tone: groundbreaking (-18) → 82
    // Composite: 0.6*86 + 0.4*82 = 84.4 → 84
    expect(result.overall).toBeLessThan(90);
    expect(result.overall).toBeGreaterThan(50);
  });

  test('weights hallucination at 0.6 and tone at 0.4', () => {
    const result = scoreOutput('clean tone', { num: 100 }, { minWords: 1, maxWords: 100 });
    // Manual calc: hallucination 100 (no fab), tone 100 (no violations) → 100
    expect(result.overall).toBe(100);
  });
});
