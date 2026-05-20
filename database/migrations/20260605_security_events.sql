-- ============================================================================
-- 20260605 — Security & incident event register (CERT-In / DPDP readiness)
-- ============================================================================
-- A single register for security-relevant events: account lockouts, AI
-- cost-cap breaches, suspected breaches, vendor incidents — anything the
-- breach-notification runbook would open an incident for. It gives the
-- operator incident workflow a home and the CERT-In 6-hour / DPDP Board
-- notification clocks a place to live.
--
-- Complements the existing trails, sitting one level above them:
--   - deal_events     — HMAC-signed financial computations
--   - deal_audit_log  — deal lifecycle mutations
--   - ai_call_logs    — AI provider calls
--   - login_attempts  — auth throttle state
--
-- Writes go exclusively through securityEvents.service.js on the backend
-- (postgres role). RLS provides read scoping as defense-in-depth; there is
-- deliberately no INSERT/UPDATE/DELETE policy — the same "managed via the
-- backend service" posture as user_legal_acceptances.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS.
-- Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.organizations, public.users from the baseline schema
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.security_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Nullable: platform-wide events (dependency CVE, provider outage) are
  -- not scoped to a single tenant.
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,

  event_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'low'
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'investigating', 'contained',
                                      'resolved', 'reported', 'false_positive')),

  summary         TEXT NOT NULL,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Regulatory clocks. detected_at starts the CERT-In 6-hour window;
  -- the *_reported_at / *_notified_at columns record when each obligation
  -- was met, so an auditor can see the timeline at a glance.
  detected_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cert_in_reported_at         TIMESTAMPTZ,
  dpdp_board_reported_at      TIMESTAMPTZ,
  data_principals_notified_at TIMESTAMPTZ,
  resolved_at                 TIMESTAMPTZ,

  actor_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Operator incident view: events for an org, newest first.
CREATE INDEX IF NOT EXISTS security_events_org_detected_idx
  ON public.security_events (organization_id, detected_at DESC);

-- "What is still open" — partial index keeps the unresolved working set small.
CREATE INDEX IF NOT EXISTS security_events_open_idx
  ON public.security_events (detected_at DESC)
  WHERE status NOT IN ('resolved', 'false_positive');

CREATE INDEX IF NOT EXISTS security_events_severity_idx
  ON public.security_events (severity);

CREATE INDEX IF NOT EXISTS security_events_type_idx
  ON public.security_events (event_type);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Read scoped to the caller's organization; platform-wide events
-- (organization_id IS NULL) are readable from any authenticated org
-- context. Writes have no policy — they go through the backend service
-- (postgres role, which bypasses RLS) only.
DROP POLICY IF EXISTS security_events_org_read ON public.security_events;
CREATE POLICY security_events_org_read
  ON public.security_events
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id = current_organization_id()
  );

COMMENT ON TABLE public.security_events IS
  'Cross-cutting security & incident register: lockouts, AI cost-cap breaches, '
  'suspected breaches, vendor incidents. Backs the operator incident workflow '
  'and the CERT-In / DPDP notification clocks. Written only by '
  'securityEvents.service.js; append/manage via the backend, never the SPA.';
COMMENT ON COLUMN public.security_events.detected_at IS
  'When the event was first noticed — starts the CERT-In 6-hour reporting window.';

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname = 'security_events' AND relnamespace = 'public'::regnamespace;
--   -- expect: t
--
--   SELECT count(*) FROM public.security_events;
--   -- expect: 0 (no rows until a detective control records one)
