'use strict';

/**
 * The deterministic extraction-quality signal.
 *
 * Replaces `computeConfidenceScores`, which scored a field 1.0 for being
 * non-empty and 0 for being null, then rendered that fill-rate as
 * "High · 100% confidence" and PRE-TICKED the row for one-click application to
 * the deal record. These tests pin the properties that make the replacement
 * honest — above all that a statutory fact can never reach the auto-fill band,
 * however well it verifies.
 */

const {
  assessExtractionFields, SIGNAL_VERSION, STATUS_SCORE, __internal,
} = require('../src/utils/extractionFieldQuality');
const { legalFourLaneForField } = require('../src/constants/legalFourFields');

// The ontology's band thresholds — the policy these scores address.
const HIGH_MIN = 0.80;   // "Auto-fill candidate — operator may accept-all-high in bulk."
const LOW_MAX = 0.50;    // "Surface only as 'verify' suggestion; never auto-fill."

const scoreOf = (fields, opts) => assessExtractionFields(fields, opts).scores;
const assessOf = (fields, opts) => assessExtractionFields(fields, opts).assessments;

describe('the legal four can NEVER reach the auto-fill band', () => {
  // THE headline safety property. Before this, all four scored 1.0 → HIGH →
  // pre-ticked for bulk apply to the deal record.
  test.each([
    ['owner_name', 'M. Ramesh', 'legal_title'],
    ['survey_number', '72/1A', 'legal_title'],
    ['khata_number', '123/456', 'legal_title'],
    ['pid_number', '1-2-3', 'legal_title'],
    ['grantor', 'Someone', 'legal_title'],
    ['grantee', 'Someone Else', 'legal_title'],
    ['hissa_number', '2', 'legal_title'],
    ['mutation_number', 'M-99', 'legal_title'],
    ['encumbrance_status', 'Nil', 'legal_encumbrance'],
    ['outstanding_liabilities', 'None', 'legal_encumbrance'],
    ['rera_registration_number', 'PRM/KA/RERA/1251/446', 'legal_rera'],
    ['layout_approval_number', 'BDA/123', 'legal_approvals'],
    ['conversion_order_number', 'ALN/456', 'legal_approvals'],
    ['occupancy_certificate_number', 'OC/789', 'legal_approvals'],
  ])('%s is capped below the auto-fill threshold', (field, value, expectedLane) => {
    expect(legalFourLaneForField(field)).toBe(expectedLane);
    const scores = scoreOf({ [field]: value });
    expect(scores[field]).toBeLessThan(HIGH_MIN);
    expect(scores[field]).toBeLessThanOrEqual(LOW_MAX);
  });

  test('a legal field stays capped EVEN WHEN grounded verbatim in the source', () => {
    // The strongest evidence REDIP can produce still does not license
    // auto-filling a statutory fact (CLAUDE.md: extraction aid only, with
    // human verification prompts).
    const src = 'Owner: M. Ramesh. Survey No 72. Khata 123/456.';
    const a = assessOf({ owner_name: 'M. Ramesh', survey_number: '72', khata_number: '123/456' }, { sourceText: src });
    for (const field of ['owner_name', 'survey_number', 'khata_number']) {
      expect(a[field].grounded).toBe(true);       // we DID find it
      expect(a[field].status).toBe('verify_legal'); // and still refuse to auto-fill
      expect(a[field].score).toBeLessThanOrEqual(LOW_MAX);
      // The reason must credit the evidence AND state the rule.
      expect(a[field].reason).toMatch(/Found verbatim/);
      expect(a[field].reason).toMatch(/never fills these automatically/);
    }
  });

  test('a NON-legal field is free to reach the auto-fill band on the same evidence', () => {
    // Proves the cap is lane-specific, not a blanket downgrade.
    const a = assessOf({ village: 'Jarakabande Kaval' }, { sourceText: 'Village: Jarakabande Kaval' });
    expect(a.village.status).toBe('source_verified');
    expect(a.village.score).toBeGreaterThanOrEqual(HIGH_MIN);
  });
});

