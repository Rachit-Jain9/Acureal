'use strict';

/**
 * IC memo drafting service (Tier-2 #13).
 *
 * Generates a Claude-authored Investment Committee memo for a deal.
 * Pulls the most comprehensive context of any AI artifact REDIP produces:
 * deal + property + financials + risk_flags + dd_items + approvals +
 * comps + market benchmarks + recent transactions. Outputs structured
 * markdown across 8 IC-grade sections.
 *
 * Architecture:
 *   - Same data-assembly pattern as intelligence.service.js#buildDealAnalysisInput
 *     but pulls 4 additional context tables (risk_flags, dd_items,
 *     approvals, scenarios) since IC memos are a synthesis of EVERYTHING
 *     known about the deal.
 *   - Streaming variant for the SSE path — IC memos run 800-1500 tokens
 *     so streaming dramatically improves perceived latency.
 *   - Persists to ai_artifacts with artifact_type='ic_memo' and a
 *     snapshot_hash so re-fetches return cached memo until inputs shift.
 *   - Numerical verifier (Tier-1 #3) runs over the output and writes
 *     drift findings alongside the memo so IC-flagged numbers can be
 *     audited before signoff.
 *
 * Per CLAUDE.md AI-routing rule:
 *   - Claude does the narrative reasoning + synthesis.
 *   - All math (IRR derivation, sensitivities, comp-deltas) was done
 *     server-side BEFORE the LLM saw the input. The LLM only narrates.
 *   - The mandatory "AI-assisted — requires human review" disclaimer is
 *     enforced on the rendering side; the prompt also instructs the
 *     model to keep the memo grounded in the supplied data.
 */

const { query } = require('../config/database');
const { getProviderAvailability } = require('./ai/providerRegistry');
const { runClaudeReasoning, runClaudeReasoningStream } = require('./ai/aiRouter');
const aiArtifacts = require('./aiArtifacts.service');
const numericalVerifier = require('./numericalVerifier.service');
const { formatQuantumCr } = require('../utils/marketUnits');
// Deterministic trust-signal services (Workstreams A, B, C). The IC memo —
// REDIP's decision artifact — must be honest about what has been verified, so
// it is fed the same postures the workspace shows the analyst.
const riskRadarService = require('./riskRadar.service');
const modelConfidenceService = require('./modelConfidence.service');
const promoterProfileService = require('./promoterProfile.service');
const compRelianceService = require('./compReliance.service');
const { getRequestContext } = require('../lib/requestContext');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { neutralizeMemoRecommendation } = require('../utils/icStanceVerbs');
const log = require('../lib/logger').child({ module: 'icMemo' });

// ──────────────────────────────────────────────────────────────────────────
// Context assembly — pulls every primary input the IC needs.
// ──────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior investment committee author at REDIP, an India-first real-estate investment platform. Your job is to write an institutional-grade IC memo in markdown that an investment committee can read and act on in 5 minutes.

OUTPUT FORMAT — strict, in this order:

# {Deal Name} — IC Memo

## 1. Executive Summary
A single short paragraph (3-5 sentences). What it is, what it costs, what it returns, why now, what the IC is being asked to approve. End with one clause on the deal's verification posture from the supplied \`verification\` block — how much of the financial model is set for this deal vs. on benchmark defaults, and whether any Risk Radar failure mode is flagged or still unverified.

## 2. Deal Snapshot
A markdown table with: Asset Class, Stage, Land Area, Ask / Negotiated Price, Modelled IRR, NPV, Equity Multiple, Asset City. Tabular numerals. Use the supplied numbers verbatim — do not invent.

## 3. Investment Thesis
2-3 short paragraphs. Why this deal works. Cite specific market benchmarks and comps from the input. No vague language.

