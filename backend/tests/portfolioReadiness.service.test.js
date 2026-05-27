'use strict';

/**
 * Unit tests for portfolioReadiness.service.js — Phase 4 prologue.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const svc = require('../src/services/portfolioReadiness.service');

beforeEach(() => jest.clearAllMocks());

// ─── Per-deal scorers ───────────────────────────────────────────────────────

describe('scoreFinancialFit', () => {
  test('full kernel run (IRR + DSCR) → 25 pts', () => {
    const out = svc.scoreFinancialFit({
      irr_pct: 18.5,
      kpis: { irr: 18.5, dscr: 1.7, extras: { dscr: 1.7 } },
    });
    expect(out.score).toBe(25);
    expect(out.signal).toMatch(/kernel \+ IRR \+ DSCR/);
  });

  test('IRR only (DSCR missing) → 15 pts', () => {
    const out = svc.scoreFinancialFit({
      irr_pct: 18,
      kpis: { irr: 18 },
    });
    expect(out.score).toBe(15);
  });

  test('costs set, kernel not run → 8 pts', () => {
    const out = svc.scoreFinancialFit({ total_cost_cr: 100, kpis: null });
    expect(out.score).toBe(8);
  });

  test('no model → 0 pts', () => {
    expect(svc.scoreFinancialFit({}).score).toBe(0);
  });
});

describe('scoreDdProgress', () => {
  test('80%+ done → 25 pts', () => {
    expect(svc.scoreDdProgress({ dd_done: 16, dd_total: 16 }).score).toBe(25);
    expect(svc.scoreDdProgress({ dd_done: 8, dd_total: 10 }).score).toBe(25);
  });

  test('60-79% → 19 pts', () => {
    expect(svc.scoreDdProgress({ dd_done: 7, dd_total: 10 }).score).toBe(19);
  });

  test('30-59% → 12 pts', () => {
    expect(svc.scoreDdProgress({ dd_done: 4, dd_total: 10 }).score).toBe(12);
  });

  test('10-29% → 6 pts', () => {
    expect(svc.scoreDdProgress({ dd_done: 1, dd_total: 10 }).score).toBe(6);
  });

  test('checklist not seeded → 0', () => {
    expect(svc.scoreDdProgress({ dd_done: 0, dd_total: 0 }).score).toBe(0);
  });
});

describe('scoreApprovalsProgress', () => {
  test('90%+ Available → 20 pts', () => {
    expect(svc.scoreApprovalsProgress({ approvals_total: 10, approvals_available: 9 }).score).toBe(20);
  });

  test('60-89% → 15 pts', () => {
    expect(svc.scoreApprovalsProgress({ approvals_total: 10, approvals_available: 7 }).score).toBe(15);
  });

  test('not seeded → 0', () => {
    expect(svc.scoreApprovalsProgress({ approvals_total: 0 }).score).toBe(0);
  });
});

describe('scoreDocumentsProgress', () => {
  test('10+ docs → 15 pts', () => {
    expect(svc.scoreDocumentsProgress({ documents_count: 12 }).score).toBe(15);
  });

  test('5-9 docs → 11 pts', () => {
    expect(svc.scoreDocumentsProgress({ documents_count: 6 }).score).toBe(11);
  });

  test('0 docs → 0', () => {
    expect(svc.scoreDocumentsProgress({ documents_count: 0 }).score).toBe(0);
  });
});

describe('scoreContextSignals', () => {
  test('all three signals present → 15 pts', () => {
    const out = svc.scoreContextSignals({
      property_lat: 12.97, property_lng: 77.74,
      has_promoter: true, deal_breakers_open: 0,
    });
    expect(out.score).toBe(15);
    expect(out.signal).toMatch(/coords/);
    expect(out.signal).toMatch(/promoter recorded/);
    expect(out.signal).toMatch(/no deal-breakers/);
  });

  test('open deal-breakers drops the score', () => {
    const out = svc.scoreContextSignals({
      property_lat: 12.97, property_lng: 77.74,
      has_promoter: true, deal_breakers_open: 3,
    });
    expect(out.score).toBe(10); // 6 + 4 + 0
    expect(out.signal).toMatch(/3 deal-breakers open/);
  });

  test('no coords, no promoter, no deal-breakers → 5 pts', () => {
    const out = svc.scoreContextSignals({ deal_breakers_open: 0 });
    expect(out.score).toBe(5);
  });
});

// ─── Tier mapping ──────────────────────────────────────────────────────────

describe('tierFor', () => {
  test('≥75 → ic_ready', () => expect(svc.tierFor(80)).toBe('ic_ready'));
  test('55-74 → pre_ic', () => expect(svc.tierFor(60)).toBe('pre_ic'));
  test('35-54 → diligence', () => expect(svc.tierFor(40)).toBe('diligence'));
  test('<35 → early', () => expect(svc.tierFor(20)).toBe('early'));
});

// ─── composeDealReadiness (per-deal composer) ───────────────────────────────

describe('composeDealReadiness', () => {
  test('healthy deal → IC-ready', () => {
    const out = svc.composeDealReadiness({
      id: 'd1', name: 'Whitefield Heights', stage: 'ic_review',
      asset_class: 'residential_apartments', deal_structure: 'outright',
      property_lat: 12.97, property_lng: 77.74,
      irr_pct: 18.5, kpis: { irr: 18.5, dscr: 1.7, extras: { dscr: 1.7 } },
      total_cost_cr: 100,
      dd_total: 16, dd_done: 14,
      approvals_total: 8, approvals_available: 8,
      documents_count: 12,
      has_promoter: true,
      deal_breakers_open: 0,
    });
    expect(out.tier).toBe('ic_ready');
    expect(out.score).toBeGreaterThanOrEqual(75);
    expect(out.top_blocker).toBeNull();
  });

  test('barely-started deal → early', () => {
    const out = svc.composeDealReadiness({
      id: 'd2', name: 'New Sourcing Deal', stage: 'sourcing',
      asset_class: 'plotted_development',
      dd_total: 0, dd_done: 0,
      approvals_total: 0, approvals_available: 0,
      documents_count: 0,
      has_promoter: false,
      deal_breakers_open: 0,
    });
    expect(out.tier).toBe('early');
    expect(out.score).toBeLessThan(35);
    expect(out.top_blocker).toBe('No financial model');
  });

  test('top_blocker prioritises deal-breakers over approvals', () => {
    const out = svc.composeDealReadiness({
      id: 'd3', name: 'Stuck Deal',
      irr_pct: 18, kpis: { irr: 18, dscr: 1.7, extras: { dscr: 1.7 } },
      dd_total: 16, dd_done: 8,
      approvals_total: 0, approvals_available: 0,
      documents_count: 1,
      property_lat: 12.97, property_lng: 77.74,
      has_promoter: true,
      deal_breakers_open: 2,
    });
    expect(out.top_blocker).toMatch(/deal-breaker/);
  });
});

// ─── composePortfolio (rollup) ──────────────────────────────────────────────

describe('composePortfolio', () => {
  test('totals tally per tier', () => {
    const deals = [
      { deal_id: '1', score: 90, tier: 'ic_ready', factors: { financial: {score:25}, dd: {score:25}, approvals: {score:20}, documents: {score:15}, context: {score:15, signal:'no deal-breakers'} } },
      { deal_id: '2', score: 70, tier: 'pre_ic', factors: { financial: {score:25}, dd: {score:19}, approvals: {score:15}, documents: {score:6}, context: {score:5, signal:'no deal-breakers'} } },
      { deal_id: '3', score: 40, tier: 'diligence', factors: { financial: {score:15}, dd: {score:12}, approvals: {score:8}, documents: {score:3}, context: {score:2, signal:'no coords'} } },
      { deal_id: '4', score: 20, tier: 'early', factors: { financial: {score:0}, dd: {score:6}, approvals: {score:0}, documents: {score:0}, context: {score:0, signal:'no coords, promoter missing'} } },
    ];
    const out = svc.composePortfolio(deals);
    expect(out.totals).toEqual({ total: 4, ic_ready: 1, pre_ic: 1, diligence: 1, early: 1 });
    expect(out.average_score).toBe(55); // (90+70+40+20)/4
    expect(out.deals_count).toBe(4);
  });

  test('portfolio_blockers surface across-deal patterns sorted by severity', () => {
    const deals = [
      { deal_id: '1', factors: { financial: {score:0}, dd: {score:0}, approvals: {score:0}, documents: {score:0}, context: {score:0, signal:'no coords, promoter missing'} }, tier: 'early', score: 0 },
      { deal_id: '2', factors: { financial: {score:0}, dd: {score:0}, approvals: {score:0}, documents: {score:0}, context: {score:0, signal:'no coords, promoter missing'} }, tier: 'early', score: 0 },
      { deal_id: '3', factors: { financial: {score:0}, dd: {score:0}, approvals: {score:0}, documents: {score:0}, context: {score:0, signal:'2 deal-breakers open'} }, tier: 'early', score: 0 },
    ];
    const out = svc.composePortfolio(deals);
    // 3 deals × every blocker rule
    const noFin = out.portfolio_blockers.find((b) => b.id === 'no_financial_model');
    expect(noFin.affected_count).toBe(3);
    expect(noFin.severity).toBe('critical');
    const dealBreaker = out.portfolio_blockers.find((b) => b.id === 'open_deal_breakers');
    expect(dealBreaker.affected_count).toBe(1);
    // Severity ordering: critical before high before medium
    const severityOrder = out.portfolio_blockers.map((b) => b.severity);
    const idxCritical = severityOrder.indexOf('critical');
    const idxHigh = severityOrder.indexOf('high');
    const idxMedium = severityOrder.indexOf('medium');
    expect(idxCritical).toBeLessThan(idxHigh);
    if (idxMedium >= 0) expect(idxHigh).toBeLessThan(idxMedium);
  });

  test('top_ready surfaces highest-scoring deals', () => {
    const deals = [
      { deal_id: '1', score: 90, tier: 'ic_ready', factors: { financial:{score:25}, dd:{score:25}, approvals:{score:20}, documents:{score:15}, context:{score:5, signal: 'no deal-breakers'} } },
      { deal_id: '2', score: 80, tier: 'ic_ready', factors: { financial:{score:25}, dd:{score:25}, approvals:{score:20}, documents:{score:10}, context:{score:0, signal: 'no deal-breakers'} } },
      { deal_id: '3', score: 30, tier: 'early', factors: { financial:{score:0}, dd:{score:12}, approvals:{score:8}, documents:{score:6}, context:{score:4, signal: 'no coords'} } },
    ];
    const out = svc.composePortfolio(deals);
    expect(out.top_ready[0].deal_id).toBe('1');
    expect(out.top_ready[1].deal_id).toBe('2');
  });

  test('top_needs_attention excludes ic_ready', () => {
    const deals = [
      { deal_id: '1', score: 90, tier: 'ic_ready', factors: { financial:{score:25}, dd:{score:25}, approvals:{score:20}, documents:{score:15}, context:{score:5, signal: 'no deal-breakers'} } },
      { deal_id: '2', score: 20, tier: 'early', factors: { financial:{score:0}, dd:{score:6}, approvals:{score:0}, documents:{score:0}, context:{score:0, signal: 'no coords, promoter missing'} } },
    ];
    const out = svc.composePortfolio(deals);
    expect(out.top_needs_attention.map((d) => d.deal_id)).toEqual(['2']);
  });

  test('empty deals list → zero totals + disclaimer present', () => {
    const out = svc.composePortfolio([]);
    expect(out.totals).toEqual({ total: 0, ic_ready: 0, pre_ic: 0, diligence: 0, early: 0 });
    expect(out.average_score).toBe(0);
    expect(out.portfolio_blockers).toEqual([]);
    expect(out.disclaimer).toMatch(/organisation aid/i);
  });
});

// ─── getPortfolioReadiness (full I/O) ──────────────────────────────────────

describe('getPortfolioReadiness', () => {
  test('returns empty payload when no deals exist', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await svc.getPortfolioReadiness();
    expect(out.totals.total).toBe(0);
    expect(out.deals_count).toBe(0);
  });

  test('returns empty payload (migration-tolerant) when tables missing', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    const out = await svc.getPortfolioReadiness();
    expect(out.totals.total).toBe(0);
  });

  test('composes real per-deal rows into the portfolio rollup', async () => {
    // Service runs FIVE sequential SQL queries:
    //   1) deals + financials (LEFT JOIN, with stage filter)
    //   2) dd_items aggregate
    //   3) approval_items aggregate
    //   4) documents aggregate
    //   5) deal_promoter_profiles existence
    // Test mocks each in order.
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'd1', name: 'Whitefield Heights', stage: 'ic_review',
          asset_class: 'residential_apartments', deal_structure: 'outright',
          property_lat: 12.97, property_lng: 77.74,
          irr_pct: 18.5, kpis: { irr: 18.5, dscr: 1.7, extras: { dscr: 1.7 } },
          total_cost_cr: 100,
        },
        {
          id: 'd2', name: 'New Sourcing Deal', stage: 'sourced',
          asset_class: 'plotted_development', deal_structure: 'outright',
          property_lat: null, property_lng: null,
          irr_pct: null, kpis: null, total_cost_cr: null,
        },
      ],
    });
    // DD aggregate
    query.mockResolvedValueOnce({
      rows: [{ deal_id: 'd1', dd_done: 14, dd_total: 16, deal_breakers_open: 0 }],
    });
    // Approvals aggregate
    query.mockResolvedValueOnce({
      rows: [{ deal_id: 'd1', approvals_available: 8, approvals_total: 8 }],
    });
    // Documents aggregate
    query.mockResolvedValueOnce({
      rows: [{ deal_id: 'd1', documents_count: 12 }],
    });
    // Promoter aggregate
    query.mockResolvedValueOnce({
      rows: [{ deal_id: 'd1', has_promoter: true }],
    });

    const out = await svc.getPortfolioReadiness();
    expect(out.totals.total).toBe(2);
    expect(out.totals.ic_ready).toBe(1);
    expect(out.totals.early).toBe(1);
    expect(out.top_ready[0].deal_name).toBe('Whitefield Heights');
    // Portfolio blockers should call out the early deal
    const noFin = out.portfolio_blockers.find((b) => b.id === 'no_financial_model');
    expect(noFin.affected_count).toBe(1);
    expect(noFin.affected_deal_ids).toContain('d2');
  });

  test('returns empty payload when no deals exist (no dependent queries fire)', async () => {
    // When the deals query returns empty, we short-circuit before the
    // aggregate queries — only ONE call to query() should happen.
    query.mockResolvedValueOnce({ rows: [] });
    const out = await svc.getPortfolioReadiness();
    expect(out.totals.total).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('aggregate-query failures degrade gracefully (zeros for that signal)', async () => {
    // Deal query succeeds, but the DD aggregate fails (missing table on
    // a half-migrated environment). Service should still return the
    // deal with dd_done/dd_total = 0 instead of an empty payload.
    query.mockResolvedValueOnce({
      rows: [{
        id: 'd1', name: 'X', stage: 'screening',
        asset_class: 'residential_apartments', deal_structure: 'outright',
        property_lat: 12.97, property_lng: 77.74,
        irr_pct: 18, kpis: { irr: 18, dscr: 1.6, extras: { dscr: 1.6 } },
        total_cost_cr: 100,
      }],
    });
    query.mockRejectedValueOnce(Object.assign(new Error('missing dd_items'), { code: '42P01' }));
    // Subsequent aggregates still need mocks
    query.mockResolvedValueOnce({ rows: [] }); // approvals
    query.mockResolvedValueOnce({ rows: [] }); // documents
    query.mockResolvedValueOnce({ rows: [] }); // promoter
    const out = await svc.getPortfolioReadiness();
    expect(out.totals.total).toBe(1);
    // dd_total = 0 → dd_progress score = 0 → noFinancial blocker won't fire,
    // but dd_not_started will
    expect(out.deals[0].factors.dd.score).toBe(0);
  });
});
