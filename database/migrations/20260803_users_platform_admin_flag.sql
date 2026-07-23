-- database/migrations/20260803_users_platform_admin_flag.sql
-- Workstream 03 — persist the platform-operator boundary.
--
-- Until now "who is a REDIP operator" lived in an env allowlist
-- (PLATFORM_ADMIN_EMAILS) mirrored into the BROWSER BUNDLE via
-- VITE_PLATFORM_ADMIN_EMAILS — an information leak (the operator's email
-- ships in public JS) and un-grantable/un-revocable without a redeploy.
--
-- This adds the persisted per-user flag plus grant provenance (who granted
-- it, when — the minimal slice of the role-assignments model that a solo
-- operator actually needs; see the 2026-07-23 critique verdict). The server
-- computes `is_platform_admin` as: persisted flag OR env allowlist — the env
-- list stays as the break-glass fallback so the founder can never be locked
-- out, and so the code works BEFORE this migration is applied.
--
-- Backfill targets the founding operator email literally (SQL cannot read
-- env). users_self_read RLS already covers the new columns (full-row
-- self-read). Idempotent; safe to re-run.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_admin_granted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_admin_granted_by UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE users
   SET is_platform_admin = TRUE,
       platform_admin_granted_at = COALESCE(platform_admin_granted_at, NOW())
 WHERE LOWER(email) = 'rachitj579@gmail.com'
   AND is_platform_admin IS DISTINCT FROM TRUE;

COMMIT;

-- Verification:
--   SELECT email, is_platform_admin, platform_admin_granted_at
--     FROM users WHERE is_platform_admin;  -- exactly the operator(s)
-- Rollback:
--   ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin,
--     DROP COLUMN IF EXISTS platform_admin_granted_at,
--     DROP COLUMN IF EXISTS platform_admin_granted_by;
