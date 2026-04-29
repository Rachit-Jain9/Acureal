'use strict';

/**
 * T8 — Cross-deal locality intelligence.
 *
 * Compounds within-tenant knowledge: when one deal in a locality has
 * approved guidance values, verified parcel snapshots, or recurring red
 * flags, future deals in the same locality see all of that signal up
 * front — with attribution back to the originating deal.
 *
 * Scope (hard rules):
 *   - **Tenant-scoped only.** Every query goes through current_organization_id()
 *     so funds never see each other's data. Public global reference rows
 *     (org_id IS NULL) — like the seeded RMP 2031 FAR rules — are excluded
 *     to avoid double-counting them as "your prior signal."
 *   - **No fabrication.** Every aggregated signal is sourced from a real row
 *     (guidance_value, snapshot, evidence_link). Empty locality = empty
 *     payload, never a synthesised baseline.
 *   - **Read-only.** This service never writes — it composes a view of what
 *     other services already wrote.
 *
 * Returns null when locality is missing/empty. Caller should treat null as
 * "no locality context available, skip the card."
 */

const { query } = require('../config/database');

const MAX_DEALS_LISTED = 5;
const MAX_FLAGS_LISTED = 3;

const normaliseLocality = (s) => {
  if (!s) return null;
  const trimmed = String(s).trim().toLowerCase();
  return trimmed.length >= 2 ? trimmed : null;
};

/**
 * Aggregate every signal we already have about a locality across the
 * authenticated tenant's deals + properties + snapshots.
 *
 * @param {Object} args
 * @param {string} args.locality      Free-text locality (e.g. "Hebbal", "Whitefield Phase II")
 * @param {string=} args.city         Optional city filter (defaults to all cities — Bengaluru is the typical scope)
 * @param {string=} args.excludePropertyId  Property to exclude from peer-deal counts (the current property)
 * @returns {Promise<Object|null>}
 */
