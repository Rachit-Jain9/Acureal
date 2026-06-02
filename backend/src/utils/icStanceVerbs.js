'use strict';

/**
 * IC stance-verb policy (CLAUDE.md).
 *
 * REDIP forbids the absolute decision verbs — Buy, Sell, Reject, Approve,
 * Decline, Clear, Pass — on any recommendation surface, and restricts stances
 * to the closed dictionary (Recommend / Consider / Re-examine / Flag /
 * Stress-test, plus the neutral "Hold pending …" and "proceed / proceed with
 * conditions" framing).
 *
 * The generation PROMPTS are the primary guard (they instruct the model to use
 * the dictionary). These helpers are defense-in-depth: they neutralize any
 * banned stance verb that slips through, before the prose reaches a
 * customer-facing DOCX / tear-sheet / IC memo.
 *
 * Scope matters: the word "approval" is legitimate in a memo's "Required
 * Approvals" section and in "approval_items". So the bare-verb rewrites below
 * run ONLY over text that is itself a stance string — an IC opinion field, or
 * the Recommendation section of a memo extracted by neutralizeMemoRecommendation
 * — never the whole memo.
 */

// Distinctive stance phrases — safe to rewrite anywhere (they cannot collide
// with "Required Approvals" / "approval_items").
const PHRASE_RULES = [
  [/\brecommend(?:ing|s)?\s+approval\b/gi, 'Recommend proceeding'],
  [/\brecommend(?:ing|s)?\s+(?:to\s+)?(?:approve|approving)\b/gi, 'Recommend proceeding'],
  [/\brecommend(?:ing|s)?\s+(?:to\s+)?(?:decline|declining|reject(?:ing)?|rejection|denial|passing)\b/gi, 'Recommend against proceeding'],
  // "Clear" as a decision verb only ("clear to proceed", "clear for IC",
  // "clear the deal") — scoped so it never touches the legitimate legal phrase
  // "clear title" / "clear of encumbrances", which is itself governed elsewhere.
  [/\bclear(?:ed|s|ing)?\s+(?:to\s+proceed|for\s+(?:the\s+)?(?:ic|investment\s+committee)|(?:the|this)\s+deal)\b/gi, 'Recommend proceeding'],
];

// Bare sentence-leading stance verbs — applied ONLY to text that is already a
// stance string (whole-field opinion or extracted Recommendation section).
const LEADING_RULES = [
  [/(^|[\n.!?]\s*)Decline\b/g, '$1Recommend against proceeding'],
  [/(^|[\n.!?]\s*)Declining\b/g, '$1Recommending against proceeding'],
  [/(^|[\n.!?]\s*)Reject(?:ing)?\b/g, '$1Recommend against proceeding'],
  [/(^|[\n.!?]\s*)Approve\b/g, '$1Proceed'],
  [/(^|[\n.!?]\s*)Approving\b/g, '$1Proceeding'],
  // "Buy" / "Sell" as standalone stances — exclude hyphenated/compound forms
  // ("Buy-side", "Buyer", "Sell-side", "Selling", "Sell-through").
  [/(^|[\n.!?]\s*)Buy\b(?![-\w])/gi, '$1Recommend proceeding'],
  [/(^|[\n.!?]\s*)Sell\b(?![-\w])/gi, '$1Recommend exiting'],
  // "Pass" as a standalone stance — exclude "Pass-through" / "Passing" / "Passed".
  [/(^|[\n.!?]\s*)Pass\b(?![-\w])/gi, '$1Recommend against proceeding'],
];

// Detector — any absolute stance verb still present (observability only).
const ABSOLUTE_VERB_RE =
  /\b(?:recommend(?:ing|s)?\s+(?:approval|to\s+approve|to\s+decline)|approve|approving|declin(?:e|ing)|reject(?:ing)?)\b|(?:^|[\n.!?]\s*)(?:Pass|Buy|Sell)\b(?![-\w])|\bclear(?:ed|s|ing)?\s+(?:to\s+proceed|for\s+(?:the\s+)?(?:ic|investment\s+committee)|(?:the|this)\s+deal)\b/i;

/** Rewrite banned stance verbs in a string that is ITSELF a stance opinion. */
function neutralizeStanceText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const [re, repl] of PHRASE_RULES) out = out.replace(re, repl);
  for (const [re, repl] of LEADING_RULES) out = out.replace(re, repl);
  return out;
}

/**
 * Neutralize ONLY the "## 8. Recommendation" section of an IC memo (markdown),
 * leaving "Required Approvals" and the rest of the memo untouched. The
 * always-safe phrase rules run over the whole memo; the bare-verb rules are
 * scoped to the Recommendation section.
 */
function neutralizeMemoRecommendation(md) {
  if (typeof md !== 'string' || !md) return md;
  let out = md;
  for (const [re, repl] of PHRASE_RULES) out = out.replace(re, repl);
  out = out.replace(
    /(^|\n)(#{1,6}\s*8\.?\s*Recommendation[\s\S]*?)(?=\n#{1,6}\s|\s*$)/i,
    (m, lead, section) => {
      let s = section;
      for (const [re, repl] of LEADING_RULES) s = s.replace(re, repl);
      return lead + s;
    },
  );
  return out;
}

/** True if any absolute stance verb is still present (for warn-logging). */
function containsAbsoluteStanceVerb(text) {
  return typeof text === 'string' && ABSOLUTE_VERB_RE.test(text);
}

module.exports = { neutralizeStanceText, neutralizeMemoRecommendation, containsAbsoluteStanceVerb };
