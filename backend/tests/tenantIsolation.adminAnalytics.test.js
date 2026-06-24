'use strict';

// Regression guard (correctness audit #28). The admin analytics read paths over
// deal_events / ai_call_logs / improvement_signals must scope by
// `organization_id = current_organization_id()` at the APP layer. The pooled DB
// role bypasses row-level security, so that explicit filter — not any RLS policy
// — is the only real tenant boundary (same root cause as #858). Without it the
// customer dashboard AI-cost widget and the operator audit-trail aggregate
// across every organization. These tests pin the filter so it can't silently
// regress.

const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));

const { query } = require('../src/config/database');
const aiUsage = require('../src/services/aiUsage.service');
const learningSignals = require('../src/services/learningSignals.adminReport.service');

const ORG_FILTER = /organization_id\s*=\s*current_organization_id\(\)/i;

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});

describe('tenant isolation — aiUsage rollups are org-scoped at the app layer (#28)', () => {
  test.each([
    ['getSummary', () => aiUsage.getSummary({ days: 30 })],
    ['getDailySeries', () => aiUsage.getDailySeries({ days: 30 })],
    ['getByTaskProvider', () => aiUsage.getByTaskProvider({ days: 30 })],
    ['getByDoctype', () => aiUsage.getByDoctype({ days: 30 })],
    ['getTopCostCalls', () => aiUsage.getTopCostCalls({ days: 30, limit: 10 })],
  ])('%s filters ai_call_logs by current_organization_id()', async (_name, run) => {
    await run();
    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/FROM ai_call_logs/i);
    expect(sql).toMatch(ORG_FILTER);
  });
});

describe('tenant isolation — learning-signal admin report is org-scoped at the app layer (#28)', () => {
  test.each([
    ['getSummary', () => learningSignals.getSummary({ days: 30 })],
    ['getTopRules', () => learningSignals.getTopRules({ days: 30, kind: 'dismissed' })],
    ['getActiveAdjustments', () => learningSignals.getActiveAdjustments({ days: 90 })],
    ['getDailySeries', () => learningSignals.getDailySeries({ days: 30 })],
  ])('%s filters improvement_signals by current_organization_id()', async (_name, run) => {
    await run();
    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/improvement_signals/i);
    expect(sql).toMatch(ORG_FILTER);
  });
});

describe('tenant isolation — admin deal_events routes are org-scoped at the app layer (#28)', () => {
  // The route handlers are inline and pull in the full AI-service import graph,
  // so we assert against the source text rather than mounting the router — the
  // regression we guard is "did the explicit org filter get removed from these
  // three deal_events queries", which the source assertion catches directly.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8',
  );

  test('/recent-events SELECT scopes deal_events by current_organization_id()', () => {
    expect(src).toMatch(/WHERE e\.organization_id = current_organization_id\(\)\s+ORDER BY e\.created_at DESC/i);
  });

  test('/audit-trail WHERE builder seeds the org filter as its first condition', () => {
    expect(src).toMatch(/'e\.organization_id = current_organization_id\(\)'/);
  });

  test('/audit-trail event-type catalog query scopes deal_events by current_organization_id()', () => {
    expect(src).toMatch(/FROM deal_events\s+WHERE organization_id = current_organization_id\(\)\s+AND created_at >= NOW/i);
  });

  test('no bare unscoped deal_events read slips back in (every FROM deal_events is scoped nearby)', () => {
    // Each `FROM deal_events` must have current_organization_id() within the
    // same statement. The audit-trail rows query scopes via ${whereSql} (the
    // seeded where[] asserted above), so we allow a ${whereSql} interpolation
    // to satisfy the check for that one block.
    const blocks = src.split(/FROM deal_events/i).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(3); // recent-events, audit rows, catalog
    for (const block of blocks) {
      const window = block.slice(0, 400);
      const scoped = ORG_FILTER.test(window) || /\$\{whereSql\}/.test(window);
      expect(scoped).toBe(true);
    }
  });
});
