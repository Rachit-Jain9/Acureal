-- Page-level source review and BBMP UAV separation for masterplan evidence.
-- Additive and safe to run after the source-document registry metadata migration.

CREATE TABLE IF NOT EXISTS regulatory_data.master_plan_document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES regulatory_data.master_plan_documents(id) ON DELETE CASCADE,
  page_number INT NOT NULL CHECK (page_number > 0),
  page_label TEXT,
  extracted_text TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (ocr_status IN ('not_started', 'queued', 'completed', 'failed', 'not_required')),
  ocr_engine TEXT,
  text_coverage_ratio NUMERIC(5,4)
    CHECK (text_coverage_ratio IS NULL OR text_coverage_ratio BETWEEN 0 AND 1),
  page_checksum_sha256 VARCHAR(64),
  page_image_url TEXT,
  citation_anchors JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(citation_anchors) = 'array'),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'reviewed', 'needs_ocr', 'rejected')),
  reviewer_notes TEXT,
  confidence_score NUMERIC(5,4)
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_mpd_pages_document_page
  ON regulatory_data.master_plan_document_pages(document_id, page_number);

CREATE INDEX IF NOT EXISTS idx_mpd_pages_review
  ON regulatory_data.master_plan_document_pages(review_status, ocr_status, created_at DESC);

CREATE TABLE IF NOT EXISTS regulatory_data.bbmp_uav_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id UUID REFERENCES regulatory_data.master_plan_documents(id) ON DELETE SET NULL,
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  page_id UUID REFERENCES regulatory_data.master_plan_document_pages(id) ON DELETE SET NULL,
  city TEXT NOT NULL DEFAULT 'Bengaluru',
  authority_name TEXT DEFAULT 'Bruhat Bengaluru Mahanagara Palike',
  assessment_year TEXT,
  uav_zone_code TEXT,
  uav_zone_name TEXT,
  ward_number TEXT,
  ward_name TEXT,
  road_name TEXT,
  area_name TEXT,
  property_use TEXT,
  unit_area_value_inr NUMERIC(14,2),
  unit_label TEXT,
  source_page INT CHECK (source_page IS NULL OR source_page > 0),
  source_section TEXT,
  confidence_score NUMERIC(5,4)
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_review')),
  notes TEXT,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bbmp_uav_entries_document
  ON regulatory_data.bbmp_uav_entries(document_id, source_page);

CREATE INDEX IF NOT EXISTS idx_bbmp_uav_entries_source_review
  ON regulatory_data.bbmp_uav_entries(evidence_source_id, review_status, created_at DESC)
  WHERE evidence_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bbmp_uav_entries_lookup
  ON regulatory_data.bbmp_uav_entries(org_id, city, uav_zone_code, review_status);

DROP TRIGGER IF EXISTS trg_master_plan_document_pages_updated
  ON regulatory_data.master_plan_document_pages;
CREATE TRIGGER trg_master_plan_document_pages_updated
  BEFORE UPDATE ON regulatory_data.master_plan_document_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_bbmp_uav_entries_updated
  ON regulatory_data.bbmp_uav_entries;
CREATE TRIGGER trg_bbmp_uav_entries_updated
  BEFORE UPDATE ON regulatory_data.bbmp_uav_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE regulatory_data.master_plan_document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.bbmp_uav_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS master_plan_document_pages_read
  ON regulatory_data.master_plan_document_pages;
CREATE POLICY master_plan_document_pages_read
  ON regulatory_data.master_plan_document_pages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM regulatory_data.master_plan_documents d
      WHERE d.id = document_id
        AND (d.org_id IS NULL OR d.org_id = current_organization_id())
    )
  );

DROP POLICY IF EXISTS master_plan_document_pages_modify
  ON regulatory_data.master_plan_document_pages;
CREATE POLICY master_plan_document_pages_modify
  ON regulatory_data.master_plan_document_pages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM regulatory_data.master_plan_documents d
      WHERE d.id = document_id
        AND d.org_id = current_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM regulatory_data.master_plan_documents d
      WHERE d.id = document_id
        AND d.org_id = current_organization_id()
    )
  );

DROP POLICY IF EXISTS bbmp_uav_entries_read
  ON regulatory_data.bbmp_uav_entries;
CREATE POLICY bbmp_uav_entries_read
  ON regulatory_data.bbmp_uav_entries
  FOR SELECT
  USING (org_id IS NULL OR org_id = current_organization_id());

DROP POLICY IF EXISTS bbmp_uav_entries_modify
  ON regulatory_data.bbmp_uav_entries;
CREATE POLICY bbmp_uav_entries_modify
  ON regulatory_data.bbmp_uav_entries
  FOR ALL
  USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());
