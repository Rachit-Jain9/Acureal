-- ─────────────────────────────────────────────────────────────────────────────
-- 20260727_widen_financial_kpi_columns.sql  (v2 — drops/recreates deal_summary)
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
-- v2: Postgres refuses to ALTER a column a view reads (error 0A000), and the
-- deal_summary view reads financials.irr_pct + gross_margin_pct. So we drop
-- the view, widen the columns, and recreate the view EXACTLY as it exists in
-- production today (definition, security_invoker=true from migration
-- 20260430, and role grants captured live on 2026-07-16). Nothing else
-- depends on these columns or on deal_summary (verified via pg_depend).
--
-- All inside ONE transaction: if any step fails, nothing changes.
-- Idempotent + paste-safe in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

DROP VIEW IF EXISTS public.deal_summary;

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

-- Recreate deal_summary byte-for-byte as captured from production
-- (pg_get_viewdef, 2026-07-16). security_invoker=true is REQUIRED: it makes
-- the view run with the caller's permissions so RLS on deals/financials
-- keeps applying (migration 20260430) — omitting it would silently bypass
-- row-level security through the view.
CREATE VIEW public.deal_summary
WITH (security_invoker = true) AS
 SELECT d.id,
    d.name AS deal_name,
    d.deal_type,
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
  WHERE d.is_archived = false;

-- Restore the grants exactly as they existed before the drop (Supabase
-- default-privilege set, captured live).
GRANT ALL ON public.deal_summary TO anon, authenticated, service_role;

COMMIT;
