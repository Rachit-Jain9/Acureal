jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/adapters/landeed.adapter', () => ({
  getStatus: jest.fn(),
}));

const { query } = require('../src/config/database');
const landeedAdapter = require('../src/services/adapters/landeed.adapter');
const service = require('../src/services/parcelIntelligenceAdmin.service');

describe('parcelIntelligenceAdmin.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    landeedAdapter.getStatus.mockReturnValue({
      provider: 'landeed',
      status: 'not_configured',
      message: 'No credentials.',
    });
  });

  test('builds operational status without fabricating provider readiness', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ review_status: 'approved', count: 3 }, { review_status: 'pending', count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ review_status: 'pending', count: 5 }] })
      .mockResolvedValueOnce({ rows: [{ review_status: 'approved', count: 8 }] })
      .mockResolvedValueOnce({ rows: [{ review_status: 'approved', count: 12 }, { review_status: 'needs_review', count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 8 }] })
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ generated_at: '2026-04-25T10:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ created_at: '2026-04-25T09:00:00.000Z' }] });

    const result = await service.getStatus();

    expect(result.review_queue.pending_or_needs_review).toBe(8);
    expect(result.review_queue.evidence_sources.pending).toBe(2);
    expect(result.providers.landeed.status).toBe('not_configured');
    expect(result.providers.igr_pdf.status).toBe('parser_available');
    expect(result.cache.kgis_rows).toBe(4);
  });

  test('lists normalized review queue rows across evidence types', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ type: 'evidence_source', id: '1', created_at: '2026-04-25T10:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ type: 'evidence_fact', id: '2', created_at: '2026-04-25T11:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ type: 'guidance_value', id: '3', created_at: '2026-04-25T09:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ type: 'far_rule', id: '4', created_at: '2026-04-25T08:00:00.000Z' }] });

    const rows = await service.listReviewQueue({ status: 'pending', limit: 10 });

    expect(rows.map((row) => row.id)).toEqual(['2', '1', '3', '4']);
    expect(query).toHaveBeenCalledTimes(4);
  });

  test('updates guidance review status through the correct table', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '11111111-1111-1111-1111-111111111111', review_status: 'approved' }] });

    const result = await service.reviewItem({
      type: 'guidance_value',
      id: '11111111-1111-1111-1111-111111111111',
      status: 'approved',
      userId: 'user-1',
      notes: 'Reviewed against uploaded guidance report.',
    });

    expect(result.type).toBe('guidance_value');
    expect(result.review_status).toBe('approved');
    expect(query.mock.calls[0][0]).toContain('UPDATE regulatory_data.guidance_values');
  });
});
