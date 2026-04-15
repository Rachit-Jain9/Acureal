'use strict';

const { query } = require('../config/database');
const { getProviderAvailability, runClaudeReasoning } = require('./ai/providerRegistry');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');

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
  const result = await query('SELECT section, items FROM market_notes');
  const map = {};
  for (const row of result.rows) {
    map[row.section] = row.items;
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
  if (!getProviderAvailability().claude) return null;

  const hasNotes = notes.micro_market?.length || notes.slowdown?.length || notes.strategic?.length;

  const systemPrompt = `You are a senior buy-side real estate investment analyst at REDIP, a Bengaluru-focused real estate development intelligence platform. You report directly to the investment review team.

Your job is to generate a precise, data-driven ANALYSIS — not a summary. Cross-reference everything provided.

Rules:
- 220–280 words total, exactly 4 sections: Deal of the Day, Market Signals, Risk Signals, Strategic Takeaways
- Every claim must use specific numbers from the provided data — no generic statements
- Cross-reference internal pipeline deals against micro-market benchmarks: which deal is in the best-positioned micro-market? Which has pricing tailwind?
- Compare internal deal pricing assumptions against verified comp benchmarks where possible
- Identify which micro-markets have the strongest momentum (high YoY growth) vs. which appear soft
- Flag real risks: stale deals, IRR outliers vs. market comps, micro-markets with no internal pipeline coverage, concentration risk
- Reference actual company names, micro-markets, and specific ₹ figures — never use placeholders
- Tone: direct, institutional, investor-grade — like a GP briefing a Limited Partner
- No fluff. No markdown. Plain text paragraphs only. No bullet points.`;

  const payload = {
    internalPipeline: dealData,
    pipelineStats,
    adminNotes: hasNotes ? notes : null,
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
      quantumCr: t.quantum_inr_mn ? (t.quantum_inr_mn / 100).toFixed(0) + ' Cr' : null,
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
    return await runClaudeReasoning({
      systemPrompt,
      payload,
      maxTokens: 700,
    });
  } catch (err) {
    console.error('[Intelligence] Claude brief generation failed:', err.message);
    return null;
  }
};

// ─── BUILD BRIEF ─────────────────────────────────────────────────────────────

