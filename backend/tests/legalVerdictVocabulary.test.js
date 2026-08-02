'use strict';

/**
 * The statutory-verdict guard, tested against the vocabulary an Indian deal
 * document actually uses.
 *
 * CLAUDE.md's hardest rule is that AI never asserts a statutory fact on the
 * legal four — title, encumbrance, RERA, approval. Before this vocabulary the
 * guard knew four generic English phrasings, so every sentence in the first
 * block below reached the customer untouched.
 *
 * The second block matters just as much: a guard that also strips
 * "verify that the khata is valid" would delete the diligence guidance the
 * platform exists to produce, while still looking like it was working. Both
 * directions are load-bearing.
 */

const {
  findLegalAssertion,
  assertsLegalStatus,
  LEGAL_ASSERTION_RULES,
  LEGAL_LANES,
} = require('../src/utils/legalVerdictVocabulary');
const { sanitizeAiProse, LEGAL_REDACTION_MARKER } = require('../src/utils/aiLegalProseGuard');
const { classifyLocal } = require('../src/services/ai/toneClassifier');

// ── What must be caught ─────────────────────────────────────────────────────

describe('statutory conclusions stated as fact are caught', () => {
  describe('title chain', () => {
    test.each([
      ['title is clear and unencumbered', 'title_status'],
      ['The title is marketable.', 'title_status'],
      ['Title remains absolute.', 'title_status'],
      ['The property has a clear and marketable title.', 'title_marketable'],
      ['The chain of title is complete.', 'title_chain_complete'],
      ['The mother deed is in order.', 'title_chain_complete'],
      ['Ownership is undisputed.', 'ownership_established'],
      ['Possession is peaceful.', 'ownership_established'],
      ['The A-khata is valid.', 'khata_valid'],
      ['Khata is in order.', 'khata_valid'],
      ['The e-khata has been transferred.', 'khata_valid'],
      ['The property has a valid A-khata.', 'khata_valid_attributive'],
      ['The RTC is clean.', 'revenue_record_clean'],
      ['Pahani is updated.', 'revenue_record_clean'],
      ['Mutation is done.', 'revenue_record_clean'],
      ['The survey is settled.', 'survey_settled'],
      ['Podi is complete.', 'survey_settled'],
      ['The 11E sketch has been obtained.', 'survey_settled'],
      ['There is no pending litigation on the property.', 'no_litigation'],
      ['The land is litigation-free.', 'no_litigation'],
      ['The site is free from disputes.', 'no_litigation'],
      ['This is not PTCL land.', 'tenure_restriction_clear'],
      ['The parcel is free from acquisition.', 'tenure_restriction_clear'],
    ])('%s', (sentence, expectedId) => {
      const found = findLegalAssertion(sentence);
      expect(found).not.toBeNull();
      expect(found.id).toBe(expectedId);
      expect(found.lane).toBe('title');
    });
  });

  describe('encumbrance', () => {
    test.each([
      ['The EC is nil.', 'ec_nil'],
      ['Encumbrance certificate is clear for 30 years.', 'ec_nil'],
      ['The EC shows nil.', 'ec_nil'],
      ['There are nil encumbrances.', 'no_encumbrance'],
      ['The property is free from all encumbrances.', 'no_encumbrance'],
      ['The land is unencumbered.', 'no_encumbrance'],
      ['No charges are registered.', 'no_charges'],
    ])('%s', (sentence, expectedId) => {
      const found = findLegalAssertion(sentence);
      expect(found).not.toBeNull();
      expect(found.id).toBe(expectedId);
      expect(found.lane).toBe('encumbrance');
    });
  });

  describe('RERA', () => {
    test.each([
      ['The project is RERA-compliant.', 'rera_status'],
      ['This is a K-RERA registered project.', 'rera_status'],
      ['RERA approved.', 'rera_status'],
      ['The RERA registration is valid.', 'rera_registration_valid'],
      ['The RERA certificate remains in force.', 'rera_registration_valid'],
      ['The project is duly registered under K-RERA.', 'registered_under_rera'],
    ])('%s', (sentence, expectedId) => {
      const found = findLegalAssertion(sentence);
      expect(found).not.toBeNull();
      expect(found.id).toBe(expectedId);
      expect(found.lane).toBe('rera');
    });
  });

  describe('statutory approval', () => {
    test.each([
      ['Approval will be granted shortly.', 'approval_granted'],
      ['The sanction has been obtained.', 'approval_granted'],
      ['All clearances are in place.', 'approval_granted'],
      ['The building plan is sanctioned.', 'plan_sanctioned'],
      ['The layout has been approved.', 'plan_sanctioned'],
      ['BBMP has approved the plan.', 'authority_approved'],
      ['BDA sanctioned the layout in 2019.', 'authority_approved'],
      ['The OC has been received.', 'certificate_obtained'],
      ['Occupancy certificate is in place.', 'certificate_obtained'],
      ['DC conversion is complete.', 'conversion_complete'],
      ['The conversion order has been granted.', 'conversion_complete'],
      ['The land is converted.', 'land_is_converted'],
      ['NOCs have been obtained.', 'noc_obtained'],
      ['Akrama-Sakrama regularisation has been granted.', 'regularisation_granted'],
      ['Zoning is compliant.', 'zoning_compliant'],
    ])('%s', (sentence, expectedId) => {
      const found = findLegalAssertion(sentence);
      expect(found).not.toBeNull();
      expect(found.id).toBe(expectedId);
      expect(found.lane).toBe('approval');
    });
  });

  test('a NEGATIVE statutory conclusion is equally a conclusion', () => {
    // Coming from an AI narrator about a counterparty's asset, the negative is
    // the more damaging of the two.
    for (const s of [
      'Title is not clear.',
      'The khata is not valid.',
      'The EC is not clear.',
      'The land is not converted.',
    ]) {
      expect(assertsLegalStatus(s)).toBe(true);
    }
  });

  test('guarantees of outcome are caught regardless of lane', () => {
    expect(findLegalAssertion('We guarantee the approval will come through.').lane).toBe('guarantee');
    expect(findLegalAssertion('This warrants a 22% return.').lane).toBe('guarantee');
  });
});

