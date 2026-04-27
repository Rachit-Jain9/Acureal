-- Real Estate Development Intelligence Platform - India
-- PostgreSQL Schema

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION
  WHEN insufficient_privilege OR undefined_file THEN
    RAISE NOTICE 'PostGIS extension unavailable in this database; spatial geometry columns will be skipped.';
END $$;

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'analyst', 'viewer');
CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE zoning_type AS ENUM ('residential', 'commercial', 'mixed_use', 'industrial', 'agricultural');
CREATE TYPE deal_type AS ENUM ('acquisition', 'jv', 'da', 'outright');
CREATE TYPE deal_stage AS ENUM ('sourced', 'screening', 'site_visit', 'loi', 'due_diligence', 'underwriting', 'ic_review', 'negotiation', 'active', 'closed', 'dead');
CREATE TYPE project_type AS ENUM ('residential', 'commercial', 'mixed_use');
CREATE TYPE doc_category AS ENUM ('om', 'financials', 'legal', 'technical', 'approvals', 'other');
CREATE TYPE activity_type AS ENUM ('call', 'site_visit', 'meeting', 'loi_sent', 'offer_received', 'email', 'note');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'analyst',
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Organizations / workspaces
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) UNIQUE NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE organization_members (
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

CREATE TABLE organization_invitations (
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
    ADD COLUMN default_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organization_members_org_user ON organization_members(organization_id, user_id);
CREATE INDEX idx_organization_members_user ON organization_members(user_id);
CREATE INDEX idx_organization_invitations_org_email ON organization_invitations(organization_id, email);
CREATE INDEX idx_organization_invitations_token ON organization_invitations(token);

-- Properties table
CREATE TABLE properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(500),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    lat DECIMAL(10, 7),
    lng DECIMAL(10, 7),
    property_type VARCHAR(50) NOT NULL DEFAULT 'land',
    survey_number VARCHAR(100),
    pid VARCHAR(120),
    khata_no VARCHAR(120),
    bhoomi_id VARCHAR(120),
    rera_registration_number VARCHAR(120),
    owner_name VARCHAR(255),
    land_area_sqft DECIMAL(15, 2),
    land_area_acres DECIMAL(10, 4) GENERATED ALWAYS AS (land_area_sqft / 43560.0) STORED,
    land_area_input_value DECIMAL(15, 2),
    land_area_input_unit VARCHAR(10) NOT NULL DEFAULT 'sqft',
    zoning zoning_type NOT NULL DEFAULT 'residential',
    circle_rate_per_sqft DECIMAL(12, 2),
    existing_fsi DECIMAL(5, 2) DEFAULT 1.0,
    permissible_fsi DECIMAL(5, 2),
    road_width_mtrs DECIMAL(5, 2),
    frontage_mtrs DECIMAL(8, 2),
    depth_mtrs DECIMAL(8, 2),
    setback_details TEXT,
    ownership_type VARCHAR(100),
    encumbrance_status VARCHAR(100),
    geocode_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    geocode_confidence DECIMAL(5, 2),
    geocode_message TEXT,
    geocode_last_attempt_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_properties_city ON properties(city);
CREATE INDEX idx_properties_organization_id ON properties(organization_id);
CREATE INDEX idx_properties_zoning ON properties(zoning);
CREATE INDEX idx_properties_property_type ON properties(property_type);
CREATE INDEX idx_properties_created_by ON properties(created_by);
CREATE INDEX idx_properties_location ON properties(lat, lng);
CREATE INDEX idx_properties_name_trgm ON properties USING gin(name gin_trgm_ops);

-- Deals table
CREATE TABLE deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    name VARCHAR(500) NOT NULL,
    deal_type deal_type NOT NULL,
    asset_class VARCHAR(50) NOT NULL DEFAULT 'residential_apartments',
    deal_structure VARCHAR(50) NOT NULL DEFAULT 'outright',
    stage deal_stage NOT NULL DEFAULT 'screening',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    target_launch_date DATE,
    expected_close_date DATE,
    land_pricing_basis VARCHAR(20) NOT NULL DEFAULT 'total_cr',
    land_price_rate_inr DECIMAL(15, 2),
    land_extent_input_value DECIMAL(15, 2),
    land_extent_input_unit VARCHAR(10) NOT NULL DEFAULT 'sqft',
    land_ask_price_cr DECIMAL(15, 4),
    negotiated_price_cr DECIMAL(15, 4),
    jv_split_developer_pct DECIMAL(5, 2),
    jv_split_landowner_pct DECIMAL(5, 2),
    rera_number VARCHAR(100),
    rera_expiry_date DATE,
    notes TEXT,
    priority VARCHAR(20) DEFAULT 'medium',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMP WITH TIME ZONE,
    archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
    archived_reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_deals_property_id ON deals(property_id);
CREATE INDEX idx_deals_organization_id ON deals(organization_id);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_assigned_to ON deals(assigned_to);
CREATE INDEX idx_deals_created_by ON deals(created_by);
CREATE INDEX idx_deals_deal_type ON deals(deal_type);
CREATE INDEX idx_deals_archived ON deals(is_archived);

-- Deal shares table (per-user deal sharing across isolated workspaces)
CREATE TABLE deal_shares (
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

-- Deal stage history table
CREATE TABLE deal_stage_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    from_stage deal_stage,
    to_stage deal_stage NOT NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX idx_deal_stage_history_deal_id ON deal_stage_history(deal_id);
CREATE INDEX idx_deal_stage_history_organization_id ON deal_stage_history(organization_id);
CREATE INDEX idx_deal_stage_history_changed_at ON deal_stage_history(changed_at);

-- Financials table
CREATE TABLE financials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    -- Inputs
    land_cost_cr DECIMAL(15, 4),
    plot_area_sqft DECIMAL(15, 2),
    fsi DECIMAL(5, 2),
    loading_factor DECIMAL(5, 4) DEFAULT 0.65,
    construction_cost_per_sqft DECIMAL(10, 2),
    selling_rate_per_sqft DECIMAL(10, 2),
    approval_cost_cr DECIMAL(15, 4),
    marketing_cost_pct DECIMAL(5, 2),
    finance_cost_pct DECIMAL(5, 2),
    developer_margin_pct DECIMAL(5, 2),
    project_duration_months INTEGER DEFAULT 36,
    -- Computed areas
    gross_area_sqft DECIMAL(15, 2),
    saleable_area_sqft DECIMAL(15, 2),
    carpet_area_sqft DECIMAL(15, 2),
    super_builtup_area_sqft DECIMAL(15, 2),
    -- Computed costs
    total_construction_cost_cr DECIMAL(15, 4),
    gst_cost_cr DECIMAL(15, 4),
    stamp_duty_cr DECIMAL(15, 4),
    marketing_cost_cr DECIMAL(15, 4),
    finance_cost_cr DECIMAL(15, 4),
    total_cost_cr DECIMAL(15, 4),
    -- Revenue and profit
    total_revenue_cr DECIMAL(15, 4),
    gross_profit_cr DECIMAL(15, 4),
    gross_margin_pct DECIMAL(7, 4),
    developer_profit_cr DECIMAL(15, 4),
    -- Asset class and model params (multi-class support)
    asset_class VARCHAR(50) NOT NULL DEFAULT 'residential_apartments',
    model_params JSONB,
    -- Income asset KPIs
    noi_cr DECIMAL(15, 4),
    yield_on_cost_pct DECIMAL(8, 4),
    exit_value_cr DECIMAL(15, 4),
    entry_value_cr DECIMAL(15, 4),
    dscr DECIMAL(8, 4),
    stabilized_noi_cr DECIMAL(15, 4),
    -- Investment metrics
    npv_cr DECIMAL(15, 4),
    irr_pct DECIMAL(8, 4),
    residual_land_value_cr DECIMAL(15, 4),
    equity_multiple DECIMAL(8, 4),
    -- Cash flows and sensitivity
    cash_flows JSONB,
    sensitivity_matrix JSONB,
    -- Additional metadata
    discount_rate_pct DECIMAL(5, 2) DEFAULT 12.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financials_asset_class ON financials(asset_class);

CREATE INDEX idx_financials_organization_id ON financials(organization_id);
CREATE INDEX idx_financials_deal_id ON financials(deal_id);

-- Comps table
CREATE TABLE comps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_name VARCHAR(500) NOT NULL,
    developer VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    locality VARCHAR(255),
    lat DECIMAL(10, 7),
    lng DECIMAL(10, 7),
    project_type project_type NOT NULL DEFAULT 'residential',
    bhk_config VARCHAR(100),
    carpet_area_sqft DECIMAL(10, 2),
    super_builtup_area_sqft DECIMAL(10, 2),
    rate_per_sqft DECIMAL(10, 2) NOT NULL,
    rate_per_sqft_min DECIMAL(10, 2),
    rate_per_sqft_max DECIMAL(10, 2),
    total_units INTEGER,
    launch_year INTEGER,
    possession_year INTEGER,
    rera_number VARCHAR(100),
    amenities TEXT[],
    source VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_comps_city ON comps(city);
CREATE INDEX idx_comps_organization_id ON comps(organization_id);
CREATE INDEX idx_comps_locality ON comps(locality);
CREATE INDEX idx_comps_project_type ON comps(project_type);
CREATE INDEX idx_comps_location ON comps(lat, lng);
CREATE INDEX idx_comps_rate ON comps(rate_per_sqft);
CREATE INDEX idx_comps_project_name ON comps(project_name);
CREATE INDEX idx_comps_is_verified ON comps(is_verified);

-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size_bytes BIGINT,
    doc_category doc_category NOT NULL DEFAULT 'other',
    description TEXT,
    version INTEGER DEFAULT 1,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_documents_deal_id ON documents(deal_id);
CREATE INDEX idx_documents_organization_id ON documents(organization_id);
CREATE INDEX idx_documents_doc_category ON documents(doc_category);
CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by);

-- Activities table
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    activity_type activity_type NOT NULL,
    description TEXT NOT NULL,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    activity_date TIMESTAMP WITH TIME ZONE NOT NULL,
    next_follow_up DATE,
    is_important BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_activities_deal_id ON activities(deal_id);
CREATE INDEX idx_activities_organization_id ON activities(organization_id);
CREATE INDEX idx_activities_performed_by ON activities(performed_by);
CREATE INDEX idx_activities_activity_date ON activities(activity_date DESC);
CREATE INDEX idx_activities_type ON activities(activity_type);
CREATE INDEX idx_activities_status ON activities(status);
CREATE INDEX idx_activities_priority ON activities(priority);

-- Intelligence briefs
CREATE TABLE intelligence_briefs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    brief_date DATE NOT NULL,
    market_scope VARCHAR(100) NOT NULL DEFAULT 'bengaluru_india',
    content JSONB NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, brief_date, market_scope)
);

