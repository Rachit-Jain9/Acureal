-- REDIP Parcel Intelligence Phase 1
-- Evidence vault, FAR matrix, guidance values, K-GIS cache, and snapshots.
-- Global curated reference rows use org_id = NULL. Tenant corrections/uploads use org_id.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS regulatory_data;

CREATE TABLE IF NOT EXISTS regulatory_data.evidence_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  source_kind VARCHAR(40) NOT NULL CHECK (
    source_kind IN ('official_pdf', 'vendor', 'user_upload', 'manual_entry', 'kgis', 'system')
  ),
  authority_name VARCHAR(255),
  vendor_name VARCHAR(255),
  source_title VARCHAR(500) NOT NULL,
  source_url TEXT,
  file_url TEXT,
  storage_path TEXT,
  checksum_sha256 VARCHAR(64),
  city VARCHAR(120) DEFAULT 'Bengaluru',
  plan_version VARCHAR(120),
  effective_from DATE,
  effective_to DATE,
  extraction_status VARCHAR(40) DEFAULT 'pending' CHECK (
    extraction_status IN ('pending', 'in_progress', 'completed', 'failed', 'not_required')
  ),
  review_status VARCHAR(40) DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'needs_review')
  ),
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  approved_facts JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regulatory_data.evidence_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES regulatory_data.evidence_sources(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  fact_type VARCHAR(80) NOT NULL,
  fact_key VARCHAR(160) NOT NULL,
  fact_value JSONB NOT NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  source_section VARCHAR(255),
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  review_status VARCHAR(40) DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'needs_review')
  ),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regulatory_data.far_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES regulatory_data.master_plan_zones(id) ON DELETE SET NULL,
  city VARCHAR(120) DEFAULT 'Bengaluru',
  plan_version VARCHAR(120) DEFAULT 'RMP 2031 Draft',
  plan_status VARCHAR(60) DEFAULT 'draft_reference',
  zone_code VARCHAR(80),
  planning_zone VARCHAR(20),
  land_use_family VARCHAR(80) NOT NULL,
  plot_area_min_sqm NUMERIC(12,2) DEFAULT 0,
  plot_area_max_sqm NUMERIC(12,2),
  road_width_min_m NUMERIC(8,2) DEFAULT 0,
  road_width_max_m NUMERIC(8,2),
  base_far NUMERIC(6,3) NOT NULL,
  additional_far NUMERIC(6,3) DEFAULT 0,
  max_far NUMERIC(6,3) NOT NULL,
  ground_coverage_pct NUMERIC(6,2),
  front_setback_m NUMERIC(6,2),
  rear_setback_m NUMERIC(6,2),
  side_setback_m NUMERIC(6,2),
  source_page INTEGER,
  source_section VARCHAR(255),
  rule_notes TEXT,
  confidence_score NUMERIC(4,3) DEFAULT 1 CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  review_status VARCHAR(40) DEFAULT 'approved' CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'needs_review')
  ),
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regulatory_data.guidance_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  city VARCHAR(120) DEFAULT 'Bengaluru',
  sro_name VARCHAR(255),
  locality VARCHAR(500) NOT NULL,
  road_name VARCHAR(500),
  land_use_type VARCHAR(120) DEFAULT 'residential',
  value_inr_per_sqft NUMERIC(14,2),
  value_inr_per_acre NUMERIC(18,2),
  unit_type VARCHAR(40) DEFAULT 'sqft',
  effective_from DATE,
  effective_to DATE,
  source_page INTEGER,
  source_section VARCHAR(255),
  review_status VARCHAR(40) DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'needs_review')
  ),
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regulatory_data.kgis_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  provider_status VARCHAR(60) NOT NULL DEFAULT 'not_requested',
  request_payload JSONB DEFAULT '{}'::jsonb,
  response_payload JSONB DEFAULT '{}'::jsonb,
  hierarchy JSONB DEFAULT '{}'::jsonb,
  survey_numbers JSONB DEFAULT '[]'::jsonb,
  geometry_geojson JSONB,
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regulatory_data.parcel_intelligence_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  inputs_hash VARCHAR(64) NOT NULL,
  output_json JSONB NOT NULL,
  source_versions JSONB DEFAULT '{}'::jsonb,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_sources_scope_status
  ON regulatory_data.evidence_sources(org_id, review_status, source_kind);
