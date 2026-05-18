'use strict';

// Provider availability flag stays on providerRegistry (it's an SDK-presence
// check, not an LLM call). The reasoning call routes through aiRouter so it
// lands in ai_call_logs and respects the daily cost cap — the only consumer
// of Claude that previously bypassed the router.
const { getProviderAvailability } = require('./ai/providerRegistry');
const { runClaudeReasoning, runAI } = require('./ai/aiRouter');

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
    rera_registered: !!deal.rera_number,
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
- Reference only the numbers and flags provided. Never invent market rates, comps, zoning facts, legal status, or approvals.
- If a KPI is missing, say so explicitly rather than guessing.
- Be blunt about weaknesses. Investor-grade notes that only praise are useless.
- India market conventions: values in INR Crore, IRR in percent, areas in sqft.

SCHEMA:
{
  "ic_opinion": "3-5 sentence investor-grade opinion. Lead with a clear stance (proceed / proceed with conditions / pass). Cite 2-3 specific KPIs from the payload. Name one material weakness.",
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
  ic_opinion: typeof parsed.ic_opinion === 'string' ? parsed.ic_opinion.trim() : null,
  top_risks: Array.isArray(parsed.top_risks)
    ? parsed.top_risks
        .filter((r) => r && (r.title || r.detail))
        .slice(0, 5)
        .map((r) => ({
          title: String(r.title || '').trim(),
          detail: String(r.detail || '').trim(),
        }))
    : [],
  next_steps: Array.isArray(parsed.next_steps)
    ? parsed.next_steps
        .filter((s) => typeof s === 'string' && s.trim())
        .slice(0, 5)
        .map((s) => s.trim())
    : [],
  confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
    ? parsed.confidence
    : 'medium',
  disclaimer:
    'AI-generated Investor-Grade opinion based on stored deal data. Verify all facts and risks before any investment decision.',
  ...extras,
});

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

const coerceRiskNarrativeEnvelope = (parsed, extras = {}) => ({
  available: true,
  summary_paragraph: typeof parsed.summary_paragraph === 'string' ? parsed.summary_paragraph.trim() : null,
  critical_spotlight_paragraph: typeof parsed.critical_spotlight_paragraph === 'string'
    ? parsed.critical_spotlight_paragraph.trim()
    : null,
  confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
    ? parsed.confidence
    : 'medium',
  disclaimer:
    'AI-assisted risk synthesis is informational only. Verify against the structured risk register below and the deal Risk tab.',
  ...extras,
});

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
        return coerceRiskNarrativeEnvelope(parsed, {
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
        return coerceRiskNarrativeEnvelope(parsed, {
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
  // Internal exports — used by the Tier-2 #14 A/B eval harness.
  SYSTEM_PROMPT,
  RISK_NARRATIVE_SYSTEM_PROMPT, // PR-NX43
  buildPayload,
  buildRiskNarrativePayload, // PR-NX43
};
