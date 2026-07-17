'use strict';

/**
 * Deterministic, versioned normalizers for AI-extracted field values.
 *
 * WHY: extraction returns values exactly as the document states them —
 * "34 Acres 32 Guntas", "₹1.25 crore", "06.02.2024". That fidelity is
 * correct (the raw reading is evidence), but the apply path's
 * `ontology.validateAndCoerce` can only coerce plain numerics, so an operator
 * could APPROVE such a value in the review modal and have it silently land in
 * `skipped` ("Could not coerce to number"). These normalizers convert the
 * common Indian real-estate formats to canonical values so the proposal is
 * actually appliable — while the raw value stays immutable beside it.
 *
 * RULES (the contract — every rule below is load-bearing):
 *  • DETERMINISTIC ONLY. String → value transformations a reviewer can verify
 *    by hand. No model, no inference, no plausibility judgment (CLAUDE.md:
 *    never use LLMs for deterministic math).
 *  • THE RAW VALUE IS IMMUTABLE. A normalizer returns a NEW value beside the
 *    raw; nothing ever rewrites `structured_fields`.
 *  • NEVER POPULATES A BLANK. Empty in → null out (not applicable).
 *  • NEVER TOUCHES IDENTIFIERS OR NAMES. `72/1`, `72-1` and `72/1A` are
 *    DIFFERENT parcels; khata/PID/document numbers and party names are
 *    transcriptions, not quantities. No rule matches them, and a hard
 *    exclusion guards against a future rule accidentally doing so.
 *  • AMBIGUITY IS FLAGGED, NOT HIDDEN. A date like 06.02.2024 normalizes
 *    under the documented Indian day-first convention with status 'assumed'
 *    and a caveat the operator reads; a value that cannot be read at all
 *    returns status 'failed' with the reason. Only day>12 dates (provably
 *    day-first) get status 'exact'.
 *  • VERSIONED. Every result names the exact rule that produced it
 *    (e.g. 'area_acre_gunta_v1') so an audit can replay any normalization
 *    against the rule text that made it.
 *
 * Result shape (or null when no rule applies / value is blank / non-scalar):
 *   { value, unit, rule, status: 'exact'|'assumed'|'failed', reason }
 *   'failed' results carry NO value — the proposal falls back to the raw.
 */

// ─── Exclusions ───────────────────────────────────────────────────────────────

// Fields whose values are transcriptions, not quantities. A normalizer must
// never restate these, whatever a future rule's name-pattern accidentally
// matches. Mirrors the identifier discipline in extractionFieldQuality.
const EXCLUDED_FIELD_PATTERN = new RegExp([
  'survey_(no|number|numbers)|^sy_no$|hissa|khata|(^|_)pid(_|$)|(^|_)patta(_|$)',
  'document_number|mutation_number|order_number|registration_(no|number)|(^|_)pd_number(_|$)',
  '(^|_)owners?(_|$)|grantor|grantee|vendor|seller|buyer|purchaser|transferor|transferee|occupant|part(y|ies)|witnesses',
  '(^|_)name(_|$)|_name$',
  'address|boundar|schedule',
].join('|'), 'i');

// ─── Shared parsing helpers ───────────────────────────────────────────────────

const asTrimmedString = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return ''; // containers are never normalized
  return String(value).trim();
};

/** "13,06,800.50" / "1,306,800" → 1306800.5 — grouping-agnostic. */
const parseGroupedNumber = (s) => {
  const cleaned = s.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// ─── Dates (rule family: date_in) ─────────────────────────────────────────────

const MONTHS = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
});

const isRealDate = (y, m, d) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Indian document dates → ISO YYYY-MM-DD.
 *  • Already ISO → null (nothing to do).
 *  • DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY, day > 12 → 'exact' (provably
 *    day-first: no month is >12).
 *  • Both parts ≤ 12 → 'assumed' under the day-first convention Indian
 *    registries and government correspondence use, with the caveat spelled
 *    out — the reviewer sees both readings.
 *  • "6 Feb 2024" / "Feb 6, 2024" / "6th February 2024" → 'exact' (month is
 *    named, no ambiguity).
 *  • Two-digit years → 'failed' (century is a guess; guessing is the job we
 *    refuse).
 */
