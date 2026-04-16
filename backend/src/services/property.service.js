const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { normalizePropertyType } = require('../constants/domain');
const { buildVisiblePropertyCondition } = require('../utils/dealVisibility');
const { geocodeAddress } = require('../utils/geocode');
const { normalizeAreaSqft, normalizeAreaUnit, round } = require('../utils/landPricing');

const buildDisplayNameSql = () =>
  `COALESCE(
    NULLIF(p.name, ''),
    NULLIF(p.address, ''),
    CONCAT(
      COALESCE(NULLIF(p.city, ''), 'Unknown city'),
      ' ',
      INITCAP(REPLACE(COALESCE(p.property_type, 'land'), '_', ' ')),
      ' opportunity'
    )
  )`;

const hydrateGeocodeMetadata = async ({ address, city, state, pincode, lat, lng }) => {
  if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
    return {
      lat: Number(lat),
      lng: Number(lng),
      geocodeStatus: 'manual',
      geocodeConfidence: 1,
      geocodeMessage: 'Coordinates set manually.',
      geocodeLastAttemptAt: new Date(),
    };
  }

  const geocodeResult = await geocodeAddress(address, city, state, pincode);

  if (!geocodeResult?.found) {
    return {
      lat: null,
      lng: null,
      geocodeStatus: geocodeResult?.status || 'failed',
      geocodeConfidence: null,
      geocodeMessage: geocodeResult?.message || 'Geocoding could not determine a location.',
      geocodeLastAttemptAt: new Date(),
    };
  }

  return {
    lat: geocodeResult.lat,
    lng: geocodeResult.lng,
    geocodeStatus: geocodeResult.status,
    geocodeConfidence: geocodeResult.confidence ? round(geocodeResult.confidence, 2) : null,
    geocodeMessage: geocodeResult.message || null,
    geocodeLastAttemptAt: new Date(),
  };
};

const buildPropertyPayload = async (data = {}) => {
  const landAreaInputUnit = normalizeAreaUnit(data.landAreaUnit || data.landAreaInputUnit || 'sqft');
  const landAreaInputValue =
    data.landAreaValue !== undefined
      ? data.landAreaValue
      : data.landAreaInputValue !== undefined
        ? data.landAreaInputValue
        : data.landAreaSqft;

  const normalizedLandAreaSqft =
    data.landAreaSqft !== undefined && data.landAreaSqft !== null && data.landAreaSqft !== ''
      ? Number(data.landAreaSqft)
      : normalizeAreaSqft(landAreaInputValue, landAreaInputUnit);

  const geocodeMetadata = await hydrateGeocodeMetadata({
    address: data.address,
    city: data.city,
    state: data.state,
    pincode: data.pincode,
    lat: data.lat,
    lng: data.lng,
  });

  return {
    name: data.name?.trim() || null,
    address: data.address?.trim() || null,
    city: data.city?.trim() || null,
    state: data.state?.trim() || null,
    pincode: data.pincode?.trim() || null,
    propertyType: normalizePropertyType(data.propertyType || data.property_type || 'land'),
    surveyNumber: data.surveyNumber?.trim() || null,
    ownerName: data.ownerName?.trim() || null,
    landAreaSqft: normalizedLandAreaSqft || null,
    landAreaInputValue:
      landAreaInputValue === undefined || landAreaInputValue === null || landAreaInputValue === ''
        ? normalizedLandAreaSqft || null
        : Number(landAreaInputValue),
    landAreaInputUnit,
    zoning: data.zoning || 'residential',
    circleRatePerSqft:
      data.circleRatePerSqft === undefined || data.circleRatePerSqft === ''
        ? null
        : Number(data.circleRatePerSqft),
    permissibleFsi:
      data.permissibleFsi === undefined || data.permissibleFsi === ''
        ? null
        : Number(data.permissibleFsi),
    roadWidthMtrs:
      data.roadWidthMtrs === undefined || data.roadWidthMtrs === ''
        ? null
        : Number(data.roadWidthMtrs),
    ownershipType: data.ownershipType?.trim() || null,
    encumbranceStatus: data.encumbranceStatus?.trim() || null,
    notes: data.notes?.trim() || null,
    ...geocodeMetadata,
  };
};

