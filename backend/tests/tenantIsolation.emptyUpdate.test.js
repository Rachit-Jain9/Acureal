'use strict';

// Regression guard for the cross-tenant leak fixed alongside this test: the
// "no fields to update" branch of risk.service.update / approvals.service.update
// did a `SELECT * ... WHERE id = $1` with NO organization filter. Because the
// app connects as the RLS-bypassing role, that WHERE clause is the ONLY tenant
// boundary, so an empty-body PUT returned another org's row by id. These tests
// assert the empty-update read is org-scoped exactly like the sibling
// UPDATE/DELETE statements.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({ EVENTS: {}, publish: jest.fn() }));

const { query } = require('../src/config/database');
const riskService = require('../src/services/risk.service');
const approvalsService = require('../src/services/approvals.service');

beforeEach(() => jest.clearAllMocks());

describe('tenant isolation — empty-body update reads are org-scoped', () => {
  test('risk_flags: update(id, {}) SELECT carries the current_organization_id() filter', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });

    await riskService.update('r1', {});

    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/SELECT \* FROM risk_flags/i);
    expect(sql).toMatch(/organization_id\s*=\s*current_organization_id\(\)/i);
  });

  test('approval_items: update(id, {}) SELECT carries the current_organization_id() filter', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });

    await approvalsService.update('a1', {});

    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/SELECT \* FROM approval_items/i);
    expect(sql).toMatch(/organization_id\s*=\s*current_organization_id\(\)/i);
  });
});
