'use strict';

/**
 * IC memo drafting service (Tier-2 #13).
 *
 * Generates a Claude-authored Investment Committee memo for a deal.
 * Pulls the most comprehensive context of any AI artifact Acureal produces:
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
const auditService = require('./audit.service');
const numericalVerifier = require('./numericalVerifier.service');
const { formatQuantumCr } = require('../utils/marketUnits');
// Deterministic trust-signal services (Workstreams A, B, C). The IC memo —
// Acureal's decision artifact — must be honest about what has been verified, so
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

const SYSTEM_PROMPT = `You are a senior investment committee author at Acureal, an India-first real-estate investment platform. Your job is to write an institutional-grade IC memo in markdown that an investment committee can read and act on in 5 minutes.

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
Short bullet list of outstanding diligence items. Pull from the supplied \`dd_items\` and open with the counts from \`diligence_posture.ddItems\`. Mark required-and-open items with **BLOCKER**.
- If \`diligence_posture.ddItems.recorded\` is false, write exactly: "No diligence items have been recorded for this deal — the checklist has not been started." Do NOT write that diligence is closed, complete, or clear. An empty list means UNRECORDED, never SATISFIED.
- Only describe an item as closed when its own \`status\` is "completed". Never generalise from one item to the register.

## 7. Required Approvals
List the supplied \`approval_items\` with each item's own recorded status verbatim, and open with the counts from \`diligence_posture.approvals\`.
- If \`diligence_posture.approvals.recorded\` is false, write exactly: "No approvals have been recorded for this deal." Do NOT write that approvals are received, obtained, granted, in place, or complete. An empty list means UNRECORDED, never SATISFIED.
- The ONLY permitted status words are the ones the record actually uses: pending, in_progress, validated, issue, expired. "Received", "obtained", "granted", "secured" and "in place" are forbidden — they are statutory conclusions, and they are not values this system stores.
- Write each line in the RECORDED-STATUS register, not the verdict register: "Fire NOC — recorded status: pending", never "Fire NOC has been obtained".
- If \`outstanding\` > 0, this is a yellow light at minimum.

## 8. Recommendation
Single paragraph. Lead with EXACTLY ONE stance from Acureal's closed recommendation vocabulary — and NEVER use the words approve, approval, decline, reject, buy, sell, pass, or clear: "Recommend proceeding", "Recommend proceeding subject to [conditions]", "Hold pending [specific items]", or "Re-examine [specific items]". State the conditions or items explicitly. End with a one-line capital ask: "Capital required: ₹ X Cr equity / ₹ Y Cr debt." Weigh the supplied \`verification\` block: if the financial model is assumption-led, or any Risk Radar category is flagged or unverified, a clean "Recommend proceeding" is not available — name those specific items as explicit conditions, holds, or re-examines.

RULES:
- Every number in your memo must come from the supplied data — do not invent.
- NEVER state a statutory conclusion as fact. Title chain, encumbrance, RERA registration and statutory approval are RECORD-KEEPING lanes in this memo, not findings. Write "recorded status: X" or "not recorded", never "title is clear", "the khata is valid", "the EC is nil", "RERA-registered", "DC conversion is complete", or "the OC has been received" — including in the Risk Register and the Recommendation. You may freely instruct the reader to verify, confirm, obtain or flag any of these; asserting them as settled is what is forbidden. A deterministic guard strips such sentences before this memo reaches anyone, leaving a visible redaction marker in your text, so a memo that asserts will read as damaged.
- ABSENCE IS NOT CLEARANCE. If a list is empty, a count is zero, or a field is null, that is unrecorded / not yet done — never satisfied, closed, clear or received.
- A CHECKLIST IS NOT A VERIFICATION. Failure modes listed under \`verification.riskRadar.checklistOnly\` have had their diligence checklist completed — that records that someone looked, and nothing more. It is NOT evidence that the title chain, encumbrance position, RERA registration or statutory approvals are in order. Report them as "checklist complete, statutory position not verified"; never as cleared, satisfied or in order.
- A \`verification\` block is supplied — Acureal's deterministic engines (not AI) reporting the model-confidence level, the Risk Radar posture for each failure mode, the promoter posture, and the count of analyst-relied comps. Treat it as ground truth: never contradict it, and state plainly what it shows is NOT yet verified.
- If a field is null/empty, say so explicitly ("Not yet modelled", "Pending"). Never silently omit.
- Tone: senior partner briefing the IC, not marketing copy.
- Markdown only — use proper headings, tables, and bullets.
- 700-1200 words total. Compress aggressively; this is not a prospectus.`;

/**
 * Deterministic diligence and approval posture — counted in JS, never inferred
 * by the model from the length of an array.
 *
 * WHY THIS EXISTS. The memo used to receive `dd_items: []` / `approval_items: []`
 * and a prompt that said "if everything closed, say so". An empty list is not
 * "everything closed" — it is "nothing recorded" — but nothing in the payload
 * said which, so the model resolved the ambiguity in the most flattering
 * direction. Live production memos in 2026-08 told an investment committee
 * "All required approvals have been received" and "All due diligence items have
 * been closed" for deals whose records held ZERO approval rows and ZERO
 * completed DD items. One of them listed six named approvals as Received —
 * against a database in which no approval row has ever held that status
 * (the vocabulary is pending / in_progress / validated / issue / expired;
 * "received" does not exist).
 *
 * `recorded` is the field that closes it: an explicit boolean the model cannot
 * misread, with a prompt rule bound to it. Counts come from the same rows the
 * memo lists, so the narrative and the tally cannot disagree.
 */