CREATE INDEX IF NOT EXISTS idx_evidence_facts_scope_type
  ON regulatory_data.evidence_facts(org_id, fact_type, review_status);
CREATE INDEX IF NOT EXISTS idx_far_rules_lookup
  ON regulatory_data.far_rules(org_id, city, zone_code, planning_zone, land_use_family, review_status);
CREATE INDEX IF NOT EXISTS idx_far_rules_plot_road
  ON regulatory_data.far_rules(plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m);
CREATE INDEX IF NOT EXISTS idx_guidance_scope_status
  ON regulatory_data.guidance_values(org_id, city, review_status, land_use_type);
CREATE INDEX IF NOT EXISTS idx_guidance_locality_trgm
  ON regulatory_data.guidance_values USING gin(locality gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_guidance_road_trgm
  ON regulatory_data.guidance_values USING gin(road_name gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kgis_cache_cache_key_org
  ON regulatory_data.kgis_cache(COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), cache_key);
CREATE INDEX IF NOT EXISTS idx_parcel_snapshots_property
  ON regulatory_data.parcel_intelligence_snapshots(org_id, property_id, generated_at DESC);

DROP TRIGGER IF EXISTS trg_evidence_sources_updated ON regulatory_data.evidence_sources;
CREATE TRIGGER trg_evidence_sources_updated
  BEFORE UPDATE ON regulatory_data.evidence_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_far_rules_updated ON regulatory_data.far_rules;
CREATE TRIGGER trg_far_rules_updated
  BEFORE UPDATE ON regulatory_data.far_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_guidance_values_updated ON regulatory_data.guidance_values;
CREATE TRIGGER trg_guidance_values_updated
  BEFORE UPDATE ON regulatory_data.guidance_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_kgis_cache_updated ON regulatory_data.kgis_cache;
CREATE TRIGGER trg_kgis_cache_updated
  BEFORE UPDATE ON regulatory_data.kgis_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE regulatory_data.evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.evidence_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.far_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.guidance_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.kgis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.parcel_intelligence_snapshots ENABLE ROW LEVEL SECURITY;

ALTER TABLE regulatory_data.evidence_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.evidence_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.far_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.guidance_values FORCE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.kgis_cache FORCE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.parcel_intelligence_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evidence_sources_org_or_global ON regulatory_data.evidence_sources;
CREATE POLICY evidence_sources_org_or_global ON regulatory_data.evidence_sources
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());

DROP POLICY IF EXISTS evidence_facts_org_or_global ON regulatory_data.evidence_facts;
CREATE POLICY evidence_facts_org_or_global ON regulatory_data.evidence_facts
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());

DROP POLICY IF EXISTS far_rules_org_or_global ON regulatory_data.far_rules;
CREATE POLICY far_rules_org_or_global ON regulatory_data.far_rules
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());

DROP POLICY IF EXISTS guidance_values_org_or_global ON regulatory_data.guidance_values;
CREATE POLICY guidance_values_org_or_global ON regulatory_data.guidance_values
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());

DROP POLICY IF EXISTS kgis_cache_org_only ON regulatory_data.kgis_cache;
CREATE POLICY kgis_cache_org_only ON regulatory_data.kgis_cache
  USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());

DROP POLICY IF EXISTS parcel_snapshots_org_only ON regulatory_data.parcel_intelligence_snapshots;
CREATE POLICY parcel_snapshots_org_only ON regulatory_data.parcel_intelligence_snapshots
  USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());

