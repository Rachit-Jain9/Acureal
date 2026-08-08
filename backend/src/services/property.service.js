const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { normalizePropertyType } = require('../constants/domain');
const { buildVisiblePropertyCondition } = require('../utils/dealVisibility');
const { geocodeAddress } = require('../utils/geocode');
const { normalizeAreaSqft, normalizeAreaUnit, round } = require('../utils/landPricing');

/**
 * Invalidate the deterministic workspace cache after a parcel edit.
 *
 * `dealWorkspaceCache` fingerprints `deals.updated_at` (among other per-deal
 * tables) to decide whether a cached payload is still current. `properties` is
 * NOT in that fingerprint — deliberately, because adding a join to the hot
 * per-request path for a twice-a-month event is the wrong trade. The
 * consequence, though, was that editing a parcel changed nothing the cache
 * could see: micro-market, nearby comps, best-use and IC readiness are all
 * keyed on the parcel's coordinates and area, and the deal page kept repainting
 * the PRE-EDIT intelligence for up to the 120-second TTL. Deal Q&A answered
 * from it too.
 *
 * Touching the parent deal's `updated_at` moves the fingerprint the cache
 * already reads, so the next request rebuilds. Mirrors the `bumpDeal`
 * convention in signoff.service.js.
 *
 * Best-effort by design: cache invalidation must never fail the write it
 * follows. A missed bump costs at most one stale TTL window; a thrown error
 * would lose the user's edit.
 */
const bumpParentDeal = async (propertyId) => {
  if (!propertyId) return;
  try {
    await query('UPDATE deals SET updated_at = NOW() WHERE property_id = $1', [propertyId]);
  } catch {
    /* intentionally swallowed — see above */
  }
};

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

const cleanString = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

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
    surveyNumber: cleanString(data.surveyNumber ?? data.survey_number),
    pid: cleanString(data.pid ?? data.pidNumber),
    khataNo: cleanString(data.khataNo ?? data.khata_no),
    bhoomiId: cleanString(data.bhoomiId ?? data.bhoomi_id),
    reraRegistrationNumber: cleanString(data.reraRegistrationNumber ?? data.rera_registration_number),
    ownerName: cleanString(data.ownerName ?? data.owner_name),
    landAreaSqft: normalizedLandAreaSqft || null,
    landAreaInputValue:
      landAreaInputValue === undefined || landAreaInputValue === null || landAreaInputValue === ''
        ? normalizedLandAreaSqft || null
        : Number(landAreaInputValue),
    landAreaInputUnit,
    zoning: data.zoning || 'residential',
    circleRatePerSqft:
      (data.circleRatePerSqft ?? data.circle_rate_per_sqft) === undefined
        || (data.circleRatePerSqft ?? data.circle_rate_per_sqft) === ''
        ? null
        : Number(data.circleRatePerSqft ?? data.circle_rate_per_sqft),
    permissibleFsi:
      (data.permissibleFsi ?? data.permissible_fsi) === undefined
        || (data.permissibleFsi ?? data.permissible_fsi) === ''
        ? null
        : Number(data.permissibleFsi ?? data.permissible_fsi),
    roadWidthMtrs:
      (data.roadWidthMtrs ?? data.road_width_mtrs) === undefined
        || (data.roadWidthMtrs ?? data.road_width_mtrs) === ''
        ? null
        : Number(data.roadWidthMtrs ?? data.road_width_mtrs),
    frontageMtrs:
      (data.frontageMtrs ?? data.frontage_mtrs) === undefined
        || (data.frontageMtrs ?? data.frontage_mtrs) === ''
        ? null
        : Number(data.frontageMtrs ?? data.frontage_mtrs),
    depthMtrs:
      (data.depthMtrs ?? data.depth_mtrs) === undefined
        || (data.depthMtrs ?? data.depth_mtrs) === ''
        ? null
        : Number(data.depthMtrs ?? data.depth_mtrs),
    ownershipType: cleanString(data.ownershipType ?? data.ownership_type),
    encumbranceStatus: cleanString(data.encumbranceStatus ?? data.encumbrance_status),
    notes: data.notes?.trim() || null,
    zoneId:
      data.zoneId === undefined && data.zone_id === undefined
        ? undefined
        : (data.zoneId ?? data.zone_id) || null,
    zoneNotes:
      data.zoneNotes === undefined && data.zone_notes === undefined
        ? undefined
        : (data.zoneNotes ?? data.zone_notes)?.trim() || null,
    ...geocodeMetadata,
  };
};