## 4. Underwriting Highlights
Markdown bullet list. 4-6 bullets. Each bullet is ONE specific assumption with the number AND the basis (\"₹ 18,500/sqft selling rate, in line with the Whitefield Q1 benchmark of ₹ 16,000–19,000\"). Link assumptions to the model_params and benchmarks supplied.

## 5. Risk Register
Markdown table with columns: Severity, Category, Risk, Mitigation. Pull from the supplied risk_flags. Order by severity (critical → high → medium → low). If empty, write \"No flags surfaced — schedule a manual risk review before IC.\"

## 6. DD Status
Short bullet list of outstanding diligence items. Pull from the supplied dd_items. Mark blockers with **BLOCKER**. If everything closed, say so.

## 7. Required Approvals
Pull from the supplied approval_items. State which are pending vs received. If pending count > 0, this is a yellow light at minimum.

## 8. Recommendation
Single paragraph. Lead with EXACTLY ONE stance from REDIP's closed recommendation vocabulary — and NEVER use the words approve, approval, decline, reject, buy, sell, pass, or clear: "Recommend proceeding", "Recommend proceeding subject to [conditions]", "Hold pending [specific items]", or "Re-examine [specific items]". State the conditions or items explicitly. End with a one-line capital ask: "Capital required: ₹ X Cr equity / ₹ Y Cr debt." Weigh the supplied \`verification\` block: if the financial model is assumption-led, or any Risk Radar category is flagged or unverified, a clean "Recommend proceeding" is not available — name those specific items as explicit conditions, holds, or re-examines.

RULES:
- Every number in your memo must come from the supplied data — do not invent.
- A \`verification\` block is supplied — REDIP's deterministic engines (not AI) reporting the model-confidence level, the Risk Radar posture for each failure mode, the promoter posture, and the count of analyst-relied comps. Treat it as ground truth: never contradict it, and state plainly what it shows is NOT yet verified.
- If a field is null/empty, say so explicitly ("Not yet modelled", "Pending"). Never silently omit.
- Tone: senior partner briefing the IC, not marketing copy.
- Markdown only — use proper headings, tables, and bullets.
- 700-1200 words total. Compress aggressively; this is not a prospectus.`;

/**
 * Assemble the deterministic trust posture for a deal — Workstreams A, B, C.
 *
 * The IC memo is a decision document; it must not recommend over risk the
 * platform has already flagged as unverified. This composes the same postures
 * the workspace shows the analyst — model confidence, the Risk Radar, promoter
 * execution, analyst-relied comps — into one compact block the memo author
 * treats as ground truth.
 *
 * Every signal is wrapped: a trust-service hiccup degrades that one field to
 * null, never breaks IC-memo generation. Pure deterministic data — the LLM
 * only narrates it, never computes it.
 */
const buildVerificationContext = async (dealId) => {
  const [mc, radar, promoter, reliedIds] = await Promise.all([
    modelConfidenceService.getModelConfidence(dealId).catch(() => null),
    riskRadarService.getRiskRadar(dealId).catch(() => null),
    promoterProfileService.getProfileWithAssessment(dealId).catch(() => null),
    compRelianceService.listReliedCompIds(dealId).catch(() => []),
  ]);

  const modelConfidence =
    mc && mc.available
      ? {
          confidencePct: mc.confidencePct,
          band: mc.band,
          dealSetCount: mc.dealSetCount,
          total: mc.total,
        }
      : null;

  const riskRadar =
    radar && Array.isArray(radar.categories)
      ? {
          overallPosture: radar.overall_posture,
          flagged: radar.categories.filter((c) => c.posture === 'flagged').map((c) => c.label),
          unverified: radar.categories
            .filter((c) => c.posture === 'unverified')
            .map((c) => c.label),
        }
      : null;

  const promoterPosture =
    promoter && promoter.assessment
      ? {
          posture: promoter.assessment.posture,
          recorded: promoter.assessment.summary?.recorded === true,
        }
      : null;

  return {
    modelConfidence,
    riskRadar,
    promoter: promoterPosture,
    reliedCompCount: Array.isArray(reliedIds) ? reliedIds.length : 0,
  };
};

const buildIcMemoInput = async (dealId) => {
  // Gate: deal must be visible to the user. Same RLS condition as the
  // rest of the deal-scoped queries.
  const [
    dealResult,
    finResult,
    scenariosResult,
    benchmarksResult,
    compsResult,
    txResult,
    riskResult,
    ddResult,
    approvalResult,
    verificationContext,
  ] = await Promise.all([
    query(
      `SELECT d.id, d.name, d.stage, d.priority, d.deal_type, d.notes,
              d.land_ask_price_cr, d.negotiated_price_cr, d.land_pricing_basis,
              d.land_extent_input_value, d.land_extent_input_unit,
              p.city, p.address, p.property_type, p.land_area_sqft, p.land_area_acres,
              p.zoning, p.circle_rate_per_sqft, p.permissible_fsi
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
        WHERE d.id = $1 AND ${buildVisibleDealCondition('d')}`,
      [dealId],
    ),
    query(
      `SELECT asset_class, irr_pct, npv_cr, residual_land_value_cr, equity_multiple,
              gross_margin_pct, total_cost_cr, total_revenue_cr, model_params
         FROM financials WHERE deal_id = $1`,
      [dealId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT name, irr_pct, npv_cr, total_revenue_cr, total_cost_cr
         FROM financial_scenarios WHERE deal_id = $1 ORDER BY created_at ASC LIMIT 6`,
      [dealId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT micro_market, avg_price_min_per_sqft, avg_price_max_per_sqft,
              yoy_growth_min_pct, yoy_growth_max_pct, anchor_hub
         FROM micro_market_benchmarks
        WHERE organization_id = current_organization_id() AND LOWER(city) = 'bengaluru'
        ORDER BY avg_price_max_per_sqft DESC NULLS LAST LIMIT 6`,
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT project_name, locality, rate_per_sqft, bhk_config, total_units, geocode_quality
         FROM comps
        WHERE organization_id = current_organization_id()
          AND LOWER(city) ILIKE '%bengaluru%'
        ORDER BY (geocode_quality = 'rooftop') DESC, rate_per_sqft DESC NULLS LAST
        LIMIT 8`,
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT fiscal_year, quarter, deal_type, buyer, quantum_inr_mn, locality, land_size_acres
         FROM market_transactions
        WHERE organization_id = current_organization_id() AND LOWER(city) = 'bengaluru'
        ORDER BY fiscal_year DESC, quarter DESC LIMIT 5`,
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT category, severity, title, description, mitigation, status, source
         FROM risk_flags
        WHERE deal_id = $1 AND organization_id = current_organization_id()
          AND deleted_at IS NULL
          AND status IN ('open', 'flagged', 'mitigated')
        ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                 created_at DESC
        LIMIT 30`,
      [dealId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT d.category, d.item_name, d.status, d.severity, d.is_required,
              u.name AS owner_name
         FROM dd_items d
         LEFT JOIN users u ON u.id = d.assigned_to
        WHERE d.deal_id = $1 AND d.organization_id = current_organization_id()
          AND d.status NOT IN ('done', 'na', 'completed')
        ORDER BY CASE d.severity WHEN 'critical' THEN 1 WHEN 'primary' THEN 2 ELSE 3 END,
                 d.is_required DESC,
                 d.due_date NULLS LAST
        LIMIT 20`,
      [dealId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT approval_type, name, status, issuing_authority, expiry_date, is_available
         FROM approval_items
        WHERE deal_id = $1 AND organization_id = current_organization_id()
          AND deleted_at IS NULL
        ORDER BY (status = 'pending') DESC, expiry_date NULLS LAST
        LIMIT 20`,
      [dealId],
    ).catch(() => ({ rows: [] })),
    buildVerificationContext(dealId),
  ]);

  const deal = dealResult.rows[0];
  if (!deal) return { error: 'Deal not found' };

  const fin = finResult.rows[0] || null;
  const kpis = fin?.model_params?.kpis || {};

  const payload = {
    deal: {
      name: deal.name,
      stage: deal.stage,
      priority: deal.priority,
      dealType: deal.deal_type,
      city: deal.city,
      address: deal.address,
      propertyType: deal.property_type,
      landAreaAcres: deal.land_area_acres,
      landAreaSqft: deal.land_area_sqft,
      zoning: deal.zoning,
      permissibleFsi: deal.permissible_fsi,
      circleRatePerSqft: deal.circle_rate_per_sqft,
      landAskPriceCr: deal.land_ask_price_cr,
      negotiatedPriceCr: deal.negotiated_price_cr,
      landPricingBasis: deal.land_pricing_basis,
      notes: deal.notes,
    },
    financials: fin
      ? {
          assetClass: fin.asset_class,
          irrPct: fin.irr_pct ?? kpis.irr,
          npvCr: fin.npv_cr ?? kpis.npv,
          rlvCr: fin.residual_land_value_cr ?? kpis.rlv,
          equityMultiple: fin.equity_multiple ?? kpis.equityMultiple,
          grossMarginPct: fin.gross_margin_pct,
          totalCostCr: fin.total_cost_cr,
          totalRevenueCr: fin.total_revenue_cr,
        }
      : null,
    scenarios: scenariosResult.rows.map((s) => ({
      name: s.name,
      irrPct: s.irr_pct,
      npvCr: s.npv_cr,
      totalRevenueCr: s.total_revenue_cr,
      totalCostCr: s.total_cost_cr,
    })),
    marketBenchmarks: benchmarksResult.rows.map((b) => ({
      microMarket: b.micro_market,
      priceRange: `₹${b.avg_price_min_per_sqft}–${b.avg_price_max_per_sqft}/sqft`,
      yoyGrowth: `${b.yoy_growth_min_pct}–${b.yoy_growth_max_pct}%`,
      anchorHub: b.anchor_hub,
    })),
    comps: compsResult.rows.map((c) => ({
      project: c.project_name,
      locality: c.locality,
      ratePerSqft: c.rate_per_sqft,
      bhkConfig: c.bhk_config,
      totalUnits: c.total_units,
      geocodeQuality: c.geocode_quality,
    })),
    recentTransactions: txResult.rows.map((t) => ({
      period: `${t.fiscal_year} ${t.quarter}`,
      buyer: t.buyer,
      quantumCr: formatQuantumCr(t.quantum_inr_mn),
      locality: t.locality,
      landAcres: t.land_size_acres,
    })),
    risk_flags: riskResult.rows.map((r) => ({
      category: r.category,
      severity: r.severity,
      title: r.title,
      description: r.description,
      mitigation: r.mitigation,
      status: r.status,
      source: r.source,
    })),
    dd_items: ddResult.rows.map((d) => ({
      category: d.category,
      item: d.item_name,
      status: d.status,
      severity: d.severity,
      owner: d.owner_name,
      isRequired: d.is_required,
    })),
    approval_items: approvalResult.rows.map((a) => ({
      type: a.approval_type,
      name: a.name,
      status: a.status,
      authority: a.issuing_authority,
      expiryDate: a.expiry_date,
      available: a.is_available,
    })),
    // Deterministic trust posture (Workstreams A, B, C) — the memo author
    // treats this as ground truth and cannot recommend over what it flags
    // as unverified.
    verification: verificationContext,
  };

  return { systemPrompt: SYSTEM_PROMPT, payload, dealName: deal.name };
};

// ──────────────────────────────────────────────────────────────────────────
// Generation paths — non-streaming + streaming
// ──────────────────────────────────────────────────────────────────────────

const persistMemoArtifact = async ({
  organizationId,
  dealId,
  contentMd,
  snapshotHash,
  callId,
  input,
}) => {
  // Defense-in-depth on the closed verb dictionary (CLAUDE.md): the prompt
  // instructs the model to avoid absolute decision verbs, but neutralize any
  // that slip through before this customer-facing memo is persisted/exported.
  const safeContentMd = neutralizeMemoRecommendation(contentMd);
  if (safeContentMd !== contentMd) {
    log.warn('ic_memo_stance_verb_neutralized', { dealId });
  }

  // Run the numerical verifier so IC-cited numbers are audited before
  // signoff. Drifts are written alongside the memo.
  let drifts = null;
  let verifiedAt = null;
  try {
    const snapshot = numericalVerifier.snapshotFromDealAnalysisInput(input);
    const verification = numericalVerifier.verifyDealAnalysis({
      contentMd: safeContentMd,
      snapshot,
    });
    drifts = verification.drifts;
    verifiedAt = verification.verifiedAt;
  } catch (err) {
    log.warn('ic_memo_verifier_failed', { error: err.message, dealId });
  }

  const saved = await aiArtifacts.saveArtifact({
    organizationId,
    dealId,
    artifactType: 'ic_memo',
    contentMd: safeContentMd,
    snapshotHash,
    generatedByCallId: callId,
    status: 'draft',
    numericalDrifts: drifts,
    verifiedAt,
  });
  return { saved, drifts, verifiedAt };
};

const generate = async (dealId) => {
  // Operator directive 2026-05-11: switched from Claude (Anthropic) to
  // OpenAI (GPT-5.4) due to Anthropic credit limits. `runClaudeReasoning`
  // in aiRouter is now routing-aware — dispatches to OpenAI when the
  // routing config / env var says so. Gate keeps the same shape but
  // checks for OpenAI availability.
  if (!getProviderAvailability().gpt_compatible) {
    return { memo: null, reason: 'OPENAI_API_KEY not configured' };
  }
  const input = await buildIcMemoInput(dealId);
  if (input.error) return { memo: null, reason: input.error };

  const snapshotHash = aiArtifacts.computeSnapshotHash({
    systemPrompt: input.systemPrompt,
    payload: input.payload,
  });

  try {
    const memo = await runClaudeReasoning({
      task: 'reasoning',
      systemPrompt: input.systemPrompt,
      cachePrompt: true, // 32+ KB system prompt — cache hits are very valuable
      payload: input.payload,
      maxTokens: 1800,
      attach: { dealId },
      metadata: { stage: 'ic_memo', snapshot_hash: snapshotHash },
    });

    const ctx = getRequestContext();
    const organizationId = ctx?.organizationId || null;
    let artifactId = null;
    let drifts = null;
    if (organizationId && memo) {
      const { saved, drifts: d } = await persistMemoArtifact({
        organizationId,
        dealId,
        contentMd: memo,
        snapshotHash,
        callId: null,
        input: input.payload,
      });
      artifactId = saved?.id || null;
      drifts = d;
    }

    return {
      memo,
      dealName: input.dealName,
      generatedAt: new Date().toISOString(),
      snapshotHash,
      artifactId,
      numericalDrifts: drifts,
    };
  } catch (err) {
    log.error('ic_memo_generation_failed', err, { dealId });
    return { memo: null, reason: err.message };
  }
};

// Streaming variant — same data assembly, SSE-friendly callbacks. Mirrors
// the streamDealAnalysis pattern from intelligence.service.js so the
// route handler that consumes both paths is symmetric.
const stream = async (dealId) => {
  if (!getProviderAvailability().gpt_compatible) {
    return { error: 'OPENAI_API_KEY not configured', status: 503 };
  }
  const input = await buildIcMemoInput(dealId);
  if (input.error) return { error: input.error, status: 404 };

  const snapshotHash = aiArtifacts.computeSnapshotHash({
    systemPrompt: input.systemPrompt,
    payload: input.payload,
  });

  const handle = await runClaudeReasoningStream({
    task: 'reasoning',
    systemPrompt: input.systemPrompt,
    cachePrompt: true,
    payload: input.payload,
    maxTokens: 1800,
    attach: { dealId },
    metadata: { stage: 'ic_memo', snapshot_hash: snapshotHash },
  });

  return {
    onText: handle.onText,
    abort: handle.abort,
    callIdPromise: handle.callIdPromise,
    dealName: input.dealName,
    async done() {
      const final = await handle.done();
      const ctx = getRequestContext();
      const organizationId = ctx?.organizationId || null;
      let artifactId = null;
      let drifts = null;
      let verifiedAt = null;
      if (organizationId && final?.result) {
        const result = await persistMemoArtifact({
          organizationId,
          dealId,
          contentMd: final.result,
          snapshotHash,
          callId: final.callId,
          input: input.payload,
        });
        artifactId = result.saved?.id || null;
        drifts = result.drifts;
        verifiedAt = result.verifiedAt;
      }
      return {
        ...final,
        dealName: input.dealName,
        generatedAt: new Date().toISOString(),
        snapshotHash,
        artifactId,
        numericalDrifts: drifts,
        verifiedAt,
      };
    },
  };
};

const getCached = async (dealId) =>
  aiArtifacts.getLatestArtifact({ dealId, artifactType: 'ic_memo' });

module.exports = {
  buildIcMemoInput,
  buildVerificationContext,
  generate,
  stream,
  getCached,
  // Internal helper exported for tests
  SYSTEM_PROMPT,
};
