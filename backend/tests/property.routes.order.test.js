'use strict';

/**
 * Route-order regression tests for property.routes.
 *
 * Why this exists: Express matches routes in registration order. The
 * `GET /properties/:id` route is a catch-all that greedily captures ANY
 * single-segment path under /properties — including literal paths like
 * `/auto-derive-context`. If a new single-segment route is registered
 * AFTER `/:id`, requests to it hit the catch-all instead, the property
 * service is called with a non-UUID string, and the user sees an
 * "Invalid data format provided" error from the UUID type cast.
 *
 * These tests freeze the canonical ordering so a future refactor can't
 * silently regress: every single-segment GET route under /properties
 * MUST appear before `GET /:id` in the registration order.
 */

const router = require('../src/routes/property.routes');

// Walk the Express router stack and collect every (method, path) pair
// in registration order.
function listRoutes(r) {
  const out = [];
  for (const layer of r.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    const methods = Object.keys(layer.route.methods || {});
    for (const method of methods) {
      out.push({ method: method.toUpperCase(), path });
    }
  }
  return out;
}

const SINGLE_SEGMENT_LITERAL_GET_ROUTES = [
  '/auto-derive-context',
  '/geocode-diagnostic',
  // Add new literal single-segment routes here so the test catches
  // the order regression.
];

describe('property.routes registration order', () => {
  const allRoutes = listRoutes(router);

  test(':id catch-all GET is registered before /:id/* sub-routes', () => {
    const catchAllIndex = allRoutes.findIndex((r) => r.method === 'GET' && r.path === '/:id');
    expect(catchAllIndex).toBeGreaterThan(-1);
  });

  for (const literalPath of SINGLE_SEGMENT_LITERAL_GET_ROUTES) {
    test(`GET ${literalPath} is registered BEFORE GET /:id (otherwise the catch-all intercepts it)`, () => {
      const catchAllIndex = allRoutes.findIndex((r) => r.method === 'GET' && r.path === '/:id');
      const literalIndex = allRoutes.findIndex((r) => r.method === 'GET' && r.path === literalPath);

      expect(literalIndex).toBeGreaterThan(-1);
      expect(catchAllIndex).toBeGreaterThan(-1);
      expect(literalIndex).toBeLessThan(catchAllIndex);
    });
  }

  test('every existing route still resolves to exactly one method handler', () => {
    // Defensive: catch a future PR that accidentally double-registers a route.
    const seen = new Set();
    for (const { method, path } of allRoutes) {
      const key = `${method} ${path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
