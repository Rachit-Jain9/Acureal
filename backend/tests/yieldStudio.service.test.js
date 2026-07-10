'use strict';

// Persistence-layer tests for yieldStudio + parcelBoundary services. The pg
// layer is mocked, so these lock the SQL invariants that make the layer correct
// and tenant-safe: (1) every read/write is org-scoped + live-only; (2) INSERTs
// omit organization_id (the column DEFAULT fills it); (3) the study save is
// idempotent + change-gated (identical payload → NO write, NO audit event;
// change → UPDATE in place; first save → INSERT, 23505 race retries once);
// (4) only REAL mutations audit (the deal audit trail is immutable evidence);
// (5) writes verify the target deal/property belongs to the caller's org first
// (cross-org ids → 404, no rows or audit events written).

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({
  recordAudit: jest.fn().mockResolvedValue(null),
}));

const { query, transaction } = require('../src/config/database');
const audit = require('../src/services/dealAuditLog.service');
const yieldStudio = require('../src/services/yieldStudio.service');
const parcelBoundary = require('../src/services/parcelBoundary.service');

const undefinedTableErr = () => Object.assign(new Error('relation "yield_studies" does not exist'), { code: '42P01' });

beforeEach(() => {
  query.mockReset();
  transaction.mockReset();
  audit.recordAudit.mockClear();
});

