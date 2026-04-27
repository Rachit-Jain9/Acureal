-- Masterplan + guidance evidence intake metadata.
-- Adds tracked source-document fields for regulatory uploads without reusing
-- deal-scoped documents, whose deal_id is intentionally required.

ALTER TABLE regulatory_data.master_plan_documents
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_type TEXT,
  ADD COLUMN IF NOT EXISTS far_rules_extracted INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guidance_rows_extracted INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_facts_extracted INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_error TEXT,
  ADD COLUMN IF NOT EXISTS evidence_source_id UUID,
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plan_documents_evidence_source_id_fkey'
  ) THEN
    ALTER TABLE regulatory_data.master_plan_documents
      ADD CONSTRAINT master_plan_documents_evidence_source_id_fkey
      FOREIGN KEY (evidence_source_id)
      REFERENCES regulatory_data.evidence_sources(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mpd_extraction_status
  ON regulatory_data.master_plan_documents(org_id, extraction_status, created_at DESC)
  WHERE deleted_at IS NULL;
