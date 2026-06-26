'use strict';

/**
 * Recommendation Engine — Layer 2: the rule engine.
 *
 * Given the typed signals from `signalExtractors.js`, this layer composes
 * them into **recommendation candidates** — typed cards the workspace UI
 * will render. Pure deterministic code; no AI.
 *
 * Output shape (one candidate per matched rule):
 *   {
 *     id:        stable rule id (e.g. 'land-cost-share-high')
 *     verb:      one of: Recommend, Consider, Re-examine, Flag, Stress-test
 *     topic:     one of TOPICS keys
 *     severity:  1..5 (1 = informational, 5 = blocking)
 *     headline:  the short, evidence-backed call-out (English, no jargon)
 *     detail:    optional second-line elaboration with quantitative context
 *     evidence:  flattened evidence refs from the underlying signals
 *     signals:   array of signal kinds that fired this rule (for traceability)
 *     ai_narratable: boolean — whether the AI narrator (PR-4) is allowed to
 *                    rephrase this card. False for legal-carve-out topics.
 *   }
 *
 * Legal carve-out (CLAUDE.md hard rule + §0 operator override): four topics
 * are reserved as "deterministic Flag only". The rules in those topics emit
 * cards with `ai_narratable: false` — the AI narrator must never rephrase
 * a card with that flag set. The legal carve-out topics are:
 *   • legal_title (title chain, encumbrance)
 *   • legal_rera (RERA registration status)
 *   • legal_approvals (statutory approval status)
 *   • legal_encumbrance (EC findings, mortgages on title)
 *
 * All other topics (financial, market, pricing, capital_stack, absorption,
 * leasing, design_efficiency, exit_route, negotiation, execution,
 * data_consistency) are AI-narratable.
 */

const { isLegalFourTopic } = require('../../constants/legalFourTopics');

const RECOMMENDATION_VERBS = ['Recommend', 'Consider', 'Re-examine', 'Flag', 'Stress-test'];

const TOPICS = {
  // AI-narratable.
  land_price: { label: 'Land price', ai_narratable: true },
  pricing: { label: 'Sale price', ai_narratable: true },
  absorption: { label: 'Absorption / velocity', ai_narratable: true },
  capital_stack: { label: 'Capital stack', ai_narratable: true },
  exit_route: { label: 'Exit route', ai_narratable: true },
  execution: { label: 'Execution / promoter', ai_narratable: true },
  data_consistency: { label: 'Data consistency', ai_narratable: true },
  // Legal carve-out — deterministic Flag only.
  legal_title: { label: 'Legal — title', ai_narratable: false },
  legal_rera: { label: 'Legal — RERA', ai_narratable: false },
  legal_approvals: { label: 'Legal — approvals', ai_narratable: false },
  legal_encumbrance: { label: 'Legal — encumbrance', ai_narratable: false },
};

// Delegates to the canonical legal-four denylist (constants/legalFourTopics) so
// the recommendation engine, the learning aggregator, and the Deal Doctor all
// gate on the SAME lanes (default-deny by `legal_` prefix). The TOPICS map's
// `ai_narratable: false` flags are held in lockstep with this guard by
// legalFourDenylist.test.js — a drift there fails the build.
const isLegalTopic = (topic) => isLegalFourTopic(topic);

// Helpers
const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;
const fmtPctRounded = (n) => `${Math.round(n * 1000) / 10}%`;
const findSignal = (signals, kind) => signals.find((s) => s.kind === kind) || null;
const flattenEvidence = (...signals) => signals.flatMap((s) => (s && s.evidence) ? s.evidence : []);

// ─────────────────────────────────────────────────────────────────────────────
// Rule definitions
// ─────────────────────────────────────────────────────────────────────────────