// ── What must NOT be caught ─────────────────────────────────────────────────

describe('diligence guidance survives — the product depends on it', () => {
  test.each([
    'Verify that the khata is valid before closing.',
    'Confirm whether the EC is nil for the full 30-year period.',
    'Check that DC conversion is complete.',
    'Obtain the OC before disbursement.',
    'Request the RTC and confirm mutation is done.',
    'Review whether the title is marketable.',
    'The buyer should ensure the layout has been approved.',
    'Title chain requires verification against the mother deed.',
    'DC conversion is pending with the Deputy Commissioner.',
    'RERA registration is awaited.',
    'No evidence of a valid A-khata was found in the data room.',
    'Unable to confirm the survey is settled.',
    'The EC is unverified.',
    'Approval is subject to BBMP clearance.',
    'Completion is contingent upon NOCs being obtained.',
    'It is unclear whether the land is converted.',
    'Ascertain that no litigation is pending.',
    'Flag that the khata is not yet transferred.',
    'Re-examine whether zoning is compliant.',
    'Stress-test the assumption that approval will be granted on schedule.',
  ])('%s', (sentence) => {
    expect(findLegalAssertion(sentence)).toBeNull();
  });

  test('ordinary institutional prose is untouched', () => {
    for (const s of [
      'Land cost is 28% of GDV, above the 25% Bengaluru target.',
      'Base-case IRR is 16.4% against a 20% hurdle.',
      'Absorption of 28 units per quarter is 2.15x the comp median.',
      'The site fronts a 12m road in Whitefield.',
      'Construction cost is INR 2,400 per sqft.',
    ]) {
      expect(findLegalAssertion(s)).toBeNull();
    }
  });

  test('the pre-existing false-positive case still passes', () => {
    // Pinned since the original guard: "clear title chain" as an instruction
    // is diligence language, not a verdict.
    expect(findLegalAssertion('Confirm a clear title chain during diligence.')).toBeNull();
  });

  test('an instruction cannot reach across a clause boundary', () => {
    // Caught by a pre-existing test when the suppression looked at the whole
    // prefix: "Confirm" governs pricing, and "since" opens a new clause that
    // states the approval as settled fact.
    for (const s of [
      'Confirm pricing since approval will be granted shortly.',
      'Review the model because the khata is valid.',
      'Check the comps; the EC is nil.',
      'Verify the budget, but DC conversion is complete.',
      'Confirm the schedule therefore the land is converted.',
    ]) {
      expect(findLegalAssertion(s)).not.toBeNull();
    }
  });

  test('"and" does NOT break the clause — one instruction can cover two lanes', () => {
    // The opposite error: splitting on "and" would flag the second half of a
    // perfectly good diligence instruction.
    expect(findLegalAssertion('Verify that the khata is valid and the EC is nil.')).toBeNull();
    expect(findLegalAssertion('Confirm the OC has been received and the plan is sanctioned.')).toBeNull();
  });

  test('an instruction earlier in the SENTENCE suppresses; a separate sentence does not', () => {
    // Scoping matters: a "confirm" in a previous sentence must not license a
    // verdict in the next one.
    expect(findLegalAssertion('Confirm the khata is valid.')).toBeNull();
    const twoSentences = 'Confirm the position. The khata is valid.';
    const r = sanitizeAiProse(twoSentences);
    expect(r.legalRemoved).toBe(1);
    expect(r.text).toContain('Confirm the position.');
  });
});

