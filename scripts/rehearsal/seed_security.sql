-- scripts/rehearsal/seed_security.sql
-- M1 Phase-4 rehearsal seed — deterministic security fixtures for the
-- role-flip rehearsal on a throwaway Supabase branch.
--
-- RUN AS THE BYPASS ROLE (postgres) ON THE BRANCH, NEVER ON PRODUCTION:
--   DATABASE_URL=<branch-direct-url> node backend/scripts/run-sql.js scripts/rehearsal/seed_security.sql
--
-- Design rules:
--   • Fixed UUIDs + ON CONFLICT DO NOTHING → idempotent (safe to re-run).
--     Exception: consumed one-shot fixtures (accepted invitations, consumed
--     verification tokens) do NOT reset on re-run — a full probe pass consumes
--     some fixtures; reset the branch for a pristine re-run.
--   • organization_id is EXPLICIT on every tenant row — several tables carry
--     `DEFAULT current_organization_id()`, which resolves NULL in a plain SQL
--     session and would violate NOT NULL.
--   • Passwords: crypt(…, gen_salt('bf', 12)) emits $2a$ — verified by the
--     backend's bcryptjs. All seeded logins use: Rehearse123!
--   • Refresh/verification tokens are stored as sha256 hex of a known raw
--     string (matching refreshToken/emailVerification service hashing), so
--     the probe runner can present the raw values over HTTP.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Organizations ───────────────────────────────────────────────────────────
INSERT INTO organizations (id, name, slug, created_by)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Rehearsal Alpha', 'rehearsal-alpha', NULL),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Rehearsal Beta',  'rehearsal-beta',  NULL)
ON CONFLICT DO NOTHING;

-- ── Users (password for every seeded login: Rehearse123!) ───────────────────
INSERT INTO users (id, email, password_hash, name, role, is_active,
                   default_organization_id, email_verified_at, password_set)
VALUES
  ('11111111-0000-4000-8000-000000000001', 'alpha-owner@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'Alpha Owner', 'admin', TRUE,
   'aaaaaaaa-0000-4000-8000-000000000001', NOW(), TRUE),
  ('11111111-0000-4000-8000-000000000002', 'alpha-viewer@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'Alpha Viewer', 'viewer', TRUE,
   'aaaaaaaa-0000-4000-8000-000000000001', NOW(), TRUE),
  ('22222222-0000-4000-8000-000000000001', 'beta-owner@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'Beta Owner', 'admin', TRUE,
   'bbbbbbbb-0000-4000-8000-000000000001', NOW(), TRUE),
  ('33333333-0000-4000-8000-000000000001', 'multi@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'Multi Org Analyst', 'analyst', TRUE,
   'aaaaaaaa-0000-4000-8000-000000000001', NOW(), TRUE),
  ('44444444-0000-4000-8000-000000000001', 'inactive@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'Inactive User', 'analyst', FALSE,
   'aaaaaaaa-0000-4000-8000-000000000001', NOW(), TRUE)
ON CONFLICT DO NOTHING;

-- MFA-enrolled user — fixed base32 secret so the probe runner can compute
-- live TOTP codes via otplib. Recovery code (sha256-hashed, single-use):
-- raw value 'rehearsal-recovery-1'.
INSERT INTO users (id, email, password_hash, name, role, is_active,
                   default_organization_id, email_verified_at, password_set,
                   mfa_secret, mfa_enrolled_at, mfa_recovery_codes)
VALUES
  ('55555555-0000-4000-8000-000000000001', 'mfa@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'MFA Analyst', 'analyst', TRUE,
   'aaaaaaaa-0000-4000-8000-000000000001', NOW(), TRUE,
   'JBSWY3DPEHPK3PXP', NOW(),
   ARRAY[encode(digest('rehearsal-recovery-1', 'sha256'), 'hex')])
ON CONFLICT DO NOTHING;

-- OAuth-only user — password_set FALSE and a password nobody knows, so a
-- password login attempt with the standard rehearsal password must be refused.
INSERT INTO users (id, email, password_hash, name, role, is_active,
                   default_organization_id, email_verified_at, password_set,
                   oauth_provider, oauth_subject)
