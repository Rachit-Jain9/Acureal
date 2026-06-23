'use strict';

/**
 * AI Deal Doctor — REDIP Pending review §5.8, operator override §0.
 *
 * The Deal Doctor is a **diagnostic view over the same signal set** the
 * Recommendation Engine consumes. Where the Recommendation Engine asks
 * "what should the team *do* next?", the Deal Doctor asks "what's *wrong*
 * with this deal — quietly, sharply, with evidence?"
 *
 * Why a separate surface instead of a relabel: the verbs and the framing
 * are different. Recommendations are action-oriented (`Recommend`,
 * `Consider`); diagnoses are observational (`Diverges`, `Lacks support`,
 * `Inconsistent`). The user surfaces are different too — Recommendations
 * lands on Overview as "what's next?", Deal Doctor lands on the Risk tab
 * as "what's the bear case?".
 *
 * Same signal layer, same evidence chain, same legal carve-out — so the
 * Deal Doctor's findings are as defensible as the recommendations they
 * pair with. Diagnostic verbs are enforced via the same Zod pattern when
 * the AI narrator rephrases them (when it's wired in).
 *
 * Hard rules (mirror recommendationRules.js + operator override §0):
 *   • Same legal carve-out: title / RERA / approvals / encumbrance ship
 *     deterministic findings only; the AI tone-classifier never sees them.
 *   • Tone bar: institutional / analytical / sharp / diagnostic.
 *     Theatrical or slander-grade language is rejected by `toneClassifier`.
 *   • Verbs enforced at the schema layer:
 *       Diverges, Lacks support, Inconsistent,
 *       Below benchmark, Above benchmark, Missing.
 *   • Findings never address promoter competence or intent in language —
 *     only quantitative track-record observations.
 */

const { extractAllSignals } = require('./signalExtractors');

const DIAGNOSIS_VERBS = [
  'Diverges',
  'Lacks support',
  'Inconsistent',
  'Below benchmark',
  'Above benchmark',
  'Missing',
];

// The same topic enum as recommendationRules.js but re-mapped under three
// diagnostic groups so the UI can render findings clustered by theme.
// Pure presentation — the underlying signals are unchanged.
const DIAGNOSTIC_GROUPS = {
  underwriting: {
    label: 'Underwriting',
    topics: ['land_price', 'capital_stack', 'exit_route'],
  },
  market: {
    label: 'Market & comps',
    topics: ['pricing', 'absorption'],
  },
  execution: {
    label: 'Execution & data',
    topics: ['execution', 'data_consistency'],
  },
  legal: {
    label: 'Legal carve-out',
    topics: ['legal_title', 'legal_rera', 'legal_approvals', 'legal_encumbrance'],
    ai_narratable: false,
  },
};

const findSignal = (signals, kind) => signals.find((s) => s.kind === kind) || null;
const isLegalTopic = (topic) => /^legal_/.test(topic);
const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;
const fmtPctRounded = (n) => `${Math.round(n * 1000) / 10}%`;

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic rules — each maps a signal (or combination) to a finding card.
// ─────────────────────────────────────────────────────────────────────────────

