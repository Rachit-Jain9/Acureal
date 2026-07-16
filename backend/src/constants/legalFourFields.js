'use strict';

/**
 * FIELD-level legal-four classifier — the companion to `legalFourTopics.js`.
 *
 * `legalFourTopics` answers "may AI narrate about this TOPIC?" for the
 * recommendation / diagnostic / learning spine. This module answers a
 * different question on a different surface:
 *
 *     "Is this EXTRACTED FIELD a statutory fact that a human must verify
 *      against the source document before it is written to a deal record?"
 *
 * Same four lanes, same vocabulary (`legal_title` / `legal_encumbrance` /
 * `legal_rera` / `legal_approvals`) so the two never drift.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * CLAUDE.md: the legal four are "extraction/synthesis aid only, with human
 * verification prompts". Until 2026-07-16 the AutoFill review surface violated
 * that completely: `computeConfidenceScores` scored EVERY non-empty field 1.0,
 * which rendered as "High confidence" and PRE-TICKED the row for one-click
 * application to the deal record. `owner_name`, `survey_number`,
 * `khata_number` and `pid` — ownership and parcel identity, the heart of the
 * title lane — arrived pre-approved. A hallucinated owner name and a correctly
 * read one were visually identical and both ticked.
 *
 * ── Why this defaults to ALLOW, unlike legalFourTopics ───────────────────────
 * `legalFourTopics` default-DENIES by `legal_` prefix, which is right there:
 * topics are a small curated vocabulary, so an unrecognised `legal_*` lane is
 * almost certainly legal. Field names are the opposite — an open set of ~200
 * keys across 23 doctype prompts (`crop_details`, `soil_type`, `water_source`,
 * `road_width_mtrs`…). Default-deny would classify a crop record as a
 * statutory fact, drown the operator in verification prompts, and make the
 * signal meaningless through over-flagging — the failure mode where everything
 * is urgent so nothing is.
 *
 * Safety instead comes from three properties, together:
 *   1. the patterns below are deliberately BROAD within each lane (they match
 *      `_original` transliteration siblings and alias spellings too);
 *   2. `legalFourFields.test.js` pins EVERY canonical auto-fill target in
 *      `FIELD_MAP_RULES` to an explicitly reviewed lane — so adding a new
 *      auto-fill destination FAILS CI until someone decides its lane; and
 *   3. classification only ever RESTRICTS (caps the score to "never
 *      auto-fill"). A miss degrades to today's behaviour; it cannot promote a
 *      field or invent a fact.
 *
 * Pure deterministic string matching — no LLM (CLAUDE.md: "Never use LLMs for
 * ... rule-engine decisions").
 */

const { LEGAL_FOUR_TOPICS } = require('./legalFourTopics');

/**
 * Ordered rules. FIRST match wins, so the order is load-bearing:
 * `rera_registration_number` must resolve to `legal_rera`, not `legal_title`
 * (which would otherwise claim it via /registration_number/).
 */
const LEGAL_FOUR_FIELD_RULES = Object.freeze([
  {
    lane: 'legal_rera',
    label: 'RERA registration',
    // Any RERA reference: rera_number, rera_registration_number,
    // rera_registration_number_property, project_rera_id…
    pattern: /rera/i,
  },
  {
    lane: 'legal_encumbrance',
    label: 'Encumbrance',
    // EC findings, charges on title, and the EC transaction ledger itself.
    pattern: /encumbrance|liabilit|mortgage|\blien\b|charge_description|^transactions$/i,
  },
  {
    lane: 'legal_approvals',
    label: 'Statutory approval',
    // Approval / sanction / conversion / OC / CC / permits, and the order
    // facts that carry an approval's status (number, date, authority, expiry).
    pattern: /approval|sanction|conversion|converted_(from|to)|occupancy|commencement|permit|licen[sc]e|zoning_certificate|issuing_authority|order_(number|date)|valid_until|conditions?(_|$)/i,
  },
  {
    lane: 'legal_title',
    label: 'Title & ownership',
    pattern: new RegExp([
      // Ownership + party identity (incl. *_original transliteration siblings)
      '(^|_)owners?(_|$)',
      'grantor|grantee|vendor|seller|buyer|purchaser|transferor|transferee',
      '(^|_)occupant',
      'chain_of_title|mother_deed',
      '(^|_)part(y|ies)(_|$)|^party_[12]$|witnesses',
      // Parcel + record identity — what the title attaches TO
      '(^|_)survey(_|$)|survey_(no|number|numbers)|^sy_no$',
      'hissa',
      'khata',
      '(^|_)pid(_|$)|pid_number',
      '(^|_)patta(_|$)',
      // Registration + mutation chain
      'mutation',
      'sub_registrar|registration_(no|number)|document_number',
    ].join('|'), 'i'),
  },
]);

/**
 * Resolve the legal-four lane for an extracted field name.
 *
 * @param {string} fieldName  raw key as returned by the extraction prompt
 * @returns {'legal_title'|'legal_encumbrance'|'legal_rera'|'legal_approvals'|null}
 *          null → not a legal-four field (the common case)
 */
const legalFourLaneForField = (fieldName) => {
  if (typeof fieldName !== 'string' || fieldName.length === 0) return null;
  // Bookkeeping keys (_overall, _signal_version…) are never facts.
  if (fieldName.startsWith('_')) return null;
  for (const rule of LEGAL_FOUR_FIELD_RULES) {
    if (rule.pattern.test(fieldName)) return rule.lane;
  }
  return null;
};

/** True when the field carries a statutory fact requiring human verification. */
const isLegalFourField = (fieldName) => legalFourLaneForField(fieldName) !== null;

/** Human label for a lane — used in the review UI's per-field reason. */
const LANE_LABELS = Object.freeze(
  Object.fromEntries(LEGAL_FOUR_FIELD_RULES.map((r) => [r.lane, r.label])),
);

const legalFourLabelForLane = (lane) => LANE_LABELS[lane] || null;

module.exports = {
  LEGAL_FOUR_FIELD_RULES,
  LEGAL_FOUR_TOPICS,
  legalFourLaneForField,
  isLegalFourField,
  legalFourLabelForLane,
};
