'use strict';

/**
 * Regression guard (audit 2026-06-01, P1): a partial PATCH to an approval or
 * risk must write ONLY the columns the caller sent. The normalizers used to
 * materialise every key, so update() rewrote all columns on any PATCH —
 * omitting `status` silently reset it (approval → 'pending', risk → 'open')
 * and omitting dates NULLed them.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({ EVENTS: {}, publish: jest.fn() }));

const { query } = require('../src/config/database');
const approvalsService = require('../src/services/approvals.service');
const riskService = require('../src/services/risk.service');

const findUpdate = (table) => query.mock.calls.find((c) => new RegExp(`UPDATE ${table} SET`).test(c[0]));

describe('partial-PATCH integrity — only the sent fields are written', () => {
  beforeEach(() => query.mockReset());

  test('approvals.update { notes } leaves status + dates untouched', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'a1', deal_id: 'd1', status: 'validated' }] });
    await approvalsService.update('a1', { notes: 'spoke to BBMP' });
    const call = findUpdate('approval_items');
    expect(call[0]).toMatch(/notes = \$/);
    expect(call[0]).not.toMatch(/status = \$/);
    expect(call[0]).not.toMatch(/issued_date = \$/);
    expect(call[0]).not.toMatch(/expiry_date = \$/);
    expect(call[1]).toEqual(['spoke to BBMP', 'a1']);
  });

  test('approvals.update { status } still normalizes + writes it (approved → validated)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'a1', deal_id: 'd1', status: 'validated' }] });
    await approvalsService.update('a1', { status: 'approved' });
    const call = findUpdate('approval_items');
    expect(call[0]).toMatch(/status = \$/);
    expect(call[1]).toEqual(['validated', 'a1']);
  });

  test('risk.update { mitigation } does not reset status to open', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', deal_id: 'd1', status: 'mitigated' }] });
    await riskService.update('r1', { mitigation: 'insurance bound' });
    const call = findUpdate('risk_flags');
    expect(call[0]).toMatch(/mitigation = \$/);
    expect(call[0]).not.toMatch(/status = \$/);
    expect(call[1]).toEqual(['insurance bound', 'r1']);
  });

  test('risk.update { status } still normalizes + writes it (closed → resolved)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', deal_id: 'd1', status: 'resolved' }] });
    await riskService.update('r1', { status: 'closed' });
    const call = findUpdate('risk_flags');
    expect(call[0]).toMatch(/status = \$/);
    expect(call[1]).toEqual(['resolved', 'r1']);
  });
});