const normalizeDate = (raw) => {
  const s = raw.replace(/\s+/g, ' ').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; // already canonical

  // Numeric D-M-Y (the Indian standard order)
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [, aStr, bStr, yStr] = m;
    const a = Number(aStr); const b = Number(bStr); const y = Number(yStr);
    if (a > 12 && b <= 12) {
      if (!isRealDate(y, b, a)) return { rule: 'date_in_v1', status: 'failed', reason: `"${s}" is not a real calendar date.` };
      return { value: iso(y, b, a), unit: 'date', rule: 'date_in_v1', status: 'exact', reason: `Read as day-month-year: ${s} → ${iso(y, b, a)}.` };
    }
    if (a <= 12 && b > 12) {
      // Month-first was written (e.g. 02.24.2024 is impossible day-first).
      if (!isRealDate(y, a, b)) return { rule: 'date_in_v1', status: 'failed', reason: `"${s}" is not a real calendar date.` };
      return { value: iso(y, a, b), unit: 'date', rule: 'date_in_v1', status: 'exact', reason: `Read as month-day-year (only possible reading): ${s} → ${iso(y, a, b)}.` };
    }
    if (a <= 12 && b <= 12) {
      if (!isRealDate(y, b, a)) return { rule: 'date_in_v1', status: 'failed', reason: `"${s}" is not a real calendar date.` };
      return {
        value: iso(y, b, a),
        unit: 'date',
        rule: 'date_in_v1',
        status: 'assumed',
        reason: `Read day-first (Indian convention): ${s} → ${iso(y, b, a)}. If this document uses month-first dates, the correct value is ${iso(y, a, b)} — confirm against the source.`,
      };
    }
    return { rule: 'date_in_v1', status: 'failed', reason: `"${s}" is not a real calendar date.` };
  }

  // Named-month forms: "6 Feb 2024", "6th February 2024", "Feb 6, 2024"
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/)
    || s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m) {
    const dayFirst = /^\d/.test(m[1]);
    const dayStr = dayFirst ? m[1] : m[2];
    const monStr = (dayFirst ? m[2] : m[1]).toLowerCase().slice(0, 4).replace(/[^a-z]/g, '');
    const mon = MONTHS[monStr] ?? MONTHS[monStr.slice(0, 3)];
    const d = Number(dayStr); const y = Number(m[3]);
    if (!mon || !isRealDate(y, mon, d)) {
      return { rule: 'date_in_v1', status: 'failed', reason: `Could not read "${s}" as a date.` };
    }
    return { value: iso(y, mon, d), unit: 'date', rule: 'date_in_v1', status: 'exact', reason: `${s} → ${iso(y, mon, d)}.` };
  }

  // Two-digit year — refusing beats guessing the century.
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2}$/.test(s)) {
    return { rule: 'date_in_v1', status: 'failed', reason: `"${s}" has a two-digit year — the century would be a guess. Confirm against the source.` };
  }

  return null; // not date-shaped at all → no opinion
};

// ─── Areas (rule family: area) ────────────────────────────────────────────────

const GUNTAS_PER_ACRE = 40;
const CENTS_PER_ACRE = 100;

/**
 * Indian land-extent strings → a decimal quantity + unit.
 *  • "34 Acres 32 Guntas" → 34.8 acre  (1 gunta = 1/40 acre)
 *  • "32 guntas"          → 0.8 acre
 *  • "2 acres 20 cents"   → 2.2 acre   (1 cent = 1/100 acre)
 *  • "45,000 sq ft"       → 45000 sqft
 *  • "1,200 sq m"         → 1200 sqm   (unit conversion is the ontology
 *    transform's job — a normalizer reports what the document SAYS, in the
 *    unit it says it in)
 * A bare number is already canonical → null.
 */
