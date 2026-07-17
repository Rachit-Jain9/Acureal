'use strict';

/**
 * Deterministic quality assessment for AI-extracted document fields.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 * `computeConfidenceScores` scored a field **1.0 if it was non-empty, 0 if it
 * was null**. That fill-rate was stored in `confidence_scores`, rendered as a
 * "High · 100%" confidence pill, and used to PRE-TICK rows for one-click
 * application to the deal record. It measured nothing about correctness: a
 * hallucinated owner name and a perfectly-read one both scored 1.0. Worse, the
 * only variance came from `FIELD_MAP_RULES`' alias `boost`, so the percentage
 * an operator read as "the AI's confidence" actually encoded *which alias
 * spelling matched the field name*.
 *
 * ── The replacement ──────────────────────────────────────────────────────────
 * No probability is invented here. Every field is judged by rules REDIP can
 * execute and explain, and each answer maps to a reason string the operator
 * can act on:
 *
 *   GROUNDING  — does the value literally appear in the source document text?
 *                This is the only non-probabilistic way to separate a real
 *                read from a fluent guess. Available for the 'parseable' tier
 *                (spreadsheet / doc / deck / CSV / KML), where REDIP holds a
 *                verbatim transcription. For native scans (PDF / image) there
 *                is no separate source text, so grounding reports `null`
 *                (unknown) — never a fabricated pass.
 *
 *   SCHEMA     — does the value match the shape its name implies (a date that
 *                parses, an area that is a positive number, a 6-digit pincode)?
 *                Deterministic, available for every tier. A field with no rule
 *                reports `null`, never `false`.
 *
 *   LANE       — is this one of CLAUDE.md's "legal four" (title chain,
 *                encumbrance, RERA, statutory approval)? Those are
 *                extraction aid only and must carry a human-verification
 *                prompt, so they are capped below the auto-fill threshold no
 *                matter how well they ground.
 *
 * ── Why the output is still a 0..1 number ────────────────────────────────────
 * The ontology (`packages/real-estate-ontology`, `confidence_bands`) already
 * encodes the POLICY we want, keyed off a 0..1 score:
 *     high   ≥0.80  "Auto-fill candidate — operator may accept-all-high in bulk."
 *     medium 0.50–0.80  "Requires explicit per-field review before apply."
 *     low    <0.50  "Surface only as 'verify' suggestion; never auto-fill."
 * The policy was never the problem — the input to it was a lie. Emitting an
 * honest score through the existing bands means the safety property
 * ("legal four never auto-fill") is enforced by machinery that already exists,
 * rather than by a new parallel gate that could drift. Each score below is a
 * fixed constant tied to a named verification status — NOT a probability, and
 * never interpolated. `_signal_version` stamps the semantics so downstream
 * consumers (notably the `extraction_field_verdicts` learning corpus) can tell
 * graded rows from legacy fill-rate rows and never mix the two when
 * calibrating.
 */

const { legalFourLaneForField, legalFourLabelForLane } = require('../constants/legalFourFields');
const { normalizeField } = require('./extractionNormalizers');

/**
 * Bumped whenever the scoring semantics change. v1 (implicit, absent) was the
 * binary fill-rate; v2 is this deterministic assessment. Consumers that
 * calibrate on historical scores MUST filter on this.
 */
const SIGNAL_VERSION = 2;

/**
 * Fixed scores per verification status. Chosen to land in the ontology band
 * whose POLICY matches the status — the number is an address into the band
 * table, not a confidence estimate.
 */
const STATUS_SCORE = Object.freeze({
  absent: 0,             // low  — nothing extracted
  format_mismatch: 0.20, // low  — never auto-fill: value contradicts its own field's shape
  not_in_source: 0.35,   // low  — never auto-fill: we HAD the document text and could not find this value
  verify_legal: 0.40,    // low  — never auto-fill: statutory fact, human must verify (CLAUDE.md)
  unverified: 0.55,      // med  — per-field review: present, but nothing to check it against
  format_checked: 0.65,  // med  — per-field review: shape is right, but unproven against the document
  source_verified: 0.90, // high — auto-fill candidate: found verbatim in the document AND shape is right
});

