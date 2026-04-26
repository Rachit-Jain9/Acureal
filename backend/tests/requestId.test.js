'use strict';

const { generateRequestId, requestIdMiddleware } = require('../src/middleware/requestId');
const { runWithRequestContext, getRequestContext } = require('../src/lib/requestContext');

describe('middleware/requestId', () => {
  describe('generateRequestId', () => {
    test('returns a non-empty unique-ish string', () => {
      const a = generateRequestId();
      const b = generateRequestId();
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(8);
      expect(a).not.toBe(b);
    });
  });

  describe('requestIdMiddleware', () => {
    const buildRes = () => {
      const headers = {};
      return {
        setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
        headers,
      };
    };
    const buildReq = (incoming) => ({
      header: (name) => (name.toLowerCase() === 'x-request-id' ? incoming : undefined),
    });

    test('honors a clean incoming X-Request-Id header', (done) => {
      runWithRequestContext({}, () => {
        const req = buildReq('abc-123-XYZ');
        const res = buildRes();
        requestIdMiddleware(req, res, () => {
          expect(req.id).toBe('abc-123-XYZ');
          expect(res.headers['x-request-id']).toBe('abc-123-XYZ');
          expect(getRequestContext().requestId).toBe('abc-123-XYZ');
          done();
        });
      });
    });

    test('rejects unsafe header values and generates a fresh id', (done) => {
      runWithRequestContext({}, () => {
        const evil = '<script>alert(1)</script>';
        const req = buildReq(evil);
        const res = buildRes();
        requestIdMiddleware(req, res, () => {
          expect(req.id).not.toBe(evil);
          expect(req.id.length).toBeGreaterThan(8);
          expect(res.headers['x-request-id']).toBe(req.id);
          done();
        });
      });
    });

    test('rejects oversize incoming ids', (done) => {
      runWithRequestContext({}, () => {
        const oversize = 'a'.repeat(500);
        const req = buildReq(oversize);
        const res = buildRes();
        requestIdMiddleware(req, res, () => {
          expect(req.id).not.toBe(oversize);
          done();
        });
      });
    });

    test('records start timestamp into context', (done) => {
      runWithRequestContext({}, () => {
        const req = buildReq();
        const res = buildRes();
        const before = Date.now();
        requestIdMiddleware(req, res, () => {
          const ctx = getRequestContext();
          expect(typeof ctx.start).toBe('number');
          expect(ctx.start).toBeGreaterThanOrEqual(before);
          done();
        });
      });
    });
  });
});
