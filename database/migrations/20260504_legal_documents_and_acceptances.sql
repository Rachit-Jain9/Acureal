-- ============================================================================
-- 0040 — Legal documents registry + per-user acceptance log
-- ============================================================================
-- DPDP Act 2023 §6 requires explicit, informed consent recorded against a
-- specific notice version. IT Rules 2021 Rule 3(11) requires a grievance
-- workflow. Indian Contract Act 1872 makes click-wrap acceptance enforceable
-- when there is a clear assent record.
--
-- This migration creates:
--   1. `public.legal_documents`             — versioned T&C / Privacy / Cookie
--   2. `public.user_legal_acceptances`      — per-user acceptance log
--                                             (IP, UA, timestamp)
--   3. Two convenience columns on `users`   — `terms_accepted_at`,
--                                             `privacy_accepted_at`
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS / OR REPLACE.
-- Safe to re-run.
--
-- Dependencies:
--   - `public.current_user_id()` from 20260416_multitenancy_foundation.sql
--   - `public.users` from baseline schema
--
-- Notes for operator:
--   - Apply via Supabase SQL editor (no CONCURRENTLY, runs in a single
--     transaction). The editor auto-wraps in BEGIN/COMMIT — our explicit
--     BEGIN/COMMIT below is harmless when nested inside Supabase's wrapper.
--   - After apply, seed initial legal docs via:
--         node scripts/publish-legal-doc.js terms_of_service v1 \
--             docs/legal/terms_of_service_v1.md
--     (and equivalents for privacy_policy, cookie_policy)
-- ============================================================================

BEGIN;

-- ── 1. legal_documents ──────────────────────────────────────────────────────
-- One row per (kind, version). Exactly one row per kind has is_current=true.
-- Body is markdown; SHA-256 of canonical content stored for tamper detection.
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'terms_of_service',
                    'privacy_policy',
                    'cookie_policy',
                    'data_processing_addendum',
                    'acceptable_use'
                  )),
  version         TEXT NOT NULL,
  effective_at    TIMESTAMPTZ NOT NULL,
  body_md         TEXT NOT NULL,
  content_sha256  TEXT NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT legal_documents_unique_kind_version UNIQUE (kind, version)
);

-- Exactly one current version per kind. The publish script flips this
-- atomically inside a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_one_current_per_kind
  ON public.legal_documents (kind)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS legal_documents_kind_effective_idx
  ON public.legal_documents (kind, effective_at DESC);

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

-- Public read of CURRENT versions. Anonymous + authenticated may read the
-- live version of each kind (these pages are linked from a public signup
-- form). Older versions remain server-side only — fetched via the backend
-- after authentication for audit purposes.
DROP POLICY IF EXISTS legal_documents_public_read_current ON public.legal_documents;
CREATE POLICY legal_documents_public_read_current
  ON public.legal_documents
  FOR SELECT
  USING (is_current = true);

-- ── 2. user_legal_acceptances ───────────────────────────────────────────────
-- Append-only acceptance log. UNIQUE (user_id, document_id) makes
-- recordAcceptance idempotent.
CREATE TABLE IF NOT EXISTS public.user_legal_acceptances (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id  BIGINT NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   INET,
  user_agent   TEXT,
  CONSTRAINT user_legal_acceptances_unique_user_doc UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS user_legal_acceptances_user_id_idx
  ON public.user_legal_acceptances (user_id);

CREATE INDEX IF NOT EXISTS user_legal_acceptances_document_id_idx
  ON public.user_legal_acceptances (document_id);

ALTER TABLE public.user_legal_acceptances ENABLE ROW LEVEL SECURITY;

-- Self-read: a user may read their own acceptance rows. Backend (postgres
-- role) bypasses RLS for grievance/audit needs.
DROP POLICY IF EXISTS user_legal_acceptances_self_read ON public.user_legal_acceptances;
CREATE POLICY user_legal_acceptances_self_read
  ON public.user_legal_acceptances
  FOR SELECT
  USING (user_id = (SELECT public.current_user_id()));

-- INSERT/UPDATE/DELETE intentionally have no policy. All writes go through
-- the backend (postgres role) which bypasses RLS. Append-only is enforced
-- by the unique constraint plus backend service contract.

-- ── 3. users convenience columns ────────────────────────────────────────────
-- Cached "latest acceptance timestamp" per kind, for cheap lookup in auth
-- middleware. Source of truth remains user_legal_acceptances.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

-- Index for "find users on a stale ToS version" sweeps (Phase 2 work).
CREATE INDEX IF NOT EXISTS users_terms_accepted_at_idx
  ON public.users (terms_accepted_at);

COMMIT;

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname IN ('legal_documents', 'user_legal_acceptances')
--      AND relnamespace = 'public'::regnamespace;
--   -- expect: t, t (both rows)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name IN ('terms_accepted_at', 'privacy_accepted_at');
--   -- expect: 2 rows
--
--   SELECT count(*) FROM public.legal_documents;
--   -- expect: 0 (seeded by publish script after migration)
