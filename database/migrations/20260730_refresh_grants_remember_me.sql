-- ─────────────────────────────────────────────────────────────────────────────
-- 20260730_refresh_grants_remember_me.sql
--
-- WHY: the login page's "Remember me across browser restarts" checkbox was an
-- illusion. It never reached the backend on ANY sign-in path (password,
-- Google, MFA, register) — its only effect was choosing localStorage vs
-- sessionStorage for the cached profile — while the refresh cookie was
-- unconditionally issued with a 30-day Max-Age. So the promise printed under
-- the checkbox ("REDIP signs you out when the browser closes") was false at
-- the cookie level, and the ticked box added nothing.
--
-- This column makes the choice REAL and durable across rotations: every grant
-- carries the persistence tier chosen at sign-in, and POST /auth/refresh
-- re-issues the cookie with that SAME tier (persistent Max-Age vs
-- browser-session cookie). Without storing it, the first silent refresh would
-- upgrade a session-only login to a 30-day persistent one.
--
-- Tier semantics (enforced in lib/cookies.js + refreshToken.service.js):
--   remember_me = TRUE  → 30-day grant, Max-Age cookie   (survives restarts)
--   remember_me = FALSE → 24-hour grant, session cookie  (dies with browser;
--                          the server-side TTL is the hard stop because
--                          browsers with "continue where you left off"
--                          resurrect session cookies)
--
-- DEFAULT TRUE: the historical behaviour. Every existing grant (747 at the
-- time of writing) becomes explicitly "remembered", which is exactly what it
-- already was — no live session changes behaviour.
--
-- Applied alongside (same PR, code change): a 60-second rotation GRACE WINDOW
-- in refreshToken.rotate(). The strict zero-grace reuse detector was burning
-- the operator's whole session family whenever two tabs raced the 15-minute
-- refresh — the production 401 "Session expired. Please sign in again." —
-- which also masqueraded as "remember me doesn't work".
--
-- Idempotent + paste-safe in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE public.refresh_token_grants
  ADD COLUMN IF NOT EXISTS remember_me BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.refresh_token_grants.remember_me IS
  'Persistence tier chosen at sign-in. TRUE → 30-day grant + Max-Age cookie; FALSE → 24-hour grant + browser-session cookie. Carried across rotations so /auth/refresh re-issues the cookie with the tier the user chose (migration 20260730).';

COMMIT;
