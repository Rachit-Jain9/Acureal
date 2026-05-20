'use strict';

/**
 * Deterministic PII redaction for the AI document pipeline.
 *
 * CLAUDE.md mandates: "Do not collect Aadhaar/PAN ... if the user uploads
 * them anyway, detect and redact by default." This module is the
 * detect-and-redact step.
 *
 * Where it runs: the raw uploaded file must reach Gemini to be read at all,
 * so it cannot be redacted pre-extraction. This runs AFTER extraction and
 * BEFORE the extracted text + fields are (a) sent to the Claude
 * normalization pass, (b) embedded by OpenAI into document_embeddings, or
 * (c) persisted to document_extractions.
 *
 * Precision over recall — masking legitimate product data (khata, survey,
 * registration numbers) is worse than missing one Aadhaar. So only two
 * highly-specific patterns are masked in free text:
 *   - PAN — five letters, four digits, one letter. Structurally unambiguous.
 *   - Aadhaar in the standard 4-4-4 spaced display format.
 * A bare unspaced 12-digit run is NOT masked in free text — too many
 * collide with khata / survey / document numbers. In structured fields, a
 * value is additionally masked when its KEY names an identity document
 * (aadhaar / aadhar / pan / uid as a whole snake_case segment).
 */

const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const AADHAAR_SPACED_RE = /\b\d{4}\s\d{4}\s\d{4}\b/g;

// Whole snake_case segment match — `pan`, `pan_number`, `seller_pan`,
// `aadhaar_no`, `uid`. Deliberately segment-anchored so `company_name`
// (which contains the substring "pan") is never matched.
const ID_KEY_RE = /(?:^|_)(aadhaar|aadhar|pan|uid)(?:_|$)/i;

const REDACTED = '[REDACTED]';

/**
 * Redact PAN and spaced-Aadhaar patterns out of a free-text string.
 * Returns { text, count }. Non-strings pass through untouched.
 */
const redactText = (value) => {
  if (typeof value !== 'string' || !value) {
    return { text: value, count: 0 };
  }
  let count = 0;
  const bump = () => {
    count += 1;
    return REDACTED;
  };
  const text = value.replace(PAN_RE, bump).replace(AADHAAR_SPACED_RE, bump);
  return { text, count };
};

/**
 * Deep-walk an object / array, redacting string (and identity-keyed
 * numeric) values. A value whose KEY names an identity document is masked
 * outright; every other string is run through redactText. Returns
 * { fields, count }. The input is not mutated.
 */
const redactFields = (input) => {
  let count = 0;

  const walk = (node, keyHint) => {
    if (typeof node === 'string') {
      if (keyHint && ID_KEY_RE.test(keyHint) && node.trim()) {
        count += 1;
        return REDACTED;
      }
      const r = redactText(node);
      count += r.count;
      return r.text;
    }
    // A bare numeric value under an identity-named key — e.g. an Aadhaar
    // extracted as a number rather than a string.
    if (typeof node === 'number' && keyHint && ID_KEY_RE.test(keyHint)) {
      count += 1;
      return REDACTED;
    }
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, keyHint));
    }
    if (node && typeof node === 'object') {
      const out = {};
      for (const [key, val] of Object.entries(node)) {
        out[key] = walk(val, key);
      }
      return out;
    }
    return node;
  };

  const fields = walk(input, undefined);
  return { fields, count };
};

module.exports = { redactText, redactFields, REDACTED };
