-- Bangalore Master Plan zoning integration
-- Regulatory data schema for plan-version-agnostic zone management
-- Safe to re-run on existing REDIP databases.

CREATE SCHEMA IF NOT EXISTS regulatory_data;

-- Source documents (plan-version agnostic)
CREATE TABLE IF NOT EXISTS regulatory_data.master_plan_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  city TEXT NOT NULL DEFAULT 'Bengaluru',
  plan_name TEXT NOT NULL,
  plan_version TEXT,
  file_url TEXT,
  storage_path TEXT,
  deleted_at TIMESTAMPTZ,
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending','in_progress','completed','failed')),
  zones_extracted INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpd_org ON regulatory_data.master_plan_documents(org_id)
  WHERE deleted_at IS NULL;

-- Planning districts (stub; PostGIS geometry added in Month 2 migration)
CREATE TABLE IF NOT EXISTS regulatory_data.planning_districts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pd_code TEXT UNIQUE NOT NULL,
  pd_name TEXT,
  city TEXT NOT NULL DEFAULT 'Bengaluru'
);

-- Zones (versioned, amendable)
CREATE TABLE IF NOT EXISTS regulatory_data.master_plan_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES regulatory_data.master_plan_documents(id) ON DELETE SET NULL,
  planning_district_id UUID REFERENCES regulatory_data.planning_districts(id) ON DELETE SET NULL,
  city TEXT NOT NULL DEFAULT 'Bengaluru',
  plan_version TEXT,
  zone_code TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  permissible_fsi_base DECIMAL(5,2),
  permissible_fsi_max DECIMAL(5,2),
  fsi_road_width_rules JSONB,
  ground_coverage_pct DECIMAL(5,2),
  building_height_max_m DECIMAL(6,2),
  road_width_min_m DECIMAL(5,2),
  setback_rules JSONB,
  permissible_uses TEXT[],
  prohibited_uses TEXT[],
  notes TEXT DEFAULT 'Manual entry',
  source_page INT,
  source_section TEXT,
  confidence_score DECIMAL(3,2),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zone_code, plan_version, planning_district_id)
);

CREATE INDEX IF NOT EXISTS idx_mpz_code_city ON regulatory_data.master_plan_zones(zone_code, city);
CREATE INDEX IF NOT EXISTS idx_mpz_review ON regulatory_data.master_plan_zones(review_status);
CREATE INDEX IF NOT EXISTS idx_mpz_pd ON regulatory_data.master_plan_zones(planning_district_id);
CREATE INDEX IF NOT EXISTS idx_mpz_active ON regulatory_data.master_plan_zones(zone_code)
  WHERE effective_to IS NULL AND review_status = 'approved';

-- Amendment audit trail
CREATE TABLE IF NOT EXISTS regulatory_data.zone_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id UUID NOT NULL REFERENCES regulatory_data.master_plan_zones(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_values JSONB NOT NULL,
  change_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_zv_zone ON regulatory_data.zone_versions(zone_id, changed_at DESC);

-- Rules engine: evaluate effective FSI for a given property road width.
-- Mirrored in JS in backend/src/services/masterplan.service.js
CREATE OR REPLACE FUNCTION regulatory_data.effective_fsi(
  fsi_base DECIMAL,
  road_width_rules JSONB,
  road_width_m DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
  rule JSONB;
BEGIN
  IF road_width_rules IS NULL
     OR jsonb_typeof(road_width_rules) <> 'array'
     OR jsonb_array_length(road_width_rules) = 0
     OR road_width_m IS NULL THEN
    RETURN fsi_base;
  END IF;

  SELECT r INTO rule
  FROM jsonb_array_elements(road_width_rules) r
  WHERE (r->>'road_width_m')::DECIMAL <= road_width_m
  ORDER BY (r->>'road_width_m')::DECIMAL DESC
  LIMIT 1;

  RETURN COALESCE((rule->>'fsi')::DECIMAL, fsi_base);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Property zone assignment fields
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES regulatory_data.master_plan_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zone_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_properties_zone ON public.properties(zone_id) WHERE zone_id IS NOT NULL;