describe('grounding — proving a value against the document text', () => {
  test('a value found verbatim is source_verified', () => {
    const a = assessOf({ village: 'Yelahanka' }, { sourceText: 'Hobli: Yelahanka, Bengaluru North' });
    expect(a.village.grounded).toBe(true);
    expect(a.village.status).toBe('source_verified');
    expect(a.village.reason).toMatch(/Found verbatim/);
  });

  test('a value the document does NOT contain is flagged, not trusted', () => {
    // The hallucination detector: we hold the text and the value is not in it.
    const a = assessOf({ village: 'Whitefield' }, { sourceText: 'Hobli: Yelahanka, Bengaluru North' });
    expect(a.village.grounded).toBe(false);
    expect(a.village.status).toBe('not_in_source');
    expect(a.village.score).toBeLessThanOrEqual(LOW_MAX);
    expect(a.village.reason).toMatch(/could NOT find this value/);
  });

  test('grounding is UNKNOWN (never a fabricated pass) when there is no source text', () => {
    // Native scans: no transcription exists, so we must not claim to verify.
    const a = assessOf({ village: 'Yelahanka' }, {});
    expect(a.village.grounded).toBeNull();
    expect(a.village.status).toBe('unverified');
    expect(a.village.score).toBeGreaterThan(LOW_MAX);   // not an accusation…
    expect(a.village.score).toBeLessThan(HIGH_MIN);     // …but not auto-fillable either
  });

  test('grounds the ORIGINAL script for a transliterated value (the multilingual contract)', () => {
    // "Mohan G" is a transliteration of "ಶ್ರೀ ಮೋಹನ್ ಜಿ" and will NEVER appear
    // verbatim in a Kannada document. Grounding the transliteration would
    // report a false "not in source" on every correctly-read Kannada field.
    const src = 'ಶ್ರೀ ಮೋಹನ್ ಜಿ ರವರಿಗೆ, ಜಾರಕಬಂಡೆ ಕಾವಲ್ ಗ್ರಾಮ';
    const a = assessOf(
      { recipient: 'Mohan G', recipient_original: 'ಶ್ರೀ ಮೋಹನ್ ಜಿ' },
      { sourceText: src },
    );
    expect(a.recipient.grounded).toBe(true);
    // The _original sibling is grounding INPUT, not a separate fact to score.
    expect(a.recipient_original).toBeUndefined();
  });

  test('matches Indian digit grouping (13,06,800 in the document ↔ 1306800 extracted)', () => {
    const a = assessOf({ total_land_area_sqft: 1306800 }, { sourceText: 'Extent: 13,06,800 sq ft' });
    expect(a.total_land_area_sqft.grounded).toBe(true);
  });

  test('a one-character value is not grounded either way (a match would prove nothing)', () => {
    const a = assessOf({ block: 'A' }, { sourceText: 'A quick brown fox' });
    expect(a.block.grounded).toBeNull();
  });

  test('a name is never "grounded" by its stray digits alone', () => {
    const a = assessOf({ village: 'Sector 7 Township' }, { sourceText: 'Plot 7 of some entirely different place' });
    expect(a.village.grounded).toBe(false);
  });
});

describe('schema rules — shape only, never plausibility', () => {
  test('accepts ISO and Indian date formats; rejects prose', () => {
    expect(__internal.checkSchema('registration_date', '2024-02-06')).toBe(true);
    expect(__internal.checkSchema('registration_date', '06.02.2024')).toBe(true);   // format issue, not a correctness issue
    expect(__internal.checkSchema('registration_date', '06/02/2024')).toBe(true);
    expect(__internal.checkSchema('mutation_date', 'sometime last year')).toBe(false);
  });

  test('a format mismatch is flagged below the auto-fill band', () => {
    const a = assessOf({ issue_date: 'not a date at all' });
    expect(a.issue_date.schemaValid).toBe(false);
    expect(a.issue_date.status).toBe('format_mismatch');
    expect(a.issue_date.score).toBeLessThanOrEqual(LOW_MAX);
  });

  test('areas accept numbers AND unit-carrying strings, reject prose', () => {
    expect(__internal.checkSchema('area_sqft', 45000)).toBe(true);
    expect(__internal.checkSchema('area_sqft', '45,000')).toBe(true);
    expect(__internal.checkSchema('total_area_acres', '34 Acres 32 Guntas')).toBe(true); // a normalizer's job, not a defect
    expect(__internal.checkSchema('area_sqft', 'large')).toBe(false);
    expect(__internal.checkSchema('area_sqft', -5)).toBe(false);
  });

  test('money accepts ₹/lakh/crore strings', () => {
    expect(__internal.checkSchema('consideration_inr', 12500000)).toBe(true);
    expect(__internal.checkSchema('consideration_inr', '₹1.25 crore')).toBe(true);
    expect(__internal.checkSchema('stamp_duty_inr', 'a lot')).toBe(false);
  });

  test('pincode must be exactly 6 digits', () => {
    expect(__internal.checkSchema('pincode', '560064')).toBe(true);
    expect(__internal.checkSchema('pincode', '56006')).toBe(false);
  });

  test('identifier rule checks PRESENCE, never form — 72/1, 72-1 and 72/1A are different parcels', () => {
    // The rule must never imply these are interchangeable.
    expect(__internal.checkSchema('survey_number', '72/1')).toBe(true);
    expect(__internal.checkSchema('survey_number', '72-1')).toBe(true);
    expect(__internal.checkSchema('survey_number', '72/1A')).toBe(true);
    expect(__internal.checkSchema('survey_number', 'not stated')).toBe(false); // no digit at all
  });

  test('a field with no rule gets NO opinion (null), never a false', () => {
    expect(__internal.checkSchema('remarks', 'as per records')).toBeNull();
    expect(__internal.checkSchema('soil_type', 'red loam')).toBeNull();
  });

  test('a throwing rule never condemns a value', () => {
    expect(__internal.checkSchema('area_sqft', { weird: 'object' })).toBe(false); // handled, not thrown
    expect(() => __internal.checkSchema('registration_date', null)).not.toThrow();
  });
});

