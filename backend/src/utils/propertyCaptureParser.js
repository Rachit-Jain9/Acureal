'use strict';

/**
 * Smart Property Capture — pure parser library.
 * --------------------------------------------
 * Given any string a Bengaluru deal sourcer might paste — a Google Maps
 * share link from a broker WhatsApp, a Plus Code, raw lat/lng coords, a
 * survey-number reference, a plain address, or a free-text "5 acres on
 * KIAL road, asking 18 Cr" narrative — classify it into a known input
 * type and pull out whatever structured tokens are visible without doing
 * any I/O.
 *
 * The orchestrator (propertyCapture.service) takes this classification
 * and resolves it against external systems (Google Maps, Gemini, geocoder
 * cascade, K-GIS, BBMP street index) to produce a candidate property.
 *
 * Tested in isolation by tests/propertyCaptureParser.test.js.
 *
 * Detection order (specificity high → low):
 *   1. googleMapsUrl  — full URL anywhere in the string
 *   2. latLng         — two floats in valid (-90..90, -180..180) ranges
 *   3. plusCode       — Open Location Code (4..8 alphabet chars + "+" + 2..3 chars, optional area)
 *   4. surveyNumber   — "Survey No. 45/2" / "S.No 45/2" / "Sy No 45/2"
 *   5. freeText       — looks like a broker narrative (multi-clause, price/area keywords)
 *   6. addressText    — anything else non-empty
 *   7. empty          — whitespace only
 *
 * No external calls. No DB. No env reads. No imports beyond Node built-ins.
 */

const { URL } = require('url');

const PLUS_CODE_ALPHABET = '23456789CFGHJMPQRVWX';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const trim = (raw) => (typeof raw === 'string' ? raw.trim() : '');

const isAlphabetChar = (ch) => PLUS_CODE_ALPHABET.includes(String(ch).toUpperCase());

const isValidLat = (n) => Number.isFinite(n) && n >= -90 && n <= 90;
const isValidLng = (n) => Number.isFinite(n) && n >= -180 && n <= 180;

// ─── 1. GOOGLE MAPS URL ──────────────────────────────────────────────────────

// Allow-list of host suffixes we recognise as Google Maps share URLs.
// Anything else is rejected for SSRF safety in the resolver.
const GOOGLE_MAPS_HOSTS = [
  'maps.app.goo.gl',
  'goo.gl',
  'maps.google.com',
  'maps.google.co.in',
  'www.google.com',
  'google.com',
  'google.co.in',
  'www.google.co.in',
];

const URL_REGEX = /https?:\/\/[^\s]+/i;

const extractGoogleMapsUrl = (raw) => {
  const match = String(raw || '').match(URL_REGEX);
  if (!match) return null;
  const candidate = match[0].replace(/[),.;:!?]+$/, '');
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const isGoogleHost = GOOGLE_MAPS_HOSTS.includes(host);
  if (!isGoogleHost) return null;

  // For the maps.app.goo.gl / goo.gl shortlinks the resolver must follow
  // redirects to get the canonical URL with @lat,lng. Mark them so the
  // orchestrator knows to fetch.
  const isShortlink = host === 'maps.app.goo.gl' || host === 'goo.gl';

  // For canonical /maps URLs the lat/lng is often baked in. Pull it now
  // so the resolver can skip the round-trip when it's there.
  const latLngFromUrl = extractLatLngFromMapsUrl(parsed);

  return {
    url: candidate,
    host,
    isShortlink,
    latLng: latLngFromUrl,
    pathname: parsed.pathname,
  };
};

// Canonical Google Maps URLs put coordinates in the path: "/@12.97,77.59,17z"
// or in query params: "?q=12.97,77.59" or "?ll=12.97,77.59".
const extractLatLngFromMapsUrl = (parsed) => {
  // Path form: /@12.9716,77.5946,17z
  const pathMatch = parsed.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (pathMatch) {
    const lat = parseFloat(pathMatch[1]);
    const lng = parseFloat(pathMatch[2]);
    if (isValidLat(lat) && isValidLng(lng)) return { lat, lng };
  }
  // Query form: ?q=12.97,77.59 or ?ll=12.97,77.59 or ?center=12.97,77.59
  for (const key of ['q', 'll', 'center', 'destination']) {
    const v = parsed.searchParams.get(key);
    if (v) {
      const ll = extractLatLng(v);
      if (ll) return ll;
    }
  }
  return null;
};

// ─── 2. LAT/LNG COORDINATES ──────────────────────────────────────────────────

// Accepts a wide variety of conventions Indian deal sourcers paste:
//   "12.9716, 77.5946"
//   "12.9716,77.5946"
//   "12.9716 77.5946"
//   "12.9716°N 77.5946°E"
//   "12.9716°N, 77.5946°E"
//   "12.9716N, 77.5946E"
//   "lat: 12.9716, lng: 77.5946"
//   "12.9716N 77.5946E"
//
// Returns the FIRST plausible (lat, lng) pair found. Rejects pairs where
// the values are out of valid range. The lat must come first — we don't
// guess if the user put lng first (Indian conventions are lat,lng).
const COORD_REGEX = /(-?\d{1,3}(?:\.\d+)?)\s*°?\s*[NS]?[,;\s]+\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*[EW]?/i;

