// Mock every service the composer depends on. The workspace service is pure
// orchestration; real behaviour lives in the per-domain unit suites. These
// tests verify the payload shape and the degrade-to-null contract.

jest.mock('../src/services/deal.service');
jest.mock('../src/services/financial.service');
jest.mock('../src/services/document.service');
jest.mock('../src/services/activity.service');
jest.mock('../src/services/dd.service');
jest.mock('../src/services/risk.service');
jest.mock('../src/services/waterfall.service');
jest.mock('../src/services/microMarketIntelligence.service', () => ({
  classifyParcel: jest.fn(),
  getBriefing: jest.fn(),
}));
jest.mock('../src/services/comps.service', () => ({
  getCompsNearLocation: jest.fn(),
  // Pure mapper — use the real implementation so the asset_class → enum
  // mapping is exercised end-to-end (the slice now maps before querying).
  assetClassToProjectType: jest.requireActual('../src/services/comps.service').assetClassToProjectType,
}));

const dealService = require('../src/services/deal.service');
const financialService = require('../src/services/financial.service');
const documentService = require('../src/services/document.service');
const activityService = require('../src/services/activity.service');
const ddService = require('../src/services/dd.service');
const riskService = require('../src/services/risk.service');
const waterfallService = require('../src/services/waterfall.service');
const microMarketIntelligence = require('../src/services/microMarketIntelligence.service');
const compsService = require('../src/services/comps.service');

const dealWorkspaceService = require('../src/services/dealWorkspace.service');

const DEAL_ID = 'deal-1';

const mockDeal = () => ({
  id: DEAL_ID,
  name: 'Koramangala Premium',
  stage: 'underwriting',
  is_archived: false,
  dd_items: [{ id: 'dd-1', category: 'title', status: 'pending' }],
  approval_items: [{ id: 'app-1', name: 'Khata', is_required: true }],
  risk_flags: [{ id: 'r-1', severity: 'high', status: 'open' }],
  readiness_summary: { score: 72 },
  next_steps: [{ id: 'n-1', title: 'Verify RERA' }],
  // getDealById already loads the financials row; the composer reuses it
  // (and threads it into the scenarios/graph/audit slices) instead of a
  // redundant getFinancials re-fetch.
  financials: { deal_id: DEAL_ID, irr_pct: 18.2 },
});

const http404 = (message) => {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: every optional slice resolves to a minimal happy-path value.
  dealService.getDealById.mockResolvedValue(mockDeal());
  financialService.getFinancials.mockResolvedValue({ deal_id: DEAL_ID, irr_pct: 18.2 });
  financialService.getScenarios.mockResolvedValue({ base: {}, bull: {}, bear: {} });
  financialService.getFinancialGraph.mockResolvedValue({ nodes: [], edges: [] });
  financialService.listDealEvents.mockResolvedValue([{ id: 'e-1' }]);
  documentService.getDocuments.mockResolvedValue({ documents: [], grouped: {} });
  activityService.getActivities.mockResolvedValue([{ id: 'a-1' }]);
  ddService.getDDScore.mockResolvedValue({ score: 60 });
  riskService.getRiskScore.mockResolvedValue({ score: 40 });
  waterfallService.getWaterfall.mockResolvedValue([
    { kind: 'jda', inputs: {}, result: {} },
    { kind: 'jv', inputs: {}, result: {} },
  ]);
});

