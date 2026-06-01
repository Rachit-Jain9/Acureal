const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { rankComps, scoreComp } = require('../utils/compSimilarity');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { getPlatformOrgId } = require('../utils/platformOrg');
const { percentile } = require('../utils/percentile');

// Haversine formula to calculate distance between two lat/lng points in km
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const addComp = async (data, userId = null) => {
  const {
    projectName, developer, city, locality, lat, lng,
    projectType, bhkConfig, carpetAreaSqft, superBuiltupAreaSqft,
    ratePerSqft, totalUnits, launchYear, possessionYear,
    reraNumber, amenities, source,
  } = data;

  const result = await query(
    `INSERT INTO comps (
      project_name, developer, city, locality, lat, lng,
      project_type, bhk_config, carpet_area_sqft, super_builtup_area_sqft,
      rate_per_sqft, total_units, launch_year, possession_year,
      rera_number, amenities, source, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    [
      projectName, developer || null, city, locality || null,
      lat || null, lng || null, projectType || 'residential',
      bhkConfig || null, carpetAreaSqft || null,
      superBuiltupAreaSqft || null, ratePerSqft,
      totalUnits || null, launchYear || null, possessionYear || null,
      reraNumber || null, amenities || null, source || null,
      userId,
    ]
  );

  return result.rows[0];
};

// Build the parameterised WHERE clause shared by `getComps` and
// `getCompsForExport`. Returns { conditions, values, paramCount } so
// each caller can append its own pagination clause without duplicating
// the filter logic.
const buildCompsWhere = (filters = {}, platformOrgId = null) => {
  const conditions = [];
  const values = [];
  let paramCount = 1;

  // Visibility: the user's own org plus, optionally, the platform admin's
  // org — which exposes the platform-curated comps catalog to every
  // workspace. Writes (addComp / deleteComp) stay strictly per-org.
  if (platformOrgId) {
    conditions.push(`(organization_id = current_organization_id() OR organization_id = $${paramCount})`);
    values.push(platformOrgId);
    paramCount++;
  } else {
    conditions.push('organization_id = current_organization_id()');
  }

  if (filters.city) {
    conditions.push(`LOWER(city) = LOWER($${paramCount})`);
    values.push(filters.city);
    paramCount++;
  }
  if (filters.locality) {
    conditions.push(`LOWER(locality) ILIKE $${paramCount}`);
    values.push(`%${filters.locality}%`);
    paramCount++;
  }
  if (filters.projectType) {
    conditions.push(`project_type = $${paramCount}`);
    values.push(filters.projectType);
    paramCount++;
  }
  if (filters.minRate) {
    conditions.push(`rate_per_sqft >= $${paramCount}`);
    values.push(filters.minRate);
    paramCount++;
  }
  if (filters.maxRate) {
    conditions.push(`rate_per_sqft <= $${paramCount}`);
    values.push(filters.maxRate);
    paramCount++;
  }
  if (filters.launchYear) {
    conditions.push(`launch_year = $${paramCount}`);
    values.push(filters.launchYear);
    paramCount++;
  }
  if (filters.search) {
    conditions.push(`(project_name ILIKE $${paramCount} OR developer ILIKE $${paramCount})`);
    values.push(`%${filters.search}%`);
    paramCount++;
  }
  return { conditions, values, paramCount };
};

const getComps = async (filters = {}, pagination = {}) => {
  const platformOrgId = await getPlatformOrgId();
  const { conditions, values, paramCount: nextParam } = buildCompsWhere(filters, platformOrgId);
  let paramCount = nextParam;

  const page = parseInt(pagination.page, 10) || 1;
  const limit = Math.min(parseInt(pagination.limit, 10) || 50, 200);
  const offset = (page - 1) * limit;

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM comps WHERE ${whereClause}`,
    values
  );

  const dataResult = await query(
    `SELECT * FROM comps WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...values, limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: {
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit),
    },
  };
};

// comps.project_type is a Postgres enum: residential | commercial | mixed_use.
// Map a deal's asset_class (and optional property_type) onto a VALID enum
// label, or null to skip the filter. Returning an out-of-enum string such as
// 'office' makes Postgres throw `invalid input value for enum project_type`,
// which the read paths were silently swallowing as "0 comps". Mirrors the
// ingestion-side normalizeProjectType so stored + queried types line up.
const COMMERCIAL_COMP_ASSET_CLASSES = new Set([
  'commercial_office', 'retail', 'industrial_warehousing', 'hospitality',
]);
const COMMERCIAL_COMP_PROPERTY_TYPES = new Set([
  'office', 'retail', 'industrial', 'hospitality', 'commercial',
]);
const assetClassToProjectType = (assetClass, propertyType) => {
  const ac = String(assetClass || '').trim().toLowerCase();
  const pt = String(propertyType || '').trim().toLowerCase();
  if (ac === 'mixed_use' || pt === 'mixed_use' || pt === 'mixed-use') return 'mixed_use';
  if (ac === 'raw_land' || ac === 'land') return null;
  if (COMMERCIAL_COMP_ASSET_CLASSES.has(ac) || COMMERCIAL_COMP_PROPERTY_TYPES.has(pt)) return 'commercial';
  return 'residential';
};

const getCompsNearLocation = async (lat, lng, radiusKm = 5, projectType = null) => {
  if (!lat || !lng) {
    throw createError('Latitude and longitude are required.', 400);
  }

  // Using approximate bounding box first for efficiency, then filter with Haversine
  const latDelta = radiusKm / 111; // ~111km per degree latitude
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const platformOrgId = await getPlatformOrgId();
  const conditions = [];
  const values = [];
  let p = 1;

  if (platformOrgId) {
    conditions.push(`(organization_id = current_organization_id() OR organization_id = $${p})`);
    values.push(platformOrgId);
    p++;
  } else {
    conditions.push('organization_id = current_organization_id()');
  }

  conditions.push(
    'lat IS NOT NULL',
    'lng IS NOT NULL',
    `lat BETWEEN $${p} AND $${p + 1}`,
    `lng BETWEEN $${p + 2} AND $${p + 3}`,
  );
  values.push(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta);
  p += 4;

  if (projectType) {
    conditions.push(`project_type = $${p}`);
    values.push(projectType);
    p++;
  }

  const result = await query(
    `SELECT * FROM comps WHERE ${conditions.join(' AND ')}
     ORDER BY rate_per_sqft`,
    values
  );

  // Filter by exact distance and add distance field
  const compsWithDistance = result.rows
    .map((comp) => ({
      ...comp,
      distance_km: Math.round(haversineDistance(lat, lng, comp.lat, comp.lng) * 100) / 100,
    }))
    .filter((comp) => comp.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);

  return compsWithDistance;
};

const getPricingBenchmarks = async (lat, lng, projectType = 'residential', radiusKm = 5) => {
  const nearbyComps = await getCompsNearLocation(lat, lng, radiusKm, projectType);

  if (nearbyComps.length === 0) {
    // Try wider radius
    const widerComps = await getCompsNearLocation(lat, lng, radiusKm * 2, projectType);
    if (widerComps.length === 0) {
      return {
        found: false,
        message: 'No comparable projects found within search radius.',
        radius_km: radiusKm * 2,
        count: 0,
      };
    }
    return computeBenchmarks(widerComps, radiusKm * 2);
  }

  return computeBenchmarks(nearbyComps, radiusKm);
};

const computeBenchmarks = (comps, radiusKm) => {
  const rates = comps.map((c) => parseFloat(c.rate_per_sqft)).filter((r) => r > 0);

  if (rates.length === 0) {
    return { found: false, message: 'No valid pricing data found.', count: 0 };
  }

  rates.sort((a, b) => a - b);

  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const min = rates[0];
  const max = rates[rates.length - 1];
  const median = percentile(rates, 0.5);

  // Percentiles — interpolated (type-7) so small even-sized comp sets aren't
  // biased toward the more expensive comp (see backend/src/utils/percentile.js).
  const p25 = percentile(rates, 0.25);
  const p75 = percentile(rates, 0.75);

  return {
    found: true,
    radius_km: radiusKm,
    count: comps.length,
    benchmarks: {
      avg_rate_per_sqft: Math.round(avg),
      min_rate_per_sqft: min,
      max_rate_per_sqft: max,
      median_rate_per_sqft: Math.round(median),
      p25_rate_per_sqft: Math.round(p25),
      p75_rate_per_sqft: Math.round(p75),
    },
    comps: comps.slice(0, 10), // Return top 10 nearest
  };
};

const deleteComp = async (id) => {
  const result = await query(
    'DELETE FROM comps WHERE id = $1 AND organization_id = current_organization_id() RETURNING id',
    [id]
  );
  if (result.rows.length === 0) {
    throw createError('Comparable not found.', 404);
  }
  return { deleted: true, id };
};

// ──────────────────────────────────────────────────────────────────────────
// Subject ↔ comp similarity
// ──────────────────────────────────────────────────────────────────────────

const loadSubjectForDeal = async (dealId) => {
  const result = await query(
    `SELECT
       d.id                   AS deal_id,
       d.name                 AS deal_name,
       d.asset_class,
       p.id                   AS property_id,
       p.lat,
       p.lng,
       p.city,
       p.land_area_sqft,
       p.land_area_acres,
       p.zoning,
       f.asset_class          AS financial_asset_class,
       -- The financial model stores the assumed selling rate at sqft level —
       -- that's the right benchmark for delta-vs-comp ("are nearby comps
       -- pricier or cheaper than what we're underwriting").
       f.selling_rate_per_sqft AS target_rate_per_sqft,
       f.total_revenue_cr
     FROM deals d
     LEFT JOIN properties p ON p.id = d.property_id
     LEFT JOIN financials f ON f.deal_id = d.id
     WHERE d.id = $1
       AND ${buildVisibleDealCondition('d')}
     LIMIT 1`,
    [dealId]
  );
  return result.rows[0] || null;
};

const buildSubjectFromDealRow = (row) => ({
  deal_id: row.deal_id,
  deal_name: row.deal_name,
  property_id: row.property_id,
  lat: row.lat,
  lng: row.lng,
  city: row.city,
  asset_class: row.asset_class || row.financial_asset_class || null,
  // BHK config / launch_year / total_units / amenities are usually not on a
  // deal in REDIP — keep them null and rely on the comp's BHK side; the
  // similarity scorer drops factors that lack subject data.
  bhk_config: null,
  launch_year: null,
  total_units: null,
  amenities: null,
  target_rate_per_sqft: row.target_rate_per_sqft != null ? Number(row.target_rate_per_sqft) : null,
});

/**
 * Get the top-N comps ranked by similarity to a given deal.
 * `radiusKm` constrains the candidate set; default 8km matches the
 * residential distance saturation in compSimilarity.
 */
const getRankedCompsForDeal = async (dealId, { radiusKm = 8, limit = 25 } = {}) => {
  const subjectRow = await loadSubjectForDeal(dealId);
  if (!subjectRow) {
    throw createError('Deal not found.', 404);
  }
  if (subjectRow.lat == null || subjectRow.lng == null) {
    return {
      subject: buildSubjectFromDealRow(subjectRow),
      ranked: [],
      message: 'Deal property has no coordinates yet — add lat/lng to enable comp ranking.',
    };
  }

  // Pull candidate comps within a generous radius. The similarity scorer
  // re-weights by exact distance, so over-pulling is fine; under-pulling is
  // not. We cap the candidate set at 200 to keep the scorer cheap.
  const candidates = await getCompsNearLocation(
    Number(subjectRow.lat),
    Number(subjectRow.lng),
    radiusKm
  );

  const subject = buildSubjectFromDealRow(subjectRow);
  const ranked = rankComps(subject, candidates).slice(0, limit);

  return {
    subject,
    radius_km: radiusKm,
    candidate_count: candidates.length,
    ranked: ranked.map(({ comp, similarity }) => ({
      ...comp,
      similarity,
    })),
  };
};

/**
 * Score a single subject ↔ single comp pair. Used by the deltas drawer in
 * the UI when an analyst pins a specific comp.
 */
const scoreSubjectAgainstComp = async (dealId, compId) => {
  const subjectRow = await loadSubjectForDeal(dealId);
  if (!subjectRow) throw createError('Deal not found.', 404);

  const platformOrgId = await getPlatformOrgId();
  const orgCondition = platformOrgId
    ? `(organization_id = current_organization_id() OR organization_id = $2)`
    : 'organization_id = current_organization_id()';
  const orgValues = platformOrgId ? [platformOrgId] : [];

  const compResult = await query(
    `SELECT *
     FROM comps
     WHERE id = $1
       AND ${orgCondition}
     LIMIT 1`,
    [compId, ...orgValues],
  );
  const comp = compResult.rows[0];
  if (!comp) throw createError('Comparable not found.', 404);

  const subject = buildSubjectFromDealRow(subjectRow);
  return {
    subject,
    comp,
    similarity: scoreComp(subject, comp),
  };
};

/**
 * Filtered comps fetch for the CSV export endpoint. Same filter shape
 * as `getComps` but returns up to `maxRows` rows in one shot so the
 * export endpoint doesn't have to paginate over potentially-thousands
 * of rows. Hard-capped to keep memory + response size predictable.
 */
const getCompsForExport = async (filters = {}, { maxRows = 5000 } = {}) => {
  const cappedMax = Math.min(Math.max(parseInt(maxRows, 10) || 5000, 1), 10000);
  const platformOrgId = await getPlatformOrgId();
  const { conditions, values, paramCount } = buildCompsWhere(filters, platformOrgId);
  const whereClause = conditions.join(' AND ');
  const result = await query(
    `SELECT * FROM comps WHERE ${whereClause}
     ORDER BY city, rate_per_sqft DESC
     LIMIT $${paramCount}`,
    [...values, cappedMax],
  );
  return result.rows;
};

module.exports = {
  addComp,
  getComps,
  getCompsForExport,
  getCompsNearLocation,
  assetClassToProjectType,
  getPricingBenchmarks,
  deleteComp,
  getRankedCompsForDeal,
  scoreSubjectAgainstComp,
};
