jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/config/storage', () => ({
  createUploadUrl: jest.fn(),
  getDownloadUrl: jest.fn(),
}));

jest.mock('../src/services/extraction.service', () => ({
  extractStoredFileFields: jest.fn(),
}));

jest.mock('../src/services/evidenceIngestion.service', () => ({
  ingestRegulatoryFields: jest.fn(),
}));

const { query } = require('../src/config/database');
const storage = require('../src/config/storage');
const extractionService = require('../src/services/extraction.service');
const evidenceIngestionService = require('../src/services/evidenceIngestion.service');
const service = require('../src/services/masterplan.service');

describe('masterplan.service source intake and zone assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates masterplan source document metadata after direct upload', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-1',
        plan_name: 'Volume-6 Zoning Regulations',
        doc_type: 'rmp_table',
        extraction_status: 'pending',
      }],
    });

    const result = await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/volume-6.pdf',
      originalName: 'Volume-6 Zoning Regulations.pdf',
      fileType: 'application/pdf',
      fileSize: 12345,
      city: 'Bengaluru',
      planName: 'Volume-6 Zoning Regulations',
      planVersion: 'RMP 2031 Draft',
      docType: 'rmp_table',
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result).toMatchObject({ id: 'doc-1', extraction_status: 'pending' });
    expect(query.mock.calls[0][0]).toContain('INSERT INTO regulatory_data.master_plan_documents');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'Volume-6 Zoning Regulations',
      'rmp_table',
    ]));
  });

  test('accepts BBMP UAV property-tax source documents in the intake registry', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-uav',
        plan_name: 'Guidance Value',
        doc_type: 'bbmp_uav_pdf',
        extraction_status: 'pending',
      }],
    });

    const result = await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/guidance-value.pdf',
      originalName: 'Guidance Value.pdf',
      fileType: 'application/pdf',
      fileSize: 54321,
      city: 'Bengaluru',
      planName: 'Guidance Value',
      planVersion: 'BBMP UAV',
      docType: 'bbmp_uav_pdf',
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result).toMatchObject({ id: 'doc-uav', doc_type: 'bbmp_uav_pdf' });
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'Guidance Value',
      'bbmp_uav_pdf',
    ]));
  });

  test('persists source-registry metadata for legal status and OCR readiness', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-2',
        plan_name: 'RMP-Provisional',
        legal_status: 'provisional',
        source_role: 'provisional_plan',
        processing_mode: 'ocr_required',
        ocr_required: true,
      }],
    });

    const result = await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/rmp-provisional.pdf',
      originalName: 'RMP-Provisional.pdf',
      fileType: 'application/pdf',
      fileSize: 22222,
      city: 'Bengaluru',
      planName: 'RMP-Provisional',
      planVersion: 'RMP 2031 Draft',
      docType: 'rmp_table',
      sourceRole: 'provisional_plan',
      legalStatus: 'provisional',
      authorityName: 'Bangalore Development Authority',
      publishedOn: '2026-01-15',
      sourceUrl: 'https://example.com/rmp-provisional',
      pageCount: 12,
      processingMode: 'ocr_required',
      textCoverageRatio: 0.02,
      sourceConfidence: 0.65,
      registryNotes: 'Image-only provisional source; OCR pass required.',
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result).toMatchObject({ id: 'doc-2', legal_status: 'provisional' });
    expect(query.mock.calls[0][0]).toContain('source_role');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'provisional_plan',
      'provisional',
      'Bangalore Development Authority',
      'ocr_required',
      true,
      0.65,
    ]));
  });

  test('rejects invalid source-registry metadata values', async () => {
    await expect(service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/source.pdf',
      originalName: 'source.pdf',
      fileType: 'application/pdf',
      fileSize: 1,
      docType: 'rmp_table',
      sourceRole: 'made_up_role',
      organizationId: '11111111-1111-1111-1111-111111111111',
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(query).not.toHaveBeenCalled();
  });

  test('extracts a source document into pending review candidates without approving rows', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-1',
          org_id: '11111111-1111-1111-1111-111111111111',
          city: 'Bengaluru',
          plan_name: 'Volume-6 Zoning Regulations',
          plan_version: 'RMP 2031 Draft',
          file_name: 'Volume-6 Zoning Regulations.pdf',
          file_type: 'application/pdf',
          file_url: 'organizations/org-1/deals/master-plan/volume-6.pdf',
          storage_path: 'organizations/org-1/deals/master-plan/volume-6.pdf',
          doc_type: 'rmp_table',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-1',
          extraction_status: 'completed',
          doc_type: 'rmp_table',
          zones_extracted: 1,
          far_rules_extracted: 2,
          evidence_facts_extracted: 4,
        }],
      });

    extractionService.extractStoredFileFields.mockResolvedValue({
      docType: 'rmp_table',
      structuredFields: {
        plan_version: 'RMP 2031 Draft',
        zones: [{ zone_code: 'R1', zone_name: 'Residential Main' }],
        rules: [{ land_use_family: 'residential', base_far: 1.5, max_far: 1.75 }],
      },
      confidenceScores: { _overall: 0.8 },
      parseError: null,
    });
    evidenceIngestionService.ingestRegulatoryFields.mockResolvedValue({
      skipped: false,
      source_id: 'source-1',
      zones_created: 1,
      far_rules_created: 2,
      guidance_values_created: 0,
      evidence_facts_created: 4,
    });

    const result = await service.extractSourceDocument('doc-1', {
      docType: 'rmp_table',
      userId: 'user-1',
    });

    expect(result.document).toMatchObject({
      extraction_status: 'completed',
      zones_extracted: 1,
      far_rules_extracted: 2,
    });
    expect(evidenceIngestionService.ingestRegulatoryFields).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: 'rmp_table',
        source: expect.objectContaining({ source_kind: 'official_pdf' }),
      }),
    );
    expect(query.mock.calls[2][0]).toContain('evidence_facts_extracted');
  });

  test('rejects assignment of a pending zone to a property', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'zone-1',
        zone_code: 'R1',
        zone_name: 'Residential Main',
        review_status: 'pending',
      }],
    });

    await expect(service.assignReviewedZoneToProperty({
      zoneId: 'zone-1',
      propertyId: 'property-1',
      userId: 'user-1',
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects assignment when the property is missing from the active org', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'zone-1',
          zone_code: 'R1',
          zone_name: 'Residential Main',
          review_status: 'approved',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(service.assignReviewedZoneToProperty({
      zoneId: 'zone-1',
      propertyId: 'property-1',
      userId: 'user-1',
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('creates source document upload URLs through the storage adapter', async () => {
    storage.createUploadUrl.mockResolvedValue({
      signedUrl: 'https://storage/upload',
      path: 'organizations/org-1/deals/master-plan/source.pdf',
      token: 'token',
    });

    const result = await service.getSourceDocumentUploadUrl({
      fileName: 'Guidance Value.pdf',
      fileSize: 1024,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result).toMatchObject({ signedUrl: 'https://storage/upload' });
    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      'Guidance Value.pdf',
      'master-plan',
      '11111111-1111-1111-1111-111111111111',
    );
  });
});
