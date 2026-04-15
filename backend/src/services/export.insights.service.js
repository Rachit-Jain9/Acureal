'use strict';

const {
  getProviderAvailability,
  runClaudeReasoning,
} = require('./ai/providerRegistry');

// Hard timeout so export routes never hang on a stalled model call.
const MODEL_TIMEOUT_MS = 15000;

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

  if (!getProviderAvailability().claude) {
    return unavailable('Claude API key not configured');
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

  let raw;
  try {
    raw = await withTimeout(
      runClaudeReasoning({
        systemPrompt: SYSTEM_PROMPT,
        payload,
        maxTokens: 700,
      }),
      MODEL_TIMEOUT_MS,
      'Claude deal-insights call'
    );
  } catch (err) {
    return unavailable(`Model call failed: ${err.message}`);
  }

  const parsed = parseModelJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    return unavailable('Model returned unparseable content');
  }

  return {
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
  };
};

module.exports = {
  generateDealInsights,
};
