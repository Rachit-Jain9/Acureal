-- 20260808_operator_identity_rename.sql
--
-- Move the operator's login identity to the company address.
--
-- WHY THIS IS A MIGRATION AND NOT A CLICK. There is no email-change feature in
-- this product: PUT /auth/me allow-lists exactly ['name','phone']
-- (backend/src/services/auth.service.js:484) and the Settings email input is
-- readOnly (frontend/src/pages/SettingsPage.jsx:250-255). The only statement in
-- the entire repo that writes users.email is the DPDP erasure
-- (backend/src/services/accountClosure.service.js:109), and no trigger records
-- an email write — the only trigger on public.users is update_users_updated_at.
-- So nothing would have logged this change. THIS FILE IS THE AUDIT RECORD.
-- That is also why it must not be pasted ad hoc.
--
-- WHAT MOVES. Nothing but the name on the door. The row already owns
-- everything; it is renamed in place rather than migrating data to a new user.
-- Identity is UUID-keyed everywhere durable (deals.created_by, deal_shares,
-- organization_members, deal_audit_log.actor_id, deal_events.actor_id,
-- refresh_token_grants), the RLS context is two UUIDs
-- (backend/src/config/database.js:96-101), and no RLS policy in the repo
-- references the email column. So deals, ownership, shares, audit history,
-- live sessions, the password hash and is_platform_admin all survive untouched.
--
-- WHY THE TWO OAUTH COLUMNS GO NULL. The row carries
-- oauth_provider='google' bound to the OLD gmail Google identity. With only the
-- email changed, "Sign in with Google" as the new @acureal.in Workspace account
-- would match the provider but not the subject and hard-fail 409 "This email is
-- bound to a different Google identity" (auth.service.js:672-679). Clearing the
-- pair turns that same click into a clean first-time bind
-- (auth.service.js:695-703), which also re-earns email verification honestly.
--
-- MUST RUN AS A SUPERUSER — Supabase SQL editor, NOT the applier and NOT the
-- app connection. Role redip_app has rolbypassrls=false and the only UPDATE
-- policy on users is users_self_update USING (id = current_user_id())
-- (20260430_users_rls_and_summary_invoker.sql:70-73). Through the app role this
-- statement returns "UPDATE 0" with NO error — a perfect silent failure. The
-- RETURNING clause exists so that failure cannot pass as success: the operator
-- must see exactly one row come back.
--
-- IDEMPOTENT. The WHERE clause pins BOTH the id and the pre-change email, so a
-- second run matches nothing and changes nothing. A mistargeted run returns
-- zero rows rather than touching the wrong account.
--
-- ROLLBACK (captured before the write — oauth_subject is the ONE irreversible
-- value in this change; once the Workspace account binds, the app overwrites it
-- and it exists nowhere else):
--
--   BEGIN;
--   UPDATE public.users
--      SET email          = 'rachitj579@gmail.com',
--          oauth_provider = 'google',
--          oauth_subject  = '109531410542335788558'
--    WHERE id = '04501067-6a54-47b7-98d9-0fec19ee0c8a'
--   RETURNING id, email, oauth_provider, oauth_subject;
--   COMMIT;
--
-- The rollback presumes nobody has since registered rachitj579@gmail.com —
-- users.email is UNIQUE (database/schema.sql:39) and signup is open.
--
-- CLOSES A LIVE EXPOSURE. PLATFORM_ADMIN_EMAILS was set to
-- rachit.jain@acureal.in on 2026-08-05 while no users row held that address.
-- is_platform_admin is computed from that allowlist at signup
-- (backend/src/services/organization.service.js:111-113) and registration is
-- open with no invite, domain gate or verification gate — so until this
-- migration lands, whoever registers that exact address becomes a platform
-- operator. This statement claims the address.

BEGIN;

UPDATE public.users
   SET email          = 'rachit.jain@acureal.in',
       oauth_provider = NULL,
       oauth_subject  = NULL
 WHERE id = '04501067-6a54-47b7-98d9-0fec19ee0c8a'
   AND email = 'rachitj579@gmail.com'
RETURNING id, email, oauth_provider, oauth_subject;

COMMIT;
