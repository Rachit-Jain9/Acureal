-- ============================================================================
-- 20260607 — Per-purpose consent ledger (DPDP Act 2023 §6 granular consent)
-- ============================================================================
-- DPDP §6(1) requires consent to be "free, specific, informed, unconditional
-- and unambiguous" and given for a defined purpose. The single bundled
-- Terms + Privacy acceptance from 20260504 satisfies the *contractual* gate
-- but not the *purpose-specific* one — a user cannot today say "yes to the
-- core service, no to marketing", nor withdraw one purpose without the rest.
--
-- This migration adds an append-only consent ledger. One row per consent
-- decision; the newest row per (user_id, purpose) is the current state. A
-- withdrawal is a new row with granted = false, never an UPDATE — so the
-- full history is auditable and §6(4) withdrawal is a first-class event.
--
-- It is also the prerequisite for the anonymized cross-tenant benchmark
-- feature: a row will contribute to an aggregate only if its owning user
-- holds a current granted = true row for purpose 'anonymized_benchmarking'.
--
-- Purposes (essential service is implied by using REDIP and is NOT stored —
-- only the optional, separately-withdrawable purposes live here):
--   product_improvement      — diagnostics & usage analysis to improve REDIP
--   anonymized_benchmarking  — contribute de-identified deal data to market
--                              benchmarks (gates the Phase 3 benchmark layer)
--   marketing                — product news & outreach email
--   ai_processing            — optional AI features beyond core extraction
--
-- Writes go exclusively through consent.service.js on the backend (postgres
-- role). RLS gives each user read access to their own rows as defense in
-- depth; there is deliberately no INSERT/UPDATE/DELETE policy — the same
-- "managed via the backend service" posture as user_legal_acceptances and
-- security_events.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS.
-- Safe to re-run.
--
-- Dependencies:
--   - public.current_user_id() from 20260416_multitenancy_foundation
--   - public.users from the baseline schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_consents (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  purpose         TEXT NOT NULL CHECK (purpose IN (
                    'product_improvement',
                    'anonymized_benchmarking',
                    'marketing',
                    'ai_processing'
                  )),
  granted         BOOLEAN NOT NULL,

  -- Privacy Policy version in force when the decision was made. Lets an
  -- auditor tie every consent to the exact notice the user was shown.
  policy_version  TEXT,

  -- Where the decision originated. 'signup' = optional toggles on the
  -- registration form; 'privacy_centre' = the self-service Privacy Centre;
  -- 'admin' = operator action on the user's behalf; 'import' = backfill.
  source          TEXT NOT NULL DEFAULT 'privacy_centre' CHECK (source IN (
                    'signup',
                    'privacy_centre',
                    'admin',
                    'import'
                  )),

  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current-state lookup: newest row per (user, purpose). The
-- DISTINCT ON (purpose) ... ORDER BY purpose, created_at DESC query in
-- consent.service.js rides this index.
CREATE INDEX IF NOT EXISTS user_consents_user_purpose_created_idx
  ON public.user_consents (user_id, purpose, created_at DESC);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- Self-read: a user may read their own consent history. Backend (postgres
-- role) bypasses RLS for grievance/audit needs. Writes have no policy —
-- they go through consent.service.js (postgres role) only.
DROP POLICY IF EXISTS user_consents_self_read ON public.user_consents;
CREATE POLICY user_consents_self_read
  ON public.user_consents
  FOR SELECT
  USING (user_id = (SELECT public.current_user_id()));

-- INSERT/UPDATE/DELETE intentionally have no policy. The ledger is
-- append-only: a withdrawal is a new granted = false row, never an UPDATE.
-- Append-only is enforced by the backend service contract.

COMMENT ON TABLE public.user_consents IS
  'Append-only per-purpose consent ledger (DPDP Act 2023 §6). Newest row per '
  '(user_id, purpose) is the current state; a withdrawal is a new granted = '
  'false row. Written only by consent.service.js via the backend.';
COMMENT ON COLUMN public.user_consents.purpose IS
  'The specific processing purpose. Essential service is implied and not stored.';
COMMENT ON COLUMN public.user_consents.policy_version IS
  'Privacy Policy version in force when the decision was recorded.';

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname = 'user_consents' AND relnamespace = 'public'::regnamespace;
--   -- expect: t
--
--   SELECT count(*) FROM public.user_consents;
--   -- expect: 0 (no rows until a user records a consent decision)