WITH rmp_source AS (
  INSERT INTO regulatory_data.evidence_sources (
    id,
    source_kind,
    authority_name,
    source_title,
    source_url,
    city,
    plan_version,
    effective_from,
    extraction_status,
    review_status,
    confidence_score,
    notes
  )
  SELECT
    '22222222-0000-0000-0000-000000000001'::uuid,
    'official_pdf',
    'Bangalore Development Authority / OpenCity reference copy',
    'RMP 2031 Volume 6 Zoning Regulations - draft/reference tables',
    'https://opencity.in/documents/rmp-2031-volume-6-zoning-regulations',
    'Bengaluru',
    'RMP 2031 Draft',
    '2017-11-25',
    'completed',
    'approved',
    0.95,
    'Reference seed from Volume 6 tables. Keep labeled draft/reference until current authority status is verified.'
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources
    WHERE id = '22222222-0000-0000-0000-000000000001'::uuid
  )
  RETURNING id
),
source_id AS (
  SELECT id FROM rmp_source
  UNION ALL
  SELECT id FROM regulatory_data.evidence_sources
  WHERE id = '22222222-0000-0000-0000-000000000001'::uuid
)
INSERT INTO regulatory_data.far_rules (
  evidence_source_id,
  zone_id,
  zone_code,
  planning_zone,
  land_use_family,
  plot_area_min_sqm,
  plot_area_max_sqm,
  road_width_min_m,
  road_width_max_m,
  base_far,
  additional_far,
  max_far,
  ground_coverage_pct,
  front_setback_m,
  source_section,
  source_page,
  rule_notes,
  effective_from
)
SELECT
  (SELECT id FROM source_id LIMIT 1),
  z.id,
  v.zone_code,
  v.planning_zone,
  v.land_use_family,
  v.plot_min,
  v.plot_max,
  v.road_min,
  v.road_max,
  v.base_far,
  v.additional_far,
  v.max_far,
  v.ground_coverage,
  v.front_setback,
  v.source_section,
  v.source_page,
  v.rule_notes,
  '2017-11-25'::date
