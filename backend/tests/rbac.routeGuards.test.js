'use strict';

// Security regression test. Three deal-data mutation routes were previously
// `authenticate`-only — a Viewer could call them via API and overwrite
// underwriting state, dismiss recommendation cards fleet-wide, or erase their
// own audit-trail rows. They now carry requireRole('admin','analyst'). This
// proves a Viewer is rejected (403) at the route layer.
//
// No supertest in repo — we run each route's middleware chain off the express
// router stack (same approach as risk.narrativeRoute.test.js), with the REAL
// requireRole and an `authenticate` mock that injects a viewer.

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/middleware/aiLimiter', () => ({ aiLimiter: (_req, _res, next) => next() }));

// Stub the service graph the route modules import — never invoked, because
// requireRole responds 403 before any handler runs. (Factories inlined: jest
// hoists jest.mock above any local variable, so they can't reference one.)
jest.mock('../src/services/financial.service', () => ({}));
jest.mock('../src/services/modelConfidence.service', () => ({}));
jest.mock('../src/services/deal.service', () => ({}));
jest.mock('../src/services/export.insights.service', () => ({
  generateSensitivityNarrative: jest.fn(),
  generateRiskNarrative: jest.fn(),
}));
jest.mock('../src/services/activity.service', () => ({}));
jest.mock('../src/services/recommendation/verdicts.service', () => ({}));
jest.mock('../src/services/learningSignals.service', () => ({}));

// Inject a Viewer; keep the REAL requireRole so the guard actually runs.
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => { req.user = { id: 'viewer-1', role: 'viewer' }; next(); },
  };
});

const financialRoutes = require('../src/routes/financial.routes');
const recommendationRoutes = require('../src/routes/recommendation.routes');
const activityRoutes = require('../src/routes/activity.routes');

// Run a route's full middleware chain with a mock req/res until a response is
// sent or the chain proceeds past the last middleware.
const runChain = async (routeModule, method, path) => {
  const layer = routeModule.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} handler for ${path}`);

  const req = {
    params: { dealId: 'd1', ruleId: 'r1', activityId: 'a1', id: 'x1' },
    body: {}, query: {}, headers: {}, header: () => undefined,
  };
  const captured = { status: 200, body: null, ended: false };
  const res = {
    status(code) { captured.status = code; return res; },
    json(body) { captured.body = body; captured.ended = true; return res; },
    send(body) { captured.body = body; captured.ended = true; return res; },
  };

  for (const middleware of layer.route.stack) {
    if (captured.ended) break;
    let proceeded = false;
    let chainErr = null;
    // eslint-disable-next-line no-await-in-loop
    await middleware.handle(req, res, (err) => { proceeded = true; chainErr = err; });
    if (chainErr) throw chainErr;
    if (!proceeded) break; // a response was sent (or the handler ended)
  }
  return captured;
};

describe('RBAC: viewer blocked from previously-unguarded deal mutations', () => {
  test('POST /financials/:dealId/sensitivity → 403 for viewer', async () => {
    const r = await runChain(financialRoutes, 'post', '/:dealId/sensitivity');
    expect(r.status).toBe(403);
  });

  test('POST /deals/:dealId/recommendations/:ruleId/verdict → 403 for viewer', async () => {
    const r = await runChain(recommendationRoutes, 'post', '/deals/:dealId/recommendations/:ruleId/verdict');
    expect(r.status).toBe(403);
  });

  test('DELETE /activities/entry/:activityId → 403 for viewer', async () => {
    const r = await runChain(activityRoutes, 'delete', '/entry/:activityId');
    expect(r.status).toBe(403);
  });
});