describe('dealWorkspace.service', () => {
  test('composes one payload with all domains', async () => {
    const ws = await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    expect(ws.deal.id).toBe(DEAL_ID);
    expect(ws.financial.summary.irr_pct).toBe(18.2);
    expect(ws.financial.scenarios).toEqual({ base: {}, bull: {}, bear: {} });
    expect(ws.financial.graph).toEqual({ nodes: [], edges: [] });
    expect(ws.financial.auditEvents).toEqual([{ id: 'e-1' }]);
    expect(ws.dd.items).toEqual([{ id: 'dd-1', category: 'title', status: 'pending' }]);
    expect(ws.dd.score).toEqual({ score: 60 });
    expect(ws.risk.flags).toEqual([{ id: 'r-1', severity: 'high', status: 'open' }]);
    expect(ws.risk.score).toEqual({ score: 40 });
    expect(ws.approvals).toEqual([{ id: 'app-1', name: 'Khata', is_required: true }]);
    expect(ws.documents).toEqual({ documents: [], grouped: {} });
    expect(ws.activities).toEqual([{ id: 'a-1' }]);
    expect(ws.waterfall.jda).toEqual({ kind: 'jda', inputs: {}, result: {} });
    expect(ws.waterfall.jv).toEqual({ kind: 'jv', inputs: {}, result: {} });
    expect(ws.readiness.summary).toEqual({ score: 72 });
    expect(ws.readiness.nextSteps).toEqual([{ id: 'n-1', title: 'Verify RERA' }]);
    expect(typeof ws.generatedAt).toBe('string');
  });

  test('fires all optional fetches in parallel', async () => {
    await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    // Deal read runs first (its result gates the composite).
    expect(dealService.getDealById).toHaveBeenCalledWith(DEAL_ID);
    // The composer reuses the financials row getDealById already loaded — it
    // does NOT re-fetch via getFinancials — and threads that row into the
    // scenarios / graph / audit slices so they skip their own re-fetch too.
    expect(financialService.getFinancials).not.toHaveBeenCalled();
    const finRow = { deal_id: DEAL_ID, irr_pct: 18.2 };
    expect(financialService.getScenarios).toHaveBeenCalledWith(DEAL_ID, { financialsRow: finRow });
    expect(financialService.getFinancialGraph).toHaveBeenCalledWith(DEAL_ID, { financialsRow: finRow });
    expect(financialService.listDealEvents).toHaveBeenCalledWith(DEAL_ID, { limit: 25, financialsRow: finRow });
    expect(documentService.getDocuments).toHaveBeenCalledWith(DEAL_ID);
    expect(activityService.getActivities).toHaveBeenCalledWith(DEAL_ID, {}, { limit: 50 });
    expect(ddService.getDDScore).toHaveBeenCalledWith(DEAL_ID);
    expect(riskService.getRiskScore).toHaveBeenCalledWith(DEAL_ID);
    expect(waterfallService.getWaterfall).toHaveBeenCalledWith(DEAL_ID);
  });

  test('degrades gracefully when optional slice returns 404', async () => {
    // Deal has no financials row → the financials slice is null and the
    // scenarios/graph slices 404 (no inputs to compute from).
    dealService.getDealById.mockResolvedValue({ ...mockDeal(), financials: null });
    financialService.getScenarios.mockRejectedValue(http404('Financials not found.'));
    financialService.getFinancialGraph.mockRejectedValue(http404('Financials not found.'));
    financialService.listDealEvents.mockResolvedValue([]);
    waterfallService.getWaterfall.mockResolvedValue([]);

    const ws = await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    expect(ws.deal.id).toBe(DEAL_ID);
    expect(ws.financial.summary).toBeNull();
    expect(ws.financial.scenarios).toBeNull();
    expect(ws.financial.graph).toBeNull();
    expect(ws.financial.auditEvents).toEqual([]);
    expect(ws.waterfall).toEqual({ jda: null, jv: null });
  });

  test('does not swallow core-deal failure', async () => {
    const err = new Error('Deal not found.');
    err.statusCode = 404;
    dealService.getDealById.mockRejectedValue(err);

    await expect(dealWorkspaceService.getDealWorkspace(DEAL_ID)).rejects.toThrow('Deal not found.');
  });

  test('logs but does not fail when an optional slice throws a 500', async () => {
    const boom = new Error('boom');
    boom.statusCode = 500;
    // The financials slice is now a synchronous reuse of deal.financials (it
    // can't throw), so exercise the degrade-on-500 + warn contract via a slice
    // that still calls a service: documents.
    documentService.getDocuments.mockRejectedValue(boom);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const ws = await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    expect(ws.documents).toEqual({ documents: [], grouped: {} });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[dealWorkspace] documents read failed:'),
      'boom',
    );
    warnSpy.mockRestore();
  });

  test('waterfallByKind handles unexpected non-array payloads', async () => {
    waterfallService.getWaterfall.mockResolvedValue(null);

    const ws = await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    expect(ws.waterfall).toEqual({ jda: null, jv: null });
  });

  // Regression: prior to the fix, dealSelect SQL aliased `p.lat`/`p.lng` as
  // bare `lat`/`lng` only — but dealWorkspace.service reads `property_lat` /
  // `property_lng`. The names never matched, so every deal — coordinates set
  // or not — fell into the `no_parcel_coordinates` branch. This pins the
  // contract: when `property_lat`/`property_lng` are present on the deal
  // record, the micro-market gate must call through to `classifyParcel`.
  test('routes property_lat/property_lng through to the micro-market lookup', async () => {
    dealService.getDealById.mockResolvedValueOnce({
      ...mockDeal(),
      property_lat: 12.97,
      property_lng: 77.75,
      asset_class: 'residential_apartments',
    });
    microMarketIntelligence.classifyParcel.mockResolvedValueOnce({
      locality_code: 'whitefield-east-orr',
      name: 'Whitefield',
      tier: 'prime',
      distance_km: 1.4,
      confidence: 'high',
    });
    microMarketIntelligence.getBriefing.mockResolvedValueOnce({
      locality: { locality_code: 'whitefield-east-orr', name: 'Whitefield', tier: 'prime' },
      benchmarks: [],
      demand_signals: [],
    });

    const ws = await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    expect(microMarketIntelligence.classifyParcel).toHaveBeenCalledWith(12.97, 77.75);
    expect(ws.micro_market.reason).toBeNull();
    expect(ws.micro_market.classification.locality_code).toBe('whitefield-east-orr');
  });

  test('falls back to no_parcel_coordinates when neither alias is present', async () => {
    // Belt-and-braces: the gate still fires when the deal record genuinely
    // has no coordinates. Guards against accidentally treating an unjoined
    // deal as geocoded.
    dealService.getDealById.mockResolvedValueOnce({
      ...mockDeal(),
      property_lat: null,
      property_lng: null,
    });

    const ws = await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    expect(microMarketIntelligence.classifyParcel).not.toHaveBeenCalled();
    expect(ws.micro_market.reason).toBe('no_parcel_coordinates');
  });

  // Regression: the in-app workspace must feed the recommendation engine the
  // SAME shape the DOCX/PPTX export does — kernel kpis at
  // `financial.summary.kpis` and comps at `comps.entries` — so the live deal
  // page surfaces the financial + market recommendation/deal-doctor cards
  // instead of silently omitting them.
  test('attaches kernel kpis + nearby comps to the composed workspace', async () => {
    dealService.getDealById.mockResolvedValueOnce({
      ...mockDeal(),
      property_lat: 12.97,
      property_lng: 77.75,
      asset_class: 'residential_apartments',
      // Financials row carried on the deal (as getDealById loads it); the
      // composer surfaces summary.kpis from it without a getFinancials call.
      financials: {
        deal_id: DEAL_ID,
        irr_pct: 14,
        total_revenue_cr: 100,
        model_params: { kpis: { irr: 14, equityMultiple: 1.6, revenue: 100, landCr: 30 } },
      },
    });
    compsService.getCompsNearLocation.mockResolvedValueOnce([
      { price_per_sqft: 5000, is_verified: true },
      { price_per_sqft: 5200, is_verified: true },
      { price_per_sqft: 5400, is_verified: false },
    ]);

    const ws = await dealWorkspaceService.getDealWorkspace(DEAL_ID);

    // kpis surfaced where the signal extractors read them
    expect(ws.financial.summary.kpis).toEqual({ irr: 14, equityMultiple: 1.6, revenue: 100, landCr: 30 });
    // raw row fields preserved (spread) for the frontend's other readers
    expect(ws.financial.summary.irr_pct).toBe(14);
    // comps surfaced in the extractor-expected shape
    expect(ws.comps.entries).toHaveLength(3);
    // asset_class 'residential_apartments' now maps to the valid comps.project_type enum 'residential'.
    expect(compsService.getCompsNearLocation).toHaveBeenCalledWith(12.97, 77.75, 5, 'residential');
  });
});
