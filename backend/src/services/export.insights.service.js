'use strict';

// Provider availability flag stays on providerRegistry (it's an SDK-presence
// check, not an LLM call). The reasoning call routes through aiRouter so it
// lands in ai_call_logs and respects the daily cost cap — the only consumer
// of Claude that previously bypassed the router.
const { getProviderAvailability } = require('./ai/providerRegistry');
const { runClaudeReasoning, runAI } = require('./ai/aiRouter');
const { sanitizeAiProse } = require('../utils/aiLegalProseGuard');

// Hard timeout so export routes never hang on a stalled model call.
const MODEL_TIMEOUT_MS = 15000;

// PR-NX40 (2026-05-18): bump maxTokens 700 → 1200 to give Claude headroom
// to finish multi-paragraph IC opinions on hospitality / mixed-use deals
// without mid-JSON truncation. Same fix shape as PR-NX24 for the briefing
// service. Cost impact: +500 output tokens at Claude Sonnet 4.6 pricing
// = $0.0075/export (~₹0.65) — negligible.
const PROVIDER_MAX_TOKENS = 1200;

// PR-NX40 (2026-05-18): one-line provider error → "Provider <status> <msg>"
// so the DOCX footer can show the operator EXACTLY why the primary failed
// when the secondary rescued the call. Mirrors describeProviderError from
// dealBriefing.service.js (PR-NX21).
const describeProviderError = (provider, err) => {
  if (!err) return `${provider} failed (unknown reason)`;
  const msg = String(err.message || err).slice(0, 120);
  const status = err.status || err.statusCode || err.code || null;
  return status ? `${provider} ${status} ${msg}` : `${provider} ${msg}`;
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

const num = (v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);

// Strip ```json fences and attempt a strict JSON.parse. Returns null on failure.
const parseModelJson = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last-ditch: extract first { ... } block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
};

// Build a compact, grounded payload so the model has facts but no chance to
// hallucinate metadata it wasn't given.
const buildPayload = ({
  deal,
  ddCounts,
  riskCounts,
  financials,
  benchmarks,
  topRiskFlags,
  topDdItems,
  cashFlowSummary,
}) => ({
  deal: {
    name: deal.name,
    asset_class: deal.asset_class,
    deal_type: deal.deal_type,
    stage: deal.stage,
    priority: deal.priority,
    city: deal.city,
    state: deal.state,
    land_area_sqft: num(deal.land_area_sqft),
    land_ask_price_cr: num(deal.land_ask_price_cr),
    negotiated_price_cr: num(deal.negotiated_price_cr),
    // Deliberately NOT passing rera_registered: handing the model a RERA
    // registration boolean invites it to narrate RERA legal status, which is
    // one of the four legal lanes AI must never assert (CLAUDE.md). RERA
    // posture reaches the IC via the deterministic K-RERA panel + risk flags.
  },
  financial_model: financials
    ? {
        total_cost_cr: num(financials.total_cost_cr),
        total_revenue_cr: num(financials.total_revenue_cr),
        gross_profit_cr: num(financials.gross_profit_cr),
        gross_margin_pct: num(financials.gross_margin_pct),
        irr_pct: num(financials.irr_pct),
        npv_cr: num(financials.npv_cr),
        equity_multiple: num(financials.equity_multiple),
        residual_land_value_cr: num(financials.residual_land_value_cr),
        discount_rate_pct: num(financials.discount_rate_pct),
        project_duration_years:
          financials.project_duration_months != null
            ? Number((financials.project_duration_months / 12).toFixed(2))
            : null,
      }
    : null,
  diligence: {
    total_required: num(ddCounts.total_required) ?? 0,
    completed_required: num(ddCounts.completed_required) ?? 0,
    open_deal_breakers: num(ddCounts.open_deal_breakers) ?? 0,
  },
  risks: {
    critical: num(riskCounts.critical) ?? 0,
    high: num(riskCounts.high) ?? 0,
    medium: num(riskCounts.medium) ?? 0,
    low: num(riskCounts.low) ?? 0,
  },
  market_benchmarks: benchmarks
    ? {
        count: num(benchmarks.count) ?? 0,
        avg_rate_per_sqft: num(benchmarks.avg_rate_per_sqft),
        median_rate_per_sqft: num(benchmarks.median_rate_per_sqft),
        min_rate_per_sqft: num(benchmarks.min_rate_per_sqft),
        max_rate_per_sqft: num(benchmarks.max_rate_per_sqft),
      }
    : null,
  cash_flow_summary: cashFlowSummary
    ? {
        total_inflow_cr: num(cashFlowSummary.totalInflow),
        total_outflow_cr: num(cashFlowSummary.totalOutflow),
        net_cr: num(cashFlowSummary.net),
        peak_deployment_cr: num(cashFlowSummary.peakDeployment),
        first_positive_period: cashFlowSummary.firstPositiveLabel || null,
      }
    : null,
  open_risk_flags: Array.isArray(topRiskFlags)
    ? topRiskFlags.slice(0, 5).map((risk) => ({
        title: risk.title,
        severity: risk.severity,
        category: risk.category,
        description: risk.description,
      }))
    : [],
  pending_dd_items: Array.isArray(topDdItems)
    ? topDdItems.slice(0, 5).map((item) => ({
        item_name: item.item_name,
        category: item.category,
        severity: item.severity,
        status: item.status,
      }))
    : [],
});

