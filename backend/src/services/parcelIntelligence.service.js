const crypto = require('crypto');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { buildVisiblePropertyCondition } = require('../utils/dealVisibility');
const {
  computeBuildabilityFromRule,
  selectFarRule,
  round,
} = require('../utils/parcelBuildability');
const guidanceService = require('./guidance.service');
const landeedAdapter = require('./adapters/landeed.adapter');
const kgisAdapter = require('./adapters/kgis.adapter');
const osmRoadAdapter = require('./adapters/osmRoadWidth.adapter');
const { buildVerificationLinks } = require('../utils/parcelVerificationLinks');
const { runParcelRedFlags } = require('../engines/parcelRedFlags.engine');
const { EVENTS, publish } = require('../lib/eventBus');

const VERIFICATION_LINKS = {
  kaveri: 'https://kaveri.karnataka.gov.in/landing-page',
  bbmp_eaasthi: 'https://www.bbmpeaasthi.karnataka.gov.in/',
  igr_guidance: 'https://igr.karnataka.gov.in/page/Revised%2BGuidelines%2BValue/en',
  kgis_protocol: 'https://ksrsac.in/web/sites/default/files/projects/2018-02/K-GIS%20Data%20Exchange%20Protocol.pdf',
};

const normalizeLandUseFamily = (property = {}, zone = null) => {
  const raw = `${zone?.zone_category || ''} ${zone?.land_use_category || ''} ${zone?.zone_code || ''} ${property.zoning || ''} ${property.property_type || ''}`.toLowerCase();
  if (raw.includes('commercial') || raw.includes('office') || raw.includes('retail') || /\bc[-\d]/.test(raw)) return 'commercial';
  if (raw.includes('industrial')) return 'industrial';
  return 'residential';
};

const ENGINE_VERSION = '1.0.0';

const hashInputs = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const computeSignature = (inputs_hash, output_hash) => {
  const secret = process.env.PARCEL_SIGNING_SECRET;
  if (!secret) return null;
  return crypto
    .createHmac('sha256', secret)
    .update(`${inputs_hash}|${output_hash}|${ENGINE_VERSION}`)
    .digest('hex');
};

const loadPropertyWithZone = async (propertyId) => {
  const result = await query(
    `SELECT
       p.*,
       ${`COALESCE(
          NULLIF(p.name, ''),
          NULLIF(p.address, ''),
          CONCAT(COALESCE(NULLIF(p.city, ''), 'Unknown city'), ' ', INITCAP(REPLACE(COALESCE(p.property_type, 'land'), '_', ' ')), ' opportunity')
        )`} AS display_name,
       CASE WHEN z.id IS NULL THEN NULL ELSE to_jsonb(z) END AS zone
     FROM properties p
     LEFT JOIN regulatory_data.master_plan_zones z ON z.id = p.zone_id
     WHERE p.id = $1
       AND ${buildVisiblePropertyCondition('p', 'linked_deal')}`,
    [propertyId]
  );

  if (!result.rows[0]) {
    throw createError('Property not found.', 404);
  }

  return result.rows[0];
};

const loadFarRules = async ({ property, zone, landUseFamily }) => {
  if (!zone?.zone_code) return [];

  const result = await query(
    `SELECT
       fr.*,
       es.source_title,
       es.source_url,
       es.authority_name
     FROM regulatory_data.far_rules fr
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = fr.evidence_source_id
     WHERE fr.review_status = 'approved'
       AND LOWER(COALESCE(fr.city, 'bengaluru')) = LOWER($1)
       AND LOWER(fr.land_use_family) = LOWER($2)
       AND (
         fr.zone_code = $3
         OR (
           fr.planning_zone IS NOT NULL
           AND fr.planning_zone = COALESCE($4, fr.planning_zone)
           AND $3 IS NULL
         )
       )
     ORDER BY (fr.org_id IS NOT NULL) DESC, fr.plot_area_min_sqm ASC, fr.road_width_min_m ASC`,
    [
      property.city || 'Bengaluru',
      landUseFamily,
      zone.zone_code || null,
      zone.planning_zone || null,
    ]
  );

  return result.rows;
};