const createProperty = async (data, userId) => {
  const payload = await buildPropertyPayload(data);

  const result = await query(
    `INSERT INTO properties (
      name, address, city, state, pincode, lat, lng, property_type,
      survey_number, owner_name, land_area_sqft, land_area_input_value, land_area_input_unit,
      zoning, circle_rate_per_sqft, permissible_fsi, road_width_mtrs,
      ownership_type, encumbrance_status, geocode_status, geocode_confidence,
      geocode_message, geocode_last_attempt_at, notes, created_by
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9,$10,$11,$12,$13,
      $14,$15,$16,$17,
      $18,$19,$20,$21,
      $22,$23,$24,$25
    )
    RETURNING *`,
    [
      payload.name,
      payload.address,
      payload.city,
      payload.state,
      payload.pincode,
      payload.lat,
      payload.lng,
      payload.propertyType,
      payload.surveyNumber,
      payload.ownerName,
      payload.landAreaSqft,
      payload.landAreaInputValue,
      payload.landAreaInputUnit,
      payload.zoning,
      payload.circleRatePerSqft,
      payload.permissibleFsi,
      payload.roadWidthMtrs,
      payload.ownershipType,
      payload.encumbranceStatus,
      payload.geocodeStatus,
      payload.geocodeConfidence,
      payload.geocodeMessage,
      payload.geocodeLastAttemptAt,
      payload.notes,
      userId,
    ]
  );

  return result.rows[0];
};

