'use strict';

// Unit tests for the new deal_audit_log service.
//
// These tests pin two contracts that the rest of the codebase relies
// on:
//   1. recordAudit() is fail-open. It must NEVER throw for any input;
//      a missing migration, a bad event type, or an arbitrary DB
//      error all collapse to a logged warning + null return.
//   2. listForDeal() reads in newest-first order with the limit
//      clamped to a sane range.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query } = require('../src/config/database');
const dealAuditLog = require('../src/services/dealAuditLog.service');

beforeEach(() => {
  jest.clearAllMocks();
});

// Silence the warn logs while exercising the failure paths so test
// output stays readable.
let warnSpy;
beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { warnSpy.mockRestore(); });

describe('dealAuditLog.recordAudit', () => {
  test('happy path: inserts and returns the row', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'log-1',
        deal_id: 'd-1',
        organization_id: 'o-1',
        actor_id: 'u-1',
        event_type: 'stage_changed',
        before_json: { stage: 'sourced' },
        after_json: { stage: 'screening' },
        metadata: {},
        created_at: '2026-05-09T10:00:00Z',
      }],
    });
    const row = await dealAuditLog.recordAudit({
      dealId: 'd-1',
      eventType: 'stage_changed',
      actorId: 'u-1',
      before: { stage: 'sourced' },
      after: { stage: 'screening' },
    });
    expect(row).toMatchObject({ id: 'log-1', event_type: 'stage_changed' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('skips when dealId is missing — returns null without a DB call', async () => {
    const row = await dealAuditLog.recordAudit({
      eventType: 'stage_changed',
    });
    expect(row).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('skips when eventType is unsupported — returns null without a DB call', async () => {
    const row = await dealAuditLog.recordAudit({
      dealId: 'd-1',
      eventType: 'made_up_event',
    });
    expect(row).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('returns null when migration is missing (Postgres 42P01)', async () => {
    const err = new Error('relation "deal_audit_log" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const row = await dealAuditLog.recordAudit({
      dealId: 'd-1',
      eventType: 'archived',
    });
    expect(row).toBeNull();
  });

  test('returns null when a generic DB error blows up — never throws', async () => {
    const err = new Error('connection terminated');
    query.mockRejectedValueOnce(err);
    const row = await dealAuditLog.recordAudit({
      dealId: 'd-1',
      eventType: 'restored',
    });
    expect(row).toBeNull();
  });

  test('accepts the full bulk-event vocabulary', async () => {
    const types = [
      'bulk_archived',
      'bulk_reassigned',
      'bulk_stage_changed',
      'bulk_deleted',
    ];
    for (const t of types) {
      query.mockResolvedValueOnce({ rows: [{ id: `log-${t}`, event_type: t }] });
      // eslint-disable-next-line no-await-in-loop
      const row = await dealAuditLog.recordAudit({
        dealId: 'd-1',
        eventType: t,
        metadata: { bulk_id: 'batch-x' },
      });
      expect(row).toBeTruthy();
    }
  });
});

describe('dealAuditLog.listForDeal', () => {
  test('reads newest-first and clamps the limit', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'log-2' }, { id: 'log-1' }] });
    const rows = await dealAuditLog.listForDeal('d-1', { limit: 99999 });
    expect(rows).toHaveLength(2);
    // The clamped limit (max 500) should appear in the SQL params.
    const params = query.mock.calls[0][1];
    expect(params[0]).toBe('d-1');
    expect(params[1]).toBeLessThanOrEqual(500);
  });

  test('returns [] when the table is missing (Postgres 42P01)', async () => {
    const err = new Error('relation "deal_audit_log" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const rows = await dealAuditLog.listForDeal('d-1');
    expect(rows).toEqual([]);
  });

  test('rethrows a generic DB error so the caller can decide', async () => {
    const err = new Error('boom');
    query.mockRejectedValueOnce(err);
    await expect(dealAuditLog.listForDeal('d-1')).rejects.toThrow('boom');
  });
});
