-- Source-document registry metadata for regulatory/masterplan uploads.
-- Keeps document authority, legal status, source role, and OCR readiness
-- explicit before extracted rows are promoted into parcel intelligence.

ALTER TABLE regulatory_data.master_plan_documents
  ADD COLUMN IF NOT EXISTS source_role TEXT,
  ADD COLUMN IF NOT EXISTS legal_status TEXT,
  ADD COLUMN IF NOT EXISTS authority_name TEXT,
  ADD COLUMN IF NOT EXISTS published_on DATE,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS page_count INT,
  ADD COLUMN IF NOT EXISTS processing_mode TEXT,
  ADD COLUMN IF NOT EXISTS text_coverage_ratio NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS ocr_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS registry_notes TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plan_documents_source_role_check'
  ) THEN
    ALTER TABLE regulatory_data.master_plan_documents
      ADD CONSTRAINT master_plan_documents_source_role_check
      CHECK (
        source_role IS NULL
        OR source_role IN (
          'operative_regulation',
          'draft_plan',
          'provisional_plan',
          'base_map',
          'land_use_schedule',
          'guidance_value',
          'property_tax_uav',
          'derived_notes',
          'supporting_dataset',
          'other'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plan_documents_legal_status_check'
  ) THEN
    ALTER TABLE regulatory_data.master_plan_documents
      ADD CONSTRAINT master_plan_documents_legal_status_check
      CHECK (
        legal_status IS NULL
        OR legal_status IN (
          'gazetted',
          'draft',
          'provisional',
          'advisory',
          'user_supplied',
          'vendor',
          'unknown'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plan_documents_processing_mode_check'
  ) THEN
    ALTER TABLE regulatory_data.master_plan_documents
      ADD CONSTRAINT master_plan_documents_processing_mode_check
      CHECK (
        processing_mode IS NULL
        OR processing_mode IN (
          'text_extraction',
          'ocr_required',
          'image_review',
          'manual_entry',
          'geojson',
          'not_extractable'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plan_documents_text_coverage_ratio_check'
  ) THEN
    ALTER TABLE regulatory_data.master_plan_documents
      ADD CONSTRAINT master_plan_documents_text_coverage_ratio_check
      CHECK (text_coverage_ratio IS NULL OR text_coverage_ratio BETWEEN 0 AND 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plan_documents_source_confidence_check'
  ) THEN
    ALTER TABLE regulatory_data.master_plan_documents
      ADD CONSTRAINT master_plan_documents_source_confidence_check
      CHECK (source_confidence IS NULL OR source_confidence BETWEEN 0 AND 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plan_documents_page_count_check'
  ) THEN
    ALTER TABLE regulatory_data.master_plan_documents
      ADD CONSTRAINT master_plan_documents_page_count_check
      CHECK (page_count IS NULL OR page_count > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mpd_source_registry
  ON regulatory_data.master_plan_documents(org_id, legal_status, source_role, created_at DESC)
  WHERE deleted_at IS NULL;
