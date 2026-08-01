-- ============================================================================
-- database/migrations/20260801_deal_user_visits.sql
-- ============================================================================
-- Per-user, per-deal "last visited" watermark — the substrate for
-- "what changed since you last looked".
--
-- Why: returning to a deal after three days currently looks identical to
-- returning after three minutes. Every activity surface (attention panel,
-- risk radar, activity feed) measures from FIXED windows (7d / 14d), not from
-- what THIS user has already seen — which is the single biggest reason a
-- daily-work tool fails to become a habit (Strategic Review #6, 2026-07-18).
-- One row per (user, deal) carrying the previous visit is enough to answer
-- "since you last looked" everywhere.
--
-- Design:
--   * `last_visited_at` — the CURRENT visit (upserted on every deal open).
--   * `previous_visited_at` — the visit BEFORE that. The "changed since"
--     question must be answered against the PREVIOUS visit, because the
--     current visit's timestamp is written the moment the page opens — by
--     the time any query runs, "since last_visited_at" is always "nothing".
--   * `visit_count` — cheap engagement signal for the operator, no PII.
--
-- Writes go through an explicit POST /deals/:id/visit route, NOT the
-- workspace composer: the composer declares itself a no-write read model
-- (dealWorkspace.service.js header), and the dashboard prefetches the lite
-- workspace on hover — recording visits there would clear a user's own
-- "what's new" badges by merely mousing over the deals list.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / OR REPLACE / DROP POLICY IF
-- EXISTS throughout).
--
-- Dependencies:
--   * public.current_user_id() + public.current_organization_id()
--     (20260416_multitenancy_foundation.sql)
--   * public.users, public.deals, public.organizations
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_user_visits (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  deal_id          UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_visited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_visited_at  TIMESTAMPTZ,
  visit_count      INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deal_user_visits_user_deal_key UNIQUE (user_id, deal_id)
);

-- The hot lookup is "this user's watermark for this deal" (covered by the
-- UNIQUE constraint's index). The secondary is "this user's watermarks
-- across the org's deals" for portfolio surfaces.
CREATE INDEX IF NOT EXISTS deal_user_visits_user_org_idx
  ON public.deal_user_visits (user_id, organization_id, last_visited_at DESC);

ALTER TABLE public.deal_user_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_user_visits FORCE ROW LEVEL SECURITY;

-- A watermark is personal: you read and write only your own, and only
-- inside your current workspace. The (SELECT …) wrappers are the standing
-- initplan optimisation (see 20260607_user_consents.sql).
DROP POLICY IF EXISTS deal_user_visits_self_read ON public.deal_user_visits;
CREATE POLICY deal_user_visits_self_read ON public.deal_user_visits
  FOR SELECT
  USING (
    user_id = (SELECT public.current_user_id())
    AND organization_id = (SELECT public.current_organization_id())
  );

DROP POLICY IF EXISTS deal_user_visits_self_write ON public.deal_user_visits;
CREATE POLICY deal_user_visits_self_write ON public.deal_user_visits
  FOR INSERT
  WITH CHECK (
    user_id = (SELECT public.current_user_id())
    AND organization_id = (SELECT public.current_organization_id())
  );

DROP POLICY IF EXISTS deal_user_visits_self_update ON public.deal_user_visits;
CREATE POLICY deal_user_visits_self_update ON public.deal_user_visits
  FOR UPDATE
  USING (user_id = (SELECT public.current_user_id()))
  WITH CHECK (
    user_id = (SELECT public.current_user_id())
    AND organization_id = (SELECT public.current_organization_id())
  );

CREATE TRIGGER deal_user_visits_updated_at BEFORE UPDATE ON public.deal_user_visits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.deal_user_visits IS
  'Per-user per-deal visit watermark. previous_visited_at answers "what changed since you last looked" — the current visit is stamped on page open, so the CURRENT timestamp always answers "nothing".';
COMMENT ON COLUMN public.deal_user_visits.previous_visited_at IS
  'The visit before the current one; NULL on a first visit (everything is new).';

COMMIT;

-- ── Verification (run as separate queries) ─────────────────────────────────
-- SELECT count(*) FROM public.deal_user_visits;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'deal_user_visits';
-- \d public.deal_user_visits

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.deal_user_visits;