const extractLatLng = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  // Try labeled form first: "lat: X, lng: Y" or "lat X lng Y"
  const labelled = text.match(/lat[:\s]+(-?\d+(?:\.\d+)?)[,\s]+(?:lng|lon|long)[:\s]+(-?\d+(?:\.\d+)?)/i);
  if (labelled) {
    const lat = parseFloat(labelled[1]);
    const lng = parseFloat(labelled[2]);
    if (isValidLat(lat) && isValidLng(lng)) return { lat, lng };
  }

  // Generic two-number form.
  const m = text.match(COORD_REGEX);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (isValidLat(lat) && isValidLng(lng)) {
      // Reject pairs where both look like ordinary integers without a
      // decimal — they're likely just two numbers in a sentence, not coords.
      const hasDecimal = m[1].includes('.') || m[2].includes('.');
      if (hasDecimal) return { lat, lng };
    }
  }
  return null;
};

// ─── 3. PLUS CODE (OPEN LOCATION CODE) ──────────────────────────────────────

// Full global Plus Code: 8 alphabet chars + "+" + 2 or 3 alphabet chars.
//   e.g. "8MJ3JV8+P4W"
// Short Plus Code: 4 alphabet chars + "+" + 2 or 3 alphabet chars + " " + area context.
//   e.g. "3JV8+P4W Bengaluru"
// Both forms allow optional trailing area context after whitespace.
const PLUS_CODE_REGEX = /\b([23456789CFGHJMPQRVWX]{4,8})\+([23456789CFGHJMPQRVWX]{2,3})\b(?:\s+([^\n,;]+))?/i;

const extractPlusCode = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  const m = text.match(PLUS_CODE_REGEX);
  if (!m) return null;

  const head = m[1].toUpperCase();
  const tail = m[2].toUpperCase();

  // Validate alphabet — the regex character class is generous; double-check.
  if (!head.split('').every(isAlphabetChar)) return null;
  if (!tail.split('').every(isAlphabetChar)) return null;

  // Short codes (4-char head) need an area context to be resolvable; long
  // codes (8-char head) are globally unique.
  const isShort = head.length < 8;
  const areaContext = m[3] ? m[3].trim().replace(/[.,;]+$/, '') : null;

  return {
    code: `${head}+${tail}`,
    head,
    tail,
    isShort,
    areaContext,
  };
};

// ─── 4. SURVEY NUMBER ────────────────────────────────────────────────────────

// Karnataka land records are indexed by Survey Number (often with a slash
// for sub-divisions: "45/2", "45/2A", "45/2B/1"). Common abbreviations:
//   "Survey No.", "Survey Number", "S.No.", "S. No.", "Sy.No.", "Sy. No.",
//   "Sy No", "SyNo", "Sy. No"
// Sometimes operators paste it as "S/no" or "S/No" too.
// Survey number itself is digits + zero or more `/<digit-or-letter>` groups,
// with NO whitespace allowed inside (so "45/2 Bommasandra" stops at "45/2").
// Sub-divisions: "45/2", "45/2A", "45/2/1", "45/2A/1".
//
// The trailing location capture accepts either a comma/semicolon/dash
// separator OR plain whitespace — but if whitespace, the location must
// be word characters (not start with a digit, to avoid grabbing the
// next thing the user pasted by accident).
const SURVEY_REGEX = /(?:survey(?:\s+no\.?|\s+number)?|sy\.?\s*no\.?|s\.?\s*no\.?|s\s*\/\s*no\.?)\s*[:#]?\s*([0-9]+(?:\/[0-9A-Za-z]+)*)(?:\s*[,;\-–—]+\s*([^\n]+?)|\s+([A-Za-z][^\n,;]*?))?\s*$/i;

const extractSurveyNumber = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;
  const m = text.match(SURVEY_REGEX);
  if (!m) return null;
  const surveyNumber = m[1].replace(/\s+/g, '').replace(/^\/+|\/+$/g, '');
  if (!/^[0-9]/.test(surveyNumber)) return null; // must start with a digit
  // m[2] = location after comma/semicolon/dash, m[3] = location after whitespace.
  const rawLocation = m[2] || m[3] || null;
  const location = rawLocation ? rawLocation.trim().replace(/[.;]+$/, '') : null;
  return { surveyNumber, location };
};

// ─── 5. FREE TEXT VS PLAIN ADDRESS HEURISTIC ────────────────────────────────

