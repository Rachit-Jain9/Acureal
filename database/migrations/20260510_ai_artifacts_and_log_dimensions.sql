-- ============================================================================
-- 0046 — ai_artifacts + ai_call_logs dimensional add-ons
-- ============================================================================
-- Two related changes that ship together:
--
-- 1. ai_artifacts — persists AI-generated narrative outputs (deal analysis,
--    risk briefs, IC-memo drafts) as draft artifacts tied to a specific
--    deal + a snapshot hash of the inputs that produced them. Primary
--    consumer: the deal Overview tab now fetches the latest artifact on
--    mount instead of regenerating from Claude on every page open. Only
--    `Refresh` re-runs the model.
--
--    Columns:
--      • snapshot_hash — sha256 of the input payload that produced the
--        artifact. Cache invalidates naturally when underlying data shifts
--        (deal financials change → new hash → next fetch is a miss → fresh
--        generation).
--      • status — 'draft' | 'approved' | 'archived'. Phase-3 tool registry
--        (per docs/AI_ROADMAP.md) gates non-draft transitions behind user
--        approval. For now everything lands as 'draft'.
--      • generated_by_call_id — FK to ai_call_logs so artifact ↔ call
--        lineage is queryable end-to-end (cost, latency, prompt version,
--        cache hits all attributable to the artifact).
--
-- 2. ai_call_logs.language + ai_call_logs.doctype — surfaces the language
--    and doc-type dimensions of each AI call into the call ledger. Today
--    those facts are buried inside `metadata` JSONB; making them
--    first-class columns is what enables the per-language and per-doctype
--    quality calibration ChatGPT's review (#4 incorporable item) called
--    out. Both are nullable — non-extraction calls (reasoning, market
--    synthesis) leave them NULL.
--
-- Idempotent: every operation guarded by IF NOT EXISTS / DROP IF EXISTS.
-- ============================================================================

BEGIN;

-- ── ai_artifacts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_artifacts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id                 UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  artifact_type           TEXT NOT NULL CHECK (artifact_type IN (
                            'deal_analysis',
                            'ic_memo',
                            'risk_brief',
                            'parcel_narrative'
                          )),
  content_md              TEXT NOT NULL,
  content_jsonb           JSONB,
  snapshot_hash           TEXT,
  generated_by_call_id    UUID REFERENCES public.ai_call_logs(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'approved', 'archived')),
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by             UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup keyed on (deal, type, generated_at DESC) — getLatestArtifact path.
CREATE INDEX IF NOT EXISTS ai_artifacts_deal_type_generated_at_idx
  ON public.ai_artifacts (deal_id, artifact_type, generated_at DESC);

-- Org-wide list view; partitioned by status for "pending approval" queues.
CREATE INDEX IF NOT EXISTS ai_artifacts_org_status_idx
  ON public.ai_artifacts (organization_id, status, generated_at DESC);

-- Cache-style lookup for "do we already have this exact analysis?"
CREATE INDEX IF NOT EXISTS ai_artifacts_snapshot_hash_idx
  ON public.ai_artifacts (deal_id, artifact_type, snapshot_hash)
  WHERE snapshot_hash IS NOT NULL;

ALTER TABLE public.ai_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_artifacts_select ON public.ai_artifacts;
CREATE POLICY ai_artifacts_select ON public.ai_artifacts
  FOR SELECT
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS ai_artifacts_insert ON public.ai_artifacts;
CREATE POLICY ai_artifacts_insert ON public.ai_artifacts
  FOR INSERT
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS ai_artifacts_update ON public.ai_artifacts;
CREATE POLICY ai_artifacts_update ON public.ai_artifacts
  FOR UPDATE
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE  public.ai_artifacts IS 'AI-generated narrative outputs (deal analysis, IC memo drafts, risk briefs). Tied to a deal + a snapshot hash so subsequent fetches return the cached artifact until inputs shift.';
COMMENT ON COLUMN public.ai_artifacts.snapshot_hash IS 'sha256 of the input payload that produced the artifact. Used as a cache key — change in inputs → new hash → next fetch regenerates.';
COMMENT ON COLUMN public.ai_artifacts.generated_by_call_id IS 'Lineage to ai_call_logs — links an artifact to the specific Claude call that produced it (cost, latency, prompt version queryable end-to-end).';
COMMENT ON COLUMN public.ai_artifacts.status IS 'draft | approved | archived. Tier-3 tool registry gates non-draft transitions behind user approval.';

-- ── ai_call_logs dimensional adds (Grok #4) ─────────────────────────────────
-- Both nullable because non-extraction calls (reasoning, market synthesis)
-- have no language/doctype dimension. Extraction calls populate them so
-- downstream calibration ("Kannada title-deed extraction quality this
-- month") becomes a single GROUP BY.
ALTER TABLE public.ai_call_logs
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS doctype  TEXT;

CREATE INDEX IF NOT EXISTS ai_call_logs_language_doctype_idx
  ON public.ai_call_logs (language, doctype, created_at DESC)
  WHERE language IS NOT NULL OR doctype IS NOT NULL;

COMMENT ON COLUMN public.ai_call_logs.language IS 'ISO 639-1 + region code if relevant (en, hi, kn, en-IN). NULL for calls without a language dimension.';
COMMENT ON COLUMN public.ai_call_logs.doctype IS 'Doctype key from extractionPrompts.js (sale_deed, rmp_table, ec, etc.). NULL for calls without a doctype dimension.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.ai_artifacts');
--     -- expect: ai_artifacts
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'ai_artifacts';
--     -- expect: t
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'ai_call_logs'
--      AND column_name IN ('language', 'doctype');
--     -- expect: 2 rows
