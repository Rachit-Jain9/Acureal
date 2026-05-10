jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/config/storage', () => ({
  deleteStorageFile: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const { deleteStorageFile } = require('../src/config/storage');
const dealService = require('../src/services/deal.service');

describe('deal.service inactive deal handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(async (handler) => handler({ query }));
  });

  test('getDeals hides dead and archived deals by default', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    await dealService.getDeals({}, {});

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('d.is_archived = FALSE');
    expect(query.mock.calls[0][0]).toContain("d.stage <> 'dead'");
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

  test('transitioning a deal to dead removes an orphaned property', async () => {
    const txQuery = jest.fn();
    query.mockResolvedValueOnce({
      rows: [{ id: 'deal-1', stage: 'underwriting', is_archived: false }],
    });
    transaction.mockImplementation(async (handler) => handler({ query: txQuery }));
    txQuery
      .mockResolvedValueOnce({ rows: [{ id: 'deal-1', stage: 'dead', property_id: 'prop-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_visible_deals: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'prop-1' }] });

    const result = await dealService.transitionStage('deal-1', 'dead', 'user-1', 'spam cleanup');

    expect(txQuery.mock.calls[3][0]).toContain('DELETE FROM properties');
    expect(result.property_deleted).toEqual({ id: 'prop-1' });
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
