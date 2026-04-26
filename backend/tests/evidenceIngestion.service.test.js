jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const service = require('../src/services/evidenceIngestion.service');

const mockQueryForExtraction = (row, sourceId = 'source-1') => {
  query.mockImplementation((sql) => {
    if (sql.includes('FROM document_extractions de')) {
      return Promise.resolve({ rows: [row] });
    }
    if (sql.includes('FROM regulatory_data.evidence_sources')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('INSERT INTO regulatory_data.evidence_sources')) {
      return Promise.resolve({ rows: [{ id: sourceId }] });
    }
    if (sql.includes('FROM regulatory_data.guidance_values')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('FROM regulatory_data.far_rules')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
};

describe('evidenceIngestion.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('turns a guidance-value extraction into pending evidence and guidance rows', async () => {
    mockQueryForExtraction({
      id: 'extraction-1',
      document_id: 'document-1',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'Guidance Value.pdf',
      document_file_url: 'https://example.com/guidance.pdf',
      doc_type: 'guidance_value_report',
      extraction_status: 'completed',
      structured_fields: {
        district: 'Bengaluru Urban',
        sro_name: 'Jayanagar',
        locality: 'Jayanagar 4th Block',
        road_name: '11th Main Road',
        land_use_type: 'residential',
        guidance_value_per_sqft: '12,500',
        unit: 'sqft',
        effective_from: '2025-10-01',
        source_page: 4,
        source_section: 'Residential roads',
        needs_human_review: true,
      },
      confidence_scores: { _overall: 0.91, locality: 1 },
    });

    const result = await service.ingestExtraction('extraction-1', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.source_id).toBe('source-1');
    expect(result.evidence_facts_created).toBeGreaterThan(0);
    expect(result.guidance_values_created).toBe(1);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.guidance_values'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.evidence_facts'))).toBe(true);
  });

  test('turns Khata uploads into pending evidence facts for analyst review', async () => {
    mockQueryForExtraction({
      id: 'extraction-khata',
      document_id: 'document-khata',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'Khata.pdf',
      document_file_url: 'https://example.com/khata.pdf',
      doc_type: 'khata',
      extraction_status: 'completed',
      structured_fields: {
        khata_number: '844/267',
        owner_name: 'Meru Parvat Structure Pvt Ltd',
        site_area_sqft: 12023.38,
        source_page: 1,
        needs_human_review: true,
      },
      confidence_scores: { _overall: 0.8, khata_number: 1 },
    });

    const result = await service.ingestExtraction('extraction-khata', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.evidence_facts_created).toBeGreaterThan(0);
    expect(result.guidance_values_created).toBe(0);
    expect(result.far_rules_created).toBe(0);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.evidence_facts'))).toBe(true);
  });

  test('unwraps nested extracted_json payloads before writing evidence facts', async () => {
    mockQueryForExtraction({
      id: 'extraction-e-khata',
      document_id: 'document-e-khata',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'E-Khata.pdf',
      document_file_url: 'https://example.com/e-khata.pdf',
      doc_type: 'e_khata',
      extraction_status: 'completed',
      structured_fields: {
        doc_type: 'e_khata',
        extracted_json: {
          khata_number: '151900802100321399',
          pid_number: '151900802100321399',
          site_area_sqft: 129417.81,
          source_page: 1,
        },
      },
      confidence_scores: { _overall: 1, extracted_json: 1 },
    });

    const result = await service.ingestExtraction('extraction-e-khata', 'user-1');
    const insertedFacts = query.mock.calls
      .filter(([sql]) => sql.includes('INSERT INTO regulatory_data.evidence_facts'))
      .map(([, params]) => params[3]);

    expect(result.skipped).toBe(false);
    expect(insertedFacts).toEqual(expect.arrayContaining(['khata_number', 'pid_number', 'site_area_sqft']));
    expect(insertedFacts).not.toContain('extracted_json');
  });

  test('turns an RMP table extraction into pending FAR rule candidates only when complete', async () => {
    mockQueryForExtraction({
      id: 'extraction-2',
      document_id: 'document-2',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'Volume-6 Zoning Regulations.pdf',
      document_file_url: 'https://example.com/rmp.pdf',
      doc_type: 'rmp_table',
      extraction_status: 'completed',
      structured_fields: {
        plan_version: 'RMP 2031 Draft',
        table_number: 'Table 6',
        source_page: 42,
        rules: [
          {
            zone_code: 'RES',
            planning_zone: 'PZ-A',
            land_use_family: 'residential',
            plot_area_min_sqm: 0,
            plot_area_max_sqm: 240,
            road_width_min_m: 9,
            road_width_max_m: 12,
            base_far: 1.5,
            max_far: 1.75,
            ground_coverage_pct: 65,
          },
          {
            zone_code: 'RES',
            planning_zone: 'PZ-A',
            land_use_family: 'residential',
            base_far: 2.0,
          },
        ],
      },
      confidence_scores: { _overall: 0.83, rules: 0.8 },
    });

    const result = await service.ingestExtraction('extraction-2', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.far_rules_created).toBe(1);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.far_rules'))).toBe(true);
  });

  test('skips non-regulatory document types without writing evidence', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'extraction-3',
        doc_type: 'other',
        structured_fields: { survey_number: '12/1' },
      }],
    });

    const result = await service.ingestExtraction('extraction-3', 'user-1');

    expect(result).toEqual({ skipped: true, reason: 'unsupported_doc_type', doc_type: 'other' });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
