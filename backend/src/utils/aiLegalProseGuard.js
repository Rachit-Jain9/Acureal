'use strict';

/**
 * Shared runtime guard for AI-generated NARRATIVE PROSE that can reach a user
 * or customer surface (deal-analysis Overview, doc-insights / IC exports, deal
 * Q&A answers). Defense-in-depth BEHIND the generation prompts — the prompts
 * remain the primary instruction; this is the deterministic backstop that
 * catches model drift before the text is persisted or shipped.
 *
 * Two CLAUDE.md hard rules it enforces at runtime:
 *   1. The "legal four" — title chain, encumbrance, RERA registration, statutory
 *      approval — are extraction/synthesis aid only. AI must NEVER assert a
 *      statutory fact as truth ("title is clear", "RERA-compliant", "approval
 *      will be granted"). Any sentence that does is stripped and replaced with a
 *      short neutral marker.
 *   2. Absolute IC decision verbs (Buy / Sell / Reject / Approve / Decline /
 *      Clear / Pass) are forbidden; they are rewritten to the closed dictionary
 *      via icStanceVerbs.neutralizeStanceText.
 *
 * Pure deterministic JS — no AI, never throws. Reuses the SAME pattern sets the
 * Deal Doctor's tone classifier and the IC-memo neutralizer already use, so the
 * three surfaces enforce one definition of "legal verdict" / "banned verb".
 */

const { neutralizeStanceText, containsAbsoluteStanceVerb } = require('./icStanceVerbs');
const { LEGAL_VERDICT_PATTERNS } = require('../services/ai/toneClassifier');

// Concise inline marker left where a statutory-verdict sentence was removed, so
// the reader knows something was redacted and why (rather than a silent gap).
const LEGAL_REDACTION_MARKER =
  '[legal-status statement removed — REDIP does not assert title / RERA / encumbrance / approval conclusions; verify against the source documents]';

// Sentence-ish split that keeps trailing punctuation/newlines so re-joining is
// loss-less. Good enough for prose scrubbing (we are not parsing grammar).
const splitSentences = (text) => text.match(/[^.!?\n]*(?:[.!?]+|\n+|$)/g)?.filter((s) => s.length) || [text];

const stripLegalVerdicts = (text) => {
  let removed = 0;
  const out = splitSentences(text)
    .map((sentence) => {
      if (LEGAL_VERDICT_PATTERNS.some((re) => re.test(sentence))) {
        removed += 1;
        // Preserve any leading whitespace so paragraph spacing survives.
        const lead = (sentence.match(/^\s*/) || [''])[0];
        return `${lead}${LEGAL_REDACTION_MARKER} `;
      }
      return sentence;
    })
    .join('');
  return { text: out, removed };
};

/**
 * Sanitize one block of AI prose.
 * @param {string} text
 * @returns {{ text: string, flagged: boolean, stanceRewritten: boolean, legalRemoved: number }}
 */
const sanitizeAiProse = (text) => {
  if (typeof text !== 'string' || text.length === 0) {
    return { text, flagged: false, stanceRewritten: false, legalRemoved: 0 };
  }
  const stanceRewritten = containsAbsoluteStanceVerb(text);
  const stanceClean = neutralizeStanceText(text);
  const { text: scrubbed, removed } = stripLegalVerdicts(stanceClean);
  return {
    text: scrubbed,
    flagged: stanceRewritten || removed > 0,
    stanceRewritten,
    legalRemoved: removed,
  };
};

module.exports = { sanitizeAiProse, LEGAL_REDACTION_MARKER };