// ─── Grounding ────────────────────────────────────────────────────────────────

/** Fold a string for comparison: lowercase, collapse whitespace, trim. */
const fold = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Digits only — lets "45,000" in the document match an extracted 45000. */
const digitsOf = (s) => String(s).replace(/[^\d]/g, '');

/**
 * Values shorter than this are not grounded: a 1-character value ("A", "7")
 * appears in almost any document by chance, so a match would prove nothing.
 * Reporting `null` (unknown) is the honest answer.
 */
const MIN_GROUNDABLE_LENGTH = 2;

/**
 * Does `value` literally appear in the document's transcribed text?
 *
 * @returns {true|false|null} null when grounding cannot be attempted
 *          (no source text, or the value is too short / not scalar to prove).
 */
const groundValue = (value, foldedSource, foldedSourceDigits) => {
  if (!foldedSource) return null; // native scan — no source text to check against
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return null; // arrays/objects are grounded per-leaf by the caller

  const raw = String(value).trim();
  if (raw.length < MIN_GROUNDABLE_LENGTH) return null;

  if (foldedSource.includes(fold(raw))) return true;

  // Numeric fallback: an extracted 1306800 legitimately appears as
  // "13,06,800" (Indian grouping) or "1,306,800" in the source. Compare the
  // digit skeletons. Guarded to values that are substantially numeric so a
  // name is never "grounded" by its stray digits.
  const digits = digitsOf(raw);
  if (digits.length >= 3 && digits.length >= raw.replace(/\s/g, '').length - 4) {
    if (foldedSourceDigits.includes(digits)) return true;
  }

  return false;
};

// ─── Schema validators ────────────────────────────────────────────────────────

const isFiniteNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  const cleaned = v.replace(/[,\s₹]/g, '');
  return cleaned !== '' && Number.isFinite(Number(cleaned));
};

const numberOf = (v) => Number(String(v).replace(/[,\s₹]/g, ''));

/**
 * Ordered validators, matched on field name. First match wins; a field with no
 * matching rule is `null` (no opinion), NEVER `false`. Each returns
 * true = conforms, false = contradicts its own shape.
 *
 * These deliberately validate SHAPE ONLY. They never rewrite a value (that is
 * the future deterministic-normalizer's job) and never judge plausibility of a
 * legal fact.
 */
const SCHEMA_RULES = Object.freeze([
  {
    name: 'date',
    // registration_date, mutation_date, issue_date, period_from/to, valid_until…
    pattern: /(^|_)(date|dates)(_|$)|_date$|^date$|period_(from|to)|valid_until|expiry|_at$/i,
    check: (v) => {
      const s = String(v).trim();
      // ISO is what every prompt asks for. Accept the common Indian
      // DD-MM-YYYY / DD.MM.YYYY / DD/MM/YYYY too — those are correctly-read
      // values in a non-canonical FORMAT, which is a normalizer's problem,
      // not a correctness problem. Anything else contradicts the field.
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return !Number.isNaN(Date.parse(s));
      if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)) return true;
      if (/^\d{4}$/.test(s)) return true; // bare year (launch_year etc.)
      return false;
    },
  },
  {
    name: 'area',
    pattern: /_sqft$|_sq_ft$|_acres$|_sqm$|(^|_)area(_|$)/i,
    // An area is a positive magnitude. A string like "34 Acres 32 Guntas" is a
    // correctly-read value carrying its unit — shape-valid; converting it is a
    // normalizer's job. Only a non-numeric, non-measurement string fails.
    check: (v) => {
      if (isFiniteNumber(v)) return numberOf(v) > 0;
      return /\d/.test(String(v)) && /acre|gunta|sq\.?\s?(ft|m)|sqft|sqm|cent|hectare/i.test(String(v));
    },
  },
  {
    name: 'money',
    pattern: /_inr$|_usd$|consideration|_price(_|$)|price_|stamp_duty|registration_fee|_cr$|_crore$|tax_inr/i,
    check: (v) => {
      if (isFiniteNumber(v)) return numberOf(v) >= 0;
      return /\d/.test(String(v)) && /₹|rs\.?|inr|lakh|crore|cr\b/i.test(String(v));
    },
  },
  {
    name: 'pincode',
    pattern: /(^|_)pin_?code(_|$)/i,
    check: (v) => /^\d{6}$/.test(String(v).replace(/\s/g, '')),
  },
  {
    name: 'percent',
    pattern: /_pct$|_percent(age)?$/i,
    check: (v) => isFiniteNumber(v) && numberOf(v) >= 0 && numberOf(v) <= 100,
  },
  {
    name: 'identifier',
    // Survey / khata / PID / document numbers. Validated ONLY for "carries a
    // digit and is not prose" — deliberately weak. `72/1`, `72-1` and `72/1A`
    // are DIFFERENT parcels; this rule must never encourage treating them as
    // interchangeable, so it checks presence, never form.
    pattern: /survey_(no|number|numbers)|^sy_no$|hissa|khata|(^|_)pid(_|$)|document_number|mutation_number|order_number|(^|_)pd_number(_|$)/i,
    check: (v) => {
      const s = String(v).trim();
      if (s.length === 0 || s.length > 120) return false;
      return /\d/.test(s);
    },
  },
]);

