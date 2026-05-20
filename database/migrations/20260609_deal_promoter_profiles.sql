-- ============================================================================
-- 20260609 — Deal promoter / builder track-record profile
-- ============================================================================
-- Promoter execution risk — a builder who has delivered late on four of five
-- projects — is one of the catastrophic failure modes CLAUDE.md names, and the
-- one the deal model had no home for. This table is that home.
--
-- One row per deal (UNIQUE on deal_id): the analyst's manually-verified
-- findings about the promoter behind the deal — who they are, their delivery
-- history, and their RERA standing. REDIP does not fake a RERA feed (automated
-- RERA verification is a recorded manual blocker); it gives the verified facts
-- a structured home, and riskRadar/promoterProfile compute a deterministic
-- execution posture from them.
--
-- Follows the deal-scoped business-table pattern (dd_items / risk_flags):
-- organization_id defaults to current_organization_id(); RLS is FORCEd with a
-- FOR ALL policy so every read and write is tenant-scoped.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS.
-- Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.deals, public.organizations, public.users from baseline schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deal_promoter_profiles (
  id                BIGSERIAL PRIMARY KEY,
  deal_id           UUID NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL DEFAULT current_organization_id()
                      REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Who the promoter / builder is.
  promoter_name     TEXT,
  entity_type       TEXT CHECK (entity_type IS NULL OR entity_type IN (
                      'individual', 'partnership', 'llp',
                      'private_limited', 'public_limited', 'trust', 'other'
                    )),
  years_active      INTEGER CHECK (years_active     IS NULL OR years_active     >= 0),

  -- Delivery history (manually verified by the analyst).
  total_projects    INTEGER CHECK (total_projects   IS NULL OR total_projects   >= 0),
  delivered_on_time INTEGER CHECK (delivered_on_time IS NULL OR delivered_on_time >= 0),
  delivered_delayed INTEGER CHECK (delivered_delayed IS NULL OR delivered_delayed >= 0),
  ongoing_projects  INTEGER CHECK (ongoing_projects  IS NULL OR ongoing_projects  >= 0),

  -- RERA standing.
  rera_registered   BOOLEAN,
  rera_complaints   INTEGER CHECK (rera_complaints  IS NULL OR rera_complaints  >= 0),

  notes             TEXT,

  -- Provenance — who recorded / last verified this, and when.
  verified_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_promoter_profiles_org_idx
  ON public.deal_promoter_profiles (organization_id);

ALTER TABLE public.deal_promoter_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_promoter_profiles FORCE ROW LEVEL SECURITY;

-- Tenant scoping — identical posture to dd_items / risk_flags: every read and
-- write is confined to the caller's organisation.
DROP POLICY IF EXISTS deal_promoter_profiles_org_scope ON public.deal_promoter_profiles;
CREATE POLICY deal_promoter_profiles_org_scope
  ON public.deal_promoter_profiles
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE public.deal_promoter_profiles IS
  'One row per deal: the analyst-verified promoter / builder track record '
  '(identity, delivery history, RERA standing). Feeds the deterministic '
  'Promoter & Execution posture in the Risk Radar.';

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname = 'deal_promoter_profiles'
--      AND relnamespace = 'public'::regnamespace;
--   -- expect: t, t
--
--   SELECT count(*) FROM public.deal_promoter_profiles;
--   -- expect: 0 (no rows until an analyst records a promoter profile)
