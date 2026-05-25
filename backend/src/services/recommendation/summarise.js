'use strict';

/**
 * Recommendation summary — used wherever a per-deal "what's the headline?"
 * chip needs to render without re-running the full engine.
 *
 * Two consumers as of PR-A:
 *   1. The Deals list (`/deals`) — each row gets a small severity-weighted
 *      count chip so the operator can see across the pipeline which deals
 *      have unresolved high-severity items.
 *   2. The DOCX IC memo (PR-B) — uses the summary to lead the Recommendations
 *      section with a "N of M findings critical" headline.
 *
 * The summary is computed from the same `recommendations` array the engine
 * returns; no separate compute. Pure function — no DB calls, no AI.
 */

const SEVERITY_BANDS = {
  critical: { min: 5, label: 'Critical' },
  high:     { min: 4, label: 'High' },
  medium:   { min: 3, label: 'Medium' },
  low:      { min: 1, label: 'Low' },
};

const bandFor = (severity) => {
  const n = Number(severity);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 5) return 'critical';
  if (n >= 4) return 'high';
  if (n >= 3) return 'medium';
  return 'low';
};

/**
 * Summarise a recommendation array into a small shape the UI can chip-render
 * without traversing all the cards.
 *
 * @param {Array} recommendations  the array from generateForWorkspace().recommendations
 * @returns {{
 *   total: number,
 *   by_severity: { critical, high, medium, low },
 *   by_verb: { Recommend, Consider, 'Re-examine', Flag, 'Stress-test' },
 *   top_severity: 'critical' | 'high' | 'medium' | 'low' | null,
 *   has_legal_carve_out: boolean,
 *   top_card: { id, verb, topic_label, severity, headline } | null,
 * }}
 */
const summariseRecommendations = (recommendations) => {
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return {
      total: 0,
      by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
      by_verb: {},
      top_severity: null,
      has_legal_carve_out: false,
      top_card: null,
    };
  }
  const by_severity = { critical: 0, high: 0, medium: 0, low: 0 };
  const by_verb = {};
  let topCard = null;
  let hasLegal = false;

  for (const card of recommendations) {
    const band = bandFor(card.severity);
    by_severity[band] = (by_severity[band] || 0) + 1;
    if (card.verb) by_verb[card.verb] = (by_verb[card.verb] || 0) + 1;
    if (card.topic && /^legal_/.test(card.topic)) hasLegal = true;
    if (!topCard || (Number(card.severity) || 0) > (Number(topCard.severity) || 0)) {
      topCard = {
        id: card.id,
        verb: card.verb,
        topic_label: card.topic_label,
        severity: card.severity,
        headline: card.headline,
      };
    }
  }

  const order = ['critical', 'high', 'medium', 'low'];
  const top_severity = order.find((b) => by_severity[b] > 0) || null;

  return {
    total: recommendations.length,
    by_severity,
    by_verb,
    top_severity,
    has_legal_carve_out: hasLegal,
    top_card: topCard,
  };
};

/**
 * Mirror summariser for Deal Doctor findings. Same shape minus the verb dict
 * (diagnostic verbs live in dealDoctor.js).
 */
const summariseFindings = (findings) => {
  if (!Array.isArray(findings) || findings.length === 0) {
    return {
      total: 0,
      by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
      by_verb: {},
      top_severity: null,
      has_legal_carve_out: false,
    };
  }
  const by_severity = { critical: 0, high: 0, medium: 0, low: 0 };
  const by_verb = {};
  let hasLegal = false;
  for (const f of findings) {
    const band = bandFor(f.severity);
    by_severity[band] = (by_severity[band] || 0) + 1;
    if (f.verb) by_verb[f.verb] = (by_verb[f.verb] || 0) + 1;
    if (f.topic && /^legal_/.test(f.topic)) hasLegal = true;
  }
  const order = ['critical', 'high', 'medium', 'low'];
  const top_severity = order.find((b) => by_severity[b] > 0) || null;
  return {
    total: findings.length,
    by_severity,
    by_verb,
    top_severity,
    has_legal_carve_out: hasLegal,
  };
};

module.exports = {
  SEVERITY_BANDS,
  bandFor,
  summariseRecommendations,
  summariseFindings,
};
