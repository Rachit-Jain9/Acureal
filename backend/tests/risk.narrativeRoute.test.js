'use strict';

// PR-NX47 (2026-05-19) — GET /deals/:dealId/risk-narrative route tests.
//
// Live frontend consumes this endpoint to render the Claude-synthesized
// risk profile + critical-spotlight callout directly on the RiskTab —
// no DOCX download required to read the AI synthesis.
//
// We invoke the route handler directly (no supertest in repo) by
// constructing mock req/res/next and pulling the registered handler
// off the express router stack.

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u-1', role: 'analyst' }; next(); },
  requireAdminOrAnalyst: (_req, _res, next) => next(),
}));

jest.mock('../src/services/deal.service', () => ({ getDealById: jest.fn() }));
jest.mock('../src/services/risk.service', () => ({
  listByDeal: jest.fn(),
  getRiskScore: jest.fn(),
}));
jest.mock('../src/services/export.insights.service', () => ({
  generateRiskNarrative: jest.fn(),
}));
jest.mock('../src/services/inconsistencyDetector.service', () => ({}));
jest.mock('../src/services/aiArtifacts.service', () => ({}));
jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const dealService = require('../src/services/deal.service');
const riskService = require('../src/services/risk.service');
const { generateRiskNarrative } = require('../src/services/export.insights.service');
const riskRoutes = require('../src/routes/risk.routes');

// Reach into the express router stack and find the GET handler for the
// '/deals/:dealId/risk-narrative' path.
const findHandler = (method, path) => {
  const layer = riskRoutes.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} handler for ${path}`);
  // The last middleware in the stack is the actual handler (after auth chain).
  const handlerStack = layer.route.stack;
  return handlerStack[handlerStack.length - 1].handle;
};

// Build a minimal mock req/res/next that captures the final status + body.
const invoke = async (handler, { params = {}, user = { id: 'u-1', role: 'analyst' } } = {}) => {
  const req = { params, user };
  const result = { status: 200, body: null, headers: {} };
  const res = {
    status(code) { result.status = code; return res; },
    json(body) { result.body = body; return res; },
    set(k, v) { result.headers[k] = v; return res; },
  };
  let nextErr = null;
  const next = (err) => { nextErr = err; };
  await handler(req, res, next);
  if (nextErr) throw nextErr;
  return result;
};

const handler = findHandler('get', '/deals/:dealId/risk-narrative');

beforeEach(() => {
  dealService.getDealById.mockReset();
  riskService.listByDeal.mockReset();
  generateRiskNarrative.mockReset();
});

describe('PR-NX47 — GET /deals/:dealId/risk-narrative', () => {
  test('happy path: returns the narrative envelope from generateRiskNarrative', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', name: 'Test Deal', asset_class: 'residential_apartments' });
    riskService.listByDeal.mockResolvedValueOnce([
      { title: 'Conversion order pending', severity: 'critical', status: 'open' },
      { title: 'JDA escalation clause',    severity: 'high',     status: 'open' },
    ]);
    generateRiskNarrative.mockResolvedValueOnce({
      available: true,
      summary_paragraph: 'Risk profile dominated by legal exposure.',
      critical_spotlight_paragraph: 'Conversion order pending is the single dealbreaker.',
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
      fallbackReason: null,
    });

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.summary_paragraph).toMatch(/legal exposure/);
    expect(res.body.data.provider).toBe('claude-sonnet-4-6');

    expect(generateRiskNarrative).toHaveBeenCalledTimes(1);
    const callArgs = generateRiskNarrative.mock.calls[0][0];
    expect(callArgs.deal.id).toBe('d-1');
    expect(callArgs.items).toHaveLength(2);
    expect(callArgs.riskCounts).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });
  });

  test('404 when deal not visible / not found', async () => {
    dealService.getDealById.mockResolvedValueOnce(null);
    riskService.listByDeal.mockResolvedValueOnce([]);

    const res = await invoke(handler, { params: { dealId: 'd-missing' } });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Deal not found/);
    expect(generateRiskNarrative).not.toHaveBeenCalled();
  });

  test('no risks logged → returns the unavailable envelope from the service (200, not 404)', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', name: 'Test', asset_class: 'commercial_office' });
    riskService.listByDeal.mockResolvedValueOnce([]);
    generateRiskNarrative.mockResolvedValueOnce({
      available: false,
      reason: 'no risks logged',
      summary_paragraph: null,
      critical_spotlight_paragraph: null,
      confidence: null,
    });

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toMatch(/no risks logged/);
  });

  test('counts only open/flagged risks, ignoring closed/resolved/mitigated', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'residential_apartments' });
    riskService.listByDeal.mockResolvedValueOnce([
      { title: 'Open critical', severity: 'critical', status: 'open' },
      { title: 'Closed high',   severity: 'high',     status: 'closed' },
      { title: 'Resolved med',  severity: 'medium',   status: 'resolved' },
      { title: 'Mitigated low', severity: 'low',      status: 'mitigated' },
      { title: 'Flagged med',   severity: 'medium',   status: 'flagged' },
    ]);
    generateRiskNarrative.mockResolvedValueOnce({ available: true, summary_paragraph: 'ok' });

    await invoke(handler, { params: { dealId: 'd-1' } });
    const callArgs = generateRiskNarrative.mock.calls[0][0];
    // Open critical + flagged medium → 1 critical, 0 high, 1 medium
    expect(callArgs.riskCounts).toEqual({ critical: 1, high: 0, medium: 1, low: 0 });
    expect(callArgs.items).toHaveLength(5);
  });

  test('service exception propagates to next() (route error handler)', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'residential_apartments' });
    riskService.listByDeal.mockRejectedValueOnce(new Error('db_outage'));

    await expect(invoke(handler, { params: { dealId: 'd-1' } })).rejects.toThrow('db_outage');
  });
});
