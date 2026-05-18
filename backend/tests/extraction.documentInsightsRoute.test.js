'use strict';

// PR-NX49 (2026-05-19) — GET /deals/:dealId/document-insights route tests.

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u-1', role: 'analyst' }; next(); },
  requireAdminOrAnalyst: (_req, _res, next) => next(),
}));

jest.mock('../src/services/deal.service', () => ({ getDealById: jest.fn() }));
jest.mock('../src/services/extraction.service', () => ({
  getDealExtractions: jest.fn(),
  extractDocument: jest.fn(),
  getExtractionByDocument: jest.fn(),
  applyCorrections: jest.fn(),
}));
jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ gemini: true, claude: true, gpt_compatible: true })),
}));
jest.mock('../src/services/export.insights.service', () => ({
  generateDocumentInsights: jest.fn(),
}));

const dealService = require('../src/services/deal.service');
const extractionService = require('../src/services/extraction.service');
const { generateDocumentInsights } = require('../src/services/export.insights.service');
const extractionRoutes = require('../src/routes/extraction.routes');

const findHandler = (method, path) => {
  const layer = extractionRoutes.stack.find(
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
  await handler(req, res, (err) => { nextErr = err; });
  if (nextErr) throw nextErr;
  return result;
};

const handler = findHandler('get', '/deals/:dealId/document-insights');

beforeEach(() => {
  dealService.getDealById.mockReset();
  extractionService.getDealExtractions.mockReset();
  generateDocumentInsights.mockReset();
});

describe('PR-NX49 — GET /deals/:dealId/document-insights', () => {
  test('happy path: reshape merged-fields envelope → service-expected shape + return insights', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'residential_apartments' });
    extractionService.getDealExtractions.mockResolvedValueOnce({
      count: 2,
      extractions: [
        { id: 'e-1', document_id: 'doc-1', doc_type: 'sale_deed', fields: { owner_name: 'X' } },
        { id: 'e-2', document_id: 'doc-2', doc_type: 'ec', fields: { encumbrance: 'none' } },
      ],
    });
    generateDocumentInsights.mockResolvedValueOnce({
      available: true,
      summary_paragraph: '2 documents on file...',
      findings: [],
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
      fallbackReason: null,
    });

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.provider).toBe('claude-sonnet-4-6');
    // Verify reshape: structured_fields key maps from `fields`
    const callArgs = generateDocumentInsights.mock.calls[0][0];
    expect(callArgs.extractions).toHaveLength(2);
    expect(callArgs.extractions[0].structured_fields).toEqual({ owner_name: 'X' });
    expect(callArgs.extractions[0].provider).toBe('gemini'); // default
  });

  test('404 when deal not found', async () => {
    dealService.getDealById.mockResolvedValueOnce(null);
    extractionService.getDealExtractions.mockResolvedValueOnce({ extractions: [] });
    const res = await invoke(handler, { params: { dealId: 'd-missing' } });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Deal not found/);
    expect(generateDocumentInsights).not.toHaveBeenCalled();
  });

  test('200 with available:false when no extractions exist', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1', asset_class: 'commercial_office' });
    extractionService.getDealExtractions.mockResolvedValueOnce({ extractions: [] });
    generateDocumentInsights.mockResolvedValueOnce({
      available: false,
      reason: 'no extractions with structured_fields available',
      summary_paragraph: null,
      findings: [],
    });

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toMatch(/no extractions/);
  });

  test('handles missing extractions key on the envelope gracefully', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1' });
    extractionService.getDealExtractions.mockResolvedValueOnce({}); // no .extractions key
    generateDocumentInsights.mockResolvedValueOnce({ available: false, findings: [] });

    const res = await invoke(handler, { params: { dealId: 'd-1' } });
    expect(res.status).toBe(200);
    // Service called with empty items array
    const callArgs = generateDocumentInsights.mock.calls[0][0];
    expect(callArgs.extractions).toEqual([]);
  });

  test('service exception propagates to next()', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1' });
    extractionService.getDealExtractions.mockRejectedValueOnce(new Error('db_outage'));
    await expect(invoke(handler, { params: { dealId: 'd-1' } })).rejects.toThrow('db_outage');
  });
});
