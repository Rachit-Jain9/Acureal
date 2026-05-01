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
      'provisional',
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

  test('listMasterplanCorpus returns 12 entries with upload status from listDocuments', async () => {
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
    expect(result).toHaveLength(12);
    const vol6 = result.find((row) => row.canonical_name === 'volume-6-zoning-regulations.pdf');
    const guidance = result.find((row) => row.canonical_name === 'guidance-value.pdf');
    expect(vol6.uploaded).toBe(true);
    expect(vol6.document.id).toBe('doc-vol6');
    expect(guidance.uploaded).toBe(false);
    expect(guidance.doc_type).toBe('bbmp_uav_pdf');
  });
});
