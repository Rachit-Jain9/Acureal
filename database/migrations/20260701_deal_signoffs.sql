-- ============================================================================
-- 20260701 — Deal professional sign-off board
-- ============================================================================
-- Indian real-estate deals turn on a handful of professional sign-offs the
-- promoter must collect — the advocate's title opinion, the CA's Form-1 cost +
-- 70%-escrow certificate, the architect's Form-2, the engineer's Form-3, the
-- structural-safety certificate, and the banker's RERA-account confirmation.
-- The deal model had no home for tracking who owes what and where each stands.
-- This table is that home.
--
-- Many rows per deal: one per (professional_role × scope) sign-off, with a
-- lifecycle status (not_started → requested → signed | rejected | expired), an
-- optional linked document, and provenance.
--
-- Follows the deal-scoped business-table pattern (dd_items / risk_flags /
-- deal_promoter_profiles): organization_id defaults to current_organization_id();
-- RLS is FORCEd with a FOR ALL policy so every read and write is tenant-scoped.
-- A SIGNED sign-off of the relevant role also marks the matching professional-
-- certificate item in the K-RERA cockpit as verified (additive, read-side).
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS. Re-runnable.
-- Migration-tolerant: the app degrades gracefully when this table is absent
-- (the sign-off list reads as empty; the workspace + K-RERA cockpit are
-- unaffected), so deploy order is flexible.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.deals, public.organizations, public.users, public.documents
--
-- Operator action required: apply via the Supabase SQL editor.
--   🌐 https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
--   📋 paste this whole file → Run → expect "Success. No rows returned."
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_signoffs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL DEFAULT current_organization_id()
                      REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Who signs.
  professional_role VARCHAR(50) NOT NULL CHECK (professional_role IN (
                      'advocate', 'ca', 'architect', 'engineer',
                      'structural_engineer', 'banker', 'other'
                    )),
  professional_name TEXT,                 -- the firm / person, optional

  -- What they sign.
  scope             TEXT NOT NULL,        -- e.g. "Title, encumbrance & litigation opinion"
  form_ref          VARCHAR(40),          -- e.g. Form-1 / Form-2 / Form-3, optional

  -- Lifecycle.
  status            VARCHAR(40) NOT NULL DEFAULT 'not_started' CHECK (status IN (
                      'not_started', 'requested', 'signed', 'rejected', 'expired'
                    )),
  requested_at      DATE,
  signed_at         DATE,
  expires_at        DATE,

  -- Linked evidence + provenance.
  document_id       UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  signed_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_signoffs_deal_idx ON public.deal_signoffs (deal_id);
CREATE INDEX IF NOT EXISTS deal_signoffs_org_idx  ON public.deal_signoffs (organization_id);

ALTER TABLE public.deal_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_signoffs FORCE ROW LEVEL SECURITY;

-- Tenant scoping — identical posture to dd_items / risk_flags / approval_items:
-- every read and write is confined to the caller's organisation.
DROP POLICY IF EXISTS deal_signoffs_org_scope ON public.deal_signoffs;
CREATE POLICY deal_signoffs_org_scope
  ON public.deal_signoffs
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE public.deal_signoffs IS
  'Many rows per deal: the professional sign-off board (advocate / CA / architect '
  '/ engineer / structural engineer / banker × a certificate-scope) with a '
  'lifecycle status. A signed sign-off marks the matching K-RERA professional-'
  'certificate item verified.';

COMMIT;

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname = 'deal_signoffs' AND relnamespace = 'public'::regnamespace;
--   -- expect: t, t
--   SELECT count(*) FROM public.deal_signoffs;   -- expect: 0