const OPEN_DD_STATUSES = new Set(['pending', 'in_progress', 'flagged']);
const SETTLED_APPROVAL_STATUSES = new Set(['validated']);

const buildDiligencePosture = (ddRows, approvalRows) => {
  const dd = Array.isArray(ddRows) ? ddRows : [];
  const approvals = Array.isArray(approvalRows) ? approvalRows : [];
  return {
    ddItems: {
      recorded: dd.length > 0,
      total: dd.length,
      completed: dd.filter((d) => d.status === 'completed').length,
      outstanding: dd.filter((d) => OPEN_DD_STATUSES.has(d.status)).length,
      // A required item that is not yet closed is what the memo marks BLOCKER.
      blockers: dd.filter((d) => d.is_required && OPEN_DD_STATUSES.has(d.status)).length,
    },
    approvals: {
      recorded: approvals.length > 0,
      total: approvals.length,
      validated: approvals.filter((a) => SETTLED_APPROVAL_STATUSES.has(a.status)).length,
      outstanding: approvals.filter((a) => !SETTLED_APPROVAL_STATUSES.has(a.status)).length,
    },
  };
};

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
          // `recorded` lanes are legal-four topics whose checklist is complete.
          // They ride in BOTH lists: named explicitly so the prompt can rule on
          // them, and folded into `unverified` so any downstream reader that
          // only knows the old two-list shape still cannot treat them as settled.
          checklistOnly: radar.categories
            .filter((c) => c.posture === 'recorded')
            .map((c) => c.label),
          unverified: radar.categories
            .filter((c) => c.posture === 'unverified' || c.posture === 'recorded')
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

/**
 * Deterministic computation-reference footer for the memo.
 *
 * The IC memo is Acureal's decision artifact; anchoring it to the same signed
 * kernel computation the in-app Audit tab and the DOCX/XLSX/PPTX exports quote
 * lets an IC reader ask "which run produced these numbers?" and get one exact,
 * cross-surface answer.
 *
 * This is appended AFTER the model has written the memo — the reference is
 * never placed in the AI payload. A language model asked to reproduce a hex id
 * will drift a character, which is precisely the AI-fabricated-figure failure
 * CLAUDE.md forbids. String concatenation cannot drift.
 *
 * NAMING: this is the KERNEL computation reference (audit.service's
 * outputs_hash), NOT `snapshotHash` in this file — that is the LLM
 * prompt-cache key. Two different hashes; do not print one where the other
 * belongs.
 *
 * HONESTY BOUNDARY: the reference covers the figures in the signed outputs —
 * returns, cost, revenue, area. It does NOT cover the cash-flow schedule,
 * capital stack, or sensitivity/tornado (those are replay-derivable from the
 * signed inputs, a weaker claim), and the sensitivity matrix can post-date the
 * referenced computation entirely. The copy says exactly that and no more.
 */
