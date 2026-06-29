'use strict';

// Builds the Yield Studio export slice: reads the deal's saved study + parcel
// boundary, recomputes the programme DETERMINISTICALLY via the same engine the
// frontend uses (computeSiteYield), and returns a render-ready slice. No AI in
// any number — the kernel is the sole source.
//
// Study envelope + assumptions are stored UI-shaped (for exact editor restore);
// buildEngineAssumptions converts them to engine shape so the recompute matches
// what the analyst saw. When no study exists, falls back to a screening envelope
// synthesised from the deal/property (land area + FSI), badged accordingly.

const { query } = require('../../config/database');
const { computeSiteYield, resolveFamily } = require('../../utils/siteYield');
const { buildEngineAssumptions } = require('../../utils/yieldStudioInputs');

const isUndefinedTable = (err) =>
  !!err && (err.code === '42P01' || /relation .* does not exist/i.test(err.message || ''));

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function buildSiteYieldSlice({ deal } = {}) {
  if (!deal || !deal.id) return null;

  let study = null;
  let boundary = null;
  try {
    const r = await query(
      `SELECT asset_class, envelope, assumptions, selected_scenario, engine_version, updated_at
         FROM yield_studies
        WHERE deal_id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL
        ORDER BY updated_at DESC LIMIT 1`,
      [deal.id],
    );
    study = r.rows[0] || null;
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
  }
  try {
    if (deal.property_id) {
      const b = await query(
        `SELECT geometry_geojson, area_sqft, source, confidence_score, review_status, updated_at
           FROM parcel_boundaries
          WHERE property_id = $1 AND organization_id = current_organization_id() AND deleted_at IS NULL
          ORDER BY updated_at DESC LIMIT 1`,
        [deal.property_id],
      );
      boundary = b.rows[0] || null;
    }
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
  }

  const assetClass = (study && study.asset_class) || deal.asset_class || null;
  const family = resolveFamily(assetClass);

  let computed = null;
  let mode = null;
  if (study) {
    computed = computeSiteYield({
      assetClass,
      envelope: study.envelope || {},
      assumptions: buildEngineAssumptions(family, study.assumptions || {}),
    });
    mode = 'saved';
  } else {
    const envelope = { landAreaSqft: num(deal.land_area_sqft), effectiveFsi: num(deal.permissible_fsi) };
    if (boundary && num(boundary.area_sqft) != null) envelope.landAreaSqft = num(boundary.area_sqft);
    if (envelope.landAreaSqft != null) {
      computed = computeSiteYield({ assetClass, envelope, assumptions: {} });
      mode = 'screening_defaults';
    }
  }

  // Only surface a section when the recompute actually produced a programme.
  if (!computed || !computed.ok) return null;

  return {
    mode, // 'saved' (analyst's study) | 'screening_defaults' (synthesised)
    computed,
    boundary: boundary
      ? {
          source: boundary.source,
          area_sqft: num(boundary.area_sqft),
          review_status: boundary.review_status,
          confidence_score: num(boundary.confidence_score),
        }
      : null,
    updatedAt: (study && study.updated_at) || null,
  };
}

module.exports = { buildSiteYieldSlice };
