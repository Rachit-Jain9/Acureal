-- ─────────────────────────────────────────────────────────────────────────────
-- 20260729_extraction_page_coverage.sql
--
-- WHY: REDIP could tell an operator that an extraction "completed". It could
-- not tell them what it did with page 847 of a 900-page pack — or whether
-- page 847 was ever sent at all. On a diligence document, silent truncation is
-- the worst possible failure, because it looks exactly like success.
--
-- This column stores the COVERAGE RECEIPT: REDIP's account of what happened to
-- every page, in terms it can prove by opening the file (see
-- backend/src/utils/coverageReceipt.js + services/ai/pdfPreflight.js).
--
--   {
--     "version": 1,
--     "method": "native_pdf",
--     "detected_pages": 327,      -- pdf-lib counted them
--     "decoded_pages": 327,       -- pdf-lib opened them
--     "submitted_pages": 327,     -- REDIP sent them to the reader
--     "undecodable_pages": 0,
--     "submitted_ratio": 1.0,
--     "evidence_pages": null,     -- NOT YET MEASURABLE — see below
--     "evidence_pages_unavailable_because": "Per-field page citations are not
--        yet captured, so REDIP cannot say which pages a value came from.",
--     "reason": null,
--     "summary": "All 327 pages were sent to the document reader.",
--     "limits": { "max_extraction_mb": 50, "provider_page_cap": 1000 },
--     "size_bytes": 24117248,
--     "notes": ["Document type was identified from the first 2 page(s); all
--                pages were sent for field extraction."]
--   }
--
-- The vocabulary is deliberate. It says `submitted_pages`, never "read": a 200
-- from the provider is not evidence that a model attended to a given page, and
-- this product does not claim what it cannot show. `evidence_pages` — pages
-- actually cited by an extracted fact — is reported as NULL *with its reason*
-- rather than approximated, because approximating it is precisely how the old
-- fill-rate "confidence" score came to lie (removed in #995).
--
-- Also fixed by the accompanying code: `pages_processed` (INTEGER, added long
-- ago) has been NULL on EVERY row ever written — "pages_processed not
-- available from inline extraction". The receipt can finally populate it with
-- the one number it can honestly hold: pages submitted.
--
-- Additive + nullable, so it is safe to apply at any time and the code is safe
-- to run before it lands: extraction.service feature-detects the column
-- (canStorePageCoverage) exactly like doc_type / extraction_started_at /
-- field_quality, and simply omits it until this runs.
--
-- Historical rows keep page_coverage NULL. No backfill: we no longer hold the
-- bytes those extractions read, so any receipt we invented for them would be a
-- guess — the exact thing this column exists to end. Re-running extraction on
-- a document mints a real one.
--
-- Idempotent + paste-safe in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE document_extractions
  ADD COLUMN IF NOT EXISTS page_coverage JSONB;

COMMENT ON COLUMN document_extractions.page_coverage IS
  'Coverage receipt: what REDIP did with every page {version, method, detected_pages, decoded_pages, submitted_pages, undecodable_pages, submitted_ratio, evidence_pages(null until page citations exist), reason, summary, limits, notes}. Produced by backend/src/utils/coverageReceipt.js. Says "submitted", never "read" — a provider 200 is not proof a model attended to a page. NULL on rows extracted before 20260729.';

COMMENT ON COLUMN document_extractions.pages_processed IS
  'Pages SUBMITTED to the document reader (from page_coverage.submitted_pages). NULL on every row written before 20260729, when nothing populated it.';

COMMIT;
