-- ============================================================================
-- 20260716_tidy_failed_rmp2031_documents.sql
-- ----------------------------------------------------------------------------
-- Two RMP-2031 (withdrawn plan) source documents are stuck in extraction_status
-- 'failed' — their extraction hit `duplicate key value violates unique
-- constraint "uq_master_plan_zones_active_code"` because their zones already
-- exist. RMP 2031 was never notified (provisional approval withdrawn Jul 2020),
-- so it is NOT an extraction target and retrying is pointless — the red FAILED /
-- "Retry" state is just noise in the Source Documents list.
--
-- Tidy them to a clean, non-extractable reference state:
--   - extraction_status 'failed' -> 'completed'   (clears the red FAILED badge)
--   - processing_mode -> 'not_extractable'         (shows "Reference only", no Retry)
--   - ocr_required -> false ; extraction_error -> NULL
--   - append a withdrawn-plan note
--
-- NON-DESTRUCTIVE: the documents and any candidates they already produced are
-- retained (audit trail intact); only status/mode/error are tidied. Scoped to
-- failed RMP-2031 documents only (verified = exactly 2 rows). Idempotent.
-- ============================================================================

UPDATE regulatory_data.master_plan_documents
   SET extraction_status = 'completed',
       processing_mode   = 'not_extractable',
       ocr_required       = false,
       extraction_error   = NULL,
       registry_notes     = COALESCE(NULLIF(registry_notes, ''), '')
         || CASE WHEN COALESCE(registry_notes, '') = '' THEN '' ELSE ' | ' END
         || 'RMP 2031 withdrawn (provisional approval pulled Jul 2020) — not operative; '
         || 'extraction not applied, retained as reference.'
 WHERE extraction_status = 'failed'
   AND plan_version ILIKE '%2031%';
