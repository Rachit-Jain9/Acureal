jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/services/adapters/landeed.adapter', () => ({
  getStatus: jest.fn(),
}));

jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const landeedAdapter = require('../src/services/adapters/landeed.adapter');
const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
const service = require('../src/services/parcelIntelligenceAdmin.service');

describe('parcelIntelligenceAdmin.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(async (callback) => callback({ query }));
    landeedAdapter.getStatus.mockReturnValue({
      provider: 'landeed',
      status: 'not_configured',
      message: 'No credentials.',
    });
    getProviderAvailability.mockReturnValue({ gemini: true, claude: false, gpt_compatible: false });
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

  test('scopes review queue by search text and deal id', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        type: 'evidence_fact',
        id: 'fact-1',
        created_at: '2026-04-25T11:00:00.000Z',
        payload: { fact_value: '267' },
      }],
    });

    const rows = await service.listReviewQueue({
      type: 'evidence_fact',
      status: 'approved',
      limit: 10,
      search: 'Chirping Ridge',
      deal_id: '11111111-1111-1111-1111-111111111111',
    });

    expect(rows).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('d.id = $3::uuid');
    expect(query.mock.calls[0][0]).toContain('ef.fact_value::text ILIKE');
    expect(query.mock.calls[0][1]).toEqual([
      'approved',
      10,
      '11111111-1111-1111-1111-111111111111',
      'Chirping Ridge',
    ]);
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
    expect(query.mock.calls[0][0]).toContain('review_status = $1::varchar');
  });

  test('casts parcel review status parameters to avoid PostgreSQL type inference failures', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '22222222-2222-2222-2222-222222222222', review_status: 'approved' }] });

    await service.reviewItem({
      type: 'evidence_fact',
      id: '22222222-2222-2222-2222-222222222222',
      status: 'approved',
      userId: '33333333-3333-3333-3333-333333333333',
    });

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('review_status = $1::varchar');
    expect(sql).toContain('reviewed_by = $2::uuid');
    expect(sql).toContain("CASE WHEN $1::varchar IN ('approved', 'rejected')");
    expect(sql).toContain('WHERE id = $3::uuid');
  });

  test('batch updates selected review items and reports failures', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: '11111111-1111-1111-1111-111111111111', review_status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.reviewItems({
      items: [
        { type: 'evidence_fact', id: '11111111-1111-1111-1111-111111111111' },
        { type: 'guidance_value', id: '22222222-2222-2222-2222-222222222222' },
      ],
      status: 'approved',
      userId: '33333333-3333-3333-3333-333333333333',
    });

    expect(result.summary).toMatchObject({ requested: 2, updated: 1, failed: 1 });
    expect(result.updated[0]).toMatchObject({ type: 'evidence_fact', review_status: 'approved' });
    expect(result.failed[0]).toMatchObject({ type: 'guidance_value', id: '22222222-2222-2222-2222-222222222222' });
  });

  test('maps reviewed evidence facts to property promotion updates', () => {
    expect(service.buildPromotionUpdate('survey_numbers', [267, '99/P12'])).toMatchObject({
      field: 'survey_number',
      value: '267, 99/P12',
    });
    expect(service.buildPromotionUpdate('area_acres', 2.975)).toMatchObject({
      field: 'land_area_sqft',
      value: 129591,
      updates: {
        land_area_input_value: 2.975,
        land_area_input_unit: 'acre',
      },
    });
    expect(service.buildPromotionUpdate('consideration_inr', 119000000)).toBeNull();
  });

  test('promotes an approved evidence fact to an empty linked property field with activity trace', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'fact-1',
          fact_key: 'pid_number',
          fact_value: '151900802100321399',
          review_status: 'approved',
          document_name: '14 Khata For Sy No.267.pdf',
          deal_id: 'deal-1',
          property_id: 'property-1',
          pid: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'property-1', pid: '151900802100321399' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'activity-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.promoteEvidenceFactToProperty({
      factId: 'fact-1',
      userId: 'user-1',
    });

    expect(result.promoted).toBe(true);
    expect(result.field).toBe('pid');
    expect(result.activity_id).toBe('activity-1');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][0]).toContain('UPDATE properties');
    expect(query.mock.calls[2][0]).toContain('INSERT INTO activities');
  });

  test('does not promote into an already populated property field by default', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'fact-2',
        fact_key: 'khata_number',
        fact_value: '844/267',
        review_status: 'approved',
        deal_id: 'deal-1',
        property_id: 'property-1',
        khata_no: 'existing-khata',
      }],
    });

    await expect(service.promoteEvidenceFactToProperty({
      factId: 'fact-2',
      userId: 'user-1',
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(transaction).not.toHaveBeenCalled();
  });

  test('batch promotion skips conflicting approved values for the same property field', () => {
    const plan = service.buildBatchPromotionPlan([
      {
        id: 'fact-1',
        fact_key: 'pid_number',
        fact_value: 'PID-1',
        review_status: 'approved',
        property_id: 'property-1',
        pid: null,
      },
      {
        id: 'fact-2',
        fact_key: 'pid_number',
        fact_value: 'PID-2',
        review_status: 'approved',
        property_id: 'property-1',
        pid: null,
      },
    ], ['fact-1', 'fact-2']);

    expect(plan.promotable).toHaveLength(0);
    expect(plan.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ fact_id: 'fact-1', reason: 'conflicting_approved_values' }),
      expect.objectContaining({ fact_id: 'fact-2', reason: 'conflicting_approved_values' }),
    ]));
  });

  test('batch promotion promotes eligible approved facts and reports skipped rows', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            fact_key: 'pid_number',
            fact_value: '151900802100321399',
            review_status: 'approved',
            document_name: '14 Khata For Sy No.267.pdf',
            deal_id: 'deal-1',
            property_id: 'property-1',
            pid: null,
          },
          {
            id: '22222222-2222-2222-2222-222222222222',
            fact_key: 'khata_number',
            fact_value: '844/267',
            review_status: 'needs_review',
            deal_id: 'deal-1',
            property_id: 'property-1',
            khata_no: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: '11111111-1111-1111-1111-111111111111',
          fact_key: 'pid_number',
          fact_value: '151900802100321399',
          review_status: 'approved',
          document_name: '14 Khata For Sy No.267.pdf',
          deal_id: 'deal-1',
          property_id: 'property-1',
          pid: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'property-1', pid: '151900802100321399' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'activity-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.promoteEvidenceFactsToProperty({
      factIds: [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
      userId: '33333333-3333-3333-3333-333333333333',
    });

    expect(result.summary).toMatchObject({ requested: 2, promoted: 1, skipped: 1, failed: 0 });
    expect(result.promoted[0]).toMatchObject({ field: 'pid', activity_id: 'activity-1' });
    expect(result.skipped[0]).toMatchObject({
      fact_id: '22222222-2222-2222-2222-222222222222',
      reason: 'not_approved',
    });
  });
});
