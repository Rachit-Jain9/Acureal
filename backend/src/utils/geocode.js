'use strict';

/**
 * Geocoding for Indian addresses.
 * Primary:  Google Maps Geocoding API (requires GOOGLE_MAPS_API_KEY, server-side only)
 * Fallback: Nominatim / OpenStreetMap (free, rate-limited to ~1 req/sec)
 *
 * Cache: Results are persisted to geocode_cache table (30-day TTL) to avoid
 *        redundant external API calls for the same address.
 *
 * Geocode status values stored on properties:
 *   verified    – high-confidence match (place_id or full address match)
 *   approximate – city-level match only (confidence < 0.6)
 *   failed      – no match found
 *   pending     – not yet geocoded
 *   manual      – coordinates set manually by user (pin drag)
 */

const axios = require('axios');
let dbQuery = null;
const getDb = () => {
  if (!dbQuery) dbQuery = require('../config/database').query;
  return dbQuery;
};

const GOOGLE_MAPS_KEY = () => process.env.GOOGLE_MAPS_API_KEY;

const isGoogleConfigured = () => {
  const key = GOOGLE_MAPS_KEY();
  return key && !/your[_-]/i.test(key) && !key.startsWith('[') && key.startsWith('AIza');
};

// ─── GOOGLE MAPS ──────────────────────────────────────────────────────────────

const geocodeWithGoogle = async (address, city, state, pincode) => {
  const parts = [address, city, state, pincode, 'India'].filter(Boolean);
  const fullAddress = parts.join(', ');

  if (!fullAddress || fullAddress === 'India') {
    return { found: false, status: 'insufficient_data', message: 'Insufficient address data to geocode.' };
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: fullAddress,
        region: 'in',
        key: GOOGLE_MAPS_KEY(),
      },
      timeout: 10000,
    });

    const data = response.data;

    if (data.status === 'REQUEST_DENIED') {
      console.warn('[Geocode] Google Maps API key denied:', data.error_message);
      return null; // trigger fallback
    }

    if (data.status === 'OK' && data.results?.length > 0) {
      const result = data.results[0];
      const { lat, lng } = result.geometry.location;
      const types = result.types || [];

      // Determine confidence and status from result precision
      const isPointMatch = types.some((t) => ['premise', 'street_address', 'route', 'sublocality', 'neighborhood'].includes(t));
      const isCityMatch  = types.some((t) => ['locality', 'administrative_area_level_2'].includes(t));

      let status = 'verified';
      let confidence = 0.92;

      if (isCityMatch && !isPointMatch) {
        status = 'approximate';
        confidence = 0.45;
      } else if (!isPointMatch && !isCityMatch) {
        status = 'approximate';
        confidence = 0.30;
      }

      return {
        found: true,
        lat,
        lng,
        displayName: result.formatted_address,
        placeId: result.place_id,
        status,
        confidence,
        message: `Google Maps: ${result.formatted_address}`,
        provider: 'google',
      };
    }

    if (data.status === 'ZERO_RESULTS') {
      // Try city-only fallback via Google
      if (city) {
        const fallbackParts = [city, state || 'India', 'India'].filter(Boolean);
        const cityResponse = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
          params: { address: fallbackParts.join(', '), region: 'in', key: GOOGLE_MAPS_KEY() },
          timeout: 8000,
        });

        if (cityResponse.data.status === 'OK' && cityResponse.data.results?.length > 0) {
          const r = cityResponse.data.results[0];
          const { lat, lng } = r.geometry.location;
          return {
            found: true,
            lat,
            lng,
            displayName: r.formatted_address,
            placeId: r.place_id,
            status: 'approximate',
            confidence: 0.45,
            message: `Google Maps city-level fallback: ${r.formatted_address}`,
            provider: 'google',
          };
        }
      }

      return { found: false, status: 'failed', message: 'No geocode match found via Google Maps.' };
    }

    console.warn('[Geocode] Google Maps unexpected status:', data.status);
    return null; // trigger Nominatim fallback
  } catch (error) {
    console.error('[Geocode] Google Maps error:', error.message);
    return null; // trigger Nominatim fallback
  }
};

