'use strict';

/**
 * Master-plan tile proxy — unit coverage (pure logic + handler validation).
 *
 * No supertest in repo; we test the pure helpers directly and drive the GET
 * handler with mock req/res for the non-network paths (validation + bbox cull),
 * and with a mocked global.fetch for the passthrough paths.
 */

const tiles = require('../src/routes/masterPlanTiles.routes');

const { tileIntersectsBbox, isIntStr, RMP2015_BBOX, handler } = tiles.__test;

// A minimal Express-style res mock that records status + body + headers.
const mockRes = () => {
  const res = {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end(buf) { this.body = buf === undefined ? this.body : buf; return this; },
    set(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
  };
  return res;
};

describe('masterPlanTiles — pure helpers', () => {
  test('isIntStr accepts integers, rejects everything else', () => {
    expect(isIntStr('13')).toBe(true);
    expect(isIntStr('0')).toBe(true);
    expect(isIntStr('abc')).toBe(false);
    expect(isIntStr('13.5')).toBe(false);
    expect(isIntStr('-1')).toBe(false);
    expect(isIntStr('1e3')).toBe(false);
    expect(isIntStr('../etc')).toBe(false);
  });

  test('tileIntersectsBbox is true over Bengaluru, false far away', () => {
    // z0 (whole world) intersects everything, including the BDA bbox.
    expect(tileIntersectsBbox(0, 0, 0)).toBe(true);
    // A z12 tile centered on Bengaluru (77.5946, 12.9716).
    expect(tileIntersectsBbox(12, 2930, 1899)).toBe(true);
    // A z12 tile in the far north-west — nowhere near the BDA bbox.
    expect(tileIntersectsBbox(12, 100, 100)).toBe(false);
  });

  test('bbox constant matches the Map Warper layer-2147 extent', () => {
    expect(RMP2015_BBOX).toEqual({ west: 77.379326, south: 12.743347, east: 77.859283, north: 13.190987 });
  });

  test('the GET handler was located on the router stack', () => {
    expect(typeof handler).toBe('function');
  });
});

describe('masterPlanTiles — GET handler (no network paths)', () => {
  test('400 on non-integer coordinates (no upstream hop)', async () => {
    const res = mockRes();
    await handler({ params: { z: 'abc', x: '1', y: '1' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });

  test('204 on out-of-range x/y for the zoom', async () => {
    const res = mockRes();
    // z=12 → max index 4096; x=99999 is out of range.
    await handler({ params: { z: '12', x: '99999', y: '1' } }, res);
    expect(res.statusCode).toBe(204);
  });

  test('204 on a tile outside the BDA bbox (cull before any fetch)', async () => {
    const res = mockRes();
    await handler({ params: { z: '12', x: '100', y: '100' } }, res);
    expect(res.statusCode).toBe(204);
  });

  test('204 below the minimum zoom', async () => {
    const res = mockRes();
    await handler({ params: { z: '3', x: '1', y: '1' } }, res);
    expect(res.statusCode).toBe(204);
  });
});

describe('masterPlanTiles — GET handler (mocked upstream)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('200 streams the upstream png for an in-bounds tile', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    });
    const res = mockRes();
    await handler({ params: { z: '12', x: '2930', y: '1899' } }, res);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Must send a browser-like User-Agent — Map Warper 403s the default Node UA.
    const fetchOpts = global.fetch.mock.calls[0][1];
    expect(fetchOpts.headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(res.statusCode).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toMatch(/s-maxage=604800/);
    expect(res.headers['x-tile-source']).toMatch(/RMP 2015 PLU/);
  });

  test('204 when the upstream returns a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
    const res = mockRes();
    await handler({ params: { z: '12', x: '2930', y: '1899' } }, res);
    expect(res.statusCode).toBe(204);
  });

  test('204 when the upstream fetch throws (timeout/network)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('aborted'));
    const res = mockRes();
    await handler({ params: { z: '12', x: '2930', y: '1899' } }, res);
    expect(res.statusCode).toBe(204);
  });
});
