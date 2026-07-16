'use strict';

/**
 * Fit-or-NULL guard for persisting kernel output into NUMERIC(p,s) columns.
 *
 * WHY: the deterministic kernel intentionally emits raw, unclamped values —
 * a plotted deal with front-loaded sales against a small month-0 outflow can
 * legitimately annualise to an IRR in the 10^5–10^9 percent range. Postgres
 * rejects any value that does not fit the column's declared precision with
 * 22003 "numeric field overflow", which used to 500 the whole Calculate.
 *
 * POLICY (CLAUDE.md: never fabricate financial facts): a value that cannot be
 * represented in its column is persisted as NULL — never clamped, never
 * rounded into range. Nothing is lost: the raw KPI set always survives in
 * model_params.kpis JSONB and in the HMAC-signed audit record, and the API
 * response returns the raw computed payload alongside the row.
 *
 * MIGRATION TOLERANCE: column widths are introspected from the live database
 * (information_schema) and cached briefly, with the narrowest schema ever
 * shipped as the fallback. The code therefore works BEFORE and AFTER the
 * 20260727_widen_financial_kpi_columns migration with no deploy-order
 * coupling: pre-migration, out-of-range KPIs store NULL instead of 500ing;
 * post-migration, the wider headroom is picked up automatically.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'numericColumnBounds' });

// Narrowest widths ever shipped for these columns (database/schema.sql before
// migration 20260727). Fit-or-NULL against these is always safe: any value
// that fits the narrow width also fits a widened column.
const FALLBACK_BOUNDS = Object.freeze({
  financials: Object.freeze({
    land_cost_cr: [15, 4],
    plot_area_sqft: [15, 2],
    fsi: [5, 2],
    loading_factor: [5, 4],
    construction_cost_per_sqft: [10, 2],
    selling_rate_per_sqft: [10, 2],
    approval_cost_cr: [15, 4],
    marketing_cost_pct: [5, 2],
    finance_cost_pct: [5, 2],
    developer_margin_pct: [5, 2],
    gross_area_sqft: [15, 2],
    saleable_area_sqft: [15, 2],
    carpet_area_sqft: [15, 2],
    super_builtup_area_sqft: [15, 2],
    total_construction_cost_cr: [15, 4],
    gst_cost_cr: [15, 4],
    stamp_duty_cr: [15, 4],
    marketing_cost_cr: [15, 4],
    finance_cost_cr: [15, 4],
    total_cost_cr: [15, 4],
    total_revenue_cr: [15, 4],
    gross_profit_cr: [15, 4],
    gross_margin_pct: [7, 4],
    developer_profit_cr: [15, 4],
    noi_cr: [15, 4],
    yield_on_cost_pct: [8, 4],
    exit_value_cr: [15, 4],
    entry_value_cr: [15, 4],
    dscr: [8, 4],
    stabilized_noi_cr: [15, 4],
    npv_cr: [15, 4],
    irr_pct: [8, 4],
    residual_land_value_cr: [15, 4],
    equity_multiple: [8, 4],
    discount_rate_pct: [5, 2],
  }),
  financial_scenarios: Object.freeze({
    revenue_multiplier: [6, 4],
    cost_multiplier: [6, 4],
    duration_multiplier: [6, 4],
    irr_pct: [10, 4],
    npv_cr: [18, 4],
    equity_multiple: [10, 4],
    gross_margin_pct: [10, 4],
    total_revenue_cr: [18, 4],
    total_cost_cr: [18, 4],
  }),
});

const BOUND_TABLES = Object.keys(FALLBACK_BOUNDS);
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedBounds = null;
let cachedAt = 0;
let warnedIntrospectionFailure = false;

const cloneFallback = () => {
  const clone = {};
  for (const table of BOUND_TABLES) clone[table] = { ...FALLBACK_BOUNDS[table] };
  return clone;
};

/**
 * Live column widths for the KPI tables, merged over the fallback so a column
 * missing from the introspection result still has safe bounds. Cached for
 * CACHE_TTL_MS on success; a failed introspection falls back WITHOUT caching,
 * so a transient error never pins stale bounds for the process lifetime.
 */
const getNumericColumnBounds = async () => {
  if (cachedBounds && Date.now() - cachedAt < CACHE_TTL_MS) return cachedBounds;
  try {
    const result = await query(
      `SELECT table_name, column_name, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1)
          AND data_type = 'numeric'`,
      [BOUND_TABLES],
    );
    const rows = result?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return cloneFallback();
    const bounds = cloneFallback();
    for (const row of rows) {
      const precision = Number(row.numeric_precision);
      const scale = Number(row.numeric_scale);
      if (bounds[row.table_name] && Number.isFinite(precision) && Number.isFinite(scale)) {
        bounds[row.table_name][row.column_name] = [precision, scale];
      }
    }
    cachedBounds = bounds;
    cachedAt = Date.now();
    return bounds;
  } catch (err) {
    if (!warnedIntrospectionFailure) {
      warnedIntrospectionFailure = true;
      log.warn({ err: err.message }, 'column-width introspection failed; using fallback bounds');
    }
    return cloneFallback();
  }
};

/**
 * Fit a value into NUMERIC(precision, scale): returns the value (coerced to a
 * number) if it is representable after Postgres rounds it to `scale`, else
 * NULL. The value itself is never altered beyond that coercion — an
 * unrepresentable financial fact is omitted, not clamped into range.
 */
const fitNumeric = (value, precision, scale) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const factor = 10 ** scale;
  const rounded = Math.round(num * factor) / factor;
  return Math.abs(rounded) < 10 ** (precision - scale) ? num : null;
};

/**
 * Fit `value` against the introspected width of `table.column`. Unknown
 * columns (no live or fallback bounds) only get the finiteness guard.
 */
const fitToColumn = (bounds, table, column, value) => {
  const b = bounds?.[table]?.[column] || FALLBACK_BOUNDS[table]?.[column];
  if (!b) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return fitNumeric(value, b[0], b[1]);
};

// Test-only: reset the cache so introspection behavior is deterministic.
const __resetBoundsCache = () => {
  cachedBounds = null;
  cachedAt = 0;
  warnedIntrospectionFailure = false;
};

module.exports = {
  FALLBACK_BOUNDS,
  getNumericColumnBounds,
  fitNumeric,
  fitToColumn,
  __resetBoundsCache,
};
