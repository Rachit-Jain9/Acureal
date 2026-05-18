'use strict';

// PR-NX50 (2026-05-19) — GET /deals/:id/field-provenance route tests.

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u-1', role: 'analyst' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/validate', () => ({
  handleValidation: (_req, _res, next) => next(),
}));

jest.mock('../src/services/deal.service', () => ({
  getDealById: jest.fn(),
  // The deal.routes.js uses many other dealService methods that the
  // jest module resolver pulls in. Stub them all.
  listDeals: jest.fn(),
  createDeal: jest.fn(),
  updateDeal: jest.fn(),
  archiveDeal: jest.fn(),
  restoreDeal: jest.fn(),
  deleteDeal: jest.fn(),
  transitionStage: jest.fn(),
  bulkArchive: jest.fn(),
  bulkReassign: jest.fn(),
  bulkStageTransition: jest.fn(),
  bulkDelete: jest.fn(),
}));

jest.mock('../src/services/dealWorkspace.service', () => ({ getDealWorkspace: jest.fn() }));
jest.mock('../src/services/dealShare.service', () => ({}));
jest.mock('../src/services/dealApplyExtractions.service', () => ({}));
jest.mock('../../packages/real-estate-ontology/src', () => ({
  fields: {},
  getOntologyVersion: () => '1.0.0',
}), { virtual: true });
jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const dealService = require('../src/services/deal.service');
const { query } = require('../src/config/database');
const dealRoutes = require('../src/routes/deal.routes');

const findHandler = (method, path) => {
  const layer = dealRoutes.stack.find(
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

const handler = findHandler('get', '/:id/field-provenance');

beforeEach(() => {
  dealService.getDealById.mockReset();
  query.mockReset();
});

describe('PR-NX50 — GET /deals/:id/field-provenance', () => {
  test('happy path: returns field-provenance map from audit log', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1' });
    query.mockResolvedValueOnce({
      rows: [
        {
          audit_id: 'a-1',
          created_at: '2026-05-18T10:00:00Z',
          actor_id: 'u-1',
          actor_name: 'Rachit Jain',
          after_json: { land_area_sqft: 12500, survey_number: '12/2A' },
          metadata: {
            source: 'document_extraction',
            target_table: 'properties',
            ontology_version: '1.0.0',
            source_extraction_ids: ['ext-1'],
          },
          source_documents: [
            { extraction_id: 'ext-1', document_name: 'sale-deed.pdf', doc_type: 'sale_deed' },
          ],
        },
      ],
    });

    const res = await invoke(handler, { params: { id: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const fp = res.body.data.field_provenance;
    expect(fp.land_area_sqft).toBeDefined();
    expect(fp.land_area_sqft.source).toBe('document_extraction');
    expect(fp.land_area_sqft.applied_by_name).toBe('Rachit Jain');
    expect(fp.land_area_sqft.applied_value).toBe(12500);
    expect(fp.land_area_sqft.source_document_names).toEqual(['sale-deed.pdf']);
    expect(fp.land_area_sqft.source_document_types).toEqual(['sale_deed']);
    expect(fp.land_area_sqft.target_table).toBe('properties');
    expect(fp.land_area_sqft.ontology_version).toBe('1.0.0');
    expect(fp.survey_number).toBeDefined();
    expect(fp.survey_number.applied_value).toBe('12/2A');
  });

  test('latest-overwrite-wins when same field appears in multiple audit rows', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1' });
    // Newest first (ORDER BY created_at DESC is enforced by SQL; mock that order)
    query.mockResolvedValueOnce({
      rows: [
        {
          audit_id: 'a-2',
          created_at: '2026-05-19T10:00:00Z', // newer
          actor_id: 'u-1', actor_name: 'A',
          after_json: { land_area_sqft: 13000 },
          metadata: { source: 'document_extraction', target_table: 'properties' },
          source_documents: [{ extraction_id: 'ext-2', document_name: 'newer-deed.pdf', doc_type: 'sale_deed' }],
        },
        {
          audit_id: 'a-1',
          created_at: '2026-05-18T10:00:00Z', // older
          actor_id: 'u-1', actor_name: 'A',
          after_json: { land_area_sqft: 12500 },
          metadata: { source: 'document_extraction', target_table: 'properties' },
          source_documents: [{ extraction_id: 'ext-1', document_name: 'older-deed.pdf', doc_type: 'sale_deed' }],
        },
      ],
    });

    const res = await invoke(handler, { params: { id: 'd-1' } });
    // Latest value wins.
    expect(res.body.data.field_provenance.land_area_sqft.applied_value).toBe(13000);
    expect(res.body.data.field_provenance.land_area_sqft.source_document_names).toEqual(['newer-deed.pdf']);
  });

  test('404 when deal not visible / not found', async () => {
    dealService.getDealById.mockResolvedValueOnce(null);
    const res = await invoke(handler, { params: { id: 'd-missing' } });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('empty map when no auto-fill events exist for this deal', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1' });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await invoke(handler, { params: { id: 'd-1' } });
    expect(res.body.data.field_provenance).toEqual({});
  });

  test('soft-fails on missing deal_audit_log table (42P01) — returns empty map', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1' });
    const err = Object.assign(new Error('relation "deal_audit_log" does not exist'), { code: '42P01' });
    query.mockRejectedValueOnce(err);
    const res = await invoke(handler, { params: { id: 'd-1' } });
    expect(res.status).toBe(200);
    expect(res.body.data.field_provenance).toEqual({});
  });

  test('multiple fields from a single audit row all get attribution', async () => {
    dealService.getDealById.mockResolvedValueOnce({ id: 'd-1' });
    query.mockResolvedValueOnce({
      rows: [
        {
          audit_id: 'a-1',
          created_at: '2026-05-18T10:00:00Z',
          actor_id: 'u-1', actor_name: 'A',
          after_json: { land_area_sqft: 12500, survey_number: '12/2A', owner_name: 'X Pvt Ltd', circle_rate_per_sqft: 8500 },
          metadata: { source: 'document_extraction', target_table: 'properties', ontology_version: '1.0.0' },
          source_documents: [{ extraction_id: 'ext-1', document_name: 'deed.pdf', doc_type: 'sale_deed' }],
        },
      ],
    });
    const res = await invoke(handler, { params: { id: 'd-1' } });
    const fp = res.body.data.field_provenance;
    expect(Object.keys(fp)).toHaveLength(4);
    expect(fp.land_area_sqft.applied_value).toBe(12500);
    expect(fp.survey_number.applied_value).toBe('12/2A');
    expect(fp.owner_name.applied_value).toBe('X Pvt Ltd');
    expect(fp.circle_rate_per_sqft.applied_value).toBe(8500);
  });
});
