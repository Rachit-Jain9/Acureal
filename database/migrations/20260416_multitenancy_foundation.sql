-- Multi-tenant organizations / workspaces foundation
-- Safe to re-run on existing REDIP databases.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_role') THEN
    CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(120) UNIQUE NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role organization_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role organization_role NOT NULL DEFAULT 'viewer',
  token VARCHAR(255) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (organization_id, email)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_organization_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_default_organization_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_default_organization_id_fkey
      FOREIGN KEY (default_organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE properties            ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE deals                 ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE deal_stage_history    ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE financials            ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE comps                 ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE documents             ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE activities            ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE intelligence_briefs   ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE market_notes          ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE market_transactions   ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE micro_market_benchmarks ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE document_extractions  ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE dd_items              ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE approval_items        ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE risk_flags            ADD COLUMN IF NOT EXISTS organization_id UUID;

DO $$
DECLARE
  default_org_id UUID;
  owner_user_id UUID;
  has_existing_rows BOOLEAN;
BEGIN
  SELECT (
    EXISTS (SELECT 1 FROM users) OR
    EXISTS (SELECT 1 FROM deals) OR
    EXISTS (SELECT 1 FROM properties) OR
    EXISTS (SELECT 1 FROM documents) OR
    EXISTS (SELECT 1 FROM comps)
  ) INTO has_existing_rows;

  IF has_existing_rows THEN
    SELECT id INTO default_org_id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1;

    IF default_org_id IS NULL THEN
      default_org_id := gen_random_uuid();
      INSERT INTO organizations (id, name, slug, created_by)
      VALUES (default_org_id, 'Default Workspace', 'default-workspace', NULL);
    END IF;

    UPDATE users
    SET default_organization_id = COALESCE(default_organization_id, default_org_id)
    WHERE default_organization_id IS NULL;

    SELECT id INTO owner_user_id
    FROM users
    WHERE role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1;

    IF owner_user_id IS NULL THEN
      SELECT id INTO owner_user_id
      FROM users
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    INSERT INTO organization_members (
      organization_id,
      user_id,
      role,
      invited_by,
      is_active,
      joined_at
    )
    SELECT
      default_org_id,
      u.id,
      CASE
        WHEN u.id = owner_user_id THEN 'owner'::organization_role
        WHEN u.role = 'admin' THEN 'admin'::organization_role
        WHEN u.role = 'analyst' THEN 'editor'::organization_role
        ELSE 'viewer'::organization_role
      END,
      owner_user_id,
      COALESCE(u.is_active, TRUE),
      COALESCE(u.created_at, NOW())
    FROM users u
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_active = EXCLUDED.is_active,
          updated_at = NOW();

    UPDATE properties            SET organization_id = COALESCE(organization_id, default_org_id) WHERE organization_id IS NULL;
    UPDATE deals                 SET organization_id = COALESCE(organization_id, default_org_id) WHERE organization_id IS NULL;
    UPDATE comps                 SET organization_id = COALESCE(organization_id, default_org_id) WHERE organization_id IS NULL;
    UPDATE intelligence_briefs   SET organization_id = COALESCE(organization_id, default_org_id) WHERE organization_id IS NULL;
    UPDATE market_notes          SET organization_id = COALESCE(organization_id, default_org_id) WHERE organization_id IS NULL;
    UPDATE market_transactions   SET organization_id = COALESCE(organization_id, default_org_id) WHERE organization_id IS NULL;
    UPDATE micro_market_benchmarks SET organization_id = COALESCE(organization_id, default_org_id) WHERE organization_id IS NULL;

    UPDATE financials f
    SET organization_id = d.organization_id
    FROM deals d
    WHERE f.organization_id IS NULL
      AND d.id = f.deal_id;

    UPDATE documents doc
    SET organization_id = d.organization_id
    FROM deals d
    WHERE doc.organization_id IS NULL
      AND d.id = doc.deal_id;

    UPDATE activities a
    SET organization_id = d.organization_id
    FROM deals d
    WHERE a.organization_id IS NULL
      AND d.id = a.deal_id;

    UPDATE deal_stage_history dsh
    SET organization_id = d.organization_id
    FROM deals d
    WHERE dsh.organization_id IS NULL
      AND d.id = dsh.deal_id;

    UPDATE document_extractions de
    SET organization_id = COALESCE(
      (SELECT d.organization_id FROM deals d WHERE d.id = de.deal_id),
      doc.organization_id
    )
    FROM documents doc
    WHERE de.organization_id IS NULL
      AND doc.id = de.document_id;

    UPDATE dd_items ddi
    SET organization_id = d.organization_id
    FROM deals d
    WHERE ddi.organization_id IS NULL
      AND d.id = ddi.deal_id;

    UPDATE approval_items ai
    SET organization_id = d.organization_id
    FROM deals d
    WHERE ai.organization_id IS NULL
      AND d.id = ai.deal_id;

    UPDATE risk_flags rf
    SET organization_id = d.organization_id
    FROM deals d
    WHERE rf.organization_id IS NULL
      AND d.id = rf.deal_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'organization_id') THEN
    ALTER TABLE properties ALTER COLUMN organization_id SET NOT NULL;
    ALTER TABLE properties ADD CONSTRAINT properties_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deals ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE deals ADD CONSTRAINT deals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deal_stage_history ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE deal_stage_history ADD CONSTRAINT deal_stage_history_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE financials ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE financials ADD CONSTRAINT financials_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE comps ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE comps ADD CONSTRAINT comps_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE documents ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE documents ADD CONSTRAINT documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE activities ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE activities ADD CONSTRAINT activities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE document_extractions ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE document_extractions ADD CONSTRAINT document_extractions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE dd_items ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE dd_items ADD CONSTRAINT dd_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE approval_items ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE approval_items ADD CONSTRAINT approval_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE risk_flags ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE risk_flags ADD CONSTRAINT risk_flags_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE intelligence_briefs ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE intelligence_briefs ADD CONSTRAINT intelligence_briefs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE market_notes ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE market_transactions ALTER COLUMN organization_id SET NOT NULL;
  ALTER TABLE micro_market_benchmarks ALTER COLUMN organization_id SET NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE properties ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE deals ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE deal_stage_history ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE financials ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE comps ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE documents ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE activities ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE intelligence_briefs ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE market_notes ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE market_transactions ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE micro_market_benchmarks ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE document_extractions ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE dd_items ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE approval_items ALTER COLUMN organization_id SET DEFAULT current_organization_id();