// ─── GOOGLE PLACES TEXT SEARCH (SECOND-TRY before Nominatim) ─────────────────
//
// Why this exists: the Google Geocoding API and Google Places API are
// separate products with separate API-enable flags in GCP. Many operators
// (correctly) enable Places (used by `/properties/geocode/search`
// autocomplete) but forget to enable Geocoding — so geocodeWithGoogle
// returns REQUEST_DENIED silently and the orchestrator falls all the way
// through to Nominatim. Nominatim is fine for verified-street addresses
// but routinely returns city-level fallbacks for apartment-name style
// addresses (the Jigani regression on 2026-05-18 was caused by this).
//
// Places Text Search excels at exactly those addresses — apartment +
// landmark + locality strings. It returns place_id + geometry + formatted
// address, which we map to the same shape geocodeWithGoogle returns so
// the orchestrator can treat the result identically.
const geocodeWithGooglePlaces = async (address, city, state, pincode) => {
  const parts = [address, city, state, pincode, 'India'].filter(Boolean);
  const fullAddress = parts.join(', ');

  if (!fullAddress || fullAddress === 'India') {
    return { found: false, status: 'insufficient_data', message: 'Insufficient address data to geocode.', provider: 'google_places' };
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: {
        query: fullAddress,
        region: 'in',
        key: GOOGLE_MAPS_KEY(),
      },
      timeout: 10000,
    });

    const data = response.data;

    if (data.status === 'REQUEST_DENIED') {
      console.warn('[Geocode] Google Places denied:', data.error_message);
      return { found: false, status: 'failed', message: `Google Places denied: ${data.error_message || 'API not authorised'}`, provider: 'google_places' };
    }

    if (data.status === 'OK' && data.results?.length > 0) {
      const result = data.results[0];
      const { lat, lng } = result.geometry.location;
      // Places Text Search confidence is harder to derive than Geocoding's
      // `types` array. Heuristic: an `establishment` (named place) hit is
      // a high-confidence point match; a `geocode` hit on a vague query
      // is approximate. Default conservatively to 0.85 for `establishment`
      // and 0.65 for everything else — both above the 0.7 trust threshold's
      // boundary only when establishment-typed.
      const isEstablishment = (result.types || []).includes('establishment');
      const confidence = isEstablishment ? 0.85 : 0.65;
      const status = isEstablishment ? 'verified' : 'approximate';
      return {
        found: true,
        lat,
        lng,
        displayName: result.formatted_address,
        placeId: result.place_id,
        status,
        confidence,
        message: `Google Places: ${result.formatted_address}`,
        provider: 'google_places',
        // Surface the Places types so the orchestrator can audit what was matched.
        place_types: result.types || [],
      };
    }

    if (data.status === 'ZERO_RESULTS') {
      return { found: false, status: 'failed', message: 'No Google Places match.', provider: 'google_places' };
    }

    return { found: false, status: 'failed', message: `Google Places unexpected status: ${data.status}`, provider: 'google_places' };
  } catch (error) {
    console.error('[Geocode] Google Places error:', error.message);
    return { found: false, status: 'failed', message: `Google Places error: ${error.message}`, provider: 'google_places' };
  }
};

// ─── NOMINATIM (FALLBACK) ─────────────────────────────────────────────────────

