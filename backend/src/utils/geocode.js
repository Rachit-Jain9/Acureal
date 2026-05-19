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

// PR-NX78 (2026-05-19) — Dedupe address parts before sending to Google.
//
// Bug: parcelContext.service.js calls
//   geocodeAddress(trimmedAddress, 'Bengaluru', 'Karnataka', null)
// where `trimmedAddress` is the user-typed string which OFTEN already
// includes ", Bengaluru, Karnataka 560105" at the end. The previous
// `[address, city, state, pincode, 'India'].join(', ')` then produced
// "..., Jigani, Bengaluru, Karnataka 560105, Bengaluru, Karnataka, India"
// with duplicated tokens — Google Geocoding returns a low-confidence
// random match (Jigani diagnostic: 0.3 approximate to "ITI Colony" in
// north Bengaluru) because the parser gets confused by the redundancy.
//
// Fix: only append city/state/pincode/country if they're not already
// substrings of the address (case-insensitive). The clean
// non-redundant address is what Google Places returns 0.85 verified on.
const buildFullAddress = (address, city, state, pincode) => {
  const baseAddress = String(address || '').trim();
  const baseLower = baseAddress.toLowerCase();
  const candidates = [
    baseAddress,
    city && !baseLower.includes(String(city).toLowerCase()) ? city : null,
    state && !baseLower.includes(String(state).toLowerCase()) ? state : null,
    pincode && !baseLower.includes(String(pincode).toLowerCase()) ? pincode : null,
    !baseLower.includes('india') ? 'India' : null,
  ];
  return candidates.filter(Boolean).join(', ');
};

// ─── GOOGLE MAPS ──────────────────────────────────────────────────────────────

const geocodeWithGoogle = async (address, city, state, pincode) => {
  // PR-NX78: use the dedupe helper so we don't send Google a redundant
  // "..., Jigani, Bengaluru, Karnataka 560105, Bengaluru, Karnataka, India" string.
  const fullAddress = buildFullAddress(address, city, state, pincode);

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
  const fullAddress = buildFullAddress(address, city, state, pincode);

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
  const fullAddress = buildFullAddress(address, city, state, pincode);

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

// PR-NX78 (2026-05-19) — Geocoder cascade rewrite.
//
// What changed and why:
//   - OLD order was Geocoding → Places → Nominatim. That works for clean
//     street addresses but fails on Indian apartment/landmark/locality
//     strings like "Thyme Park Apartments, Jigani" — Google Geocoding
//     returns a low-confidence approximate match (Jigani diagnostic: 0.3
//     to "ITI Colony, north Bengaluru"), and the fallback logic was too
//     conservative ("place is verified" required) so the bad Geocoding
//     result often won.
//   - NEW order is Places → Geocoding → Nominatim. Places Text Search
//     excels at Indian apartment/landmark addresses (diagnostic on Jigani:
//     0.85 verified at the exact parcel). Geocoding becomes the second
//     try (good for clean street addresses with sublocality/route types).
//     Nominatim stays as last-resort.
//   - Every branch logs one structured line ("[Geocode orchestrator] …")
//     so Vercel function logs show the full decision path. If something
//     still returns Nominatim, the logs reveal exactly why.
const geocodeAddress = async (address, city, state, pincode) => {
  const cacheKey = normalizeCacheKey(address, city, state, pincode);

  const cached = await readFromCache(cacheKey);
  if (cached) {
    console.log(
      '[Geocode orchestrator] cache_hit',
      JSON.stringify({ cacheKey, provider: cached.provider, confidence: cached.confidence, status: cached.status }),
    );
    return cached;
  }

  console.log(
    '[Geocode orchestrator] cache_miss; google_configured=',
    isGoogleConfigured(),
  );

  if (!isGoogleConfigured()) {
    const nominatim = await geocodeWithNominatim(address, city, state, pincode);
    console.log(
      '[Geocode orchestrator] no_google_falling_to_nominatim',
      JSON.stringify({ found: nominatim?.found, confidence: nominatim?.confidence, status: nominatim?.status }),
    );
    if (nominatim) await writeToCache(cacheKey, nominatim);
    return nominatim;
  }

  // ── Step 1: Google Places Text Search (PRIMARY for India parcels) ─────
  const placesResult = await geocodeWithGooglePlaces(address, city, state, pincode);
  console.log(
    '[Geocode orchestrator] step=1_places',
    JSON.stringify({
      found: placesResult?.found,
      confidence: placesResult?.confidence,
      status: placesResult?.status,
      placeId: placesResult?.placeId,
      types: placesResult?.place_types,
    }),
  );

  // Accept a Places result that's verified OR has confidence ≥ 0.7.
  // Places `establishment` hits are 0.85 → reliable. `geocode` hits at
  // 0.65 still beat Nominatim's 0.45 city-fallback, but we'd rather
  // confirm via Geocoding first.
  if (placesResult?.found && (placesResult.status === 'verified' || (placesResult.confidence ?? 0) >= 0.7)) {
    console.log('[Geocode orchestrator] winner=google_places (high-confidence)');
    await writeToCache(cacheKey, placesResult);
    return placesResult;
  }

  // ── Step 2: Google Geocoding API (BACKUP for clean street addresses) ─
  const geocodingResult = await geocodeWithGoogle(address, city, state, pincode);
  console.log(
    '[Geocode orchestrator] step=2_geocoding',
    JSON.stringify({
      found: geocodingResult?.found,
      confidence: geocodingResult?.confidence,
      status: geocodingResult?.status,
    }),
  );

  // If Geocoding returned a high-confidence point match, prefer it
  // (sublocality/route/premise types are 0.92).
  if (geocodingResult?.found && (geocodingResult.confidence ?? 0) >= 0.7 && geocodingResult.status !== 'approximate') {
    console.log('[Geocode orchestrator] winner=google_geocoding (high-confidence)');
    await writeToCache(cacheKey, geocodingResult);
    return geocodingResult;
  }

  // Both Google paths returned low-confidence. Pick the better of the
  // two if either found anything — Places is usually still better than
  // Geocoding's city fallback for India apartments.
  if (placesResult?.found && (placesResult.confidence ?? 0) > (geocodingResult?.confidence ?? 0)) {
    console.log('[Geocode orchestrator] winner=google_places (best of low-confidence)');
    await writeToCache(cacheKey, placesResult);
    return placesResult;
  }
  if (geocodingResult?.found) {
    console.log('[Geocode orchestrator] winner=google_geocoding (best of low-confidence)');
    await writeToCache(cacheKey, geocodingResult);
    return geocodingResult;
  }

  // ── Step 3: Nominatim (last resort) ──────────────────────────────────
  const nominatim = await geocodeWithNominatim(address, city, state, pincode);
  console.log(
    '[Geocode orchestrator] step=3_nominatim',
    JSON.stringify({ found: nominatim?.found, confidence: nominatim?.confidence, status: nominatim?.status }),
  );

  if (nominatim?.found) {
    // Annotate with upstream Google diagnostics so the AutoFillCard can
    // explain WHY we fell to Nominatim.
    if (placesResult?.message && !placesResult.found) nominatim.upstream_places_failure = placesResult.message;
    if (geocodingResult?.message && !geocodingResult.found) nominatim.upstream_geocoding_failure = geocodingResult.message;
    console.log('[Geocode orchestrator] winner=nominatim (last resort)');
    await writeToCache(cacheKey, nominatim);
    return nominatim;
  }

  console.warn('[Geocode orchestrator] ALL_PROVIDERS_FAILED for', cacheKey);
  return null;
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
