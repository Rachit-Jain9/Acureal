-- ============================================================================
-- Deal Shares: per-user deal sharing for cross-user access
-- ============================================================================
-- Each user has their own isolated workspace (1:1 user:org mapping).
-- This table enables explicit deal-level sharing between users.
-- ============================================================================

-- Helper function: current_user_id() (mirrors current_organization_id())
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Deal shares table
CREATE TABLE IF NOT EXISTS deal_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(20) NOT NULL DEFAULT 'viewer'
        CHECK (permission IN ('viewer', 'editor')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (deal_id, shared_with)
);

CREATE INDEX idx_deal_shares_deal ON deal_shares(deal_id);
CREATE INDEX idx_deal_shares_shared_with ON deal_shares(shared_with);
CREATE INDEX idx_deal_shares_shared_by ON deal_shares(shared_by);

-- RLS on deal_shares: users can see shares they created or are the target of
ALTER TABLE deal_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY deal_shares_access ON deal_shares
  FOR ALL USING (
    shared_by = current_user_id()
    OR shared_with = current_user_id()
  );

-- Add SELECT policy on deals so shared deals are visible across orgs
-- This complements the existing org-scoped policy
CREATE POLICY deals_shared_read ON deals
  FOR SELECT USING (
    id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );

-- Add SELECT policies on deal-related tables for shared deals
CREATE POLICY properties_shared_read ON properties
  FOR SELECT USING (
    id IN (
      SELECT d.property_id
      FROM deals d
      INNER JOIN deal_shares ds ON ds.deal_id = d.id
      WHERE ds.shared_with = current_user_id()
        AND d.property_id IS NOT NULL
    )
  );

CREATE POLICY documents_shared_read ON documents
  FOR SELECT USING (
    deal_id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );

CREATE POLICY dd_items_shared_read ON dd_items
  FOR SELECT USING (
    deal_id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );

CREATE POLICY approval_items_shared_read ON approval_items
  FOR SELECT USING (
    deal_id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );

CREATE POLICY risk_flags_shared_read ON risk_flags
  FOR SELECT USING (
    deal_id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );

CREATE POLICY activities_shared_read ON activities
  FOR SELECT USING (
    deal_id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );

CREATE POLICY financials_shared_read ON financials
  FOR SELECT USING (
    deal_id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );

CREATE POLICY deal_stage_history_shared_read ON deal_stage_history
  FOR SELECT USING (
    deal_id IN (
      SELECT ds.deal_id
      FROM deal_shares ds
      WHERE ds.shared_with = current_user_id()
    )
  );
