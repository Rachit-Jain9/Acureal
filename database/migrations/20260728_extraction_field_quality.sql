-- ─────────────────────────────────────────────────────────────────────────────
-- 20260728_extraction_field_quality.sql
--
-- WHY: `document_extractions.confidence_scores` used to hold a FILL-RATE —
-- 1.0 for any non-empty field, 0 for a null one. It was rendered to operators
-- as "High · 100% confidence" and PRE-TICKED the row for one-click application
-- to the deal record. It measured presence, never correctness: a hallucinated
-- owner name and a perfectly-read one both scored 1.0. Ownership and parcel
-- identity (owner_name, survey_number, khata_number, pid) — CLAUDE.md's
-- legal-four title lane, which is "extraction aid only, with human
-- verification prompts" — arrived pre-approved for bulk apply.
--
-- confidence_scores now carries a DETERMINISTIC score (see
-- backend/src/utils/extractionFieldQuality.js) and stamps `_signal_version: 2`
-- so the learning corpus can tell graded rows from legacy fill-rate rows and
-- never mix the two when calibrating. This column stores the assessment BEHIND
-- each score — the reason an operator reads instead of a bare percentage:
--
--   {
--     "owner_name": {
--       "present": true,
--       "lane": "legal_title",
--       "grounded": true,
--       "schemaValid": null,
--       "status": "verify_legal",
--       "reason": "Found verbatim in the document text, but this is a title &
--                  ownership fact — REDIP never fills these automatically…",
--       "score": 0.4
--     }
--   }
--
-- Additive + nullable, so it is safe to apply at any time and the code is safe
-- to run before it lands: extraction.service feature-detects the column
-- (canStoreFieldQuality) exactly like doc_type and extraction_started_at, and
-- degrades to score-only — still honest, just less explanatory.
--
-- Historical rows keep field_quality NULL. Their confidence_scores are legacy
-- fill-rate and carry no _signal_version; re-running extraction on a document
-- re-mints both. No backfill is attempted: fabricating an assessment for a
-- read whose source text we no longer hold would be exactly the sin this
-- column exists to end.
--
-- Idempotent + paste-safe in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE document_extractions
  ADD COLUMN IF NOT EXISTS field_quality JSONB;

COMMENT ON COLUMN document_extractions.field_quality IS
  'Per-field deterministic verification assessment {status, reason, lane, grounded, schemaValid, score}. Produced by backend/src/utils/extractionFieldQuality.js. NULL on rows extracted before 20260728.';

COMMENT ON COLUMN document_extractions.confidence_scores IS
  'Per-field verification score 0..1 + _overall + _signal_version. v2 = deterministic (grounding/schema/legal-lane). Rows without _signal_version are legacy FILL-RATE (1.0 = field was non-empty) and must be excluded from any calibration.';

COMMIT;
