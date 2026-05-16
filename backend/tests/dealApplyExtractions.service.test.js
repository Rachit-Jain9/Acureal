'use strict';

// Unit tests for the new dealApplyExtractions service (PR-NX25).
//
// The service is the post-extraction half of document ingestion: it
// takes operator-approved extraction values, validates + coerces via
// @redip/real-estate-ontology, and writes to deals + properties under
// a single transaction with audit attribution.
//
// What this suite pins:
//   1. Ontology routing — survey_number → properties.survey_number;
//      consideration_inr → deals.negotiated_price_cr (with ₹ → ₹Cr transform);
//      land_area_acres → properties.land_area_sqft (with acres → sqft transform).
//   2. Fail-soft per field — one bad value doesn't roll back the batch.
//   3. Skip-with-reason — every skipped field has a human-readable error.
//   4. Audit trail — one deal_audit_log row per target table.
//   5. Source-extraction marking — correction_history JSONB append.
//   6. Empty-after-validation — returns 200 with skip list, no UPDATE fired.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/services/dealAuditLog.service', () => ({
  recordAudit: jest.fn().mockResolvedValue({ id: 'audit-mock-row' }),
}));

const { query, transaction } = require('../src/config/database');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const service = require('../src/services/dealApplyExtractions.service');

beforeEach(() => {
  jest.clearAllMocks();
});

let warnSpy;
beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { warnSpy.mockRestore(); });

// Helper: stub the mocked transaction() so it invokes the callback with
// a mock client whose .query is the supplied jest fn.
const stubTransactionWithClient = (clientQuery) => {
  transaction.mockImplementation(async (callback) => callback({ query: clientQuery }));
};

const DEAL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PROP_ID = '11111111-2222-3333-4444-555555555555';
const EXTRACTION_ID_A = 'ext-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EXTRACTION_ID_B = 'ext-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID = 'user-99999999-9999-9999-9999-999999999999';

const mockDealRow = (overrides = {}) => ({
  id: DEAL_ID,
  organization_id: 'org-1',
  property_id: PROP_ID,
  name: 'Whitefield Opportunity',
  asset_class: 'residential_apartments',
  deal_structure: 'outright_purchase',
  negotiated_price_cr: null,
  rera_number: null,
  notes: null,
  ...overrides,
});

const mockPropertyRow = (overrides = {}) => ({
  id: PROP_ID,
  organization_id: 'org-1',
  survey_number: null,
  khata_no: null,
  land_area_sqft: null,
  road_width_mtrs: null,
  owner_name: null,
  circle_rate_per_sqft: null,
  ...overrides,
});

