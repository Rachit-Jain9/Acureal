'use strict';

const { query } = require('../config/database');
const { getProviderAvailability } = require('./ai/providerRegistry');
const { runClaudeReasoning, runClaudeReasoningStream } = require('./ai/aiRouter');
const aiArtifacts = require('./aiArtifacts.service');
const numericalVerifier = require('./numericalVerifier.service');
const { getRequestContext } = require('../lib/requestContext');
const log = require('../lib/logger').child({ module: 'intelligence' });
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { getPlatformOrgId } = require('../utils/platformOrg');
const { formatQuantumCr } = require('../utils/marketUnits');
const { sanitizeAiProse } = require('../utils/aiLegalProseGuard');

const HEATMAP_MARKETS = [
  'Whitefield',
  'ORR',
  'North Bengaluru (Hebbal / Devanahalli)',
  'Sarjapur',
  'Electronic City',
  'Peripheral',
];

const VERIFIED_SOURCE_REQUIREMENTS = [
  {
    key: 'transactions',
    label: 'Verified transactions feed',
    purpose: 'Deal of the Day, pricing context, and capital-markets developments',
  },
  {
    key: 'inventory',
    label: 'Verified inventory and absorption feed',
    purpose: 'Demand heatmap, slowdown indicators, and micro-market coverage',
  },
  {
    key: 'regulatory',
    label: 'Regulatory and planning feed',
    purpose: 'Bengaluru approvals, RERA updates, zoning changes, and planning risk',
  },
];

const buildUnavailableHeatmap = () =>
  HEATMAP_MARKETS.map((market) => ({
    microMarket: market,
    absorption: 'Awaiting verified feed',
    pricingTrend: 'Not available',
    inventory: 'Awaiting verified feed',
    demandSignal: 'Awaiting verified feed',
    insight: 'No verified external data source is configured for this micro-market yet.',
  }));

const buildHeatmapFromBenchmarks = (benchmarks) => {
  if (!benchmarks || benchmarks.length === 0) return buildUnavailableHeatmap();
  return benchmarks.map((b) => {
    const growthAvg = ((Number(b.yoy_growth_min_pct) || 0) + (Number(b.yoy_growth_max_pct) || 0)) / 2;
    const demandSignal =
      growthAvg >= 10 ? 'Strong' :
      growthAvg >= 7  ? 'Moderate-High' :
      growthAvg >= 5  ? 'Moderate' : 'Soft';
    const minPr = Number(b.avg_price_min_per_sqft) || 0;
    const maxPr = Number(b.avg_price_max_per_sqft) || 0;
    return {
      microMarket: b.micro_market,
      absorption: 'Awaiting verified feed',
      pricingTrend: b.yoy_growth_min_pct != null
        ? `+${b.yoy_growth_min_pct}–${b.yoy_growth_max_pct}% YoY`
        : 'Not available',
      inventory: 'Awaiting verified feed',
      demandSignal,
      avgPriceRange: minPr && maxPr
        ? `₹${minPr.toLocaleString('en-IN')}–${maxPr.toLocaleString('en-IN')}/sqft`
        : null,
      anchorHub: b.anchor_hub || null,
      dataSource: `Verified internal benchmarks · ${b.data_period || '2025-2026'}`,
      insight: [
        b.anchor_hub ? `${b.anchor_hub} corridor.` : '',
        minPr && maxPr ? `Avg pricing ₹${(minPr / 1000).toFixed(0)}K–${(maxPr / 1000).toFixed(0)}K/sqft.` : '',
        b.yoy_growth_min_pct != null
          ? `${b.yoy_growth_min_pct}–${b.yoy_growth_max_pct}% YoY price appreciation (2025-2026).`
          : '',
        'Absorption & inventory data awaiting verified external feed.',
      ].filter(Boolean).join(' '),
    };
  });
};

const getNotesMap = async () => {
  // Read the user's own org notes AND the platform admin's notes — the
  // platform admin maintains the shared verified-market observations every
  // workspace sees. When the user IS the platform admin, the OR collapses
  // and we don't double-count.
  const platformOrgId = await getPlatformOrgId();
  const result = await query(
    `SELECT section, items FROM market_notes
     WHERE organization_id = current_organization_id() OR organization_id = $1`,
    [platformOrgId],
  );
  const map = {};
  for (const row of result.rows) {
    if (!map[row.section]) map[row.section] = [];
    if (Array.isArray(row.items)) {
      map[row.section].push(...row.items);
    }
  }
  return map;
};

// ─── CLAUDE API BRIEF GENERATION ─────────────────────────────────────────────

/**
 * Generate a Claude-powered intelligence brief.
 * Cross-references internal pipeline against market benchmarks, verified transactions, and comps.
 * Sections: Deal of the Day, Market Signals, Risk Signals, Strategic Takeaways
 */
