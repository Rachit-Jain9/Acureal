const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');

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

const getComps = async (filters = {}, pagination = {}) => {
  const conditions = ['organization_id = current_organization_id()'];
  const values = [];
  let paramCount = 1;

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

const getCompsNearLocation = async (lat, lng, radiusKm = 5, projectType = null) => {
  if (!lat || !lng) {
    throw createError('Latitude and longitude are required.', 400);
  }

  // Using approximate bounding box first for efficiency, then filter with Haversine
  const latDelta = radiusKm / 111; // ~111km per degree latitude
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const conditions = [
    'organization_id = current_organization_id()',
    'lat IS NOT NULL',
    'lng IS NOT NULL',
    `lat BETWEEN $1 AND $2`,
    `lng BETWEEN $3 AND $4`,
  ];
  const values = [
    lat - latDelta, lat + latDelta,
    lng - lngDelta, lng + lngDelta,
  ];

  if (projectType) {
    conditions.push(`project_type = $5`);
    values.push(projectType);
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
  const median = rates[Math.floor(rates.length / 2)];

  // Percentiles
  const p25 = rates[Math.floor(rates.length * 0.25)];
  const p75 = rates[Math.floor(rates.length * 0.75)];

  return {
    found: true,
    radius_km: radiusKm,
    count: comps.length,
    benchmarks: {
      avg_rate_per_sqft: Math.round(avg),
      min_rate_per_sqft: min,
      max_rate_per_sqft: max,
      median_rate_per_sqft: Math.round(median),
      p25_rate_per_sqft: p25,
      p75_rate_per_sqft: p75,
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

module.exports = {
  addComp,
  getComps,
  getCompsNearLocation,
  getPricingBenchmarks,
  deleteComp,
};
