-- Migration: Deal-centric expansion
-- Adds asset_class, deal_structure to deals, plus document_extractions, dd_items, approval_items, risk_flags tables

-- ──────────────────────────────────────────────
-- 1. New columns on deals
-- ──────────────────────────────────────────────
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS asset_class    VARCHAR(50) DEFAULT 'residential_apartments',
  ADD COLUMN IF NOT EXISTS deal_structure VARCHAR(50) DEFAULT 'outright';

-- ──────────────────────────────────────────────
-- 2. document_extractions
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_extractions (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    deal_id            UUID REFERENCES deals(id) ON DELETE CASCADE,
    doc_type           VARCHAR(100),
    extraction_status  VARCHAR(20)  NOT NULL DEFAULT 'pending',
    provider           VARCHAR(50)  NOT NULL DEFAULT 'gemini',
    raw_extraction     JSONB,
    structured_fields  JSONB,
    confidence_scores  JSONB,
    human_corrections  JSONB,
    correction_history JSONB        DEFAULT '[]'::jsonb,
    language_detected  VARCHAR(20),
    pages_processed    INTEGER,
    error_message      TEXT,
    provider_job_id    VARCHAR(255),
    extracted_at       TIMESTAMP WITH TIME ZONE,
    reviewed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at        TIMESTAMP WITH TIME ZONE,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- 3. dd_items
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dd_items (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id      UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    category     VARCHAR(100) NOT NULL,
    item_name    VARCHAR(500) NOT NULL,
    description  TEXT,
    status       VARCHAR(50)  NOT NULL DEFAULT 'pending',
    severity     VARCHAR(50)  NOT NULL DEFAULT 'secondary',
    is_required  BOOLEAN      DEFAULT TRUE,
    document_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
    notes        TEXT,
    assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date     DATE,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- 4. approval_items
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_items (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id            UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    approval_type      VARCHAR(100) NOT NULL,
    name               VARCHAR(500) NOT NULL,
    is_required        BOOLEAN      DEFAULT TRUE,
    is_available       BOOLEAN      DEFAULT FALSE,
    is_uploaded        BOOLEAN      DEFAULT FALSE,
    is_validated       BOOLEAN      DEFAULT FALSE,
    issued_date        DATE,
    expiry_date        DATE,
    reference_number   VARCHAR(255),
    issuing_authority  VARCHAR(255),
    document_id        UUID REFERENCES documents(id) ON DELETE SET NULL,
    status             VARCHAR(50)  NOT NULL DEFAULT 'pending',
    notes              TEXT,
    next_action        TEXT,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- 5. risk_flags
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_flags (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    category    VARCHAR(100) NOT NULL,
    severity    VARCHAR(50)  NOT NULL DEFAULT 'medium',
    title       VARCHAR(500) NOT NULL,
    description TEXT,
    mitigation  TEXT,
    status      VARCHAR(50)  NOT NULL DEFAULT 'open',
    source      VARCHAR(50)  DEFAULT 'manual',
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- 6. Indexes
-- ──────────────────────────────────────────────

-- document_extractions
CREATE INDEX IF NOT EXISTS idx_document_extractions_document_id ON document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_document_extractions_deal_id     ON document_extractions(deal_id);
CREATE INDEX IF NOT EXISTS idx_document_extractions_status      ON document_extractions(extraction_status);
CREATE INDEX IF NOT EXISTS idx_document_extractions_doc_type    ON document_extractions(doc_type);

-- dd_items
CREATE INDEX IF NOT EXISTS idx_dd_items_deal_id  ON dd_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_dd_items_status   ON dd_items(status);
CREATE INDEX IF NOT EXISTS idx_dd_items_severity ON dd_items(severity);
CREATE INDEX IF NOT EXISTS idx_dd_items_category ON dd_items(category);

-- approval_items
CREATE INDEX IF NOT EXISTS idx_approval_items_deal_id       ON approval_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_approval_items_status        ON approval_items(status);
CREATE INDEX IF NOT EXISTS idx_approval_items_approval_type ON approval_items(approval_type);

-- risk_flags
CREATE INDEX IF NOT EXISTS idx_risk_flags_deal_id  ON risk_flags(deal_id);
CREATE INDEX IF NOT EXISTS idx_risk_flags_status   ON risk_flags(status);
CREATE INDEX IF NOT EXISTS idx_risk_flags_severity ON risk_flags(severity);
CREATE INDEX IF NOT EXISTS idx_risk_flags_category ON risk_flags(category);

-- ──────────────────────────────────────────────
-- 7. updated_at triggers
-- ──────────────────────────────────────────────

-- Reuse or create the generic trigger function (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- document_extractions
DROP TRIGGER IF EXISTS trg_document_extractions_updated_at ON document_extractions;
CREATE TRIGGER trg_document_extractions_updated_at
  BEFORE UPDATE ON document_extractions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- dd_items
DROP TRIGGER IF EXISTS trg_dd_items_updated_at ON dd_items;
CREATE TRIGGER trg_dd_items_updated_at
  BEFORE UPDATE ON dd_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- approval_items
DROP TRIGGER IF EXISTS trg_approval_items_updated_at ON approval_items;
CREATE TRIGGER trg_approval_items_updated_at
  BEFORE UPDATE ON approval_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- risk_flags
DROP TRIGGER IF EXISTS trg_risk_flags_updated_at ON risk_flags;
CREATE TRIGGER trg_risk_flags_updated_at
  BEFORE UPDATE ON risk_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