const normalizeArea = (raw) => {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (parseGroupedNumber(s) !== null) return null; // bare number — nothing to do

  const num = '(\\d+(?:[.,]\\d+)*)';
  const acres = s.match(new RegExp(`${num}\\s*(?:acres?|ac\\.?)(?![a-z])`, 'i'));
  const guntas = s.match(new RegExp(`${num}\\s*(?:gunt(?:a|e|ha)s?)`, 'i'));
  const cents = s.match(new RegExp(`${num}\\s*(?:cents?)(?![a-z])`, 'i'));
  const sqft = s.match(new RegExp(`${num}\\s*(?:sq\\.?\\s?(?:ft|feet)|sqft|square\\s+feet)`, 'i'));
  const sqm = s.match(new RegExp(`${num}\\s*(?:sq\\.?\\s?(?:m|mtrs?|meters?|metres?)|sqm)`, 'i'));

  const take = (match) => parseGroupedNumber(match[1].replace(/,/g, ''));

  if (acres || guntas || cents) {
    let total = 0;
    const parts = [];
    if (acres) { const v = take(acres); if (v === null) return { rule: 'area_acre_gunta_v1', status: 'failed', reason: `Could not read the acre figure in "${s}".` }; total += v; parts.push(`${v} acre`); }
    if (guntas) { const v = take(guntas); if (v === null) return { rule: 'area_acre_gunta_v1', status: 'failed', reason: `Could not read the gunta figure in "${s}".` }; total += v / GUNTAS_PER_ACRE; parts.push(`${v} gunta`); }
    if (cents) { const v = take(cents); if (v === null) return { rule: 'area_acre_gunta_v1', status: 'failed', reason: `Could not read the cent figure in "${s}".` }; total += v / CENTS_PER_ACRE; parts.push(`${v} cent`); }
    if (total <= 0) return { rule: 'area_acre_gunta_v1', status: 'failed', reason: `"${s}" reads as zero extent.` };
    return {
      value: round(total, 4),
      unit: 'acre',
      rule: 'area_acre_gunta_v1',
      status: 'exact',
      reason: `${parts.join(' + ')} = ${round(total, 4)} acres (1 gunta = 1/40 acre${cents ? ', 1 cent = 1/100 acre' : ''}).`,
    };
  }

  if (sqft) {
    const v = take(sqft);
    if (v === null || v <= 0) return { rule: 'area_sqft_v1', status: 'failed', reason: `Could not read the sq ft figure in "${s}".` };
    return { value: v, unit: 'sqft', rule: 'area_sqft_v1', status: 'exact', reason: `${s} → ${v.toLocaleString('en-IN')} sqft.` };
  }
  if (sqm) {
    const v = take(sqm);
    if (v === null || v <= 0) return { rule: 'area_sqm_v1', status: 'failed', reason: `Could not read the sq m figure in "${s}".` };
    return { value: v, unit: 'sqm', rule: 'area_sqm_v1', status: 'exact', reason: `${s} → ${v.toLocaleString('en-IN')} sqm.` };
  }

  return null; // not an area expression we recognise → no opinion
};

// ─── Money (rule family: money_in) ────────────────────────────────────────────

const LAKH = 1e5;
const CRORE = 1e7;

/**
 * Indian money strings → INR.
 *  • "₹1.25 crore" / "1.25 Cr" / "Rs. 1.25 crores" → 12500000
 *  • "1 crore 25 lakh"                             → 12500000
 *  • "85 lakh" / "₹85 lacs"                        → 8500000
 *  • "₹12,50,000" / "Rs 12,50,000/-"               → 1250000
 * A bare number is already canonical → null.
 */