// Indicators that a string is a narrative (broker WhatsApp message)
// rather than a clean address. If ≥2 hits, treat as freeText so the
// orchestrator routes to Gemini extraction.
const NARRATIVE_HINTS = [
  /\b(crore|cr|cr\.|lakh|lakhs|lac|lacs)\b/i,
  /\b(acre|acres|sqft|sq\.?\s*ft|sft)\b/i,
  /\b(asking|negotiable|deal|opportunity|sale|sell|offer|broker|consideration)\b/i,
  /\b(builder|promoter|developer|society|jv|joint\s+venture|outright|tdr)\b/i,
  /\b(approx|approximately|around|about|near|close\s+to|opposite|behind|next\s+to|adjacent)\b/i,
  /\b(rera|khata|conversion|encumbrance|patta|ec|ag\.?\s*conv|gp\.?\s*conv|panchayat)\b/i,
];

const isLikelyFreeText = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return false;
  // Very short strings are almost always addresses or area names.
  if (text.length < 40) return false;
  // Many sentences / many clauses → narrative.
  const clauseCount = (text.match(/[.,;]/g) || []).length;
  const hintCount = NARRATIVE_HINTS.filter((re) => re.test(text)).length;
  if (clauseCount >= 4 && hintCount >= 1) return true;
  if (hintCount >= 2) return true;
  return false;
};

// ─── CLASSIFIER ─────────────────────────────────────────────────────────────

/**
 * Classify a raw input string. Returns:
 *   { type, parsed, confidence, hint }
 *
 * type ∈ {
 *   'empty', 'googleMapsUrl', 'latLng', 'plusCode',
 *   'surveyNumber', 'freeText', 'address'
 * }
 *
 * confidence is a 0..1 self-assessed score of how confident the classifier
 * is that this is the right bucket. The orchestrator uses it to decide
 * whether to AI-assist (low confidence → ask Gemini what this is).
 */
const classifyInput = (raw) => {
  const text = trim(raw);
  if (!text) {
    return { type: 'empty', parsed: {}, confidence: 1.0, hint: 'Input is empty.' };
  }

  // 1. Google Maps URL — highest priority.
  const url = extractGoogleMapsUrl(text);
  if (url) {
    return {
      type: 'googleMapsUrl',
      parsed: url,
      confidence: 0.95,
      hint: url.isShortlink
        ? 'Detected a Google Maps shortlink. Will follow the redirect to get coordinates.'
        : 'Detected a Google Maps URL with coordinates embedded.',
    };
  }

  // 2. Plus Code — also high priority because the pattern is very specific.
  // Check Plus Code before lat/lng because "3JV8+P4W Bengaluru" doesn't
  // match COORD_REGEX, but a poorly-formatted "3JV8+P4W 12.9, 77.5" might
  // ambiguously look like both — Plus Code wins.
  const plus = extractPlusCode(text);
  if (plus) {
    return {
      type: 'plusCode',
      parsed: plus,
      confidence: 0.92,
      hint: plus.isShort && !plus.areaContext
        ? 'Detected a short Plus Code without an area context. Will default to Bengaluru, Karnataka.'
        : 'Detected a Plus Code. Will resolve to coordinates via Google Geocoding.',
    };
  }

  // 3. Lat/lng coordinates.
  const ll = extractLatLng(text);
  if (ll) {
    // If the whole input is JUST coords (or coords + a label), high confidence.
    // If it's coords buried in a longer string, lower confidence.
    const tokensOutsideCoords = text
      .replace(COORD_REGEX, '')
      .replace(/lat:|lng:|lon:|long:/gi, '')
      .trim();
    const isPureCoords = tokensOutsideCoords.length === 0;
    return {
      type: 'latLng',
      parsed: ll,
      confidence: isPureCoords ? 0.95 : 0.7,
      hint: 'Detected latitude/longitude coordinates. Will reverse-geocode to address.',
    };
  }

  // 4. Survey number.
  const sn = extractSurveyNumber(text);
  if (sn) {
    return {
      type: 'surveyNumber',
      parsed: sn,
      confidence: 0.85,
      hint: sn.location
        ? `Detected Survey No. ${sn.surveyNumber} near ${sn.location}. Will geocode the location.`
        : `Detected Survey No. ${sn.surveyNumber}. Add a village/locality so we can geocode it.`,
    };
  }

  // 5. Free text vs plain address.
  if (isLikelyFreeText(text)) {
    return {
      type: 'freeText',
      parsed: { text },
      confidence: 0.75,
      hint: 'Looks like a broker narrative. Will use AI to extract location, area, and asking price.',
    };
  }

  // 6. Default: treat as address text.
  return {
    type: 'address',
    parsed: { text },
    confidence: 0.65,
    hint: 'Treating as an address. Will geocode via Google Places.',
  };
};

module.exports = {
  classifyInput,
  // Exported for direct use and tests.
  extractGoogleMapsUrl,
  extractLatLng,
  extractPlusCode,
  extractSurveyNumber,
  isLikelyFreeText,
  // Internals exposed for tests.
  _internal: {
    GOOGLE_MAPS_HOSTS,
    PLUS_CODE_ALPHABET,
    COORD_REGEX,
    PLUS_CODE_REGEX,
    SURVEY_REGEX,
    NARRATIVE_HINTS,
    isValidLat,
    isValidLng,
  },
};
