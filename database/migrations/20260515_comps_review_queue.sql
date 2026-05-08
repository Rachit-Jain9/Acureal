-- ============================================================================
-- 0061 — comps_review_queue: human-in-the-loop ingestion staging table
-- ============================================================================
-- This is the foundation table for REDIP's data flywheel (Tier-0 #1 in the
-- 2026-05-08 handoff). External comp data — broker quotes forwarded to a
-- dedicated mailbox, IPC quarterly PDFs uploaded by analysts, scraped
-- listing-portal exports — lands here first as raw + extracted JSON, sits
-- pending human review, and only commits to the production `comps` table
-- after a reviewer approves the structured payload.
--
-- Why a separate table (not just `comps.is_verified=false`):
--   • The schema of an extracted broker quote does NOT cleanly map to the
--     `comps` schema until a reviewer normalizes (asset class, transaction
--     type, sqft↔acres, BHK config, etc.). Storing half-mapped rows in
--     `comps` would corrupt the deal-comp similarity scorer.
--   • Lineage to the source document, sender email, and extraction call
--     belongs on the queue row, not on every committed comp.
--   • Rejected items must remain queryable (audit trail, dedupe) without
--     polluting the production comps table.
--
-- Status flow:
--   pending_extraction  → extracting → pending_review
--                                       ↓ (reviewer)
--                                   approved   → committed (FK to comps row)
--                                   rejected   → terminal
--                                   failed     → terminal (extraction died)
--
-- Source taxonomy:
--   • email_broker_quote      — forwarded broker email with attached quote
--   • email_ipc_report        — forwarded JLL/CW/Knight Frank/Colliers report
--   • email_other             — generic email forward, classifier picks doctype
--   • manual_upload           — analyst uploads a PDF/spreadsheet directly
--   • api_listing_portal      — scraped listing portal export (future)
--
-- Per CLAUDE.md AI routing: extraction routes to Gemini (not Claude); only
-- the structured_payload + reviewer_edits get persisted here. Math (price
-- normalization, sqft↔acres, ₹↔Cr conversion) happens in deterministic JS,
-- never in the LLM.
--
-- Idempotent: every operation guarded by IF NOT EXISTS / DROP IF EXISTS.
-- Safe to re-apply.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.comps_review_queue (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Where the row came from. Used to filter the reviewer queue ("show me
  -- only broker emails this week") and to weight extraction confidence
  -- (IPC reports tend to be cleaner than scraped portals).
  source                      TEXT NOT NULL CHECK (source IN (
                                'email_broker_quote',
                                'email_ipc_report',
                                'email_other',
                                'manual_upload',
                                'api_listing_portal'
                              )),

  -- Provenance metadata that doesn't fit cleanly in dedicated columns:
  -- email sender, subject, message-id, received-at; or for manual_upload,
  -- the analyst's note. JSONB so the shape can vary by source without
  -- schema migrations.
  source_meta                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Pointer to the original artifact (PDF/HTML/image) in storage. For
  -- email_*, this is the saved raw email or its primary attachment.
  -- NULL when source_meta carries the full structured payload (e.g. a
  -- direct API push that arrives already-parsed — future use case).
  raw_doc_url                 TEXT,
  raw_doc_mime                TEXT,
  raw_doc_size_bytes          BIGINT,
  -- sha256 of the raw doc bytes — partial unique index below uses this
  -- to dedupe re-ingestion of the same attachment.
  raw_doc_sha256              TEXT,

  -- Lineage to the extraction call that produced structured_payload.
  -- NULL until extraction runs (state = pending_extraction → extracting).
  extraction_id               UUID REFERENCES public.document_extractions(id) ON DELETE SET NULL,

  -- The structured comps array as extracted by Gemini. Shape:
  --   { "comps": [ { "project_name": "...", "rate_per_sqft": ..., ... } ],
  --     "report_metadata": { "as_of_date": "...", "publisher": "...", ... } }
  -- One queue row can produce multiple committed comps (e.g. an IPC
  -- report with 30 transactions — one row per logical batch, multiple
  -- comps inside structured_payload).
  structured_payload          JSONB,

  -- Per-field confidence map from extraction.service.js. Used by the
  -- reviewer UI to highlight low-confidence fields needing manual
  -- attention. Shape: { "field_name": 0..1, "_overall": 0..1 }.
  confidence_scores           JSONB,

  -- Reviewer edits applied on top of structured_payload before commit.
  -- Same shape; merge happens at commit time, not on save (so we keep
  -- the original extraction immutable for audit).
  reviewer_edits              JSONB DEFAULT '{}'::jsonb,

  -- Reviewer notes — free text, optional. Often used for "couldn't verify
  -- developer name; flagged for follow-up."
  reviewer_notes              TEXT,

  -- Lifecycle.
  status                      TEXT NOT NULL DEFAULT 'pending_extraction'
                                CHECK (status IN (
                                  'pending_extraction',
                                  'extracting',
                                  'pending_review',
                                  'approved',
                                  'rejected',
                                  'committed',
                                  'failed'
                                )),

  -- Reviewer audit. NULL until the reviewer clicks approve/reject.
  reviewed_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at                 TIMESTAMPTZ,

  -- Why a row was rejected — surfaced in the queue and included in
  -- ingestion-quality dashboards. Free-text + a structured reason code
  -- in reviewer_edits.rejection_reason_code is preferred.
  rejection_reason            TEXT,

  -- Once committed, the IDs of the comps rows inserted from this queue
  -- entry. UUID[] because one IPC report → many comps. Null while the
  -- row is still pre-commit; immutable once committed.
  committed_comp_ids          UUID[] DEFAULT NULL,
  committed_at                TIMESTAMPTZ,
  committed_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Failure surface. Populated by the extraction worker when status
  -- transitions to 'failed' so the reviewer can see what blew up
  -- without diving into ai_call_logs.
  failure_reason              TEXT,

  -- Email threading: when multiple emails arrive in the same broker
  -- thread, group them in the reviewer UI. NULL for non-email sources.
  email_thread_id             TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────────────────

-- Main queue list — "show me pending-review items, newest first".
CREATE INDEX IF NOT EXISTS comps_review_queue_org_status_created_idx
  ON public.comps_review_queue (organization_id, status, created_at DESC);

-- Source-filtered list — "show me broker quotes from this week".
CREATE INDEX IF NOT EXISTS comps_review_queue_org_source_created_idx
  ON public.comps_review_queue (organization_id, source, created_at DESC);

-- Dedupe partial unique: same org cannot ingest the same byte-identical
-- attachment twice. Partial because some sources don't have an attachment
-- (manual entry, future API push) — those rows always pass the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS comps_review_queue_org_doc_sha_uniq
  ON public.comps_review_queue (organization_id, raw_doc_sha256)
  WHERE raw_doc_sha256 IS NOT NULL;

-- Extraction join — when an extraction completes, the worker looks up
-- the queue row by extraction_id to flip status to pending_review.
CREATE INDEX IF NOT EXISTS comps_review_queue_extraction_id_idx
  ON public.comps_review_queue (extraction_id)
  WHERE extraction_id IS NOT NULL;

-- Email-thread roll-up — used by the reviewer UI's "thread view".
CREATE INDEX IF NOT EXISTS comps_review_queue_email_thread_idx
  ON public.comps_review_queue (organization_id, email_thread_id, created_at DESC)
  WHERE email_thread_id IS NOT NULL;

-- ── updated_at trigger ─────────────────────────────────────────────────────
-- Reuses the existing global trigger function from schema.sql.
DROP TRIGGER IF EXISTS comps_review_queue_set_updated_at ON public.comps_review_queue;
CREATE TRIGGER comps_review_queue_set_updated_at
  BEFORE UPDATE ON public.comps_review_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Same model as comps / documents / deals — multi-tenant isolation by
-- organization_id, enforced via the current_organization_id() request
-- context set by middleware/auth.js.

ALTER TABLE public.comps_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comps_review_queue_select ON public.comps_review_queue;
CREATE POLICY comps_review_queue_select ON public.comps_review_queue
  FOR SELECT
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS comps_review_queue_insert ON public.comps_review_queue;
CREATE POLICY comps_review_queue_insert ON public.comps_review_queue
  FOR INSERT
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS comps_review_queue_update ON public.comps_review_queue;
CREATE POLICY comps_review_queue_update ON public.comps_review_queue
  FOR UPDATE
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS comps_review_queue_delete ON public.comps_review_queue;
CREATE POLICY comps_review_queue_delete ON public.comps_review_queue
  FOR DELETE
  USING (organization_id = current_organization_id());

-- ── Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE  public.comps_review_queue                IS 'Human-in-the-loop ingestion staging for comp data. External docs land here, get extracted, sit pending review, and only commit to comps after analyst approval. Foundation of the data flywheel.';
COMMENT ON COLUMN public.comps_review_queue.source         IS 'Origin taxonomy: email_broker_quote | email_ipc_report | email_other | manual_upload | api_listing_portal.';
COMMENT ON COLUMN public.comps_review_queue.structured_payload IS 'Gemini-extracted comps array + report metadata. Multiple comps possible per row (one IPC report → many transactions).';
COMMENT ON COLUMN public.comps_review_queue.reviewer_edits IS 'Analyst overrides applied on top of structured_payload at commit time. Original extraction stays immutable for audit.';
COMMENT ON COLUMN public.comps_review_queue.committed_comp_ids IS 'IDs of the comps rows inserted at commit. Array because one queue row can produce multiple comps. Immutable once set.';
COMMENT ON COLUMN public.comps_review_queue.raw_doc_sha256 IS 'SHA-256 of the source attachment bytes. Partial unique with organization_id prevents re-ingestion of the same file.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.comps_review_queue');
--     -- expect: comps_review_queue
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'comps_review_queue';
--     -- expect: t
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'comps_review_queue';
--     -- expect: 5 indexes + 1 PK
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.comps_review_queue'::regclass;
--     -- expect: 4 policies (select, insert, update, delete)
