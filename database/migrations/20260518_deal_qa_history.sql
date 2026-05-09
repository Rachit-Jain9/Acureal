-- ============================================================================
-- 0064 — deal_qa_history: persistent transcript of analyst Q&A on each deal
-- ============================================================================
-- Tier-2 #11 from the 2026-05-08 handoff: a narrow Deal Q&A agent. Analyst
-- types a question on the deal Overview tab; the backend retrieves
-- relevant context via pgvector (document_embeddings) + structured Claude
-- reasoning with mandatory citations; the answer + cited sources land in
-- this table so the deal page shows a Q&A history alongside the active
-- input.
--
-- Why a dedicated table (not just `ai_artifacts`):
--   • Q&A is a high-volume, append-only stream — analysts may ask 5-10
--     questions on a deal during DD. ai_artifacts is sized for
--     long-form, low-volume artifacts (deal_analysis, ic_memo, etc.).
--   • Each Q&A row has its own citations array. Trying to coerce that
--     into ai_artifacts.content_jsonb makes citation queries painful.
--   • History view ("show me everything Rachit asked on this deal") is
--     simpler with deal_id + asked_by + created_at on a flat table.
--
-- Citation contract (citations JSONB):
--   [
--     {
--       "document_id":   "<uuid>",     -- documents.id (or null for non-doc)
--       "document_name": "Sale Deed.pdf",
--       "page_number":   3,
--       "chunk_text":    "<excerpt that supports the answer>",
--       "similarity":    0.82,         -- cosine similarity at retrieval
--       "embedding_id":  "<uuid>"      -- document_embeddings.id (provenance)
--     }
--   ]
--   The application layer enforces ≥1 citation per answer. The DB column
--   itself is just JSONB — no DB-level CHECK because the app's structured
--   output validator (zod) catches malformed citations earlier.
--
-- Per CLAUDE.md hard rules:
--   • Every answer is grounded in retrieved chunks. The Claude system
--     prompt explicitly forbids unsourced claims.
--   • No financial / regulatory math is delegated to Claude — it
--     paraphrases facts that came back from `embeddings.searchSimilar()`,
--     deal financials, risk_flags, and benchmarks.
--   • The "AI-assisted — requires human review" disclaimer renders
--     alongside every answer in the UI.
--
-- Idempotent: every operation guarded by IF NOT EXISTS / DROP IF EXISTS.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_qa_history (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id                 UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  asked_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Verbatim question text. Truncated at 2000 chars to keep payloads
  -- predictable; longer prose is a research request, not a Q&A.
  question                TEXT NOT NULL,
  -- Markdown — Claude is instructed to keep answers tight (3-6 sentences).
  answer                  TEXT,
  -- Array per the contract above; null while the answer is generating.
  citations               JSONB DEFAULT '[]'::jsonb,

  -- Lineage to the Claude call so cost/latency/prompt-version queries
  -- stay end-to-end traceable (same pattern as ai_artifacts).
  generated_by_call_id    UUID REFERENCES public.ai_call_logs(id) ON DELETE SET NULL,

  -- Numerical drift surface — same shape as ai_artifacts.numerical_drifts.
  -- The Q&A pipeline runs the verifier over the answer before persisting.
  numerical_drifts        JSONB,
  verified_at             TIMESTAMPTZ,

  -- Snapshot hash of (question + retrieved chunks) so identical re-asks
  -- can short-circuit to the previous answer.
  snapshot_hash           TEXT,

  -- Lifecycle. Most rows live as `complete`; `failed` lets us surface
  -- "Claude error, retry?" in the UI without polluting answer history.
  status                  TEXT NOT NULL DEFAULT 'complete'
                            CHECK (status IN ('complete', 'failed')),
  failure_reason          TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Main lookup: the deal page renders the most recent N Q&A rows.
CREATE INDEX IF NOT EXISTS deal_qa_history_deal_created_idx
  ON public.deal_qa_history (deal_id, created_at DESC);

-- "Has this exact question been asked before on this deal?" — short-circuit
-- via snapshot_hash. Partial because most rows in steady state will not
-- be repeats; only flag the duplicates worth indexing.
CREATE INDEX IF NOT EXISTS deal_qa_history_snapshot_hash_idx
  ON public.deal_qa_history (deal_id, snapshot_hash)
  WHERE snapshot_hash IS NOT NULL;

-- Org-wide reporting (volume / cost dashboards).
CREATE INDEX IF NOT EXISTS deal_qa_history_org_created_idx
  ON public.deal_qa_history (organization_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Same multi-tenant model as comps / deals / risk_flags. Scoped to
-- organization_id; RLS function `current_organization_id()` is the
-- request-scoped session variable set by middleware/auth.js.

ALTER TABLE public.deal_qa_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_qa_history_select ON public.deal_qa_history;
CREATE POLICY deal_qa_history_select ON public.deal_qa_history
  FOR SELECT
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS deal_qa_history_insert ON public.deal_qa_history;
CREATE POLICY deal_qa_history_insert ON public.deal_qa_history
  FOR INSERT
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS deal_qa_history_update ON public.deal_qa_history;
CREATE POLICY deal_qa_history_update ON public.deal_qa_history
  FOR UPDATE
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS deal_qa_history_delete ON public.deal_qa_history;
CREATE POLICY deal_qa_history_delete ON public.deal_qa_history
  FOR DELETE
  USING (organization_id = current_organization_id());

COMMENT ON TABLE  public.deal_qa_history          IS 'Tier-2 #11 — analyst Q&A transcript per deal. Each row carries question + answer + citations array tying back to retrieved document chunks. Append-only; a high-volume sibling to ai_artifacts.';
COMMENT ON COLUMN public.deal_qa_history.citations IS 'Array of { document_id, document_name, page_number, chunk_text, similarity, embedding_id }. App layer enforces >=1 citation per answer.';
COMMENT ON COLUMN public.deal_qa_history.snapshot_hash IS 'sha256 of (question + retrieved chunks). Identical re-asks short-circuit to the cached answer until the underlying corpus changes.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.deal_qa_history');
--     -- expect: deal_qa_history
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'deal_qa_history';
--     -- expect: t
--   SELECT count(*) FROM pg_indexes WHERE tablename = 'deal_qa_history';
--     -- expect: 4 (PK + 3 explicit indexes)
--   SELECT count(*) FROM pg_policy WHERE polrelid = 'public.deal_qa_history'::regclass;
--     -- expect: 4 (select / insert / update / delete)