const SYSTEM_PROMPT = `You are an investment-review analyst at an India-focused real estate private equity firm. You produce disciplined, grounded, quantitative investor-grade notes.

STRICT RULES:
- Respond ONLY with valid JSON matching the schema below. No markdown fences, no prose before/after.
- Reference only the numbers and flags provided. Never invent — and never assert or narrate as settled fact — market rates, comps, or the four legal lanes (title, encumbrance, RERA registration, statutory approvals). If a legal topic is material, frame it strictly as a diligence item, never as a finding.
- If a KPI is missing, say so explicitly rather than guessing.
- Be blunt about weaknesses. Investor-grade notes that only praise are useless.
- India market conventions: values in INR Crore, IRR in percent, areas in sqft.

SCHEMA:
{
  "ic_opinion": "3-5 sentence investor-grade opinion. Lead with EXACTLY ONE stance from REDIP's closed vocabulary — Recommend proceeding / Recommend proceeding subject to conditions / Hold pending [items] / Re-examine [items] — and NEVER the words approve, approval, decline, reject, buy, sell, pass, or clear. Cite 2-3 specific KPIs from the payload. Name one material weakness.",
  "top_risks": [
    { "title": "Short risk title (max 8 words)", "detail": "1-2 sentence explanation anchored in the data" }
  ],
  "next_steps": [
    "Specific, actionable next step (max 15 words)"
  ],
  "confidence": "high" | "medium" | "low"
}

Provide 3 top_risks and 3 next_steps. Confidence reflects data completeness: "low" if financial_model is null or DD completion < 30%.`;

// PR-NX40 (2026-05-18): coerce the parsed JSON into the canonical
// `available: true` envelope. Extracted so primary + secondary providers
// can share the same shape mapping (parse logic was duplicated otherwise).
const coerceInsightsEnvelope = (parsed, extras = {}) => ({
  available: true,
  // Defense-in-depth (CLAUDE.md): run every customer-facing AI field through the
  // shared legal-prose guard — it rewrites banned absolute stance verbs AND
  // strips any statutory-verdict sentence (title / RERA / encumbrance / approval)
  // the model may have narrated. The prompt is the primary guard; this is the
  // deterministic backstop before the text reaches the customer DOCX.
  ic_opinion: typeof parsed.ic_opinion === 'string' ? sanitizeAiProse(parsed.ic_opinion.trim()).text : null,
  top_risks: Array.isArray(parsed.top_risks)
    ? parsed.top_risks
        .filter((r) => r && (r.title || r.detail))
        .slice(0, 5)
        .map((r) => ({
          title: sanitizeAiProse(String(r.title || '').trim()).text,
          detail: sanitizeAiProse(String(r.detail || '').trim()).text,
        }))
    : [],
  next_steps: Array.isArray(parsed.next_steps)
    ? parsed.next_steps
        .filter((s) => typeof s === 'string' && s.trim())
        .slice(0, 5)
        .map((s) => sanitizeAiProse(s.trim()).text)
    : [],
  confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
    ? parsed.confidence
    : 'medium',
  disclaimer:
    'AI-generated Investor-Grade opinion based on stored deal data. Verify all facts and risks before any investment decision.',
  ...extras,
});

// ── Customer-export display policy for the IC opinion (audit #9/#21, 2026-06-25).
// A LOW-confidence AI opinion (per SYSTEM_PROMPT: financial_model null or DD
// completion < 30%) reads as authoritative in a customer investor report while
// being weakly grounded. Operator decision (delegated 2026-06-25): WITHHOLD it
// from customer-facing exports and lead with the deterministic metrics, rather
// than print a hedged stance carrying a "Confidence: low" label. The in-app
// workspace keeps showing the opinion with its confidence chip (separate
// intelligence.service path) — this gate is EXPORT-ONLY. Medium/high opinions
// render normally with their label.
//
// Returns a display decision so every customer renderer treats it identically:
//   { mode: 'render' | 'withheld' | 'unavailable', text, confidence, reason }
const resolveCustomerIcOpinion = (envelope) => {
  const ic = envelope || {};
  const opinion = typeof ic.ic_opinion === 'string' ? ic.ic_opinion.trim() : '';
  if (!opinion) {
    return { mode: 'unavailable', text: null, confidence: ic.confidence || null, reason: ic.reason || null };
  }
  if (ic.confidence === 'low') {
    return { mode: 'withheld', text: null, confidence: 'low', reason: ic.reason || null };
  }
  return { mode: 'render', text: opinion, confidence: ic.confidence || null, reason: null };
};

// PR-NX40 (2026-05-18): single-provider call helpers. Each returns the
// raw model text (string) or throws. The orchestrator below catches +
// records fallbackReason, then tries the next provider.

const callPrimaryClaude = async (payload, deal) => {
  return withTimeout(
    runClaudeReasoning({
      task: 'export_insights',
      systemPrompt: SYSTEM_PROMPT,
      cachePrompt: true,
      payload,
      maxTokens: PROVIDER_MAX_TOKENS,
      attach: { dealId: deal?.id, organizationId: deal?.organization_id },
      metadata: { kind: 'ic_opinion', attempt: 'primary' },
    }),
    MODEL_TIMEOUT_MS,
    'Claude deal-insights call'
  );
};

const callSecondaryOpenAI = async (payload, deal) => {
  // Force OpenAI as the alternate provider via explicit `provider` arg.
  // Mirrors the pattern in dealBriefing.service.js (PR-NX21) so failure
  // diagnostics are consistent across XLSX briefing and DOCX IC opinion.
  if (!runAI) return null;
  const envelope = await withTimeout(
    runAI({
      task: 'export_insights',
      provider: 'openai',
      attach: { dealId: deal?.id, organizationId: deal?.organization_id },
      metadata: { kind: 'ic_opinion', attempt: 'secondary' },
      run: async ({ providers, model }) => providers.runOpenAIReasoning({
        systemPrompt: SYSTEM_PROMPT,
        payload,
        maxTokens: PROVIDER_MAX_TOKENS,
        model,
      }),
    }),
    MODEL_TIMEOUT_MS,
    'OpenAI deal-insights call'
  );
  return envelope?.result || null;
};