const getCachedKgis = async (property) => {
  const cacheKey = buildKgisCacheKey(property);
  if (!cacheKey) return null;

  const result = await query(
    `SELECT *
     FROM regulatory_data.kgis_cache
     WHERE cache_key = $1
       AND org_id = current_organization_id()
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY updated_at DESC
     LIMIT 1`,
    [cacheKey]
  );

  return result.rows[0] || null;
};

// ─── T6 — OSM road-width cache helpers ────────────────────────────────────
// Mirrors the KGIS cache pattern. Cache key keys on property + 6dp lat/lng so
// a parcel that's been geocoded to a different point gets a fresh lookup.

const buildOsmCacheKey = (property = {}) => {
  if (!property.id) return null;
  if (property.lat === null || property.lat === undefined) return null;
  if (property.lng === null || property.lng === undefined) return null;
  const lat = Number(property.lat).toFixed(6);
  const lng = Number(property.lng).toFixed(6);
  return `property:${property.id}:lat:${lat}:lng:${lng}:radius:80`;
};

const getCachedOsmRoad = async (property) => {
  const cacheKey = buildOsmCacheKey(property);
  if (!cacheKey) return null;
  try {
    const result = await query(
      `SELECT *
       FROM regulatory_data.osm_road_cache
       WHERE cache_key = $1
         AND org_id = current_organization_id()
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY updated_at DESC
       LIMIT 1`,
      [cacheKey]
    );
    return result.rows[0] || null;
  } catch {
    // Migration may not be applied yet — fail soft so production keeps serving.
    return null;
  }
};

const upsertOsmRoadCache = async (property, osmResult) => {
  const cacheKey = buildOsmCacheKey(property);
  if (!cacheKey) return null;

  const requestPayload = {
    lat: property.lat,
    lng: property.lng,
    radius_m: 80,
  };

  try {
    const updateResult = await query(
      `UPDATE regulatory_data.osm_road_cache
       SET provider_status   = $2,
           request_payload   = $3::jsonb,
           response_payload  = $4::jsonb,
           inferred_width_m  = $5,
           inferred_lanes    = $6,
           inferred_highway  = $7,
           candidate_count   = $8,
           confidence_score  = $9,
           expires_at        = NOW() + INTERVAL '30 days',
           updated_at        = NOW()
       WHERE cache_key = $1
         AND org_id = current_organization_id()
       RETURNING *`,
      [
        cacheKey,
        osmResult.status || 'unknown',
        JSON.stringify(requestPayload),
        osmResult.raw ? JSON.stringify(osmResult.raw) : null,
        osmResult.inferred_width_m,
        osmResult.inferred_lanes,
        osmResult.inferred_highway,
        osmResult.candidate_count || 0,
        osmResult.confidence || 0,
      ]
    );

    if (updateResult.rows[0]) return updateResult.rows[0];

    const insertResult = await query(
      `INSERT INTO regulatory_data.osm_road_cache (
         org_id, property_id, cache_key, provider_status,
         request_payload, response_payload,
         inferred_width_m, inferred_lanes, inferred_highway,
         candidate_count, confidence_score, expires_at
       )
       VALUES (
         current_organization_id(), $1, $2, $3,
         $4::jsonb, $5::jsonb,
         $6, $7, $8,
         $9, $10, NOW() + INTERVAL '30 days'
       )
       RETURNING *`,
      [
        property.id,
        cacheKey,
        osmResult.status || 'unknown',
        JSON.stringify(requestPayload),
        osmResult.raw ? JSON.stringify(osmResult.raw) : null,
        osmResult.inferred_width_m,
        osmResult.inferred_lanes,
        osmResult.inferred_highway,
        osmResult.candidate_count || 0,
        osmResult.confidence || 0,
      ]
    );
    return insertResult.rows[0] || null;
  } catch {
    return null;
  }
};