VALUES
  ('66666666-0000-4000-8000-000000000001', 'oauth@rehearsal.test',
   crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf', 12)),
   'OAuth Only User', 'analyst', TRUE,
   'aaaaaaaa-0000-4000-8000-000000000001', NOW(), FALSE,
   'google', 'rehearsal-google-sub-1')
ON CONFLICT DO NOTHING;

-- Closed account — login must be refused.
INSERT INTO users (id, email, password_hash, name, role, is_active,
                   default_organization_id, email_verified_at, password_set,
                   account_closed_at)
VALUES
  ('77777777-0000-4000-8000-000000000001', 'closed@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'Closed Account', 'analyst', TRUE,
   'aaaaaaaa-0000-4000-8000-000000000001', NOW(), TRUE, NOW())
ON CONFLICT DO NOTHING;

-- Unverified user — drives the PUBLIC verify-email confirm flow.
INSERT INTO users (id, email, password_hash, name, role, is_active,
                   default_organization_id, email_verified_at, password_set)
VALUES
  ('88888888-0000-4000-8000-000000000001', 'unverified@rehearsal.test',
   crypt('Rehearse123!', gen_salt('bf', 12)), 'Unverified User', 'analyst', TRUE,
   'aaaaaaaa-0000-4000-8000-000000000001', NULL, TRUE)
ON CONFLICT DO NOTHING;

-- ── Memberships ─────────────────────────────────────────────────────────────
INSERT INTO organization_members (organization_id, user_id, role, is_active)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'owner',  TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002', 'viewer', TRUE),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'owner',  TRUE),
  -- multi@ belongs to BOTH orgs (the x-organization-id switching probe)
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001', 'editor', TRUE),
  ('bbbbbbbb-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001', 'editor', TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001', 'editor', TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-0000-4000-8000-000000000001', 'editor', TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000001', 'editor', TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001', 'editor', TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', 'editor', TRUE)
ON CONFLICT DO NOTHING;

-- ── Verified domains (organization_id EXPLICIT — column default is
--    current_organization_id(), which is NULL here) ─────────────────────────
INSERT INTO organization_domains
  (organization_id, domain, verified, default_role, require_admin_approval, verification_method)
VALUES
  -- register with anyone@rehearsal-alpha.example → auto-joins alpha as editor
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rehearsal-alpha.example', TRUE, 'editor', FALSE, 'operator'),
  -- register with anyone@rehearsal-beta.example → PENDING member (admin approval)
  ('bbbbbbbb-0000-4000-8000-000000000001', 'rehearsal-beta.example',  TRUE, 'editor', TRUE,  'operator')
ON CONFLICT DO NOTHING;

-- ── Invitations (one per state; UNIQUE(org,email) → distinct emails) ───────
INSERT INTO organization_invitations
  (organization_id, email, role, token, expires_at, accepted_at, accepted_by)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'invitee-alpha@rehearsal.test',    'editor',
   'rehearsal-invite-pending-0001', NOW() + INTERVAL '7 days', NULL, NULL),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'invitee-expired@rehearsal.test',  'editor',
   'rehearsal-invite-expired-0001', NOW() - INTERVAL '1 day',  NULL, NULL),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'invitee-accepted@rehearsal.test', 'editor',
   'rehearsal-invite-accepted-0001', NOW() + INTERVAL '7 days', NOW(),
   '11111111-0000-4000-8000-000000000001'),
  -- consumed by the probe runner: proves invite-accept lands in BETA only
  ('bbbbbbbb-0000-4000-8000-000000000001', 'invitee-beta@rehearsal.test',     'editor',
   'rehearsal-invite-beta-0001',    NOW() + INTERVAL '7 days', NULL, NULL)
ON CONFLICT DO NOTHING;

