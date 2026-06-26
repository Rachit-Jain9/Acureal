'use strict';

/**
 * Canonical "legal four" denylist — the SINGLE source of truth for the four
 * statutory lanes REDIP must never AI-narrate, re-rank, or learn-adjust
 * (CLAUDE.md hard rule). Every learning / aggregation / recommendation /
 * diagnostic path that must EXCLUDE the legal four imports `isLegalFourTopic`
 * from here, so the four lanes can never drift apart across modules or be
 * silently omitted by a new code path.
 *
 * The four lanes (topic keys used across the recommendation + learning spine):
 *   legal_title       — title chain + ownership
 *   legal_encumbrance — EC findings, mortgages on title
 *   legal_rera        — RERA registration status
 *   legal_approvals   — statutory approval status
 *
 * DEFAULT-DENY BY PREFIX. `isLegalFourTopic` returns true for the four exact
 * keys AND for ANY `legal_`-prefixed topic. This is deliberate: a future lane
 * (e.g. `legal_conversion`, `legal_khata`) is treated as legal-four — and thus
 * denied AI-narration / learn-adjustment — BY DEFAULT, rather than slipping the
 * net until someone remembers to add it to every list. Before this module the
 * three call-sites disagreed: the aggregator + recommendationRules matched the
 * exact four (a new `legal_*` lane would have been re-ranked / AI-narrated),
 * while dealDoctor used the `/^legal_/` prefix. This unifies them on the safe
 * (broadest) behaviour.
 *
 * Pure deterministic string matching — no LLM (CLAUDE.md: "Never use LLMs for
 * ... rule-engine decisions").
 */

const LEGAL_FOUR_TOPICS = Object.freeze([
  'legal_title',
  'legal_encumbrance',
  'legal_rera',
  'legal_approvals',
]);

const LEGAL_FOUR_TOPIC_SET = Object.freeze(new Set(LEGAL_FOUR_TOPICS));

const LEGAL_TOPIC_PREFIX = /^legal_/;

/**
 * True when `topic` is one of the legal four, or any `legal_`-prefixed lane.
 * Null / undefined / non-string / empty → false.
 *
 * @param {string} topic
 * @returns {boolean}
 */
const isLegalFourTopic = (topic) => {
  if (typeof topic !== 'string' || topic.length === 0) return false;
  return LEGAL_FOUR_TOPIC_SET.has(topic) || LEGAL_TOPIC_PREFIX.test(topic);
};

module.exports = {
  LEGAL_FOUR_TOPICS,
  LEGAL_FOUR_TOPIC_SET,
  isLegalFourTopic,
};
