-- 20260730_user_signup_profile_fields.sql
--
-- Open-beta signup capture. REDIP registration is already open to everyone
-- (the invite gate was removed in PR #507). This migration lets the sign-up
-- form collect a little more about who is joining, so the operator can see
-- WHO the platform is attracting during the beta.
--
-- Three new OPTIONAL profile columns on users:
--   company    — firm / employer the person is with
--   job_title  — their role (NOT `role`, which is the auth user_role enum)
--   city       — where they are based (Bengaluru / India / overseas signal)
--
-- All nullable — nobody is ever blocked from signing up for leaving them
-- blank. Purely descriptive account profile data (DPDP data-minimisation:
-- no sensitive category collected here). Additive + idempotent, so the file
-- is safe to re-paste into the Supabase SQL editor.
--
-- Also adds a created_at index so the operator's "Signups" list can order
-- newest-first cheaply as the user table grows.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS company   VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS city      VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

COMMIT;
