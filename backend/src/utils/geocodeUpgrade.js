'use strict';

/**
 * Tier-1 #10 finish — pure two-stage geocode upgrade logic.
 *
 * Pulled out of `scripts/upgrade-comps-geocoding.mjs` so:
 *   1. The script is no longer the only place this lives — a future
 *      admin endpoint can call the same logic.
 *   2. The two-stage fallback can be unit-tested with a mocked
 *      `fetchImpl` instead of a live Google call.
 *
 * Stage 1 — `(project_name, locality, city, India)` query.
 *   This is the precise query the historical script always used. If
 *   the result lands within 5 km of the existing locality centroid,
 *   we accept it (the project is in the locality the comp says it
 *   is in).
 *
 * Stage 2 — `(project_name, city, India)` query, fired only when:
 *   • Stage 1 returned a result that drifts > 5 km from the locality
 *     centroid (i.e., Google says the project is somewhere else
 *     entirely — likely the comp's locality field is wrong, or the
 *     project name is ambiguous).
 *   • The fallback flag is enabled.
 *
 *   We accept stage-2 ONLY if the location_type is rooftop or
 *   range_interpolated (high-precision matches). For lower-precision
 *   matches we keep the existing locality centroid — better to be
 *   honestly imprecise than confidently wrong.
 *
 * Per CLAUDE.md hard rules:
 *   • Never fabricate market / GIS facts. Falling back to a wrong
 *     coord because Google matched a same-named place is fabrication.
 *     The 5 km drift guard + the "stage-2 must be high-precision"
 *     rule are both honesty rails.
 *   • Math is deterministic JS, never the LLM. Haversine here is
 *     the same formula used in `compSimilarity.js`.
 */

const haversineKm = (a, b) => {
  if (a == null || b == null || a.lat == null || b.lat == null
      || b.lng == null || a.lng == null
      || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(aa));
};

const QUALITY_RANK = {
  rooftop: 5,
  range_interpolated: 4,
  geometric_center: 3,
  approximate: 2,
  locality_centroid: 1,
  manual: 6, // reviewer override always wins
};

const isUpgrade = (oldQ, newQ) =>
  (QUALITY_RANK[newQ] || 0) > (QUALITY_RANK[oldQ] || 0);

const mapLocationType = (t) => {
  switch (t) {
    case 'ROOFTOP': return 'rooftop';
    case 'RANGE_INTERPOLATED': return 'range_interpolated';
    case 'GEOMETRIC_CENTER': return 'geometric_center';
    case 'APPROXIMATE': return 'approximate';
    default: return 'approximate';
  }
};

const HIGH_PRECISION_QUALITIES = new Set(['rooftop', 'range_interpolated']);

const MAX_DRIFT_KM_DEFAULT = 5;

// ── Stage 1 + Stage 2 fetch wrappers ──────────────────────────────────────

/**
 * Run a single Google Geocoding API request. The fetch implementation is
 * injected so tests can stub it. Returns the first result or null on
 * ZERO_RESULTS. Throws on REQUEST_DENIED / OVER_QUERY_LIMIT.
 */
const geocodeOnce = async (query, { apiKey, fetchImpl }) => {
  if (!apiKey) throw new Error('Google API key is required.');
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'in');
  url.searchParams.set('key', apiKey);

  const res = await fetchImpl(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();

  if (json.status === 'REQUEST_DENIED' || json.status === 'OVER_QUERY_LIMIT') {
    throw new Error(`Google API failure: ${json.status} ${json.error_message || ''}`);
  }
  if (json.status === 'ZERO_RESULTS' || !Array.isArray(json.results) || !json.results.length) {
    return null;
  }

  const r = json.results[0];
  const loc = r.geometry?.location || {};
  return {
    lat: loc.lat,
    lng: loc.lng,
    locationType: r.geometry?.location_type,
    formattedAddress: r.formatted_address,
    placeId: r.place_id,
  };
};

// ── Locality extraction from formatted_address ────────────────────────────

/**
 * Extract a likely locality string from Google's `formatted_address`.
 * Used by Stage 2 when we cross-locality-correct a comp — we want to
 * surface "this row's locality is now X" so the operator can spot-check.
 *
 * Google Bengaluru addresses typically read:
 *   "Building, 12, Some Road, <Locality>, <Sub-locality>, Bengaluru,
 *    Karnataka 560<xxx>, India"
 *
 * We pull the segment immediately before "Bengaluru" / city, when
 * present. Returns null if we can't confidently locate one.
 */
const extractLocalityFromFormatted = (formattedAddress, city) => {
  if (!formattedAddress || typeof formattedAddress !== 'string') return null;
  const parts = formattedAddress.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || !city) return null;
  const cityLow = String(city).toLowerCase();
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].toLowerCase().startsWith(cityLow)) {
      // The segment immediately before the city is the
      // locality / sub-locality the analyst recognizes
      // ("Whitefield", "Hebbal", "Indiranagar"). Earlier
      // segments are usually building/road names.
      if (i >= 1) return parts[i - 1];
      return null;
    }
  }
  return null;
};

// ── Outcome builder ──────────────────────────────────────────────────────

