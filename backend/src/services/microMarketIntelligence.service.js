'use strict';

/**
 * Micro-Market Intelligence Layer service — Phase 1 / Pillar 1.
 *
 * Reads the Bengaluru reference set + per-(locality, asset_class, metric)
 * benchmarks + per-(locality, asset_class, signal) demand drivers.
 *
 * Three public surfaces:
 *
 *   1. `classifyParcel(lat, lng)` — Haversine-nearest-centroid lookup against
 *      the 20 Bengaluru micro-markets. Returns `{ locality_code, name,
 *      distance_km, tier, confidence }`. `confidence: 'high'` when the parcel
 *      is inside the radius; `'medium'` when within 2× radius (border cases);
 *      `null` when the parcel is far from any seeded micro-market (e.g. a
 *      Bengaluru rural deal we don't have ref data for — surface that
 *      honestly, don't snap to the wrong locality).
 *
 *   2. `getBriefing(locality_code, { assetClass? })` — composes the full
 *      briefing payload for the Overview panel: micro-market record +
 *      benchmarks per asset class + demand signals + freshness.
 *
 *   3. `getDefaultsForDealCreate(localityCode, assetClass)` — returns
 *      sensible defaults the deal-create form can pre-fill (sale rate, rent,
 *      cap rate). Always carries confidence + source so the UI can render
 *      a "(median for Whitefield, Knight Frank Q1 2026)" hint.
 *
 * Migration-tolerant: if the migration hasn't run, every read returns the
 * empty-state shape — no throws, no broken renders.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'microMarketIntelligence.service' });

const PG_UNDEFINED_TABLE = '42P01';
const PG_UNDEFINED_SCHEMA = '3F000';

const isMissingTable = (err) =>
  Boolean(err) && (err.code === PG_UNDEFINED_TABLE || err.code === PG_UNDEFINED_SCHEMA);

// ─────────────────────────────────────────────────────────────────────────────
//  Geo helpers
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Haversine distance in km between two lat/lng points.
 * Deterministic. No external dependency.
 */
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public surfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a parcel (lat, lng) into a Bengaluru micro-market.
 * Returns the nearest locality + confidence ('high' | 'medium' | null).
 */
const classifyParcel = async (lat, lng) => {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return { locality_code: null, name: null, distance_km: null, tier: null, confidence: null };
  }
  let markets;
  try {
    const result = await query(
      `SELECT locality_code, name, tier, centroid_lat, centroid_lng, radius_km
         FROM regulatory_data.bengaluru_micro_markets`,
      [],
    );
    markets = result.rows;
  } catch (err) {
    if (isMissingTable(err)) return { locality_code: null, name: null, distance_km: null, tier: null, confidence: null };
    log.warn('classifyParcel_query_failed', { error: err.message });
    return { locality_code: null, name: null, distance_km: null, tier: null, confidence: null };
  }
  if (!Array.isArray(markets) || markets.length === 0) {
    return { locality_code: null, name: null, distance_km: null, tier: null, confidence: null };
  }

  let nearest = null;
  let nearestDistance = Infinity;
  for (const m of markets) {
    const d = haversineKm(Number(lat), Number(lng), Number(m.centroid_lat), Number(m.centroid_lng));
    if (d < nearestDistance) {
      nearest = m;
      nearestDistance = d;
    }
  }
  if (!nearest) return { locality_code: null, name: null, distance_km: null, tier: null, confidence: null };

  // Confidence policy:
  //   - 'high'   when parcel is inside the locality's radius
  //   - 'medium' when within 2× radius (border case — still useful but flagged)
  //   - null     when far from any seeded micro-market (don't snap to the wrong one)
  const radius = Number(nearest.radius_km) || 2.5;
  let confidence = null;
  if (nearestDistance <= radius) confidence = 'high';
  else if (nearestDistance <= radius * 2) confidence = 'medium';
  // else: leave null — UI shows "Bengaluru outside seeded micro-markets"

  return {
    locality_code: nearest.locality_code,
    name: nearest.name,
    tier: nearest.tier,
    distance_km: Math.round(nearestDistance * 100) / 100,
    confidence,
  };
};

/**
 * Compose the briefing payload for a locality. Used by the workspace
 * `/deals/:id/micro-market-briefing` route and the deal-create form's
 * defaults endpoint.
 *
 * Returns the empty-state shape if the locality is unknown or the migration
 * hasn't run yet — never throws.
 */
