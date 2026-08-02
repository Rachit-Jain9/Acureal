-- 20260806_deal_shares_same_workspace.sql
--
-- Locks deal sharing to a single workspace, and removes the nine RLS policies
-- that granted cross-organisation read.
--
-- HISTORY. `20260416_deal_shares.sql` was written when every user had their own
-- isolated workspace — its own header says "1:1 user:org mapping". Sharing a
-- deal was therefore the ONLY way two humans could look at the same deal, and
-- the nine `*_shared_read` policies existed to punch through org scope on
-- deals, properties, documents, dd_items, approval_items, risk_flags,
-- activities, financials and deal_stage_history.
--
-- WHAT CHANGED SINCE. Real multi-tenancy shipped: organisations, memberships,
-- and roles. `deals_org_scope` (FOR ALL USING organization_id =
-- current_organization_id()) already gives every member of a workspace full
-- access to that workspace's deals. The premise those nine policies were built
-- on no longer holds.
--
-- THE DEFECT. `dealShare.service.js` resolved the recipient by bare email with
-- NO organisation comparison — `SELECT id FROM users WHERE LOWER(email) =
-- LOWER($1)`. Any deal owner could therefore hand a complete deal — its
-- documents, financial model, diligence, risks and full activity history — to
-- any account on the platform, in any other customer's workspace, and the nine
-- policies made the database honour it. There was no audit surface for it and
-- no way for the other workspace's owner to know.
--
-- OPERATOR DECISION (2026-08-02): sharing is same-workspace only. External
-- data-room sharing — with expiry, watermarking, revocation and an NDA
-- acknowledgement — is a deliberate future feature, not an accident of a
-- 2026-04 migration.
--
-- WHY DROP RATHER THAN TIGHTEN. Once sharing is same-workspace only, a share
-- recipient is by definition a member of the deal's organisation, so
-- `deals_org_scope` already grants them read. The nine policies would be pure
-- redundancy whose only remaining behaviour is the cross-tenant path we are
-- closing. Tightening them was considered and rejected: adding an
-- org-membership check to `deals_shared_read` requires the subquery to read
-- `deals`, and a policy ON deals that reads deals raises
-- "infinite recursion detected in policy for relation deals".
--
-- BLAST RADIUS: none. `deal_shares` holds ZERO rows in production, so these
-- policies grant nothing today — verified 2026-08-02. The table and its own
-- `deal_shares_access` policy are deliberately KEPT: the feature still records
-- who a deal was pointed at, which is useful, and the app layer now enforces
-- that the recipient is a workspace member.
--
-- Idempotent and safe to re-paste.
--
-- ROLLBACK: re-run the CREATE POLICY block from
-- `database/migrations/20260416_deal_shares.sql` (lines 42-124). Note that
-- doing so restores cross-organisation read, which is the vulnerability this
-- migration exists to remove — treat it as break-glass, not routine.

BEGIN;

DROP POLICY IF EXISTS deals_shared_read              ON deals;
DROP POLICY IF EXISTS properties_shared_read         ON properties;
DROP POLICY IF EXISTS documents_shared_read          ON documents;
DROP POLICY IF EXISTS dd_items_shared_read           ON dd_items;
DROP POLICY IF EXISTS approval_items_shared_read     ON approval_items;
DROP POLICY IF EXISTS risk_flags_shared_read         ON risk_flags;
DROP POLICY IF EXISTS activities_shared_read         ON activities;
DROP POLICY IF EXISTS financials_shared_read         ON financials;
DROP POLICY IF EXISTS deal_stage_history_shared_read ON deal_stage_history;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — run after COMMIT. Both columns must read 0.
-- ────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE '%\_shared\_read')  AS cross_org_share_policies_left,
  (SELECT count(*) FROM deal_shares ds
     JOIN deals d ON d.id = ds.deal_id
    WHERE NOT EXISTS (
      SELECT 1 FROM organization_members om
       WHERE om.user_id = ds.shared_with
         AND om.organization_id = d.organization_id
    ))                                                                  AS cross_workspace_shares_remaining;
