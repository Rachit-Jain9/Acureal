'use strict';

/**
 * Smart Property Capture — orchestrator.
 * --------------------------------------
 * Takes a raw user input (paste from broker WhatsApp, Plus Code, lat/lng,
 * survey number, address, or free-text narrative), classifies it via the
 * pure parser (utils/propertyCaptureParser), resolves it to coordinates +
 * formatted address using whichever provider fits the input type, and
 * then fans out to the existing auto-derive-context pipeline so the
 * candidate already carries BBMP ward, K-GIS hierarchy, guidance value,
 * and verification links by the time the frontend renders the preview.
 *
 * Returns ONE structured "candidate" payload with:
 *   - classification     {type, confidence, hint}
 *   - resolved           {lat, lng, formatted_address, place_id, geocoder}
 *   - context            {bbmp, kgis, planning_district, guidance, verify_links}
 *   - suggestedFields    {name, address, city, state, lat, lng, surveyNumber, ...}
 *   - aiExtraction       {area, asking, asset_class_hint, ...} | null
 *   - warnings           [...]
 *   - provenance         {step_log, providers_called}
 *
 * The frontend uses this to render the preview card; user clicks Save
 * and the frontend POSTs the suggestedFields to /properties.
 *
 * Honesty rules (per CLAUDE.md):
 *   - Never fabricate a coordinate or address. If resolution fails, the
 *     candidate carries warnings and the frontend renders "manual input
 *     required" — never a fake value.
 *   - Every resolved field carries the provider that produced it.
 *   - AI is used ONLY for free-text narrative extraction (Gemini per
 *     AI-routing policy); never to invent missing addresses or
 *     coordinates.
 */

const axios = require('axios');
const { classifyInput } = require('../utils/propertyCaptureParser');
const { geocodeAddress } = require('../utils/geocode');
const parcelContextService = require('./parcelContext.service');

// Hard ceilings to protect the route from abusive payloads.
const MAX_INPUT_LENGTH = 4000;       // 4 KB of pasted text is plenty
const SHORTLINK_FETCH_TIMEOUT = 5000;
const GOOGLE_API_TIMEOUT = 8000;

const GOOGLE_MAPS_KEY = () => (process.env.GOOGLE_MAPS_API_KEY || '').trim();
const hasGoogleKey = () => {
  const k = GOOGLE_MAPS_KEY();
  return k && k.startsWith('AIza');
};

// SSRF guard for shortlink redirect-following. A maps.app.goo.gl Maps share
// link should only ever 30x to a Google-owned host (google.com/maps,
// maps.google.com, …). Re-validating EVERY hop — not just the first URL —
// stops a crafted shortlink from bouncing the server to an internal or
// cloud-metadata address (169.254.169.254, RFC1918, etc.); an IP literal or
// any non-Google host can never satisfy this suffix check.
const isGoogleOwnedHost = (host) => {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  return (
    h === 'google.com' || h.endsWith('.google.com')
    || h === 'google.co.in' || h.endsWith('.google.co.in')
    || h === 'goo.gl' || h.endsWith('.goo.gl')
  );
};

// ─── STEP 1: RESOLVE TO COORDINATES ──────────────────────────────────────────

/**
 * Resolve a Google Maps URL → { lat, lng, formatted_address }.
 *
 * If the URL is a shortlink (maps.app.goo.gl / goo.gl), follow the redirect
 * to get the canonical URL with @lat,lng embedded. Otherwise, the parser
 * already extracted lat/lng from the URL path.
 */
