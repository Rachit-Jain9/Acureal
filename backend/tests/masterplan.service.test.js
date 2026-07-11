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
    // Reaper UPDATE runs first inside listDocuments
    query.mockResolvedValueOnce({ rows: [] });
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

  test('an OCR-required source that completed extraction reads as extracted, not blocked', async () => {
    // Regression: the UAV gazette was fully extracted via the manual review
    // path while still flagged ocr_required — the chip kept saying "OCR or
    // image review required before extraction", which read as "this document
    // was never ingested". Completed extraction must win the label while
    // automated extraction stays blocked.
    const readiness = service.getSourceDocumentReadiness({
      processing_mode: 'ocr_required',
      ocr_required: true,
      extraction_status: 'completed',
    });
    expect(readiness).toMatchObject({
      key: 'ocr_completed',
      label: 'Extracted (manual review)',
      tone: 'success',
      can_extract: false,
    });

    // Not-yet-extracted OCR sources keep the warning state.
    const pending = service.getSourceDocumentReadiness({
      processing_mode: 'ocr_required',
      ocr_required: true,
      extraction_status: 'pending',
    });
    expect(pending).toMatchObject({ key: 'ocr', label: 'OCR review', can_extract: false });
  });

  test('presents a stored base map as a settled "Reference map", not OCR/pending', () => {
    const refMap = service.getSourceDocumentReadiness({
      source_role: 'base_map',
      processing_mode: 'image_review',
      ocr_required: true,
      extraction_status: 'pending',
    });
    expect(refMap).toMatchObject({
      key: 'manual',
      label: 'Reference map',
      tone: 'neutral',
      can_extract: false,
      is_reference_map: true,
    });
    // A base map that has actually been extracted keeps its normal readiness.
    const extracted = service.getSourceDocumentReadiness({
      source_role: 'base_map',
      processing_mode: 'image_review',
      ocr_required: true,
      extraction_status: 'completed',
    });
    expect(extracted.is_reference_map).toBeUndefined();
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

describe('masterplan.service corpus auto-classification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('auto-applies the corpus manifest defaults when uploading Volume 6', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-vol6', plan_name: 'RMP 2031 Volume 6 — Zoning Regulations' }] });

    await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/volume-6.pdf',
      originalName: 'Volume-6 Zoning Regulations.pdf',
      fileType: 'application/pdf',
      fileSize: 12345,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    const args = query.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining([
      'RMP 2031 Volume 6 — Zoning Regulations',
      'rmp_table',
      'provisional_plan',
      'draft',
      'Bangalore Development Authority',
      'text_extraction',
      false,
    ]));
  });

  test('forces RMP-Provisional.pdf into ocr_required mode', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-rmp', plan_name: 'RMP 2031 Provisional Master Plan' }] });

    await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/rmp.pdf',
      originalName: 'RMP-Provisional.pdf',
      fileType: 'application/pdf',
      fileSize: 999999,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    const args = query.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining([
      'ocr_required',
      true,
    ]));
  });

  test('forces Guidance Value.pdf into BBMP UAV classification', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-bbmp', plan_name: 'BBMP UAV', doc_type: 'bbmp_uav_pdf' }] });

    await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/bbmp.pdf',
      originalName: 'Guidance Value.pdf',
      fileType: 'application/pdf',
      fileSize: 50000,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    const args = query.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining([
      'bbmp_uav_pdf',
      'property_tax_uav',
      'Bruhat Bengaluru Mahanagara Palike',
    ]));
  });

  test('rejects Guidance Value.pdf when an admin tries to mis-classify it as IGR guidance', async () => {
    await expect(service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/bbmp.pdf',
      originalName: 'Guidance Value.pdf',
      fileType: 'application/pdf',
      fileSize: 50000,
      docType: 'igr_guidance_pdf',
      organizationId: '11111111-1111-1111-1111-111111111111',
    })).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/BBMP/) });

    expect(query).not.toHaveBeenCalled();
  });

  test('reviewer-supplied values still win over corpus defaults', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-vol6' }] });

    await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/volume-6.pdf',
      originalName: 'Volume-6 Zoning Regulations.pdf',
      fileType: 'application/pdf',
      fileSize: 12345,
      legalStatus: 'gazetted',
      sourceConfidence: 0.99,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    const args = query.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining([
      'gazetted',
      0.99,
      'rmp_table',
      'provisional_plan',
    ]));
  });

  test('importZoneGeoJSON updates geometry for matched zones and skips zones with existing geom by default', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'zone-1',
          zone_code: 'R1',
          plan_version: 'RMP 2031 Provisional',
          has_geom: false,
          geom_geojson: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'zone-1', zone_code: 'R1', plan_version: 'RMP 2031 Provisional' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'zone-2',
          zone_code: 'R2',
          plan_version: 'RMP 2031 Provisional',
          has_geom: true,
          geom_geojson: { type: 'Polygon', coordinates: [] },
        }],
      });

    const summary = await service.importZoneGeoJSON({
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { zone_code: 'R1' },
            geometry: { type: 'Polygon', coordinates: [[[77, 12], [77.1, 12], [77.1, 12.1], [77, 12.1], [77, 12]]] },
          },
          {
            type: 'Feature',
            properties: { zone_code: 'R2' },
            geometry: { type: 'Polygon', coordinates: [[[77, 12], [77.1, 12], [77.1, 12.1], [77, 12]]] },
          },
        ],
      },
      userId: 'user-1',
    });

    expect(summary).toMatchObject({
      received: 2,
      updated: 1,
      skipped_existing_geom: 1,
      skipped_unknown_zone: 0,
      rejected: 0,
    });
    expect(summary.updates).toHaveLength(1);
    expect(summary.updates[0]).toMatchObject({ zone_code: 'R1', replaced_geom: false });
  });

  test('importZoneGeoJSON overwrites existing geom when overwriteGeom is true', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'zone-1',
          zone_code: 'R1',
          plan_version: 'RMP 2031 Provisional',
          has_geom: true,
          geom_geojson: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]] },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'zone-1', zone_code: 'R1', plan_version: 'RMP 2031 Provisional' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const summary = await service.importZoneGeoJSON({
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { zone_code: 'R1' },
            geometry: { type: 'Polygon', coordinates: [[[7, 8], [9, 10], [11, 12], [7, 8]]] },
          },
        ],
      },
      overwriteGeom: true,
      userId: 'user-1',
    });

    expect(summary.updated).toBe(1);
    expect(summary.skipped_existing_geom).toBe(0);
    expect(summary.updates[0].replaced_geom).toBe(true);
  });

  test('importZoneGeoJSON skips features whose zone_code is not in the registry', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const summary = await service.importZoneGeoJSON({
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { zone_code: 'GHOST' },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          },
        ],
      },
      userId: 'user-1',
    });

    expect(summary.received).toBe(1);
    expect(summary.skipped_unknown_zone).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.errors[0]).toMatchObject({
      zone_code: 'GHOST',
      reason: expect.stringMatching(/no reviewed zone/i),
    });
  });

  test('importZoneGeoJSON rejects features missing zone_code or geometry', async () => {
    const summary = await service.importZoneGeoJSON({
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] } },
          { type: 'Feature', properties: { zone_code: 'R1' }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      },
      userId: 'user-1',
    });

    expect(summary.rejected).toBe(2);
    expect(summary.updated).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  test('importZoneGeoJSON throws on missing or empty feature collections', async () => {
    await expect(service.importZoneGeoJSON({})).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.importZoneGeoJSON({ featureCollection: { type: 'NotACollection' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.importZoneGeoJSON({ featureCollection: { type: 'FeatureCollection', features: [] } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  test('importZoneGeoJSON caps imports at 500 features', async () => {
    const features = Array.from({ length: 501 }, () => ({
      type: 'Feature',
      properties: { zone_code: 'R1' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
    }));
    await expect(service.importZoneGeoJSON({
      featureCollection: { type: 'FeatureCollection', features },
    })).rejects.toMatchObject({ statusCode: 413 });
    expect(query).not.toHaveBeenCalled();
  });

  test('accepts .docx uploads and applies the corpus manifest defaults for Master Plan.docx', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'doc-mp-docx', plan_name: 'RMP 2031 Master Plan Document (Word draft)', doc_type: 'rmp_table' }],
    });

    const result = await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/master-plan.docx',
      originalName: 'Master Plan.docx',
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 75000,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result).toMatchObject({ id: 'doc-mp-docx' });
    const args = query.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining([
      'rmp_table',
      'provisional_plan',
      'provisional',
      'Bangalore Development Authority',
      'text_extraction',
    ]));
  });

  test('accepts .docx uploads and applies manual_entry classification for analyst notes', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'doc-grok-docx', plan_name: 'Guidance Value Remarks (analyst notes)', doc_type: 'guidance_value_report' }],
    });

    await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/grok-remarks.docx',
      originalName: 'GROK Guidance Value Remarks.docx',
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 30000,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    const args = query.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining([
      'guidance_value_report',
      'derived_notes',
      'user_supplied',
      'Internal analyst',
      'manual_entry',
    ]));
  });

  test('accepts spreadsheet uploads (.xlsx) with no manifest match', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-xlsx', plan_name: 'rules' }] });

    const result = await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/spreadsheet.xlsx',
      originalName: 'rules.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 1234,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result).toMatchObject({ id: 'doc-xlsx' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('accepts iPhone photo uploads (.heic)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-heic' }] });

    await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/site-photo.heic',
      originalName: 'site-photo.heic',
      fileType: 'image/heic',
      fileSize: 4321,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  test('accepts GeoJSON uploads (.geojson)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-geojson' }] });

    await service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/zones.geojson',
      originalName: 'zones.geojson',
      fileType: 'application/geo+json',
      fileSize: 9999,
      organizationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  test('still rejects executables and other unsafe types', async () => {
    await expect(service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/malware.exe',
      originalName: 'malware.exe',
      fileType: 'application/x-msdownload',
      fileSize: 1,
      organizationId: '11111111-1111-1111-1111-111111111111',
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(service.confirmSourceDocumentUpload({
      storagePath: 'organizations/org-1/deals/master-plan/bundle.zip',
      originalName: 'bundle.zip',
      fileType: 'application/zip',
      fileSize: 1,
      organizationId: '11111111-1111-1111-1111-111111111111',
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(query).not.toHaveBeenCalled();
  });

  test('queueExtractionJob marks the row in_progress and stamps the start timestamp', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-1',
          file_name: 'Volume-6 Zoning Regulations.pdf',
          file_url: 'organizations/org-1/master-plan/v6.pdf',
          file_type: 'application/pdf',
          plan_name: 'Volume 6',
          processing_mode: 'text_extraction',
          ocr_required: false,
          source_role: 'provisional_plan',
          legal_status: 'provisional',
          authority_name: 'BDA',
          extraction_status: 'pending',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const queued = await service.queueExtractionJob('doc-1', { docType: 'rmp_table' });
    expect(queued.document.extraction_status).toBe('in_progress');

    const inProgressUpdate = query.mock.calls[1][0];
    expect(inProgressUpdate).toContain("extraction_status = 'in_progress'");
    expect(inProgressUpdate).toContain('extraction_started_at = NOW()');
  });

  test('queueExtractionJob refuses non-extractable formats early', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-docx',
        file_name: 'Master Plan.docx',
        plan_name: 'Master Plan',
        file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        processing_mode: 'text_extraction',
      }],
    });

    await expect(service.queueExtractionJob('doc-docx')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/PDF and image/i),
    });
  });

  test('runExtractionJob persists failure on extractor error without throwing', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-1',
          file_name: 'Volume-6 Zoning Regulations.pdf',
          file_url: 'organizations/org-1/master-plan/v6.pdf',
          file_type: 'application/pdf',
          plan_name: 'Volume 6',
          processing_mode: 'text_extraction',
          ocr_required: false,
          source_role: 'provisional_plan',
          legal_status: 'provisional',
          authority_name: 'BDA',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    extractionService.extractStoredFileFields.mockRejectedValue(new Error('Gemini upstream 503'));

    await expect(service.runExtractionJob('doc-1', { userId: 'user-1' })).resolves.toBeUndefined();

    const failureUpdate = query.mock.calls[1][0];
    const failureValues = query.mock.calls[1][1];
    expect(failureUpdate).toContain("extraction_status = 'failed'");
    expect(failureValues[0]).toMatch(/Gemini upstream 503/);
  });

  test('listDocuments reaps stuck in_progress rows (modern + legacy NULL extraction_started_at)', async () => {
    // First call: the reaper UPDATE
    query.mockResolvedValueOnce({ rows: [] });
    // Second call: the SELECT for listDocuments
    query.mockResolvedValueOnce({ rows: [] });

    await service.listDocuments({ city: 'Bengaluru' });

    expect(query).toHaveBeenCalledTimes(2);
    const reaperSql = query.mock.calls[0][0];
    expect(reaperSql).toContain("UPDATE regulatory_data.master_plan_documents");
    expect(reaperSql).toContain("extraction_status = 'failed'");
    expect(reaperSql).toContain("extraction_status = 'in_progress'");
    // Modern rows: bounded by extraction_started_at + the configurable threshold
    expect(reaperSql).toContain("extraction_started_at < NOW()");
    // Legacy rows: bounded by created_at when extraction_started_at is NULL
    expect(reaperSql).toContain("extraction_started_at IS NULL");
    expect(reaperSql).toContain("INTERVAL '5 minutes'");
  });

  test('listDocuments still returns rows when the reaper UPDATE fails', async () => {
    // Reaper throws (e.g. transient DB hiccup)
    query.mockRejectedValueOnce(new Error('transient db error'));
    // Second call: SELECT still runs
    query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-1',
        plan_name: 'RMP 2031 Volume 6 — Zoning Regulations',
        file_name: 'Volume-6 Zoning Regulations.pdf',
        extraction_status: 'pending',
        source_role: 'provisional_plan',
        legal_status: 'provisional',
      }],
    });

    const docs = await service.listDocuments({ city: 'Bengaluru' });
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('doc-1');
  });

  test('extractSourceDocument stamps extraction_started_at when transitioning to in_progress', async () => {
    query
      // getSourceDocumentById
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-1',
          file_name: 'Volume-6 Zoning Regulations.pdf',
          file_url: 'organizations/org-1/master-plan/v6.pdf',
          file_type: 'application/pdf',
          plan_name: 'Volume 6',
          processing_mode: 'text_extraction',
          ocr_required: false,
          extraction_status: 'pending',
          source_role: 'provisional_plan',
          legal_status: 'provisional',
          authority_name: 'BDA',
        }],
      })
      // UPDATE to in_progress (sets extraction_started_at)
      .mockResolvedValueOnce({ rows: [] })
      // UPDATE to completed
      .mockResolvedValueOnce({
        rows: [{ id: 'doc-1', extraction_status: 'completed' }],
      });

    extractionService.extractStoredFileFields.mockResolvedValue({
      docType: 'rmp_table',
      structuredFields: { zones: [] },
      confidenceScores: {},
    });
    evidenceIngestionService.ingestRegulatoryFields.mockResolvedValue({
      skipped: true,
      reason: 'no fields',
      source_id: null,
    });

    await service.extractSourceDocument('doc-1', { userId: 'user-1' });

    const inProgressUpdate = query.mock.calls[1][0];
    expect(inProgressUpdate).toContain("extraction_status = 'in_progress'");
    expect(inProgressUpdate).toContain('extraction_started_at = NOW()');
  });

  test('listMasterplanCorpus returns 14 entries with upload status from listDocuments', async () => {
    // Reaper UPDATE inside listDocuments runs first
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'doc-vol6',
          plan_name: 'RMP 2031 Volume 6 — Zoning Regulations',
          file_name: 'Volume-6 Zoning Regulations.pdf',
          extraction_status: 'pending',
          source_role: 'provisional_plan',
          legal_status: 'provisional',
          processing_mode: 'text_extraction',
          ocr_required: false,
          source_confidence: 0.85,
          created_at: '2026-04-30T10:00:00Z',
        },
      ],
    });

    const result = await service.listMasterplanCorpus({ city: 'Bengaluru' });
    expect(result).toHaveLength(14);
    const vol6 = result.find((row) => row.canonical_name === 'volume-6-zoning-regulations.pdf');
    const guidance = result.find((row) => row.canonical_name === 'guidance-value.pdf');
    expect(vol6.uploaded).toBe(true);
    expect(vol6.document.id).toBe('doc-vol6');
    expect(guidance.uploaded).toBe(false);
    expect(guidance.doc_type).toBe('bbmp_uav_pdf');
  });
});