CREATE INDEX idx_intelligence_briefs_org_date_scope ON intelligence_briefs(organization_id, brief_date, market_scope);

-- Market notes
CREATE TABLE market_notes (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    section VARCHAR(50) NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, section)
);

CREATE INDEX idx_market_notes_section ON market_notes(section);

-- Verified market transactions
CREATE TABLE market_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    fiscal_year VARCHAR(10) NOT NULL,
    quarter VARCHAR(5) NOT NULL,
    deal_type VARCHAR(50) NOT NULL,
    buyer TEXT,
    seller TEXT,
    investor_lender TEXT,
    quantum_inr_mn DECIMAL(15, 2),
    land_size_acres DECIMAL(15, 4),
    project_size_note TEXT,
    locality TEXT,
    notes TEXT,
    source_reference TEXT,
    city VARCHAR(100) DEFAULT 'Bengaluru',
    is_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX market_transactions_dedup
    ON market_transactions (organization_id, fiscal_year, quarter, quantum_inr_mn, LOWER(COALESCE(buyer, '')));
CREATE INDEX idx_mktxn_org ON market_transactions(organization_id);
CREATE INDEX idx_mktxn_fy ON market_transactions(fiscal_year);
CREATE INDEX idx_mktxn_type ON market_transactions(deal_type);
CREATE INDEX idx_mktxn_city ON market_transactions(city);

