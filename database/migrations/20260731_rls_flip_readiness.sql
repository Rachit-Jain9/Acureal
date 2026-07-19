-- 20260731_rls_flip_readiness.sql
--
-- M1 · Phase 1 — make the schema READY for the application to connect via a
-- non-BYPASSRLS database role (so PostgreSQL itself, not just application-code
-- WHERE clauses, enforces tenant isolation). See docs/M1_RLS_ROLLOUT.md.
--
-- SAFETY: this migration is 100% ADDITIVE and BEHAVIOR-NEUTRAL under today's
-- connection role. The application currently connects as `postgres`, which has
-- the BYPASSRLS attribute, so RLS (and therefore these new policies) is skipped
-- entirely at runtime — applying this changes nothing observable today. The
-- policies only take effect once DATABASE_URL is pointed at a non-bypass role
-- (Phase 3+). Every statement is idempotent and safe to re-paste. Reversible by
-- dropping the six policies named below.
--
-- Empirically validated against production on 2026-07-19 in a rolled-back
-- transaction (BEGIN … SET LOCAL ROLE authenticated … ROLLBACK):
--   • BEFORE: a non-bypass role with no context saw 0 rows on all five system
--     tables and 0 memberships → login + token refresh + every authenticated
--     request would break on a blind role flip.
--   • AFTER these policies: the same role read refresh_token_grants (788),
--     email_verification_tokens (3), ai_response_cache (150), and — with the
--     user id in context — its OWN 1 membership and 1 user row, with NO
--     cross-org leakage (a full `SELECT count(*) FROM users` returned 1: self).
--
-- What this migration does NOT do (tracked as Phase 2 in the runbook):
--   The auth *bootstrap* reads/writes that run BEFORE any user context exists —
--   login's `users WHERE email=$1`, register's duplicate-check + users INSERT
--   (there is no INSERT policy on users), the Google `oauth_provider/subject`
--   and `email` lookups, and post-MFA re-reads. Those need SECURITY DEFINER
--   helper functions and are deliberately OUT of this safe additive step.

-- ---------------------------------------------------------------------------
-- 1) Five system tables that are RLS-ENABLED but POLICY-LESS (deny-by-default).
--    None are org-scoped; their real access boundary is a per-token / per-email
--    / per-hash WHERE clause in application code, and several are touched BEFORE
--    authentication (login throttle, token refresh, email verification, the
--    global AI response cache). A permissive FOR ALL policy lets a non-bypass
--    app role operate them; the narrow application query stays the boundary.
--    Under BYPASSRLS today these do nothing.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ai_response_cache_service_access ON public.ai_response_cache;
CREATE POLICY ai_response_cache_service_access
  ON public.ai_response_cache FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS email_verification_tokens_service_access ON public.email_verification_tokens;
CREATE POLICY email_verification_tokens_service_access
  ON public.email_verification_tokens FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS login_attempts_service_access ON public.login_attempts;
CREATE POLICY login_attempts_service_access
  ON public.login_attempts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS mfa_challenges_service_access ON public.mfa_challenges;
CREATE POLICY mfa_challenges_service_access
  ON public.mfa_challenges FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS refresh_token_grants_service_access ON public.refresh_token_grants;
CREATE POLICY refresh_token_grants_service_access
  ON public.refresh_token_grants FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2) organization_members SELF-READ. The existing policy
--    `organization_members_member_access` scopes reads to the CURRENT org
--    (organization_id = current_organization_id()). But the login/hydrate
--    bootstrap must first discover WHICH orgs a user belongs to — a cross-org
--    read keyed on user_id, before any current-org is chosen. This additive
--    SELECT policy (permissive → OR'd with the existing one) lets a user read
--    their OWN membership rows in any org. It is also the enabler for the
--    `organizations_member_access` policy, whose EXISTS subquery reads
--    organization_members and is itself RLS-filtered.
--    Scoped to the caller's own user id → no cross-user exposure.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organization_members_self_read ON public.organization_members;
CREATE POLICY organization_members_self_read
  ON public.organization_members FOR SELECT USING (user_id = current_user_id());