const buildBrief = async (briefDate) => {
  const [topDealResult, developmentsResult, marketSignalResult, benchmarksResult, recentTxResult, topCompsResult, notes] = await Promise.all([
    query(
      `SELECT d.id, d.name, d.stage, d.priority, p.city, p.property_type,
        f.irr_pct, f.total_revenue_cr, f.npv_cr, f.asset_class
       FROM deals d
       LEFT JOIN properties p ON d.property_id = p.id
       LEFT JOIN financials f ON d.id = f.deal_id
       WHERE ${buildVisibleDealCondition('d')}
       ORDER BY
         CASE WHEN LOWER(COALESCE(p.city, '')) IN ('bangalore', 'bengaluru') THEN 0 ELSE 1 END,
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
       LEFT JOIN financials f ON d.id = f.deal_id`
    ),
    query(
      `SELECT micro_market, avg_price_min_per_sqft, avg_price_max_per_sqft,
              yoy_growth_min_pct, yoy_growth_max_pct, anchor_hub, data_period
       FROM micro_market_benchmarks WHERE LOWER(city) = 'bengaluru'
       ORDER BY avg_price_max_per_sqft DESC NULLS LAST`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT fiscal_year, quarter, deal_type, buyer, quantum_inr_mn, locality, land_size_acres
       FROM market_transactions WHERE LOWER(city) = 'bengaluru'
       ORDER BY fiscal_year DESC, quarter DESC LIMIT 10`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT project_name, locality, rate_per_sqft, bhk_config, total_units
       FROM comps WHERE is_verified = TRUE AND LOWER(city) ILIKE '%bengaluru%'
       ORDER BY rate_per_sqft DESC NULLS LAST LIMIT 8`
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
  const slowdownNotes = notes.slowdown || [];
  const strategicNotes = notes.strategic || [];
  const hasManualNotes = microMarketNotes.length > 0 || slowdownNotes.length > 0 || strategicNotes.length > 0;

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
    demandSlowdownIndicators: slowdownNotes.length > 0
      ? slowdownNotes
      : [
          'Awaiting verified external transaction, inventory, and absorption sources before REDIP will publish slowdown signals.',
          deadDeals > 0
            ? 'Inactive hidden deals exist in the database — review recurring pricing, title, or diligence failures outside the live pipeline.'
            : 'No inactive dead-deal trend currently available.',
        ],
    strategicTakeaways: strategicNotes.length > 0
      ? strategicNotes
      : [
          'Use REDIP for internal pipeline discipline, underwriting workflow, and deal velocity.',
          'Connect verified Bengaluru-first data sources before relying on this brief for market-facing investment conclusions.',
        ],
    bottomLine: hasManualNotes
      ? 'This brief combines real internal pipeline data with admin-entered market observations. External verified feeds are not yet connected.'
      : 'No verified external market feeds configured — REDIP is correctly withholding market intelligence rather than fabricating it.',
  };
};

// ─── DEAL ANALYSIS ───────────────────────────────────────────────────────────

const getDealAnalysis = async (dealId) => {
  if (!getProviderAvailability().claude) {
    return { analysis: null, reason: 'ANTHROPIC_API_KEY not configured' };
  }

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
       FROM micro_market_benchmarks WHERE LOWER(city) = 'bengaluru'
       ORDER BY avg_price_max_per_sqft DESC NULLS LAST LIMIT 6`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT project_name, locality, rate_per_sqft, bhk_config, total_units
       FROM comps WHERE is_verified = TRUE AND LOWER(city) ILIKE '%bengaluru%'
       ORDER BY rate_per_sqft DESC NULLS LAST LIMIT 6`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT fiscal_year, quarter, deal_type, buyer, quantum_inr_mn, locality, land_size_acres
       FROM market_transactions WHERE LOWER(city) = 'bengaluru'
       ORDER BY fiscal_year DESC, quarter DESC LIMIT 5`
    ).catch(() => ({ rows: [] })),
  ]);

  const deal = dealResult.rows[0];
  if (!deal) return { analysis: null, reason: 'Deal not found' };

  const fin = finResult.rows[0] || null;
  const kpis = fin?.model_params?.kpis || {};

  const systemPrompt = `You are a senior real estate investment analyst at REDIP, a Bengaluru-focused platform. Your role is to generate a concise, investor-grade deal analysis.

Rules:
- 180–240 words, exactly 4 sections: Deal Overview, Market Positioning, Risk Flags, Recommendation
- Use specific numbers from the data provided — no vague statements
- Cross-reference deal pricing/IRR against market benchmarks and comps
- Flag real risks: pricing vs RLV, stage vs activity gap, comp premium/discount
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
      quantumCr: t.quantum_inr_mn ? (t.quantum_inr_mn / 100).toFixed(0) + ' Cr' : null,
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

  try {
    return {
      analysis: await runClaudeReasoning({
        systemPrompt,
        payload,
        maxTokens: 600,
      }),
      generatedAt: new Date().toISOString(),
      dealName: deal.name,
    };
  } catch (err) {
    console.error('[Intelligence] Deal analysis failed:', err.message);
    return { analysis: null, reason: err.message };
  }
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

const getDailyBrief = async (userId, date = new Date().toISOString().slice(0, 10)) => {
  const brief = await buildBrief(date);

  await query(
    `INSERT INTO intelligence_briefs (brief_date, market_scope, content, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (brief_date, market_scope)
     DO UPDATE SET content = EXCLUDED.content, created_by = EXCLUDED.created_by`,
    [date, 'bengaluru_india', brief, userId || null]
  );

  return brief;
};

const getMarketNotes = async () => {
  const result = await query('SELECT section, items, updated_at FROM market_notes');
  const notes = { micro_market: [], slowdown: [], strategic: [] };
  for (const row of result.rows) {
    if (notes[row.section] !== undefined) {
      notes[row.section] = row.items;
    }
  }
  return notes;
};

const saveMarketNotes = async (section, items, userId) => {
  const VALID_SECTIONS = ['micro_market', 'slowdown', 'strategic'];
  if (!VALID_SECTIONS.includes(section)) throw new Error(`Invalid section: ${section}`);
  if (!Array.isArray(items)) throw new Error('items must be an array');
  const cleaned = items.map((s) => String(s).trim()).filter(Boolean);

  await query(
    `INSERT INTO market_notes (section, items, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (section)
     DO UPDATE SET items = EXCLUDED.items, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [section, JSON.stringify(cleaned), userId || null]
  );

  return cleaned;
};

const getMarketTransactions = async ({ city = 'Bengaluru', fy, quarter, dealType } = {}) => {
  const conditions = [`LOWER(city) = LOWER($1)`];
  const values = [city];
  let p = 2;

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

const getMicroMarketBenchmarks = async ({ city = 'Bengaluru' } = {}) => {
  const result = await query(
    `SELECT * FROM micro_market_benchmarks
     WHERE LOWER(city) = LOWER($1)
     ORDER BY avg_price_max_per_sqft DESC NULLS LAST`,
    [city]
  );
  return result.rows;
};

module.exports = {
  getDailyBrief,
  getMarketNotes,
  saveMarketNotes,
  getMarketTransactions,
  getMicroMarketBenchmarks,
  getDealAnalysis,
};
