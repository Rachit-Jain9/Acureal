-- 20260617_karnataka_rera_tracker.sql
--
-- Phase 1 / Pillar 6 — Live K-RERA Project Tracker + Promoter Track-Record DB.
--
-- Three reference tables under the regulatory_data schema (consistent with
-- BBMP UAV + bengaluru_micro_markets). Together they form the K-RERA mirror
-- REDIP keeps fresh against rera.karnataka.gov.in/viewAllProjects:
--
--   • karnataka_rera_projects         — one row per K-RERA-registered project
--                                       (PRM/KA/RERA/... ID + promoter +
--                                       asset class + locality + dates +
--                                       status). Drives the supply-pipeline
--                                       signal for Pillar 1 + the Best Use
--                                       Simulator (Pillar 2).
--   • karnataka_rera_quarterly_filings — one row per QPR per project (Form-
--                                        4/5/6 QU). Drives the "avg delivery
--                                        delay" promoter signal.
--   • karnataka_rera_promoter_index   — aggregated per-promoter stats:
--                                       project_count, on-time count,
--                                       avg_delay_months. Computed (not
--                                       scraped) via a stored materialised
--                                       view refresh; queryable in O(1) by
--                                       PromoterProfileCard.
--
-- All three RLS-on, SELECT-for-all-authenticated, no-direct-user-writes
-- (writes via the scraper running with service-role context). Identical
-- posture to the other regulatory_data tables.
--
-- Idempotent: scraper UPSERTs on (rera_project_id) for projects + on
-- (rera_project_id, quarter_label) for filings; promoter_index is refreshed
-- via REFRESH MATERIALIZED VIEW CONCURRENTLY.
--
-- Operator action required: apply via Supabase SQL editor.
--   🌐 https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
--   📋 paste this file → Run → expect "Success. No rows returned."

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
--  Table 1 — karnataka_rera_projects
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_data.karnataka_rera_projects (
  rera_project_id        TEXT PRIMARY KEY,         -- e.g. PRM/KA/RERA/1251/446/PR/180120/000123
  project_name           TEXT,
  promoter_name          TEXT,                     -- raw scraped text — fuzzy-matched in P1-PR6
  promoter_entity_type   TEXT,                     -- 'individual' / 'partnership' / 'llp' / 'private_limited' / 'public_limited' / 'trust'
  city                   TEXT,                     -- usually 'Bengaluru' for our scope
  district               TEXT,                     -- BBMP / BMRDA / BMICAPA / Other
  locality_text          TEXT,                     -- free-text locality as published — we match to bengaluru_micro_markets.locality_code in app code
  locality_code          TEXT,                     -- nullable; populated when we can map to one of the 20 seeded micro-markets
  asset_class            TEXT,                     -- 'residential_apartments' / 'plotted_development' / 'commercial_office' / 'retail' / 'industrial_warehousing' / 'hospitality' / 'mixed_use'
  total_units            INTEGER,
  total_carpet_area_sqft NUMERIC(12, 2),
  total_saleable_sqft    NUMERIC(12, 2),
  registration_date      DATE,
  proposed_completion    DATE,
  actual_completion      DATE,
  status                 TEXT,                     -- 'registered' / 'extended' / 'completed' / 'lapsed' / 'revoked' / 'withdrawn'
  source_url             TEXT,                     -- portal-deep-link to the project page
  raw_payload            JSONB,                    -- full scraped payload for audit + future re-parsing without re-scraping
  scrape_run_id          TEXT,                     -- which weekly run produced this row (for tracing freshness)
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS k_rera_projects_by_locality
  ON regulatory_data.karnataka_rera_projects (locality_code, asset_class)
  WHERE locality_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS k_rera_projects_by_promoter
  ON regulatory_data.karnataka_rera_projects (promoter_name);
CREATE INDEX IF NOT EXISTS k_rera_projects_by_status
  ON regulatory_data.karnataka_rera_projects (status);
CREATE INDEX IF NOT EXISTS k_rera_projects_by_registration_date
  ON regulatory_data.karnataka_rera_projects (registration_date DESC);
-- Trigram index for fuzzy promoter matching (P1-PR6 will join on this).
CREATE INDEX IF NOT EXISTS k_rera_projects_promoter_trgm
  ON regulatory_data.karnataka_rera_projects USING gin (promoter_name gin_trgm_ops);

ALTER TABLE regulatory_data.karnataka_rera_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.karnataka_rera_projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS k_rera_projects_read ON regulatory_data.karnataka_rera_projects;
CREATE POLICY k_rera_projects_read
  ON regulatory_data.karnataka_rera_projects
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS k_rera_projects_no_user_write ON regulatory_data.karnataka_rera_projects;
CREATE POLICY k_rera_projects_no_user_write
  ON regulatory_data.karnataka_rera_projects
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- ─────────────────────────────────────────────────────────────────────────
--  Table 2 — karnataka_rera_quarterly_filings
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_data.karnataka_rera_quarterly_filings (
  id                     BIGSERIAL PRIMARY KEY,
  rera_project_id        TEXT NOT NULL
                            REFERENCES regulatory_data.karnataka_rera_projects(rera_project_id)
                            ON DELETE CASCADE,
  quarter_label          TEXT NOT NULL,            -- e.g. 'FY25-Q1', 'FY24-Q4'
  filing_date            DATE,
  status                 TEXT,                     -- 'filed' / 'late' / 'missing' / 'extension_granted'
  form_type              TEXT,                     -- 'Form-4(QU)' / 'Form-5(QU)' / 'Form-6(QU)' / 'Modification' — Karnataka-specific naming
  physical_progress_pct  NUMERIC(5, 2),            -- when published
  financial_progress_pct NUMERIC(5, 2),            -- when published
  proposed_completion_in_filing DATE,              -- the date the promoter CURRENTLY claims completion will hit (drift = delivery delay)
  source_url             TEXT,
  raw_payload            JSONB,
  scrape_run_id          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (rera_project_id, quarter_label, form_type)
);

CREATE INDEX IF NOT EXISTS k_rera_qpr_by_project
  ON regulatory_data.karnataka_rera_quarterly_filings (rera_project_id, filing_date DESC);

ALTER TABLE regulatory_data.karnataka_rera_quarterly_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.karnataka_rera_quarterly_filings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS k_rera_qpr_read ON regulatory_data.karnataka_rera_quarterly_filings;
CREATE POLICY k_rera_qpr_read
  ON regulatory_data.karnataka_rera_quarterly_filings
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS k_rera_qpr_no_user_write ON regulatory_data.karnataka_rera_quarterly_filings;
CREATE POLICY k_rera_qpr_no_user_write
  ON regulatory_data.karnataka_rera_quarterly_filings
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- ─────────────────────────────────────────────────────────────────────────
--  View — karnataka_rera_promoter_index
--
--  Aggregated per-promoter stats: project_count, delivered count, average
--  declared-vs-actual delivery slippage. Implemented as a regular VIEW
--  (not materialised) at MVP — at the projected volume (thousands of rows,
--  not millions) the on-the-fly aggregation is cheap and we avoid the
--  refresh-cron complexity. Can flip to MATERIALIZED VIEW + scheduled
--  refresh later if perf demands.
--
--  Used by promoter fuzzy-match in P1-PR6 (separate PR).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW regulatory_data.karnataka_rera_promoter_index AS
WITH promoter_projects AS (
  SELECT
    promoter_name,
    rera_project_id,
    status,
    registration_date,
    proposed_completion,
    actual_completion,
    -- Delivery delay in months — only computed when both dates exist.
    -- NULL when the project is still under construction.
    CASE
      WHEN actual_completion IS NOT NULL AND proposed_completion IS NOT NULL THEN
        EXTRACT(YEAR FROM age(actual_completion, proposed_completion)) * 12
        + EXTRACT(MONTH FROM age(actual_completion, proposed_completion))
      ELSE NULL
    END AS delivery_delay_months
  FROM regulatory_data.karnataka_rera_projects
  WHERE promoter_name IS NOT NULL AND length(trim(promoter_name)) > 0
)
SELECT
  promoter_name,
  COUNT(*)                                          AS total_projects,
  COUNT(*) FILTER (WHERE status = 'completed')      AS completed_projects,
  COUNT(*) FILTER (WHERE status IN ('registered', 'extended')) AS ongoing_projects,
  COUNT(*) FILTER (WHERE status = 'lapsed')         AS lapsed_projects,
  COUNT(*) FILTER (WHERE actual_completion IS NOT NULL
                     AND proposed_completion IS NOT NULL
                     AND actual_completion <= proposed_completion + INTERVAL '60 days')
                                                    AS delivered_on_time,
  AVG(delivery_delay_months) FILTER (WHERE delivery_delay_months IS NOT NULL)
                                                    AS avg_delivery_delay_months,
  MIN(registration_date)                            AS earliest_registration,
  MAX(registration_date)                            AS latest_registration
FROM promoter_projects
GROUP BY promoter_name;

-- Helper to ask "does X promoter look familiar?" with trigram-similar match
-- — used by P1-PR6 to surface candidates to the operator when a deal's
-- promoter name doesn't exact-match anything in the index.
CREATE INDEX IF NOT EXISTS k_rera_promoter_trgm_lookup
  ON regulatory_data.karnataka_rera_projects USING gin ((lower(promoter_name)) gin_trgm_ops);

COMMIT;
