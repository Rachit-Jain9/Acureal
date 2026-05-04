-- ============================================================================
-- 0045 — ai_response_cache: deduplicate identical AI calls
-- ============================================================================
-- Today every re-extraction of the same document hits Gemini again at full
-- cost. This table caches the parsed response for any (task, model,
-- prompt_sha256, input_sha256) tuple so repeat calls — regenerations, retries
-- after recoverable failures, identical-input batches — are served from the
-- DB instead of the provider.
--
-- Cache key construction (computed in JS, not the DB):
--   sha256(JSON.stringify({ task, provider, model, prompt_sha256, input_sha256 }))
--
-- where input_sha256 is the SHA-256 of the inputs that vary per call —
-- typically the rendered prompt + the document file hash + mime type.
-- Identical inputs → identical key → cache hit.
--
-- Hits skip the provider entirely and write a row to ai_call_logs with
-- status='cache_hit' so cost dashboards still account for the request, just
-- with cost_usd = 0.
--
-- TTL: cache rows carry an `expires_at` timestamp (default 90 days). A
-- daily cron prunes expired rows; the `expires_at` index keeps that scan
-- cheap.
--
-- RLS: cache content is system-scoped (no per-org PII; the cached responses
-- are AI outputs derived from documents that themselves have RLS). We mark
-- the table service-role only by enabling RLS without any user policies.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_response_cache (
  id                BIGSERIAL PRIMARY KEY,
  cache_key         TEXT NOT NULL UNIQUE,
  task              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_version    TEXT,
  prompt_sha256     TEXT,
  input_sha256      TEXT NOT NULL,
  response_jsonb    JSONB NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  cost_usd_at_time  NUMERIC(12, 6),
  hit_count         INTEGER NOT NULL DEFAULT 0,
  last_hit_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
);

-- Cleanup scan filters by expires_at < NOW(); no point indexing past rows.
CREATE INDEX IF NOT EXISTS ai_response_cache_expires_at_idx
  ON public.ai_response_cache (expires_at);

-- Backend-only — RLS enabled with no user policies; service role bypasses RLS.
ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.ai_response_cache             IS 'Cached AI provider responses keyed by (task, provider, model, prompt_sha256, input_sha256). 90-day default TTL.';
COMMENT ON COLUMN public.ai_response_cache.cache_key   IS 'sha256 of canonical-JSON tuple — derived deterministically from the call shape.';
COMMENT ON COLUMN public.ai_response_cache.input_sha256 IS 'sha256 of all per-call varying inputs (rendered prompt + file bytes hash + mime type).';
COMMENT ON COLUMN public.ai_response_cache.expires_at  IS 'Cache row is treated as missing once NOW() > expires_at.';
COMMENT ON COLUMN public.ai_response_cache.hit_count   IS 'Incremented every time this row is served as a hit. Useful for "hot prompt" diagnostics.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'ai_response_cache';
--   -- expect: t
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'ai_response_cache';
--   -- expect: 14 rows