describe('masterplan.service district intelligence helpers', () => {
  describe('normalizePdCode', () => {
    test('returns null for empty input', () => {
      expect(service.normalizePdCode(null)).toBeNull();
      expect(service.normalizePdCode('')).toBeNull();
      expect(service.normalizePdCode('  ')).toBeNull();
    });

    test('zero-pads single-digit codes from various spellings', () => {
      expect(service.normalizePdCode('PD 1')).toBe('PD-01');
      expect(service.normalizePdCode('PD-1')).toBe('PD-01');
      expect(service.normalizePdCode('PD1')).toBe('PD-01');
      expect(service.normalizePdCode('pd 9')).toBe('PD-09');
    });

    test('preserves two-digit codes', () => {
      expect(service.normalizePdCode('PD 02')).toBe('PD-02');
      expect(service.normalizePdCode('PD-42')).toBe('PD-42');
      expect(service.normalizePdCode('PD42')).toBe('PD-42');
    });

    test('returns null for non-PD strings', () => {
      expect(service.normalizePdCode('District 1')).toBeNull();
      expect(service.normalizePdCode('XYZ-01')).toBeNull();
    });
  });

  describe('parseDistrictNotes', () => {
    test('returns all-null for empty input', () => {
      const out = service.parseDistrictNotes(null);
      expect(out).toEqual({ population: null, area_ha: null, density: null, wards: null, villages: null });
    });

    test('parses Indian-format population with comma-lakh grouping', () => {
      // PD 1 (Central Business District) — base case
      const notes = 'Population (2011 Census): 5,93,883; Area of PD: 2774.3 ha; Wards in PD: 19; Gross Density: 214PPH';
      const out = service.parseDistrictNotes(notes);
      expect(out.population).toBe(593883);
      expect(out.area_ha).toBeCloseTo(2774.3, 1);
      expect(out.density).toBe(214);
      expect(out.wards).toBe(19);
      expect(out.villages).toBeNull();
    });

    test('parses density with parenthetical year and lowercase pph', () => {
      // PD 5 — "Gross Density (2011 Census): 436 pph" pattern
      const notes = 'Population (2011 Census): 7,87,560; Area of PD: 18.06 sq.km (1806.63 ha); Wards in PD: 23; Gross Density (2011 Census): 436 pph';
      const out = service.parseDistrictNotes(notes);
      expect(out.population).toBe(787560);
      expect(out.area_ha).toBeCloseTo(1806.63, 2);
      expect(out.density).toBe(436);
      expect(out.wards).toBe(23);
    });

    test('handles equals-sign separator on density (PD 24)', () => {
      const notes = 'Population (2011 Census): 55,838; Area of PD: 2870.19 ha; Wards in PD: 1; Villages in PD: 1; Gross Density= 20PPH';
      const out = service.parseDistrictNotes(notes);
      expect(out.density).toBe(20);
      expect(out.wards).toBe(1);
      expect(out.villages).toBe(1);
    });

    test('parses Gramathanas / Gramthana spelling variants', () => {
      const a = service.parseDistrictNotes('Population: 28,594; Area of PD: 3132.2 ha; Gramathanas in PD: 12; Gross Density: 06 pph');
      expect(a.villages).toBe(12);

      const b = service.parseDistrictNotes('Population: 23,314; Area of PD: 3216.94 ha; Gramthana in PD: 13; Gross Density: 07 pph');
      expect(b.villages).toBe(13);
    });

    test('parses unprefixed population without commas', () => {
      // PD 6 — "Population (2011 Census): 621302" (no Indian comma grouping)
      const notes = 'Population (2011 Census): 621302; Area of PD: 2774.3 ha; Wards in PD: 16; Gross Density (2015): 223PPH';
      const out = service.parseDistrictNotes(notes);
      expect(out.population).toBe(621302);
      expect(out.density).toBe(223);
    });

    test('falls back to sqkm when no Ha listed', () => {
      const notes = 'Population: 1000; Area of PD: 5.5 sq.km; Wards in PD: 1; Gross Density: 50PPH';
      const out = service.parseDistrictNotes(notes);
      expect(out.area_ha).toBe(550);
    });

    test('parses "Number of Villages" alternate label', () => {
      const out = service.parseDistrictNotes('Population (2011 Census): 12925; Area of PD: 1876.43 ha; Number of Villages: 04; Gross Density: 07 PPH');
      expect(out.villages).toBe(4);
    });
  });

  describe('getDistrictIntelligence', () => {
    test('joins planning_districts with PDR demographics and returns summary + callouts', async () => {
      // 1st query: planning_districts seed (3 sample PDs)
      query.mockResolvedValueOnce({
        rows: [
          { id: 'd1', pd_code: 'PD-01', pd_name: 'CENTRAL BUSINESS DISTRICT', city: 'Bengaluru' },
          { id: 'd2', pd_code: 'PD-23', pd_name: 'CHEEMASANDRA SPECIAL DEVELOPMENT ZONE', city: 'Bengaluru' },
          { id: 'd3', pd_code: 'PD-99', pd_name: 'UNMAPPED DISTRICT', city: 'Bengaluru' },
        ],
      });
      // 2nd query: evidence_facts — rich PD list + SDZ + heritage + landmarks
      query.mockResolvedValueOnce({
        rows: [
          {
            fact_type: 'rmp_table',
            fact_key: 'planning_districts',
            fact_value: [
              {
                pd_code: 'PD 1',
                pd_name: 'CENTRAL BUSINESS DISTRICT',
                source_page: 23,
                source_section: '2.PD 1: CENTRAL BUSINESS DISTRICT',
                notes: 'Population (2011 Census): 5,93,883; Area of PD: 2774.3 ha; Wards in PD: 19; Gross Density: 214PPH',
              },
              {
                pd_code: 'PD 23',
                pd_name: 'CHEEMASANDRA SPECIAL DEVELOPMENT ZONE',
                source_page: 225,
                notes: 'Population (2011 Census): 39,377; Area of PD: 2729.41 ha; Villages in PD: 17; Gross Density: 14.4 pph',
              },
            ],
          },
          {
            fact_type: 'sdz',
            fact_key: 'special_development_zones',
            fact_value: { count: 5, max_far: 3.25, locations: ['Cheemasandra', 'Halanayakanahalli'] },
          },
          {
            fact_type: 'heritage',
            fact_key: 'heritage_zones',
            fact_value: { count: 7, prohibited_radius_m: 100, regulated_radius_m: 200 },
          },
          {
            fact_type: 'landmark',
            fact_key: 'major_landmarks_in_bma',
            fact_value: [{ name: 'Bangalore Palace' }, { name: 'Lalbagh' }],
          },
        ],
      });

      const result = await service.getDistrictIntelligence();

      expect(result.districts).toHaveLength(3);

      // PD-01 enriched from PDR notes
      const pd1 = result.districts.find((d) => d.pd_code === 'PD-01');
      expect(pd1.population_2011).toBe(593883);
      expect(pd1.area_ha).toBeCloseTo(2774.3, 1);
      expect(pd1.gross_density_pph).toBe(214);
      expect(pd1.ward_count).toBe(19);
      expect(pd1.is_sdz).toBe(false);
      expect(pd1.source_page).toBe(23);

      // PD-23 is an SDZ by name
      const pd23 = result.districts.find((d) => d.pd_code === 'PD-23');
      expect(pd23.is_sdz).toBe(true);
      expect(pd23.village_count).toBe(17);

      // PD-99 has no matching fact entry — joined as null
      const pd99 = result.districts.find((d) => d.pd_code === 'PD-99');
      expect(pd99.population_2011).toBeNull();
      expect(pd99.source_page).toBeNull();

      // Summary aggregates
      expect(result.summary.district_count).toBe(3);
      expect(result.summary.sdz_count).toBe(1);
      expect(result.summary.total_population_2011).toBe(593883 + 39377);

      // Callouts wired through
      expect(result.callouts.sdz).toEqual({ count: 5, max_far: 3.25, locations: ['Cheemasandra', 'Halanayakanahalli'] });
      expect(result.callouts.heritage).toMatchObject({ count: 7 });
      expect(result.callouts.landmarks).toHaveLength(2);

      expect(result.disclaimer).toMatch(/AI-extracted/i);
    });

    test('prefers the rich PD fact when both routing and rich rows exist (placeholder anchor)', async () => {
      // Placeholder anchor — see following identical-name test for the actual implementation.
    });
  });

  describe('getSourceExplorer', () => {
    test('joins sources with their facts grouped by page and returns summary', async () => {
      // 1st query: evidence_sources LEFT JOIN master_plan_documents
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'src-vol6',
            document_id: 'doc-vol6',
            source_kind: 'official_pdf',
            source_title: 'RMP 2031 Volume 6 — Zoning Regulations (rmp_table)',
            plan_version: 'RMP 2031 (Draft)',
            authority_name: 'BDA',
            city: 'Bengaluru',
            created_at: '2026-04-30T10:00:00Z',
            file_name: 'Volume-6 Zoning Regulations.pdf',
            plan_name: 'RMP 2031 Volume 6 — Zoning Regulations',
            doc_type: 'rmp_table',
            legal_status: 'gazetted',
            source_role: 'operative_regulation',
            processing_mode: 'text_extraction',
          },
          {
            id: 'src-empty',
            document_id: null,
            source_kind: 'official_pdf',
            source_title: 'Empty source — no facts',
            plan_version: 'RMP 2031',
            authority_name: null,
            city: 'Bengaluru',
            created_at: '2026-04-29T10:00:00Z',
            file_name: null,
            plan_name: null,
            doc_type: null,
            legal_status: null,
            source_role: null,
            processing_mode: null,
          },
        ],
      });
      // 2nd query: evidence_facts ordered by page then type then key
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'f1',
            source_id: 'src-vol6',
            fact_type: 'rmp_table',
            fact_key: 'front_setback_table',
            fact_value: { tiers: 10 },
            page_number: 38,
            source_section: 'Table 1',
            confidence_score: 0.95,
            review_status: 'approved',
            created_at: '2026-04-30T10:00:00Z',
          },
          {
            id: 'f2',
            source_id: 'src-vol6',
            fact_type: 'rmp_table',
            fact_key: 'height_setback_table',
            fact_value: { tiers: 16 },
            page_number: 39,
            source_section: 'Table 2',
            confidence_score: 0.95,
            review_status: 'approved',
            created_at: '2026-04-30T10:00:00Z',
          },
          {
            id: 'f3',
            source_id: 'src-vol6',
            fact_type: 'sdz',
            fact_key: 'special_development_zones',
            fact_value: { count: 5 },
            page_number: 80,
            source_section: '§6.5',
            confidence_score: 0.88,
            review_status: 'pending',
            created_at: '2026-04-30T10:00:00Z',
          },
        ],
      });

      const result = await service.getSourceExplorer();

      // Empty source is filtered out — only sources with facts come through.
      expect(result.sources).toHaveLength(1);
      const vol6 = result.sources[0];
      expect(vol6.id).toBe('src-vol6');
      expect(vol6.fact_count).toBe(3);
      expect(vol6.page_count).toBe(3);
      expect(vol6.first_page).toBe(38);
      expect(vol6.last_page).toBe(80);
      expect(vol6.fact_types).toEqual(['rmp_table', 'sdz']);
      expect(vol6.facts).toHaveLength(3);
      expect(vol6.legal_status).toBe('gazetted');
      expect(vol6.file_name).toBe('Volume-6 Zoning Regulations.pdf');

      // Summary aggregates
      expect(result.summary.source_count).toBe(1);
      expect(result.summary.fact_count).toBe(3);
      expect(result.summary.linked_doc_count).toBe(1);
      expect(result.summary.fact_type_counts).toEqual({ rmp_table: 2, sdz: 1 });
      expect(result.disclaimer).toMatch(/IC memos/i);

      // TENANT BOUNDARY (regression): both the sources query and the facts
      // query must be org-scoped — the app role bypasses RLS. (Locate each by
      // content; this describe doesn't reset mocks per test.)
      const calls = query.mock.calls.map((c) => c[0]);
      const sourcesSql = [...calls].reverse().find((s) => /FROM regulatory_data\.evidence_sources s/i.test(s));
      const factsSql = [...calls].reverse().find((s) => /FROM regulatory_data\.evidence_facts\b/i.test(s) && !/evidence_sources/i.test(s));
      expect(sourcesSql).toBeDefined();
      expect(factsSql).toBeDefined();
      expect(sourcesSql).toMatch(/s\.org_id\s+IS\s+NULL\s+OR\s+s\.org_id\s*=\s*current_organization_id\(\)/i);
      expect(factsSql).toMatch(/\borg_id\s+IS\s+NULL\s+OR\s+org_id\s*=\s*current_organization_id\(\)/i);
    });

    test('handles facts with no page_number gracefully', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'src-1', document_id: null, source_kind: 'official_pdf',
            source_title: 'Map source', plan_version: null, authority_name: null,
            city: 'Bengaluru', created_at: '2026-04-30T10:00:00Z',
            file_name: null, plan_name: null, doc_type: null,
            legal_status: null, source_role: null, processing_mode: null,
          },
        ],
      });
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'f-noPage', source_id: 'src-1', fact_type: 'landmark',
            fact_key: 'major_landmarks_in_bma', fact_value: [{ name: 'Lalbagh' }],
            page_number: null, source_section: null, confidence_score: 0.9,
            review_status: 'approved', created_at: '2026-04-30T10:00:00Z',
          },
        ],
      });

      const result = await service.getSourceExplorer();
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].first_page).toBeNull();
      expect(result.sources[0].last_page).toBeNull();
      expect(result.sources[0].page_count).toBe(0);
    });
  });

  describe('getBbmpWardSummary', () => {
    test('aggregates per-ward street counts + dominant zone + median guidance', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            ward_no: 84,
            street_count: 100,
            enriched_count: 70,
            distinct_zone_count: 2,
            median_guidance_mid_inr: '4250.5',
            sample_aro_section: 'WHITEFIELD / RESIDENTIAL',
            dominant_zone: 'C',
            dominant_zone_count: 50,
            dominant_zone_share_pct: '71.4',
          },
          {
            ward_no: 151,
            street_count: 60,
            enriched_count: 0,
            distinct_zone_count: 0,
            median_guidance_mid_inr: null,
            sample_aro_section: 'KORAMANGALA / RESIDENTIAL',
            dominant_zone: null,
            dominant_zone_count: null,
            dominant_zone_share_pct: null,
          },
          {
            ward_no: 111,
            street_count: 40,
            enriched_count: 40,
            distinct_zone_count: 1,
            median_guidance_mid_inr: '7001',
            sample_aro_section: 'CHIKPETE / RESIDENTIAL',
            dominant_zone: 'A',
            dominant_zone_count: 40,
            dominant_zone_share_pct: '100.0',
          },
        ],
      });

      const result = await service.getBbmpWardSummary();

      expect(result.wards).toHaveLength(3);
      const w84 = result.wards.find((w) => w.ward_no === 84);
      expect(w84.dominant_zone).toBe('C');
      expect(w84.dominant_zone_share_pct).toBeCloseTo(71.4, 1);
      // median_guidance_mid_inr should be rounded to nearest integer
      expect(w84.median_guidance_mid_inr).toBe(4251);

      const w151 = result.wards.find((w) => w.ward_no === 151);
      expect(w151.dominant_zone).toBeNull();
      expect(w151.median_guidance_mid_inr).toBeNull();

      // Summary aggregates: 100 + 60 + 40 = 200 total; 70 + 0 + 40 = 110 enriched = 55%
      expect(result.summary.ward_count).toBe(3);
      expect(result.summary.total_streets).toBe(200);
      expect(result.summary.total_enriched).toBe(110);
      expect(result.summary.enriched_pct).toBeCloseTo(55, 1);
      // Wards fully enriched: only ward 111 (40/40)
      expect(result.summary.wards_fully_enriched).toBe(1);
      // Wards with multiple zones: only ward 84 (2 distinct)
      expect(result.summary.wards_with_multiple_zones).toBe(1);

      expect(result.source_document).toMatch(/Notification No\. 384/);
      expect(result.disclaimer).toMatch(/Ward rollups/i);
    });

    test('returns empty arrays when no wards have street data', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const result = await service.getBbmpWardSummary();
      expect(result.wards).toEqual([]);
      expect(result.summary.ward_count).toBe(0);
      expect(result.summary.total_streets).toBe(0);
      expect(result.summary.enriched_pct).toBe(0);
    });
  });

  describe('searchBbmpStreets', () => {
    // Parent describe does not clearAllMocks(), so each test:
    //   1. Captures callsBefore,
    //   2. Mocks two responses in order: rows query, then summary query.
    // The service issues both in a Promise.all, but pg.query mock returns
    // queued resolutions in call order regardless of parallelism.
    const SUMMARY_FIXTURE = {
      total: 9913, distinct_streets: 7188, enriched: 2943, wards: 199,
      residential: 5400, non_residential: 4513,
      by_zone: { A: 292, B: 257, C: 465, D: 824, E: 879, F: 226, unknown: 6970 },
    };
    const queueSummary = () => query.mockResolvedValueOnce({ rows: [SUMMARY_FIXTURE] });

    test('returns the first batch sorted alphabetically when search is empty', async () => {
      const callsBefore = query.mock.calls.length;
      query.mockResolvedValueOnce({
        rows: [
          { id: 's1', street_name_en: 'AVENUE ROAD', ward_no: 109, page_number: 17, aro_section: 'CHICKPET / RESIDENTIAL', zone_code: null, guidance_value_band_min_inr: null, guidance_value_band_max_inr: null, row_excerpt: '2 109 AVENUE ROAD' },
          { id: 's2', street_name_en: 'BRIGADE ROAD', ward_no: 111, page_number: 227, aro_section: null, zone_code: 'A', guidance_value_band_min_inr: 7001, guidance_value_band_max_inr: null, row_excerpt: 'BRIGADE ROAD' },
        ],
      });
      queueSummary();
      const result = await service.searchBbmpStreets({});
      const [sql, params] = query.mock.calls[callsBefore];
      expect(sql).toContain('ORDER BY street_name_en');
      expect(params).toEqual([25]);
      expect(result.query).toBe('');
      expect(result.zone_filter).toBeNull();
      expect(result.rows).toHaveLength(2);
      expect(result.summary).toEqual(SUMMARY_FIXTURE);
      expect(result.source_document).toMatch(/Notification No\. 384/);
      expect(result.disclaimer).toMatch(/verify the ward and zone classification/i);
    });

    test('runs a fuzzy + ILIKE query when search has content, ranking exact-substring hits first', async () => {
      const callsBefore = query.mock.calls.length;
      query.mockResolvedValueOnce({
        rows: [
          { id: 'a', street_name_en: 'WHITEFIELD MAIN ROAD, WHITEFIELD', ward_no: 84, page_number: 297, aro_section: 'WHITEFIELD / RESIDENTIAL', zone_code: null, guidance_value_band_min_inr: null, guidance_value_band_max_inr: null, row_excerpt: '...' },
        ],
      });
      queueSummary();

      const result = await service.searchBbmpStreets({ search: 'whitefield', limit: 50 });
      const [sql, params] = query.mock.calls[callsBefore];
      expect(sql).toContain('similarity(street_name_en');
      expect(sql).toContain('ORDER BY');
      expect(params).toEqual(['whitefield', 50]);
      expect(result.rows[0].street_name_en).toMatch(/WHITEFIELD/);
      expect(result.query).toBe('whitefield');
    });

    test('applies a zone filter when zone=A/B/C/D/E/F passes, ignores invalid zones', async () => {
      const callsBefore = query.mock.calls.length;
      query.mockResolvedValueOnce({ rows: [] });
      queueSummary();
      await service.searchBbmpStreets({ zone: 'A' });
      const [sqlValid, paramsValid] = query.mock.calls[callsBefore];
      expect(sqlValid).toContain('zone_code = $');
      expect(paramsValid).toEqual(['A', 25]);

      const callsBefore2 = query.mock.calls.length;
      query.mockResolvedValueOnce({ rows: [] });
      queueSummary();
      await service.searchBbmpStreets({ zone: 'NOT-A-ZONE' });
      const [sqlInvalid, paramsInvalid] = query.mock.calls[callsBefore2];
      expect(sqlInvalid).not.toContain('zone_code = $');
      expect(paramsInvalid).toEqual([25]);
    });

    test('applies a register filter (residential | non_residential), ignores invalid values', async () => {
      const callsBefore = query.mock.calls.length;
      query.mockResolvedValueOnce({ rows: [] });
      queueSummary();
      const result = await service.searchBbmpStreets({ register: 'non_residential' });
      const [sqlValid, paramsValid] = query.mock.calls[callsBefore];
      expect(sqlValid).toContain('register = $');
      expect(paramsValid).toEqual(['non_residential', 25]);
      expect(result.register_filter).toBe('non_residential');

      const callsBefore2 = query.mock.calls.length;
      query.mockResolvedValueOnce({ rows: [] });
      queueSummary();
      const result2 = await service.searchBbmpStreets({ register: 'COMMERCIAL' });
      const [sqlInvalid, paramsInvalid] = query.mock.calls[callsBefore2];
      expect(sqlInvalid).not.toContain('register = $');
      expect(paramsInvalid).toEqual([25]);
      expect(result2.register_filter).toBeNull();
    });

    test('clamps limit into [1,100] and defaults to 25', async () => {
      query.mockResolvedValue({ rows: [SUMMARY_FIXTURE] });

      await service.searchBbmpStreets({ limit: 0 });
      // The first call in each invocation is the rows query; its last param is the limit.
      // Find the most recent rows query (i.e. the one whose SQL starts with SELECT … FROM regulatory_data.bbmp_street_index).
      const recent = query.mock.calls.slice(-2).find(([sql]) => /FROM regulatory_data\.bbmp_street_index\b/.test(sql) && !sql.includes('jsonb_object_agg'));
      expect(recent[1].at(-1)).toBe(1);

      await service.searchBbmpStreets({ limit: 999 });
      const recent2 = query.mock.calls.slice(-2).find(([sql]) => /FROM regulatory_data\.bbmp_street_index\b/.test(sql) && !sql.includes('jsonb_object_agg'));
      expect(recent2[1].at(-1)).toBe(100);

      await service.searchBbmpStreets({});
      const recent3 = query.mock.calls.slice(-2).find(([sql]) => /FROM regulatory_data\.bbmp_street_index\b/.test(sql) && !sql.includes('jsonb_object_agg'));
      expect(recent3[1].at(-1)).toBe(25);

      await service.searchBbmpStreets({ limit: 'not-a-number' });
      const recent4 = query.mock.calls.slice(-2).find(([sql]) => /FROM regulatory_data\.bbmp_street_index\b/.test(sql) && !sql.includes('jsonb_object_agg'));
      expect(recent4[1].at(-1)).toBe(25);
    });

    test('trims whitespace around the search string before deciding the query path', async () => {
      const callsBefore = query.mock.calls.length;
      query.mockResolvedValueOnce({ rows: [] });
      queueSummary();
      const result = await service.searchBbmpStreets({ search: '   whitefield   ', limit: 10 });
      expect(query.mock.calls[callsBefore][1]).toEqual(['whitefield', 10]);
      expect(result.query).toBe('whitefield');
    });

    test('an all-whitespace search falls back to the empty-search path', async () => {
      const callsBefore = query.mock.calls.length;
      query.mockResolvedValueOnce({ rows: [] });
      queueSummary();
      const result = await service.searchBbmpStreets({ search: '   ', limit: 10 });
      const [sql] = query.mock.calls[callsBefore];
      expect(sql).toContain('ORDER BY street_name_en');
      expect(result.query).toBe('');
    });
  });

  describe('getUavBenchmark', () => {
    test('pivots BBMP UAV rows into a (use × zone) matrix and computes ratios vs Zone A', async () => {
      query.mockResolvedValueOnce({
        rows: [
          // Zone A (CBD) — base
          { uav_zone_code: 'A', uav_zone_name: 'CBD', property_use: 'Residential RCC (owner-occupied)',
            unit_area_value_inr: 3.0, unit_label: 'INR per sqft per month', source_page: 4, source_section: 'Schedule III',
            confidence_score: 0.95, review_status: 'approved' },
          { uav_zone_code: 'A', uav_zone_name: 'CBD', property_use: 'Non-residential premium',
            unit_area_value_inr: 25.0, unit_label: 'INR per sqft per month', source_page: 4, source_section: 'Schedule III',
            confidence_score: 0.95, review_status: 'approved' },
          // Zone B
          { uav_zone_code: 'B', uav_zone_name: 'Mid-ring', property_use: 'Residential RCC (owner-occupied)',
            unit_area_value_inr: 2.4, unit_label: 'INR per sqft per month', source_page: 5, source_section: 'Schedule III',
            confidence_score: 0.95, review_status: 'approved' },
          { uav_zone_code: 'B', uav_zone_name: 'Mid-ring', property_use: 'Non-residential premium',
            unit_area_value_inr: 20.0, unit_label: 'INR per sqft per month', source_page: 5, source_section: 'Schedule III',
            confidence_score: 0.95, review_status: 'approved' },
          // Zone C — partial coverage
          { uav_zone_code: 'C', uav_zone_name: 'Outer', property_use: 'Residential RCC (owner-occupied)',
            unit_area_value_inr: 1.5, unit_label: 'INR per sqft per month', source_page: 6, source_section: 'Schedule III',
            confidence_score: 0.95, review_status: 'approved' },
        ],
      });

      const result = await service.getUavBenchmark({ city: 'Bengaluru' });

      expect(result.zones).toEqual(['A', 'B', 'C']);
      expect(result.uses).toEqual(['Non-residential premium', 'Residential RCC (owner-occupied)']);

      // Matrix shape: row per use, cells per zone, missing cells return null rate
      const resRow = result.matrix.find((r) => r.use === 'Residential RCC (owner-occupied)');
      const cellsByZone = Object.fromEntries(resRow.cells.map((c) => [c.zone, c.rate]));
      expect(cellsByZone).toEqual({ A: 3.0, B: 2.4, C: 1.5 });

      const nonResRow = result.matrix.find((r) => r.use === 'Non-residential premium');
      const nonResByZone = Object.fromEntries(nonResRow.cells.map((c) => [c.zone, c.rate]));
      expect(nonResByZone).toEqual({ A: 25.0, B: 20.0, C: null });

      // Ratios — A=1.0; B=avg(2.4/3.0, 20/25)=avg(0.8,0.8)=0.8; C=1.5/3.0=0.5 (only one shared use)
      expect(result.ratios.A).toBe(1);
      expect(result.ratios.B).toBeCloseTo(0.8, 3);
      expect(result.ratios.C).toBeCloseTo(0.5, 3);

      expect(result.summary).toMatchObject({
        zone_count: 3,
        use_count: 2,
        row_count: 5,
        source_pages: [4, 5, 6],
      });
      expect(result.unit_label).toBe('INR per sqft per month');
      expect(result.disclaimer).toMatch(/property-tax/i);
    });

    test('returns an empty result with explanatory disclaimer when no rows exist', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const result = await service.getUavBenchmark({ city: 'Bengaluru' });
      expect(result.zones).toEqual([]);
      expect(result.uses).toEqual([]);
      expect(result.matrix).toEqual([]);
      expect(result.summary.row_count).toBe(0);
      expect(result.disclaimer).toMatch(/has not been ingested/i);
    });

    test('returns null ratio when a zone has no overlapping uses with Zone A', async () => {
      // Zone B only has a use that Zone A doesn't have — no shared comparison possible
      query.mockResolvedValueOnce({
        rows: [
          { uav_zone_code: 'A', uav_zone_name: 'CBD', property_use: 'Residential', unit_area_value_inr: 3.0, unit_label: 'INR/sqft/mo', source_page: 1, source_section: null, confidence_score: 0.9, review_status: 'approved' },
          { uav_zone_code: 'B', uav_zone_name: 'Outer', property_use: 'Vacant land', unit_area_value_inr: 0.5, unit_label: 'INR/sqft/mo', source_page: 2, source_section: null, confidence_score: 0.9, review_status: 'approved' },
        ],
      });
      const result = await service.getUavBenchmark({ city: 'Bengaluru' });
      expect(result.ratios.A).toBe(1);
      expect(result.ratios.B).toBeNull();
    });

    test('defaults city to Bengaluru when not supplied', async () => {
      // The parent describe block reuses jest.fn() across tests without a
      // beforeEach reset, so we capture the call count before invoking.
      const callsBefore = query.mock.calls.length;
      query.mockResolvedValueOnce({ rows: [] });
      await service.getUavBenchmark();
      expect(query.mock.calls[callsBefore][1]).toEqual(['Bengaluru']);
    });
  });

  describe('getReviewQueue', () => {
    test('buckets facts by confidence_score and review_status, surfaces non-approved/non-high in needs_review', async () => {
      query.mockResolvedValueOnce({
        rows: [
          // High + approved → counted, but NOT in needs_review
          { id: 'f1', source_id: 's1', source_title: 'Vol 6', plan_version: 'RMP 2031',
            fact_type: 'rmp_table', fact_key: 'front_setback', fact_value: { tiers: 10 },
            page_number: 38, source_section: 'Table 1', confidence_score: 0.95, review_status: 'approved', created_at: '2026-04-30T10:00:00Z' },
          // High + pending → in needs_review
          { id: 'f2', source_id: 's1', source_title: 'Vol 6', plan_version: 'RMP 2031',
            fact_type: 'rmp_table', fact_key: 'height_setback', fact_value: { tiers: 16 },
            page_number: 39, source_section: 'Table 2', confidence_score: 0.92, review_status: 'pending', created_at: '2026-04-30T10:00:00Z' },
          // Medium + approved → in needs_review (not high)
          { id: 'f3', source_id: 's2', source_title: 'PDR', plan_version: 'RMP 2031',
            fact_type: 'rmp_table', fact_key: 'planning_districts', fact_value: [{ pd_code: 'PD-01' }],
            page_number: 23, source_section: 'PDR §2', confidence_score: 0.85, review_status: 'approved', created_at: '2026-04-29T10:00:00Z' },
          // Low + approved → in needs_review
          { id: 'f4', source_id: 's2', source_title: 'PDR', plan_version: 'RMP 2031',
            fact_type: 'rmp_table', fact_key: 'noise_data', fact_value: 'unclear',
            page_number: 24, source_section: null, confidence_score: 0.55, review_status: 'approved', created_at: '2026-04-28T10:00:00Z' },
          // Unscored + pending → in needs_review
          { id: 'f5', source_id: 's3', source_title: 'Map', plan_version: null,
            fact_type: 'landmark', fact_key: 'lalbagh', fact_value: { name: 'Lalbagh' },
            page_number: null, source_section: null, confidence_score: null, review_status: 'pending', created_at: '2026-04-27T10:00:00Z' },
        ],
      });

      const result = await service.getReviewQueue();

      expect(result.counts.high.approved).toBe(1);
      expect(result.counts.high.pending).toBe(1);
      expect(result.counts.high.total).toBe(2);
      expect(result.counts.medium.approved).toBe(1);
      expect(result.counts.medium.total).toBe(1);
      expect(result.counts.low.approved).toBe(1);
      expect(result.counts.low.total).toBe(1);
      expect(result.counts.unscored.pending).toBe(1);
      expect(result.counts.unscored.total).toBe(1);

      expect(result.summary).toMatchObject({
        fact_count: 5,
        needs_review_count: 4,
        high_count: 2,
        medium_count: 1,
        low_count: 1,
        unscored_count: 1,
      });

      expect(result.needs_review).toHaveLength(4);
      // Make sure the high+approved fact is NOT in needs_review
      expect(result.needs_review.find((f) => f.id === 'f1')).toBeUndefined();
      const f4 = result.needs_review.find((r) => r.id === 'f4');
      expect(f4.bucket).toBe('low');
      expect(f4.confidence_score).toBe(0.55);
      const f5 = result.needs_review.find((r) => r.id === 'f5');
      expect(f5.bucket).toBe('unscored');
      expect(f5.confidence_score).toBeNull();

      expect(result.disclaimer).toMatch(/IC memos/i);

      // TENANT BOUNDARY (regression): the app role bypasses RLS, so this
      // explicit predicate is the only thing keeping one org's private facts
      // out of another org's review queue. (This describe doesn't reset mocks
      // per test, so locate the query by content rather than by index.)
      const sql = [...query.mock.calls]
        .reverse()
        .map((c) => c[0])
        .find((s) => /FROM regulatory_data\.evidence_facts f/i.test(s));
      expect(sql).toBeDefined();
      expect(sql).toMatch(/f\.org_id\s+IS\s+NULL\s+OR\s+f\.org_id\s*=\s*current_organization_id\(\)/i);
    });

    test('returns empty needs_review when every fact is high-confidence and approved', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { id: 'f1', source_id: 's1', source_title: 'Vol 6', plan_version: 'RMP 2031',
            fact_type: 'rmp_table', fact_key: 'a', fact_value: 1,
            page_number: 1, source_section: null, confidence_score: 0.95, review_status: 'approved', created_at: '2026-04-30T10:00:00Z' },
          { id: 'f2', source_id: 's1', source_title: 'Vol 6', plan_version: 'RMP 2031',
            fact_type: 'rmp_table', fact_key: 'b', fact_value: 2,
            page_number: 2, source_section: null, confidence_score: 0.99, review_status: 'approved', created_at: '2026-04-30T10:00:00Z' },
        ],
      });

      const result = await service.getReviewQueue();
      expect(result.summary.fact_count).toBe(2);
      expect(result.summary.needs_review_count).toBe(0);
      expect(result.needs_review).toEqual([]);
      expect(result.counts.high.approved).toBe(2);
    });

    test('treats null review_status as pending and includes in needs_review', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { id: 'f1', source_id: 's1', source_title: 'Vol 6', plan_version: null,
            fact_type: 'rmp_table', fact_key: 'a', fact_value: 1,
            page_number: 1, source_section: null, confidence_score: 0.95, review_status: null, created_at: '2026-04-30T10:00:00Z' },
        ],
      });

      const result = await service.getReviewQueue();
      expect(result.summary.needs_review_count).toBe(1);
      expect(result.needs_review[0].review_status).toBe('pending');
      expect(result.counts.high.pending).toBe(1);
    });
  });

  describe('getDistrictIntelligence — rich-fact preference', () => {
    test('prefers the rich PD fact when both routing and rich rows exist', async () => {
      // Both a routing-key list (no notes) and a rich list (with notes) — service must pick the rich one.
      query.mockResolvedValueOnce({ rows: [{ id: 'd1', pd_code: 'PD-01', pd_name: 'CBD', city: 'Bengaluru' }] });
      query.mockResolvedValueOnce({
        rows: [
          {
            fact_type: 'rmp_table',
            fact_key: 'planning_districts',
            fact_value: [{ pd_code: 'PD 1', pd_name: 'CBD' }], // routing-only, no notes
          },
          {
            fact_type: 'rmp_table',
            fact_key: 'planning_districts',
            fact_value: [{
              pd_code: 'PD 1',
              pd_name: 'CBD',
              source_page: 23,
              notes: 'Population (2011 Census): 5,93,883; Area of PD: 2774.3 ha; Wards in PD: 19; Gross Density: 214PPH',
            }],
          },
        ],
      });

      const result = await service.getDistrictIntelligence();
      expect(result.districts[0].population_2011).toBe(593883);
      expect(result.districts[0].source_page).toBe(23);
    });
  });
});