-- Micro-market benchmarks
CREATE TABLE micro_market_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    city VARCHAR(100) DEFAULT 'Bengaluru',
    micro_market VARCHAR(200) NOT NULL,
    avg_price_min_per_sqft DECIMAL(12, 2),
    avg_price_max_per_sqft DECIMAL(12, 2),
    yoy_growth_min_pct DECIMAL(7, 2),
    yoy_growth_max_pct DECIMAL(7, 2),
    anchor_hub TEXT,
    data_period VARCHAR(50) DEFAULT '2025-2026',
    is_verified BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, city, micro_market)
);

CREATE INDEX idx_mmb_org ON micro_market_benchmarks(organization_id);
CREATE INDEX idx_mmb_city ON micro_market_benchmarks(city);

-- Document extraction history
CREATE TABLE document_extractions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
    doc_type VARCHAR(100),
    extraction_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provider VARCHAR(50) NOT NULL DEFAULT 'gemini',
    raw_extraction JSONB,
    structured_fields JSONB,
    confidence_scores JSONB,
    human_corrections JSONB,
    correction_history JSONB DEFAULT '[]'::jsonb,
    language_detected VARCHAR(20),
    pages_processed INTEGER,
    error_message TEXT,
    provider_job_id VARCHAR(255),
    extracted_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_document_extractions_document_id ON document_extractions(document_id);