ALTER TABLE risk_flags ALTER COLUMN organization_id SET DEFAULT current_organization_id();

CREATE INDEX IF NOT EXISTS idx_organization_members_org_user ON organization_members(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_org_email ON organization_invitations(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_token ON organization_invitations(token);
CREATE INDEX IF NOT EXISTS idx_properties_organization_id ON properties(organization_id);
CREATE INDEX IF NOT EXISTS idx_deals_organization_id ON deals(organization_id);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_organization_id ON deal_stage_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_financials_organization_id ON financials(organization_id);
CREATE INDEX IF NOT EXISTS idx_comps_organization_id ON comps(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_organization_id ON documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_activities_organization_id ON activities(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_extractions_organization_id ON document_extractions(organization_id);
CREATE INDEX IF NOT EXISTS idx_dd_items_organization_id ON dd_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_approval_items_organization_id ON approval_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_risk_flags_organization_id ON risk_flags(organization_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_briefs_org_date_scope ON intelligence_briefs(organization_id, brief_date, market_scope);

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE comps ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_market_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dd_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE properties FORCE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history FORCE ROW LEVEL SECURITY;
ALTER TABLE financials FORCE ROW LEVEL SECURITY;
ALTER TABLE comps FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
ALTER TABLE intelligence_briefs FORCE ROW LEVEL SECURITY;
ALTER TABLE market_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE market_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE micro_market_benchmarks FORCE ROW LEVEL SECURITY;
ALTER TABLE document_extractions FORCE ROW LEVEL SECURITY;
ALTER TABLE dd_items FORCE ROW LEVEL SECURITY;
ALTER TABLE approval_items FORCE ROW LEVEL SECURITY;
ALTER TABLE risk_flags FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_member_access ON organizations;
DROP POLICY IF EXISTS organization_members_member_access ON organization_members;
DROP POLICY IF EXISTS organization_invitations_member_access ON organization_invitations;
DROP POLICY IF EXISTS properties_org_scope ON properties;
DROP POLICY IF EXISTS deals_org_scope ON deals;
DROP POLICY IF EXISTS deal_stage_history_org_scope ON deal_stage_history;
DROP POLICY IF EXISTS financials_org_scope ON financials;
DROP POLICY IF EXISTS comps_org_scope ON comps;
DROP POLICY IF EXISTS documents_org_scope ON documents;
DROP POLICY IF EXISTS activities_org_scope ON activities;
DROP POLICY IF EXISTS intelligence_briefs_org_scope ON intelligence_briefs;
DROP POLICY IF EXISTS market_notes_org_scope ON market_notes;
DROP POLICY IF EXISTS market_transactions_org_scope ON market_transactions;
DROP POLICY IF EXISTS micro_market_benchmarks_org_scope ON micro_market_benchmarks;
DROP POLICY IF EXISTS document_extractions_org_scope ON document_extractions;
DROP POLICY IF EXISTS dd_items_org_scope ON dd_items;
DROP POLICY IF EXISTS approval_items_org_scope ON approval_items;
DROP POLICY IF EXISTS risk_flags_org_scope ON risk_flags;

CREATE POLICY organizations_member_access ON organizations
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND om.is_active = TRUE
    )
  );

CREATE POLICY organization_members_member_access ON organization_members
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY organization_invitations_member_access ON organization_invitations
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY properties_org_scope ON properties
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY deals_org_scope ON deals
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY deal_stage_history_org_scope ON deal_stage_history
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY financials_org_scope ON financials
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY comps_org_scope ON comps
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY documents_org_scope ON documents
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY activities_org_scope ON activities
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY intelligence_briefs_org_scope ON intelligence_briefs
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY market_notes_org_scope ON market_notes
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY market_transactions_org_scope ON market_transactions
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY micro_market_benchmarks_org_scope ON micro_market_benchmarks
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY document_extractions_org_scope ON document_extractions
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY dd_items_org_scope ON dd_items
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY approval_items_org_scope ON approval_items
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY risk_flags_org_scope ON risk_flags
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
