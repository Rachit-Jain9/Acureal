-- ============================================================================
-- 20260603 — Only a VERIFIED domain claim is exclusive (anti-squatting)
-- ============================================================================
-- THE BUG: organization_domains carried a GLOBAL unique index on lower(domain)
-- (organization_domains_domain_uidx, migration 20260625). Because a claim is
-- created UNVERIFIED, any workspace could claim a competitor's corporate domain
-- and — without ever proving control — permanently lock the real owner out
-- (their INSERT hit 23505 → 409 "already claimed"), with no in-product recourse.
--
-- THE FIX: exclusivity should rest on PROOF, not on who-typed-it-first. Only a
-- VERIFIED claim (DNS-TXT proof, which only the true domain owner can pass) is
-- unique. Unverified duplicates are harmless — at most one org can ever verify —
-- so they no longer block anyone. A workspace still can't claim the same domain
-- twice.
--
-- Deploy-before-migrate safe: the service ships a pre-check ("is this domain
-- already verified by another org?") and a 23505 race-guard on verify, both of
-- which behave correctly under the old global unique too. Applying this migration
-- relaxes INSERT (unverified dups stop 409-ing) and moves the hard guarantee onto
-- the verified-partial unique that verifyDomain already relies on.
--
-- Idempotent. No rows touched. Paste-safe in the Supabase SQL editor.
-- ============================================================================

BEGIN;

-- 1) Drop the global uniqueness that enabled squatting.
DROP INDEX IF EXISTS public.organization_domains_domain_uidx;

-- 2) Exactly one VERIFIED claim per domain. (Also serves the signup auto-join
--    lookup `WHERE verified = TRUE`, so the old non-unique autojoin index is
--    redundant and is replaced here.)
DROP INDEX IF EXISTS public.organization_domains_autojoin_idx;
CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_verified_domain_uidx
  ON public.organization_domains (lower(domain)) WHERE verified = TRUE;

-- 3) A workspace still cannot hold the same domain twice.
CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_org_domain_uidx
  ON public.organization_domains (organization_id, lower(domain));

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   -- The global unique is gone, the two replacements exist (expect 2 rows):
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='organization_domains'
--      AND indexname IN ('organization_domains_verified_domain_uidx',
--                        'organization_domains_org_domain_uidx')
--    ORDER BY indexname;
--   -- The old global unique is absent (expect 0 rows):
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND indexname='organization_domains_domain_uidx';
-- ============================================================================