const getProperties = async (filters = {}, pagination = {}) => {
  const conditions = [buildVisiblePropertyCondition('p', 'linked_deal')];
  const values = [];
  let paramCount = 1;

  if (filters.city) {
    conditions.push(`LOWER(p.city) = LOWER($${paramCount})`);
    values.push(filters.city);
    paramCount++;
  }

  if (filters.state) {
    conditions.push(`LOWER(p.state) = LOWER($${paramCount})`);
    values.push(filters.state);
    paramCount++;
  }

  if (filters.zoning) {
    conditions.push(`p.zoning = $${paramCount}`);
    values.push(filters.zoning);
    paramCount++;
  }

  if (filters.propertyType) {
    conditions.push(`p.property_type = $${paramCount}`);
    values.push(filters.propertyType);
    paramCount++;
  }

  if (filters.geocodeStatus) {
    conditions.push(`p.geocode_status = $${paramCount}`);
    values.push(filters.geocodeStatus);
    paramCount++;
  }

  if (filters.search) {
    conditions.push(
      `(
        COALESCE(p.name, '') ILIKE $${paramCount}
        OR COALESCE(p.address, '') ILIKE $${paramCount}
        OR COALESCE(p.owner_name, '') ILIKE $${paramCount}
        OR COALESCE(p.city, '') ILIKE $${paramCount}
      )`
    );
    values.push(`%${filters.search}%`);
    paramCount++;
  }

  if (filters.minArea) {
    conditions.push(`p.land_area_sqft >= $${paramCount}`);
    values.push(filters.minArea);
    paramCount++;
  }

  if (filters.maxArea) {
    conditions.push(`p.land_area_sqft <= $${paramCount}`);
    values.push(filters.maxArea);
    paramCount++;
  }

  const page = parseInt(pagination.page, 10) || 1;
  const limit = Math.min(parseInt(pagination.limit, 10) || 20, 500);
  const offset = (page - 1) * limit;

  const whereClause = conditions.join(' AND ');
  const countResult = await query(`SELECT COUNT(*) FROM properties p WHERE ${whereClause}`, values);

  const dataResult = await query(
    `SELECT p.*, u.name as created_by_name, ${buildDisplayNameSql()} as display_name
     FROM properties p
     LEFT JOIN users u ON p.created_by = u.id
     WHERE ${whereClause}
     ORDER BY p.updated_at DESC
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

const getPropertyById = async (id) => {
  const result = await query(
    `SELECT p.*, u.name as created_by_name,
      ${buildDisplayNameSql()} as display_name,
      (
        SELECT COUNT(*)
        FROM deals d
        WHERE d.property_id = p.id
          AND d.organization_id = current_organization_id()
          AND d.is_archived = FALSE
          AND d.stage <> 'dead'
      ) as deal_count
     FROM properties p
     LEFT JOIN users u ON p.created_by = u.id
     WHERE p.id = $1
       AND ${buildVisiblePropertyCondition('p', 'linked_deal')}`,
    [id]
  );

  if (result.rows.length === 0) {
    throw createError('Property not found.', 404);
  }

  return result.rows[0];
};

const updateProperty = async (id, data) => {
  const existingProperty = await getPropertyById(id);

  // If any address field changed and the caller did not supply new explicit coords,
  // clear the stored lat/lng so hydrateGeocodeMetadata triggers a fresh geocode.
  const addressChanged =
    (data.address !== undefined && data.address !== existingProperty.address) ||
    (data.city !== undefined && data.city !== existingProperty.city) ||
    (data.state !== undefined && data.state !== existingProperty.state) ||
    (data.pincode !== undefined && data.pincode !== existingProperty.pincode);

  const coordOverride =
    addressChanged && data.lat === undefined && data.lng === undefined
      ? { lat: undefined, lng: undefined }
      : {};

  const payload = await buildPropertyPayload({
    ...existingProperty,
    ...data,
    ...coordOverride,
    propertyType: data.propertyType ?? data.property_type ?? existingProperty.property_type,
    landAreaSqft: data.landAreaSqft ?? existingProperty.land_area_sqft,
    landAreaInputValue: data.landAreaInputValue ?? existingProperty.land_area_input_value,
    landAreaInputUnit: data.landAreaInputUnit ?? existingProperty.land_area_input_unit,
  });

  const result = await query(
    `UPDATE properties SET
      name = $1,
      address = $2,
      city = $3,
      state = $4,
      pincode = $5,
      lat = $6,
      lng = $7,
      property_type = $8,
      survey_number = $9,
      owner_name = $10,
      land_area_sqft = $11,
      land_area_input_value = $12,
      land_area_input_unit = $13,
      zoning = $14,
      circle_rate_per_sqft = $15,
      permissible_fsi = $16,
      road_width_mtrs = $17,
      ownership_type = $18,
      encumbrance_status = $19,
      geocode_status = $20,
      geocode_confidence = $21,
      geocode_message = $22,
      geocode_last_attempt_at = $23,
      notes = $24,
      updated_at = NOW()
     WHERE id = $25
     RETURNING *`,
    [
      payload.name,
      payload.address,
      payload.city,
      payload.state,
      payload.pincode,
      payload.lat,
      payload.lng,
      payload.propertyType,
      payload.surveyNumber,
      payload.ownerName,
      payload.landAreaSqft,
      payload.landAreaInputValue,
      payload.landAreaInputUnit,
      payload.zoning,
      payload.circleRatePerSqft,
      payload.permissibleFsi,
      payload.roadWidthMtrs,
      payload.ownershipType,
      payload.encumbranceStatus,
      payload.geocodeStatus,
      payload.geocodeConfidence,
      payload.geocodeMessage,
      payload.geocodeLastAttemptAt,
      payload.notes,
      id,
    ]
  );

  if (result.rows.length === 0) {
    throw createError('Property not found.', 404);
  }

  return result.rows[0];
};

const deleteProperty = async (id) => {
  const dealsResult = await query(
    `SELECT COUNT(*)
     FROM deals
     WHERE property_id = $1
       AND organization_id = current_organization_id()
       AND is_archived = FALSE
       AND stage NOT IN ('closed', 'dead')`,
    [id]
  );

  if (parseInt(dealsResult.rows[0].count, 10) > 0) {
    throw createError(
      'Cannot delete property with live deals. Archive or close the linked deals first.',
      409
    );
  }

  const result = await query(
    'DELETE FROM properties WHERE id = $1 AND organization_id = current_organization_id() RETURNING id',
    [id]
  );

  if (result.rows.length === 0) {
    throw createError('Property not found.', 404);
  }

  return { deleted: true, id };
};

const geocodePropertyAddress = async (propertyId) => {
  const property = await getPropertyById(propertyId);

  const coords = await geocodeAddress(
    property.address,
    property.city,
    property.state,
    property.pincode
  );

  if (!coords?.found) {
    const updateResult = await query(
      `UPDATE properties
       SET geocode_status = $1,
           geocode_message = $2,
           geocode_confidence = NULL,
           geocode_last_attempt_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [coords?.status || 'failed', coords?.message || 'Geocoding failed.', propertyId]
    );

    throw createError(updateResult.rows[0]?.geocode_message || 'Could not geocode the property address.', 422);
  }

  const result = await query(
    `UPDATE properties
     SET lat = $1,
         lng = $2,
         geocode_status = $3,
         geocode_confidence = $4,
         geocode_message = $5,
         geocode_last_attempt_at = NOW(),
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [coords.lat, coords.lng, coords.status, coords.confidence, coords.message, propertyId]
  );

  return result.rows[0];
};

const bulkGeocodeProperties = async ({ onlyStatus } = {}) => {
  const whereClause = onlyStatus
    ? `WHERE geocode_status = ANY($1) AND (address IS NOT NULL OR city IS NOT NULL)`
    : `WHERE geocode_status != 'manual' AND (address IS NOT NULL OR city IS NOT NULL)`;

  const params = onlyStatus ? [onlyStatus] : [];
  const rows = await query(
    `SELECT id FROM properties ${whereClause} ORDER BY updated_at ASC`,
    params
  );

  const results = { success: 0, failed: 0, total: rows.rows.length, errors: [] };

  for (const row of rows.rows) {
    try {
      await geocodePropertyAddress(row.id);
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push({ id: row.id, message: err.message });
    }
  }

  return results;
};

module.exports = {
  createProperty,
  getProperties,
  getPropertyById,
  updateProperty,
  deleteProperty,
  geocodePropertyAddress,
  bulkGeocodeProperties,
};