describe('metadata and bookkeeping keys are not scored as evidence', () => {
  test('detected_languages and _-prefixed keys are excluded', () => {
    const r = assessExtractionFields({
      village: 'Yelahanka',
      detected_languages: ['kn', 'en'],
      _internal: 'x',
    });
    expect(r.assessments.detected_languages).toBeUndefined();
    expect(r.assessments._internal).toBeUndefined();
    expect(r.scores.detected_languages).toBeUndefined();
    expect(Object.keys(r.assessments)).toEqual(['village']);
  });

  test('_original siblings never double-count', () => {
    const r = assessExtractionFields({ village: 'J.B. Kaval', village_original: 'ಜೆ.ಬಿ.ಕಾವಲ್' });
    expect(Object.keys(r.assessments)).toEqual(['village']);
  });
});

describe('absent fields', () => {
  test.each([[null], [undefined], ['']])('%p scores 0 and reads "absent"', (value) => {
    const a = assessOf({ district: value });
    expect(a.district.present).toBe(false);
    expect(a.district.status).toBe('absent');
    expect(a.district.score).toBe(0);
  });

  test('an empty array is absent, not merely unverified', () => {
    const a = assessOf({ encumbrances: [] });
    expect(a.encumbrances.status).toBe('absent');
  });
});

describe('signal versioning + envelope', () => {
  test('stamps _signal_version so the learning corpus never mixes graded rows with legacy fill-rate', () => {
    const scores = scoreOf({ village: 'X' });
    expect(scores._signal_version).toBe(SIGNAL_VERSION);
    expect(SIGNAL_VERSION).toBe(2);
  });

  test('_overall is the mean of the field scores', () => {
    const scores = scoreOf({ village: 'Yelahanka', district: null }, { sourceText: 'Yelahanka' });
    // source_verified (0.90) + absent (0) → 0.45
    expect(scores._overall).toBeCloseTo(0.45, 2);
  });

  test('handles a null / non-object payload without throwing', () => {
    expect(assessExtractionFields(null)).toEqual({ scores: {}, assessments: {} });
    expect(assessExtractionFields('nonsense')).toEqual({ scores: {}, assessments: {} });
  });

  test('every status maps to a score inside its intended band', () => {
    expect(STATUS_SCORE.source_verified).toBeGreaterThanOrEqual(HIGH_MIN);
    for (const s of ['format_mismatch', 'not_in_source', 'verify_legal', 'absent']) {
      expect(STATUS_SCORE[s]).toBeLessThanOrEqual(LOW_MAX);
    }
    for (const s of ['unverified', 'format_checked']) {
      expect(STATUS_SCORE[s]).toBeGreaterThan(LOW_MAX);
      expect(STATUS_SCORE[s]).toBeLessThan(HIGH_MIN);
    }
  });
});

describe('the production Kannada RTC — end to end', () => {
  // The real extraction from the operator's Jarakabande Kaval deal.
  const FIELDS = {
    owner_name: 'M. Ramesh bin Late M. Lakshminarayana',
    owner_name_original: 'ಎಮ್ ರಮೇಶ್ ಬಿನ್ ಲೇ ಎಮ್ ಲಕ್ಷ್ಮೀ ನಾರಾಯಣ',
    survey_number: '72',
    village: 'J.B. Kaval',
    village_original: 'ಜೆ.ಬಿ.ಕಾವಲ್',
    hobli: 'Yelahanka',
    district: null,
    total_area_acres: null,
    crop_details: [{ crop: 'Ragi' }],
    detected_languages: ['kn', 'en'],
  };
  const SOURCE = 'ಮಾಲೀಕರು ಎಮ್ ರಮೇಶ್ ಬಿನ್ ಲೇ ಎಮ್ ಲಕ್ಷ್ಮೀ ನಾರಾಯಣ ಸರ್ವೆ ಸಂಖ್ಯೆ 72 ಗ್ರಾಮ ಜೆ.ಬಿ.ಕಾವಲ್ ಹೋಬಳಿ Yelahanka ರಾಗಿ';

  test('ownership + survey number are grounded yet still require human verification', () => {
    const a = assessOf(FIELDS, { sourceText: SOURCE });
    expect(a.owner_name.grounded).toBe(true);
    expect(a.owner_name.lane).toBe('legal_title');
    expect(a.owner_name.score).toBeLessThanOrEqual(LOW_MAX);
    expect(a.survey_number.score).toBeLessThanOrEqual(LOW_MAX);
  });

  test('village is provable and therefore auto-fillable; crops are honestly unverified', () => {
    const a = assessOf(FIELDS, { sourceText: SOURCE });
    expect(a.village.status).toBe('source_verified');
    expect(a.village.score).toBeGreaterThanOrEqual(HIGH_MIN);
    expect(a.crop_details.status).toBe('unverified');
  });

  test('nothing in this legal document is pre-tickable except provable non-legal facts', () => {
    const scores = scoreOf(FIELDS, { sourceText: SOURCE });
    const autoFillable = Object.entries(scores)
      .filter(([k, v]) => !k.startsWith('_') && v >= HIGH_MIN)
      .map(([k]) => k);
    expect(autoFillable.sort()).toEqual(['hobli', 'village']);
  });
});
