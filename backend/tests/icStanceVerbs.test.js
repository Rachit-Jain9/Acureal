const {
  neutralizeStanceText,
  neutralizeMemoRecommendation,
  containsAbsoluteStanceVerb,
} = require('../src/utils/icStanceVerbs');

describe('icStanceVerbs — closed verb dictionary guard (CLAUDE.md)', () => {
  describe('neutralizeStanceText (whole-field stance opinions)', () => {
    test('rewrites "Recommend approval" → "Recommend proceeding"', () => {
      expect(neutralizeStanceText('Recommend approval subject to TI cap.'))
        .toBe('Recommend proceeding subject to TI cap.');
      expect(neutralizeStanceText('We recommend approval.')).toBe('We Recommend proceeding.');
    });

    test('rewrites leading "Decline" / "Pass" / "Reject" stances', () => {
      expect(neutralizeStanceText('Decline. DSCR too thin.'))
        .toBe('Recommend against proceeding. DSCR too thin.');
      expect(neutralizeStanceText('Pass — returns below hurdle.'))
        .toBe('Recommend against proceeding — returns below hurdle.');
      expect(neutralizeStanceText('Reject this deal.')).toBe('Recommend against proceeding this deal.');
    });

    test('rewrites leading "Buy" / "Sell" and decision-context "Clear"', () => {
      expect(neutralizeStanceText('Buy. Strong yield-on-cost.'))
        .toBe('Recommend proceeding. Strong yield-on-cost.');
      expect(neutralizeStanceText('Sell at stabilization.'))
        .toBe('Recommend exiting at stabilization.');
      expect(neutralizeStanceText('Clear to proceed to IC.'))
        .toBe('Recommend proceeding to IC.');
    });

    test('leaves allowed verbs and compounds untouched', () => {
      expect(neutralizeStanceText('Proceed with conditions.')).toBe('Proceed with conditions.');
      expect(neutralizeStanceText('Pass-through costs are modeled.')).toBe('Pass-through costs are modeled.');
      expect(neutralizeStanceText('Hold pending title verification.')).toBe('Hold pending title verification.');
      // Buy-side / Sell-side / "clear title" are NOT stance verbs — never rewritten.
      expect(neutralizeStanceText('Buy-side diligence is complete.')).toBe('Buy-side diligence is complete.');
      expect(neutralizeStanceText('Sell-side comps were used.')).toBe('Sell-side comps were used.');
      expect(neutralizeStanceText('Clear title confirmed in the EC.')).toBe('Clear title confirmed in the EC.');
    });
  });

  describe('neutralizeMemoRecommendation (full memo — section-scoped)', () => {
    const memo = [
      '## 7. Required Approvals',
      'BBMP plan sanction pending. RERA approval received.',
      '',
      '## 8. Recommendation',
      'Decline. The model is assumption-led and title is unverified.',
      '',
    ].join('\n');

    test('neutralizes the Recommendation section', () => {
      const out = neutralizeMemoRecommendation(memo);
      expect(out).toContain('Recommend against proceeding. The model is assumption-led');
      expect(out).not.toMatch(/##\s*8\.[\s\S]*\bDecline\b/);
    });

    test('leaves the Required Approvals section untouched', () => {
      const out = neutralizeMemoRecommendation(memo);
      expect(out).toContain('## 7. Required Approvals');
      expect(out).toContain('RERA approval received');
    });

    test('rewrites the distinctive "Recommend approval" phrase anywhere', () => {
      expect(neutralizeMemoRecommendation('## 8. Recommendation\nRecommend approval subject to RERA.'))
        .toContain('Recommend proceeding subject to RERA');
    });
  });

  describe('containsAbsoluteStanceVerb', () => {
    test('detects banned absolute verbs', () => {
      expect(containsAbsoluteStanceVerb('Decline this deal')).toBe(true);
      expect(containsAbsoluteStanceVerb('Recommend approval')).toBe(true);
      expect(containsAbsoluteStanceVerb('Approve the budget')).toBe(true);
      expect(containsAbsoluteStanceVerb('Buy. Strong returns.')).toBe(true);
      expect(containsAbsoluteStanceVerb('Clear to proceed to IC.')).toBe(true);
    });

    test('does not flag clean closed-dictionary prose', () => {
      expect(containsAbsoluteStanceVerb('Recommend proceeding subject to conditions.')).toBe(false);
      expect(containsAbsoluteStanceVerb('Hold pending title verification.')).toBe(false);
      expect(containsAbsoluteStanceVerb('Required Approvals: BBMP sanction pending.')).toBe(false);
      expect(containsAbsoluteStanceVerb('Buy-side diligence complete.')).toBe(false);
      expect(containsAbsoluteStanceVerb('Clear title confirmed.')).toBe(false);
    });
  });
});
