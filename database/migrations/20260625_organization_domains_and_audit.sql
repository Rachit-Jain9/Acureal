-- ============================================================================
-- 20260625 — Domain-based onboarding + organization audit trail
-- ============================================================================
-- REDIP onboarding today is invite-only or solo: a signup without an invitation
-- token always gets a brand-new personal workspace (Owner), so a firm whose deal
-- team shares one corporate domain fragments across separate workspaces. This
-- migration adds the two tables that close that gap WITHOUT weakening isolation:
--
--   organization_domains   — the corporate email domains an organization claims,
--                            plus the per-domain join policy. UNIQUE(lower(domain))
--                            makes a domain belong to exactly one workspace, which
--                            is the whole point: two orgs can never both claim
--                            acme-realty.in and silently cross-pollinate. A claim
--                            starts `verified = FALSE` (inert) and only becomes an
--                            auto-join magnet after the org proves control via a
--                            DNS TXT record (verification_token). Auto-join
--                            consults ONLY verified rows, so an unproven claim
--                            grants nothing — closing the "claim a domain you do
--                            not own and absorb its real employees" hole.
--
--   organization_audit_log — an append-only, org-scoped trail for membership and
--                            domain mutations (role changes, join approvals,
--                            domain add/verify/remove). deal_audit_log cannot
--                            hold these (it requires a deal_id); deal_events is
--                            HMAC-signed financial computations. CLAUDE.md treats
--                            membership/approval changes as material, so they
--                            belong on an immutable trail. Written fail-open by
--                            the backend service (a logging hiccup never rolls
--                            back the underlying mutation).
--
-- Trust boundary lives in the service, not the policy — the verification flip
-- (FALSE -> TRUE) is performed only by the backend onboarding service on the
-- postgres (BYPASSRLS) role, exactly like organization_invitations. RLS below is
-- org-isolation for the Supabase Data API path (defense-in-depth).
--
-- Idempotent + paste-safe in the Supabase SQL editor: plain DDL, no CONCURRENTLY,
-- IF NOT EXISTS / DROP POLICY IF EXISTS guards throughout. Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.organizations, public.users, the organization_role enum
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── organization_domains ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_domains (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id        UUID NOT NULL DEFAULT current_organization_id()
                           REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The claimed corporate domain, stored lower-cased (the service normalizes;
  -- the unique index enforces case-insensitive one-owner-per-domain regardless).
  domain                 TEXT NOT NULL,

  -- Inert until proven. Only verified = TRUE rows are ever matched for auto-join.
  verified               BOOLEAN NOT NULL DEFAULT FALSE,

  -- The organization_role granted on auto-join. Never owner/admin — privilege is
  -- not auto-granted from an email match. Defaults to editor (a working seat).
  default_role           organization_role NOT NULL DEFAULT 'editor',

  -- TRUE: an auto-join lands as a pending member (organization_members.is_active
  -- = FALSE) an admin must approve. FALSE: the member is active on join.
  require_admin_approval BOOLEAN NOT NULL DEFAULT FALSE,

  -- How control is proven. 'dns_txt' = a TXT record carrying verification_token;
  -- 'operator' = a REDIP operator vouches manually. Email-link reserved.
  verification_method    TEXT NOT NULL DEFAULT 'dns_txt'
                           CHECK (verification_method IN ('dns_txt', 'operator', 'email_link')),

  -- Single-use proof secret the org publishes as a DNS TXT value. Generated here
  -- so it exists the moment a claim is created; rotated/cleared by the service.
  verification_token     TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  verified_at            TIMESTAMPTZ,

  claimed_by             UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One workspace per corporate domain (case-insensitive) — the load-bearing
-- isolation guarantee and the race-guard for concurrent first-claims.
CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_domain_uidx
  ON public.organization_domains (lower(domain));
CREATE INDEX IF NOT EXISTS organization_domains_org_idx
  ON public.organization_domains (organization_id);
-- Hot path: "is this a verified, claimable domain?" at signup time.
CREATE INDEX IF NOT EXISTS organization_domains_autojoin_idx
  ON public.organization_domains (lower(domain)) WHERE verified = TRUE;

ALTER TABLE public.organization_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_domains FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_domains_org_scope ON public.organization_domains;
CREATE POLICY organization_domains_org_scope ON public.organization_domains
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE public.organization_domains IS
  'Corporate email domains an organization claims for domain-based onboarding, '
  'plus the per-domain join policy (default_role, require_admin_approval). '
  'UNIQUE(lower(domain)) makes a domain belong to exactly one workspace. A claim '
  'is inert until verified = TRUE (DNS TXT proof of control), and only verified '
  'rows are matched for auto-join. The verify flip runs only on the backend '
  'service (postgres/BYPASSRLS role), never the SPA.';

-- ── organization_audit_log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  target_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type      VARCHAR(40) NOT NULL,
  before_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS organization_audit_log_org_idx
  ON public.organization_audit_log (organization_id, created_at DESC);

ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;
-- Append-only: SELECT + INSERT only, no UPDATE/DELETE policy (immutable trail).
DROP POLICY IF EXISTS organization_audit_log_org_read  ON public.organization_audit_log;
DROP POLICY IF EXISTS organization_audit_log_org_write ON public.organization_audit_log;
CREATE POLICY organization_audit_log_org_read ON public.organization_audit_log
  FOR SELECT USING (organization_id = current_organization_id());
CREATE POLICY organization_audit_log_org_write ON public.organization_audit_log
  FOR INSERT WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE public.organization_audit_log IS
  'Append-only org-scoped audit trail for membership + domain mutations (role '
  'changes, join approvals, domain add/verify/remove). Written fail-open by the '
  'backend; a logging failure never rolls back the underlying change. No '
  'UPDATE/DELETE policy — immutable.';

COMMIT;

-- ── Verification (run as separate queries after applying) ───────────────────
--   -- 1. RLS on for both tables (expect t for each):
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('organization_domains','organization_audit_log')
--      AND relnamespace = 'public'::regnamespace;
--
--   -- 2. No domain claims yet (expect 0):
--   SELECT count(*) FROM public.organization_domains;
--
--   -- 3. One-owner-per-domain enforced (expect a unique index row):
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'organization_domains' AND indexname = 'organization_domains_domain_uidx';
--
--   -- 4. Policies in place (expect org_scope, org_read, org_write):
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('organization_domains','organization_audit_log')
--    ORDER BY tablename, policyname;
-- ============================================================================