const normalizeMoney = (raw) => {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (parseGroupedNumber(s) !== null) return null; // bare number

  const stripped = s.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/\/-\s*$/, '').trim();

  const num = '(\\d+(?:[.,]\\d+)*)';
  const croreM = stripped.match(new RegExp(`${num}\\s*(?:crores?|cr\\.?)(?![a-z])`, 'i'));
  const lakhM = stripped.match(new RegExp(`${num}\\s*(?:lakhs?|lacs?)(?![a-z])`, 'i'));

  if (croreM || lakhM) {
    let total = 0;
    const parts = [];
    if (croreM) {
      const v = parseGroupedNumber(croreM[1].replace(/,/g, ''));
      if (v === null) return { rule: 'money_in_v1', status: 'failed', reason: `Could not read the crore figure in "${s}".` };
      total += v * CRORE; parts.push(`${v} crore`);
    }
    if (lakhM) {
      const v = parseGroupedNumber(lakhM[1].replace(/,/g, ''));
      if (v === null) return { rule: 'money_in_v1', status: 'failed', reason: `Could not read the lakh figure in "${s}".` };
      total += v * LAKH; parts.push(`${v} lakh`);
    }
    if (total <= 0) return { rule: 'money_in_v1', status: 'failed', reason: `"${s}" reads as zero.` };
    return {
      value: total,
      unit: 'INR',
      rule: 'money_in_v1',
      status: 'exact',
      reason: `${parts.join(' + ')} = ₹${total.toLocaleString('en-IN')}.`,
    };
  }

  // Symbol/word-prefixed plain figure: "₹12,50,000"
  if (stripped !== s || /\/-/.test(s)) {
    const v = parseGroupedNumber(stripped);
    if (v !== null && v > 0) {
      return { value: v, unit: 'INR', rule: 'money_in_v1', status: 'exact', reason: `${s} → ₹${v.toLocaleString('en-IN')}.` };
    }
  }

  return null; // not a money expression we recognise → no opinion
};

// ─── Field-name routing ───────────────────────────────────────────────────────

/**
 * Which family applies to a field, by NAME. Same discipline as the schema
 * rules in extractionFieldQuality: first match wins, no rule → no opinion.
 * NOTE valid_until / order_date etc. are legal-lane fields — normalizing
 * their FORMAT is safe (it proposes a standard spelling of the same fact,
 * raw beside it, human still verifies every legal apply) and materially
 * helps reviewers compare dates across documents.
 */
const FAMILY_RULES = Object.freeze([
  { family: 'date', pattern: /(^|_)(date|dates)(_|$)|_date$|^date$|period_(from|to)|valid_until|expiry/i, normalize: normalizeDate },
  { family: 'area', pattern: /_sqft$|_sq_ft$|_acres$|_sqm$|(^|_)area(_|$)|(^|_)extent(_|$)/i, normalize: normalizeArea },
  { family: 'money', pattern: /_inr$|_usd$|consideration|_price(_|$)|price_|stamp_duty|registration_fee|_cr$|_crore$|tax_inr|_value$|guidance_value/i, normalize: normalizeMoney },
]);

/**
 * Normalize one extracted field value.
 *
 * @param {string} fieldName  raw key as the extraction prompt returned it
 * @param {*} value           the extracted value (raw, immutable)
 * @returns {null | {value?, unit?, rule, status, reason}}
 *          null → not applicable (blank, non-scalar, excluded field class,
 *          no family rule, or the value is already canonical).
 */
const normalizeField = (fieldName, value) => {
  if (typeof fieldName !== 'string' || fieldName.length === 0) return null;
  if (EXCLUDED_FIELD_PATTERN.test(fieldName)) return null;

  const s = asTrimmedString(value);
  if (!s) return null; // never populate a blank

  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(fieldName)) {
      try {
        return rule.normalize(s);
      } catch {
        return null; // a throwing normalizer must never break an extraction
      }
    }
  }
  return null;
};

module.exports = {
  normalizeField,
  // Exported for tests
  __internal: { normalizeDate, normalizeArea, normalizeMoney, EXCLUDED_FIELD_PATTERN, FAMILY_RULES, GUNTAS_PER_ACRE },
};