const getLocalityIntelligence = async ({ locality, city = null, excludePropertyId = null } = {}) => {
  const lc = normaliseLocality(locality);
  if (!lc) return null;

  // Single round-trip: each signal is its own CTE so we can compose the
  // payload in JS without nine separate queries. pg_trgm makes the locality
  // similarity match cheap (already indexed on guidance_values).
  const sql = `
    WITH params AS (
      SELECT
        $1::text AS locality_lc,
        $2::text AS city_filter,
        $3::uuid AS exclude_property
    ),
    -- Deals whose property has a matching locality string (city/state/address).
    -- We're looking for "where else in this locality have we worked before."
    matching_properties AS (
      SELECT
        p.id              AS property_id,
        p.name,
        p.address,
        p.city,
        p.locality,
        d.id              AS deal_id,
        d.name            AS deal_name,
        d.stage,
        d.is_archived,
        d.updated_at
      FROM properties p
      LEFT JOIN deals d ON d.property_id = p.id
      WHERE p.organization_id = current_organization_id()
        AND (
          LOWER(COALESCE(p.locality, '')) LIKE '%' || (SELECT locality_lc FROM params) || '%'
          OR LOWER(COALESCE(p.address,  '')) LIKE '%' || (SELECT locality_lc FROM params) || '%'
        )
        AND ((SELECT city_filter FROM params) IS NULL OR LOWER(COALESCE(p.city, '')) = LOWER((SELECT city_filter FROM params)))
        AND (p.id <> COALESCE((SELECT exclude_property FROM params), '00000000-0000-0000-0000-000000000000'::uuid))
    ),
    -- Approved guidance values keyed by the same locality.
    guidance AS (
      SELECT
        gv.id,
        gv.locality,
        gv.road_name,
        gv.value_inr_per_sqft,
        gv.value_inr_per_acre,
        gv.effective_from,
        gv.review_status,
        gv.created_at,
        gv.updated_at
      FROM regulatory_data.guidance_values gv
      WHERE gv.org_id = current_organization_id()
        AND gv.review_status = 'approved'
        AND LOWER(COALESCE(gv.locality, '')) LIKE '%' || (SELECT locality_lc FROM params) || '%'
    ),
    -- Approved evidence sources whose source_title or city mentions this
    -- locality. evidence_sources doesn't carry a dedicated locality column;
    -- we match conservatively on the title text + city filter so we only
    -- include sources clearly relevant to this neighbourhood.
    evidence AS (
      SELECT
        es.id,
        es.source_kind,
        es.authority_name,
        es.confidence_score,
        es.review_status,
        es.created_at
      FROM regulatory_data.evidence_sources es
      WHERE es.org_id = current_organization_id()
        AND es.review_status = 'approved'
        AND LOWER(COALESCE(es.source_title, '')) LIKE '%' || (SELECT locality_lc FROM params) || '%'
        AND ((SELECT city_filter FROM params) IS NULL OR LOWER(COALESCE(es.city, '')) = LOWER((SELECT city_filter FROM params)))
    ),
    -- Latest parcel snapshots per peer property in the locality. We unnest
    -- their red_flags so we can rank common locality-wide concerns.
    peer_snapshots AS (
      SELECT DISTINCT ON (s.property_id)
        s.property_id,
        s.generated_at,
        s.output_json
      FROM regulatory_data.parcel_intelligence_snapshots s
      JOIN matching_properties mp ON mp.property_id = s.property_id
      WHERE s.org_id = current_organization_id()
      ORDER BY s.property_id, s.generated_at DESC
    ),
    flag_counts AS (
      SELECT
        flag->>'label' AS label,
        flag->>'severity' AS severity,
        COUNT(*)::int AS count
      FROM peer_snapshots ps,
           LATERAL jsonb_array_elements(COALESCE(ps.output_json->'red_flags', '[]'::jsonb)) AS flag
      GROUP BY flag->>'label', flag->>'severity'
    )
    SELECT
      (SELECT json_agg(mp.* ORDER BY mp.updated_at DESC NULLS LAST) FROM matching_properties mp) AS properties,
      (SELECT json_agg(g.* ORDER BY g.effective_from DESC NULLS LAST, g.updated_at DESC) FROM guidance g) AS guidance,
      (SELECT json_agg(e.* ORDER BY e.created_at DESC) FROM evidence e) AS evidence,
      (SELECT json_agg(fc.* ORDER BY fc.count DESC, fc.label ASC) FROM flag_counts fc) AS flag_counts;
  `;

  const result = await query(sql, [lc, city, excludePropertyId]);
  const row = result.rows[0] || {};

  const properties = row.properties || [];
  const guidance = row.guidance || [];
  const evidence = row.evidence || [];
  const flagCounts = row.flag_counts || [];

  // Empty result is a *valid* response — surfaced by the UI as "first deal
  // in this locality" empty state. Don't synthesise filler data.
  if (
    properties.length === 0 &&
    guidance.length === 0 &&
    evidence.length === 0 &&
    flagCounts.length === 0
  ) {
    return {
      locality,
      city,
      empty: true,
      deals_count: 0,
      guidance_summary: null,
      evidence_summary: null,
      common_red_flags: [],
      peer_deals: [],
    };
  }

  const guidanceValues = guidance
    .map((g) => Number(g.value_inr_per_sqft))
    .filter((v) => Number.isFinite(v) && v > 0);

  return {
    locality,
    city,
    empty: false,
    deals_count: properties.filter((p) => p.deal_id).length,
    properties_count: properties.length,
    last_activity_at:
      properties.length > 0 ? properties[0].updated_at : (guidance[0]?.updated_at || null),

    guidance_summary: guidance.length > 0
      ? {
          count: guidance.length,
          min_inr_per_sqft: guidanceValues.length ? Math.min(...guidanceValues) : null,
          max_inr_per_sqft: guidanceValues.length ? Math.max(...guidanceValues) : null,
          latest_effective_from: guidance[0]?.effective_from || null,
          latest_locality: guidance[0]?.locality || null,
        }
      : null,

    evidence_summary: evidence.length > 0
      ? {
          count: evidence.length,
          sources: evidence.slice(0, 3).map((e) => ({
            id: e.id,
            kind: e.source_kind,
            authority: e.authority_name,
            confidence: e.confidence_score ? Number(e.confidence_score) : null,
          })),
        }
      : null,

    common_red_flags: flagCounts.slice(0, MAX_FLAGS_LISTED),

    peer_deals: properties
      .filter((p) => p.deal_id && !p.is_archived)
      .slice(0, MAX_DEALS_LISTED)
      .map((p) => ({
        deal_id: p.deal_id,
        deal_name: p.deal_name,
        property_id: p.property_id,
        property_name: p.name,
        stage: p.stage,
        updated_at: p.updated_at,
      })),
  };
};

module.exports = {
  getLocalityIntelligence,
};