describe('dealApplyExtractions.applyExtractionsToDeal', () => {
  test('happy path — applies one property field + one deal field, returns audit ids', async () => {
    const clientQuery = jest.fn()
      // SELECT deal
      .mockResolvedValueOnce({ rows: [mockDealRow()] })
      // SELECT property
      .mockResolvedValueOnce({ rows: [mockPropertyRow()] })
      // UPDATE deals (negotiated_price_cr)
      .mockResolvedValueOnce({ rows: [mockDealRow({ negotiated_price_cr: 18 })] })
      // UPDATE properties (survey_number)
      .mockResolvedValueOnce({ rows: [mockPropertyRow({ survey_number: '45/2A' })] })
      // UPDATE document_extractions (mark applied)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    stubTransactionWithClient(clientQuery);

    const result = await service.applyExtractionsToDeal(
      DEAL_ID,
      [
        {
          canonical_field: 'survey_number',
          value: '45/2A',
          source_extraction_id: EXTRACTION_ID_A,
          source_document_id: 'doc-1',
          confidence: 0.95,
        },
        {
          canonical_field: 'consideration_inr',
          value: 180000000, // ₹18 Cr
          source_extraction_id: EXTRACTION_ID_B,
          source_document_id: 'doc-2',
          confidence: 0.88,
        },
      ],
      USER_ID,
    );

    expect(result.applied).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    // Survey number lands on properties.survey_number untransformed
    const surveyApplied = result.applied.find((a) => a.canonical_field === 'survey_number');
    expect(surveyApplied.table).toBe('properties');
    expect(surveyApplied.column).toBe('survey_number');
    expect(surveyApplied.value).toBe('45/2A');
    expect(surveyApplied.transform).toBeNull();

    // Consideration is ₹ → ₹Cr transformed, lands on deals.negotiated_price_cr
    const considerationApplied = result.applied.find((a) => a.canonical_field === 'consideration_inr');
    expect(considerationApplied.table).toBe('deals');
    expect(considerationApplied.column).toBe('negotiated_price_cr');
    expect(considerationApplied.value).toBe(18);
    expect(considerationApplied.original_value).toBe(180000000);
    expect(considerationApplied.transform).toBe('inr_to_cr');

    // Both audit log entries recorded (one per target table)
    expect(dealAuditLog.recordAudit).toHaveBeenCalledTimes(2);
    expect(result.audit_log_id_deal).toBe('audit-mock-row');
    expect(result.audit_log_id_property).toBe('audit-mock-row');

    // Audit metadata carries source attribution
    const dealAuditCall = dealAuditLog.recordAudit.mock.calls.find(
      ([arg]) => arg.metadata.target_table === 'deals',
    );
    expect(dealAuditCall[0].metadata.source).toBe('document_extraction');
    expect(dealAuditCall[0].metadata.source_extraction_ids).toEqual(
      expect.arrayContaining([EXTRACTION_ID_A, EXTRACTION_ID_B]),
    );
    expect(dealAuditCall[0].metadata.ontology_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('acres transformation — land_area_acres input becomes sqft in DB', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [mockDealRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow({ land_area_sqft: 108900 })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    stubTransactionWithClient(clientQuery);

    const result = await service.applyExtractionsToDeal(
      DEAL_ID,
      [{
        canonical_field: 'land_area_acres',
        value: 2.5,
        source_extraction_id: EXTRACTION_ID_A,
      }],
      USER_ID,
    );

    expect(result.applied[0].column).toBe('land_area_sqft'); // routes via ontology to sqft
    expect(result.applied[0].value).toBe(108900); // 2.5 × 43560
    expect(result.applied[0].original_value).toBe(2.5);
    expect(result.applied[0].transform).toBe('acres_to_sqft');
  });

  test('fail-soft — one bad value (out of range) is skipped; good values still apply', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [mockDealRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow({ survey_number: '45/2A' })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    stubTransactionWithClient(clientQuery);

    const result = await service.applyExtractionsToDeal(
      DEAL_ID,
      [
        // GOOD
        {
          canonical_field: 'survey_number',
          value: '45/2A',
          source_extraction_id: EXTRACTION_ID_A,
        },
        // BAD — below ontology min (land_area_sqft min = 100)
        {
          canonical_field: 'land_area_sqft',
          value: 5,
          source_extraction_id: EXTRACTION_ID_B,
        },
        // BAD — unknown canonical key
        {
          canonical_field: 'nonexistent_xyz',
          value: 'whatever',
          source_extraction_id: EXTRACTION_ID_B,
        },
      ],
      USER_ID,
    );

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].canonical_field).toBe('survey_number');
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.find((s) => s.canonical_field === 'land_area_sqft').reason).toMatch(/below min/);
    expect(result.skipped.find((s) => s.canonical_field === 'nonexistent_xyz').reason).toMatch(/Unknown canonical field/);
  });

  test('empty-after-validation — returns 200-shape result with skip list, NO transaction opened', async () => {
    const result = await service.applyExtractionsToDeal(
      DEAL_ID,
      [
        { canonical_field: 'nonexistent_a', value: 'x', source_extraction_id: EXTRACTION_ID_A },
        { canonical_field: 'nonexistent_b', value: 'y', source_extraction_id: EXTRACTION_ID_B },
      ],
      USER_ID,
    );

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.deal).toBeNull();
    expect(result.property).toBeNull();
    // Critical: NO transaction opened when nothing valid to apply
    expect(transaction).not.toHaveBeenCalled();
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('rejects when dealId is missing', async () => {
    await expect(service.applyExtractionsToDeal(null, [{
      canonical_field: 'survey_number', value: 'X',
    }])).rejects.toThrow(/dealId is required/);
  });

  test('rejects when approvedExtractions is not an array', async () => {
    await expect(service.applyExtractionsToDeal(DEAL_ID, 'not an array')).rejects.toThrow(/must be an array/);
  });

  test('rejects when approvedExtractions is empty', async () => {
    await expect(service.applyExtractionsToDeal(DEAL_ID, [])).rejects.toThrow(/cannot be empty/);
  });

  test('rejects when deal is not found (RLS hides it)', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [] }); // deal not visible

    stubTransactionWithClient(clientQuery);

    await expect(service.applyExtractionsToDeal(
      DEAL_ID,
      [{ canonical_field: 'survey_number', value: '45/2A', source_extraction_id: EXTRACTION_ID_A }],
      USER_ID,
    )).rejects.toThrow(/Deal not found/);
  });

  test('rejects when property-level field but deal has no linked property', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [mockDealRow({ property_id: null })] }); // no linked property

    stubTransactionWithClient(clientQuery);

    await expect(service.applyExtractionsToDeal(
      DEAL_ID,
      [{ canonical_field: 'survey_number', value: '45/2A', source_extraction_id: EXTRACTION_ID_A }],
      USER_ID,
    )).rejects.toThrow(/no linked property/);
  });

  test('deal-only fields work without a property update', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [mockDealRow()] })
      // No property SELECT — deal-only update path
      .mockResolvedValueOnce({ rows: [mockDealRow({ rera_number: 'PRM/KA/RERA/1251/308/PR/2025' })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    stubTransactionWithClient(clientQuery);

    const result = await service.applyExtractionsToDeal(
      DEAL_ID,
      [{
        canonical_field: 'rera_number',
        value: 'PRM/KA/RERA/1251/308/PR/2025',
        source_extraction_id: EXTRACTION_ID_A,
      }],
      USER_ID,
    );

    expect(result.applied).toHaveLength(1);
    expect(result.property).toBeNull();
    expect(dealAuditLog.recordAudit).toHaveBeenCalledTimes(1);
    expect(result.audit_log_id_deal).toBe('audit-mock-row');
    expect(result.audit_log_id_property).toBeNull();
  });

  test('marks source extractions as applied via correction_history JSONB append', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [mockDealRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow({ survey_number: '45/2A' })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    stubTransactionWithClient(clientQuery);

    await service.applyExtractionsToDeal(
      DEAL_ID,
      [{
        canonical_field: 'survey_number',
        value: '45/2A',
        source_extraction_id: EXTRACTION_ID_A,
        source_document_id: 'doc-99',
      }],
      USER_ID,
    );

    // 4th query is the document_extractions UPDATE — verify the JSONB append
    const updateExtractionsCall = clientQuery.mock.calls.find(
      (call) => /UPDATE document_extractions/.test(call[0]),
    );
    expect(updateExtractionsCall).toBeDefined();
    // First param: the JSONB array with the new applied_to_deal entry
    const jsonbArg = updateExtractionsCall[1][0];
    expect(jsonbArg).toMatch(/applied_to_deal/);
    expect(jsonbArg).toMatch(new RegExp(DEAL_ID));
    expect(jsonbArg).toMatch(new RegExp(USER_ID));
    // Second param: the array of extraction ids to target
    expect(updateExtractionsCall[1][1]).toEqual([EXTRACTION_ID_A]);
  });

  test('last-write-wins when two extractions target the same column', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [mockDealRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow()] })
      .mockResolvedValueOnce({ rows: [mockPropertyRow({ survey_number: '99/3B' })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    stubTransactionWithClient(clientQuery);

    const result = await service.applyExtractionsToDeal(
      DEAL_ID,
      [
        { canonical_field: 'survey_number', value: '45/2A', source_extraction_id: EXTRACTION_ID_A },
        // This one comes LATER in the array → wins
        { canonical_field: 'survey_number', value: '99/3B', source_extraction_id: EXTRACTION_ID_B },
      ],
      USER_ID,
    );

    expect(result.applied).toHaveLength(2);
    // Both are recorded as "applied" but the LAST value made it into the UPDATE
    const updatePropCall = clientQuery.mock.calls.find(
      (call) => /UPDATE properties/.test(call[0]),
    );
    expect(updatePropCall[1][0]).toBe('99/3B');
  });

  test('non-object items in approvedExtractions are skipped with reason', async () => {
    const result = await service.applyExtractionsToDeal(
      DEAL_ID,
      [null, 'not an object', 42],
      USER_ID,
    );

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
    result.skipped.forEach((s) => {
      expect(s.reason).toMatch(/is not an object/);
    });
  });

  test('ontology_version is stamped onto audit metadata', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [mockDealRow()] })
      .mockResolvedValueOnce({ rows: [mockDealRow({ rera_number: 'PRM/KA/RERA/X' })] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    stubTransactionWithClient(clientQuery);

    await service.applyExtractionsToDeal(
      DEAL_ID,
      [{ canonical_field: 'rera_number', value: 'PRM/KA/RERA/X', source_extraction_id: EXTRACTION_ID_A }],
      USER_ID,
    );

    const ontologyVersion = dealAuditLog.recordAudit.mock.calls[0][0].metadata.ontology_version;
    expect(ontologyVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('dealApplyExtractions.__internal.pickColumns', () => {
  const { pickColumns } = service.__internal;

  test('extracts only the named columns from a row', () => {
    const row = { id: 'x', name: 'A', notes: 'B', land_area_sqft: 100 };
    const result = pickColumns(row, { name: 'new-name', land_area_sqft: 200 });
    expect(result).toEqual({ name: 'A', land_area_sqft: 100 });
    // notes should NOT be in the snapshot (not in columnMap)
    expect(result).not.toHaveProperty('notes');
  });

  test('null row returns empty object', () => {
    expect(pickColumns(null, { name: 1 })).toEqual({});
  });

  test('missing column on row defaults to null', () => {
    expect(pickColumns({ id: 'x' }, { ghost_column: 1 })).toEqual({ ghost_column: null });
  });
});