describe('yieldStudio.service', () => {
  test('getByDeal is org-scoped, live-only, and returns the row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'ys-1', deal_id: 'd1' }] });
    const out = await yieldStudio.getByDeal('d1');
    expect(out).toEqual({ id: 'ys-1', deal_id: 'd1' });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(query.mock.calls[0][1]).toEqual(['d1']);
  });

  test('getByDeal degrades to null when the table is absent (42P01)', async () => {
    query.mockRejectedValueOnce(undefinedTableErr());
    expect(await yieldStudio.getByDeal('d1')).toBeNull();
  });

  const STUDY_BODY = {
    asset_class: 'residential_apartments',
    envelope: { landAreaSqft: 43560, effectiveFsi: 2.5 },
    assumptions: { loadingFactor: 0.3 },
    selected_scenario: 'base',
    engine_version: 'siteYield@1',
  };

  test('first save: SELECTs the active row, INSERTs (no organization_id), and audits', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] }); // org-scoped deal guard
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // no active row yet
      .mockResolvedValueOnce({ rows: [{ id: 'ys-2', deal_id: 'd1', asset_class: 'residential_apartments' }] }); // insert
    transaction.mockImplementationOnce(async (cb) => cb(client));

    const out = await yieldStudio.upsertForDeal('d1', STUDY_BODY, 'u1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2);
    const selectSql = client.query.mock.calls[0][0];
    const insertSql = client.query.mock.calls[1][0];
    expect(selectSql).toMatch(/SELECT \* FROM yield_studies/);
    expect(selectSql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(selectSql).toMatch(/deleted_at IS NULL/);
    expect(insertSql).toMatch(/INSERT INTO yield_studies/);
    expect(insertSql).not.toMatch(/organization_id/); // DEFAULT fills it; WITH CHECK passes
    expect(out.id).toBe('ys-2');
    // The deal guard runs first and is org-scoped.
    expect(query.mock.calls[0][0]).toMatch(/SELECT id FROM deals WHERE id = \$1 AND organization_id = current_organization_id\(\)/);
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'yield_study_saved', dealId: 'd1' }));
  });

  test('changed study: UPDATEs the active row IN PLACE (stable id, org-scoped) and audits', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] }); // deal guard
    const prior = {
      id: 'ys-2', deal_id: 'd1', property_id: null, asset_class: 'residential_apartments',
      envelope: { landAreaSqft: 40000, effectiveFsi: 2.0 }, assumptions: { loadingFactor: 0.3 },
      selected_scenario: 'base', engine_version: 'siteYield@1',
    };
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [prior] }) // active row with DIFFERENT content
      .mockResolvedValueOnce({ rows: [{ ...prior, envelope: STUDY_BODY.envelope }] }); // update
    transaction.mockImplementationOnce(async (cb) => cb(client));

    const out = await yieldStudio.upsertForDeal('d1', STUDY_BODY, 'u1');

    expect(client.query).toHaveBeenCalledTimes(2);
    const updateSql = client.query.mock.calls[1][0];
    expect(updateSql).toMatch(/UPDATE yield_studies/);
    expect(updateSql).not.toMatch(/deleted_at = NOW\(\)/); // in-place, not a swap
    expect(updateSql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(client.query.mock.calls[1][1][0]).toBe('ys-2'); // targets the SAME row id
    expect(out.id).toBe('ys-2');
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'yield_study_saved', dealId: 'd1' }));
  });

  test('identical payload: returns the existing row, writes NOTHING, audits NOTHING', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] }); // deal guard
    const prior = {
      id: 'ys-2', deal_id: 'd1', property_id: null, asset_class: STUDY_BODY.asset_class,
      // jsonb round-trip: same content, different key order — must still match.
      envelope: { effectiveFsi: 2.5, landAreaSqft: 43560 },
      assumptions: { loadingFactor: 0.3 },
      selected_scenario: 'base', engine_version: 'siteYield@1',
    };
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [prior] }) };
    transaction.mockImplementationOnce(async (cb) => cb(client));

    const out = await yieldStudio.upsertForDeal('d1', STUDY_BODY, 'u1');

    expect(out.id).toBe('ys-2');
    expect(client.query).toHaveBeenCalledTimes(1); // the SELECT only — no UPDATE/INSERT
    expect(audit.recordAudit).not.toHaveBeenCalled(); // immutable trail stays clean
  });

  test('concurrent first-save race (23505) retries once and lands on the UPDATE path', async () => {
    // Both guard checks (original + retry) see the deal.
    query.mockResolvedValue({ rows: [{ id: 'd1' }] });
    const winnerRow = {
      id: 'ys-9', deal_id: 'd1', property_id: null, asset_class: 'residential_apartments',
      envelope: { landAreaSqft: 1 }, assumptions: {}, selected_scenario: 'base', engine_version: 'siteYield@1',
    };
    // First attempt: no active row → INSERT → unique-index violation.
    transaction.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    // Retry: finds the winner's row, updates it.
    const client2 = { query: jest.fn() };
    client2.query
      .mockResolvedValueOnce({ rows: [winnerRow] })
      .mockResolvedValueOnce({ rows: [{ ...winnerRow, envelope: STUDY_BODY.envelope }] });
    transaction.mockImplementationOnce(async (cb) => cb(client2));

    const out = await yieldStudio.upsertForDeal('d1', STUDY_BODY, 'u1');
    expect(out.id).toBe('ys-9');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(client2.query.mock.calls[1][0]).toMatch(/UPDATE yield_studies/);
  });

  test('upsertForDeal on a deal outside the caller\'s org → 404, no rows written, no audit event', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // deal invisible to this org
    await expect(yieldStudio.upsertForDeal('foreign-deal', { envelope: {} }, 'u1'))
      .rejects.toMatchObject({ message: 'Deal not found.', statusCode: 404 });
    expect(transaction).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  test('delete soft-deletes the active study (org-scoped) and audits', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'ys-3', deal_id: 'd1' }] });
    const out = await yieldStudio.delete('d1', 'u1');
    expect(out).toEqual({ id: 'ys-3' });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE yield_studies/);
    expect(sql).toMatch(/deleted_at = NOW\(\)/);
    expect(sql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'yield_study_deleted' }));
  });

  test('delete returns null when nothing active (no audit)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await yieldStudio.delete('d1', 'u1')).toBeNull();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});

describe('parcelBoundary.service', () => {
  test('getActiveBoundary is org-scoped + live-only', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'b1', property_id: 'p1' }] });
    const out = await parcelBoundary.getActiveBoundary({ propertyId: 'p1' });
    expect(out.id).toBe('b1');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  test('uploadBoundary rejects missing geometry / property', async () => {
    await expect(parcelBoundary.uploadBoundary({ property_id: 'p1' }, 'u1')).rejects.toThrow(/geometry_geojson/);
    await expect(parcelBoundary.uploadBoundary({ geometry_geojson: { type: 'Polygon' } }, 'u1')).rejects.toThrow(/property_id/);
  });

  test('uploadBoundary swaps active row in a transaction, INSERT omits organization_id, audits when deal-linked', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] }); // org-scoped property guard
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] }); // org-scoped deal guard
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'b2', property_id: 'p1', deal_id: 'd1', source: 'geojson', area_sqft: 43560 }] });
    transaction.mockImplementationOnce(async (cb) => cb(client));

    const out = await parcelBoundary.uploadBoundary(
      { property_id: 'p1', deal_id: 'd1', source: 'geojson', geometry_geojson: { type: 'Polygon', coordinates: [] }, area_sqft: 43560 },
      'u1',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    // Both guards run first and are org-scoped.
    expect(query.mock.calls[0][0]).toMatch(/SELECT id FROM properties WHERE id = \$1 AND organization_id = current_organization_id\(\)/);
    expect(query.mock.calls[1][0]).toMatch(/SELECT id FROM deals WHERE id = \$1 AND organization_id = current_organization_id\(\)/);
    const insertSql = client.query.mock.calls[1][0];
    expect(insertSql).toMatch(/INSERT INTO parcel_boundaries/);
    expect(insertSql).not.toMatch(/organization_id/);
    expect(out.id).toBe('b2');
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'parcel_boundary_uploaded', dealId: 'd1' }));
  });

  test('uploadBoundary does NOT audit when there is no deal link', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] }); // org-scoped property guard (no deal guard without a link)
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'b3', property_id: 'p1', deal_id: null, source: 'manual' }] });
    transaction.mockImplementationOnce(async (cb) => cb(client));
    await parcelBoundary.uploadBoundary({ property_id: 'p1', geometry_geojson: { type: 'Polygon', coordinates: [] } }, 'u1');
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  test('uploadBoundary on a property outside the caller\'s org → 404, nothing written', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // property invisible to this org
    await expect(
      parcelBoundary.uploadBoundary({ property_id: 'foreign-prop', geometry_geojson: { type: 'Polygon', coordinates: [] } }, 'u1'),
    ).rejects.toMatchObject({ message: 'Property not found.', statusCode: 404 });
    expect(transaction).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  test('uploadBoundary with a cross-org deal_id in the body → 404, nothing written', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] }); // property is ours
    query.mockResolvedValueOnce({ rows: [] });             // deal is not
    await expect(
      parcelBoundary.uploadBoundary(
        { property_id: 'p1', deal_id: 'foreign-deal', geometry_geojson: { type: 'Polygon', coordinates: [] } },
        'u1',
      ),
    ).rejects.toMatchObject({ message: 'Deal not found.', statusCode: 404 });
    expect(transaction).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