CREATE INDEX idx_document_extractions_organization_id ON document_extractions(organization_id);
CREATE INDEX idx_document_extractions_deal_id ON document_extractions(deal_id);
CREATE INDEX idx_document_extractions_status ON document_extractions(extraction_status);
CREATE INDEX idx_document_extractions_doc_type ON document_extractions(doc_type);

-- Due diligence checklist items
CREATE TABLE dd_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    item_name VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    severity VARCHAR(50) NOT NULL DEFAULT 'secondary',
    is_required BOOLEAN DEFAULT TRUE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    notes TEXT,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date DATE,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_dd_items_deal_id ON dd_items(deal_id);
CREATE INDEX idx_dd_items_organization_id ON dd_items(organization_id);
CREATE INDEX idx_dd_items_status ON dd_items(status);
CREATE INDEX idx_dd_items_severity ON dd_items(severity);
CREATE INDEX idx_dd_items_category ON dd_items(category);

-- Approval tracker items
CREATE TABLE approval_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    approval_type VARCHAR(100) NOT NULL,
    name VARCHAR(500) NOT NULL,
    is_required BOOLEAN DEFAULT TRUE,
    is_available BOOLEAN DEFAULT FALSE,
    is_uploaded BOOLEAN DEFAULT FALSE,
    is_validated BOOLEAN DEFAULT FALSE,
    issued_date DATE,
    expiry_date DATE,
    reference_number VARCHAR(255),
    issuing_authority VARCHAR(255),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    notes TEXT,
    next_action TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_approval_items_deal_id ON approval_items(deal_id);
CREATE INDEX idx_approval_items_organization_id ON approval_items(organization_id);
CREATE INDEX idx_approval_items_status ON approval_items(status);
CREATE INDEX idx_approval_items_approval_type ON approval_items(approval_type);

-- Deal-level risk flags
CREATE TABLE risk_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL DEFAULT 'medium',
    title VARCHAR(500) NOT NULL,
    description TEXT,
    mitigation TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    source VARCHAR(50) DEFAULT 'manual',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_risk_flags_deal_id ON risk_flags(deal_id);
CREATE INDEX idx_risk_flags_organization_id ON risk_flags(organization_id);
CREATE INDEX idx_risk_flags_status ON risk_flags(status);
CREATE INDEX idx_risk_flags_severity ON risk_flags(severity);
CREATE INDEX idx_risk_flags_category ON risk_flags(category);