const geocodeWithNominatim = async (address, city, state, pincode) => {
  const parts = [address, city, state, pincode, 'India'].filter(Boolean);
  const fullAddress = parts.join(', ');

  if (!fullAddress || fullAddress === 'India') {
    return { found: false, status: 'insufficient_data', message: 'Insufficient address data to geocode.' };
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: fullAddress, format: 'json', limit: 1, countrycodes: 'in' },
      headers: { 'User-Agent': 'REDIP/1.0 (Real Estate Development Intelligence Platform)' },
      timeout: 10000,
    });

    if (response.data?.length > 0) {
      return {
        found: true,
        lat: parseFloat(response.data[0].lat),
        lng: parseFloat(response.data[0].lon),
        displayName: response.data[0].display_name,
        status: 'verified',
        confidence: 0.85,
        message: 'Nominatim: full address match.',
        provider: 'nominatim',
      };
    }

    if (city || state) {
      const fallbackResponse = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { city, state, country: 'India', format: 'json', limit: 1 },
        headers: { 'User-Agent': 'REDIP/1.0 (Real Estate Development Intelligence Platform)' },
        timeout: 10000,
      });

      if (fallbackResponse.data?.length > 0) {
        return {
          found: true,
          lat: parseFloat(fallbackResponse.data[0].lat),
          lng: parseFloat(fallbackResponse.data[0].lon),
          displayName: fallbackResponse.data[0].display_name,
          status: 'approximate',
          confidence: 0.45,
          message: 'Nominatim: city-level fallback only.',
          provider: 'nominatim',
        };
      }
    }

    return { found: false, status: 'failed', message: 'No geocode match found via Nominatim.' };
  } catch (error) {
    console.error('[Geocode] Nominatim error:', error.message);
    return { found: false, status: 'failed', message: `Geocoding service unavailable: ${error.message}` };
  }
};

// ─── CACHE ────────────────────────────────────────────────────────────────────

const normalizeCacheKey = (address, city, state, pincode) => {
  const parts = [address, city, state, pincode, 'india'].filter(Boolean).map((p) => p.toLowerCase().trim());
  return parts.join('|');
};

const readFromCache = async (cacheKey) => {
  try {
    const db = getDb();
    const result = await db(
      `SELECT * FROM geocode_cache
       WHERE cache_key = $1 AND expires_at > NOW()
       LIMIT 1`,
      [cacheKey]
    );
    if (result.rows.length === 0) return null;

    // Increment hit count
    await db('UPDATE geocode_cache SET hit_count = hit_count + 1 WHERE cache_key = $1', [cacheKey]);

    const row = result.rows[0];
    return {
      found: row.status !== 'failed',
      lat: row.lat ? parseFloat(row.lat) : null,
      lng: row.lng ? parseFloat(row.lng) : null,
      displayName: row.formatted_address,
      placeId: row.place_id,
      status: row.status,
      confidence: row.confidence ? parseFloat(row.confidence) : null,
      message: `[cache hit] ${row.formatted_address || ''}`,
      provider: row.provider,
      fromCache: true,
    };
  } catch (err) {
    // Cache is a best-effort optimization; never block geocoding on cache errors
    console.warn('[Geocode] Cache read error (non-fatal):', err.message);
    return null;
  }
};

