'use strict';

/**
 * Portfolio Readiness aggregator — Phase 4 prologue.
 *
 * Rolls up IC + RERA readiness signals across every live deal in the
 * caller's organisation into a single dashboard-friendly payload.
 *
 * Architecture note: composing the FULL workspace per-deal would be an
 * N+1 catastrophe (each workspace endpoint does ~12 slice composes +
 * 5-10 DB calls). Instead, this service runs ONE join-heavy SQL query
 * that pulls just the headline signals per deal:
 *
 *   - has financial model with IRR + DSCR
 *   - DD completion ratio + open deal-breakers
 *   - approvals available ratio
 *   - documents count
 *   - has parcel coordinates (proxy for micro-market briefing)
 *   - has promoter profile recorded
 *
 * Then composes a LIGHTWEIGHT per-deal readiness band in code:
 *
 *   - IC-ready    ≥75 pts on the simplified 100-pt scale
 *   - Pre-IC      ≥55
 *   - Diligence   ≥35
 *   - Early       <35
 *
 * And rolls those bands + the top portfolio-wide blockers up into the
 * dashboard payload.
 *
 * Pure SQL + pure compute. Migration-tolerant — falls back to
 * `{ deals: [], totals: {...zeros...} }` when any table is missing.
 *
 * **CLAUDE.md respected**: the simplified portfolio score is a
 * deterministic rollup over deal-level signals; never asserts "deal is
 * IC-ready" — uses the same closed verb dictionary as Pillar 5.
 */

const { query } = require('../config/database');
const { LIVE_DEAL_STAGES } = require('../constants/domain');
const log = require('../lib/logger').child({ module: 'portfolioReadiness.service' });

const PG_UNDEFINED_TABLE = '42P01';
const PG_UNDEFINED_SCHEMA = '3F000';
const isMissingTable = (err) =>
  Boolean(err) && (err.code === PG_UNDEFINED_TABLE || err.code === PG_UNDEFINED_SCHEMA);

const RERA_APPLICABLE_CLASSES = new Set([
  'residential_apartments',
  'plotted_development',
  'villas',
  'mixed_use',
  'redevelopment',
]);

// ─────────────────────────────────────────────────────────────────────────────
//  Lightweight per-deal readiness — 5 sub-scorers, summing to 100
// ─────────────────────────────────────────────────────────────────────────────

const scoreFinancialFit = (row) => {
  // 25 pts: kernel ran (IRR + DSCR present)
  const hasIrr = row.kpis?.irr != null || Number(row.irr_pct) > 0;
  const dscr = row.kpis?.extras?.dscr ?? row.kpis?.dscr;
  const hasDscr = dscr != null;
  if (hasIrr && hasDscr) return { score: 25, signal: 'kernel + IRR + DSCR' };
  if (hasIrr) return { score: 15, signal: 'IRR only, DSCR missing' };
  if (row.total_cost_cr && Number(row.total_cost_cr) > 0) return { score: 8, signal: 'cost set, kernel not run' };
  return { score: 0, signal: 'no financial model' };
};

const scoreDdProgress = (row) => {
  // 25 pts: DD score
  const total = Number(row.dd_total) || 0;
  const done = Number(row.dd_done) || 0;
  if (total === 0) return { score: 0, signal: 'DD checklist not seeded' };
  const pct = (done / total) * 100;
  if (pct >= 80) return { score: 25, signal: `DD ${Math.round(pct)}%` };
  if (pct >= 60) return { score: 19, signal: `DD ${Math.round(pct)}%` };
  if (pct >= 30) return { score: 12, signal: `DD ${Math.round(pct)}%` };
  if (pct >= 10) return { score: 6, signal: `DD ${Math.round(pct)}%` };
  return { score: 0, signal: 'DD barely started' };
};

const scoreApprovalsProgress = (row) => {
  // 20 pts: approvals available pct (assumes approvals seeded; if not
  // seeded that's a "not started" signal worth 0).
  const total = Number(row.approvals_total) || 0;
  const avail = Number(row.approvals_available) || 0;
  if (total === 0) return { score: 0, signal: 'approvals not seeded' };
  const pct = (avail / total) * 100;
  if (pct >= 90) return { score: 20, signal: `Approvals ${Math.round(pct)}% available+` };
  if (pct >= 60) return { score: 15, signal: `Approvals ${Math.round(pct)}% available+` };
  if (pct >= 30) return { score: 8, signal: `Approvals ${Math.round(pct)}% available+` };
  return { score: 2, signal: `Approvals ${Math.round(pct)}% available+` };
};

