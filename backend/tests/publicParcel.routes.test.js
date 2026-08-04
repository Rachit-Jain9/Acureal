'use strict';

/**
 * Public parcel evidence routes — handler-level coverage in the repo's
 * no-supertest style: services mocked, handlers driven with mock req/res,
 * located on the router stack.
 *
 * What matters here: the public row cap is enforced regardless of what the
 * query asks for; /resolve always skips K-GIS (its cache is org-scoped and a
 * public request has no org); a guidance failure degrades instead of failing
 * the lookup; CDN cache headers are present so repeat traffic never reaches
 * the function.
 */

jest.mock('../src/services/masterplan.service', () => ({
  searchBbmpStreets: jest.fn(),
  getUavBenchmark: jest.fn(),
}));
jest.mock('../src/services/parcelContext.service', () => ({
  deriveParcelContextFromAddress: jest.fn(),
}));
jest.mock('../src/services/guidance.service', () => ({
  findGuidanceMatches: jest.fn(),
}));

const masterplanService = require('../src/services/masterplan.service');
const { deriveParcelContextFromAddress } = require('../src/services/parcelContext.service');
const { findGuidanceMatches } = require('../src/services/guidance.service');
const router = require('../src/routes/publicParcel.routes');

const handlerFor = (path) => {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error(`No GET handler registered for ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const mockRes = () => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(obj) { this.body = obj; return this; },
  set(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
});

beforeEach(() => jest.clearAllMocks());

describe('GET /street-lookup', () => {
  const handler = handlerFor('/street-lookup');

  test('caps the row limit at the public cap no matter what is asked', async () => {
    masterplanService.searchBbmpStreets.mockResolvedValue({ rows: [], summary: {} });
    const res = mockRes();
    await handler({ query: { q: 'Koramangala', limit: '5000' } }, res, jest.fn());
    expect(masterplanService.searchBbmpStreets).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Koramangala', limit: 12 }),
    );
    expect(res.body.success).toBe(true);
    expect(res.headers['cache-control']).toMatch(/public, s-maxage=300/);
  });

  test('truncates an oversized query instead of erroring', async () => {
    masterplanService.searchBbmpStreets.mockResolvedValue({ rows: [], summary: {} });
    const res = mockRes();
    await handler({ query: { q: 'x'.repeat(500) } }, res, jest.fn());
    const { search } = masterplanService.searchBbmpStreets.mock.calls[0][0];
    expect(search).toHaveLength(120);
  });

  test('service failure flows to next(), never a half-response', async () => {
    const boom = new Error('db down');
    masterplanService.searchBbmpStreets.mockRejectedValue(boom);
    const next = jest.fn();
    await handler({ query: {} }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('GET /uav-benchmark', () => {
  const handler = handlerFor('/uav-benchmark');

  test('serves the Bengaluru rate card with a long CDN cache', async () => {
    masterplanService.getUavBenchmark.mockResolvedValue({ matrix: [] });
    const res = mockRes();
    await handler({ query: {} }, res, jest.fn());
    expect(masterplanService.getUavBenchmark).toHaveBeenCalledWith({ city: 'Bengaluru' });
    expect(res.headers['cache-control']).toMatch(/s-maxage=3600/);
    expect(res.body).toEqual({ success: true, data: { matrix: [] } });
  });
});

describe('GET /resolve', () => {
  const handler = handlerFor('/resolve');

  test('400 when neither address nor coordinates are given', async () => {
    const res = mockRes();
    await handler({ query: {} }, res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(deriveParcelContextFromAddress).not.toHaveBeenCalled();
  });

  test('always resolves with K-GIS off, and folds guidance in', async () => {
    deriveParcelContextFromAddress.mockResolvedValue({ coordinates: {}, bbmpJurisdiction: {} });
    findGuidanceMatches.mockResolvedValue({ status: 'matched', matches: [{ locality: 'Bommasandra' }] });
    const res = mockRes();
    await handler({ query: { address: 'Bommasandra Industrial Area' } }, res, jest.fn());
    expect(deriveParcelContextFromAddress).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'Bommasandra Industrial Area' }),
      { kgis: false },
    );
    expect(findGuidanceMatches).toHaveBeenCalledWith({ address: 'Bommasandra Industrial Area', city: 'Bengaluru' });
    expect(res.body.data.guidance.status).toBe('matched');
    expect(res.headers['cache-control']).toMatch(/s-maxage=600/);
  });

  test('a guidance failure degrades honestly instead of failing the lookup', async () => {
    deriveParcelContextFromAddress.mockResolvedValue({ coordinates: {} });
    findGuidanceMatches.mockRejectedValue(new Error('guidance exploded'));
    const res = mockRes();
    await handler({ query: { address: 'Whitefield Main Road' } }, res, jest.fn());
    expect(res.body.success).toBe(true);
    expect(res.body.data.guidance.status).toBe('unavailable');
  });

  test('a 400-shaped service error surfaces as a 400, not a 500', async () => {
    const bad = new Error('Provide either an address or (lat, lng).');
    bad.statusCode = 400;
    deriveParcelContextFromAddress.mockRejectedValue(bad);
    const res = mockRes();
    await handler({ query: { address: 'x' } }, res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