const resolveGoogleMapsUrl = async (parsed, stepLog) => {
  // Canonical /maps URL — coords already extracted.
  if (parsed.latLng) {
    stepLog.push({ step: 'maps_url', detail: 'coords_from_url_path', latLng: parsed.latLng });
    return {
      lat: parsed.latLng.lat,
      lng: parsed.latLng.lng,
      provider: 'google_maps_url',
      confidence: 0.9,
      status: 'verified',
    };
  }

  // Shortlink — follow redirect.
  if (parsed.isShortlink) {
    try {
      // GET with maxRedirects:0 catches the 3xx; the resolved URL is in the
      // Location header. We use HEAD first (cheap) and fall back to GET.
      const resp = await axios.get(parsed.url, {
        maxRedirects: 5,
        timeout: SHORTLINK_FETCH_TIMEOUT,
        validateStatus: (s) => s >= 200 && s < 400,
        // SSRF guard: re-validate the host of EVERY redirect hop. axios's
        // allow-list otherwise only gated the first URL, so a crafted
        // shortlink could 302 the server to an internal / cloud-metadata host.
        beforeRedirect: (options) => {
          const nextHost = options.hostname || options.host;
          if (!isGoogleOwnedHost(nextHost)) {
            throw new Error(`Refusing shortlink redirect to non-Google host: ${nextHost}`);
          }
        },
      });
      const finalUrl = resp.request?.res?.responseUrl || resp.config?.url || parsed.url;
      stepLog.push({ step: 'maps_url', detail: 'shortlink_followed', finalUrl });

      // Re-parse the final URL for coords.
      const { extractGoogleMapsUrl } = require('../utils/propertyCaptureParser');
      const reparsed = extractGoogleMapsUrl(finalUrl);
      if (reparsed?.latLng) {
        return {
          lat: reparsed.latLng.lat,
          lng: reparsed.latLng.lng,
          provider: 'google_maps_shortlink',
          confidence: 0.9,
          status: 'verified',
          resolvedUrl: finalUrl,
        };
      }
      stepLog.push({ step: 'maps_url', detail: 'shortlink_resolved_but_no_coords', finalUrl });
      return null;
    } catch (err) {
      stepLog.push({ step: 'maps_url', detail: 'shortlink_fetch_failed', error: err.message });
      return null;
    }
  }

  return null;
};

/**
 * Resolve a Plus Code → { lat, lng, formatted_address }.
 *
 * Google's Geocoding API accepts Plus Codes as the `address` parameter.
 * Short codes (e.g. "3JV8+P4W") need an area context to disambiguate;
 * we default to "Bengaluru, Karnataka" since Acureal is Bengaluru-priority.
 */
const resolvePlusCode = async (parsed, stepLog) => {
  if (!hasGoogleKey()) {
    stepLog.push({ step: 'plus_code', detail: 'google_not_configured' });
    return null;
  }
  const area = parsed.areaContext || (parsed.isShort ? 'Bengaluru, Karnataka' : null);
  const query = area ? `${parsed.code} ${area}` : parsed.code;
  try {
    const resp = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: query, region: 'in', key: GOOGLE_MAPS_KEY() },
      timeout: GOOGLE_API_TIMEOUT,
    });
    if (resp.data.status === 'OK' && resp.data.results?.length > 0) {
      const r = resp.data.results[0];
      stepLog.push({ step: 'plus_code', detail: 'resolved', formatted: r.formatted_address });
      return {
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        formatted_address: r.formatted_address,
        place_id: r.place_id,
        provider: 'google_plus_code',
        confidence: 0.9,
        status: 'verified',
      };
    }
    stepLog.push({ step: 'plus_code', detail: 'no_results', status: resp.data.status });
    return null;
  } catch (err) {
    stepLog.push({ step: 'plus_code', detail: 'request_failed', error: err.message });
    return null;
  }
};

/**
 * Resolve lat/lng → formatted_address via Google reverse-geocoding.
 * (Coords already in hand; we just need the address.)
 */
