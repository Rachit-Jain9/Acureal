'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({
  EVENTS: { SIGNOFF_STATUS_CHANGED: 'signoff.status_changed' },
  publish: jest.fn(),
}));

const { query } = require('../src/config/database');
const { publish } = require('../src/lib/eventBus');
const signoff = require('../src/services/signoff.service');

beforeEach(() => jest.clearAllMocks());

describe('normalizePayload', () => {
  test('maps snake + camel aliases, only the provided keys', () => {
    expect(signoff.normalizePayload({ professionalRole: 'ca', scope: 'x', status: 'signed' }))
      .toEqual({ professional_role: 'ca', scope: 'x', status: 'signed' });
  });
  test('empty input → empty object', () => {
    expect(signoff.normalizePayload({})).toEqual({});
  });
});

describe('listByDeal', () => {
  test('returns the rows', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 's1' }] });
    expect(await signoff.listByDeal('d1')).toEqual([{ id: 's1' }]);
  });
  test('migration-tolerant: undefined table → []', async () => {
    const e = new Error('relation "deal_signoffs" does not exist');
    e.code = '42P01';
    query.mockRejectedValueOnce(e);
    expect(await signoff.listByDeal('d1')).toEqual([]);
  });
  test('rethrows non-undefined-table errors', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    await expect(signoff.listByDeal('d1')).rejects.toThrow('boom');
  });
});

describe('create', () => {
  test('inserts then bumps the parent deal updated_at', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 's1', deal_id: 'd1' }] }); // INSERT
    query.mockResolvedValueOnce({ rows: [] }); // bumpDeal
    const row = await signoff.create('d1', { professional_role: 'ca', scope: 'Form-1 cert' });
    expect(row).toEqual({ id: 's1', deal_id: 'd1' });
    expect(query.mock.calls[1][0]).toContain('UPDATE deals SET updated_at');
    expect(query.mock.calls[1][1]).toEqual(['d1']);
  });
});

describe('update', () => {
  test('builds set clauses, bumps the deal, publishes on status change', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 's1', deal_id: 'd1', professional_role: 'ca', scope: 'x', status: 'signed' }] }); // UPDATE
    query.mockResolvedValueOnce({ rows: [] }); // bumpDeal
    const row = await signoff.update('s1', { status: 'signed' });
    expect(row.status).toBe('signed');
    expect(query.mock.calls[0][0]).toContain('status = $1');
    expect(publish).toHaveBeenCalledWith('signoff.status_changed', expect.objectContaining({ status: 'signed', role: 'ca' }));
  });

  test('no provided fields → returns existing, no event, no bump', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 's1' }] }); // SELECT existing
    const row = await signoff.update('s1', {});
    expect(row).toEqual({ id: 's1' });
    expect(publish).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('delete', () => {
  test('deletes, bumps, returns the row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 's1', deal_id: 'd1' }] }); // DELETE RETURNING
    query.mockResolvedValueOnce({ rows: [] }); // bumpDeal
    expect(await signoff.delete('s1')).toEqual({ id: 's1', deal_id: 'd1' });
  });
  test('not found → null (no bump)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await signoff.delete('nope')).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('seedForDeal', () => {
  test('inserts only the standard templates not already present, then bumps', async () => {
    // advocate scope already present → the other 5 get inserted.
    query.mockResolvedValueOnce({ rows: [{ scope: 'Title, encumbrance & litigation opinion' }] }); // existing
    query.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }] }); // INSERT
    query.mockResolvedValueOnce({ rows: [] }); // bumpDeal
    const rows = await signoff.seedForDeal('d1');
    expect(rows).toHaveLength(5);
    expect(query.mock.calls[1][0]).toContain('INSERT INTO deal_signoffs');
    expect(query.mock.calls[1][1]).toHaveLength(5 * 4); // 5 templates × 4 fields
  });

  test('all standard scopes already present → no insert', async () => {
    const allScopes = [
      'Title, encumbrance & litigation opinion', 'Project cost + 70% escrow certificate',
      'Sanctioned plan & progress certificate', 'Cost & progress certificate',
      'Structural safety certificate', 'RERA bank account confirmation / affidavit',
    ].map((scope) => ({ scope }));
    query.mockResolvedValueOnce({ rows: allScopes });
    expect(await signoff.seedForDeal('d1')).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1); // only the existing-check
  });
});