const generateClaudeBrief = async (dealData, pipelineStats, notes, benchmarks, recentTx, topComps) => {
  // Function name retained for back-compat. The inner runClaudeReasoning
  // call is routing-aware (2026-05-11 switch to OpenAI by default).
  if (!getProviderAvailability().gpt_compatible) return null;

  // Only the micro-market admin notes feed the brief now; slowdown +
  // strategic note types were retired with their on-page sections.
  const microMarketAdminNotes = Array.isArray(notes?.micro_market) ? notes.micro_market : [];
  const hasNotes = microMarketAdminNotes.length > 0;

  const systemPrompt = `You are a senior buy-side real estate investment analyst at REDIP, a Bengaluru-focused real estate development intelligence platform. You report directly to the investment review team.

Your job is to generate a precise, data-driven ANALYSIS — not a summary. Cross-reference everything provided.

Rules:
- 200–250 words total, exactly 3 sections: Deal of the Day, Market Signals, Risk Signals
- Every claim must use specific numbers from the provided data — no generic statements
- Cross-reference internal pipeline deals against micro-market benchmarks: which deal is in the best-positioned micro-market? Which has pricing tailwind?
- Compare internal deal pricing assumptions against verified comp benchmarks where possible
- Identify which micro-markets have the strongest momentum (high YoY growth) vs. which appear soft
- Flag real risks: stale deals, IRR outliers vs. market comps, micro-markets with no internal pipeline coverage, concentration risk
- Reference actual company names, micro-markets, and specific ₹ figures — never use placeholders
- Tone: direct, institutional, investor-grade — like a GP briefing a Limited Partner
- No fluff. No markdown. Plain text paragraphs only. No bullet points.
- Do NOT include a "Strategic Takeaways" section — those were retired as generic filler.`;

  const payload = {
    internalPipeline: dealData,
    pipelineStats,
    adminNotes: hasNotes ? { micro_market: microMarketAdminNotes } : null,
    microMarketBenchmarks: (benchmarks || []).map((b) => ({
      microMarket: b.micro_market,
      priceRangePerSqft: `₹${b.avg_price_min_per_sqft}–${b.avg_price_max_per_sqft}`,
      yoyGrowthPct: `${b.yoy_growth_min_pct}–${b.yoy_growth_max_pct}%`,
      anchorHub: b.anchor_hub,
    })),
    recentMarketTransactions: (recentTx || []).slice(0, 8).map((t) => ({
      period: `${t.fiscal_year} ${t.quarter}`,
      type: t.deal_type,
      buyer: t.buyer,
      quantumCr: formatQuantumCr(t.quantum_inr_mn),
      locality: t.locality,
      landAcres: t.land_size_acres,
    })),
    topComps: (topComps || []).slice(0, 8).map((c) => ({
      project: c.project_name,
      locality: c.locality,
      ratePerSqft: c.rate_per_sqft,
      bhkConfig: c.bhk_config,
      units: c.total_units,
    })),
  };

  try {
    // Stable system prompt across daily briefs → opt into Anthropic
    // ephemeral prompt cache. The router caches reads at 0.1× input cost.
    return await runClaudeReasoning({
      task: 'market_synthesis',
      systemPrompt,
      cachePrompt: true,
      payload,
      maxTokens: 700,
      metadata: { stage: 'daily_brief' },
    });
  } catch (err) {
    log.error('claude_brief_failed', err);
    return null;
  }
};

// ─── BUILD BRIEF ─────────────────────────────────────────────────────────────