const createProperty = async (data, userId) => {
  const payload = await buildPropertyPayload(data);

  const zoneId = payload.zoneId ?? null;
  const zoneAssignedBy = zoneId ? userId || null : null;
  const zoneAssignedAt = zoneId ? new Date() : null;
  const zoneNotes = payload.zoneNotes ?? null;

  const result = await query(
    `INSERT INTO properties (
      name, address, city, state, pincode, lat, lng, property_type,
      survey_number, pid, khata_no, bhoomi_id, rera_registration_number,
      owner_name, land_area_sqft, land_area_input_value, land_area_input_unit,
      zoning, circle_rate_per_sqft, permissible_fsi, road_width_mtrs,
      frontage_mtrs, depth_mtrs,
      ownership_type, encumbrance_status, geocode_status, geocode_confidence,
      geocode_message, geocode_last_attempt_at, notes, created_by,
      zone_id, zone_assigned_by, zone_assigned_at, zone_notes
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9,$10,$11,$12,$13,
      $14,$15,$16,$17,
      $18,$19,$20,$21,
      $22,$23,
      $24,$25,$26,$27,
      $28,$29,$30,$31,
      $32,$33,$34,$35
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
      payload.pid,
      payload.khataNo,
      payload.bhoomiId,
      payload.reraRegistrationNumber,
      payload.ownerName,
      payload.landAreaSqft,
      payload.landAreaInputValue,
      payload.landAreaInputUnit,
      payload.zoning,
      payload.circleRatePerSqft,
      payload.permissibleFsi,
      payload.roadWidthMtrs,
      payload.frontageMtrs,
      payload.depthMtrs,
      payload.ownershipType,
      payload.encumbranceStatus,
      payload.geocodeStatus,
      payload.geocodeConfidence,
      payload.geocodeMessage,
      payload.geocodeLastAttemptAt,
      payload.notes,
      userId,
      zoneId,
      zoneAssignedBy,
      zoneAssignedAt,
      zoneNotes,
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

const updateProperty = async (id, data, userId = null) => {
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

  const zoneChanging = payload.zoneId !== undefined;
  const newZoneId = zoneChanging ? payload.zoneId : existingProperty.zone_id;
  const zoneActuallyChanged =
    zoneChanging && (payload.zoneId ?? null) !== (existingProperty.zone_id ?? null);
  const zoneNotesChanging = payload.zoneNotes !== undefined;

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
      pid = $10,
      khata_no = $11,
      bhoomi_id = $12,
      rera_registration_number = $13,
      owner_name = $14,
      land_area_sqft = $15,
      land_area_input_value = $16,
      land_area_input_unit = $17,
      zoning = $18,
      circle_rate_per_sqft = $19,
      permissible_fsi = $20,
      road_width_mtrs = $21,
      frontage_mtrs = $22,
      depth_mtrs = $23,
      ownership_type = $24,
      encumbrance_status = $25,
      geocode_status = $26,
      geocode_confidence = $27,
      geocode_message = $28,
      geocode_last_attempt_at = $29,
      notes = $30,
      zone_id = $31,
      zone_assigned_by = CASE
        WHEN $32::boolean AND $31::uuid IS NOT NULL THEN $33::uuid
        WHEN $32::boolean AND $31::uuid IS NULL THEN NULL
        ELSE zone_assigned_by
      END,
      zone_assigned_at = CASE
        WHEN $32::boolean AND $31::uuid IS NOT NULL THEN NOW()
        WHEN $32::boolean AND $31::uuid IS NULL THEN NULL
        ELSE zone_assigned_at
      END,
      zone_notes = CASE WHEN $34::boolean THEN $35 ELSE zone_notes END,
      updated_at = NOW()
     WHERE id = $36
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
      payload.pid,
      payload.khataNo,
      payload.bhoomiId,
      payload.reraRegistrationNumber,
      payload.ownerName,
      payload.landAreaSqft,
      payload.landAreaInputValue,
      payload.landAreaInputUnit,
      payload.zoning,
      payload.circleRatePerSqft,
      payload.permissibleFsi,
      payload.roadWidthMtrs,
      payload.frontageMtrs,
      payload.depthMtrs,
      payload.ownershipType,
      payload.encumbranceStatus,
      payload.geocodeStatus,
      payload.geocodeConfidence,
      payload.geocodeMessage,
      payload.geocodeLastAttemptAt,
      payload.notes,
      newZoneId,
      zoneActuallyChanged,
      userId,
      zoneNotesChanging,
      zoneNotesChanging ? payload.zoneNotes : null,
      id,
    ]
  );

  if (result.rows.length === 0) {
    throw createError('Property not found.', 404);
  }

  await bumpParentDeal(id);
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

  await bumpParentDeal(propertyId);
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

// Dedicated apply path for the AutoFillParcelContextCard's payload.
// Lives outside the generic updateProperty positional UPDATE so the
// auto-derive flow can evolve without touching the 35-arg main writer
// (and so analysts can `SELECT … WHERE auto_derived_at IS NOT NULL` to
// audit which deals went through the orchestrator).
//
// `picks` is a subset of the AutoFillParcelContextCard rows the user
// chose not to Skip. Any key absent from `picks` is left alone on the
// row — we never null out a field the user didn't ask to apply.
//
// `derivedSource` is the full upstream payload, persisted to
// auto_derived_source jsonb so future re-extractions can verify what
// the orchestrator returned at the moment of apply (provenance trail
// for IC defensibility — CLAUDE.md hard rule).
const applyAutoDerivedContext = async (id, { picks = {}, derivedSource = null }, userId = null) => {
  await getPropertyById(id); // ownership / RLS check; throws 404 if missing

  const sets = ['auto_derived_at = NOW()', 'auto_derived_by = $2'];
  const params = [id, userId];
  let p = 3;

  const push = (col, value) => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}`);
    params.push(value === null ? null : value);
    p += 1;
  };

  // Coordinates — also written to the editable lat/lng so the map pin
  // moves immediately (existing user-facing behaviour from PR B3).
  if (picks.coordinates) {
    const lat = picks.coordinates.lat ?? null;
    const lng = picks.coordinates.lng ?? null;
    push('auto_derived_lat', lat);
    push('auto_derived_lng', lng);
    if (lat !== null && lng !== null) {
      push('lat', lat);
      push('lng', lng);
    }
  }
  if (picks.ward) push('auto_derived_ward_no', picks.ward.ward_no ?? null);
  if (picks.bbmp_zone) {
    push('auto_derived_zone_code', picks.bbmp_zone.zone_code ?? null);
    push('auto_derived_guidance_min_inr', picks.bbmp_zone.guidance_value_band_min_inr ?? null);
    push('auto_derived_guidance_max_inr', picks.bbmp_zone.guidance_value_band_max_inr ?? null);
  }
  if (picks.planning_district) {
    push('auto_derived_pd_code', picks.planning_district.pd_code ?? null);
    push('auto_derived_pd_name', picks.planning_district.pd_name ?? null);
  }
  if (picks.kgis_hierarchy) {
    push('auto_derived_taluk', picks.kgis_hierarchy.taluk ?? null);
    push('auto_derived_village', picks.kgis_hierarchy.village ?? null);
  }

  // Always persist the source payload (even on empty picks) so the row
  // records who saw what at the moment of apply. Trim non-essential
  // fields to keep the JSON column small (~5KB instead of ~50KB).
  if (derivedSource && typeof derivedSource === 'object') {
    const slim = {
      coordinates: derivedSource.coordinates ?? null,
      bbmpJurisdiction: derivedSource.bbmpJurisdiction ?? null,
      bbmpZone: derivedSource.bbmpZone ?? null,
      planningDistrict: derivedSource.planningDistrict ?? null,
      kgis: derivedSource.kgis?.hierarchy
        ? { hierarchy: derivedSource.kgis.hierarchy, status: derivedSource.kgis.status, confidence: derivedSource.kgis.confidence }
        : null,
      applicableWarnings: (derivedSource.applicableWarnings || []).map((w) => ({
        kind: w.kind, fact_type: w.fact_type, fact_key: w.fact_key, severity: w.severity, item_count: w.item_count,
      })),
      derivedAt: derivedSource.derivedAt ?? null,
      elapsedMs: derivedSource.elapsedMs ?? null,
    };
    push('auto_derived_source', JSON.stringify(slim));
  }

  // updated_at is always touched.
  sets.push('updated_at = NOW()');

  const result = await query(
    `UPDATE properties
     SET ${sets.join(', ')}
     WHERE id = $1
       AND organization_id = current_organization_id()
     RETURNING *`,
    params,
  );

  if (result.rows.length === 0) {
    throw createError('Property not found.', 404);
  }

  await bumpParentDeal(id);
  return result.rows[0];
};

