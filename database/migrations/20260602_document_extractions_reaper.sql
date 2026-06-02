-- Deal-document extraction reaper support (public.document_extractions).
--
-- WHY
-- The deal-document extraction pipeline inserts a row in 'processing' state
-- and then runs the AI extraction *synchronously* inside the
-- POST /documents/:id/extract request. Vercel caps that request at
-- maxDuration (300s in production). If the function is killed mid-extraction
-- (timeout, OOM, redeploy), the try/catch's catch block never runs and the
-- row is orphaned in 'processing' forever. Such a row is invisible to
-- getDealExtractions() (which only surfaces completed/partial/reviewed) and
-- cannot be retried from the UI, so the document silently never contributes
-- to the deal — exactly the "is my document actually extracted?" blind spot.
--
-- The master-plan pipeline (regulatory_data.master_plan_documents) already
-- solved this with a started-at timestamp + a read-path reaper. This brings
-- the deal-document pipeline to parity.
--
-- SAFE / ADDITIVE
-- The column is nullable. Existing rows keep extraction_started_at = NULL and
-- the reaper treats NULL via a created_at fallback with a long (15-minute)
-- grace floor, so no freshly-created legacy row is ever reaped prematurely.

ALTER TABLE document_extractions
  ADD COLUMN IF NOT EXISTS extraction_started_at TIMESTAMPTZ;

-- Partial index so the reaper's `WHERE extraction_status = 'processing'` sweep
-- is a tiny index scan (typically zero rows) rather than a seq scan over the
-- whole extraction history on every deal-workspace read.
CREATE INDEX IF NOT EXISTS idx_document_extractions_processing
  ON document_extractions (extraction_started_at)
  WHERE extraction_status = 'processing';