-- ── Refresh-token grants, one per lifecycle state (alpha-owner) ────────────
-- token_hash = sha256(raw); raw values are 'rehearsal-refresh-<state>'.
INSERT INTO refresh_token_grants (user_id, family_id, token_hash, expires_at, revoked_at, revoked_reason)
VALUES
  ('11111111-0000-4000-8000-000000000001', 'facefeed-0000-4000-8000-000000000001',
   encode(digest('rehearsal-refresh-live', 'sha256'), 'hex'),    NOW() + INTERVAL '30 days', NULL, NULL),
  ('11111111-0000-4000-8000-000000000001', 'facefeed-0000-4000-8000-000000000002',
   encode(digest('rehearsal-refresh-rotated', 'sha256'), 'hex'), NOW() + INTERVAL '30 days', NOW(), 'rotated'),
  ('11111111-0000-4000-8000-000000000001', 'facefeed-0000-4000-8000-000000000003',
   encode(digest('rehearsal-refresh-logout', 'sha256'), 'hex'),  NOW() + INTERVAL '30 days', NOW(), 'logout'),
  ('11111111-0000-4000-8000-000000000001', 'facefeed-0000-4000-8000-000000000004',
   encode(digest('rehearsal-refresh-security', 'sha256'), 'hex'),NOW() + INTERVAL '30 days', NOW(), 'security'),
  ('11111111-0000-4000-8000-000000000001', 'facefeed-0000-4000-8000-000000000005',
   encode(digest('rehearsal-refresh-expired', 'sha256'), 'hex'), NOW() - INTERVAL '1 day',  NULL, NULL)
ON CONFLICT DO NOTHING;

-- ── Email-verification tokens for unverified@ (raw values in comments) ─────
INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, consumed_at)
VALUES
  -- raw: rehearsal-verify-live-00000001  (one-shot: consumed by a full probe run)
  ('88888888-0000-4000-8000-000000000001',
   encode(digest('rehearsal-verify-live-00000001', 'sha256'), 'hex'), NOW() + INTERVAL '2 days', NULL),
  -- raw: rehearsal-verify-expired-0001
  ('88888888-0000-4000-8000-000000000001',
   encode(digest('rehearsal-verify-expired-0001', 'sha256'), 'hex'),  NOW() - INTERVAL '1 day', NULL),
  -- raw: rehearsal-verify-consumed-001
  ('88888888-0000-4000-8000-000000000001',
   encode(digest('rehearsal-verify-consumed-001', 'sha256'), 'hex'),  NOW() + INTERVAL '2 days', NOW())
ON CONFLICT DO NOTHING;

-- ── Deals + children (2 per org; organization_id EXPLICIT everywhere) ──────
INSERT INTO deals (id, organization_id, name, deal_type, stage, is_archived, created_by)
VALUES
  ('a0a0a0a0-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Rehearsal Alpha — Whitefield Land', 'acquisition', 'screening', FALSE,
   '11111111-0000-4000-8000-000000000001'),
  ('a0a0a0a0-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Rehearsal Alpha — Bellandur JV', 'jv', 'due_diligence', FALSE,
   '11111111-0000-4000-8000-000000000001'),
  ('b0b0b0b0-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'Rehearsal Beta — Hebbal Outright', 'outright', 'screening', FALSE,
   '22222222-0000-4000-8000-000000000001'),
  ('b0b0b0b0-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001',
   'Rehearsal Beta — Sarjapur DA', 'da', 'underwriting', FALSE,
   '22222222-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO financials (organization_id, deal_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0a0a0a0-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0a0a0a0-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO dd_items (organization_id, deal_id, category, item_name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0a0a0a0-0000-4000-8000-000000000001', 'legal',     'Title chain review — Alpha 1'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0a0a0a0-0000-4000-8000-000000000001', 'financial', 'Financial model sanity — Alpha 1'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000001', 'legal',     'Title chain review — Beta 1'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000001', 'financial', 'Financial model sanity — Beta 1')
ON CONFLICT DO NOTHING;

INSERT INTO approval_items (organization_id, deal_id, approval_type, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0a0a0a0-0000-4000-8000-000000000001', 'bbmp', 'Plan sanction — Alpha 1'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000001', 'bbmp', 'Plan sanction — Beta 1')
ON CONFLICT DO NOTHING;

INSERT INTO risk_flags (organization_id, deal_id, category, title)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0a0a0a0-0000-4000-8000-000000000001', 'Legal/Title',           'Rehearsal risk — Alpha encumbrance check'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000001', 'Regulatory/Approvals',  'Rehearsal risk — Beta approval gap')
ON CONFLICT DO NOTHING;

-- Seed summary (for the probe runner's expectations):
--   alpha deals: 2 seeded (probe may add more)   beta deals: 2 seeded
--   Any appearance of the beta org id, a beta deal id, or the string
--   'Rehearsal Beta' inside an alpha-scoped API response is a LEAK.
