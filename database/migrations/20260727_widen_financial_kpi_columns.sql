-- ─────────────────────────────────────────────────────────────────────────────
-- 20260727_widen_financial_kpi_columns.sql
--
-- WHY: POST /api/financials/:dealId/calculate 500'd with Postgres 22003
-- "numeric field overflow" on a plotted-development deal whose deterministic
-- kernel produced a mathematically real but enormous annualised IRR
-- (front-loaded plot sales vs a small month-0 land outflow → monthly IRR
-- >100%, annualised via (1+r)^12−1). financials.irr_pct was DECIMAL(8,4)
-- (max ±9,999.9999) — the raw kernel value could not be stored.
--
-- Widen every returns-ratio/percentage KPI column on financials and
-- financial_scenarios to NUMERIC(12,4) (max ±99,999,999.9999). Values beyond
-- even this range persist as NULL via the service-layer fit-or-NULL guard
-- (backend/src/utils/numericColumnBounds.js) — the raw value always survives
-- in model_params.kpis JSONB and the HMAC-signed audit record. The service
-- introspects live column widths, so it behaves correctly whether or not this
-- migration has been applied (no deploy-order coupling).
--
-- Metadata-only change: increasing NUMERIC precision at the same scale does
-- not rewrite the table. Idempotent + paste-safe in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE financials
  ALTER COLUMN irr_pct            TYPE NUMERIC(12,4),
  ALTER COLUMN equity_multiple    TYPE NUMERIC(12,4),
  ALTER COLUMN yield_on_cost_pct  TYPE NUMERIC(12,4),
  ALTER COLUMN dscr               TYPE NUMERIC(12,4),
  ALTER COLUMN gross_margin_pct   TYPE NUMERIC(12,4);

ALTER TABLE financial_scenarios
  ALTER COLUMN irr_pct            TYPE NUMERIC(12,4),
  ALTER COLUMN equity_multiple    TYPE NUMERIC(12,4),
  ALTER COLUMN gross_margin_pct   TYPE NUMERIC(12,4);

COMMIT;
