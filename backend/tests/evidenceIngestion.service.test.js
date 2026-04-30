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

  test('uses source-registry authority metadata when extraction fields omit authority', async () => {
    mockQueryForExtraction({}, 'source-authority');

    await service.ingestRegulatoryFields({
      docType: 'zoning_certificate',
      fields: {
        zone_code: 'R1',
        zoning_classification: 'Residential Main',
        source_page: 1,
      },
      scores: { _overall: 0.7 },
      source: {
        org_id: '11111111-1111-1111-1111-111111111111',
        document_name: 'Zoning Certificate.pdf',
        authority_name: 'Bangalore Development Authority',
        source_kind: 'official_pdf',
      },
      userId: 'user-1',
    });

    const sourceInsert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO regulatory_data.evidence_sources'));
    expect(sourceInsert?.[1][3]).toBe('Bangalore Development Authority');
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

  test('deduplicates RMP FAR candidates by source, zone, plot, road, and rule values', async () => {
    const row = {
      id: 'extraction-2b',
      document_id: 'document-2b',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'Volume-6 Zoning Regulations.pdf',
      document_file_url: 'https://example.com/rmp.pdf',
      doc_type: 'rmp_table',
      extraction_status: 'completed',
      structured_fields: {
        plan_version: 'RMP 2031 Draft',
        source_page: 42,
        rules: [{
          zone_code: 'RES',
          planning_zone: 'PZ-A',
          land_use_family: 'residential',
          plot_area_min_sqm: 0,
          road_width_min_m: 9,
          base_far: 1.5,
          max_far: 1.75,
        }],
      },
      confidence_scores: { _overall: 0.83, rules: 0.8 },
    };

    query.mockImplementation((sql) => {
      if (sql.includes('FROM document_extractions de')) return Promise.resolve({ rows: [row] });
      if (sql.includes('FROM regulatory_data.evidence_sources')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO regulatory_data.evidence_sources')) return Promise.resolve({ rows: [{ id: 'source-rmp' }] });
      if (sql.includes('FROM regulatory_data.far_rules')) return Promise.resolve({ rows: [{ id: 'existing-rule' }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await service.ingestExtraction('extraction-2b', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.far_rules_created).toBe(0);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.far_rules'))).toBe(false);
  });

  test('creates pending master plan zone candidates only from explicit zone names', async () => {
    mockQueryForExtraction({
      id: 'extraction-rmp-zones',
      document_id: 'document-rmp-zones',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'RMP-Provisional.pdf',
      document_file_url: 'https://example.com/rmp-provisional.pdf',
      doc_type: 'rmp_table',
      extraction_status: 'completed',
      structured_fields: {
        city: 'Bengaluru',
        plan_version: 'RMP 2031 Draft',
        source_page: 12,
        planning_districts: [{ pd_code: 'PZ-1', pd_name: 'Planning District 1' }],
        zones: [
          { zone_code: 'R1', zone_name: 'Residential Main', planning_district_code: 'PZ-1', source_page: 12 },
          { zone_code: 'C1', planning_district_code: 'PZ-1', source_page: 13 },
        ],
      },
      confidence_scores: { _overall: 0.82, zones: 0.8 },
    });

    query.mockImplementation((sql) => {
      if (sql.includes('FROM document_extractions de')) {
        return Promise.resolve({ rows: [{
          id: 'extraction-rmp-zones',
          document_id: 'document-rmp-zones',
          organization_id: '11111111-1111-1111-1111-111111111111',
          document_organization_id: '11111111-1111-1111-1111-111111111111',
          document_name: 'RMP-Provisional.pdf',
          document_file_url: 'https://example.com/rmp-provisional.pdf',
          doc_type: 'rmp_table',
          extraction_status: 'completed',
          structured_fields: {
            city: 'Bengaluru',
            plan_version: 'RMP 2031 Draft',
            source_page: 12,
            planning_districts: [{ pd_code: 'PZ-1', pd_name: 'Planning District 1' }],
            zones: [
              { zone_code: 'R1', zone_name: 'Residential Main', planning_district_code: 'PZ-1', source_page: 12 },
              { zone_code: 'C1', planning_district_code: 'PZ-1', source_page: 13 },
            ],
          },
          confidence_scores: { _overall: 0.82, zones: 0.8 },
        }] });
      }
      if (sql.includes('FROM regulatory_data.evidence_sources')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO regulatory_data.evidence_sources')) return Promise.resolve({ rows: [{ id: 'source-zones' }] });
      if (sql.includes('INSERT INTO regulatory_data.planning_districts')) return Promise.resolve({ rows: [{ id: 'district-1' }] });
      if (sql.includes('FROM regulatory_data.master_plan_zones')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO regulatory_data.master_plan_zones')) return Promise.resolve({ rows: [{ id: 'zone-1' }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await service.ingestExtraction('extraction-rmp-zones', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.zones_created).toBe(1);
    const zoneInserts = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO regulatory_data.master_plan_zones'));
    expect(zoneInserts).toHaveLength(1);
    expect(zoneInserts[0][0]).toContain("'pending'");
  });

  test('igr_guidance_pdf with structured rows creates one candidate per row', async () => {
    mockQueryForExtraction({
      id: 'extraction-igr-1',
      document_id: 'document-igr-1',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'IGR-Bengaluru-Urban-2025.pdf',
      document_file_url: 'https://example.com/igr.pdf',
      doc_type: 'igr_guidance_pdf',
      extraction_status: 'completed',
      structured_fields: {
        issuing_authority: 'Inspector General of Registration, Karnataka',
        district: 'Bengaluru Urban',
        sro_name: 'Jayanagar',
        land_use_type: 'residential',
        effective_from: '2025-04-01',
        effective_to: '2026-03-31',
        source_page: 12,
        rows: [
          { locality: 'Jayanagar 4th Block', road_name: '11th Main', value: 12500, unit_type: 'sqft', confidence: 0.85 },
          { locality: 'Jayanagar 4th Block', road_name: '12th Main', value: 11800, unit_type: 'sqft', confidence: 0.82 },
          { locality: 'BTM 2nd Stage', road_name: '16th Main', value: 9800, unit_type: 'sqft', confidence: 0.80 },
        ],
      },
      confidence_scores: { _overall: 0.83 },
    });

    const result = await service.ingestExtraction('extraction-igr-1', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.guidance_values_created).toBe(3);
    expect(result.far_rules_created).toBe(0);
    const insertCalls = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO regulatory_data.guidance_values'));
    expect(insertCalls).toHaveLength(3);
  });

  test('igr_guidance_pdf parses raw_text rows when Gemini returns no structured rows', async () => {
    const rawText = [
      'Jayanagar 4th Block   11th Main Road    Rs 12,500 per sqft',
      'BTM 2nd Stage         16th Main Road    Rs 9,800 per sqft',
      'HSR Layout            27th Main Road    Rs 11,200 per sqft',
    ].join('\n');

    mockQueryForExtraction({
      id: 'extraction-igr-2',
      document_id: 'document-igr-2',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'IGR-Bengaluru-Urban-2025.pdf',
      document_file_url: 'https://example.com/igr.pdf',
      doc_type: 'igr_guidance_pdf',
      extraction_status: 'completed',
      structured_fields: {
        issuing_authority: 'Inspector General of Registration, Karnataka',
        district: 'Bengaluru Urban',
        sro_name: 'Jayanagar',
        land_use_type: 'residential',
        effective_from: '2025-04-01',
        source_page: 12,
        rows: [],
        raw_text: rawText,
      },
      confidence_scores: { _overall: 0.9 },
    });

    const result = await service.ingestExtraction('extraction-igr-2', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.guidance_values_created).toBeGreaterThan(0);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.guidance_values'))).toBe(true);
  });

  test('igr_guidance_pdf with neither rows nor raw_text records the source but creates zero candidates', async () => {
    mockQueryForExtraction({
      id: 'extraction-igr-3',
      document_id: 'document-igr-3',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'IGR-Empty.pdf',
      document_file_url: 'https://example.com/igr-empty.pdf',
      doc_type: 'igr_guidance_pdf',
      extraction_status: 'completed',
      structured_fields: {
        issuing_authority: 'Inspector General of Registration, Karnataka',
        district: 'Bengaluru Urban',
        sro_name: 'Jayanagar',
      },
      confidence_scores: { _overall: 0.5 },
    });

    const result = await service.ingestExtraction('extraction-igr-3', 'user-1');

    expect(result.skipped).toBe(false);
    expect(result.guidance_values_created).toBe(0);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.guidance_values'))).toBe(false);
  });

  test('keeps BBMP UAV property-tax PDFs as evidence-only facts', async () => {
    mockQueryForExtraction({
      id: 'extraction-bbmp-uav',
      document_id: 'document-bbmp-uav',
      organization_id: '11111111-1111-1111-1111-111111111111',
      document_organization_id: '11111111-1111-1111-1111-111111111111',
      document_name: 'Guidance Value.pdf',
      document_file_url: 'https://example.com/bbmp-uav.pdf',
      doc_type: 'bbmp_uav_pdf',
      extraction_status: 'completed',
      structured_fields: {
        issuing_authority: 'Bruhat Bengaluru Mahanagara Palike',
        city: 'Bengaluru',
        document_title: 'Unit Area Value zone classification',
        assessment_year: '2024-25',
        source_page: 7,
        source_section: 'Ward-wise roads',
        uav_zone_codes: ['A', 'B', 'C'],
        rows: [
          {
            zone_code: 'B',
            ward_number: '150',
            ward_name: 'Bellandur',
            road_name: 'Outer Ring Road',
            area_or_locality: 'Bellandur',
            unit_area_value: 5,
            unit: 'per sqft per month',
            source_page: 7,
            confidence: 0.86,
          },
        ],
        raw_text: 'Bellandur Outer Ring Road Zone B UAV 5',
        needs_human_review: true,
      },
      confidence_scores: { _overall: 0.88, rows: 0.82 },
    });

    const result = await service.ingestExtraction('extraction-bbmp-uav', 'user-1');
    const insertedFacts = query.mock.calls
      .filter(([sql]) => sql.includes('INSERT INTO regulatory_data.evidence_facts'))
      .map(([, params]) => params[3]);

    expect(result.skipped).toBe(false);
    expect(result.guidance_values_created).toBe(0);
    expect(result.bbmp_uav_entries_created).toBe(1);
    expect(result.far_rules_created).toBe(0);
    expect(result.zones_created).toBe(0);
    expect(insertedFacts).toEqual(expect.arrayContaining(['issuing_authority', 'uav_zone_codes', 'row_count']));
    expect(insertedFacts).not.toContain('rows');
    expect(insertedFacts).not.toContain('raw_text');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.guidance_values'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO regulatory_data.bbmp_uav_entries'))).toBe(true);
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