-- Tenant defaults for application-managed tables.
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

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_organization_members_updated_at BEFORE UPDATE ON organization_members
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_organization_invitations_updated_at BEFORE UPDATE ON organization_invitations
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_financials_updated_at BEFORE UPDATE ON financials
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_comps_updated_at BEFORE UPDATE ON comps
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON activities
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_market_notes_updated_at BEFORE UPDATE ON market_notes
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_micro_market_benchmarks_updated_at BEFORE UPDATE ON micro_market_benchmarks
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_document_extractions_updated_at BEFORE UPDATE ON document_extractions
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_dd_items_updated_at BEFORE UPDATE ON dd_items
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_approval_items_updated_at BEFORE UPDATE ON approval_items
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_risk_flags_updated_at BEFORE UPDATE ON risk_flags
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Row level security
CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE comps ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_market_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dd_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE properties FORCE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;
ALTER TABLE financials FORCE ROW LEVEL SECURITY;
ALTER TABLE comps FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
ALTER TABLE intelligence_briefs FORCE ROW LEVEL SECURITY;
ALTER TABLE market_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE market_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE micro_market_benchmarks FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history FORCE ROW LEVEL SECURITY;
ALTER TABLE document_extractions FORCE ROW LEVEL SECURITY;
ALTER TABLE dd_items FORCE ROW LEVEL SECURITY;
ALTER TABLE approval_items FORCE ROW LEVEL SECURITY;
ALTER TABLE risk_flags FORCE ROW LEVEL SECURITY;

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

CREATE POLICY deal_stage_history_org_scope ON deal_stage_history
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

-- Deal shares RLS
ALTER TABLE deal_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY deal_shares_access ON deal_shares
  FOR ALL USING (
    shared_by = current_user_id()
    OR shared_with = current_user_id()
  );

