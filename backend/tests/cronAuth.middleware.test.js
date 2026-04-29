'use strict';

/**
 * Tests for backend/src/middleware/cronAuth.js.
 *
 * The middleware is the only fence in front of `/api/fx/refresh/daily` and
 * `/api/cron/parcel-cache-sweep/daily`. A regression here exposes those
 * endpoints to anyone on the open internet, so its contract is asserted
 * directly rather than only as part of the route integration tests.
 */

const { requireCronAuth } = require('../src/middleware/cronAuth');

const buildReq = (authHeader) => ({
  get: (name) => (name.toLowerCase() === 'authorization' ? authHeader : undefined),
});

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  delete process.env.CRON_SECRET;
});

describe('middleware/cronAuth.requireCronAuth', () => {
  test('503s when CRON_SECRET unset', () => {
    const res = buildRes();
    const next = jest.fn();
    requireCronAuth(buildReq('Bearer anything'), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'CRON_SECRET is not configured.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('401s when authorization header missing', () => {
    process.env.CRON_SECRET = 'topsecret';
    const res = buildRes();
    const next = jest.fn();
    requireCronAuth(buildReq(undefined), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('401s when bearer token mismatches', () => {
    process.env.CRON_SECRET = 'topsecret';
    const res = buildRes();
    const next = jest.fn();
    requireCronAuth(buildReq('Bearer wrong'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next when bearer token matches', () => {
    process.env.CRON_SECRET = 'topsecret';
    const res = buildRes();
    const next = jest.fn();
    requireCronAuth(buildReq('Bearer topsecret'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('rejects raw token without Bearer prefix (case-sensitive)', () => {
    process.env.CRON_SECRET = 'topsecret';
    const res = buildRes();
    const next = jest.fn();
    requireCronAuth(buildReq('topsecret'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
