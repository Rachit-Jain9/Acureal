-- scripts/rehearsal/drop_definers.sql
-- Kill-switch drill, step 1 — BRANCH ONLY, NEVER PRODUCTION.
--
-- The branch is a copy of prod, so migration 20260801/20260802's definer
-- functions are PRESENT there. The drill needs the "functions absent" state
-- to prove the RLS_ENFORCED=true loud-503 contract, so we manufacture it by
-- dropping the six functions, then restore by re-applying
-- database/migrations/20260802_rls_flip_hardening.sql.
--
-- NOTE: the backend memoizes its definer probe per process — restart the
-- local backend after running this (and again after restoring).
BEGIN;
DROP FUNCTION IF EXISTS public.auth_find_user_for_login(text);
DROP FUNCTION IF EXISTS public.auth_find_user_by_oauth(text, text);
DROP FUNCTION IF EXISTS public.auth_find_mfa_challenge(text);
DROP FUNCTION IF EXISTS public.auth_lookup_verified_domain(text[]);
DROP FUNCTION IF EXISTS public.auth_find_invitation(text);
DROP FUNCTION IF EXISTS public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text);
COMMIT;
