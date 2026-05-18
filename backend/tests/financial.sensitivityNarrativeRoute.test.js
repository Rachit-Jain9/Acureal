'use strict';

// PR-NX48 (2026-05-19) — GET /financials/:dealId/sensitivity-narrative route tests.

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u-1', role: 'analyst' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/validate', () => ({
  handleValidation: (_req, _res, next) => next(),
}));

jest.mock('../src/services/deal.service', () => ({ getDealById: jest.fn() }));
jest.mock('../src/services/financial.service', () => ({
  getFinancials: jest.fn(),
  updateFinancials: jest.fn(),
  runSensitivity: jest.fn(),
  // Stubs for the other methods referenced by the router (calculateAndSave, etc.)
  calculateAndSave: jest.fn(),
  getDefaults: jest.fn(),
  getCurrentInputs: jest.fn(),
  getScenarios: jest.fn(),
  computeScenario: jest.fn(),
  saveScenario: jest.fn(),
  getFinancialGraph: jest.fn(),
  listDealEvents: jest.fn(),
  verifyDealEvent: jest.fn(),
  replayDealEvent: jest.fn(),
  exportCashFlowCsv: jest.fn(),
  getBulkBatch: jest.fn(),
}));
jest.mock('../src/services/export.insights.service', () => ({
  generateSensitivityNarrative: jest.fn(),
}));

const dealService = require('../src/services/deal.service');
const financialService = require('../src/services/financial.service');
const { generateSensitivityNarrative } = require('../src/services/export.insights.service');
const financialRoutes = require('../src/routes/financial.routes');

const findHandler = (method, path) => {
  const layer = financialRoutes.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} handler for ${path}`);
  const handlerStack = layer.route.stack;
  return handlerStack[handlerStack.length - 1].handle;
};

const invoke = async (handler, { params = {}, user = { id: 'u-1', role: 'analyst' } } = {}) => {
  const req = { params, user };
  const result = { status: 200, body: null };
  const res = {
    status(code) { result.status = code; return res; },
    json(body) { result.body = body; return res; },
  };
  let nextErr = null;
  const next = (err) => { nextErr = err; };
  await handler(req, res, next);
  if (nextErr) throw nextErr;
  return result;
};

const handler = findHandler('get', '/:dealId/sensitivity-narrative');

const fullGrid = () => ({
  variations: [],
  sellingRates: [7000, 7500, 8000, 8500, 9000],
  constructionCosts: [3200, 3000, 2800, 2600, 2400],
  irrGrid: [
    [12, 14, 16, 18, 20],
    [14, 16, 18, 20, 22],
    [16, 18, 20, 22, 24],
    [18, 20, 22, 24, 26],
    [20, 22, 24, 26, 28],
  ],
});

beforeEach(() => {
  dealService.getDealById.mockReset();
  financialService.getFinancials.mockReset();
  generateSensitivityNarrative.mockReset();
});

describe('PR-NX48 — GET /financials/:dealId/sensitivity-narrative', () => {
  test('happy path: returns the narrative envelope', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'residential_apartments' });
    financialService.getFinancials.mockResolvedValueOnce({
      deal_id: 'd-1',
      total_cost_cr: 100, total_revenue_cr: 140,
      sensitivity_matrix: fullGrid(),
    });
    generateSensitivityNarrative.mockResolvedValueOnce({
      available: true,
      driver_decomposition_paragraph: 'Sell rate dominates.',
      stress_test_paragraph: 'Stress 1: sell rate −10%.',
      dominant_driver: 'Sell Rate',
      confidence: 'high',
      provider: 'gpt-5.4',
      fallbackReason: null,
    });

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.dominant_driver).toBe('Sell Rate');
    expect(res.body.data.provider).toBe('gpt-5.4');
    expect(generateSensitivityNarrative).toHaveBeenCalledTimes(1);
    const callArgs = generateSensitivityNarrative.mock.calls[0][0];
    expect(callArgs.sensitivityMatrix.irrGrid).toHaveLength(5);
  });

  test('404 when deal not found', async () => {
    dealService.getDealById.mockResolvedValueOnce(null);
    financialService.getFinancials.mockResolvedValueOnce(null);
    const res = await invoke(handler, { params: { dealId: 'd-missing' } });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(generateSensitivityNarrative).not.toHaveBeenCalled();
  });

  test('200 with available:false when no financial row (no model yet)', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'commercial_office' });
    // getFinancials throws 404 when no row — soft-fail to null
    const err404 = new Error('Financials not found for this deal.');
    err404.statusCode = 404;
    financialService.getFinancials.mockRejectedValueOnce(err404);

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toMatch(/no financial model on this deal/);
    expect(generateSensitivityNarrative).not.toHaveBeenCalled();
  });

  test('parses sensitivity_matrix when stored as JSON string', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'residential_apartments' });
    financialService.getFinancials.mockResolvedValueOnce({
      deal_id: 'd-1',
      total_cost_cr: 100, total_revenue_cr: 140,
      sensitivity_matrix: JSON.stringify(fullGrid()),
    });
    generateSensitivityNarrative.mockResolvedValueOnce({ available: true });

    await invoke(handler, { params: { dealId: 'd-1' } });
    const callArgs = generateSensitivityNarrative.mock.calls[0][0];
    expect(callArgs.sensitivityMatrix.irrGrid).toHaveLength(5);
  });

  test('passes null sensitivityMatrix when raw is unparseable (service returns unavailable)', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'residential_apartments' });
    financialService.getFinancials.mockResolvedValueOnce({
      deal_id: 'd-1',
      sensitivity_matrix: 'not valid json {{{',
    });
    generateSensitivityNarrative.mockResolvedValueOnce({
      available: false,
      reason: 'insufficient sensitivity grid',
    });

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.body.data.available).toBe(false);
    const callArgs = generateSensitivityNarrative.mock.calls[0][0];
    expect(callArgs.sensitivityMatrix).toBeNull();
  });

  test('non-404 financial errors propagate (not silently swallowed)', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'residential_apartments' });
    financialService.getFinancials.mockRejectedValueOnce(new Error('db_outage'));
    await expect(invoke(handler, { params: { dealId: 'd-1' } })).rejects.toThrow('db_outage');
  });
});