/** @returns {true|false|null} null = no rule for this field name. */
const checkSchema = (fieldName, value) => {
  // Shape rules validate SCALARS. A field whose value is an array or object
  // (e.g. `key_dates: [{date, label}, …]`, `property_details: {…}`) is a
  // CONTAINER — its leaves are facts, the container is not. Condemning it as a
  // "format mismatch" ("likely misread") would be a wrong reason: nothing was
  // misread, we simply didn't shape-check at this level. Decline instead.
  if (value !== null && typeof value === 'object') return null;
  for (const rule of SCHEMA_RULES) {
    if (rule.pattern.test(fieldName)) {
      try {
        return Boolean(rule.check(value));
      } catch {
        return null; // a throwing rule must never condemn a value
      }
    }
  }
  return null;
};

// ─── Assessment ───────────────────────────────────────────────────────────────

const isEmptyValue = (value) => {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

/**
 * Metadata keys emitted by the multilingual prompt contract. They describe the
 * READ, not a fact about the property, so they are not scored as evidence.
 */
const isMetadataKey = (key) => key === 'detected_languages' || key.startsWith('_');

/** The transliteration sibling of `owner_name` is `owner_name_original`. */
const originalKeyFor = (key) => `${key}_original`;
const isOriginalKey = (key) => key.endsWith('_original');

const REASONS = Object.freeze({
  source_verified: 'Found verbatim in the document text.',
  format_checked: 'Matches the expected format, but could not be checked against the document text (scanned source).',
  unverified: 'Read by AI. REDIP could not verify it against the document text — check it against the source.',
  not_in_source: 'REDIP read the document text and could NOT find this value in it — it may be inferred rather than stated. Verify against the source.',
  format_mismatch: 'Does not match the format this field expects — likely misread. Verify against the source.',
  absent: 'Not found in this document.',
});

/**
 * Assess one field.
 *
 * @param {string} fieldName
 * @param {*} value
 * @param {{foldedSource: string|null, foldedSourceDigits: string, originalValue: *}} ctx
 */
const assessField = (fieldName, value, ctx) => {
  const lane = legalFourLaneForField(fieldName);
  const present = !isEmptyValue(value);

  if (!present) {
    return {
      present: false, lane, grounded: null, schemaValid: null,
      status: 'absent', reason: REASONS.absent, score: STATUS_SCORE.absent,
    };
  }

  const schemaValid = checkSchema(fieldName, value);

  // Ground the ORIGINAL script where the multilingual contract supplied one:
  // "Mohan G" is a transliteration of "ಶ್ರೀ ಮೋಹನ್ ಜಿ" and will never appear
  // verbatim in a Kannada document — its `_original` sibling will. Grounding
  // the transliteration would report a false "not in source" on every
  // correctly-read Kannada field.
  const groundTarget = ctx.originalValue !== undefined && !isEmptyValue(ctx.originalValue)
    ? ctx.originalValue
    : value;
  const grounded = groundValue(groundTarget, ctx.foldedSource, ctx.foldedSourceDigits);

  // Order is the policy. Contradictions first, then the statutory cap, then
  // positive evidence.
  let status;
  if (schemaValid === false) status = 'format_mismatch';
  else if (grounded === false) status = 'not_in_source';
  else if (lane) status = 'verify_legal';
  else if (grounded === true) status = 'source_verified';
  else if (schemaValid === true) status = 'format_checked';
  else status = 'unverified';

  let reason;
  if (status === 'verify_legal') {
    const laneLabel = legalFourLabelForLane(lane);
    const basis = grounded === true
      ? 'Found verbatim in the document text, but '
      : '';
    reason = `${basis}${basis ? 'this' : 'This'} is a ${laneLabel.toLowerCase()} fact — REDIP never fills these automatically. Verify against the source document before applying.`;
  } else {
    reason = REASONS[status];
  }

  // Deterministic normalization proposal ("34 Acres 32 Guntas" → 34.8 acre,
  // "06.02.2024" → 2024-02-06, "₹1.25 crore" → 12500000). ORTHOGONAL to the
  // verification status above — the assessment judges the RAW value; the
  // proposal is a standard spelling of the same fact, raw immutable beside
  // it. null when nothing applies (bare numbers, identifiers, names, blanks).
  const normalized = normalizeField(fieldName, value);

  return {
    present: true, lane, grounded, schemaValid, status, reason,
    score: STATUS_SCORE[status],
    ...(normalized ? { normalized } : {}),
  };
};

/**
 * Assess every field of an extraction.
 *
 * @param {object|null} structuredFields  provider output, exactly as returned
 * @param {{docType?: string, sourceText?: string|null}} options
 *        `sourceText` — the verbatim transcription for 'parseable'-tier files.
 *        Omit/null for native scans: grounding then honestly reports unknown.
 * @returns {{scores: object, assessments: object}}
 *          `scores` keeps the historical `confidence_scores` shape
 *          ({field: 0..1, _overall}) so every existing consumer keeps working,
 *          plus `_signal_version`.
 */
const assessExtractionFields = (structuredFields, options = {}) => {
  if (!structuredFields || typeof structuredFields !== 'object') {
    return { scores: {}, assessments: {} };
  }

  const sourceText = options.sourceText || null;
  const foldedSource = sourceText ? fold(sourceText) : null;
  const foldedSourceDigits = sourceText ? digitsOf(sourceText) : '';

  const scores = {};
  const assessments = {};

  for (const [key, value] of Object.entries(structuredFields)) {
    if (isMetadataKey(key)) continue;
    // `*_original` keys are grounding INPUT for their parent, not separate
    // facts — scoring them would double-count every multilingual field.
    if (isOriginalKey(key)) continue;

    const assessment = assessField(key, value, {
      foldedSource,
      foldedSourceDigits,
      originalValue: structuredFields[originalKeyFor(key)],
    });

    scores[key] = assessment.score;
    assessments[key] = assessment;
  }

  const keys = Object.keys(scores);
  const total = keys.length;
  scores._overall = total
    ? parseFloat((keys.reduce((sum, k) => sum + scores[k], 0) / total).toFixed(2))
    : 0;
  scores._signal_version = SIGNAL_VERSION;

  return { scores, assessments };
};

module.exports = {
  assessExtractionFields,
  SIGNAL_VERSION,
  STATUS_SCORE,
  // Exported for tests
  __internal: { assessField, groundValue, checkSchema, fold, digitsOf, SCHEMA_RULES, REASONS },
};