const DIAGNOSTIC_RULES = [
  // ── UNDERWRITING ──────────────────────────────────────────────────────────
  {
    id: 'land-cost-diverges-from-gdv-share',
    topic: 'land_price',
    verb: 'Diverges',
    severity_threshold: 0.30,
    evaluate: (signals) => {
      const s = findSignal(signals, 'land_cost_share_of_gdv');
      if (!s || s.value < 0.30) return null;
      return {
        finding: `Land cost diverges materially from typical underwriting. ${fmtPct(s.value)} of GDV is allocated to land — typical Bengaluru target is below ${fmtPct(0.30)}.`,
        why_it_matters: `An elevated land-cost ratio compresses the buffer between project IRR and the underwriting hurdle, leaving no headroom for absorption stress or cost overrun.`,
        severity: s.value >= 0.40 ? 5 : s.value >= 0.35 ? 4 : 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'land-rate-below-guidance-benchmark',
    topic: 'land_price',
    verb: 'Below benchmark',
    evaluate: (signals) => {
      const s = findSignal(signals, 'land_rate_vs_guidance');
      if (!s) return null;
      const where = s.meta.locality ? ` for ${s.meta.locality}` : '';
      return {
        finding: `Assumed land rate is below the official guidance benchmark — ₹${s.meta.assumed.toLocaleString('en-IN')}/sqft vs the State guidance value of ₹${s.meta.guidance.toLocaleString('en-IN')}/sqft${where} (${s.meta.shortfall_pct}% below).`,
        why_it_matters: `Stamp duty is levied on the higher guidance value regardless of the contract price, so a sub-guidance land input understates the true acquisition cost driving the model — and can mask an off-record component or a unit/area error. Reconcile the land basis against the guidance band before the model locks.`,
        severity: s.meta.severity_hint || 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'irr-lacks-support-vs-hurdle',
    topic: 'capital_stack',
    verb: 'Lacks support',
    evaluate: (signals) => {
      const s = findSignal(signals, 'irr_vs_hurdle');
      if (!s || s.value.gap >= 0) return null;
      const gapBps = Math.abs(s.meta.gap_bps);
      return {
        finding: `Base-case IRR lacks support for the stated hurdle. ${fmtPctRounded(s.value.irr)} vs ${fmtPctRounded(s.value.hurdle)} target — ${gapBps} bps short.`,
        why_it_matters: `The deal does not clear the underwriting hurdle in the base scenario; either the inputs need to be re-examined or the hurdle is too aggressive for this asset class.`,
        severity: gapBps >= 300 ? 5 : gapBps >= 150 ? 4 : 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'dscr-below-covenant-floor',
    topic: 'capital_stack',
    verb: 'Below benchmark',
    evaluate: (signals) => {
      const s = findSignal(signals, 'dscr_breach_month');
      if (!s) return null;
      const m = s.value.month;
      return {
        finding: `DSCR breaches below 1.0× in month ${m} of the base case (${s.value.value.toFixed(2)}).`,
        why_it_matters: `Lenders price covenants off the worst-month DSCR. A breach window of any length forces covenant waivers, reserve top-ups, or a debt-resize at signing.`,
        severity: m <= 12 ? 5 : m <= 24 ? 4 : 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'cap-rate-above-comp-band',
    topic: 'exit_route',
    verb: 'Above benchmark',
    evaluate: (signals) => {
      const s = findSignal(signals, 'cap_rate_vs_comp_band');
      if (!s || s.meta.direction !== 'above') return null;
      return {
        finding: `Exit cap is above the verified-comp band — ${s.value.assumed.toFixed(2)}% vs ${s.value.band_lo.toFixed(2)}–${s.value.band_hi.toFixed(2)}% (n=${s.value.n_comps}).`,
        why_it_matters: `A wide exit cap depresses terminal value; if the asset performs to plan, the model is leaving residual value on the table that the IC will ask about.`,
        severity: 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'cap-rate-below-comp-band',
    topic: 'exit_route',
    verb: 'Below benchmark',
    evaluate: (signals) => {
      const s = findSignal(signals, 'cap_rate_vs_comp_band');
      if (!s || s.meta.direction !== 'below') return null;
      return {
        finding: `Exit cap is below the verified-comp band — ${s.value.assumed.toFixed(2)}% vs ${s.value.band_lo.toFixed(2)}–${s.value.band_hi.toFixed(2)}% (n=${s.value.n_comps}).`,
        why_it_matters: `A tight exit cap inflates terminal value; the IC will pressure-test against the comp median and may discount the deal materially.`,
        severity: 4,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },

  // ── MARKET & COMPS ────────────────────────────────────────────────────────
  {
    id: 'price-diverges-from-comp-band',
    topic: 'pricing',
    verb: 'Diverges',
    evaluate: (signals) => {
      const s = findSignal(signals, 'price_vs_comp_band');
      if (!s || Math.abs(s.value.deviation_pct) < 0.10) return null;
      const direction = s.value.deviation_pct > 0 ? 'above' : 'below';
      return {
        finding: `Selling-price assumption diverges from the verified-comp band — ₹${s.meta.assumed.toLocaleString()}/sf is ${Math.abs(s.meta.deviation_pct)}% ${direction} the median ₹${s.meta.comp_median.toLocaleString()}/sf (n=${s.meta.n_comps}).`,
        why_it_matters: direction === 'above'
          ? `A 10%+ above-band price assumption is the dominant cause of under-delivered Bengaluru projects.`
          : `A below-band assumption may understate upside — confirm the comp set is genuinely comparable on size, vintage, and amenities before lowering further.`,
        severity: Math.abs(s.value.deviation_pct) >= 0.20 ? 4 : 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'absorption-above-benchmark',
    topic: 'absorption',
    verb: 'Above benchmark',
    evaluate: (signals) => {
      const s = findSignal(signals, 'absorption_vs_comp_band');
      if (!s || s.value.multiple < 1.5) return null;
      return {
        finding: `Quarterly sales velocity is above the verified-comp benchmark — ${s.value.assumed} units/quarter is ${s.value.multiple.toFixed(2)}× the median ${s.value.comp_median.toFixed(1)} units/quarter (n=${s.value.n_comps}).`,
        why_it_matters: `Above-comp absorption is the single most common cause of under-delivered Bengaluru projects. The base case is likely too optimistic on revenue timing.`,
        severity: s.value.multiple >= 2.0 ? 5 : 4,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },

  // ── EXECUTION & DATA ──────────────────────────────────────────────────────
  {
    id: 'cross-document-inconsistencies',
    topic: 'data_consistency',
    verb: 'Inconsistent',
    evaluate: (signals) => {
      const s = findSignal(signals, 'cross_document_inconsistencies');
      if (!s) return null;
      const { total, by_severity, top_findings } = s.value;
      const severity = by_severity.critical > 0 ? 5
        : by_severity.high > 0 ? 4
        : by_severity.medium > 0 ? 3
        : 2;
      const parts = [];
      if (by_severity.critical) parts.push(`${by_severity.critical} critical`);
      if (by_severity.high) parts.push(`${by_severity.high} high`);
      if (by_severity.medium) parts.push(`${by_severity.medium} medium`);
      if (by_severity.low) parts.push(`${by_severity.low} low`);
      const topLine = (top_findings || []).slice(0, 3).map((f) => `"${f.title}"`).join('; ');
      return {
        finding: `${total} cross-document inconsistenc${total === 1 ? 'y' : 'ies'} flagged by the AI detector — ${parts.join(', ')}.${topLine ? ` Top finding${top_findings.length === 1 ? '' : 's'}: ${topLine}.` : ''}`,
        why_it_matters: 'Sale-deed vs EC vs RERA-filing mismatches are the dominant source of late-stage Karnataka deal breakage. Resolve each finding before underwriting locks; auto-generated by the deterministic comparator stack on every new extraction.',
        severity,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'saleable-area-inconsistent',
    topic: 'data_consistency',
    verb: 'Inconsistent',
    evaluate: (signals) => {
      const s = findSignal(signals, 'extracted_area_mismatch');
      if (!s) return null;
      return {
        finding: `Saleable area is inconsistent between sources — your input is ${s.meta.input.toLocaleString()} sf; the extracted area statement shows ${s.meta.extracted.toLocaleString()} sf (${s.meta.deviation_pct}% delta).`,
        why_it_matters: `A 5%+ delta on saleable area materially shifts revenue, FAR consumption, and the entire downstream cashflow. The discrepancy must be resolved before underwriting can be trusted.`,
        severity: s.value.deviation_pct > 0.10 ? 4 : 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'promoter-delivery-below-benchmark',
    topic: 'execution',
    verb: 'Below benchmark',
    evaluate: (signals) => {
      const s = findSignal(signals, 'promoter_delivery_slippage');
      if (!s || s.value.avg_delay_months <= 6) return null;
      return {
        finding: `Promoter's prior-project delivery is below benchmark — average delay of ${s.value.avg_delay_months} months across the track-record set.`,
        why_it_matters: `Construction-schedule slippage compounds through debt service, sales-trigger covenants, and IRR — build schedule headroom into the base case and pressure-test covenants against the slipped schedule.`,
        severity: s.value.avg_delay_months >= 12 ? 4 : 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'overdue-diligence',
    topic: 'execution',
    verb: 'Missing',
    evaluate: (signals) => {
      const s = findSignal(signals, 'overdue_dd_count');
      if (!s) return null;
      return {
        finding: `${s.value.count} required diligence item${s.value.count === 1 ? ' is' : 's are'} missing past their due dates.`,
        why_it_matters: `Stale diligence is the second-most-common source of last-minute IC surprises. Triage the overdue list before the next IC review.`,
        severity: s.value.count >= 3 ? 4 : 3,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },

  // ── LEGAL CARVE-OUT (deterministic only) ──────────────────────────────────
  {
    id: 'rera-missing',
    topic: 'legal_rera',
    verb: 'Missing',
    evaluate: (signals) => {
      const s = findSignal(signals, 'rera_registration_missing');
      if (!s) return null;
      // Match the sentence to the evidence: this signal fires for BOTH a missing
      // entry (reason 'no_entry') and an on-file-but-unvalidated entry (reason
      // 'not_validated'). Hardcoding "is missing" for the latter would overstate
      // a worse statutory posture than the data supports — and this is a
      // legal-four lane, where the card must not assert more than the facts.
      const notValidated = s.value && s.value.reason === 'not_validated';
      return {
        finding: notValidated
          ? `RERA registration is on file but not yet validated (status: ${s.value.status || 'pending'}).`
          : `RERA registration is not on file for this regulated asset class.`,
        why_it_matters: `Marketing or pre-sale activity is restricted under Karnataka RERA Section 3 until the registration is on file and validated.`,
        severity: 5,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
  {
    id: 'statutory-approvals-missing',
    topic: 'legal_approvals',
    verb: 'Missing',
    evaluate: (signals) => {
      const s = findSignal(signals, 'approval_gap_count');
      if (!s || s.value.required_open === 0) return null;
      return {
        finding: `${s.value.required_open} of ${s.value.required_total} required statutory approvals are missing or unvalidated.`,
        why_it_matters: `Each unresolved approval is a deal-execution risk; the IC will pressure on the longest-path approval and the worst-case timeline.`,
        severity: s.value.required_open >= 5 ? 4 : s.value.required_open >= 3 ? 3 : 2,
        evidence: s.evidence,
        signals: [s.kind],
      };
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate every diagnostic rule against the signals and return the matched
 * findings, grouped by diagnostic group, sorted by severity within group.
 */
const generateDiagnoses = (signals) => {
  if (!Array.isArray(signals) || signals.length === 0) {
    return { findings: [], groups: [] };
  }

  const findings = [];
  for (const rule of DIAGNOSTIC_RULES) {
    try {
      const result = rule.evaluate(signals);
      if (!result) continue;
      findings.push({
        id: rule.id,
        verb: result.verb || rule.verb,
        topic: rule.topic,
        finding: result.finding,
        why_it_matters: result.why_it_matters,
        severity: result.severity,
        evidence: result.evidence || [],
        signals: result.signals || [],
        ai_narratable: !isLegalTopic(rule.topic),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[dealDoctor] rule "${rule.id}" threw: ${err.message}`);
    }
  }

  // Sort findings within their groups by severity desc.
  findings.sort((a, b) => b.severity - a.severity);

  const groups = Object.entries(DIAGNOSTIC_GROUPS).map(([key, meta]) => ({
    key,
    label: meta.label,
    ai_narratable: meta.ai_narratable !== false,
    findings: findings.filter((f) => meta.topics.includes(f.topic)),
  })).filter((g) => g.findings.length > 0);

  return { findings, groups };
};

/**
 * Generate the Deal Doctor view for a workspace payload. Optionally accepts a
 * narrator hook (same shape as the recommendation engine's) and a tone gate.
 *
 * The narrator rephrases the `finding` + `why_it_matters` lines per finding;
 * the tone gate (if provided) rejects narrations that exceed the diagnostic
 * tone threshold before they're swapped in.
 */
const generateForWorkspace = async (workspace, options = {}) => {
  const narrate = typeof options.narrate === 'function' ? options.narrate : null;
  const toneGate = typeof options.toneGate === 'function' ? options.toneGate : null;

  const signals = extractAllSignals(workspace);
  const { findings, groups } = generateDiagnoses(signals);

  let outFindings = findings;
  if (narrate) {
    outFindings = await Promise.all(
      findings.map(async (card) => {
        if (!card.ai_narratable) return card;
        try {
          const narration = await narrate(card, { workspace });
          if (!narration || typeof narration !== 'object') return card;
          // Tone gate runs on the narrator output; rejection falls through
          // to the deterministic template silently.
          if (toneGate) {
            const ok = await toneGate(narration);
            if (!ok) return card;
          }
          return {
            ...card,
            finding: typeof narration.finding === 'string' && narration.finding.length > 0 ? narration.finding : card.finding,
            why_it_matters: typeof narration.why_it_matters === 'string' && narration.why_it_matters.length > 0 ? narration.why_it_matters : card.why_it_matters,
            narrated: true,
          };
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[dealDoctor] narrator failed for ${card.id}: ${err.message}`);
          return card;
        }
      }),
    );
  }

  // Re-group with the (possibly narrated) findings so the grouped view
  // matches the flat list.
  const outGroups = Object.entries(DIAGNOSTIC_GROUPS).map(([key, meta]) => ({
    key,
    label: meta.label,
    ai_narratable: meta.ai_narratable !== false,
    findings: outFindings.filter((f) => meta.topics.includes(f.topic)),
  })).filter((g) => g.findings.length > 0);

  return {
    findings: outFindings,
    groups: outGroups,
    finding_count: outFindings.length,
    signal_count: signals.length,
    generated_at: new Date().toISOString(),
  };
};

module.exports = {
  DIAGNOSIS_VERBS,
  DIAGNOSTIC_GROUPS,
  DIAGNOSTIC_RULES,
  generateDiagnoses,
  generateForWorkspace,
  isLegalTopic,
};
