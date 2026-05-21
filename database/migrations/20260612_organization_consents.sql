-- ============================================================================
-- 20260612 — Organization-level consent / data-governance ledger
--            (Workstream C2 — the Data Network's consent foundation)
-- ============================================================================
-- docs/DATA_GOVERNANCE.md §3 (Layer 4) defines the gate for the planned
-- anonymized cross-tenant benchmark layer: a deal contributes a Layer-4 row
-- only if BOTH conditions hold —
--
--   1. the contributing user holds a granted `anonymized_benchmarking` consent
--      in `user_consents` (already shipped — 20260607), AND
--   2. the owning organization has NOT set the org-level "do not benchmark"
--      switch.
--
-- This migration adds condition 2's store. An organization is a data
-- fiduciary that owns its deal data; whether that data — even de-identified —
-- contributes to a shared benchmark pool is an organization-level decision,
-- made by an owner/admin, that must sit above any individual user's consent.
--
-- It is an append-only ledger, the same shape and posture as `user_consents`:
-- one row per decision; the newest row per (organization_id, purpose) is the
-- current state; a reversal is a new row, never an UPDATE — so the full
-- history is auditable and the org's governance posture is traceable.
--
-- Polarity: the sole purpose today is `benchmark_opt_out`. `granted = true`
-- means the opt-out is ENGAGED (the org has said "do not benchmark");
-- `granted = false`, or no row at all, means the org has not opted out. This
-- keeps the "absence = false" default identical to `user_consents`, with the
-- opt-out polarity carried explicitly in the purpose name.
--
-- The eligibility math itself (k-anonymity statistics) is deliberately NOT
-- built here — per the plan, C2 ships the data model and the gate; the
-- benchmark queries (C4) wait for a real consumer and enough contributing
-- organizations.
--
-- Writes go exclusively through organizationConsent.service.js (postgres
-- role). RLS gives org members read access as defense in depth; there is
-- deliberately no INSERT/UPDATE/DELETE policy — the same "managed via the
-- backend service" posture as user_consents and security_events.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS.
-- Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.organizations, public.users from the baseline schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_consents (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The org-level data-governance decision. One value today; the CHECK widens
  -- as more org-level data-use decisions are added (the user_consents /
  -- improvement_signals pattern).
  purpose         TEXT NOT NULL CHECK (purpose IN (
                    'benchmark_opt_out'
                  )),
  -- For `benchmark_opt_out`: TRUE = the opt-out is engaged (do not benchmark).
  -- Absence of any row = FALSE = the org has not opted out.
  granted         BOOLEAN NOT NULL,

  -- Provenance — which owner/admin made this org-level decision. Unlike a
  -- personal consent, an org decision is made on the organization's behalf,
  -- so "who decided" is itself part of the audit record.
  changed_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Where the decision originated. 'settings' = the org settings UI;
  -- 'admin' = operator action on the org's behalf; 'import' = backfill.
  source          TEXT NOT NULL DEFAULT 'settings' CHECK (source IN (
                    'settings',
                    'admin',
                    'import'
                  )),

  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current-state lookup: newest row per (organization, purpose). The
-- DISTINCT ON (purpose) ... ORDER BY purpose, created_at DESC query in
-- organizationConsent.service.js rides this index.
CREATE INDEX IF NOT EXISTS organization_consents_org_purpose_created_idx
  ON public.organization_consents (organization_id, purpose, created_at DESC);

ALTER TABLE public.organization_consents ENABLE ROW LEVEL SECURITY;

-- Org-scoped read: any member of the organisation may see its governance
-- posture (transparency). Backend (postgres role) bypasses RLS for audit
-- needs. Writes have no policy — they go through organizationConsent.service.js
-- (postgres role) only; the owner/admin restriction is enforced at the route.
DROP POLICY IF EXISTS organization_consents_org_read ON public.organization_consents;
CREATE POLICY organization_consents_org_read
  ON public.organization_consents
  FOR SELECT
  USING (organization_id = current_organization_id());

-- INSERT/UPDATE/DELETE intentionally have no policy. The ledger is
-- append-only: a reversal is a new row, never an UPDATE. Append-only is
-- enforced by the backend service contract.

COMMENT ON TABLE public.organization_consents IS
  'Append-only org-level data-governance ledger (Workstream C2). Newest row '
  'per (organization_id, purpose) is the current state; a reversal is a new '
  'row. Today the sole purpose is benchmark_opt_out — granted = true means the '
  'organization has opted out of contributing to anonymized market benchmarks. '
  'Written only by organizationConsent.service.js via the backend.';
COMMENT ON COLUMN public.organization_consents.granted IS
  'For benchmark_opt_out: TRUE = opt-out engaged (do not benchmark). Absence '
  'of a row = FALSE = not opted out.';

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname = 'organization_consents' AND relnamespace = 'public'::regnamespace;
--   -- expect: t
--
--   SELECT count(*) FROM public.organization_consents;
--   -- expect: 0 (no rows until an organization records a governance decision)
