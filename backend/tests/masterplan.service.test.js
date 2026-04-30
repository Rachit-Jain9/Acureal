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

  test('updates source-registry metadata and records previous values', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-2',
          plan_name: 'RMP-Provisional',
          doc_type: 'rmp_table',
          processing_mode: 'ocr_required',
          ocr_required: true,
          text_coverage_ratio: 0.02,
          source_confidence: 0.65,
          legal_status: 'provisional',
          source_role: 'provisional_plan',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-2',
          plan_name: 'RMP-Provisional',
          doc_type: 'rmp_table',
          processing_mode: 'text_extraction',
          ocr_required: false,
          text_coverage_ratio: 0.92,
          source_confidence: 0.85,
          legal_status: 'provisional',
          source_role: 'provisional_plan',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.updateSourceDocumentMetadata('doc-2', {
      processingMode: 'text_extraction',
      ocrRequired: false,
      textCoverageRatio: 0.92,
      sourceConfidence: 0.85,
      registryNotes: 'OCR pass completed; text layer reviewed.',
    }, '11111111-1111-1111-1111-111111111111', {
      changeReason: 'source registry review',
    });

    expect(result).toMatchObject({
      id: 'doc-2',
      processing_mode: 'text_extraction',
      ocr_required: false,
    });
    expect(query.mock.calls[1][0]).toContain('UPDATE regulatory_data.master_plan_documents');
    expect(query.mock.calls[2][0]).toContain('master_plan_document_versions');
    expect(JSON.parse(query.mock.calls[2][1][2])).toMatchObject({
      processing_mode: 'ocr_required',
      ocr_required: true,
      text_coverage_ratio: 0.02,
      source_confidence: 0.65,
    });
  });

  test('returns source-registry metadata history for a document', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-2',
          plan_name: 'RMP-Provisional',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'version-1',
          document_id: 'doc-2',
          changed_by_name: 'Rachit Jain',
          previous_values: {
            processing_mode: 'ocr_required',
            ocr_required: true,
          },
          change_reason: 'source registry review',
        }],
      });

    const result = await service.getSourceDocumentVersions('doc-2');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'version-1',
      changed_by_name: 'Rachit Jain',
      previous_values: {
        processing_mode: 'ocr_required',
        ocr_required: true,
      },
    });
    expect(query.mock.calls[1][0]).toContain('master_plan_document_versions');
    expect(query.mock.calls[1][1]).toEqual(['doc-2']);
  });

  test('rejects source-registry metadata history for a missing document', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(service.getSourceDocumentVersions('missing-doc')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid source-registry metadata updates', async () => {
    await expect(service.updateSourceDocumentMetadata('doc-2', {
      textCoverageRatio: 1.5,
    }, '11111111-1111-1111-1111-111111111111')).rejects.toMatchObject({ statusCode: 400 });

    expect(query).not.toHaveBeenCalled();
  });

  test('adds server-owned readiness metadata to listed source documents', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-ocr',
        plan_name: 'RMP-Provisional',
        processing_mode: 'ocr_required',
        ocr_required: true,
        source_role: 'provisional_plan',
        legal_status: 'provisional',
        authority_name: 'Bangalore Development Authority',
      }, {
        id: 'doc-gap',
        plan_name: 'Guidance Value',
        processing_mode: 'text_extraction',
        ocr_required: false,
        source_role: null,
        legal_status: 'gazetted',
        authority_name: null,
      }],
    });

    const result = await service.listDocuments({ city: 'Bengaluru' });

    expect(result[0].source_readiness).toMatchObject({
      key: 'ocr',
      label: 'OCR review',
      can_extract: false,
      action_label: 'OCR review',
      block_reason: 'This source is marked as needing OCR or image review before automated extraction.',
    });
    expect(result[1].source_readiness).toMatchObject({
      key: 'metadata',
      label: 'Metadata gap',
      can_extract: true,
      missing_fields: [
        { field: 'source_role', label: 'source role' },
        { field: 'authority_name', label: 'authority' },
      ],
    });
  });

  test('lists page-level source records for a reviewed document', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-pages',
          plan_name: 'Volume-6 Zoning Regulations',
          page_count: 2,
          processing_mode: 'text_extraction',
          ocr_required: false,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'page-1',
          document_id: 'doc-pages',
          page_number: 1,
          ocr_status: 'not_started',
          review_status: 'pending',
          citation_anchors: [],
        }],
      });

    const result = await service.listSourceDocumentPages('doc-pages');

    expect(result).toMatchObject({
      schema_ready: true,
      document: { id: 'doc-pages', page_count: 2 },
    });
    expect(result.pages).toHaveLength(1);
    expect(query.mock.calls[1][0]).toContain('regulatory_data.master_plan_document_pages');
  });

  test('prepares empty page placeholders without extracting facts', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-pages',
          plan_name: 'RMP-Provisional',
          page_count: 3,
          processing_mode: 'ocr_required',
          ocr_required: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'page-1' }, { id: 'page-2' }, { id: 'page-3' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-pages',
          plan_name: 'RMP-Provisional',
          page_count: 3,
          processing_mode: 'ocr_required',
          ocr_required: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'page-1', page_number: 1, ocr_status: 'queued', review_status: 'needs_ocr' },
          { id: 'page-2', page_number: 2, ocr_status: 'queued', review_status: 'needs_ocr' },
          { id: 'page-3', page_number: 3, ocr_status: 'queued', review_status: 'needs_ocr' },
        ],
      });

    const result = await service.prepareSourceDocumentPages('doc-pages');

    expect(result).toMatchObject({
      schema_ready: true,
      pages_created: 3,
    });
    expect(result.pages).toHaveLength(3);
    expect(query.mock.calls[1][0]).toContain('generate_series');
    expect(query.mock.calls[1][1]).toEqual(['doc-pages', 3, true]);
    expect(extractionService.extractStoredFileFields).not.toHaveBeenCalled();
  });

  test('reports page-ledger migration pending when optional table is missing', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-pages',
          plan_name: 'Index Map',
          page_count: 1,
          processing_mode: 'image_review',
          ocr_required: true,
        }],
      })
      .mockRejectedValueOnce({ code: '42P01', message: 'relation "regulatory_data.master_plan_document_pages" does not exist' });

    const result = await service.listSourceDocumentPages('doc-pages');

    expect(result).toMatchObject({
      schema_ready: false,
      pages: [],
    });
    expect(result.message).toContain('Page-level source storage is pending');
  });

  test('lists BBMP UAV review rows separately from IGR guidance', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'uav-1',
        document_id: 'doc-uav',
        city: 'Bengaluru',
        uav_zone_code: 'B',
        ward_name: 'Bellandur',
        road_name: 'Outer Ring Road',
        review_status: 'pending',
      }],
    });

    const result = await service.listBbmpUavEntries({
      documentId: 'doc-uav',
      city: 'Bengaluru',
      status: 'pending',
      search: 'Bellandur',
    });

    expect(result).toMatchObject({ schema_ready: true });
    expect(result.rows[0]).toMatchObject({ uav_zone_code: 'B' });
    expect(query.mock.calls[0][0]).toContain('regulatory_data.bbmp_uav_entries');
  });

  test('uses the same readiness block reason when extraction is disabled', async () => {
    const readiness = service.getSourceDocumentReadiness({
      processing_mode: 'manual_entry',
      ocr_required: false,
    });

    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-manual',
        plan_name: 'Hand-entered guidance table',
        file_name: 'guidance.pdf',
        file_type: 'application/pdf',
        processing_mode: 'manual_entry',
        ocr_required: false,
      }],
    });

    await expect(service.extractSourceDocument('doc-manual', {
      docType: 'igr_guidance_pdf',
      userId: 'user-1',
    })).rejects.toMatchObject({
      statusCode: 409,
      message: readiness.block_reason,
    });

    expect(extractionService.extractStoredFileFields).not.toHaveBeenCalled();
    expect(evidenceIngestionService.ingestRegulatoryFields).not.toHaveBeenCalled();
  });

  test('blocks automated extraction for OCR-required source documents', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-ocr',
        plan_name: 'RMP-Provisional',
        file_name: 'RMP-Provisional.pdf',
        file_type: 'application/pdf',
        processing_mode: 'ocr_required',
        ocr_required: true,
      }],
    });

    await expect(service.extractSourceDocument('doc-ocr', {
      docType: 'rmp_table',
      userId: 'user-1',
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(extractionService.extractStoredFileFields).not.toHaveBeenCalled();
    expect(evidenceIngestionService.ingestRegulatoryFields).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
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