const formatOsmRoad = (cacheRow, liveResult = null) => {
  if (liveResult) {
    return {
      provider: 'osm_overpass',
      status: liveResult.status,
      confidence: liveResult.confidence || 0,
      message: liveResult.message,
      reference_only: true,
      inferred_width_m: liveResult.inferred_width_m,
      inferred_lanes: liveResult.inferred_lanes,
      inferred_highway: liveResult.inferred_highway,
      inferred_road_name: liveResult.inferred_road_name || null,
      derivation_method: liveResult.derivation_method,
      candidate_count: liveResult.candidate_count || 0,
      refreshed_at: new Date().toISOString(),
      citations: liveResult.inferred_width_m
        ? [{
            id: 'osm-road-reference',
            kind: 'osm',
            label: 'OpenStreetMap road context',
            source_url: 'https://www.openstreetmap.org/copyright',
            authority: 'OpenStreetMap (crowdsourced)',
            status: 'reference_only',
          }]
        : [],
    };
  }

  if (!cacheRow) {
    return {
      provider: 'osm_overpass',
      status: 'not_requested',
      confidence: 0,
      message: 'OSM road-width inference has not been run for this parcel.',
      reference_only: true,
      inferred_width_m: null,
      inferred_lanes: null,
      inferred_highway: null,
      derivation_method: null,
      candidate_count: 0,
      citations: [],
    };
  }

  return {
    provider: 'osm_overpass',
    status: cacheRow.provider_status,
    confidence: Number(cacheRow.confidence_score || 0),
    message: 'Cached OSM-inferred road context. Treat as reference only — verify on site.',
    reference_only: true,
    inferred_width_m: cacheRow.inferred_width_m ? Number(cacheRow.inferred_width_m) : null,
    inferred_lanes: cacheRow.inferred_lanes,
    inferred_highway: cacheRow.inferred_highway,
    derivation_method: null,
    candidate_count: cacheRow.candidate_count || 0,
    refreshed_at: cacheRow.updated_at,
    citations: cacheRow.inferred_width_m
      ? [{
          id: 'osm-road-reference',
          kind: 'osm',
          label: 'OpenStreetMap road context (cached)',
          source_url: 'https://www.openstreetmap.org/copyright',
          authority: 'OpenStreetMap (crowdsourced)',
          status: 'reference_only',
        }]
      : [],
  };
};

const buildKgisCacheKey = (property = {}) => {
  if (!property.id) return null;
  const lat = property.lat === null || property.lat === undefined ? 'no-lat' : Number(property.lat).toFixed(6);
  const lng = property.lng === null || property.lng === undefined ? 'no-lng' : Number(property.lng).toFixed(6);
  const survey = property.survey_number || 'no-survey';
  return `property:${property.id}:lat:${lat}:lng:${lng}:survey:${survey}`;
};

const upsertKgisCache = async (property, kgisResult) => {
  const cacheKey = buildKgisCacheKey(property);
  if (!cacheKey) return null;

  const payload = {
    lat: property.lat || null,
    lng: property.lng || null,
    survey_number: property.survey_number || null,
  };

  const updateResult = await query(
    `UPDATE regulatory_data.kgis_cache
     SET provider_status = $2,
         request_payload = $3::jsonb,
         response_payload = $4::jsonb,
         hierarchy = $5::jsonb,
         survey_numbers = $6::jsonb,
         geometry_geojson = $7::jsonb,
         confidence_score = $8,
         expires_at = NOW() + INTERVAL '30 days',
         updated_at = NOW()
     WHERE cache_key = $1
       AND org_id = current_organization_id()
     RETURNING *`,
    [
      cacheKey,
      kgisResult.status || 'unknown',
      JSON.stringify(payload),
      JSON.stringify(kgisResult.raw || kgisResult),
      JSON.stringify(kgisResult.hierarchy || {}),
      JSON.stringify(kgisResult.survey_numbers || []),
      kgisResult.geometry_geojson ? JSON.stringify(kgisResult.geometry_geojson) : null,
      kgisResult.confidence || 0,
    ]
  );

  if (updateResult.rows[0]) return updateResult.rows[0];

  const insertResult = await query(
    `INSERT INTO regulatory_data.kgis_cache (
       org_id, property_id, cache_key, provider_status, request_payload,
       response_payload, hierarchy, survey_numbers, geometry_geojson,
       confidence_score, expires_at
     )
     VALUES (
       current_organization_id(), $1, $2, $3, $4::jsonb,
       $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
       $9, NOW() + INTERVAL '30 days'
     )
     RETURNING *`,
    [
      property.id,
      cacheKey,
      kgisResult.status || 'unknown',
      JSON.stringify(payload),
      JSON.stringify(kgisResult.raw || kgisResult),
      JSON.stringify(kgisResult.hierarchy || {}),
      JSON.stringify(kgisResult.survey_numbers || []),
      kgisResult.geometry_geojson ? JSON.stringify(kgisResult.geometry_geojson) : null,
      kgisResult.confidence || 0,
    ]
  );

  return insertResult.rows[0] || null;
};

