-- Real Estate Development Intelligence Platform - India
-- PostgreSQL Schema

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'analyst', 'viewer');
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

-- Properties table
CREATE TABLE properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(500),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    lat DECIMAL(10, 7),
    lng DECIMAL(10, 7),
    property_type VARCHAR(50) NOT NULL DEFAULT 'land',
    survey_number VARCHAR(100),
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
CREATE INDEX idx_properties_zoning ON properties(zoning);
CREATE INDEX idx_properties_property_type ON properties(property_type);
CREATE INDEX idx_properties_created_by ON properties(created_by);
CREATE INDEX idx_properties_location ON properties(lat, lng);
CREATE INDEX idx_properties_name_trgm ON properties USING gin(name gin_trgm_ops);

-- Deals table
CREATE TABLE deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_assigned_to ON deals(assigned_to);
CREATE INDEX idx_deals_created_by ON deals(created_by);
CREATE INDEX idx_deals_deal_type ON deals(deal_type);
CREATE INDEX idx_deals_archived ON deals(is_archived);

-- Deal stage history table
CREATE TABLE deal_stage_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    from_stage deal_stage,
    to_stage deal_stage NOT NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX idx_deal_stage_history_deal_id ON deal_stage_history(deal_id);
CREATE INDEX idx_deal_stage_history_changed_at ON deal_stage_history(changed_at);

-- Financials table
CREATE TABLE financials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX idx_financials_deal_id ON financials(deal_id);

-- Comps table
CREATE TABLE comps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_comps_locality ON comps(locality);
CREATE INDEX idx_comps_project_type ON comps(project_type);
CREATE INDEX idx_comps_location ON comps(lat, lng);
CREATE INDEX idx_comps_rate ON comps(rate_per_sqft);
CREATE INDEX idx_comps_project_name ON comps(project_name);
CREATE INDEX idx_comps_is_verified ON comps(is_verified);

-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_documents_doc_category ON documents(doc_category);
CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by);

-- Activities table
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_activities_performed_by ON activities(performed_by);
CREATE INDEX idx_activities_activity_date ON activities(activity_date DESC);
CREATE INDEX idx_activities_type ON activities(activity_type);
CREATE INDEX idx_activities_status ON activities(status);
CREATE INDEX idx_activities_priority ON activities(priority);

-- Intelligence briefs
CREATE TABLE intelligence_briefs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brief_date DATE NOT NULL,
    market_scope VARCHAR(100) NOT NULL DEFAULT 'bengaluru_india',
    content JSONB NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (brief_date, market_scope)
);

CREATE INDEX idx_intelligence_briefs_date_scope ON intelligence_briefs(brief_date, market_scope);

-- Market notes
CREATE TABLE market_notes (
    section VARCHAR(50) PRIMARY KEY,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_notes_section ON market_notes(section);

-- Verified market transactions
CREATE TABLE market_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    ON market_transactions (fiscal_year, quarter, quantum_inr_mn, LOWER(COALESCE(buyer, '')));
CREATE INDEX idx_mktxn_fy ON market_transactions(fiscal_year);
CREATE INDEX idx_mktxn_type ON market_transactions(deal_type);
CREATE INDEX idx_mktxn_city ON market_transactions(city);

-- Micro-market benchmarks
CREATE TABLE micro_market_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    UNIQUE (city, micro_market)
);

CREATE INDEX idx_mmb_city ON micro_market_benchmarks(city);

-- Document extraction history
CREATE TABLE document_extractions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_document_extractions_deal_id ON document_extractions(deal_id);
CREATE INDEX idx_document_extractions_status ON document_extractions(extraction_status);
CREATE INDEX idx_document_extractions_doc_type ON document_extractions(doc_type);

-- Due diligence checklist items
CREATE TABLE dd_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_dd_items_status ON dd_items(status);
CREATE INDEX idx_dd_items_severity ON dd_items(severity);
CREATE INDEX idx_dd_items_category ON dd_items(category);

-- Approval tracker items
CREATE TABLE approval_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_approval_items_status ON approval_items(status);
CREATE INDEX idx_approval_items_approval_type ON approval_items(approval_type);

-- Deal-level risk flags
CREATE TABLE risk_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_risk_flags_status ON risk_flags(status);
CREATE INDEX idx_risk_flags_severity ON risk_flags(severity);
CREATE INDEX idx_risk_flags_category ON risk_flags(category);

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

CREATE POLICY properties_select_all ON properties FOR SELECT USING (true);
CREATE POLICY deals_select_all ON deals FOR SELECT USING (true);
CREATE POLICY financials_select_all ON financials FOR SELECT USING (true);
CREATE POLICY comps_select_all ON comps FOR SELECT USING (true);
CREATE POLICY documents_select_all ON documents FOR SELECT USING (true);
CREATE POLICY activities_select_all ON activities FOR SELECT USING (true);
CREATE POLICY intelligence_briefs_select_all ON intelligence_briefs FOR SELECT USING (true);
CREATE POLICY market_notes_select_all ON market_notes FOR SELECT USING (true);
CREATE POLICY market_transactions_select_all ON market_transactions FOR SELECT USING (true);
CREATE POLICY micro_market_benchmarks_select_all ON micro_market_benchmarks FOR SELECT USING (true);
CREATE POLICY deal_stage_history_select_all ON deal_stage_history FOR SELECT USING (true);
CREATE POLICY document_extractions_select_all ON document_extractions FOR SELECT USING (true);
CREATE POLICY dd_items_select_all ON dd_items FOR SELECT USING (true);
CREATE POLICY approval_items_select_all ON approval_items FOR SELECT USING (true);
CREATE POLICY risk_flags_select_all ON risk_flags FOR SELECT USING (true);

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
