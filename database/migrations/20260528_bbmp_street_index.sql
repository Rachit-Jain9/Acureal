-- 20260528_bbmp_street_index.sql
-- Searchable index of every street/area listed in the BBMP Guidance Value PDF
-- (Notification No. 384, 09 Mar 2016, Block period 2016-2019). Used by the
-- Bengaluru Street Lookup panel so deal teams can type a street name and
-- see its ward, the BBMP source page, and (in Phase 2 once the LLM
-- enrichment runs) the assigned UAV zone + guidance-value bandwidth.
--
-- Source PDF: 686 pages. Per-street rows live on pages ~10–686 grouped by
-- ARO (Assistant Revenue Officer) jurisdiction.

BEGIN;

CREATE TABLE IF NOT EXISTS regulatory_data.bbmp_street_index (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  street_name_en  text NOT NULL,
  ward_no         integer,
  page_number     integer NOT NULL,
  aro_section     text,
  row_excerpt     text,
  -- Phase 2 enrichment fields (NULLable until the LLM pass runs).
  zone_code       text,
  guidance_value_band_min_inr integer,
  guidance_value_band_max_inr integer,
  -- Provenance + audit
  source_document text NOT NULL DEFAULT 'BBMP Guidance Value Notification No. 384 (09-Mar-2016)',
  confidence_score numeric(3,2),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE regulatory_data.bbmp_street_index IS
  'Per-street index from the BBMP Guidance Value PDF. Phase 1 ships text-extracted street+ward+page rows; Phase 2 enriches with zone_code and guidance_value bandwidth via an LLM pass over the PDF page images.';

-- Search-friendly indexes.
CREATE INDEX IF NOT EXISTS bbmp_street_index_search_trgm
  ON regulatory_data.bbmp_street_index
  USING gin (street_name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS bbmp_street_index_ward
  ON regulatory_data.bbmp_street_index (ward_no);

CREATE INDEX IF NOT EXISTS bbmp_street_index_page
  ON regulatory_data.bbmp_street_index (page_number);

CREATE INDEX IF NOT EXISTS bbmp_street_index_zone
  ON regulatory_data.bbmp_street_index (zone_code)
  WHERE zone_code IS NOT NULL;

-- Idempotency: rebuilding the index should not duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS bbmp_street_index_unique_triple
  ON regulatory_data.bbmp_street_index (lower(street_name_en), ward_no, page_number);

-- RLS — this is reference data shared across all orgs, so anyone authenticated
-- can read it. No write policies; seeds + LLM enrichment happen via service
-- role only.
ALTER TABLE regulatory_data.bbmp_street_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bbmp_street_index_read ON regulatory_data.bbmp_street_index;
CREATE POLICY bbmp_street_index_read
  ON regulatory_data.bbmp_street_index
  FOR SELECT
  TO authenticated
  USING (true);

-- updated_at maintenance trigger (mirrors the project convention).
CREATE OR REPLACE FUNCTION regulatory_data.bbmp_street_index_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bbmp_street_index_touch_updated_at
  ON regulatory_data.bbmp_street_index;
CREATE TRIGGER trg_bbmp_street_index_touch_updated_at
  BEFORE UPDATE ON regulatory_data.bbmp_street_index
  FOR EACH ROW
  EXECUTE FUNCTION regulatory_data.bbmp_street_index_touch_updated_at();

COMMIT;
