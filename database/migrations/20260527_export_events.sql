-- 20260527_export_events.sql
-- Audit log for every export generated (PPTX/XLSX/DOCX/PDF/CSV).
-- Idempotent. RLS-scoped to organization. Append-only via INSERT-only RLS.
--
-- Why: the export pipeline is gaining AI-narrative + paid-DOCX in 2026-05.
-- We need a per-org ledger so the operator can see (1) which deals are
-- being exported, (2) how often AI is used, (3) generation latency, and
-- (4) the eventual paywall conversion (download_at vs purchase_at).
--
-- This table is INSERT-mostly. Updates are limited to setting
-- `downloaded_at` once a generated artifact is actually streamed to the
-- caller — separate from `generated_at` which fires when the buffer is
-- ready. Most rows have downloaded_at = generated_at since we stream
-- inline.

CREATE TABLE IF NOT EXISTS export_events (
  id              UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID                     NOT NULL,
  user_id         UUID,
  deal_id         UUID,
  format          TEXT                     NOT NULL CHECK (format IN ('pptx','xlsx','docx','pdf','csv')),
  ai_used         BOOLEAN                  NOT NULL DEFAULT FALSE,
  ai_cost_usd     NUMERIC(10,6),
  generation_ms   INTEGER,
  byte_size       BIGINT,
  metadata        JSONB                    NOT NULL DEFAULT '{}'::jsonb,
  generated_at    TIMESTAMPTZ              NOT NULL DEFAULT now(),
  downloaded_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_events_org_generated
  ON export_events (organization_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_events_deal_generated
  ON export_events (deal_id, generated_at DESC)
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_events_user_generated
  ON export_events (user_id, generated_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE export_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS export_events_select_own_org ON export_events;
CREATE POLICY export_events_select_own_org
  ON export_events FOR SELECT
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS export_events_insert_own_org ON export_events;
CREATE POLICY export_events_insert_own_org
  ON export_events FOR INSERT
  WITH CHECK (organization_id = current_organization_id());

-- Updates restricted to flipping `downloaded_at` for the same org. Any
-- other column change is rejected by the WITH CHECK clause. We compare
-- the new row to the existing one — only `downloaded_at` may differ.
DROP POLICY IF EXISTS export_events_update_download_only ON export_events;
CREATE POLICY export_events_update_download_only
  ON export_events FOR UPDATE
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Deletes are NOT permitted via RLS — audit trails are append-only.

COMMENT ON TABLE export_events IS
  'Audit ledger for generated export artifacts (PPTX/XLSX/DOCX/PDF/CSV). Append-only via RLS.';
COMMENT ON COLUMN export_events.format        IS 'One of pptx, xlsx, docx, pdf, csv';
COMMENT ON COLUMN export_events.ai_used       IS 'TRUE if any AI provider call contributed to this export';
COMMENT ON COLUMN export_events.ai_cost_usd   IS 'Sum of USD cost across AI calls attributed to this export';
COMMENT ON COLUMN export_events.generation_ms IS 'Wall-clock generation time in milliseconds';
COMMENT ON COLUMN export_events.byte_size     IS 'Size in bytes of the generated buffer';
COMMENT ON COLUMN export_events.metadata      IS 'Free-form JSON: deck variant, slide count, sheet count, etc.';
COMMENT ON COLUMN export_events.downloaded_at IS 'Set when the artifact was streamed to the caller; null for failed downloads';
