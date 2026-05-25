'use strict';

const {
  classify,
  classifyLocal,
  isAcceptable,
} = require('../src/services/ai/toneClassifier');

beforeEach(() => {
  delete process.env.TONE_CLASSIFIER_USE_AI;
});

describe('classifyLocal — theatrical patterns', () => {
  const theatrical = [
    'This deal is dead. Walk away.',
    'Your sales velocity is fake — the comps say otherwise.',
    'The strategy is a fantasy at this hurdle.',
    'The model is a joke under these assumptions.',
    'Underwriting is absurd given the absorption gap.',
    'The plan must be utterly rebuilt now.',
    'Walk away from this deal.',
    'Do not touch this until the seller comes back.',
  ];

  for (const text of theatrical) {
    test(`rejects "${text}"`, () => {
      const result = classifyLocal(text);
      expect(result.ok).toBe(false);
      expect(['theatrical']).toContain(result.reason);
    });
  }
});

describe('classifyLocal — slander patterns', () => {
  const slanderous = [
    'The promoter is incompetent based on the prior project record.',
    'The developer appears dishonest in the disclosures provided.',
    'The promoter cannot be trusted with the construction schedule.',
    'The sponsor is fraudulent in their financial reporting.',
  ];

  for (const text of slanderous) {
    test(`rejects "${text}"`, () => {
      expect(classifyLocal(text).ok).toBe(false);
    });
  }
});

describe('classifyLocal — legal verdict patterns', () => {
  const verdicts = [
    'The title is clear.',
    'The title is good and unencumbered.',
    'The project is RERA-compliant.',
    'The approval will be granted within the quarter.',
    'We guarantee approval based on current filings.',
  ];

  for (const text of verdicts) {
    test(`rejects "${text}"`, () => {
      expect(classifyLocal(text).ok).toBe(false);
    });
  }
});

describe('classifyLocal — hedge pile patterns', () => {
  test('rejects 3-stacked hedges', () => {
    const r = classifyLocal('This may possibly potentially affect the absorption.');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('hedge_pile');
  });

  test('allows two hedges (normal speech)', () => {
    const r = classifyLocal('This may potentially affect the absorption.');
    expect(r.ok).toBe(true);
  });
});

describe('classifyLocal — acceptable diagnostic prose', () => {
  const acceptable = [
    'Land cost diverges materially from typical underwriting. 38.0% of GDV is allocated to land — typical Bengaluru target is below 30.0%.',
    'Base-case IRR lacks support for the stated hurdle. 14.2% vs 16.0% target — 180 bps short.',
    'Saleable area is inconsistent between sources — your input is 46,000 sf; the extracted area statement shows 42,800 sf (7.5% delta).',
    'DSCR breaches below 1.0× in month 18 of the base case (0.85).',
    'Quarterly sales velocity is above the verified-comp benchmark — 28 units/quarter is 2.15× the median 13.0 units/quarter (n=9).',
    'Exit cap is below the verified-comp band — 7.25% vs 7.60–8.10% (n=5).',
    'Promoter\'s prior-project delivery is below benchmark — average delay of 9.4 months across the track-record set.',
  ];

  for (const text of acceptable) {
    test(`accepts "${text.slice(0, 60)}..."`, () => {
      expect(classifyLocal(text).ok).toBe(true);
    });
  }
});

describe('classifyLocal — edge cases', () => {
  test('null / undefined / empty input passes (nothing to flag)', () => {
    expect(classifyLocal(null).ok).toBe(true);
    expect(classifyLocal(undefined).ok).toBe(true);
    expect(classifyLocal('').ok).toBe(true);
  });

  test('non-string input passes', () => {
    expect(classifyLocal(42).ok).toBe(true);
    expect(classifyLocal({}).ok).toBe(true);
  });
});

describe('classify (combined)', () => {
  test('uses local classifier by default', async () => {
    const result = await classify('This deal is dead.');
    expect(result.layer).toBe('local');
    expect(result.ok).toBe(false);
  });

  test('returns OK when no patterns match and AI second-pass is off', async () => {
    const result = await classify('Recommend re-pricing land to bring the share of GDV closer to the 30% target.');
    expect(result.layer).toBe('local');
    expect(result.ok).toBe(true);
  });
});

describe('isAcceptable predicate', () => {
  test('returns true for acceptable narrations', async () => {
    const out = await isAcceptable({
      finding: 'Land cost diverges materially from typical underwriting.',
      why_it_matters: 'An elevated land-cost ratio compresses the buffer between project IRR and the underwriting hurdle.',
    });
    expect(out).toBe(true);
  });

  test('returns false when the finding line is theatrical', async () => {
    const out = await isAcceptable({
      finding: 'This deal is dead — walk away.',
      why_it_matters: 'The land-cost ratio is too high.',
    });
    expect(out).toBe(false);
  });

  test('returns false when the why_it_matters line is theatrical', async () => {
    const out = await isAcceptable({
      finding: 'Land cost diverges materially from typical underwriting.',
      why_it_matters: 'This deal is dead at these inputs.',
    });
    expect(out).toBe(false);
  });

  test('returns false for null narration', async () => {
    expect(await isAcceptable(null)).toBe(false);
    expect(await isAcceptable({})).toBe(false);
  });
});