const composeComputationFooter = (computationRef) => {
  if (!computationRef?.ref) return '';

  const ledger = computationRef.signed
    ? "recorded in this deal's append-only, cryptographically signed computation log"
    : "recorded in this deal's append-only computation log";

  const sensitivity = computationRef.sensitivity_may_be_newer
    ? ' The sensitivity analysis was re-run after this computation, so any scenario or tornado figures may reflect newer inputs.'
    : '';

  return (
    '\n\n---\n\n'
    + `*Kernel computation \`${computationRef.ref}\` produced the committed returns, `
    + `cost, revenue and area figures in this memo; they are ${ledger}.`
    + sensitivity
    + '*\n'
  );
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
    computationRef,
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
          AND d.deleted_at IS NULL
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
    // The signed kernel computation reference — resolved here so both the
    // streaming and non-streaming paths stamp the SAME id without a second
    // query, and deliberately NOT added to the AI payload (see
    // composeComputationFooter). Best-effort: a lookup miss simply omits the
    // footer, never blocks the memo.
    auditService.getLatestComputationRef(dealId).catch(() => null),
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
    // Counted, not inferred. `recorded: false` is the state an empty array
    // used to be silently read as "all clear".
    diligence_posture: buildDiligencePosture(ddResult.rows, approvalResult.rows),
  };

  // computationRef travels ALONGSIDE the payload, never inside it — the model
  // narrates the deterministic `verification` posture but never sees the hex.
  return { systemPrompt: SYSTEM_PROMPT, payload, dealName: deal.name, computationRef };
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
  computationRef,
}) => {
  // Defense-in-depth on the closed verb dictionary (CLAUDE.md): the prompt
  // instructs the model to avoid absolute decision verbs, but neutralize any
  // that slip through before this customer-facing memo is persisted/exported.
  const neutralized = neutralizeMemoRecommendation(contentMd);
  if (neutralized !== contentMd) {
    log.warn('ic_memo_stance_verb_neutralized', { dealId });
  }

  // Numerical verification runs over the MODEL's text only — the deterministic
  // footer carries no free figures to drift, so append it after verifying.
  let drifts = null;
  let verifiedAt = null;
  try {
    const snapshot = numericalVerifier.snapshotFromDealAnalysisInput(input);
    const verification = numericalVerifier.verifyDealAnalysis({
      contentMd: neutralized,
      snapshot,
    });
    drifts = verification.drifts;
    verifiedAt = verification.verifiedAt;
  } catch (err) {
    log.warn('ic_memo_verifier_failed', { error: err.message, dealId });
  }

  // Stamp the signed computation reference deterministically. This is the
  // persisted, exportable, re-fetchable copy of the memo — so the anchor
  // travels with it everywhere the memo goes.
  const safeContentMd = neutralized + composeComputationFooter(computationRef);

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
  return { saved, drifts, verifiedAt, contentMd: safeContentMd };
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

  // NB: this is the LLM PROMPT-CACHE key (sha256 of prompt + payload), used to
  // return the cached memo until the inputs shift. It is NOT the kernel
  // computation reference stamped in the footer — that is
  // input.computationRef, from the signed deal_events log. Two different
  // hashes; never print one where the other belongs.
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
    // The persisted memo carries the deterministic computation footer; fall
    // back to the raw model text if there was no org context to persist under.
    let stampedMemo = memo;
    if (organizationId && memo) {
      const { saved, drifts: d, contentMd } = await persistMemoArtifact({
        organizationId,
        dealId,
        contentMd: memo,
        snapshotHash,
        callId: null,
        input: input.payload,
        computationRef: input.computationRef,
      });
      artifactId = saved?.id || null;
      drifts = d;
      stampedMemo = contentMd;
    }

    return {
      memo: stampedMemo,
      dealName: input.dealName,
      generatedAt: new Date().toISOString(),
      snapshotHash,
      computationRef: input.computationRef || null,
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

  // NB: this is the LLM PROMPT-CACHE key (sha256 of prompt + payload), used to
  // return the cached memo until the inputs shift. It is NOT the kernel
  // computation reference stamped in the footer — that is
  // input.computationRef, from the signed deal_events log. Two different
  // hashes; never print one where the other belongs.
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
      // The live-streamed text the client already rendered has no footer; the
      // persisted artifact does. Return the stamped copy so a client that
      // reconstructs from done() ends up on the same anchored memo a re-fetch
      // would serve.
      let stampedResult = final?.result || null;
      if (organizationId && final?.result) {
        const result = await persistMemoArtifact({
          organizationId,
          dealId,
          contentMd: final.result,
          snapshotHash,
          callId: final.callId,
          input: input.payload,
          computationRef: input.computationRef,
        });
        artifactId = result.saved?.id || null;
        drifts = result.drifts;
        verifiedAt = result.verifiedAt;
        stampedResult = result.contentMd;
      }
      return {
        ...final,
        result: stampedResult,
        dealName: input.dealName,
        generatedAt: new Date().toISOString(),
        snapshotHash,
        computationRef: input.computationRef || null,
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
  // Internal helpers exported for tests
  SYSTEM_PROMPT,
  composeComputationFooter,
  __buildDiligencePostureForTests: buildDiligencePosture,
};