const getBriefing = async (localityCode, { assetClass = null } = {}) => {
  if (!localityCode) {
    return { locality: null, benchmarks: [], demand_signals: [] };
  }
  try {
    const [localityRes, benchRes, signalsRes] = await Promise.all([
      query(
        `SELECT locality_code, name, tier, parent_zone, centroid_lat, centroid_lng, radius_km, notes
           FROM regulatory_data.bengaluru_micro_markets
          WHERE locality_code = $1`,
        [localityCode],
      ),
      query(
        `SELECT locality_code, asset_class, metric_kind, p25, p50, p75, p95,
                n_observations, confidence, source_ref, source_publication_date,
                last_verified_at, notes
           FROM regulatory_data.micro_market_benchmarks
          WHERE locality_code = $1
            ${assetClass ? 'AND asset_class = $2' : ''}
          ORDER BY asset_class, metric_kind`,
        assetClass ? [localityCode, assetClass] : [localityCode],
      ),
      query(
        `SELECT locality_code, asset_class, signal_kind, value_numeric, value_text,
                unit, confidence, source_ref, last_verified_at, notes
           FROM regulatory_data.micro_market_demand_signals
          WHERE locality_code = $1
            ${assetClass ? 'AND (asset_class = $2 OR asset_class IS NULL)' : ''}
          ORDER BY signal_kind`,
        assetClass ? [localityCode, assetClass] : [localityCode],
      ),
    ]);
    return {
      locality: localityRes.rows[0] || null,
      benchmarks: benchRes.rows,
      demand_signals: signalsRes.rows,
    };
  } catch (err) {
    if (isMissingTable(err)) return { locality: null, benchmarks: [], demand_signals: [] };
    log.warn('getBriefing_query_failed', { error: err.message, locality_code: localityCode });
    return { locality: null, benchmarks: [], demand_signals: [] };
  }
};

/**
 * Defaults for the deal-create form. Picks the headline metric per asset class
 * (sale_rate for residential/villas/plotted, rent for income assets) and
 * returns p50 + confidence + source for the deal-create form's pre-fill.
 *
 * The form must render the "(median for {locality}, {source})" hint so the
 * operator sees where the default came from. Confidence: 'low' must be shown
 * as such — never silently dressed up.
 */
const HEADLINE_METRIC_BY_ASSET_CLASS = {
  residential_apartments: 'sale_rate_per_sqft_inr',
  villas: 'sale_rate_per_sqft_inr',
  mixed_use: 'sale_rate_per_sqft_inr',
  redevelopment: 'sale_rate_per_sqft_inr',
  plotted_development: 'plot_rate_per_sqft_inr',
  commercial_office: 'office_rent_per_sqft_month_inr',
  retail: 'retail_rent_per_sqft_month_inr',
  industrial_warehousing: 'rent_per_sqft_month_inr',
  hospitality: 'cap_rate_pct',
  raw_land: 'plot_rate_per_sqft_inr',
};

const getDefaultsForDealCreate = async (localityCode, assetClass) => {
  if (!localityCode || !assetClass) return null;
  const metric = HEADLINE_METRIC_BY_ASSET_CLASS[assetClass];
  if (!metric) return null;
  try {
    const result = await query(
      `SELECT metric_kind, p25, p50, p75, p95, confidence, source_ref, source_publication_date, last_verified_at
         FROM regulatory_data.micro_market_benchmarks
        WHERE locality_code = $1 AND asset_class = $2 AND metric_kind = $3
        LIMIT 1`,
      [localityCode, assetClass, metric],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      locality_code: localityCode,
      asset_class: assetClass,
      metric: row.metric_kind,
      suggested_value: row.p50,
      band: { p25: row.p25, p75: row.p75 },
      confidence: row.confidence,
      source_ref: row.source_ref,
      source_publication_date: row.source_publication_date,
      last_verified_at: row.last_verified_at,
    };
  } catch (err) {
    if (isMissingTable(err)) return null;
    log.warn('getDefaultsForDealCreate_failed', {
      error: err.message,
      locality_code: localityCode,
      asset_class: assetClass,
    });
    return null;
  }
};

/**
 * List every seeded Bengaluru micro-market — used by the admin UI and as
 * the parcel-classifier fallback for explicit user selection.
 */
const listMicroMarkets = async () => {
  try {
    const result = await query(
      `SELECT locality_code, name, tier, parent_zone, centroid_lat, centroid_lng, radius_km, notes
         FROM regulatory_data.bengaluru_micro_markets
        ORDER BY tier, name`,
      [],
    );
    return result.rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    log.warn('listMicroMarkets_failed', { error: err.message });
    return [];
  }
};

module.exports = {
  classifyParcel,
  getBriefing,
  getDefaultsForDealCreate,
  listMicroMarkets,
  // Exported for unit tests
  haversineKm,
  HEADLINE_METRIC_BY_ASSET_CLASS,
};