/**
 * Decide what to do with a comp row given an old coord and a Google
 * Geocoding response. Returns one of:
 *   { action: 'skip',        reason: 'no_match' | 'no_upgrade' | 'drift' | 'stage2_low_precision' }
 *   { action: 'accept',      stage: 1 | 2, lat, lng, quality, drift_km, locality?: string }
 *
 * The route-layer / script-layer caller decides what to do with the
 * outcome (commit to DB, log, etc.). This pure function stays
 * side-effect-free for testability.
 */
const decideOutcome = ({
  stage,                // 1 | 2
  oldCoord,             // { lat, lng } — locality centroid
  oldQuality,           // string from QUALITY_RANK keys
  result,               // { lat, lng, locationType, formattedAddress } | null
  maxDriftKm = MAX_DRIFT_KM_DEFAULT,
  city = null,
}) => {
  if (!result) return { action: 'skip', reason: 'no_match' };

  const newQuality = mapLocationType(result.locationType);
  if (!isUpgrade(oldQuality, newQuality)) {
    return { action: 'skip', reason: 'no_upgrade', newQuality };
  }

  const newCoord = { lat: Number(result.lat), lng: Number(result.lng) };
  const drift = haversineKm(oldCoord, newCoord);

  if (stage === 1) {
    // Stage 1: drift > 5 km against the locality centroid is a red
    // flag — Google probably matched a same-named place elsewhere.
    // Bubble that up so the caller knows to try stage 2.
    if (drift != null && drift > maxDriftKm) {
      return { action: 'skip', reason: 'drift', drift_km: drift, newQuality };
    }
    return {
      action: 'accept',
      stage: 1,
      lat: newCoord.lat,
      lng: newCoord.lng,
      quality: newQuality,
      drift_km: drift,
    };
  }

  // Stage 2: project + city only. We've already abandoned the locality
  // assumption, so drift isn't a useful guard anymore. Instead we
  // demand high-precision (rooftop / range_interpolated) — the whole
  // point of stage 2 is to get a precise pin in a different locality.
  // An APPROXIMATE result is just "Bengaluru somewhere," which is
  // strictly worse than the locality centroid we already had.
  if (!HIGH_PRECISION_QUALITIES.has(newQuality)) {
    return { action: 'skip', reason: 'stage2_low_precision', newQuality, drift_km: drift };
  }

  return {
    action: 'accept',
    stage: 2,
    lat: newCoord.lat,
    lng: newCoord.lng,
    quality: newQuality,
    drift_km: drift,
    locality: extractLocalityFromFormatted(result.formattedAddress, city),
    formatted_address: result.formattedAddress,
  };
};

// ── Public: two-stage upgrade ────────────────────────────────────────────

/**
 * Try to upgrade one comp's coords. Two-stage:
 *   1. (project, locality, city, India) — accept if drift ≤ MAX_DRIFT_KM.
 *   2. (project, city, India) — fired only when stage 1 drifted out and
 *      `allowCrossLocality` is true. Accept only at high precision.
 *
 * Returns:
 *   { action: 'accept', stage, lat, lng, quality, drift_km, locality? }
 *   | { action: 'skip', reason, ...detail }
 *
 * Side-effect-free. The caller owns the DB write.
 */
const upgradeOneComp = async ({
  comp,                  // { project_name, locality, city, lat, lng, geocode_quality }
  apiKey,
  fetchImpl,
  maxDriftKm = MAX_DRIFT_KM_DEFAULT,
  allowCrossLocality = false,
}) => {
  if (!comp || !comp.project_name || !comp.city) {
    return { action: 'skip', reason: 'missing_fields' };
  }
  const oldQuality = comp.geocode_quality || 'locality_centroid';
  const oldCoord = {
    lat: Number(comp.lat),
    lng: Number(comp.lng),
  };

  // Stage 1: precise query.
  const stage1Query = [comp.project_name, comp.locality, comp.city, 'India']
    .filter(Boolean)
    .join(', ');
  const stage1Result = await geocodeOnce(stage1Query, { apiKey, fetchImpl });
  const stage1Outcome = decideOutcome({
    stage: 1,
    oldCoord,
    oldQuality,
    result: stage1Result,
    maxDriftKm,
    city: comp.city,
  });

  if (stage1Outcome.action === 'accept') return stage1Outcome;

  // Bail out unless the failure was specifically "drift" AND fallback is
  // enabled. no_match / no_upgrade are real signals; we don't want to
  // burn another API call for them.
  if (stage1Outcome.reason !== 'drift' || !allowCrossLocality) {
    return stage1Outcome;
  }

  // Stage 2: project + city only.
  const stage2Query = [comp.project_name, comp.city, 'India']
    .filter(Boolean)
    .join(', ');
  const stage2Result = await geocodeOnce(stage2Query, { apiKey, fetchImpl });
  return decideOutcome({
    stage: 2,
    oldCoord,
    oldQuality,
    result: stage2Result,
    maxDriftKm,
    city: comp.city,
  });
};

module.exports = {
  haversineKm,
  isUpgrade,
  mapLocationType,
  extractLocalityFromFormatted,
  decideOutcome,
  upgradeOneComp,
  geocodeOnce,
  QUALITY_RANK,
  HIGH_PRECISION_QUALITIES,
  MAX_DRIFT_KM_DEFAULT,
};
