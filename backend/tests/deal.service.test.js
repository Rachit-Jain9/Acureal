jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
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
});
