-- Track when an extraction was last started so the stuck-extraction
-- reaper can reliably tell which 'in_progress' rows have exceeded the
-- Vercel function timeout. Without this, the reaper had to fall back to
-- created_at, which is wrong for rows that were uploaded a long time
-- ago and only had extraction triggered recently.
--
-- Additive: column is nullable; existing rows keep extraction_started_at
-- = NULL and the reaper treats NULL as "not currently extracting" so
-- they're left alone.

ALTER TABLE regulatory_data.master_plan_documents
  ADD COLUMN IF NOT EXISTS extraction_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_master_plan_documents_extraction_in_progress
  ON regulatory_data.master_plan_documents (extraction_started_at)
  WHERE extraction_status = 'in_progress';