-- Shared deal read policies (complement org-scoped policies for cross-user access)
CREATE POLICY deals_shared_read ON deals
  FOR SELECT USING (
    id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

CREATE POLICY properties_shared_read ON properties
  FOR SELECT USING (
    id IN (
      SELECT d.property_id FROM deals d
      INNER JOIN deal_shares ds ON ds.deal_id = d.id
      WHERE ds.shared_with = current_user_id() AND d.property_id IS NOT NULL
    )
  );

CREATE POLICY documents_shared_read ON documents
  FOR SELECT USING (
    deal_id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

CREATE POLICY dd_items_shared_read ON dd_items
  FOR SELECT USING (
    deal_id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

CREATE POLICY approval_items_shared_read ON approval_items
  FOR SELECT USING (
    deal_id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

CREATE POLICY risk_flags_shared_read ON risk_flags
  FOR SELECT USING (
    deal_id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

CREATE POLICY activities_shared_read ON activities
  FOR SELECT USING (
    deal_id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

CREATE POLICY financials_shared_read ON financials
  FOR SELECT USING (
    deal_id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

CREATE POLICY deal_stage_history_shared_read ON deal_stage_history
  FOR SELECT USING (
    deal_id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id())
  );

-- Regulatory data and Parcel Intelligence
CREATE SCHEMA IF NOT EXISTS regulatory_data;

CREATE TABLE regulatory_data.master_plan_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  city TEXT NOT NULL DEFAULT 'Bengaluru',
  plan_name TEXT NOT NULL,
  plan_version TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size_bytes BIGINT DEFAULT 0,
  file_url TEXT,
  storage_path TEXT,
  doc_type TEXT,
  deleted_at TIMESTAMPTZ,
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending','in_progress','completed','failed')),
  zones_extracted INT NOT NULL DEFAULT 0,
  far_rules_extracted INT NOT NULL DEFAULT 0,
  guidance_rows_extracted INT NOT NULL DEFAULT 0,
  evidence_facts_extracted INT NOT NULL DEFAULT 0,
  extraction_error TEXT,
  evidence_source_id UUID,
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE regulatory_data.planning_districts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pd_code TEXT UNIQUE NOT NULL,
  pd_name TEXT,
  city TEXT NOT NULL DEFAULT 'Bengaluru'
);

CREATE TABLE regulatory_data.master_plan_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES regulatory_data.master_plan_documents(id) ON DELETE SET NULL,
  planning_district_id UUID REFERENCES regulatory_data.planning_districts(id) ON DELETE SET NULL,
  city TEXT NOT NULL DEFAULT 'Bengaluru',
  plan_version TEXT,
  zone_code TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  permissible_fsi_base DECIMAL(5,2),
  permissible_fsi_max DECIMAL(5,2),
  fsi_road_width_rules JSONB,
  ground_coverage_pct DECIMAL(5,2),
  building_height_max_m DECIMAL(6,2),
  road_width_min_m DECIMAL(5,2),
  setback_rules JSONB,
  permissible_uses TEXT[],
  prohibited_uses TEXT[],
  notes TEXT DEFAULT 'Manual entry',
  source_page INT,
  source_section TEXT,
  confidence_score DECIMAL(3,2),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zone_code, plan_version, planning_district_id)
);

CREATE TABLE regulatory_data.zone_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id UUID NOT NULL REFERENCES regulatory_data.master_plan_zones(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_values JSONB NOT NULL,
  change_reason TEXT
);

CREATE OR REPLACE FUNCTION regulatory_data.effective_fsi(
  fsi_base DECIMAL,
  road_width_rules JSONB,
  road_width_m DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
  rule JSONB;
BEGIN
  IF road_width_rules IS NULL
     OR jsonb_typeof(road_width_rules) <> 'array'
     OR jsonb_array_length(road_width_rules) = 0
     OR road_width_m IS NULL THEN
    RETURN fsi_base;
  END IF;

  SELECT r INTO rule
  FROM jsonb_array_elements(road_width_rules) r
  WHERE (r->>'road_width_m')::DECIMAL <= road_width_m
  ORDER BY (r->>'road_width_m')::DECIMAL DESC
  LIMIT 1;

  RETURN COALESCE((rule->>'fsi')::DECIMAL, fsi_base);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE properties
  ADD COLUMN zone_id UUID REFERENCES regulatory_data.master_plan_zones(id) ON DELETE SET NULL,
  ADD COLUMN zone_assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN zone_assigned_at TIMESTAMPTZ,
  ADD COLUMN zone_notes TEXT;

CREATE TABLE regulatory_data.evidence_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  source_kind VARCHAR(40) NOT NULL CHECK (source_kind IN ('official_pdf', 'vendor', 'user_upload', 'manual_entry', 'kgis', 'system')),
  authority_name VARCHAR(255),
  vendor_name VARCHAR(255),
  source_title VARCHAR(500) NOT NULL,
  source_url TEXT,
  file_url TEXT,
  storage_path TEXT,
  checksum_sha256 VARCHAR(64),
  city VARCHAR(120) DEFAULT 'Bengaluru',
  plan_version VARCHAR(120),
  effective_from DATE,
  effective_to DATE,
  extraction_status VARCHAR(40) DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'in_progress', 'completed', 'failed', 'not_required')),
  review_status VARCHAR(40) DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_review')),
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  approved_facts JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE regulatory_data.master_plan_documents
  ADD CONSTRAINT master_plan_documents_evidence_source_id_fkey
  FOREIGN KEY (evidence_source_id)
  REFERENCES regulatory_data.evidence_sources(id)
  ON DELETE SET NULL;

CREATE TABLE regulatory_data.evidence_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES regulatory_data.evidence_sources(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  fact_type VARCHAR(80) NOT NULL,
  fact_key VARCHAR(160) NOT NULL,
  fact_value JSONB NOT NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  source_section VARCHAR(255),
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  review_status VARCHAR(40) DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_review')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE regulatory_data.far_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES regulatory_data.master_plan_zones(id) ON DELETE SET NULL,
  city VARCHAR(120) DEFAULT 'Bengaluru',
  plan_version VARCHAR(120) DEFAULT 'RMP 2031 Draft',
  plan_status VARCHAR(60) DEFAULT 'draft_reference',
  zone_code VARCHAR(80),
  planning_zone VARCHAR(20),
  land_use_family VARCHAR(80) NOT NULL,
  plot_area_min_sqm NUMERIC(12,2) DEFAULT 0,
  plot_area_max_sqm NUMERIC(12,2),
  road_width_min_m NUMERIC(8,2) DEFAULT 0,
  road_width_max_m NUMERIC(8,2),
  base_far NUMERIC(6,3) NOT NULL,
  additional_far NUMERIC(6,3) DEFAULT 0,
  max_far NUMERIC(6,3) NOT NULL,
  ground_coverage_pct NUMERIC(6,2),
  front_setback_m NUMERIC(6,2),
  rear_setback_m NUMERIC(6,2),
  side_setback_m NUMERIC(6,2),
  tdr_eligible BOOLEAN,
  premium_far_cap NUMERIC(6,3),
  tdr_road_threshold_m NUMERIC(8,2),
  source_page INTEGER,
  source_section VARCHAR(255),
  rule_notes TEXT,
  confidence_score NUMERIC(4,3) DEFAULT 1 CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  review_status VARCHAR(40) DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_review')),
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE regulatory_data.guidance_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  city VARCHAR(120) DEFAULT 'Bengaluru',
  sro_name VARCHAR(255),
  locality VARCHAR(500) NOT NULL,
  road_name VARCHAR(500),
  land_use_type VARCHAR(120) DEFAULT 'residential',
  value_inr_per_sqft NUMERIC(14,2),
  value_inr_per_acre NUMERIC(18,2),
  unit_type VARCHAR(40) DEFAULT 'sqft',
  effective_from DATE,
  effective_to DATE,
  source_page INTEGER,
  source_section VARCHAR(255),
  review_status VARCHAR(40) DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_review')),
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE regulatory_data.kgis_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  provider_status VARCHAR(60) NOT NULL DEFAULT 'not_requested',
  request_payload JSONB DEFAULT '{}'::jsonb,
  response_payload JSONB DEFAULT '{}'::jsonb,
  hierarchy JSONB DEFAULT '{}'::jsonb,
  survey_numbers JSONB DEFAULT '[]'::jsonb,
  geometry_geojson JSONB,
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE regulatory_data.parcel_intelligence_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  inputs_hash VARCHAR(64) NOT NULL,
  output_json JSONB NOT NULL,
  source_versions JSONB DEFAULT '{}'::jsonb,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mpz_code_city ON regulatory_data.master_plan_zones(zone_code, city);
CREATE INDEX idx_properties_zone ON properties(zone_id) WHERE zone_id IS NOT NULL;
CREATE INDEX idx_properties_survey_city ON properties(organization_id, city, survey_number) WHERE survey_number IS NOT NULL;
CREATE INDEX idx_properties_pid ON properties(organization_id, pid) WHERE pid IS NOT NULL;
CREATE INDEX idx_properties_khata_no ON properties(organization_id, khata_no) WHERE khata_no IS NOT NULL;
CREATE INDEX idx_properties_rera_registration ON properties(organization_id, rera_registration_number) WHERE rera_registration_number IS NOT NULL;
CREATE INDEX idx_far_rules_lookup ON regulatory_data.far_rules(org_id, city, zone_code, planning_zone, land_use_family, review_status);
CREATE INDEX idx_far_rules_source_review
  ON regulatory_data.far_rules(evidence_source_id, review_status, created_at DESC)
  WHERE evidence_source_id IS NOT NULL;
CREATE INDEX idx_guidance_locality_trgm ON regulatory_data.guidance_values USING gin(locality gin_trgm_ops);
CREATE INDEX idx_guidance_road_trgm ON regulatory_data.guidance_values USING gin(road_name gin_trgm_ops);
CREATE INDEX idx_guidance_values_source_review
  ON regulatory_data.guidance_values(evidence_source_id, review_status, created_at DESC)
  WHERE evidence_source_id IS NOT NULL;
CREATE INDEX idx_evidence_sources_org_document
  ON regulatory_data.evidence_sources(org_id, document_id, created_at DESC)
  WHERE document_id IS NOT NULL;
CREATE INDEX idx_evidence_facts_source_review
  ON regulatory_data.evidence_facts(source_id, review_status, created_at DESC);
CREATE UNIQUE INDEX idx_kgis_cache_cache_key_org
  ON regulatory_data.kgis_cache(COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), cache_key);
CREATE INDEX idx_parcel_snapshots_property
  ON regulatory_data.parcel_intelligence_snapshots(org_id, property_id, generated_at DESC);

DO $$
DECLARE
  postgis_schema TEXT;
BEGIN
  SELECT n.nspname
    INTO postgis_schema
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typname = 'geometry'
  LIMIT 1;

  IF postgis_schema IS NOT NULL THEN
    EXECUTE format('ALTER TABLE properties ADD COLUMN IF NOT EXISTS geom %I.geometry(Point, 4326)', postgis_schema);
    EXECUTE format('ALTER TABLE regulatory_data.master_plan_zones ADD COLUMN IF NOT EXISTS geom %I.geometry(MultiPolygon, 4326)', postgis_schema);

    EXECUTE format($sql$
      CREATE OR REPLACE FUNCTION sync_property_geom()
      RETURNS TRIGGER AS $fn$
      BEGIN
        IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
          NEW.geom := %I.ST_SetSRID(%I.ST_MakePoint(NEW.lng::double precision, NEW.lat::double precision), 4326);
        ELSE
          NEW.geom := NULL;
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    $sql$, postgis_schema, postgis_schema);

    DROP TRIGGER IF EXISTS trg_properties_sync_geom ON properties;
    CREATE TRIGGER trg_properties_sync_geom
      BEFORE INSERT OR UPDATE OF lat, lng ON properties
      FOR EACH ROW EXECUTE FUNCTION sync_property_geom();

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_properties_geom ON properties USING gist(geom) WHERE geom IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_master_plan_zones_geom ON regulatory_data.master_plan_zones USING gist(geom) WHERE geom IS NOT NULL';
  END IF;
END $$;

ALTER TABLE regulatory_data.evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.evidence_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.far_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.guidance_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.kgis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.parcel_intelligence_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_sources_org_or_global ON regulatory_data.evidence_sources
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());
CREATE POLICY evidence_facts_org_or_global ON regulatory_data.evidence_facts
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());
CREATE POLICY far_rules_org_or_global ON regulatory_data.far_rules
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());
CREATE POLICY guidance_values_org_or_global ON regulatory_data.guidance_values
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id IS NULL OR org_id = current_organization_id());
CREATE POLICY kgis_cache_org_only ON regulatory_data.kgis_cache
  USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());
CREATE POLICY parcel_snapshots_org_only ON regulatory_data.parcel_intelligence_snapshots
  USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());

-- View: deal_summary
CREATE VIEW deal_summary AS
SELECT
    d.id,
    d.name AS deal_name,
    d.deal_type,
    d.asset_class,
    d.deal_structure,
    d.stage,
    d.priority,
    p.name AS property_name,
    p.city,
    p.state,
    p.land_area_sqft,
    p.zoning,
    u.name AS assigned_to_name,
    f.total_revenue_cr,
    f.total_cost_cr,
    f.gross_profit_cr,
    f.gross_margin_pct,
    f.irr_pct,
    f.npv_cr,
    f.saleable_area_sqft,
    d.target_launch_date,
    d.created_at,
    d.updated_at
FROM deals d
LEFT JOIN properties p ON d.property_id = p.id
LEFT JOIN users u ON d.assigned_to = u.id
LEFT JOIN financials f ON d.id = f.deal_id
WHERE d.is_archived = FALSE;