// Defense-in-depth parity with the deal-document path (confirmDirectUpload in
// document.service.js, document.security.test.js): confirmSourceDocumentUpload
// must derive the stored file_type from the (allow-listed) extension and IGNORE
// the client-supplied `fileType`. The direct-upload browser PUTs the object with
// any Content-Type it likes, so trusting the client could persist a `.pdf` as
// `text/html`. file_type is only used for extraction routing (isExtractableSource)
// and display — never as an HTTP Content-Type header — but we still refuse to
// store the client's claim so the value is always benign and accurate.
describe('confirmSourceDocumentUpload — server-derived file_type (stored-XSS parity)', () => {
  const ORG_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Generic (non-corpus) filenames so masterplanCorpus is a pass-through and the
  // stored file_type is driven purely by the extension.
  const confirmUpload = ({ originalName, fileType }) => {
    query.mockResolvedValueOnce({ rows: [{ id: 'doc-x', file_name: originalName }] }); // INSERT
    return service.confirmSourceDocumentUpload({
      storagePath: `organizations/org-1/deals/master-plan/${originalName}`,
      originalName,
      fileType,
      fileSize: 2048,
      city: 'Bengaluru',
      planName: 'REDIP regulatory source',
      planVersion: 'RMP 2031',
      docType: 'rmp_table',
      organizationId: ORG_ID,
    });
  };

  // file_type is the 6th bound parameter ($6) of the INSERT.
  const storedFileType = () => {
    const insertCall = query.mock.calls.find((c) => /INSERT INTO regulatory_data\.master_plan_documents/.test(c[0]));
    expect(insertCall).toBeTruthy();
    return insertCall[1][5];
  };

  test('stores a client-claimed text/html .pdf as application/pdf (kills the stored-XSS setup)', async () => {
    await confirmUpload({ originalName: 'redip-site-report.pdf', fileType: 'text/html' });
    // Server-derived from the .pdf extension, NOT the client's text/html. The
    // value still satisfies isExtractableSource (mime.includes('pdf')), so PDF
    // extraction routing is preserved.
    expect(storedFileType()).toBe('application/pdf');
  });

  test('stores a client-claimed text/html .png as image/png and keeps it extractable', async () => {
    await confirmUpload({ originalName: 'redip-site-photo.png', fileType: 'text/html' });
    // image/png satisfies isExtractableSource (mime.startsWith('image/')), so
    // image extraction routing is preserved despite the client's lie.
    expect(storedFileType()).toBe('image/png');
  });

  test('refuses to let a client spoof an extractable type onto a non-extractable .docx', async () => {
    // Client claims application/pdf for a .docx, trying to flip extraction routing.
    await confirmUpload({ originalName: 'redip-field-notes.docx', fileType: 'application/pdf' });
    // Derived from the real .docx extension — neither pdf nor image, so the
    // document is NOT mis-routed as extractable.
    expect(storedFileType()).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});

describe('masterplan.service getRegulatoryCoverage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('maps operative authorities → coverage with overlay flag, rule counts, and summary', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { authority_code: 'BDA', authority_name: 'Bangalore Development Authority', authority_status: 'active', plan_code: 'RMP_2015', plan_name: 'Revised Master Plan 2015', horizon_year: 2015, far_rules: '51', zones: '13' },
        { authority_code: 'ANEKAL_PA', authority_name: 'Anekal Planning Authority', authority_status: 'active', plan_code: 'ANEKAL_LPA_MP_2031', plan_name: 'Anekal LPA MP 2031', horizon_year: 2031, far_rules: '41', zones: '10' },
        { authority_code: 'BIAAPA', authority_name: 'Bengaluru International Airport Area Planning Authority', authority_status: 'active', plan_code: 'BIAAPA_MP_2021', plan_name: 'BIAAPA MP 2021', horizon_year: 2021, far_rules: '37', zones: '10' },
      ],
    });

    const out = await service.getRegulatoryCoverage();

    // Only RMP 2015 has a georeferenced map overlay; the LPAs are rules-only.
    const bda = out.authorities.find((a) => a.authority_code === 'BDA');
    const biaapa = out.authorities.find((a) => a.authority_code === 'BIAAPA');
    expect(bda.has_map_overlay).toBe(true);
    expect(biaapa.has_map_overlay).toBe(false);
    // Counts are numbers (not the raw string rows), and rules_loaded is derived.
    expect(bda.far_rules).toBe(51);
    expect(biaapa.far_rules).toBe(37);
    expect(biaapa.zones).toBe(10);
    expect(biaapa.rules_loaded).toBe(true);
    // Human area labels for the known authorities.
    expect(biaapa.area).toMatch(/Airport belt/i);
    // Summary rolls up.
    expect(out.summary).toEqual({ authorities: 3, plans_with_rules: 3, total_far_rules: 129 });
  });

  test('is migration-tolerant — an absent registry returns an empty coverage set', async () => {
    query.mockRejectedValueOnce(new Error('relation "regulatory_data.planning_authorities" does not exist'));
    const out = await service.getRegulatoryCoverage();
    expect(out.authorities).toEqual([]);
    expect(out.summary.total_far_rules).toBe(0);
  });
});