const scoreDocumentsProgress = (row) => {
  // 15 pts: documents count (rough proxy for hygiene; real check needs
  // category breakdown — out of scope for the lightweight aggregator).
  const n = Number(row.documents_count) || 0;
  if (n >= 10) return { score: 15, signal: `${n} documents` };
  if (n >= 5) return { score: 11, signal: `${n} documents` };
  if (n >= 2) return { score: 6, signal: `${n} documents` };
  if (n >= 1) return { score: 3, signal: `${n} document` };
  return { score: 0, signal: 'no documents uploaded' };
};

const scoreContextSignals = (row) => {
  // 15 pts: parcel coords (proxy for micro-market briefing) + promoter
  // posture recorded + no open deal-breakers
  let score = 0;
  const parts = [];
  const hasCoords = row.property_lat != null && row.property_lng != null;
  if (hasCoords) { score += 6; parts.push('coords'); }
  else parts.push('no coords');

  const hasPromoter = Boolean(row.has_promoter);
  if (hasPromoter) { score += 4; parts.push('promoter recorded'); }
  else parts.push('promoter missing');

  const openDealBreakers = Number(row.deal_breakers_open) || 0;
  if (openDealBreakers === 0) { score += 5; parts.push('no deal-breakers'); }
  else parts.push(`${openDealBreakers} deal-breaker${openDealBreakers > 1 ? 's' : ''} open`);

  return { score, signal: parts.join(', ') };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Per-deal composer
// ─────────────────────────────────────────────────────────────────────────────

const TIERS = Object.freeze({
  ic_ready:  { label: 'IC-ready',        min: 75, tone: 'green' },
  pre_ic:    { label: 'Pre-IC',          min: 55, tone: 'sky' },
  diligence: { label: 'Diligence-stage', min: 35, tone: 'amber' },
  early:     { label: 'Early',           min: 0,  tone: 'slate' },
});

const tierFor = (score) => {
  if (score >= 75) return 'ic_ready';
  if (score >= 55) return 'pre_ic';
  if (score >= 35) return 'diligence';
  return 'early';
};

const composeDealReadiness = (row) => {
  const f = scoreFinancialFit(row);
  const d = scoreDdProgress(row);
  const a = scoreApprovalsProgress(row);
  const docs = scoreDocumentsProgress(row);
  const ctx = scoreContextSignals(row);

  const score = f.score + d.score + a.score + docs.score + ctx.score;
  const tier = tierFor(score);

  return {
    deal_id: row.id,
    deal_name: row.name,
    stage: row.stage,
    asset_class: row.asset_class,
    deal_structure: row.deal_structure,
    score,
    tier,
    factors: {
      financial: f,
      dd:        d,
      approvals: a,
      documents: docs,
      context:   ctx,
    },
    // Top single blocker — surfaced on the dashboard list
    top_blocker:
      f.score === 0 ? 'No financial model'
      : d.score === 0 ? 'DD not started'
      : Number(row.deal_breakers_open) > 0 ? `${row.deal_breakers_open} deal-breaker${Number(row.deal_breakers_open) > 1 ? 's' : ''} open`
      : a.score === 0 ? 'Approvals not seeded'
      : docs.score === 0 ? 'No documents uploaded'
      : ctx.score < 10 ? 'Promoter / coords missing'
      : null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Portfolio-level aggregator
// ─────────────────────────────────────────────────────────────────────────────

const PORTFOLIO_BLOCKER_RULES = [
  {
    id: 'no_financial_model',
    label: 'Deals without a financial model',
    test: (deal) => deal.factors.financial.score === 0,
    severity: 'critical',
    recommended_action: 'Open the Financial tab on each affected deal and run the kernel.',
  },
  {
    id: 'dd_not_started',
    label: 'Deals with DD checklist not seeded or barely touched',
    test: (deal) => deal.factors.dd.score < 6,
    severity: 'high',
    recommended_action: 'On each affected deal\'s DD tab, click Seed Checklist and start working through the required items.',
  },
  {
    id: 'open_deal_breakers',
    label: 'Deals with open deal-breaker DD items',
    test: (deal) => /deal-breaker/i.test(deal.factors.context.signal || ''),
    severity: 'critical',
    recommended_action: 'Resolve deal-breaker items first — IC will not progress with these open.',
  },
  {
    id: 'approvals_not_seeded',
    label: 'Deals with approvals not yet seeded',
    test: (deal) => deal.factors.approvals.score === 0,
    severity: 'high',
    recommended_action: 'Open each affected deal\'s DD & Approvals tab to seed the asset-class-specific approvals list.',
  },
  {
    id: 'no_documents',
    label: 'Deals with no documents uploaded',
    test: (deal) => deal.factors.documents.score === 0,
    severity: 'medium',
    recommended_action: 'Upload at least the title deed + EC + sanctioned plan for each affected deal.',
  },
  {
    id: 'promoter_missing',
    label: 'Deals missing promoter posture',
    test: (deal) => /promoter missing/i.test(deal.factors.context.signal || ''),
    severity: 'medium',
    recommended_action: 'On the Risk tab of each affected deal, record the promoter / builder track record.',
  },
  {
    id: 'no_coords',
    label: 'Deals without parcel coordinates',
    test: (deal) => /no coords/i.test(deal.factors.context.signal || ''),
    severity: 'low',
    recommended_action: 'Set the parcel coordinates on the Parcel / Site tab to unlock micro-market intelligence + Best Use scoring.',
  },
];

const composePortfolio = (deals) => {
  const totals = {
    total: deals.length,
    ic_ready: 0,
    pre_ic: 0,
    diligence: 0,
    early: 0,
  };
  const tierAverageScore = { ic_ready: [], pre_ic: [], diligence: [], early: [] };

  for (const deal of deals) {
    totals[deal.tier] += 1;
    tierAverageScore[deal.tier].push(deal.score);
  }

  // Portfolio average score
  const allScores = deals.map((d) => d.score);
  const averageScore = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0;

  // Portfolio-wide blockers — count deals matching each rule
  const portfolio_blockers = PORTFOLIO_BLOCKER_RULES
    .map((rule) => {
      const affected = deals.filter(rule.test);
      return {
        id: rule.id,
        label: rule.label,
        severity: rule.severity,
        recommended_action: rule.recommended_action,
        affected_count: affected.length,
        affected_deal_ids: affected.map((d) => d.deal_id),
      };
    })
    .filter((b) => b.affected_count > 0)
    // Severity weight: critical 4, high 3, medium 2, low 1; tiebreak by affected_count desc
    .sort((a, b) => {
      const w = (s) => (s === 'critical' ? 4 : s === 'high' ? 3 : s === 'medium' ? 2 : 1);
      const sw = w(b.severity) - w(a.severity);
      return sw !== 0 ? sw : b.affected_count - a.affected_count;
    });

  // Top deals by readiness — top 5 IC-ready, plus 5 that need most attention
  const sortedByScore = [...deals].sort((a, b) => b.score - a.score);
  const top_ready = sortedByScore.slice(0, 5);
  const top_needs_attention = [...deals]
    .sort((a, b) => a.score - b.score) // ascending
    .filter((d) => d.tier !== 'ic_ready')
    .slice(0, 5);

  return {
    totals,
    average_score: averageScore,
    portfolio_blockers,
    top_ready,
    top_needs_attention,
    // Full per-deal readiness rows — the dashboard widget reads top_ready
    // / top_needs_attention; the Deals list page indexes by deal_id to
    // surface a per-card chip without a separate fetch. Each row carries
    // { deal_id, deal_name, stage, asset_class, deal_structure, score,
    //   tier, factors, top_blocker }.
    deals,
    deals_count: deals.length,
    disclaimer:
      'Portfolio Readiness is an aggregated organisation aid — composed deterministically ' +
      'from each deal\'s deal-team-recorded findings. It does NOT represent an Investment ' +
      'Committee verdict on any deal; only an inventory of where the deals stand on IC-prep.',
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the portfolio readiness payload for the caller's organisation.
 *
 * Args:
 *   - includeArchived (default false)
 *   - includeStages   (default ['sourcing', 'screening', 'loi', 'due_diligence',
 *                                'ic_review']; excludes 'dead' / 'closed' /
 *                                'lost' since those don't need IC prep anymore)
 *
 * Returns: { totals, average_score, portfolio_blockers, top_ready,
 *            top_needs_attention, deals: [per-deal readiness rows],
 *            deals_count, disclaimer }
 */
const getPortfolioReadiness = async ({
  includeArchived = false,
  includeStages = null,
} = {}) => {
  // Stage filter — sensible default if not provided. Uses the canonical
  // LIVE_DEAL_STAGES from constants/domain.js (every deal_stage except
  // 'closed' and 'dead') so the readiness rollup matches the rest of
  // the dashboard's "live deals" semantics.
  const stages = Array.isArray(includeStages) && includeStages.length > 0
    ? includeStages
    : LIVE_DEAL_STAGES;

  try {
    // First fetch the live deals (the cheap, RLS-scoped, enum-safe part).
    // Compare stage as text to dodge any deal_stage[] array-cast quirks
    // — the outer org-scope + is_archived guards already restrict the
    // row set; the stage filter is just for "live" semantics.
    const dealsResult = await query(
      `
      SELECT
        d.id, d.name, d.stage::text AS stage,
        d.asset_class, d.deal_structure,
        d.property_lat, d.property_lng,
        f.irr_pct, f.kpis, f.total_cost_cr
      FROM public.deals d
      LEFT JOIN public.financials f ON f.deal_id = d.id
      WHERE d.organization_id = current_organization_id()
        AND ($1::boolean OR d.is_archived = FALSE)
        AND d.stage::text = ANY($2::text[])
      ORDER BY d.created_at DESC NULLS LAST
      `,
      [includeArchived, stages],
    );

    const dealRows = dealsResult.rows || [];
    if (dealRows.length === 0) return composePortfolio([]);

    const dealIds = dealRows.map((r) => r.id);

    // Bulk-aggregate the dependent signals — DD + approvals + documents +
    // promoter profile — per deal id. Single round-trip per table; PG
    // returns rows ONLY for deal_ids that have any matching child rows.
    // We fold the results into a Map<dealId, row> for O(1) lookup.
    const safeAggregate = async (sql, params) => {
      try {
        const res = await query(sql, params);
        const m = new Map();
        for (const row of res.rows || []) m.set(row.deal_id, row);
        return m;
      } catch (innerErr) {
        log.warn('portfolio_readiness_aggregate_failed', { error: innerErr.message, sample_sql: sql.split('\n')[1] });
        return new Map(); // tolerate missing table — fall back to zeros for this signal
      }
    };

    const [ddAgg, approvalsAgg, docsAgg, promoterAgg] = await Promise.all([
      safeAggregate(
        `
        SELECT deal_id,
               COUNT(*) FILTER (WHERE status IN ('completed', 'not_applicable')) AS dd_done,
               COUNT(*) AS dd_total,
               COUNT(*) FILTER (WHERE severity = 'deal_breaker'
                                  AND status NOT IN ('completed', 'not_applicable'))
                  AS deal_breakers_open
          FROM public.dd_items
         WHERE deal_id = ANY($1::uuid[])
           AND is_required = TRUE
        GROUP BY deal_id
        `,
        [dealIds],
      ),
      safeAggregate(
        `
        SELECT deal_id,
               COUNT(*) FILTER (WHERE is_available OR is_uploaded OR is_validated)
                  AS approvals_available,
               COUNT(*) AS approvals_total
          FROM public.approval_items
         WHERE deal_id = ANY($1::uuid[])
           AND is_required = TRUE
        GROUP BY deal_id
        `,
        [dealIds],
      ),
      safeAggregate(
        `
        SELECT deal_id, COUNT(*) AS documents_count
          FROM public.documents
         WHERE deal_id = ANY($1::uuid[])
        GROUP BY deal_id
        `,
        [dealIds],
      ),
      safeAggregate(
        `
        SELECT deal_id, TRUE AS has_promoter
          FROM public.deal_promoter_profiles
         WHERE deal_id = ANY($1::uuid[])
           AND promoter_name IS NOT NULL
        `,
        [dealIds],
      ),
    ]);

    // Merge dependent signals onto each deal row, then compose.
    const merged = dealRows.map((d) => {
      const dd = ddAgg.get(d.id) || {};
      const ap = approvalsAgg.get(d.id) || {};
      const docs = docsAgg.get(d.id) || {};
      const promoter = promoterAgg.get(d.id) || {};
      return {
        ...d,
        dd_done: dd.dd_done || 0,
        dd_total: dd.dd_total || 0,
        deal_breakers_open: dd.deal_breakers_open || 0,
        approvals_available: ap.approvals_available || 0,
        approvals_total: ap.approvals_total || 0,
        documents_count: docs.documents_count || 0,
        has_promoter: Boolean(promoter.has_promoter),
      };
    });
    return composePortfolio(merged.map(composeDealReadiness));
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('portfolio_readiness_missing_table', { error: err.message });
      return composePortfolio([]);
    }
    log.warn('portfolio_readiness_query_failed', { error: err.message, code: err.code });
    return composePortfolio([]);
  }
};

module.exports = {
  // Public
  getPortfolioReadiness,
  // Pure helpers exported for tests
  composeDealReadiness,
  composePortfolio,
  scoreFinancialFit,
  scoreDdProgress,
  scoreApprovalsProgress,
  scoreDocumentsProgress,
  scoreContextSignals,
  tierFor,
  TIERS,
  PORTFOLIO_BLOCKER_RULES,
  RERA_APPLICABLE_CLASSES,
};