const resolveLatLng = async ({ lat, lng }, stepLog) => {
  const base = {
    lat,
    lng,
    provider: 'caller_supplied',
    confidence: 1.0,
    status: 'verified',
  };
  if (!hasGoogleKey()) {
    stepLog.push({ step: 'lat_lng', detail: 'google_not_configured_skipping_reverse_geocode' });
    return base;
  }
  try {
    const resp = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { latlng: `${lat},${lng}`, region: 'in', key: GOOGLE_MAPS_KEY() },
      timeout: GOOGLE_API_TIMEOUT,
    });
    if (resp.data.status === 'OK' && resp.data.results?.length > 0) {
      const r = resp.data.results[0];
      stepLog.push({ step: 'lat_lng', detail: 'reverse_geocoded', formatted: r.formatted_address });
      return {
        ...base,
        formatted_address: r.formatted_address,
        place_id: r.place_id,
      };
    }
    stepLog.push({ step: 'lat_lng', detail: 'reverse_geocode_no_results', status: resp.data.status });
    return base;
  } catch (err) {
    stepLog.push({ step: 'lat_lng', detail: 'reverse_geocode_failed', error: err.message });
    return base;
  }
};

/**
 * Resolve a survey number — the survey number itself is opaque to a
 * geocoder, so we geocode the LOCATION context (e.g. "Devanahalli") and
 * leave surveyNumber as a free-form field for the user to verify via the
 * Bhoomi/K-GIS link.
 */
const resolveSurveyNumber = async ({ surveyNumber, location }, stepLog) => {
  const fallbackLocation = location || 'Bengaluru, Karnataka';
  stepLog.push({ step: 'survey_number', detail: 'geocoding_location', location: fallbackLocation });
  const geo = await geocodeAddress(fallbackLocation, 'Bengaluru', 'Karnataka', null);
  if (geo?.found) {
    return {
      lat: geo.lat,
      lng: geo.lng,
      formatted_address: geo.displayName,
      place_id: geo.placeId,
      provider: geo.provider,
      confidence: geo.confidence,
      status: geo.status,
      surveyNumber,
    };
  }
  return { surveyNumber, status: 'failed', provider: null, confidence: 0 };
};

/**
 * Resolve a plain address via the existing geocoder cascade
 * (Google Places → Google Geocoding → Nominatim).
 */
const resolveAddress = async (text, stepLog) => {
  stepLog.push({ step: 'address', detail: 'geocoding', address: text });
  const geo = await geocodeAddress(text, 'Bengaluru', 'Karnataka', null);
  if (geo?.found) {
    return {
      lat: geo.lat,
      lng: geo.lng,
      formatted_address: geo.displayName,
      place_id: geo.placeId,
      provider: geo.provider,
      confidence: geo.confidence,
      status: geo.status,
    };
  }
  return { status: 'failed', provider: null, confidence: 0 };
};

// ─── FREE-TEXT EXTRACTION via GEMINI ─────────────────────────────────────────

const FREE_TEXT_SYSTEM_PROMPT = `You are a structured-data extractor for an Indian real estate deal-sourcing platform.
You will receive an unstructured paragraph (often a broker WhatsApp message) describing a land opportunity.
Your job is to extract the structured fields. Return ONLY a JSON object with these keys:
{
  "location": "string — the most specific locality / landmark / address mentioned, suitable for geocoding (or null)",
  "city": "string — the city if explicitly mentioned (or null)",
  "land_area_sqft": number_or_null,
  "land_area_acres": number_or_null,
  "asking_price_cr": number_or_null,
  "asking_price_per_sqft_inr": number_or_null,
  "asking_price_per_acre_cr": number_or_null,
  "asset_class_hint": "string — one of: residential_apartments, residential_villas, residential_plots, commercial_office, commercial_retail, industrial, mixed_use, land — or null",
  "deal_structure_hint": "string — one of: outright_purchase, joint_venture, joint_development, revenue_share, tdr — or null",
  "notes": "string — anything else useful (RERA status, builder name, time pressure, broker name) or null"
}
- Do NOT invent values. If a field is not explicitly stated in the input, set it to null.
- Do not include any prose, only the JSON object.
- For Indian inputs: "Cr" or "cr" or "crore" → asking_price_cr. "L" or "lakh" → convert to crore by dividing by 100. "per sqft" or "/sqft" → asking_price_per_sqft_inr.
- Numbers like "2.5 cr" → 2.5. "18 crore" → 18. "12,000 per sqft" → 12000.`;