// ── Integration through the two real consumers ──────────────────────────────

describe('the prose scrubber redacts and reports the lane', () => {
  test('a realistic Karnataka IC paragraph is scrubbed sentence-precisely', () => {
    const prose = [
      'The site is well located on a 12m road in Jigani.',
      'The A-khata is valid and the EC is nil.',
      'DC conversion is complete.',
      'Base-case IRR is 17.2%.',
    ].join(' ');

    const r = sanitizeAiProse(prose);
    expect(r.legalRemoved).toBe(2);
    expect(r.flagged).toBe(true);
    expect(r.legalLanes.sort()).toEqual(['approval', 'title']);
    // The commercial analysis survives intact.
    expect(r.text).toContain('well located');
    expect(r.text).toContain('IRR is 17.2%');
    // The verdicts do not.
    expect(r.text).not.toMatch(/A-khata is valid/i);
    expect(r.text).not.toMatch(/DC conversion is complete/i);
    expect(r.text).toContain(LEGAL_REDACTION_MARKER);
  });

  test('a paragraph of pure diligence guidance is left completely alone', () => {
    const prose = 'Verify that the khata is valid. Confirm whether the EC is nil. Obtain the OC before closing.';
    const r = sanitizeAiProse(prose);
    expect(r.legalRemoved).toBe(0);
    expect(r.flagged).toBe(false);
    expect(r.text).toBe(prose);
  });

  test('legalLanes is empty when nothing was redacted', () => {
    expect(sanitizeAiProse('IRR is 16%.').legalLanes).toEqual([]);
  });
});

describe('the Deal Doctor tone classifier rejects the same vocabulary', () => {
  test.each([
    'The A-khata is valid, so the site is ready.',
    'EC is nil across the review period.',
    'The project is registered under K-RERA.',
    'DC conversion is complete and the land is converted.',
  ])('rejects: %s', (text) => {
    const r = classifyLocal(text);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('legal_verdict');
    expect(LEGAL_LANES).toContain(r.lane);
  });

  test('accepts diligence phrasing and clean analysis', () => {
    expect(classifyLocal('Verify the khata is valid before closing.').ok).toBe(true);
    expect(classifyLocal('Absorption is 2.15x the comp median.').ok).toBe(true);
  });
});

// ── The rule set itself ─────────────────────────────────────────────────────

describe('the rule set is well formed', () => {
  test('every rule has a unique id, a known lane, and a non-global pattern', () => {
    const ids = new Set();
    for (const rule of LEGAL_ASSERTION_RULES) {
      expect(typeof rule.id).toBe('string');
      expect(ids.has(rule.id)).toBe(false);
      ids.add(rule.id);
      expect(LEGAL_LANES).toContain(rule.lane);
      // A /g pattern carries lastIndex between calls, which would make this
      // guard miss on every other invocation — the worst failure mode
      // available to a security-shaped check.
      expect(rule.pattern.global).toBe(false);
    }
  });

  test('all four statutory lanes are covered', () => {
    const covered = new Set(LEGAL_ASSERTION_RULES.map((r) => r.lane));
    for (const lane of ['title', 'encumbrance', 'rera', 'approval']) {
      expect(covered.has(lane)).toBe(true);
    }
  });

  test('repeated calls are stable — no lastIndex drift', () => {
    const s = 'The A-khata is valid.';
    for (let i = 0; i < 5; i += 1) expect(assertsLegalStatus(s)).toBe(true);
  });

  test('non-string and empty input is safe', () => {
    for (const bad of [null, undefined, '', 0, {}, []]) {
      expect(findLegalAssertion(bad)).toBeNull();
    }
  });
});