const formatKgis = (cacheRow, liveResult = null) => {
  if (liveResult) {
    return {
      provider: 'kgis',
      status: liveResult.status,
      confidence: liveResult.confidence || 0,
      message: liveResult.message,
      reference_only: true,
      hierarchy: liveResult.hierarchy || null,
      survey_numbers: liveResult.survey_numbers || [],
      geometry_geojson: liveResult.geometry_geojson || null,
      refreshed_at: new Date().toISOString(),
      citations: [
        {
          id: 'kgis-reference',
          kind: 'kgis',
          label: 'K-GIS reference lookup',
          source_url: VERIFICATION_LINKS.kgis_protocol,
          authority: 'Karnataka GIS',
          status: 'reference_only',
        },
      ],
    };
  }

  if (!cacheRow) {
    return {
      provider: 'kgis',
      status: 'not_requested',
      confidence: 0,
      message: 'K-GIS reference lookup has not been run for this parcel.',
      reference_only: true,
      hierarchy: null,
      survey_numbers: [],
      geometry_geojson: null,
      citations: [],
    };
  }

  return {
    provider: 'kgis',
    status: cacheRow.provider_status,
    confidence: Number(cacheRow.confidence_score || 0),
    message: 'Cached K-GIS reference context. Treat geometry as reference only.',
    reference_only: true,
    hierarchy: cacheRow.hierarchy || null,
    survey_numbers: cacheRow.survey_numbers || [],
    geometry_geojson: cacheRow.geometry_geojson || null,
    refreshed_at: cacheRow.updated_at,
    citations: [
      {
        id: 'kgis-reference',
        kind: 'kgis',
        label: 'K-GIS cached reference lookup',
        source_url: VERIFICATION_LINKS.kgis_protocol,
        authority: 'Karnataka GIS',
        status: 'reference_only',
      },
    ],
  };
};

const saveSnapshot = async ({ propertyId, output, userId }) => {
  try {
    const outputStr = JSON.stringify(output);
    const inputs_hash = hashInputs(output.inputs || {});
    const output_hash = crypto.createHash('sha256').update(outputStr).digest('hex');
    const signature = computeSignature(inputs_hash, output_hash);

    const result = await query(
      `INSERT INTO regulatory_data.parcel_intelligence_snapshots (
         org_id, property_id, inputs_hash, output_json, source_versions, generated_by,
         signature, engine_version
       )
       VALUES (
         current_organization_id(), $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7
       )
       RETURNING id`,
      [
        propertyId,
        inputs_hash,
        outputStr,
        JSON.stringify(output.source_versions || {}),
        userId || null,
        signature,
        ENGINE_VERSION,
      ]
    );
    return { id: result.rows[0]?.id || null, signature };
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Parcel intelligence snapshot skipped:', error.message);
    }
    return { id: null, signature: null };
  }
};