// Ward Spread Benchmark — pull every OTHER deal whose linked property
// shares this property's auto_derived_ward_no, compute each deal's
// spread % against its matched BBMP guidance bandwidth, and return the
// percentile distribution. Powers the "median spread in this ward"
// sanity-check tile on DealStreetLookupCard (PR-C7 from the
// autonomous-window plan).
//
// Returns `{ ok: false, reason }` when:
//   - ward_not_derived: this property has no auto_derived_ward_no
//   - insufficient_data: fewer than 3 comparable deals in the ward
//
// All sample deals are filtered to the same org via RLS — analysts
// don't see cross-org transaction prices through this surface.
const getWardSpreadBenchmark = async (propertyId) => {
  const property = await getPropertyById(propertyId);
  const wardNo = property.auto_derived_ward_no;
  if (wardNo === null || wardNo === undefined) {
    return {
      ok: false,
      reason: 'ward_not_derived',
      ward_no: null,
      message: 'Apply the auto-derive context on this property first — the ward number is required to compute the benchmark.',
    };
  }

  // Pull other-deal sample. Use the property's auto_derived guidance
  // band when available, else fall back to the property's manual
  // circle_rate_per_sqft. We need:
  //   - the deal's effective per-sqft price (negotiated / ask / entry)
  //   - the property's auto_derived guidance min/max so each deal's
  //     spread is computed against its own gazette band
  const sampleResult = await query(
    `SELECT
       d.id                                    AS deal_id,
       d.name                                  AS deal_name,
       d.negotiated_price_cr,
       d.land_ask_price_cr,
       d.entry_value_cr,
       p.land_area_sqft,
       p.selling_rate_per_sqft,
       p.auto_derived_guidance_min_inr        AS guidance_min,
       p.auto_derived_guidance_max_inr        AS guidance_max
     FROM deals d
     JOIN properties p ON p.id = d.property_id
     WHERE p.auto_derived_ward_no = $2
       AND p.id <> $1
       AND d.organization_id = current_organization_id()
       AND d.is_archived = FALSE
       AND COALESCE(p.auto_derived_guidance_min_inr, p.auto_derived_guidance_max_inr) IS NOT NULL`,
    [propertyId, wardNo],
  );

  // Compute per-deal spread % in JS (cleaner than nested SQL casts).
  const samples = [];
  for (const row of sampleResult.rows) {
    const sqft = Number(row.land_area_sqft);
    let pricePerSqft = Number(row.selling_rate_per_sqft);
    if (!Number.isFinite(pricePerSqft) || pricePerSqft <= 0) {
      const priceCr = Number(row.negotiated_price_cr ?? row.land_ask_price_cr ?? row.entry_value_cr);
      if (!Number.isFinite(priceCr) || !Number.isFinite(sqft) || sqft <= 0) continue;
      pricePerSqft = (priceCr * 10_000_000) / sqft;
    }
    const gMin = Number(row.guidance_min);
    const gMax = Number(row.guidance_max);
    let gMid;
    if (Number.isFinite(gMin) && Number.isFinite(gMax)) gMid = (gMin + gMax) / 2;
    else if (Number.isFinite(gMin)) gMid = gMin;
    else if (Number.isFinite(gMax)) gMid = gMax;
    else continue;
    if (gMid <= 0) continue;
    const spreadPct = ((pricePerSqft - gMid) / gMid) * 100;
    samples.push({
      deal_id: row.deal_id,
      deal_name: row.deal_name,
      price_per_sqft: Math.round(pricePerSqft),
      spread_pct: Number(spreadPct.toFixed(1)),
    });
  }

  if (samples.length < 3) {
    return {
      ok: false,
      reason: 'insufficient_data',
      ward_no: wardNo,
      sample_size: samples.length,
      message: `Only ${samples.length} other deal${samples.length === 1 ? '' : 's'} in ward ${wardNo} have enough data to benchmark. Need at least 3 to compute median + percentiles.`,
    };
  }

  const spreads = samples.map((s) => s.spread_pct).sort((a, b) => a - b);
  const percentile = (sorted, p) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };

  return {
    ok: true,
    ward_no: wardNo,
    sample_size: samples.length,
    median_spread_pct: Number(percentile(spreads, 0.5).toFixed(1)),
    p25_spread_pct: Number(percentile(spreads, 0.25).toFixed(1)),
    p75_spread_pct: Number(percentile(spreads, 0.75).toFixed(1)),
    min_spread_pct: Number(spreads[0].toFixed(1)),
    max_spread_pct: Number(spreads[spreads.length - 1].toFixed(1)),
    samples: samples.slice(0, 10), // cap at 10 for response size; full set isn't useful to the deal team
    disclaimer:
      'Benchmark uses each deal\'s auto-derived BBMP guidance bandwidth as its own anchor. Sample drawn from the same ward as this property; cross-org data is filtered out via RLS. Verify against IGR-published sale-deed comps before quoting in IC.',
  };
};

module.exports = {
  createProperty,
  getProperties,
  getPropertyById,
  updateProperty,
  deleteProperty,
  geocodePropertyAddress,
  bulkGeocodeProperties,
  applyAutoDerivedContext,
  getWardSpreadBenchmark,
};