const extractFreeText = async (text, stepLog) => {
  try {
    // Lazy-load the AI router so the parser library has no AI dependency.
    const { runAI } = require('./ai/aiRouter');
    const providerRegistry = require('./ai/providerRegistry');
    stepLog.push({ step: 'free_text', detail: 'calling_gemini' });
    const { result } = await runAI({
      task: 'document_extraction',
      provider: 'gemini',
      metadata: { prompt_kind: 'property_capture_freetext' },
      run: async ({ providers, model }) => {
        const client = providers.getGeminiClient();
        // Free-text property capture is an EXTRACTION task — same address,
        // pasted twice, must yield the same parcel. This call drives the SDK
        // directly (text-only, so runGeminiInline's document path doesn't
        // apply) and therefore has to opt into the deterministic config
        // explicitly; without it Google's temperature-1.0 default applies.
        const geminiModel = client.getGenerativeModel({
          model,
          generationConfig: providers.GEMINI_READING_CONFIG,
        });
        const out = await geminiModel.generateContent([
          FREE_TEXT_SYSTEM_PROMPT,
          `\n\nInput text:\n${text}`,
        ]);
        return out.response.text().trim();
      },
    });

    // Strip code fences if Gemini wraps the JSON.
    const cleaned = String(result || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    stepLog.push({ step: 'free_text', detail: 'extracted', fields: Object.keys(obj || {}) });
    return obj;
  } catch (err) {
    stepLog.push({ step: 'free_text', detail: 'extraction_failed', error: err.message });
    return null;
  }
};

// ─── STEP 2: ENRICH WITH AUTO-DERIVE-CONTEXT ─────────────────────────────────

const enrichWithContext = async ({ lat, lng, formatted_address }, stepLog) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!formatted_address) {
      stepLog.push({ step: 'enrich', detail: 'skipped_no_coords_no_address' });
      return null;
    }
    stepLog.push({ step: 'enrich', detail: 'address_only' });
    try {
      return await parcelContextService.deriveParcelContextFromAddress({
        address: formatted_address,
        lat: null,
        lng: null,
      });
    } catch (err) {
      stepLog.push({ step: 'enrich', detail: 'failed', error: err.message });
      return null;
    }
  }
  stepLog.push({ step: 'enrich', detail: 'coords' });
  try {
    return await parcelContextService.deriveParcelContextFromAddress({
      address: formatted_address || null,
      lat,
      lng,
    });
  } catch (err) {
    stepLog.push({ step: 'enrich', detail: 'failed', error: err.message });
    return null;
  }
};

// ─── STEP 3: BUILD SUGGESTED FIELDS ──────────────────────────────────────────

const generateName = ({ classification, resolved, ai }) => {
  // For free-text inputs, prefer a name derived from the locality the AI
  // pulled out — that's the most "deal-natural" form.
  if (ai?.location) {
    const cleaned = String(ai.location).split(',')[0].trim();
    if (cleaned) return `Land at ${cleaned}`;
  }
  // For Plus Codes, use the code itself as a discriminator.
  if (classification.type === 'plusCode') {
    const area = classification.parsed.areaContext || 'Bengaluru';
    return `Parcel ${classification.parsed.code} (${area.split(',')[0].trim()})`;
  }
  // For lat/lng-only inputs, derive name from the reverse-geocoded address.
  if (classification.type === 'latLng' && resolved.formatted_address) {
    const first = String(resolved.formatted_address).split(',')[0].trim();
    return `Parcel at ${first}`;
  }
  // For survey-number inputs.
  if (classification.type === 'surveyNumber') {
    const loc = classification.parsed.location || 'Bengaluru';
    return `Survey ${classification.parsed.surveyNumber}, ${loc.split(',')[0].trim()}`;
  }
  // For plain addresses.
  if (resolved.formatted_address) {
    const first = String(resolved.formatted_address).split(',')[0].trim();
    return `Land at ${first}`;
  }
  return 'New parcel (unnamed)';
};