const loadLatestSnapshotMeta = async (propertyId) => {
  try {
    const result = await query(
      `SELECT id, generated_at
       FROM regulatory_data.parcel_intelligence_snapshots
       WHERE property_id = $1
         AND org_id = current_organization_id()
       ORDER BY generated_at DESC
       LIMIT 1`,
      [propertyId]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
};

const buildVerdict = ({ status, confidence, redFlags, buckets, verificationLinks }) => {
  const high = redFlags.filter((flag) => flag.severity === 'high').length;
  const medium = redFlags.filter((flag) => flag.severity === 'medium').length;
  const low = redFlags.filter((flag) => flag.severity === 'low').length;
  const confidencePct = Math.round(Number(confidence?.overall || 0) * 100);
  const needsVerification = buckets?.needs_verification || [];

  let label = 'Screening Ready';
  let tone = 'success';
  if (high > 0) {
    label = 'Do Not Rely Yet';
    tone = 'danger';
  } else if (medium > 0 || confidencePct < 70 || status !== 'reference_ready') {
    label = 'Proceed With Caution';
    tone = 'warning';
  } else if (confidencePct < 80 || low > 0) {
    label = 'Reference Ready';
    tone = 'info';
  }

  const flagSummary = [
    high ? `${high} high` : null,
    medium ? `${medium} medium` : null,
    low ? `${low} low` : null,
  ].filter(Boolean).join(', ');

  const summary = flagSummary
    ? `${flagSummary} flag${high + medium + low === 1 ? '' : 's'}; ${needsVerification.length} item${needsVerification.length === 1 ? '' : 's'} still need verification.`
    : 'No configured high-priority flags; continue with normal authority checks before reliance.';

  const actions = needsVerification.slice(0, 4).map((item) => {
    const label = String(item.label || '').toLowerCase();
    let href = null;
    if (label.includes('guidance')) href = verificationLinks.igr_guidance;
    if (label.includes('kaveri') || label.includes('encumbrance')) href = verificationLinks.kaveri;
    if (label.includes('khata') || label.includes('e-aasthi')) href = verificationLinks.bbmp_eaasthi;

    return {
      label: item.label,
      detail: item.detail,
      href,
      action_type: href ? 'authority_link' : 'internal_review',
    };
  });

  return {
    label,
    tone,
    confidence_pct: confidencePct,
    status,
    summary,
    counts: { high, medium, low, needs_verification: needsVerification.length },
    next_actions: actions,
  };
};

const buildConfidence = ({ zone, buildability, guidance, kgis }) => {
  const zoning = zone?.zone_code ? 0.7 : 0;
  const buildabilityScore =
    buildability?.status === 'reference_match' ? 0.78 : buildability?.rule ? 0.62 : 0;
  const guidanceScore = guidance?.confidence || 0;
  const kgisScore = kgis?.confidence || 0;
  const values = [zoning, buildabilityScore, guidanceScore, kgisScore].filter((value) => value > 0);
  const overall = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  return {
    overall: round(overall, 2),
    zoning: round(zoning, 2),
    buildability: round(buildabilityScore, 2),
    guidance: round(guidanceScore, 2),
    kgis: round(kgisScore, 2),
  };
};

const buildBuckets = ({ property, zone, buildability, guidance, kgis, landeed }) => {
  const verified = [
    {
      label: 'User-provided parcel inputs',
      detail: 'Address, area, road width, coordinates, and survey data are stored as property inputs.',
      source: 'user_provided',
    },
  ];

  if (buildability?.rule) {
    verified.push({
      label: 'Reviewed FAR matrix rule',
      detail: `${buildability.zone_code || 'Zone'} max FAR ${buildability.values?.max_far ?? '-'}`,
      source: buildability.source,
      citations: buildability.citations,
    });
  }

  if (guidance?.selected && guidance.status === 'matched') {
    verified.push({
      label: 'Approved guidance value match',
      detail: `${guidance.selected.locality}${guidance.selected.road_name ? `, ${guidance.selected.road_name}` : ''}`,
      source: guidance.selected.citation?.status || 'global_reference',
      citations: guidance.citations,
    });
  }

  const inferred = [];
  if (buildability?.values?.max_buildable_area_sqft) {
    inferred.push({
      label: 'Screening buildable area',
      detail: `${Math.round(buildability.values.max_buildable_area_sqft).toLocaleString('en-IN')} sqft from effective plot area x max FAR. Gross FAR area is retained separately for audit.`,
      source: 'calculation',
      citations: buildability.citations,
    });
  }
  if (kgis?.hierarchy) {
    inferred.push({
      label: 'K-GIS administrative context',
      detail: [kgis.hierarchy.village, kgis.hierarchy.hobli, kgis.hierarchy.taluk].filter(Boolean).join(', ') || 'Reference hierarchy cached.',
      source: 'reference_only',
      citations: kgis.citations,
    });
  }

  // Stable item keys let the manual-verification flow attach an
  // evidence_links row keyed to a known item (zone, far, guidance, ...) and
  // let the panel render a "verified manually" badge against the same row.
  const needsVerification = [];
  if (!zone?.zone_code) needsVerification.push({ key: 'zoning_assignment', label: 'Assign reviewed RMP zone', detail: 'No zoning rule can be authoritative without reviewed zone assignment.' });
  if (buildability?.status === 'needs_verification') needsVerification.push({ key: 'far_assignment', label: 'Confirm FAR/additional FAR', detail: buildability.message });
  if (!guidance?.selected || guidance.status !== 'matched') needsVerification.push({ key: 'guidance_value', label: 'Confirm guidance value', detail: guidance?.message });
  if (landeed?.status === 'not_configured') needsVerification.push({ key: 'landeed_api', label: 'Landeed vendor API', detail: landeed.message });
  if (property.lat == null || property.lng == null) needsVerification.push({ key: 'coordinates', label: 'Coordinates missing', detail: 'K-GIS hierarchy/survey lookup needs a map pin.' });

  return { verified, inferred, needs_verification: needsVerification };
};

const NEEDS_VERIFICATION_KEYS = new Set([
  'zoning_assignment',
  'far_assignment',
  'guidance_value',
  'landeed_api',
  'coordinates',
]);

const composeParcelIntelligence = async ({ propertyId, userId = null, refresh = false }) => {
  const property = await loadPropertyWithZone(propertyId);
  const zone = property.zone || null;
  const landUseFamily = normalizeLandUseFamily(property, zone);
  const farRules = await loadFarRules({ property, zone, landUseFamily });
  const previousMeta = await loadLatestSnapshotMeta(propertyId);
  const { rule, reason: farReason } = selectFarRule(farRules, {
    landAreaSqft: property.land_area_sqft,
    roadWidthMtrs: property.road_width_mtrs,
    landUseFamily,
  });
  const buildability = computeBuildabilityFromRule({ property, zone, rule });
  if (!rule && farReason) {
    buildability.reason = farReason;
  }

  // T1 — what-if sliders need every candidate rule (not just the selected one)
  // so the client can re-run selectFarRule + computeBuildabilityFromRule when
  // road width / land area change. Strip to the columns the math actually uses.
  buildability.far_rules_candidates = farRules.map((r) => ({
    id: r.id,
    org_id: r.org_id || null,
    zone_code: r.zone_code,
    planning_zone: r.planning_zone,
    land_use_family: r.land_use_family,
    plot_area_min_sqm: r.plot_area_min_sqm,
    plot_area_max_sqm: r.plot_area_max_sqm,
    road_width_min_m: r.road_width_min_m,
    road_width_max_m: r.road_width_max_m,
    base_far: r.base_far,
    additional_far: r.additional_far,
    max_far: r.max_far,
    ground_coverage_pct: r.ground_coverage_pct,
    front_setback_m: r.front_setback_m,
    rear_setback_m: r.rear_setback_m,
    side_setback_m: r.side_setback_m,
    plan_version: r.plan_version,
    plan_status: r.plan_status,
    source_page: r.source_page,
    source_section: r.source_section,
    review_status: r.review_status,
    confidence_score: r.confidence_score,
  }));

  const guidance = await guidanceService.findGuidanceMatches(property);
  const landeed = refresh ? await landeedAdapter.lookupGuidanceValue(property) : landeedAdapter.getStatus();

  let kgisLive = null;
  if (refresh && property.lat != null && property.lng != null) {
    try {
      kgisLive = await kgisAdapter.fetchKgisContext(property);
      await upsertKgisCache(property, kgisLive);
    } catch (error) {
      kgisLive = {
        provider: 'kgis',
        status: 'error',
        confidence: 0,
        message: error.message || 'K-GIS lookup failed.',
        hierarchy: null,
        survey_numbers: [],
        geometry_geojson: null,
        reference_only: true,
      };
    }
  }
  const kgisCache = refresh && kgisLive ? null : await getCachedKgis(property);
  const kgis = formatKgis(kgisCache, kgisLive);

  // T6 — OSM road-width inference. Only fire on refresh AND only when the
  // user-provided road width is missing. Never overwrites authority data.
  let osmLive = null;
  const propertyRoadWidth = property.road_width_mtrs == null ? null : Number(property.road_width_mtrs);
  const shouldFetchOsm =
    refresh &&
    propertyRoadWidth === null &&
    property.lat != null &&
    property.lng != null;

  if (shouldFetchOsm) {
    try {
      osmLive = await osmRoadAdapter.fetchRoadWidth({ lat: property.lat, lng: property.lng });
      if (osmLive) await upsertOsmRoadCache(property, osmLive);
    } catch (error) {
      osmLive = {
        provider: 'osm_overpass',
        status: 'error',
        confidence: 0,
        message: error.message || 'OSM Overpass lookup failed.',
        candidate_count: 0,
        inferred_width_m: null,
        inferred_lanes: null,
        inferred_highway: null,
        derivation_method: null,
      };
    }
  }
  const osmCache = refresh && osmLive ? null : await getCachedOsmRoad(property);
  const osmRoad = formatOsmRoad(osmCache, osmLive);

  const citations = [
    ...(buildability.citations || []),
    ...(guidance.citations || []),
    ...(kgis.citations || []),
    ...(osmRoad.citations || []),
  ];
  const redFlags = runParcelRedFlags({ property, zone, buildability, guidance, kgis, landeed, snapshot: { generated_at: previousMeta?.generated_at || null } });
  const confidence = buildConfidence({ zone, buildability, guidance, kgis });
  const buckets = buildBuckets({ property, zone, buildability, guidance, kgis, landeed });
  const verdict = buildVerdict({
    status: redFlags.some((flag) => flag.severity === 'high') ? 'needs_verification' : 'reference_ready',
    confidence,
    redFlags,
    buckets,
    verificationLinks: VERIFICATION_LINKS,
  });

  const output = {
    property_id: property.id,
    generated_at: new Date().toISOString(),
    mode: 'screening_decision_support',
    legal_disclaimer: 'Parcel Intelligence is verified decision support for screening, underwriting, and IC prep. It is not legal clearance or authority approval.',
    status: verdict.status,
    verdict,
    confidence,
    inputs: {
      name: property.display_name || property.name || null,
      address: property.address || null,
      city: property.city || null,
      state: property.state || null,
      survey_number: property.survey_number || null,
      land_area_sqft: property.land_area_sqft ? Number(property.land_area_sqft) : null,
      road_width_mtrs: property.road_width_mtrs ? Number(property.road_width_mtrs) : null,
      lat: property.lat === null || property.lat === undefined ? null : Number(property.lat),
      lng: property.lng === null || property.lng === undefined ? null : Number(property.lng),
      source: 'user_provided',
    },
    zoning: {
      status: zone?.zone_code ? 'assigned_reference' : 'needs_verification',
      source: zone?.org_id ? 'org_override' : zone?.zone_code ? 'global_reference' : 'not_assigned',
      zone_id: zone?.id || null,
      zone_code: zone?.zone_code || null,
      zone_name: zone?.zone_name || property.zoning || null,
      planning_zone: zone?.planning_zone || null,
      land_use_family: landUseFamily,
      plan_version: zone?.plan_version || buildability.rule?.plan_version || 'RMP 2031 Draft',
      plan_status: zone?.plan_status || buildability.rule?.plan_status || 'draft_reference',
      notes: property.zone_notes || null,
    },
    buildability,
    guidance_value: {
      official: guidance,
      vendor: landeed,
      selected: guidance.selected || (landeed.status === 'matched' ? landeed : null),
    },
    kgis,
    osm_road: osmRoad,
    red_flags: redFlags,
    citations,
    buckets,
    // Rich, context-aware list of authority deep links / hints / copy-text.
    // Replaces the flat VERIFICATION_LINKS map (still exported for callers
    // that only need the bare URLs).
    verification_links: buildVerificationLinks({ property, kgis }),
    source_versions: {
      rmp: buildability.rule?.plan_version || 'RMP 2031 Draft',
      guidance: guidance.selected?.effective_from || null,
      kgis: kgis.refreshed_at || null,
      landeed: landeed.status,
    },
  };

  // Always expose a snapshot_id so the frontend can attach manual evidence
  // links via the polymorphic evidence-links endpoint. On refresh we use the
  // newly-saved row; on read we use the prior snapshot loaded at compose-start.
  if (refresh) {
    const { id: newId, signature } = await saveSnapshot({ propertyId, output, userId });
    output.snapshot_id = newId || previousMeta?.id || null;
    output.signature = signature || null;
  } else {
    output.snapshot_id = previousMeta?.id || null;
    output.signature = null;
  }
  return output;
};

const getParcelIntelligence = (propertyId, userId = null) =>
  composeParcelIntelligence({ propertyId, userId, refresh: false });

const refreshParcelIntelligence = async (propertyId, userId = null) => {
  const output = await composeParcelIntelligence({ propertyId, userId, refresh: true });

  // The verdict label is short and investor-grade — perfect for a timeline
  // line. The fan-out from property → deal(s) happens inside the event sink.
  const summary = output?.verdict?.label
    || (output?.confidence?.overall != null
      ? `${Math.round(Number(output.confidence.overall) * 100)}% confidence`
      : null);

  try {
    publish(EVENTS.PARCEL_INTELLIGENCE_REFRESHED, {
      propertyId,
      userId,
      summary,
    });
  } catch {
    // never block the refresh response on telemetry
  }

  return output;
};

const verifySnapshotSignature = async (snapshotId) => {
  const result = await query(
    `SELECT inputs_hash, output_json, signature, engine_version
     FROM regulatory_data.parcel_intelligence_snapshots
     WHERE id = $1
       AND org_id = current_organization_id()`,
    [snapshotId]
  );

  if (!result.rows[0]) {
    throw createError('Snapshot not found.', 404);
  }

  const row = result.rows[0];

  if (!row.signature) {
    return { valid: false, reason: 'unsigned', snapshot_id: snapshotId, engine_version: row.engine_version || null };
  }

  if (!process.env.PARCEL_SIGNING_SECRET) {
    return { valid: false, reason: 'secret_not_configured', snapshot_id: snapshotId, engine_version: row.engine_version };
  }

  const output_hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(row.output_json))
    .digest('hex');
  const expected = computeSignature(row.inputs_hash, output_hash);

  const valid = crypto.timingSafeEqual(
    Buffer.from(row.signature, 'hex'),
    Buffer.from(expected, 'hex')
  );

  return { valid, snapshot_id: snapshotId, engine_version: row.engine_version };
};

module.exports = {
  getParcelIntelligence,
  refreshParcelIntelligence,
  normalizeLandUseFamily,
  loadLatestSnapshotMeta,
  verifySnapshotSignature,
  NEEDS_VERIFICATION_KEYS,
  VERIFICATION_LINKS,
};