/**
 * Generate the IC opinion + top risks + next steps with multi-provider
 * failover (PR-NX40 — 2026-05-18).
 *
 * Cascade: PRIMARY (Claude Sonnet 4.6) → SECONDARY (OpenAI GPT-5.4) →
 * unavailable. ALWAYS returns a valid envelope — the caller can render
 * without further error handling. The `fallbackReason` field tells the
 * caller which path actually fired so the DOCX footer can surface
 * accurate provenance to the operator.
 *
 * Pre-NX40 the function did one Claude call and returned `unavailable`
 * on any failure. Operators on the Jigani deal saw the DOCX render
 * "AI-generated investor-grade opinion is not available" — a silent
 * outage with no diagnostic. Now the failover covers Claude timeouts,
 * 429 rate-limits, malformed JSON, and Anthropic-side outages.
 */
const generateDealInsights = async ({
  deal,
  ddCounts,
  riskCounts,
  financials,
  benchmarks = null,
  topRiskFlags = [],
  topDdItems = [],
  cashFlowSummary = null,
}) => {
  const unavailable = (reason) => ({
    available: false,
    reason,
    ic_opinion: null,
    top_risks: [],
    next_steps: [],
    confidence: null,
    disclaimer:
      'AI-generated Investor-Grade opinion is informational only. Verify all facts and risks before any investment decision.',
  });

  const availability = getProviderAvailability();
  if (!availability.gpt_compatible && !availability.claude) {
    // Neither provider configured — nothing to call.
    return unavailable('No AI provider configured (need ANTHROPIC_API_KEY or OPENAI_API_KEY)');
  }

  const payload = buildPayload({
    deal,
    ddCounts,
    riskCounts,
    financials,
    benchmarks,
    topRiskFlags,
    topDdItems,
    cashFlowSummary,
  });

  const fallbackReasons = [];

  // ─── Attempt 1: PRIMARY (Claude) ──────────────────────────────────────
  if (availability.claude) {
    try {
      const raw = await callPrimaryClaude(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceInsightsEnvelope(parsed, {
          provider: 'claude-sonnet-4-6',
          fallbackReason: null,
        });
      }
      fallbackReasons.push('Claude returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('Claude', err));
    }
  } else {
    fallbackReasons.push('Claude not configured');
  }

  // ─── Attempt 2: SECONDARY (OpenAI) ────────────────────────────────────
  if (availability.gpt_compatible) {
    try {
      const raw = await callSecondaryOpenAI(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceInsightsEnvelope(parsed, {
          provider: 'gpt-5.4',
          fallbackReason: fallbackReasons.length
            ? `${fallbackReasons.join('; ')} — auto-failover succeeded on openai`
            : null,
        });
      }
      fallbackReasons.push('OpenAI returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('OpenAI', err));
    }
  } else {
    fallbackReasons.push('OpenAI not configured');
  }

  // ─── Both failed ──────────────────────────────────────────────────────
  return unavailable(fallbackReasons.join('; '));
};

// ════════════════════════════════════════════════════════════════════════
// PR-NX43 (2026-05-18) — Risk Register narrative synthesis
// ════════════════════════════════════════════════════════════════════════
//
// Pre-NX43 the DOCX Risk Register section rendered the structured table
// only — every risk shown as a row but no synthesis answering the
// "what does this RISK PROFILE mean for the deal?" question. Investment
// committees ask exactly that question first. NX43 adds 2-paragraph
// Claude-synthesized narrative ABOVE the table:
//
//   Paragraph 1 — Risk profile summary (overall picture, severity mix,
//   what the cluster of risks says about deal quality).
//
//   Paragraph 2 — Critical risk deep-dive (specifically calls out the
//   critical / high severity items with context on why each matters for
//   THIS asset class + structure).
//
// Same failover cascade as generateDealInsights — Claude primary, OpenAI
// secondary. Per-paragraph max 80 words. Cite-or-null per AI_ROADMAP §10:
// references the actual risk titles from the structured table, never
// invents new risks.

const RISK_NARRATIVE_SYSTEM_PROMPT = `You are an investment-review analyst at an India-focused real estate private equity firm. You synthesize logged risk flags into a 2-paragraph narrative for the IC memo.

STRICT RULES:
- Respond ONLY with valid JSON matching the schema below. No markdown fences, no prose before/after.
- Reference only the risks provided in the payload. Never invent risks, severities, or mitigations.
- Be blunt about deal-killers. Risk synthesis that softens critical items is useless.
- Indian real estate context: title risk, RERA compliance, BBMP/BDA approvals, JDA enforceability, conversion order absence are all material.
- Both paragraphs are tight: max 80 words each.
- NEVER quote financial figures — no IRR, NPV, rupee amounts (₹ / Cr / lakh), or percentages. Reference severity counts and risk titles only; the live financial model carries the numbers.
- Both paragraphs must be mutually consistent with the risk_summary counts provided: if critical + high are zero, neither paragraph may claim a critical, high-severity, or deal-killer risk exists; if critical + high are nonzero, neither paragraph may claim there are no critical or high-severity risks.

SCHEMA:
{
  "summary_paragraph": "1 paragraph (3-5 sentences, max 80 words) synthesizing the overall risk profile. Anchor in the severity counts. Name what kind of deal this risk mix suggests (clean / manageable / cautious / pass).",
  "critical_spotlight_paragraph": "1 paragraph (3-5 sentences, max 80 words) explicitly naming each critical/high severity risk by its actual title from the payload. Explain WHY each one matters for this deal's asset class + structure.",
  "confidence": "high" | "medium" | "low"
}

If no critical/high risks exist, set critical_spotlight_paragraph to a 1-sentence note that no critical or high-severity risks are currently logged. Confidence reflects data completeness.`;

const buildRiskNarrativePayload = ({ deal, riskCounts, items }) => ({
  deal: {
    name: deal?.name || null,
    asset_class: deal?.asset_class || null,
    deal_structure: deal?.deal_structure || null,
    stage: deal?.stage || null,
    city: deal?.city || null,
  },
  risk_summary: {
    total: items?.length || 0,
    critical: num(riskCounts?.critical) || 0,
    high: num(riskCounts?.high) || 0,
    medium: num(riskCounts?.medium) || 0,
    low: num(riskCounts?.low) || 0,
  },
  risk_flags: (items || []).slice(0, 12).map((r) => ({
    title: r.title || '(untitled)',
    severity: r.severity || null,
    category: r.category || null,
    status: r.status || null,
    description: typeof r.description === 'string' ? r.description.slice(0, 240) : null,
    mitigation: typeof r.mitigation === 'string' ? r.mitigation.slice(0, 200) : null,
  })),
});

// ── Deterministic consistency gate (post-model, pre-render) ─────────────
//
// The model is PROMPTED to stay consistent with the payload's severity
// counts and to never quote financial figures, but prompts are not
// guarantees. This gate enforces both deterministically, at SENTENCE level:
// offending sentences are removed verbatim, never rewritten (no AI, no
// paraphrase — removal only). If a paragraph loses every sentence, the whole
// envelope flips to unavailable and the sheet omits the section.

const splitSentences = (text) =>
  String(text)
    .split(/(?<=[.!?])\s+/)
    .map((sent) => sent.trim())
    .filter(Boolean);

// Mentions of a critical/high/deal-killer risk (severity vocabulary, not the
// bare word "high", which legitimately appears in phrases like "high legal
// exposure" only when severity-suffixed).
const CRITICAL_CLAIM_RE = /\bcritical\b|\bhigh[-\s]severity\b|\bdeal[-\s]?(?:killer|breaker)\b/i;
// Negated claim — a negation word within ~40 chars BEFORE the severity term
// ("no critical…", "not a deal-killer", "absence of high-severity…").
// Proximity + ordering matter: a negation elsewhere in the sentence
// ("…is the dealbreaker — without DC approval…") must NOT read as negated.
const NEGATED_CLAIM_RE = /\b(?:no|not|none|nothing|neither|zero|without|absent|absence)\b[^.!?]{0,40}?(?:\bcritical\b|\bhigh[-\s]severity\b|\bdeal[-\s]?(?:killer|breaker)\b)/i;

// Currency / percentage tokens: ₹ amounts, Cr / crore / lakh amounts, and
// percentages. Captures the numeral so we can check the payload for it.
const FIGURE_TOKEN_RE = /₹\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:%|Cr\b|crore\b|lakhs?\b)/gi;

const sentenceQuotesForeignFigure = (sentence, payloadText) => {
  const matches = sentence.match(FIGURE_TOKEN_RE) || [];
  return matches.some((token) => {
    const numeral = token.replace(/[^\d.]/g, '');
    if (!numeral) return false;
    // Figure is only legitimate if the numeral itself appears somewhere in
    // the payload (e.g. quoted from a risk description like "< ₹45L").
    return !payloadText.includes(numeral);
  });
};

const gateNarrativeParagraph = (text, { criticalHighCount, payloadText }) => {
  if (typeof text !== 'string' || !text.trim()) return text || null;
  const kept = splitSentences(text).filter((sentence) => {
    // Figure gate: strip sentences quoting ₹ / Cr / lakh / % tokens that are
    // not present in the payload the model was given.
    if (sentenceQuotesForeignFigure(sentence, payloadText)) return false;
    const claimsCriticalHigh = CRITICAL_CLAIM_RE.test(sentence);
    if (!claimsCriticalHigh) return true;
    const negated = NEGATED_CLAIM_RE.test(sentence);
    if (criticalHighCount === 0) {
      // Zero critical+high logged → drop sentences asserting such a risk
      // exists (non-negated mentions). "No critical or high-severity risks
      // are logged" is consistent and stays.
      return negated;
    }
    // Nonzero critical+high logged → drop sentences claiming there are none.
    return !negated;
  });
  const joined = kept.join(' ').trim();
  return joined.length ? joined : null;
};

const coerceRiskNarrativeEnvelope = (parsed, payload, extras = {}) => {
  const criticalHighCount =
    (Number(payload?.risk_summary?.critical) || 0) + (Number(payload?.risk_summary?.high) || 0);
  const payloadText = JSON.stringify(payload || {});
  const gate = { criticalHighCount, payloadText };

  // Same deterministic legal-prose backstop as coerceInsightsEnvelope — this
  // narrative is PROMPTED to name Legal/Title risks by title, which makes it
  // the likeliest surface for a stray statutory-verdict sentence.
  const rawSummary = typeof parsed.summary_paragraph === 'string'
    ? sanitizeAiProse(parsed.summary_paragraph.trim()).text
    : null;
  const rawSpotlight = typeof parsed.critical_spotlight_paragraph === 'string'
    ? sanitizeAiProse(parsed.critical_spotlight_paragraph.trim()).text
    : null;

  const summary = gateNarrativeParagraph(rawSummary, gate);
  const spotlight = gateNarrativeParagraph(rawSpotlight, gate);

  // A paragraph the model DID produce that the gate emptied means the model
  // contradicted the deterministic counts (or fabricated figures) wholesale
  // — the whole narrative is untrustworthy. Flip to unavailable; the sheet
  // omits unavailable sections rather than rendering residue.
  const summaryEmptied = Boolean(rawSummary && rawSummary.trim()) && !summary;
  const spotlightEmptied = Boolean(rawSpotlight && rawSpotlight.trim()) && !spotlight;
  if (summaryEmptied || spotlightEmptied) {
    return {
      available: false,
      reason: 'narrative failed deterministic consistency gate (contradicted risk counts or quoted figures not in payload)',
      summary_paragraph: null,
      critical_spotlight_paragraph: null,
      confidence: null,
      disclaimer:
        'AI-assisted risk synthesis is informational only. Verify against the structured risk register.',
      ...extras,
    };
  }

  return {
    available: true,
    summary_paragraph: summary,
    critical_spotlight_paragraph: spotlight,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
      ? parsed.confidence
      : 'medium',
    disclaimer:
      'AI-assisted risk synthesis is informational only. Verify against the structured risk register below and the deal Risk tab.',
    ...extras,
  };
};

const callPrimaryRiskNarrativeClaude = async (payload, deal) => withTimeout(
  runClaudeReasoning({
    task: 'export_insights',
    systemPrompt: RISK_NARRATIVE_SYSTEM_PROMPT,
    cachePrompt: true,
    payload,
    maxTokens: 900,
    attach: { dealId: deal?.id, organizationId: deal?.organization_id },
    metadata: { kind: 'risk_narrative', attempt: 'primary' },
  }),
  MODEL_TIMEOUT_MS,
  'Claude risk-narrative call'
);

const callSecondaryRiskNarrativeOpenAI = async (payload, deal) => {
  if (!runAI) return null;
  const envelope = await withTimeout(
    runAI({
      task: 'export_insights',
      provider: 'openai',
      attach: { dealId: deal?.id, organizationId: deal?.organization_id },
      metadata: { kind: 'risk_narrative', attempt: 'secondary' },
      run: async ({ providers, model }) => providers.runOpenAIReasoning({
        systemPrompt: RISK_NARRATIVE_SYSTEM_PROMPT,
        payload,
        maxTokens: 900,
        model,
      }),
    }),
    MODEL_TIMEOUT_MS,
    'OpenAI risk-narrative call'
  );
  return envelope?.result || null;
};

/**
 * Synthesize a 2-paragraph narrative covering the deal's risk profile.
 * Cascade: Claude → OpenAI → unavailable. Same failover shape as
 * generateDealInsights.
 *
 * Returns { available, summary_paragraph, critical_spotlight_paragraph,
 *           confidence, disclaimer, provider, fallbackReason }.
 *
 * Returns unavailable+null narrative when items is empty or has only
 * status='closed' rows — no synthesis call wasted on a clean deal.
 */
const generateRiskNarrative = async ({ deal, riskCounts, items }) => {
  const unavailable = (reason) => ({
    available: false,
    reason,
    summary_paragraph: null,
    critical_spotlight_paragraph: null,
    confidence: null,
    disclaimer:
      'AI-assisted risk synthesis is informational only. Verify against the structured risk register.',
  });

  // No-op fast paths.
  if (!Array.isArray(items) || items.length === 0) {
    return unavailable('no risks logged');
  }
  const openItems = items.filter((r) => {
    const status = String(r?.status || '').toLowerCase();
    return status !== 'closed' && status !== 'resolved' && status !== 'mitigated';
  });
  if (openItems.length === 0) {
    return unavailable('all logged risks are closed/resolved/mitigated');
  }

  const availability = getProviderAvailability();
  if (!availability.gpt_compatible && !availability.claude) {
    return unavailable('No AI provider configured (need ANTHROPIC_API_KEY or OPENAI_API_KEY)');
  }

  const payload = buildRiskNarrativePayload({ deal, riskCounts, items: openItems });
  const fallbackReasons = [];

  if (availability.claude) {
    try {
      const raw = await callPrimaryRiskNarrativeClaude(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceRiskNarrativeEnvelope(parsed, payload, {
          provider: 'claude-sonnet-4-6',
          fallbackReason: null,
        });
      }
      fallbackReasons.push('Claude returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('Claude', err));
    }
  } else {
    fallbackReasons.push('Claude not configured');
  }

  if (availability.gpt_compatible) {
    try {
      const raw = await callSecondaryRiskNarrativeOpenAI(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceRiskNarrativeEnvelope(parsed, payload, {
          provider: 'gpt-5.4',
          fallbackReason: fallbackReasons.length
            ? `${fallbackReasons.join('; ')} — auto-failover succeeded on openai`
            : null,
        });
      }
      fallbackReasons.push('OpenAI returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('OpenAI', err));
    }
  } else {
    fallbackReasons.push('OpenAI not configured');
  }

  return unavailable(fallbackReasons.join('; '));
};

// ════════════════════════════════════════════════════════════════════════
// PR-NX44 (2026-05-18) — Sensitivity narrative
// ════════════════════════════════════════════════════════════════════════
//
// Pre-NX44 the DOCX Financials section showed the sensitivity tornado
// chart (SVG embed) without a narrative answering "which inputs matter
// most for THIS deal, and by how much?". IC reviewers ask exactly that
// question — the tornado shows the magnitudes but not the implications.
//
// NX44 adds 2-paragraph synthesis ABOVE the tornado:
//   Paragraph 1 — "Driver decomposition": which 2-3 inputs swing IRR
//     most, by how many basis points each, ranked by impact.
//   Paragraph 2 — "Recommended stress tests": top 2-3 stress-test
//     scenarios the deal must pass before IC.
//
// Provider order is FLIPPED from NX43: OpenAI primary, Claude secondary.
// Rationale: OpenAI excels at structured numerical reasoning; Claude
// excels at narrative synthesis. Sensitivity analysis is fundamentally
// numerical — pick the right tool for the job. Symmetric cascade fallback
// ensures resilience either way.

const SENSITIVITY_NARRATIVE_SYSTEM_PROMPT = `You are an investment-review analyst at an India-focused real estate private equity firm. You synthesize sensitivity analysis output into a 2-paragraph narrative for the IC memo.

STRICT RULES:
- Respond ONLY with valid JSON matching the schema below. No markdown fences, no prose before/after.
- Reference only the numbers provided in the payload. Never invent driver impacts or stress-test outcomes.
- Be quantitatively precise: cite specific bps (basis points) of IRR swing per driver.
- Indian real estate context: sell rate per sqft, construction cost per sqft, exit cap rate, debt rate, LTV are standard sensitivity drivers.
- Both paragraphs are tight: max 90 words each.

SCHEMA:
{
  "driver_decomposition_paragraph": "1 paragraph (3-5 sentences, max 90 words) ranking the top 2-3 drivers by IRR swing magnitude. Cite specific bps deltas. Name which driver dominates and by what margin.",
  "stress_test_paragraph": "1 paragraph (3-5 sentences, max 90 words) recommending 2-3 specific stress-test scenarios the deal must pass before IC. Frame each as a concrete what-if with expected IRR impact.",
  "dominant_driver": "Short label naming the #1 driver (e.g., 'Sell Rate' or 'Construction Cost')",
  "confidence": "high" | "medium" | "low"
}

Confidence reflects input completeness — "low" when grid has < 3 rows or < 3 cols, "high" when a full 5×5 grid plus base IRR is present.`;

const buildSensitivityPayload = ({ deal, sensitivityMatrix, financials }) => {
  if (!sensitivityMatrix) return null;
  const irrGrid = Array.isArray(sensitivityMatrix.irrGrid) ? sensitivityMatrix.irrGrid : null;
  const sellingRates = Array.isArray(sensitivityMatrix.sellingRates) ? sensitivityMatrix.sellingRates : [];
  const constructionCosts = Array.isArray(sensitivityMatrix.constructionCosts) ? sensitivityMatrix.constructionCosts : [];
  if (!irrGrid || irrGrid.length < 3 || sellingRates.length < 3 || constructionCosts.length < 3) {
    return null;
  }
  const midRow = Math.floor(constructionCosts.length / 2);
  const midCol = Math.floor(sellingRates.length / 2);
  const baseIrr = num(irrGrid[midRow]?.[midCol]);
  return {
    deal: {
      name: deal?.name,
      asset_class: deal?.asset_class,
      deal_structure: deal?.deal_structure,
      city: deal?.city,
    },
    base_kpis: {
      base_irr_pct: baseIrr,
      total_cost_cr: num(financials?.total_cost_cr),
      total_revenue_cr: num(financials?.total_revenue_cr),
      gross_margin_pct: num(financials?.gross_margin_pct),
      equity_multiple: num(financials?.equity_multiple),
    },
    sensitivity_grid: {
      rows_axis_label: 'Construction cost per sqft (INR)',
      cols_axis_label: 'Selling rate per sqft (INR)',
      rows: constructionCosts,
      cols: sellingRates,
      irr_grid: irrGrid,
    },
    driver_ranges: {
      sell_rate: {
        low_irr: num(irrGrid[midRow]?.[0]),
        high_irr: num(irrGrid[midRow]?.[sellingRates.length - 1]),
        low_input: sellingRates[0],
        high_input: sellingRates[sellingRates.length - 1],
      },
      construction_cost: {
        low_irr: num(irrGrid[irrGrid.length - 1]?.[midCol]),
        high_irr: num(irrGrid[0]?.[midCol]),
        low_input: constructionCosts[constructionCosts.length - 1],
        high_input: constructionCosts[0],
      },
    },
  };
};

const coerceSensitivityEnvelope = (parsed, extras = {}) => ({
  available: true,
  // Deterministic legal-prose backstop, same pattern as the other envelopes.
  driver_decomposition_paragraph: typeof parsed.driver_decomposition_paragraph === 'string'
    ? sanitizeAiProse(parsed.driver_decomposition_paragraph.trim()).text
    : null,
  stress_test_paragraph: typeof parsed.stress_test_paragraph === 'string'
    ? sanitizeAiProse(parsed.stress_test_paragraph.trim()).text
    : null,
  // dominant_driver is a short DATA LABEL ("Sell Rate", "Construction Cost")
  // that must match the tornado chart's driver names — the prose guard's verb
  // rewriting would mangle it ("Sell Rate" → "Recommend exiting Rate"), so it
  // stays a plain trim. The two paragraphs above are the prose surfaces.
  dominant_driver: typeof parsed.dominant_driver === 'string' ? parsed.dominant_driver.trim() : null,
  confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
    ? parsed.confidence
    : 'medium',
  disclaimer:
    'AI-assisted sensitivity synthesis is informational only. Verify driver magnitudes against the tornado chart and the underlying 5×5 grid.',
  ...extras,
});

const callPrimarySensitivityOpenAI = async (payload, deal) => {
  if (!runAI) return null;
  const envelope = await withTimeout(
    runAI({
      task: 'export_insights',
      provider: 'openai',
      attach: { dealId: deal?.id, organizationId: deal?.organization_id },
      metadata: { kind: 'sensitivity_narrative', attempt: 'primary' },
      run: async ({ providers, model }) => providers.runOpenAIReasoning({
        systemPrompt: SENSITIVITY_NARRATIVE_SYSTEM_PROMPT,
        payload,
        maxTokens: 900,
        model,
      }),
    }),
    MODEL_TIMEOUT_MS,
    'OpenAI sensitivity-narrative call'
  );
  return envelope?.result || null;
};

const callSecondarySensitivityClaude = async (payload, deal) => withTimeout(
  runClaudeReasoning({
    task: 'export_insights',
    systemPrompt: SENSITIVITY_NARRATIVE_SYSTEM_PROMPT,
    cachePrompt: true,
    payload,
    maxTokens: 900,
    attach: { dealId: deal?.id, organizationId: deal?.organization_id },
    metadata: { kind: 'sensitivity_narrative', attempt: 'secondary' },
  }),
  MODEL_TIMEOUT_MS,
  'Claude sensitivity-narrative call'
);

/**
 * Synthesize a 2-paragraph narrative covering the deal's sensitivity
 * drivers + recommended stress tests.
 *
 * Cascade: OpenAI primary → Claude secondary → unavailable. OpenAI
 * leads for numerical reasoning; Claude is the resilience layer.
 *
 * Returns unavailable+null fast when the sensitivity grid is too
 * sparse (< 3 rows OR < 3 cols) — no synthesis worth attempting on
 * a degenerate matrix.
 */
const generateSensitivityNarrative = async ({ deal, sensitivityMatrix, financials }) => {
  const unavailable = (reason) => ({
    available: false,
    reason,
    driver_decomposition_paragraph: null,
    stress_test_paragraph: null,
    dominant_driver: null,
    confidence: null,
    disclaimer:
      'AI-assisted sensitivity synthesis is informational only. Verify driver magnitudes against the tornado chart.',
  });

  const payload = buildSensitivityPayload({ deal, sensitivityMatrix, financials });
  if (!payload) {
    return unavailable('insufficient sensitivity grid (< 3 rows or < 3 cols)');
  }

  const availability = getProviderAvailability();
  if (!availability.gpt_compatible && !availability.claude) {
    return unavailable('No AI provider configured (need ANTHROPIC_API_KEY or OPENAI_API_KEY)');
  }

  const fallbackReasons = [];

  if (availability.gpt_compatible) {
    try {
      const raw = await callPrimarySensitivityOpenAI(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceSensitivityEnvelope(parsed, {
          provider: 'gpt-5.4',
          fallbackReason: null,
        });
      }
      fallbackReasons.push('OpenAI returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('OpenAI', err));
    }
  } else {
    fallbackReasons.push('OpenAI not configured');
  }

  if (availability.claude) {
    try {
      const raw = await callSecondarySensitivityClaude(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceSensitivityEnvelope(parsed, {
          provider: 'claude-sonnet-4-6',
          fallbackReason: fallbackReasons.length
            ? `${fallbackReasons.join('; ')} — auto-failover succeeded on claude`
            : null,
        });
      }
      fallbackReasons.push('Claude returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('Claude', err));
    }
  } else {
    fallbackReasons.push('Claude not configured');
  }

  return unavailable(fallbackReasons.join('; '));
};

// ════════════════════════════════════════════════════════════════════════
// PR-NX45 (2026-05-18) — Document-derived insights (Gemini extractions
// surfaced + Claude cross-document reasoning)
// ════════════════════════════════════════════════════════════════════════
//
// Pre-NX45 the DOCX report mentioned uploaded documents via the Provenance
// section but never SURFACED what was actually extracted from them. The
// operator had to download the report + then click into each document on
// the deal page to know the sale-deed's owner name, the EC's encumbrance
// status, the RERA cert's expiry date — exactly the facts an IC reviewer
// asks about first.
//
// NX45 adds a new "Document-Derived Insights" section that:
//   1. Surfaces high-confidence extracted facts grouped by doctype.
//      Pure data display — uses what Gemini already extracted (PR-NX25).
//   2. Detects cross-document inconsistencies via Claude reasoning:
//      "Sale deed shows owner X but RTC shows owner Y" type findings.
//      This is the institutional-grade differentiator: catches mismatches
//      a human would miss in a 30-document deal package.
//   3. Confidence summary: how many fields are high vs medium vs low.
//
// Provider strategy:
//   - The DATA part (#1, #3) is deterministic — JS reads structured_fields
//     and renders. No AI call.
//   - The INSISTENCY DETECTION part (#2) is Claude — best at cross-document
//     reasoning. OpenAI is the fallback for resilience.

const DOC_INSIGHTS_SYSTEM_PROMPT = `You are an investment-review analyst at an India-focused real estate private equity firm. You compare facts extracted from multiple legal documents (sale deeds, ECs, khata extracts, RERA registrations, conversion orders) and surface inconsistencies that would matter to a credit committee.

STRICT RULES:
- Respond ONLY with valid JSON matching the schema below. No markdown fences, no prose before/after.
- Only flag a finding if the documents EXPLICITLY contradict OR if one document is missing a fact another asserts. Do NOT invent contradictions.
- Be specific: cite the document type AND the value seen in each document. Never write vague "documents disagree" without naming the values.
- Indian context: owner names, survey numbers (with sub-divisions like 12/2A), khata numbers, RERA registration numbers, area, consideration value are the canonical fields to cross-check.
- Severity: "critical" for title/owner mismatches, "high" for survey/khata mismatches, "medium" for area/value mismatches, "low" for trivial.
- LEGAL LANES (title, ownership, khata, EC / encumbrance, RERA registration, statutory approval): you may flag a factual discrepancy between documents or a missing document, but you must NEVER assert a statutory conclusion as truth (never "title is clear", "RERA-compliant", "khata is valid", "approval will be granted") and NEVER use an absolute decision verb (buy, sell, reject, approve, decline, clear, pass). Every "recommendation" on these topics must be a verification step for a qualified professional (e.g. "Have counsel verify the owner name against the latest RTC"), never a conclusion.

SCHEMA:
{
  "summary_paragraph": "1 paragraph (3-5 sentences, max 90 words) summarizing what the extracted document set tells us about the deal. Reference the count of documents + which doctypes are present.",
  "findings": [
    {
      "title": "Short title (max 10 words)",
      "severity": "critical" | "high" | "medium" | "low",
      "description": "1-2 sentence explanation naming the contradicting documents + the values seen in each.",
      "recommendation": "Specific next step (max 15 words) to resolve the finding."
    }
  ],
  "confidence": "high" | "medium" | "low"
}

Provide 0-5 findings. ZERO is the right answer when the documents agree. Confidence "low" when fewer than 2 documents are present or the document set lacks key doctypes (sale_deed, ec, rtc, khata).`;

const buildDocInsightsPayload = ({ deal, extractions }) => {
  // Group fields by doctype so Claude sees the documents as related groups
  // rather than a flat list.
  const docs = {};
  for (const ext of extractions || []) {
    if (!ext?.structured_fields || typeof ext.structured_fields !== 'object') continue;
    const docType = String(ext.doc_type || 'unknown');
    if (!docs[docType]) docs[docType] = [];
    docs[docType].push({
      extraction_id: ext.id,
      provider: ext.provider || null,
      // Only keep fields with truthy values to keep payload tight.
      fields: Object.fromEntries(
        Object.entries(ext.structured_fields)
          .filter(([_k, v]) => v != null && v !== '')
          .slice(0, 30) // cap per doc to avoid blowing the prompt budget
      ),
    });
  }
  return {
    deal: {
      name: deal?.name || null,
      asset_class: deal?.asset_class || null,
      city: deal?.city || null,
      stated_owner_name: deal?.owner_name || null,
      stated_survey_number: deal?.survey_number || null,
    },
    document_counts: Object.fromEntries(
      Object.entries(docs).map(([k, arr]) => [k, arr.length])
    ),
    documents_by_type: docs,
  };
};

const coerceDocInsightsEnvelope = (parsed, extras = {}) => ({
  available: true,
  // Defense-in-depth: these findings cross the legal-four lanes (title / owner /
  // khata / EC / RERA), so run every field through the shared legal-prose guard —
  // it both scrubs absolute decision verbs (approve / clear / pass / buy …) AND
  // strips any statutory-verdict sentence the model emitted, before the text
  // reaches the customer DOCX. The prompt is the primary guard; this is the
  // deterministic backstop (CLAUDE.md).
  summary_paragraph: typeof parsed.summary_paragraph === 'string'
    ? sanitizeAiProse(parsed.summary_paragraph.trim()).text
    : null,
  findings: Array.isArray(parsed.findings)
    ? parsed.findings
        .filter((f) => f && (f.title || f.description))
        .slice(0, 8)
        .map((f) => ({
          title: sanitizeAiProse(String(f.title || '').trim()).text,
          severity: ['critical', 'high', 'medium', 'low'].includes(f.severity)
            ? f.severity
            : 'medium',
          description: sanitizeAiProse(String(f.description || '').trim()).text,
          recommendation: typeof f.recommendation === 'string'
            ? sanitizeAiProse(f.recommendation.trim()).text
            : null,
        }))
    : [],
  confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
  disclaimer:
    'AI-assisted cross-document analysis is informational only. Verify each flagged finding against the source documents before relying on it.',
  ...extras,
});

const callPrimaryDocInsightsClaude = async (payload, deal) => withTimeout(
  runClaudeReasoning({
    task: 'export_insights',
    systemPrompt: DOC_INSIGHTS_SYSTEM_PROMPT,
    cachePrompt: true,
    payload,
    maxTokens: 1200,
    attach: { dealId: deal?.id, organizationId: deal?.organization_id },
    metadata: { kind: 'doc_insights', attempt: 'primary' },
  }),
  MODEL_TIMEOUT_MS,
  'Claude doc-insights call'
);

const callSecondaryDocInsightsOpenAI = async (payload, deal) => {
  if (!runAI) return null;
  const envelope = await withTimeout(
    runAI({
      task: 'export_insights',
      provider: 'openai',
      attach: { dealId: deal?.id, organizationId: deal?.organization_id },
      metadata: { kind: 'doc_insights', attempt: 'secondary' },
      run: async ({ providers, model }) => providers.runOpenAIReasoning({
        systemPrompt: DOC_INSIGHTS_SYSTEM_PROMPT,
        payload,
        maxTokens: 1200,
        model,
      }),
    }),
    MODEL_TIMEOUT_MS,
    'OpenAI doc-insights call'
  );
  return envelope?.result || null;
};

/**
 * Synthesize a cross-document insight pack: surface what was extracted,
 * detect inconsistencies, summarize confidence.
 *
 * Returns unavailable+null fast when no extractions have actual
 * structured_fields populated (zero AI cost on deals without doc-ingest).
 *
 * Cascade: Claude → OpenAI → unavailable.
 */
const generateDocumentInsights = async ({ deal, extractions }) => {
  const unavailable = (reason) => ({
    available: false,
    reason,
    summary_paragraph: null,
    findings: [],
    confidence: null,
    disclaimer:
      'AI-assisted cross-document analysis is informational only.',
  });

  const hasContent = Array.isArray(extractions)
    && extractions.some((e) => e?.structured_fields
      && typeof e.structured_fields === 'object'
      && Object.keys(e.structured_fields).length > 0);
  if (!hasContent) {
    return unavailable('no extractions with structured_fields available');
  }

  const availability = getProviderAvailability();
  if (!availability.gpt_compatible && !availability.claude) {
    return unavailable('No AI provider configured (need ANTHROPIC_API_KEY or OPENAI_API_KEY)');
  }

  const payload = buildDocInsightsPayload({ deal, extractions });
  const fallbackReasons = [];

  if (availability.claude) {
    try {
      const raw = await callPrimaryDocInsightsClaude(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceDocInsightsEnvelope(parsed, {
          provider: 'claude-sonnet-4-6',
          fallbackReason: null,
        });
      }
      fallbackReasons.push('Claude returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('Claude', err));
    }
  } else {
    fallbackReasons.push('Claude not configured');
  }

  if (availability.gpt_compatible) {
    try {
      const raw = await callSecondaryDocInsightsOpenAI(payload, deal);
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object') {
        return coerceDocInsightsEnvelope(parsed, {
          provider: 'gpt-5.4',
          fallbackReason: fallbackReasons.length
            ? `${fallbackReasons.join('; ')} — auto-failover succeeded on openai`
            : null,
        });
      }
      fallbackReasons.push('OpenAI returned unparseable JSON');
    } catch (err) {
      fallbackReasons.push(describeProviderError('OpenAI', err));
    }
  } else {
    fallbackReasons.push('OpenAI not configured');
  }

  return unavailable(fallbackReasons.join('; '));
};

module.exports = {
  generateDealInsights,
  generateRiskNarrative, // PR-NX43
  generateSensitivityNarrative, // PR-NX44
  generateDocumentInsights, // PR-NX45
  // Internal exports — used by the Tier-2 #14 A/B eval harness.
  SYSTEM_PROMPT,
  RISK_NARRATIVE_SYSTEM_PROMPT, // PR-NX43
  SENSITIVITY_NARRATIVE_SYSTEM_PROMPT, // PR-NX44
  DOC_INSIGHTS_SYSTEM_PROMPT, // PR-NX45
  buildPayload,
  buildRiskNarrativePayload, // PR-NX43
  buildSensitivityPayload, // PR-NX44
  buildDocInsightsPayload, // PR-NX45
  // Internal — exported for the legal-four guard regression tests.
  coerceInsightsEnvelope,
  coerceDocInsightsEnvelope,
  // Customer-export IC-opinion display policy (audit #9/#21).
  resolveCustomerIcOpinion,
};
