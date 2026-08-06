-- ============================================================================
-- 20260810 — Invitation lifecycle: status, delivery, revocation
-- ============================================================================
-- `organization_invitations` has existed since the multi-tenancy work, but the
-- loop it belongs to was never finished and the table shows it:
--
--   • No status. "Pending" was inferred from accepted_at IS NULL, which cannot
--     express revoked — and (phase 3) cannot express awaiting-approval either.
--   • Nothing records when an invitation was SENT, because nothing ever sent
--     one. No code path in this repo passed an invitation to the mailer, while
--     the Team page toasted "Invitation sent" and the modal promised the
--     recipient "an email link to join this workspace". Both were false.
--   • No revocation. An invitation could be superseded but never withdrawn.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: hash the token.
--
-- `token` is stored in PLAINTEXT via a column DEFAULT, which contradicts the
-- sha256-only rule both other one-shot-token flows follow (email verification
-- 20260505, password reset 20260809). It should be hashed — but the lookup
-- happens in TWO SECURITY DEFINER functions as well as JS
-- (auth_find_invitation and auth_provision_signup, both
-- `WHERE oi.token = <plaintext>`, migration 20260802), and auth_provision_signup
-- is a 24-parameter function that would have to be recreated. Cutting that over
-- is atomic-or-broken work: a half-migrated token system means two lookup
-- conventions, which is the precise shape of the gmail two-shapes defect that
-- silently broke password reset (#1094). It gets its own migration and its own
-- review, and until then the tokens stay inert in the way they always have been
-- — the threat model for hashing is an attacker who already holds database read
-- access, who could read the deals directly.
--
-- Idempotent; safe to re-run. Operator-applied.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM (
      'pending_approval',  -- phase 3: external proposal awaiting a Team Lead
      'approved',          -- usable, not yet emailed
      'sent',              -- email dispatched
      'accepted',
      'declined',
      'rejected',          -- phase 3: a Team Lead said no
      'expired',
      'revoked'
    );
  END IF;
END $$;

ALTER TABLE public.organization_invitations
  -- DEFAULT 'approved' so every pre-existing row keeps exactly today's
  -- semantics: usable, no approval gate. Phase 3 adds rows that start at
  -- 'pending_approval'.
  ADD COLUMN IF NOT EXISTS status        invitation_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revoked_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by    UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Reflect the terminal state that was previously implicit in accepted_at.
UPDATE public.organization_invitations
   SET status = 'accepted'
 WHERE accepted_at IS NOT NULL
   AND status = 'approved';

-- The Team page's pending list reads exactly this predicate.
CREATE INDEX IF NOT EXISTS organization_invitations_org_status_idx
  ON public.organization_invitations (organization_id, status);

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'organization_invitations'
--      AND column_name IN ('status','sent_at','revoked_at','send_count');
--     -- expect: 4 rows
--   SELECT unnest(enum_range(NULL::invitation_status));
--     -- expect: 8 values
--   SELECT status, count(*) FROM public.organization_invitations GROUP BY status;
--     -- expect: existing rows are 'approved' or 'accepted', nothing else