const buildBrief = async (briefDate) => {
  const platformOrgId = await getPlatformOrgId();
  const [topDealResult, developmentsResult, marketSignalResult, benchmarksResult, recentTxResult, topCompsResult, notes] = await Promise.all([
    query(
      `SELECT d.id, d.name, d.stage, d.priority, p.city, p.property_type,
        f.irr_pct, f.total_revenue_cr, f.npv_cr, f.asset_class
       FROM deals d
       LEFT JOIN properties p ON d.property_id = p.id
       LEFT JOIN financials f ON d.id = f.deal_id
       WHERE ${buildVisibleDealCondition('d')}
       ORDER BY
         CASE WHEN LOWER(COALESCE(p.city, '')) = 'bengaluru' THEN 0 ELSE 1 END,
         COALESCE(f.irr_pct, 0) DESC,
         d.updated_at DESC
       LIMIT 5`
    ),
    query(
      `SELECT a.description, a.activity_type, a.activity_date, d.name as deal_name, p.city
       FROM activities a
       LEFT JOIN deals d ON a.deal_id = d.id
       LEFT JOIN properties p ON d.property_id = p.id
       WHERE ${buildVisibleDealCondition('d')}
       ORDER BY a.activity_date DESC
       LIMIT 7`
    ),
    query(
      `SELECT
        COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage NOT IN ('closed', 'dead')) as live_deals,
        COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage = 'dead') as hidden_dead_deals,
        AVG(f.irr_pct) FILTER (WHERE d.is_archived = FALSE AND f.irr_pct IS NOT NULL) as avg_irr,
        SUM(f.total_revenue_cr) FILTER (WHERE ${buildVisibleDealCondition('d')}) as total_pipeline_cr
       FROM deals d
       LEFT JOIN financials f ON d.id = f.deal_id
       WHERE d.organization_id = current_organization_id()`
    ),
    query(
      `SELECT micro_market, avg_price_min_per_sqft, avg_price_max_per_sqft,
              yoy_growth_min_pct, yoy_growth_max_pct, anchor_hub, data_period
       FROM micro_market_benchmarks
       WHERE (organization_id = current_organization_id() OR organization_id = $1)
         AND LOWER(city) = 'bengaluru'
       ORDER BY avg_price_max_per_sqft DESC NULLS LAST`,
      [platformOrgId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT fiscal_year, quarter, deal_type, buyer, quantum_inr_mn, locality, land_size_acres
       FROM market_transactions
       WHERE (organization_id = current_organization_id() OR organization_id = $1)
         AND LOWER(city) = 'bengaluru'
       ORDER BY fiscal_year DESC, quarter DESC LIMIT 10`,
      [platformOrgId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT project_name, locality, rate_per_sqft, bhk_config, total_units
       FROM comps
       WHERE (organization_id = current_organization_id() OR organization_id = $1)
         AND is_verified = TRUE AND LOWER(city) ILIKE '%bengaluru%'
       ORDER BY rate_per_sqft DESC NULLS LAST LIMIT 8`,
      [platformOrgId],
    ).catch(() => ({ rows: [] })),
    getNotesMap(),
  ]);

  const topDeal = topDealResult.rows[0];
  const allTopDeals = topDealResult.rows;
  const signalRow = marketSignalResult.rows[0] || {};
  const liveDeals = parseInt(signalRow.live_deals, 10) || 0;
  const deadDeals = parseInt(signalRow.hidden_dead_deals, 10) || 0;
  const avgIrr = signalRow.avg_irr ? Number(signalRow.avg_irr) : null;
  const totalPipelineCr = signalRow.total_pipeline_cr ? Number(signalRow.total_pipeline_cr) : null;

  const microMarketNotes = notes.micro_market || [];
  // Demand-slowdown and strategic-takeaway notes were retired from the
  // Intelligence page (the two sections felt generic and led to
  // copy-paste fluff). Existing rows in `market_notes` for those
  // sections are intentionally ignored here so the admin-entered
  // content for them no longer leaks into any output surface.
  const hasManualNotes = microMarketNotes.length > 0;

  // Attempt Claude brief if we have meaningful data
  let claudeBrief = null;
  if (topDeal || liveDeals > 0) {
    claudeBrief = await generateClaudeBrief(
      allTopDeals.map((d) => ({
        name: d.name,
        city: d.city,
        stage: d.stage,
        priority: d.priority,
        assetClass: d.asset_class,
        irrPct: d.irr_pct,
        totalRevenueCr: d.total_revenue_cr,
        npvCr: d.npv_cr,
      })),
      { liveDeals, deadDeals, avgIrrPct: avgIrr, totalPipelineCr },
      notes,
      benchmarksResult.rows,
      recentTxResult.rows,
      topCompsResult.rows,
    );
  }

  return {
    title: `Daily Real Estate Intelligence Brief — ${briefDate}`,
    generatedDate: briefDate,
    mode: 'verified_data_required',
    hasVerifiedMarketData: false,
    hasManualNotes,
    claudeBrief,
    notes: 'REDIP will not generate external market claims until verified data sources are connected. Sections below reflect real internal pipeline data, admin-entered observations, or an explicit not-configured state.',
    verifiedSourceRequirements: VERIFIED_SOURCE_REQUIREMENTS,
    dealOfDay: topDeal
      ? {
          headline: topDeal.name,
          city: topDeal.city || 'Unknown city',
          stage: topDeal.stage,
          irrPct: topDeal.irr_pct,
          totalRevenueCr: topDeal.total_revenue_cr,
          assetClass: topDeal.asset_class,
          whyItMatters: 'Strongest live opportunity in the current REDIP pipeline based on available modeled returns.',
        }
      : null,
    keyDevelopments: developmentsResult.rows.map((entry) => ({
      headline: `${entry.deal_name || 'Pipeline activity'} — ${entry.activity_type.replace(/_/g, ' ')}`,
      city: entry.city || 'Unknown city',
      date: entry.activity_date,
      whyItMatters: entry.description,
      sourceType: 'internal_pipeline',
    })),
    marketSignals: {
      bullish: liveDeals > 0
        ? [
            `${liveDeals} live internal deal${liveDeals !== 1 ? 's' : ''} currently active in REDIP.`,
            avgIrr !== null
              ? `Average modeled IRR across live pipeline: ${avgIrr.toFixed(1)}%.`
              : 'IRR coverage incomplete across live pipeline.',
            totalPipelineCr ? `Total tracked pipeline value: ₹${totalPipelineCr.toFixed(1)} Cr.` : null,
          ].filter(Boolean)
        : ['No live opportunities currently tracked in REDIP.'],
      risk: [
        deadDeals > 0
          ? `${deadDeals} inactive deal${deadDeals !== 1 ? 's remain' : ' remains'} hidden from pipeline views — review sourcing quality and archive hygiene separately.`
          : 'No inactive dead deals are currently hidden from the pipeline.',
        'Verified external Bengaluru market feeds not configured — REDIP is intentionally withholding market-level pricing and demand claims.',
      ],
      sourceType: 'internal_pipeline_only',
    },
    bengaluruMicroMarketIntelligence: microMarketNotes,
    bengaluruDemandHeatmap: buildHeatmapFromBenchmarks(benchmarksResult.rows),
    // demandSlowdownIndicators + strategicTakeaways retired (PR-NX*) —
    // the two sections produced generic, repetitive copy that didn't
    // earn their place on the page. Removed from both the brief payload
    // and the rendered IntelligencePage.
    bottomLine: hasManualNotes
      ? 'This brief combines real internal pipeline data with admin-entered market observations. External verified feeds are not yet connected.'
      : 'No verified external market feeds configured — REDIP is correctly withholding market intelligence rather than fabricating it.',
  };
};

// ─── DEAL ANALYSIS ───────────────────────────────────────────────────────────

// Builds the system prompt + Claude payload for the per-deal analysis.
// Extracted out of getDealAnalysis so streamDealAnalysis can reuse the same
// data-assembly without duplicating five Postgres queries — keeps the two
// paths producing identical analyses.
const buildDealAnalysisInput = async (dealId) => {
  const platformOrgId = await getPlatformOrgId();
  const [dealResult, finResult, benchmarksResult, compsResult, txResult] = await Promise.all([
    query(
      `SELECT d.id, d.name, d.stage, d.priority, d.deal_type, d.notes,
              d.land_ask_price_cr, d.negotiated_price_cr, d.land_pricing_basis,
              d.land_price_rate_inr, d.land_extent_input_value, d.land_extent_input_unit,
              p.city, p.address, p.property_type, p.land_area_sqft, p.land_area_acres,
              p.zoning, p.circle_rate_per_sqft
       FROM deals d
       LEFT JOIN properties p ON d.property_id = p.id
       WHERE d.id = $1
         AND ${buildVisibleDealCondition('d')}`,
      [dealId]
    ),
    query(
      `SELECT asset_class, irr_pct, npv_cr, residual_land_value_cr, equity_multiple,
              gross_margin_pct, total_cost_cr, total_revenue_cr, model_params
       FROM financials WHERE deal_id = $1`,
      [dealId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT micro_market, avg_price_min_per_sqft, avg_price_max_per_sqft,
              yoy_growth_min_pct, yoy_growth_max_pct, anchor_hub
       FROM micro_market_benchmarks
       WHERE (organization_id = current_organization_id() OR organization_id = $1)
         AND LOWER(city) = 'bengaluru'
       ORDER BY avg_price_max_per_sqft DESC NULLS LAST LIMIT 6`,
      [platformOrgId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT project_name, locality, rate_per_sqft, bhk_config, total_units
       FROM comps
       WHERE (organization_id = current_organization_id() OR organization_id = $1)
         AND is_verified = TRUE AND LOWER(city) ILIKE '%bengaluru%'
       ORDER BY rate_per_sqft DESC NULLS LAST LIMIT 6`,
      [platformOrgId],
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT fiscal_year, quarter, deal_type, buyer, quantum_inr_mn, locality, land_size_acres
       FROM market_transactions
       WHERE (organization_id = current_organization_id() OR organization_id = $1)
         AND LOWER(city) = 'bengaluru'
       ORDER BY fiscal_year DESC, quarter DESC LIMIT 5`,
      [platformOrgId],
    ).catch(() => ({ rows: [] })),
  ]);

  const deal = dealResult.rows[0];
  if (!deal) return { error: 'Deal not found' };

  const fin = finResult.rows[0] || null;
  const kpis = fin?.model_params?.kpis || {};

  const systemPrompt = `You are a senior real estate investment analyst at REDIP, a Bengaluru-focused platform. Your role is to generate a concise, investor-grade deal analysis.

Rules:
- 180–240 words, exactly 4 sections: Deal Overview, Market Positioning, Risk Flags, Recommendation
- Use specific numbers from the data provided — no vague statements
- Cross-reference deal pricing/IRR against market benchmarks and comps
- Flag real risks: pricing vs RLV, stage vs activity gap, comp premium/discount
- LEGAL CARVE-OUT (non-negotiable): treat the zoning field as an opaque label. Never interpret it or assert any statutory, approval, RERA, title, or encumbrance conclusion ("zoning permits…", "RERA-compliant", "title is clear", "approval will be granted"). If a legal topic is material to a risk, name it only as an item requiring human verification.
- Tone: direct, institutional — like a senior analyst briefing the investment review team
- No markdown. No bullets. Plain text paragraphs only.`;

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
      zoning: deal.zoning,
      circleRatePerSqft: deal.circle_rate_per_sqft,
      landAskPriceCr: deal.land_ask_price_cr,
      negotiatedPriceCr: deal.negotiated_price_cr,
      notes: deal.notes,
    },
    financials: fin ? {
      assetClass: fin.asset_class,
      irrPct: fin.irr_pct ?? kpis.irr,
      npvCr: fin.npv_cr ?? kpis.npv,
      rlvCr: fin.residual_land_value_cr ?? kpis.rlv,
      equityMultiple: fin.equity_multiple ?? kpis.equityMultiple,
      grossMarginPct: fin.gross_margin_pct,
      totalCostCr: fin.total_cost_cr,
      totalRevenueCr: fin.total_revenue_cr,
    } : null,
    marketBenchmarks: benchmarksResult.rows.map((b) => ({
      microMarket: b.micro_market,
      priceRange: `₹${b.avg_price_min_per_sqft}–${b.avg_price_max_per_sqft}/sqft`,
      yoyGrowth: `${b.yoy_growth_min_pct}–${b.yoy_growth_max_pct}%`,
      anchorHub: b.anchor_hub,
    })),
    recentTransactions: txResult.rows.map((t) => ({
      period: `${t.fiscal_year} ${t.quarter}`,
      buyer: t.buyer,
      quantumCr: formatQuantumCr(t.quantum_inr_mn),
      locality: t.locality,
      landAcres: t.land_size_acres,
    })),
    comps: compsResult.rows.map((c) => ({
      project: c.project_name,
      locality: c.locality,
      ratePerSqft: c.rate_per_sqft,
      bhkConfig: c.bhk_config,
    })),
  };

  return { systemPrompt, payload, dealName: deal.name };
};

const getDealAnalysis = async (dealId) => {
  if (!getProviderAvailability().gpt_compatible) {
    return { analysis: null, reason: 'OPENAI_API_KEY not configured' };
  }
  const input = await buildDealAnalysisInput(dealId);
  if (input.error) return { analysis: null, reason: input.error };

  try {
    // Stable system prompt across per-deal analyses → cache it.
    const raw = await runClaudeReasoning({
      task: 'reasoning',
      systemPrompt: input.systemPrompt,
      cachePrompt: true,
      payload: input.payload,
      maxTokens: 600,
      attach: { dealId },
      metadata: { stage: 'deal_analysis' },
    });
    // Deterministic legal-four + absolute-verb backstop before the prose reaches
    // the Overview (defense-in-depth behind the prompt's legal carve-out).
    const guard = sanitizeAiProse(typeof raw === 'string' ? raw : '');
    if (typeof raw === 'string' && guard.flagged) {
      log.warn('deal_analysis_prose_sanitized', {
        deal_id: dealId, stance_rewritten: guard.stanceRewritten, legal_removed: guard.legalRemoved,
      });
    }
    return {
      analysis: typeof raw === 'string' ? guard.text : raw,
      generatedAt: new Date().toISOString(),
      dealName: input.dealName,
    };
  } catch (err) {
    log.error('deal_analysis_failed', err, { deal_id: dealId });
    return { analysis: null, reason: err.message };
  }
};

// Returns the most recent persisted deal-analysis artifact for a deal,
// optionally filtered by snapshot hash. Returns null on miss / fail.
// Used by the deal Overview tab on mount so the user sees the last
// generated analysis without re-running Claude on every page open.
const getCachedDealAnalysis = async (dealId) => {
  return aiArtifacts.getLatestArtifact({
    dealId,
    artifactType: 'deal_analysis',
  });
};

// Streaming variant of getDealAnalysis. Same data assembly + same prompt;
// only the Claude call is replaced with the streaming runner. On
// completion, persists the full text into ai_artifacts so subsequent
// fetches via getCachedDealAnalysis return instantly. Caller (the SSE
// route) supplies callbacks invoked as text arrives + when done.
//
// Usage:
//   const stream = await streamDealAnalysis(dealId);
//   if (stream.error) { res.status(404)... return; }
//   stream.onText((delta) => res.write(`data: ${JSON.stringify({type:'text',text:delta})}\n\n`));
//   try {
//     const final = await stream.done();
//     res.write(`data: ${JSON.stringify({type:'done', ...final})}\n\n`);
//   } catch (err) {
//     res.write(`data: ${JSON.stringify({type:'error',message:err.message})}\n\n`);
//   }
//   res.end();
const streamDealAnalysis = async (dealId) => {
  if (!getProviderAvailability().gpt_compatible) {
    return { error: 'OPENAI_API_KEY not configured', status: 503 };
  }
  const input = await buildDealAnalysisInput(dealId);
  if (input.error) return { error: input.error, status: 404 };

  // Snapshot hash from the assembly payload — change in inputs (financials
  // shift, comp added) invalidates the cache naturally on the next fetch.
  const snapshotHash = aiArtifacts.computeSnapshotHash({
    systemPrompt: input.systemPrompt,
    payload: input.payload,
  });

  const stream = await runClaudeReasoningStream({
    task: 'reasoning',
    systemPrompt: input.systemPrompt,
    cachePrompt: true,
    payload: input.payload,
    maxTokens: 600,
    attach: { dealId },
    metadata: { stage: 'deal_analysis', snapshot_hash: snapshotHash },
  });

  return {
    onText: stream.onText,
    abort: stream.abort,
    callIdPromise: stream.callIdPromise,
    dealName: input.dealName,
    async done() {
      const final = await stream.done();
      // Deterministic legal-four + absolute-verb backstop applied ONCE to the
      // assembled text, so the numerical verifier, the persisted artifact, and
      // the 'done' frame all see the scrubbed prose (defense-in-depth behind the
      // prompt's legal carve-out).
      if (final && typeof final.result === 'string') {
        const guard = sanitizeAiProse(final.result);
        if (guard.flagged) {
          log.warn('deal_analysis_prose_sanitized', {
            deal_id: dealId, stance_rewritten: guard.stanceRewritten, legal_removed: guard.legalRemoved,
          });
          final.result = guard.text;
        }
      }
      // Best-effort persistence — failures here NEVER block the user-visible
      // result. saveArtifact swallows missing-table / connection errors and
      // returns null so the SSE 'done' frame still ships on time.
      const ctx = getRequestContext();
      const organizationId = ctx?.organizationId || null;
      let artifactId = null;
      let numericalDrifts = null;
      let verifiedAt = null;
      if (organizationId && final?.result) {
        // Tier-1 #3 — post-hoc numerical verifier. Builds a snapshot
        // from the same input the LLM saw, scans the narrative for
        // claimed numbers, flags drifts > 1%. Pure deterministic JS
        // (per CLAUDE.md AI-routing rule). Never auto-corrects; only
        // surfaces a list of mismatches the reviewer should look at.
        try {
          const snapshot = numericalVerifier.snapshotFromDealAnalysisInput(input);
          const verification = numericalVerifier.verifyDealAnalysis({
            contentMd: final.result,
            snapshot,
          });
          numericalDrifts = verification.drifts;
          verifiedAt = verification.verifiedAt;
        } catch (verifyErr) {
          // Verifier shouldn't ever throw, but if it does, log and
          // don't block persistence — the live narrative still ships.
          log.warn('numerical_verifier_failed', {
            error: verifyErr.message,
            deal_id: dealId,
          });
        }
        const saved = await aiArtifacts.saveArtifact({
          organizationId,
          dealId,
          artifactType: 'deal_analysis',
          contentMd: final.result,
          snapshotHash,
          generatedByCallId: final.callId,
          status: 'draft',
          numericalDrifts,
          verifiedAt,
        });
        artifactId = saved?.id || null;
      }
      return {
        ...final,
        dealName: input.dealName,
        generatedAt: new Date().toISOString(),
        artifactId,
        snapshotHash,
        numericalDrifts,
        verifiedAt,
      };
    },
  };
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

const getDailyBrief = async (userId, date = new Date().toISOString().slice(0, 10)) => {
  const brief = await buildBrief(date);

  try {
    await query(
      `INSERT INTO intelligence_briefs (organization_id, brief_date, market_scope, content, created_by)
       VALUES (current_organization_id(), $1, $2, $3, $4)
       ON CONFLICT (organization_id, brief_date, market_scope)
       DO UPDATE SET content = EXCLUDED.content, created_by = EXCLUDED.created_by`,
      [date, 'bengaluru_india', brief, userId || null]
    );
  } catch (err) {
    // If the unique constraint is missing the ON CONFLICT will fail — log and continue,
    // the brief is still generated and returned from buildBrief().
    log.warn('brief_cache_write_failed', { error: err.message });
  }

  return brief;
};

const getMarketNotes = async () => {
  const result = await query(
    'SELECT section, items, updated_at FROM market_notes WHERE organization_id = current_organization_id()'
  );
  // Demand-slowdown and strategic-takeaway notes were retired with their
  // on-page sections. Legacy rows in `market_notes` for those sections
  // are returned as empty arrays so older saved content never leaks back
  // into the UI even via the admin editor.
  const notes = { micro_market: [], slowdown: [], strategic: [] };
  for (const row of result.rows) {
    if (row.section === 'micro_market') {
      notes.micro_market = row.items;
    }
  }
  return notes;
};

const saveMarketNotes = async (section, items, userId) => {
  // Only `micro_market` is writable now — `slowdown` and `strategic`
  // were retired with their on-page sections. Attempting to save those
  // is rejected so the admin tool can't accidentally repopulate the
  // retired surfaces from another tab.
  const VALID_SECTIONS = ['micro_market'];
  if (!VALID_SECTIONS.includes(section)) throw new Error(`Invalid section: ${section}`);
  if (!Array.isArray(items)) throw new Error('items must be an array');
  const cleaned = items.map((s) => String(s).trim()).filter(Boolean);

  await query(
    `INSERT INTO market_notes (organization_id, section, items, updated_by, updated_at)
     VALUES (current_organization_id(), $1, $2, $3, NOW())
     ON CONFLICT (organization_id, section)
     DO UPDATE SET items = EXCLUDED.items, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [section, JSON.stringify(cleaned), userId || null]
  );

  return cleaned;
};

// ─── Platform-shared verified-market reads ────────────────────────────────
//
// Every benchmark / transaction / macro-KPI table is curated centrally by
// the REDIP platform admin. Every workspace — including brand-new ones —
// should see those rows alongside any per-org rows they themselves
// captured. The pattern below is the same one PR #512 introduced for the
// brief, the Comps service, and the market_notes reader:
//
//   WHERE (organization_id = current_organization_id() OR organization_id = $1)
//
// When the caller IS the platform admin, the OR collapses and rows aren't
// double-counted. `getPlatformOrgId` is lazy + process-cached so the lookup
// only fires on cold start.

const buildOrgScope = (platformOrgId, paramIndex) => {
  // Always return a parenthesised expression so callers can append further
  // ANDs without precedence surprises.
  if (platformOrgId) {
    return {
      sql: `(organization_id = current_organization_id() OR organization_id = $${paramIndex})`,
      values: [platformOrgId],
    };
  }
  return { sql: 'organization_id = current_organization_id()', values: [] };
};

const getMarketTransactions = async ({ city = 'Bengaluru', fy, quarter, dealType } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const conditions = [scope.sql];
  const values = [...scope.values];
  let p = values.length + 1;
  conditions.push(`LOWER(city) = LOWER($${p++})`);
  values.push(city);

  if (fy) { conditions.push(`fiscal_year = $${p++}`); values.push(fy); }
  if (quarter) { conditions.push(`quarter = $${p++}`); values.push(quarter); }
  if (dealType) { conditions.push(`LOWER(deal_type) = LOWER($${p++})`); values.push(dealType); }

  const result = await query(
    `SELECT * FROM market_transactions
     WHERE ${conditions.join(' AND ')}
     ORDER BY fiscal_year DESC, quarter DESC, quantum_inr_mn DESC NULLS LAST`,
    values
  );
  return result.rows;
};

const getMicroMarketBenchmarks = async ({ city = 'Bengaluru', dataType } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (dataType) {
    params.push(dataType);
    where += ` AND data_type = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM micro_market_benchmarks
     WHERE ${where}
     ORDER BY
       CASE WHEN data_type = 'listing_q1_2026' THEN 0 ELSE 1 END,
       avg_price_max_per_sqft DESC NULLS LAST`,
    params
  );
  return result.rows;
};

// Q1 2026 asset-class benchmark readers ──────────────────────────────────

const getOfficeBenchmarks = async ({ city = 'Bengaluru', levelType } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (levelType) {
    params.push(levelType);
    where += ` AND level_type = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM office_market_benchmarks
     WHERE ${where}
     ORDER BY level_type ASC,
       COALESCE(stock_weighted_rent_psf_month, grade_a_rent_high_psf_month) DESC NULLS LAST`,
    params
  );
  return result.rows;
};

const getRetailBenchmarks = async ({ city = 'Bengaluru', format } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (format) {
    params.push(format);
    where += ` AND format = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM retail_market_benchmarks
     WHERE ${where}
     ORDER BY format ASC,
       COALESCE(rent_avg_psf_month, rent_high_psf_month) DESC NULLS LAST`,
    params
  );
  return result.rows;
};

const getIndustrialBenchmarks = async ({ city = 'Bengaluru', segment } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (segment) {
    params.push(segment);
    where += ` AND segment = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM industrial_market_benchmarks
     WHERE ${where}
     ORDER BY segment ASC, submarket ASC`,
    params
  );
  return result.rows;
};

/**
 * Residential segmented benchmarks — builder floor, plotted dev, land plotted,
 * villa/house, guidance value. These are the 5 asset classes from the v0.2
 * rate-pack that don't fit micro_market_benchmarks (different units / metric).
 *
 * Filters:
 *   - city          (default Bengaluru)
 *   - assetClass    e.g. 'builder_floor' | 'plotted_development' | …
 *   - dataType      e.g. 'listing_q1_2026_v0_2' | 'guidance_q1_2026_v0_2_pending'
 *
 * Order: asset_class first (groups together in UI), then value_avg DESC so
 * premium markets sit at the top of each group.
 */
const getResidentialSegmentedBenchmarks = async ({ city = 'Bengaluru', assetClass, dataType } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (assetClass) {
    params.push(assetClass);
    where += ` AND asset_class = $${params.length}`;
  }
  if (dataType) {
    params.push(dataType);
    where += ` AND data_type = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM residential_segmented_benchmarks
     WHERE ${where}
     ORDER BY asset_class ASC,
              COALESCE(value_avg, value_high, value_low) DESC NULLS LAST,
              micro_market ASC`,
    params
  );
  return result.rows;
};

/**
 * Niche asset-class benchmarks (Tier 1 #6–#9 from the original handoff).
 *
 * Same shape as residential_segmented_benchmarks: one table, four classes,
 * (micro_market × metric × value × source × data_type). The UI uses an
 * asset_class chip filter to split the rows by class for display.
 *
 * Soft-fails to [] when the migration hasn't been applied yet (Postgres
 * 42P01 = relation does not exist) so the Intelligence page renders the
 * empty-state CTA instead of an error tile.
 *
 * Filters:
 *   - city          default 'Bengaluru'
 *   - assetClass    'coworking' | 'student_housing' | 'senior_living' | 'data_center'
 *   - dataType      e.g. 'ipc_q1_2026' | 'listing_q1_2026' | 'verified_internal'
 */
const NICHE_ASSET_CLASSES = ['coworking', 'student_housing', 'senior_living', 'data_center'];

const getNicheAssetClassBenchmarks = async ({ city = 'Bengaluru', assetClass, dataType } = {}) => {
  if (assetClass && !NICHE_ASSET_CLASSES.includes(assetClass)) {
    // Unknown class — return empty rather than 400 so the UI can pivot
    // its chip group without orchestrating a separate validation call.
    return [];
  }
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (assetClass) {
    params.push(assetClass);
    where += ` AND asset_class = $${params.length}`;
  }
  if (dataType) {
    params.push(dataType);
    where += ` AND data_type = $${params.length}`;
  }
  try {
    const result = await query(
      `SELECT * FROM niche_asset_class_benchmarks
       WHERE ${where}
       ORDER BY asset_class ASC,
                COALESCE(value_avg, value_high, value_low) DESC NULLS LAST,
                micro_market ASC`,
      params,
    );
    return result.rows;
  } catch (err) {
    // 42P01 = undefined_table — migration not applied yet.
    if (err && err.code === '42P01') return [];
    throw err;
  }
};

const getHospitalityBenchmarks = async ({ city = 'Bengaluru', segment } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (segment) {
    params.push(segment);
    where += ` AND segment = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM hospitality_market_benchmarks
     WHERE ${where}
     ORDER BY
       CASE segment
         WHEN 'citywide' THEN 0
         WHEN 'luxury' THEN 1
         WHEN 'upper_upscale' THEN 2
         WHEN 'upscale_upper_mid' THEN 3
         WHEN 'midscale_economy' THEN 4
         ELSE 5 END,
       adr_high_inr DESC NULLS LAST`,
    params
  );
  return result.rows;
};

const getMacroKpis = async ({ city = 'Bengaluru', assetClass } = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const scope = buildOrgScope(platformOrgId, 1);
  const params = [...scope.values, city];
  let where = `${scope.sql} AND LOWER(city) = LOWER($${params.length})`;
  if (assetClass) {
    params.push(assetClass);
    where += ` AND asset_class = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM market_macro_kpis
     WHERE ${where}
     ORDER BY display_order ASC, metric_label ASC`,
    params
  );
  return result.rows;
};

module.exports = {
  getDailyBrief,
  getMarketNotes,
  saveMarketNotes,
  getMarketTransactions,
  getMicroMarketBenchmarks,
  getOfficeBenchmarks,
  getRetailBenchmarks,
  getIndustrialBenchmarks,
  getHospitalityBenchmarks,
  getResidentialSegmentedBenchmarks,
  getNicheAssetClassBenchmarks,
  NICHE_ASSET_CLASSES,
  getMacroKpis,
  getDealAnalysis,
  streamDealAnalysis,
  getCachedDealAnalysis,
};