FROM (
  VALUES
  ('R-PZ-A','A','residential',0,60,0,6,1.50,0.00,1.50,75,1.00,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Road and plot-size band copied from Volume 6. Additional FAR is zero where table is blank.'),
  ('R-PZ-A','A','residential',60,120,6,9.5,1.50,0.00,1.50,75,1.00,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Road and plot-size band copied from Volume 6.'),
  ('R-PZ-A','A','residential',120,240,9.5,12.5,1.50,0.00,1.50,70,1.75,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Road and plot-size band copied from Volume 6.'),
  ('R-PZ-A','A','residential',240,360,12.5,15.5,1.50,0.00,1.50,70,2.00,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Road and plot-size band copied from Volume 6.'),
  ('R-PZ-A','A','residential',360,750,15.5,18.5,1.80,0.45,2.25,65,2.50,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('R-PZ-A','A','residential',750,2000,18.5,24.5,1.80,0.60,2.40,60,3.50,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('R-PZ-A','A','residential',2000,4000,24.5,30.5,1.80,0.70,2.50,50,3.50,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('R-PZ-A','A','residential',4000,20000,30.5,NULL,1.80,0.90,2.70,40,4.00,'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',63,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('R-PZ-B','B','residential',0,60,0,6,1.50,0.00,1.50,75,1.00,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Road and plot-size band copied from Volume 6. Additional FAR is zero where table is blank.'),
  ('R-PZ-B','B','residential',60,120,6,9.5,1.50,0.00,1.50,75,1.00,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Road and plot-size band copied from Volume 6.'),
  ('R-PZ-B','B','residential',120,240,9.5,12.5,1.80,0.00,1.80,70,1.75,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Road and plot-size band copied from Volume 6.'),
  ('R-PZ-B','B','residential',240,360,12.5,15.5,1.80,0.00,1.80,70,2.00,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Road and plot-size band copied from Volume 6.'),
  ('R-PZ-B','B','residential',360,750,15.5,18.5,2.00,0.40,2.40,65,2.50,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('R-PZ-B','B','residential',750,2000,18.5,24.5,2.00,0.70,2.70,60,3.50,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('R-PZ-B','B','residential',2000,4000,24.5,30.5,2.00,1.00,3.00,50,3.50,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('R-PZ-B','B','residential',4000,20000,30.5,NULL,2.00,1.20,3.20,40,4.00,'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',64,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-A','A','commercial',0,NULL,0,9.5,1.20,0.00,1.20,60,1.00,'Table 12: FAR and ground coverage for commercial category in Planning Zone A',69,'Commercial rows are road-width driven; plot-size band is not specified in the table.'),
  ('C-3-PZ-A','A','commercial',0,NULL,9.5,12.5,1.20,0.00,1.20,60,1.75,'Table 12: FAR and ground coverage for commercial category in Planning Zone A',69,'Commercial rows are road-width driven; plot-size band is not specified in the table.'),
  ('C-3-PZ-A','A','commercial',0,NULL,12.5,18.5,1.50,0.50,2.00,50,2.00,'Table 12: FAR and ground coverage for commercial category in Planning Zone A',69,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-A','A','commercial',0,NULL,18.5,24.5,1.50,0.60,2.10,50,3.50,'Table 12: FAR and ground coverage for commercial category in Planning Zone A',69,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-A','A','commercial',0,NULL,24.5,30.5,1.50,0.75,2.25,40,3.50,'Table 12: FAR and ground coverage for commercial category in Planning Zone A',69,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-A','A','commercial',0,NULL,30.5,NULL,1.50,0.90,2.40,40,4.00,'Table 12: FAR and ground coverage for commercial category in Planning Zone A',69,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-B','B','commercial',0,NULL,0,9.5,1.50,0.00,1.50,60,1.00,'Table 13: FAR and ground coverage for commercial category in Planning Zone B',70,'Commercial rows are road-width driven; plot-size band is not specified in the table.'),
  ('C-3-PZ-B','B','commercial',0,NULL,9.5,12.5,1.50,0.00,1.50,60,1.75,'Table 13: FAR and ground coverage for commercial category in Planning Zone B',70,'Commercial rows are road-width driven; plot-size band is not specified in the table.'),
  ('C-3-PZ-B','B','commercial',0,NULL,12.5,18.5,2.00,0.60,2.60,50,2.00,'Table 13: FAR and ground coverage for commercial category in Planning Zone B',70,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-B','B','commercial',0,NULL,18.5,24.5,2.00,0.80,2.80,50,3.50,'Table 13: FAR and ground coverage for commercial category in Planning Zone B',70,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-B','B','commercial',0,NULL,24.5,30.5,2.00,1.00,3.00,40,3.50,'Table 13: FAR and ground coverage for commercial category in Planning Zone B',70,'Additional FAR/TDR row requires authority verification before financial reliance.'),
  ('C-3-PZ-B','B','commercial',0,NULL,30.5,NULL,2.00,1.20,3.20,40,4.00,'Table 13: FAR and ground coverage for commercial category in Planning Zone B',70,'Additional FAR/TDR row requires authority verification before financial reliance.')
) AS v(zone_code, planning_zone, land_use_family, plot_min, plot_max, road_min, road_max, base_far, additional_far, max_far, ground_coverage, front_setback, source_section, source_page, rule_notes)
LEFT JOIN regulatory_data.master_plan_zones z
  ON z.zone_code = v.zone_code
WHERE NOT EXISTS (
  SELECT 1 FROM regulatory_data.far_rules existing
  WHERE existing.org_id IS NULL
    AND existing.plan_version = 'RMP 2031 Draft'
    AND existing.zone_code = v.zone_code
    AND existing.land_use_family = v.land_use_family
    AND existing.plot_area_min_sqm = v.plot_min
    AND COALESCE(existing.plot_area_max_sqm, -1) = COALESCE(v.plot_max, -1)
    AND existing.road_width_min_m = v.road_min
    AND COALESCE(existing.road_width_max_m, -1) = COALESCE(v.road_max, -1)
);
