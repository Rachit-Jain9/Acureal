-- ============================================================================
-- 20260610 — Deal ↔ comp reliance (Workstream C1 — the data-network seed)
-- ============================================================================
-- REDIP's moat is network learning: each deal worked should make the next one
-- smarter. The cheapest, most compounding signal to start with is which
-- verified comparables an analyst actually *relies on* when underwriting a
-- deal — the ground truth a future learned comp-ranker needs, and a genuinely
-- useful "these are the comps this deal rests on" record in its own right.
--
-- Two pieces:
--
--   1. public.deal_comp_reliance — the durable operational state. One row per
--      (deal, comp) the analyst has marked as relied-upon. Presence = relied.
--      Follows the deal-scoped business-table pattern (dd_items / risk_flags /
--      deal_promoter_profiles): organization_id defaults to
--      current_organization_id(); RLS is FORCEd with a FOR ALL policy.
--
--   2. The improvement_signals.signal_type CHECK is widened to also accept
--      `comp_reliance`, so every reliance toggle ALSO appends a values-free
--      Layer-5 learning signal (via learningSignals.service.js) carrying the
--      deterministic scorer's verdict at the moment of reliance.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS, and the
-- CHECK constraint is dropped-then-re-added. Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.deals, public.comps, public.organizations, public.users (baseline)
--   - public.improvement_signals from 20260608_improvement_signals
-- ============================================================================

-- ── 1. Operational state — which comps a deal relies on ─────────────────────

CREATE TABLE IF NOT EXISTS public.deal_comp_reliance (
  id              BIGSERIAL PRIMARY KEY,
  deal_id         UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  comp_id         UUID NOT NULL REFERENCES public.comps(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL DEFAULT current_organization_id()
                    REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Provenance — who marked this comp as relied-on, and when.
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One reliance row per (deal, comp). The toggle inserts / deletes.
  UNIQUE (deal_id, comp_id)
);

CREATE INDEX IF NOT EXISTS deal_comp_reliance_deal_idx
  ON public.deal_comp_reliance (deal_id);
CREATE INDEX IF NOT EXISTS deal_comp_reliance_org_idx
  ON public.deal_comp_reliance (organization_id);

ALTER TABLE public.deal_comp_reliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_comp_reliance FORCE ROW LEVEL SECURITY;

-- Tenant scoping — identical posture to dd_items / risk_flags: every read and
-- write is confined to the caller's organisation.
DROP POLICY IF EXISTS deal_comp_reliance_org_scope ON public.deal_comp_reliance;
CREATE POLICY deal_comp_reliance_org_scope
  ON public.deal_comp_reliance
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE public.deal_comp_reliance IS
  'Workstream C1: which verified comps an analyst relied on for a deal. '
  'Durable operational state (presence = relied-on); each toggle also appends '
  'a comp_reliance learning signal to improvement_signals.';

-- ── 2. Widen the improvement_signals signal_type CHECK ──────────────────────
-- The inline CHECK from 20260608 only permitted `extraction_field_review`.
-- Drop-then-re-add so the migration stays re-runnable.

ALTER TABLE public.improvement_signals
  DROP CONSTRAINT IF EXISTS improvement_signals_signal_type_check;

ALTER TABLE public.improvement_signals
  ADD CONSTRAINT improvement_signals_signal_type_check
  CHECK (signal_type IN ('extraction_field_review', 'comp_reliance'));

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname = 'deal_comp_reliance'
--      AND relnamespace = 'public'::regnamespace;
--   -- expect: t, t
--
--   SELECT count(*) FROM public.deal_comp_reliance;
--   -- expect: 0 (no rows until an analyst marks a comp as relied-on)
