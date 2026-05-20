-- ============================================================================
-- 20260608 — Improvement-signal ledger (Phase 5.1 — the learning loop)
-- ============================================================================
-- Phase 5 of the plan is "the learning loop": REDIP should measurably improve
-- from the data and feedback that flows through it. This table is the first
-- piece — a Layer-5 (telemetry) store for the signals the product already
-- generates but does not yet keep as learning signal.
--
-- The first signal type is `extraction_field_review`: when a user reviews an
-- AI document extraction and applies corrections, one row is appended per
-- field recording whether that field was corrected. From that, REDIP can
-- compute a real extraction-accuracy metric per (doc_type, field) — "which
-- fields does the model get wrong" — with no new user-facing surface.
--
-- Privacy posture (see docs/DATA_GOVERNANCE.md):
--   - This is Layer 5 — operational telemetry. It holds NO deal documents and
--     NO field VALUES — only metadata: the field KEY, the doc type, the AI
--     provider, a was-corrected boolean, and a confidence score. A field key
--     is a schema name (`survey_number`), never a value.
--   - `user_id` is populated only when the acting user has granted the
--     `product_improvement` consent; otherwise it is left NULL and the row is
--     a fully-anonymous aggregate count. The consent check happens in
--     learningSignals.service.js before the write.
--
-- Writes go exclusively through learningSignals.service.js (postgres role).
-- RLS provides read scoping as defense-in-depth; there is deliberately no
-- INSERT/UPDATE/DELETE policy — the same posture as security_events.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS.
-- Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.organizations, public.users from the baseline schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.improvement_signals (
  id              BIGSERIAL PRIMARY KEY,

  -- Nullable: a platform-wide signal is not scoped to one tenant.
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Nullable by design: populated only with `product_improvement` consent.
  -- NULL = a fully-anonymous aggregate signal.
  user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,

  signal_type     TEXT NOT NULL CHECK (signal_type IN (
                    'extraction_field_review'
                  )),

  -- Values-free metadata only. For extraction_field_review:
  --   { doc_type, ai_provider, field_key, was_corrected, ai_confidence }
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Aggregation index: the extraction-accuracy metric groups by signal_type
-- over a trailing time window.
CREATE INDEX IF NOT EXISTS improvement_signals_type_created_idx
  ON public.improvement_signals (signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS improvement_signals_org_idx
  ON public.improvement_signals (organization_id);

ALTER TABLE public.improvement_signals ENABLE ROW LEVEL SECURITY;

-- Read scoped to the caller's organization; platform-wide rows
-- (organization_id IS NULL) are readable from any authenticated org context.
-- Writes have no policy — they go through learningSignals.service.js only.
DROP POLICY IF EXISTS improvement_signals_org_read ON public.improvement_signals;
CREATE POLICY improvement_signals_org_read
  ON public.improvement_signals
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id = current_organization_id()
  );

COMMENT ON TABLE public.improvement_signals IS
  'Layer-5 telemetry for the Phase 5 learning loop: values-free signals (e.g. '
  'which extraction fields users correct) used to measure and improve REDIP. '
  'Written only by learningSignals.service.js; user_id is set only with '
  'product_improvement consent.';

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname = 'improvement_signals' AND relnamespace = 'public'::regnamespace;
--   -- expect: t
--
--   SELECT count(*) FROM public.improvement_signals;
--   -- expect: 0 (no rows until a user reviews an extraction)