const parsePincodeFromAddress = (addr) => {
  if (!addr) return null;
  const m = String(addr).match(/\b(\d{6})\b/);
  return m ? m[1] : null;
};

const parseCityFromContext = (context, fallback = 'Bengaluru') => {
  // BBMP within-city, default Bengaluru. Outside BBMP, prefer K-GIS taluk.
  // The parcelContext payload uses camelCase: bbmpJurisdiction.withinBbmp
  // and kgis.hierarchy.taluk. (See deriveParcelContextFromAddress output.)
  if (context?.bbmpJurisdiction?.withinBbmp) return 'Bengaluru';
  const taluk = context?.kgis?.hierarchy?.taluk;
  if (taluk) {
    // Taluks like "Anekal" / "Devanahalli" are best as city names for
    // properties outside BBMP.
    return taluk;
  }
  return fallback;
};

const buildSuggestedFields = ({ classification, resolved, context, ai }) => {
  const fields = {
    name: generateName({ classification, resolved, ai }),
    address: resolved.formatted_address || ai?.location || null,
    city: parseCityFromContext(context, ai?.city || 'Bengaluru'),
    state: 'Karnataka',
    pincode: parsePincodeFromAddress(resolved.formatted_address) || null,
    lat: Number.isFinite(resolved.lat) ? resolved.lat : null,
    lng: Number.isFinite(resolved.lng) ? resolved.lng : null,
    placeId: resolved.place_id || null,
    propertyType: 'land',
    zoning: ai?.asset_class_hint === 'commercial_office' || ai?.asset_class_hint === 'commercial_retail'
      ? 'commercial'
      : ai?.asset_class_hint === 'industrial'
      ? 'industrial'
      : 'residential',
    surveyNumber:
      classification.type === 'surveyNumber'
        ? classification.parsed.surveyNumber
        : context?.kgis?.hierarchy?.survey_number || null,
    landAreaSqft: ai?.land_area_sqft || (ai?.land_area_acres ? ai.land_area_acres * 43560 : null),
    landAreaAcres: ai?.land_area_acres || null,
    landAskPriceCr: ai?.asking_price_cr || null,
    landPriceRateInr:
      ai?.asking_price_per_sqft_inr ||
      (ai?.asking_price_per_acre_cr ? ai.asking_price_per_acre_cr * 1e7 : null),
    landPricingBasis: ai?.asking_price_per_sqft_inr
      ? 'per_sqft'
      : ai?.asking_price_per_acre_cr
      ? 'per_acre'
      : ai?.asking_price_cr
      ? 'total_cr'
      : null,
  };
  return fields;
};

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Capture a property from any raw input string. Returns the candidate
 * shape described in the file header.
 *
 * Options:
 *   - aiAssisted: when true (default), free-text inputs go through Gemini
 *                 extraction. Set false to skip the AI call (cheaper, no
 *                 area/price extraction for narratives).
 *
 * Never throws on resolution failure — instead returns a candidate with
 * warnings explaining what could not be resolved. The route handler
 * surfaces warnings to the frontend so the user can still proceed with
 * partial data (per CLAUDE.md "support incomplete live data" rule).
 */
