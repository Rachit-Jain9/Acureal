-- REDIP financial: scenario snapshots + waterfall distributions
--
-- Moves two pieces of analytical state out of the opaque financials.model_params
-- JSON blob into first-class, query-able tables:
--
--   1. financial_scenarios     — Base / Bull / Bear scenario rows per deal snapshot
--   2. waterfall_distributions — JDA / JV waterfall results per deal
--
-- Both tables are organization-scoped with RLS matching the `financials` table.
-- organization_id is set explicitly by the backend services on insert (via
-- `(SELECT organization_id FROM deals WHERE id = $1)` subquery) so this
-- migration contains NO plpgsql trigger functions — the Supabase SQL editor
-- mis-parses `$$ ... NEW.x ... $$` bodies. Safe to re-run.

-- ── financial_scenarios ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_scenarios (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id          UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  organization_id  UUID,
  scenario         VARCHAR(32) NOT NULL,
  label            VARCHAR(100),
  revenue_multiplier  NUMERIC(6,4),
  cost_multiplier     NUMERIC(6,4),
  duration_multiplier NUMERIC(6,4),
  irr_pct             NUMERIC(10,4),
  npv_cr              NUMERIC(18,4),
  equity_multiple     NUMERIC(10,4),
  gross_margin_pct    NUMERIC(10,4),
  total_revenue_cr    NUMERIC(18,4),
  total_cost_cr       NUMERIC(18,4),
  kpis             JSONB NOT NULL DEFAULT '{}'::jsonb,
  inputs           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (deal_id, scenario)
);

CREATE INDEX IF NOT EXISTS idx_financial_scenarios_deal     ON financial_scenarios(deal_id);
CREATE INDEX IF NOT EXISTS idx_financial_scenarios_org_deal ON financial_scenarios(organization_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_financial_scenarios_scenario ON financial_scenarios(scenario);

UPDATE financial_scenarios fs
SET organization_id = d.organization_id
FROM deals d
WHERE fs.deal_id = d.id AND fs.organization_id IS NULL;

ALTER TABLE financial_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_scenarios_org_scope ON financial_scenarios;
CREATE POLICY financial_scenarios_org_scope ON financial_scenarios
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ── waterfall_distributions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS waterfall_distributions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id          UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  organization_id  UUID,
  kind             VARCHAR(16) NOT NULL,
  inputs           JSONB NOT NULL DEFAULT '{}'::jsonb,
  result           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (deal_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_waterfall_distributions_deal     ON waterfall_distributions(deal_id);
CREATE INDEX IF NOT EXISTS idx_waterfall_distributions_org_deal ON waterfall_distributions(organization_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_waterfall_distributions_kind    ON waterfall_distributions(kind);

UPDATE waterfall_distributions wd
SET organization_id = d.organization_id
FROM deals d
WHERE wd.deal_id = d.id AND wd.organization_id IS NULL;

ALTER TABLE waterfall_distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waterfall_distributions_org_scope ON waterfall_distributions;
CREATE POLICY waterfall_distributions_org_scope ON waterfall_distributions
  FOR ALL USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
