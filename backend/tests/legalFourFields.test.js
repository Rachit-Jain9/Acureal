'use strict';

/**
 * The legal-four FIELD guard.
 *
 * `legalFourTopics.js` protects the recommendation/learning spine at TOPIC
 * level. This module's companion protects the extraction → auto-fill surface
 * at FIELD level: an extracted statutory fact must never be written to a deal
 * record without a human looking at the source document.
 *
 * THE CI GUARD in this file is the second test block: every canonical field
 * that `FIELD_MAP_RULES` can auto-fill must appear in an explicitly REVIEWED
 * lane table below. Adding a new auto-fill destination therefore FAILS CI
 * until someone consciously decides whether it is a statutory fact. That is
 * the mechanism that stops this regressing the way it did before 2026-07-16,
 * when owner_name / survey_number / khata_number / pid silently shipped
 * pre-ticked at "High · 100% confidence".
 */

const {
  legalFourLaneForField, isLegalFourField, legalFourLabelForLane, LEGAL_FOUR_FIELD_RULES,
} = require('../src/constants/legalFourFields');
const { LEGAL_FOUR_TOPICS, isLegalFourTopic } = require('../src/constants/legalFourTopics');
const { __internal } = require('../src/services/extraction.service');

describe('lane classification', () => {
  test.each([
    // Title chain: ownership, party identity, parcel identity, registration chain
    ['owner_name', 'legal_title'],
    ['owner_address', 'legal_title'],
    ['original_owner', 'legal_title'],
    ['previous_owner', 'legal_title'],
    ['new_owner', 'legal_title'],
    ['current_occupant', 'legal_title'],
    ['chain_of_title', 'legal_title'],
    ['grantor', 'legal_title'],
    ['grantee', 'legal_title'],
    ['seller_name', 'legal_title'],
    ['vendor_name', 'legal_title'],
    ['survey_number', 'legal_title'],
    ['survey_numbers', 'legal_title'],
    ['sy_no', 'legal_title'],
    ['hissa_number', 'legal_title'],
    ['khata_number', 'legal_title'],
    ['khata_no', 'legal_title'],
    ['pid_number', 'legal_title'],
    ['pid', 'legal_title'],
    ['mutation_number', 'legal_title'],
    ['document_number', 'legal_title'],
    ['sub_registrar_office', 'legal_title'],
    // Encumbrance
    ['encumbrances_mentioned', 'legal_encumbrance'],
    ['nil_encumbrance', 'legal_encumbrance'],
    ['outstanding_liabilities', 'legal_encumbrance'],
    ['charge_description', 'legal_encumbrance'],
    ['transactions', 'legal_encumbrance'],
    // RERA
    ['rera_number', 'legal_rera'],
    ['rera_registration_number', 'legal_rera'],
    // Statutory approvals
    ['layout_approval_number', 'legal_approvals'],
    ['sanctioned_plan_number', 'legal_approvals'],
    ['conversion_certificate_number', 'legal_approvals'],
    ['converted_from', 'legal_approvals'],
    ['converted_to', 'legal_approvals'],
    ['issuing_authority', 'legal_approvals'],
    ['valid_until', 'legal_approvals'],
    ['order_number', 'legal_approvals'],
  ])('%s → %s', (field, lane) => {
    expect(legalFourLaneForField(field)).toBe(lane);
    expect(isLegalFourField(field)).toBe(true);
  });

  test('rule order resolves rera_registration_number to RERA, not title', () => {
    // /registration_number/ would otherwise claim it for legal_title.
    expect(legalFourLaneForField('rera_registration_number')).toBe('legal_rera');
  });

  test('_original transliteration siblings inherit their parent lane', () => {
    // The multilingual contract emits owner_name_original alongside owner_name;
    // both carry the same statutory fact.
    expect(legalFourLaneForField('owner_name_original')).toBe('legal_title');
    expect(legalFourLaneForField('survey_number_original')).toBe('legal_title');
  });

  test.each([
    ['crop_details'], ['soil_type'], ['water_source'], ['nature_of_land'],
    ['road_width_mtrs'], ['area_sqft'], ['total_area_acres'], ['land_area_sqft'],
    ['consideration_inr'], ['circle_rate_per_sqft'], ['zone_code'], ['planning_zone'],
    ['fsi'], ['guidance_locality'], ['village'], ['hobli'], ['taluk'], ['district'],
    ['remarks'], ['summary'], ['pincode'], ['detected_languages'],
  ])('%s is NOT legal-four (over-flagging would make the signal meaningless)', (field) => {
    expect(legalFourLaneForField(field)).toBeNull();
    expect(isLegalFourField(field)).toBe(false);
  });

  test.each([[null], [undefined], [''], [42], [{}]])('%p is handled without throwing → null', (input) => {
    expect(legalFourLaneForField(input)).toBeNull();
    expect(isLegalFourField(input)).toBe(false);
  });

  test('bookkeeping keys are never facts', () => {
    expect(legalFourLaneForField('_overall')).toBeNull();
    expect(legalFourLaneForField('_signal_version')).toBeNull();
  });

  test('every lane it can emit is a real legal-four topic (vocabulary is shared)', () => {
    for (const rule of LEGAL_FOUR_FIELD_RULES) {
      expect(LEGAL_FOUR_TOPICS).toContain(rule.lane);
      expect(isLegalFourTopic(rule.lane)).toBe(true);
      expect(legalFourLabelForLane(rule.lane)).toBeTruthy();
    }
  });
});

