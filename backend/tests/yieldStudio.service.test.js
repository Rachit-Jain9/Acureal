'use strict';

// Persistence-layer tests for yieldStudio + parcelBoundary services. The pg
// layer is mocked, so these lock the SQL invariants that make the layer correct
// and tenant-safe: (1) every read/write is org-scoped + live-only; (2) INSERTs
// omit organization_id (the column DEFAULT fills it); (3) the active-row swap
// runs in a transaction (soft-delete prior → insert new); (4) mutations audit.

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

  test('upsertForDeal runs in a transaction: soft-delete prior then INSERT (no organization_id), and audits', async () => {
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // soft-delete prior active
      .mockResolvedValueOnce({ rows: [{ id: 'ys-2', deal_id: 'd1', asset_class: 'residential_apartments' }] }); // insert
    transaction.mockImplementationOnce(async (cb) => cb(client));

    const out = await yieldStudio.upsertForDeal('d1', {
      asset_class: 'residential_apartments',
      envelope: { landAreaSqft: 43560, effectiveFsi: 2.5 },
      assumptions: { loadingFactor: 0.3 },
      selected_scenario: 'base',
      engine_version: 'siteYield@1',
    }, 'u1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2);
    const updateSql = client.query.mock.calls[0][0];
    const insertSql = client.query.mock.calls[1][0];
    expect(updateSql).toMatch(/UPDATE yield_studies/);
    expect(updateSql).toMatch(/deleted_at = NOW\(\)/);
    expect(updateSql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(insertSql).toMatch(/INSERT INTO yield_studies/);
    expect(insertSql).not.toMatch(/organization_id/); // DEFAULT fills it; WITH CHECK passes
    expect(out.id).toBe('ys-2');
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'yield_study_saved', dealId: 'd1' }));
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
    const insertSql = client.query.mock.calls[1][0];
    expect(insertSql).toMatch(/INSERT INTO parcel_boundaries/);
    expect(insertSql).not.toMatch(/organization_id/);
    expect(out.id).toBe('b2');
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'parcel_boundary_uploaded', dealId: 'd1' }));
  });

  test('uploadBoundary does NOT audit when there is no deal link', async () => {
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'b3', property_id: 'p1', deal_id: null, source: 'manual' }] });
    transaction.mockImplementationOnce(async (cb) => cb(client));
    await parcelBoundary.uploadBoundary({ property_id: 'p1', geometry_geojson: { type: 'Polygon', coordinates: [] } }, 'u1');
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