const RULES = [
  // ── FINANCIAL ──────────────────────────────────────────────────────────────
  {
    id: 'land-cost-share-high',
    topic: 'land_price',
    verb: 'Recommend',
    requires: ['land_cost_share_of_gdv'],
    evaluate: (signals) => {
      const landShare = findSignal(signals, 'land_cost_share_of_gdv');
      if (!landShare) return null;
      const v = landShare.value;
      if (v < 0.30) return null;
      const severity = v >= 0.40 ? 5 : v >= 0.35 ? 4 : 3;
      const irrGap = findSignal(signals, 'irr_vs_hurdle');
      const irrLine = irrGap && irrGap.value.gap < 0
        ? ` IRR is ${Math.abs(irrGap.meta.gap_bps)} bps below your ${fmtPctRounded(irrGap.value.hurdle)} hurdle.`
        : '';
      return {
        headline: `Recommend re-pricing land or restructuring to revenue-share. Land cost is ${fmtPct(v)} of GDV — above the ${fmtPct(0.30)} target for a typical Bengaluru ${irrLine ? 'underwriting' : 'project'}.${irrLine}`,
        detail: `Project economics carry a structurally elevated land-cost ratio; alternative structures (revenue-share, area-share) may restore returns without a price renegotiation.`,
        severity,
        evidence: flattenEvidence(landShare, irrGap),
        signals: [landShare.kind, ...(irrGap ? [irrGap.kind] : [])],
      };
    },
  },
  {
    id: 'land-rate-below-guidance',
    topic: 'land_price',
    verb: 'Re-examine',
    requires: ['land_rate_vs_guidance'],
    evaluate: (signals) => {
      const s = findSignal(signals, 'land_rate_vs_guidance');
      if (!s) return null;
      const where = s.meta.locality ? ` for ${s.meta.locality}` : '';
      return {
        headline: `Re-examine the land basis — assumed ₹${s.meta.assumed.toLocaleString('en-IN')}/sqft is ${s.meta.shortfall_pct}% below the official IGR guidance value of ₹${s.meta.guidance.toLocaleString('en-IN')}/sqft${where}.`,
        detail: `A land input below the State guidance (circle-rate) value is unusual — Bengaluru land typically transacts above it, and stamp duty is levied on the guidance value regardless. A wide gap can indicate an undervalued land assumption, an off-record component, or a unit/area data-entry error. Verify the land basis, the entered extent, and the unit before underwriting locks.`,
        severity: s.meta.severity_hint || 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'irr-below-hurdle',
    topic: 'capital_stack',
    verb: 'Re-examine',
    requires: ['irr_vs_hurdle'],
    evaluate: (signals) => {
      const irr = findSignal(signals, 'irr_vs_hurdle');
      if (!irr || irr.value.gap >= 0) return null;
      const gapBps = Math.abs(irr.meta.gap_bps);
      const severity = gapBps >= 300 ? 5 : gapBps >= 150 ? 4 : 3;
      return {
        headline: `Re-examine the base case. IRR is ${gapBps} bps below your hurdle (${fmtPctRounded(irr.value.irr)} vs ${fmtPctRounded(irr.value.hurdle)}).`,
        detail: `The deal does not clear the underwriting hurdle in the base scenario — re-examine land cost, sales price, absorption schedule, or capital stack before proceeding.`,
        severity,
        evidence: irr.evidence,
        signals: [irr.kind],
      };
    },
  },
  {
    id: 'equity-multiple-below-target',
    topic: 'capital_stack',
    verb: 'Consider',
    requires: ['equity_multiple_vs_target'],
    evaluate: (signals) => {
      const em = findSignal(signals, 'equity_multiple_vs_target');
      if (!em || em.value.gap >= 0) return null;
      const severity = em.value.gap < -0.5 ? 4 : em.value.gap < -0.2 ? 3 : 2;
      return {
        headline: `Consider a tighter capital stack. Equity multiple is ${em.value.em.toFixed(2)}× vs your ${em.value.target.toFixed(2)}× target.`,
        detail: `Higher leverage, longer hold, or a partial-exit structure may bring the equity multiple within target.`,
        severity,
        evidence: em.evidence,
        signals: [em.kind],
      };
    },
  },
  {
    id: 'dscr-near-term-breach',
    topic: 'capital_stack',
    verb: 'Stress-test',
    requires: ['dscr_breach_month'],
    evaluate: (signals) => {
      const dscr = findSignal(signals, 'dscr_breach_month');
      if (!dscr) return null;
      const m = dscr.value.month;
      const severity = m <= 12 ? 5 : m <= 24 ? 4 : 3;
      return {
        headline: `Stress-test debt-service coverage — DSCR breaches in month ${m} of the base case (${dscr.value.value.toFixed(2)}).`,
        detail: `Lenders will price covenants off the worst-month DSCR. Confirm reserve sizing or pre-launch sales escrow before fixing tenor.`,
        severity,
        evidence: dscr.evidence,
        signals: [dscr.kind],
      };
    },
  },

  // ── MARKET / COMPS ─────────────────────────────────────────────────────────
  {
    id: 'sale-price-above-comp-band',
    topic: 'pricing',
    verb: 'Re-examine',
    requires: ['price_vs_comp_band'],
    evaluate: (signals) => {
      const price = findSignal(signals, 'price_vs_comp_band');
      if (!price || Math.abs(price.value.deviation_pct) < 0.10) return null;
      const direction = price.value.deviation_pct > 0 ? 'above' : 'below';
      const severity = Math.abs(price.value.deviation_pct) >= 0.20 ? 4 : 3;
      const verb = direction === 'above' ? 'Re-examine' : 'Consider';
      return {
        headline: `${verb} the selling-price assumption. ₹${price.meta.assumed.toLocaleString()}/sf is ${Math.abs(price.meta.deviation_pct)}% ${direction} the verified-comp median of ₹${price.meta.comp_median.toLocaleString()}/sf (n=${price.meta.n_comps}).`,
        detail: direction === 'above'
          ? `An above-band price assumption can mask thin absorption — pressure-test the model at the comp median before committing.`
          : `A below-band price assumption may understate upside — confirm the comp set is genuinely comparable on size, vintage, and amenities.`,
        severity,
        verb,
        evidence: price.evidence,
        signals: [price.kind],
      };
    },
  },
  {
    id: 'absorption-above-comp-band',
    topic: 'absorption',
    verb: 'Re-examine',
    requires: ['absorption_vs_comp_band'],
    evaluate: (signals) => {
      const absorption = findSignal(signals, 'absorption_vs_comp_band');
      if (!absorption || absorption.value.multiple < 1.5) return null;
      const severity = absorption.value.multiple >= 2.0 ? 5 : 4;
      return {
        headline: `Re-examine sales velocity. Assumption of ${absorption.value.assumed} units/quarter is ${absorption.value.multiple.toFixed(2)}× the verified-comp median of ${absorption.value.comp_median.toFixed(1)} units/quarter (n=${absorption.value.n_comps}).`,
        detail: `Above-comp absorption is the single most common cause of under-delivered Bengaluru projects. Run the base case at comp-median absorption and confirm covenant headroom.`,
        severity,
        evidence: absorption.evidence,
        signals: [absorption.kind],
      };
    },
  },
  {
    id: 'cap-rate-outside-comp-band',
    topic: 'exit_route',
    verb: 'Re-examine',
    requires: ['cap_rate_vs_comp_band'],
    evaluate: (signals) => {
      const cap = findSignal(signals, 'cap_rate_vs_comp_band');
      if (!cap) return null;
      const direction = cap.meta.direction; // 'above' or 'below'
      const severity = 3;
      return {
        headline: `Re-examine exit cap. ${cap.value.assumed.toFixed(2)}% is ${direction} the verified-comp band (${cap.value.band_lo.toFixed(2)}–${cap.value.band_hi.toFixed(2)}%, n=${cap.value.n_comps}).`,
        detail: direction === 'below'
          ? `A tight exit cap inflates terminal value; confirm the comp set genuinely supports the assumption before committing.`
          : `A wide exit cap depresses terminal value; the deal may not need it — confirm against fresher comps.`,
        severity,
        evidence: cap.evidence,
        signals: [cap.kind],
      };
    },
  },

  // ── DATA CONSISTENCY (AI-narratable) ───────────────────────────────────────
  {
    id: 'saleable-area-mismatch',
    topic: 'data_consistency',
    verb: 'Flag',
    requires: ['extracted_area_mismatch'],
    evaluate: (signals) => {
      const a = findSignal(signals, 'extracted_area_mismatch');
      if (!a) return null;
      const severity = a.value.deviation_pct > 0.10 ? 4 : 3;
      return {
        headline: `Flag — saleable area mismatch. Your input is ${a.meta.input.toLocaleString()} sf; the extracted area statement shows ${a.meta.extracted.toLocaleString()} sf (${a.meta.deviation_pct}% delta).`,
        detail: `Confirm which figure should drive the model before underwriting — a 5%+ delta on saleable area materially shifts revenue.`,
        severity,
        evidence: a.evidence,
        signals: [a.kind],
      };
    },
  },

  // ── LEGAL CARVE-OUT (deterministic Flag only) ──────────────────────────────
  {
    id: 'rera-registration-missing',
    topic: 'legal_rera',
    verb: 'Flag',
    requires: ['rera_registration_missing'],
    evaluate: (signals) => {
      const r = findSignal(signals, 'rera_registration_missing');
      if (!r) return null;
      return {
        headline: `Flag — RERA registration not on file. Marketing or pre-sale activity is restricted under Karnataka RERA Section 3 until registration is complete.`,
        detail: r.value.reason === 'no_entry'
          ? `Add a RERA Karnataka Registration approval item; upload the registration certificate when issued.`
          : `Current RERA status: "${r.meta.status}". Block marketing until the status is "validated" with the certificate on file.`,
        severity: 5,
        evidence: r.evidence,
        signals: [r.kind],
      };
    },
  },
  {
    id: 'required-approvals-open',
    topic: 'legal_approvals',
    verb: 'Flag',
    requires: ['approval_gap_count'],
    evaluate: (signals) => {
      const g = findSignal(signals, 'approval_gap_count');
      if (!g || g.value.required_open === 0) return null;
      const severity = g.value.required_open >= 5 ? 4 : g.value.required_open >= 3 ? 3 : 2;
      return {
        headline: `Flag — ${g.value.required_open} of ${g.value.required_total} required statutory approvals are still open.`,
        detail: `Each unresolved approval is a deal-execution risk. Surface owner-by-owner workstreams in the DD tab; mark blockers explicitly.`,
        severity,
        evidence: g.evidence,
        signals: [g.kind],
      };
    },
  },

  // ── DD / RISK ──────────────────────────────────────────────────────────────
  {
    id: 'overdue-dd-items',
    topic: 'execution',
    verb: 'Flag',
    requires: ['overdue_dd_count'],
    evaluate: (signals) => {
      const o = findSignal(signals, 'overdue_dd_count');
      if (!o) return null;
      const severity = o.value.count >= 3 ? 4 : 3;
      return {
        headline: `Flag — ${o.value.count} required diligence item${o.value.count === 1 ? ' is' : 's are'} overdue.`,
        detail: `Stale diligence is the second-most-common source of last-minute IC surprises. Triage the overdue list before the next IC review.`,
        severity,
        evidence: o.evidence,
        signals: [o.kind],
      };
    },
  },
  {
    id: 'unresolved-deal-breakers',
    topic: 'execution',
    verb: 'Flag',
    requires: ['deal_breaker_dd_count'],
    evaluate: (signals) => {
      const d = findSignal(signals, 'deal_breaker_dd_count');
      if (!d) return null;
      return {
        headline: `Flag — ${d.value.count} unresolved deal-breaker diligence item${d.value.count === 1 ? '' : 's'}.`,
        detail: `Deal-breaker items must be resolved or formally accepted by the IC before underwriting can be considered final.`,
        severity: 5,
        evidence: d.evidence,
        signals: [d.kind],
      };
    },
  },

  // ── PROMOTER ──────────────────────────────────────────────────────────────
  {
    id: 'promoter-slippage-elevated',
    topic: 'execution',
    verb: 'Re-examine',
    requires: ['promoter_delivery_slippage'],
    evaluate: (signals) => {
      const p = findSignal(signals, 'promoter_delivery_slippage');
      if (!p || p.value.avg_delay_months <= 6) return null;
      const severity = p.value.avg_delay_months >= 12 ? 4 : 3;
      return {
        headline: `Re-examine the execution schedule. Promoter's prior-project average delivery delay is ${p.value.avg_delay_months} months.`,
        detail: `Build construction-schedule headroom into the base case; pressure-test debt covenants against the slipped schedule.`,
        severity,
        evidence: p.evidence,
        signals: [p.kind],
      };
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given an array of signals (from `extractAllSignals`), evaluate every rule
 * and return the matched recommendation candidates, sorted by severity (high
 * to low), then by topic.
 */
const generateRecommendations = (signals) => {
  if (!Array.isArray(signals) || signals.length === 0) return [];
  const out = [];
  for (const rule of RULES) {
    try {
      const result = rule.evaluate(signals);
      if (!result) continue;
      const topicMeta = TOPICS[rule.topic] || { label: rule.topic, ai_narratable: true };
      out.push({
        id: rule.id,
        verb: result.verb || rule.verb,
        topic: rule.topic,
        topic_label: topicMeta.label,
        severity: result.severity,
        headline: result.headline,
        detail: result.detail || null,
        evidence: result.evidence || [],
        signals: result.signals || [],
        ai_narratable: topicMeta.ai_narratable,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[recommendationRules] rule "${rule.id}" threw: ${err.message}`);
    }
  }
  return out.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return String(a.topic).localeCompare(String(b.topic));
  });
};

module.exports = {
  RECOMMENDATION_VERBS,
  TOPICS,
  RULES,
  isLegalTopic,
  generateRecommendations,
};