const captureProperty = async (rawInput, { aiAssisted = true } = {}) => {
  const startedAt = Date.now();
  const stepLog = [];
  const warnings = [];

  // Validate input.
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    return {
      classification: { type: 'empty', parsed: {}, confidence: 1.0, hint: 'Empty input.' },
      resolved: null,
      context: null,
      suggestedFields: null,
      aiExtraction: null,
      warnings: ['Empty input — paste a Google Maps link, Plus Code, address, coordinates, or survey number.'],
      provenance: { step_log: stepLog, duration_ms: Date.now() - startedAt },
    };
  }
  if (rawInput.length > MAX_INPUT_LENGTH) {
    return {
      classification: { type: 'empty', parsed: {}, confidence: 1.0, hint: 'Input too long.' },
      resolved: null,
      context: null,
      suggestedFields: null,
      aiExtraction: null,
      warnings: [`Input is too long (max ${MAX_INPUT_LENGTH} characters).`],
      provenance: { step_log: stepLog, duration_ms: Date.now() - startedAt },
    };
  }

  // STEP A — classify.
  const classification = classifyInput(rawInput);
  stepLog.push({ step: 'classify', type: classification.type, confidence: classification.confidence });

  // STEP B — resolve to lat/lng + address.
  let resolved = null;
  let ai = null;

  switch (classification.type) {
    case 'googleMapsUrl':
      resolved = await resolveGoogleMapsUrl(classification.parsed, stepLog);
      // If shortlink resolution failed but we don't have coords, fall back to address geocode of the URL string.
      if (!resolved) {
        warnings.push('Could not resolve the Google Maps URL. Try opening the link and pasting the visible address instead.');
      }
      break;

    case 'plusCode':
      resolved = await resolvePlusCode(classification.parsed, stepLog);
      if (!resolved) {
        warnings.push('Could not resolve the Plus Code. Try pasting a full address instead.');
      }
      break;

    case 'latLng':
      resolved = await resolveLatLng(classification.parsed, stepLog);
      break;

    case 'surveyNumber':
      resolved = await resolveSurveyNumber(classification.parsed, stepLog);
      if (!resolved?.lat) {
        warnings.push('Survey number captured, but the location did not geocode. Add a village or locality.');
      }
      break;

    case 'freeText':
      if (aiAssisted) {
        ai = await extractFreeText(classification.parsed.text, stepLog);
      } else {
        stepLog.push({ step: 'free_text', detail: 'skipped_ai_disabled' });
      }
      if (ai?.location) {
        resolved = await resolveAddress(ai.location, stepLog);
      } else {
        // No AI / no location extracted → try geocoding the whole string.
        resolved = await resolveAddress(classification.parsed.text, stepLog);
        if (!ai) {
          warnings.push('Treated input as an address. Enable AI assistance for narrative inputs to extract area, asking price, and asset class.');
        }
      }
      break;

    case 'address':
    default:
      resolved = await resolveAddress(classification.parsed.text, stepLog);
      break;
  }

  if (!resolved || (resolved.status === 'failed' && !resolved.lat)) {
    warnings.push('Could not resolve the input to a location. You can still save the parcel with manual fields and link it later.');
  }

  // STEP C — enrich with BBMP / K-GIS / planning district / guidance value.
  const context = resolved
    ? await enrichWithContext(
        {
          lat: resolved.lat,
          lng: resolved.lng,
          formatted_address: resolved.formatted_address,
        },
        stepLog,
      )
    : null;

  // STEP D — build suggested fields for POST /properties.
  const suggestedFields = buildSuggestedFields({
    classification,
    resolved: resolved || {},
    context,
    ai,
  });

  // Surface low-confidence geocode result as a warning so the UI can
  // prompt the user to confirm or drop a pin.
  if (resolved?.confidence != null && resolved.confidence < 0.7 && resolved.status !== 'failed') {
    warnings.push(`Low-confidence geocoder match (${Math.round(resolved.confidence * 100)}%). Confirm the pin on the map before saving.`);
  }

  return {
    classification,
    resolved: resolved || null,
    context: context || null,
    suggestedFields,
    aiExtraction: ai || null,
    warnings,
    provenance: {
      step_log: stepLog,
      providers_called: stepLog.map((s) => s.step),
      duration_ms: Date.now() - startedAt,
    },
  };
};

module.exports = {
  captureProperty,
  // Exposed for unit tests.
  _internal: {
    resolveGoogleMapsUrl,
    resolvePlusCode,
    resolveLatLng,
    resolveSurveyNumber,
    resolveAddress,
    extractFreeText,
    buildSuggestedFields,
    generateName,
    parsePincodeFromAddress,
    parseCityFromContext,
    FREE_TEXT_SYSTEM_PROMPT,
  },
};