const writeToCache = async (cacheKey, result) => {
  if (!result) return;
  try {
    const db = getDb();
    await db(
      `INSERT INTO geocode_cache
         (cache_key, place_id, lat, lng, formatted_address, provider, confidence, status, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW() + INTERVAL '30 days')
       ON CONFLICT (cache_key) DO UPDATE SET
         place_id = EXCLUDED.place_id,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         formatted_address = EXCLUDED.formatted_address,
         provider = EXCLUDED.provider,
         confidence = EXCLUDED.confidence,
         status = EXCLUDED.status,
         fetched_at = NOW(),
         expires_at = NOW() + INTERVAL '30 days',
         hit_count = geocode_cache.hit_count + 1`,
      [
        cacheKey,
        result.placeId || null,
        result.lat || null,
        result.lng || null,
        result.displayName || null,
        result.provider || 'unknown',
        result.confidence || null,
        result.status || 'failed',
      ]
    );
  } catch (err) {
    console.warn('[Geocode] Cache write error (non-fatal):', err.message);
  }
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

const geocodeAddress = async (address, city, state, pincode) => {
  const cacheKey = normalizeCacheKey(address, city, state, pincode);

  // Try cache first
  const cached = await readFromCache(cacheKey);
  if (cached) return cached;

  // Live geocode — provider chain:
  //   1. Google Geocoding API (best for street addresses; needs Geocoding
  //      API enabled in GCP)
  //   2. Google Places Text Search (best for apartment/landmark/locality;
  //      needs Places API enabled in GCP — likely already enabled because
  //      the autocomplete proxy uses it)
  //   3. Nominatim (free, rate-limited, last resort)
  //
  // Places is tried as a second-chance in TWO conditions:
  //   (a) Geocoding returned null (denied / errored / not enabled)
  //   (b) Geocoding returned a low-confidence approximate match — this
  //       happens for apartment-name addresses (e.g. "Thyme Park
  //       Apartments Jigani" geocodes to just "Jigani" at 0.45). Places
  //       Text Search frequently resolves these to the specific
  //       establishment with 0.85 confidence. The Jigani regression
  //       (2026-05-18) motivated this second branch.
  let result;
  if (isGoogleConfigured()) {
    result = await geocodeWithGoogle(address, city, state, pincode);
    const geocodingWasApproximate =
      result && result.found === true && (
        result.status === 'approximate' ||
        (typeof result.confidence === 'number' && result.confidence < 0.7)
      );

    if (result === null || geocodingWasApproximate) {
      const placesResult = await geocodeWithGooglePlaces(address, city, state, pincode);
      if (placesResult?.found) {
        // Prefer Places ONLY if it's strictly better than what Geocoding
        // gave us. Verified (establishment) beats Geocoding's approximate;
        // a Places `geocode`-typed 0.65 is a wash with Geocoding's 0.45
        // city-fallback — only swap when Places is clearly verified or
        // when Geocoding returned null.
        const placesIsBetter =
          result === null ||
          placesResult.status === 'verified' ||
          (typeof placesResult.confidence === 'number' &&
           typeof result.confidence === 'number' &&
           placesResult.confidence > result.confidence + 0.1);

        if (placesIsBetter) {
          result = placesResult;
        }
        // else: stick with Geocoding's approximate result — the gate
        // banner in parcelContext.service will fire, the operator
        // switches to coordinate input.
      } else if (result === null) {
        // Both Google paths failed. Fall through to Nominatim — but
        // keep the Places failure message visible so the cached result
        // explains WHY we ended up at Nominatim.
        result = await geocodeWithNominatim(address, city, state, pincode);
        if (result && placesResult?.message && !placesResult.found) {
          // Annotate the Nominatim result with the upstream Google
          // failure context. The parcelContext.service surfaces this
          // in the AutoFillCard so the operator sees the root cause.
          result.upstream_failure = placesResult.message;
        }
      }
      // else: Geocoding's approximate result stays as the winner; Places
      // didn't improve on it (or also failed). Gate will fire downstream.
    }
  } else {
    result = await geocodeWithNominatim(address, city, state, pincode);
  }

  // Cache the result (even failures, to avoid hammering the API)
  if (result) await writeToCache(cacheKey, result);

  return result;
};

// Diagnostic — runs the FULL provider chain (cache-skip) and returns the
// raw output of each step + which step ultimately won. Used by the new
// admin diagnostic endpoint so the operator can debug WHY a given
// address falls back to Nominatim (almost always: Geocoding API not
// enabled in GCP, even though Places might be).
const geocodeDiagnostic = async (address, city, state, pincode) => {
  const diagnostic = {
    input: { address, city, state, pincode },
    google_configured: isGoogleConfigured(),
    google_geocoding: null,
    google_places: null,
    nominatim: null,
    winner: null,
  };

  if (isGoogleConfigured()) {
    diagnostic.google_geocoding = await geocodeWithGoogle(address, city, state, pincode);
    diagnostic.google_places = await geocodeWithGooglePlaces(address, city, state, pincode);
  }
  diagnostic.nominatim = await geocodeWithNominatim(address, city, state, pincode);

  if (diagnostic.google_geocoding?.found) diagnostic.winner = 'google_geocoding';
  else if (diagnostic.google_places?.found) diagnostic.winner = 'google_places';
  else if (diagnostic.nominatim?.found) diagnostic.winner = 'nominatim';
  else diagnostic.winner = null;

  return diagnostic;
};

module.exports = {
  geocodeAddress,
  geocodeDiagnostic,
  // Exported for tests
  _internal: {
    isGoogleConfigured,
    geocodeWithGoogle,
    geocodeWithGooglePlaces,
    geocodeWithNominatim,
  },
};
