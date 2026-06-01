jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/config/storage', () => ({
  deleteStorageFile: jest.fn(),
}));

// Isolate getDeals' per-deal recommendation rollup — it issues its own query
// and is irrelevant to the pagination / windowed-count behaviour under test.
jest.mock('../src/services/recommendation/persistence', () => ({
  getLatestRunsForDeals: jest.fn(async () => new Map()),
}));

const { query, transaction } = require('../src/config/database');
const { deleteStorageFile } = require('../src/config/storage');
const dealService = require('../src/services/deal.service');

describe('deal.service inactive deal handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(async (handler) => handler({ query }));
  });

  test('getDeals hides dead and archived deals by default, in one windowed query', async () => {
    // Single round-trip: COUNT(*) OVER() carries the total, so an empty first
    // page is exactly one query (no separate COUNT, no recommendation lookup
    // since there are no rows).
    query.mockResolvedValueOnce({ rows: [] });

    const result = await dealService.getDeals({}, {});

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('d.is_archived = FALSE');
    expect(query.mock.calls[0][0]).toContain("d.stage <> 'dead'");
    expect(query.mock.calls[0][0]).toContain('COUNT(*) OVER()');
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });

  test('getDeals reads the total from COUNT(*) OVER() and strips the helper column', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'deal-1', total_count: '7', key_risks: [] },
        { id: 'deal-2', total_count: '7', key_risks: [] },
      ],
    });

    const result = await dealService.getDeals({}, { page: 1, limit: 20 });

    // Total comes from the window column on the first row — no second query.
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.pagination.total).toBe(7);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.data).toHaveLength(2);
    // The window helper must never leak into the API payload.
    expect(result.data[0]).not.toHaveProperty('total_count');
  });

  test('getDeals falls back to a COUNT only for an empty page past the end', async () => {
    // offset > 0 with zero rows → the window function has nothing to read, so
    // one extra COUNT keeps totalPages honest.
    query
      .mockResolvedValueOnce({ rows: [] })                 // data query, empty
      .mockResolvedValueOnce({ rows: [{ count: '40' }] }); // fallback COUNT

    const result = await dealService.getDeals({}, { page: 5, limit: 20 });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('SELECT COUNT(*)');
    expect(result.pagination.total).toBe(40);
    expect(result.pagination.totalPages).toBe(2);
  });

  test('getDealById rejects dead deals from UI access', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'deal-1', stage: 'dead', is_archived: false }],
    });

    await expect(dealService.getDealById('deal-1')).rejects.toThrow('Deal not found.');
  });

  test('archiveDeal removes the linked property when no visible deals remain', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'deal-1', property_id: 'prop-1', is_archived: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'deal-1', property_id: 'prop-1', is_archived: true }] })
      .mockResolvedValueOnce({ rows: [{ has_visible_deals: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'prop-1' }] });

    const result = await dealService.archiveDeal('deal-1', 'user-1', 'cleanup');

    expect(query.mock.calls[3][0]).toContain('DELETE FROM properties');
    expect(result.property_deleted).toEqual({ id: 'prop-1' });
  });

  test('transitioning a deal to dead PRESERVES the linked property (revival-safe)', async () => {
    const txQuery = jest.fn();
    query.mockResolvedValueOnce({
      rows: [{ id: 'deal-1', stage: 'underwriting', is_archived: false }],
    });
    transaction.mockImplementation(async (handler) => handler({ query: txQuery }));
    txQuery
      .mockResolvedValueOnce({ rows: [{ id: 'deal-1', stage: 'dead', property_id: 'prop-1' }] }) // UPDATE deals
      .mockResolvedValueOnce({ rows: [] }); // deal_stage_history insert

    const result = await dealService.transitionStage('deal-1', 'dead', 'user-1', 'mothballed');

    // The dead stage is reversible, so the parcel is kept (no purge) — reviving
    // the deal must bring its PID / khata / survey / geocode / zoning back intact.
    expect(txQuery.mock.calls.some((c) => /DELETE FROM properties/.test(c[0]))).toBe(false);
    expect(result.property_deleted).toBeNull();
  });

  test('deleteDeal removes associated storage files before deleting the deal', async () => {
    query
      // SELECT deal
      .mockResolvedValueOnce({
        rows: [{
          id: 'deal-1', name: 'Test deal', stage: 'closed',
          is_archived: false, property_id: 'prop-1',
        }],
      })
      // SELECT documents
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', file_url: 'organizations/org-1/deals/deal-1/file.pdf' }] })
      // INSERT INTO deal_audit_log (deleted) — fail-open inside the txn
      .mockResolvedValueOnce({ rows: [] })
      // DELETE FROM deals
      .mockResolvedValueOnce({ rows: [{ id: 'deal-1' }] })
      // purgePropertyIfInactiveOnly visibility check
      .mockResolvedValueOnce({ rows: [{ has_visible_deals: true }] });

    const result = await dealService.deleteDeal('deal-1', 'admin-1');

    expect(deleteStorageFile).toHaveBeenCalledWith('organizations/org-1/deals/deal-1/file.pdf');
    // Find the DELETE call regardless of where it landed in the queue —
    // resilient to future audit-row additions inside the txn.
    const deleteCall = query.mock.calls.find((c) => /DELETE FROM deals/.test(c[0]));
    expect(deleteCall).toBeTruthy();
    expect(result.deleted).toBe(true);
  });
});