// ─── THE CI GUARD ─────────────────────────────────────────────────────────────

/**
 * Every canonical field `FIELD_MAP_RULES` can auto-fill, with a DELIBERATE
 * lane decision. Adding an auto-fill destination without reviewing it here
 * fails the test below.
 */
const REVIEWED_CANONICAL_LANES = Object.freeze({
  // Statutory facts — ownership + parcel/record identity. Never auto-filled.
  survey_number: 'legal_title',
  pid: 'legal_title',
  khata_number: 'legal_title',
  owner_name: 'legal_title',
  // Measurements, money, and regulatory classification. Auto-fillable when the
  // deterministic signal actually verifies them — none is one of the four
  // statutory lanes (title chain / encumbrance / RERA / approval STATUS).
  land_area_sqft: null,
  land_area_acres: null,
  road_width_m: null,
  consideration_inr: null,
  circle_rate_per_sqft: null,
  zone_code: null,
  planning_zone: null,
  guidance_locality: null,
  guidance_road_name: null,
  sro_name: null,
  fsi: null,
});

describe('CI guard — every auto-fill destination has a reviewed lane', () => {
  const canonicalFields = Object.keys(__internal.FIELD_MAP_RULES);

  test('FIELD_MAP_RULES is reachable from the test (guard cannot silently no-op)', () => {
    expect(canonicalFields.length).toBeGreaterThan(0);
  });

  test('no auto-fill destination is unreviewed', () => {
    const unreviewed = canonicalFields.filter(
      (f) => !Object.prototype.hasOwnProperty.call(REVIEWED_CANONICAL_LANES, f),
    );
    expect(unreviewed).toEqual([]); // ← add it to REVIEWED_CANONICAL_LANES, deciding its lane
  });

  test('no reviewed entry has gone stale (removed from FIELD_MAP_RULES)', () => {
    const stale = Object.keys(REVIEWED_CANONICAL_LANES).filter((f) => !canonicalFields.includes(f));
    expect(stale).toEqual([]);
  });

  test('the classifier agrees with every reviewed decision', () => {
    for (const [field, expectedLane] of Object.entries(REVIEWED_CANONICAL_LANES)) {
      expect(legalFourLaneForField(field)).toBe(expectedLane);
    }
  });

  test('the four title-lane identity fields are classified legal (the 2026-07-16 regression)', () => {
    // These are the exact fields that shipped pre-ticked at "High · 100%".
    for (const field of ['owner_name', 'survey_number', 'khata_number', 'pid']) {
      expect(isLegalFourField(field)).toBe(true);
    }
  });

  test('the auto-fill feature survives — most destinations remain usable', () => {
    // Guards the opposite failure: an over-broad pattern that flags everything
    // makes the signal meaningless and kills a feature that is safe for
    // measurements and rates.
    const general = canonicalFields.filter((f) => !isLegalFourField(f));
    expect(general.length).toBeGreaterThanOrEqual(canonicalFields.length - 5);
  });
});
