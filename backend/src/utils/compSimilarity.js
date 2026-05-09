'use strict';

/**
 * Pure-function comp similarity scorer.
 *
 * Given a "subject" (a deal + its linked property + financial assumptions)
 * and a candidate comp row, produce:
 *   - overall_score in [0,1] — higher is more comparable
 *   - per-factor breakdown so the UI can show why the score is what it is
 *   - rate_delta — % difference of comp rate vs subject benchmark, signed
 *
 * Why hand-coded weights instead of an ML model:
 *   - Deterministic and auditable (CLAUDE.md hard rule on "no LLM for math").
 *   - Honest in the face of sparse data: if a factor's input is missing on
 *     either side, it contributes 0 weight rather than a fabricated guess.
 *   - Easy for analysts to tune. The weights below are conservative defaults
 *     for Bengaluru residential — override per asset class as we learn.
 *
 * Factors (residential default weights):
 *   distance         (35%)  Haversine km between subject and comp coordinates
 *   asset_class      (20%)  exact match of project type / asset class
 *   bhk_config       (10%)  BHK overlap (configs share at least one bucket)
 *   vintage          (10%)  launch year proximity (newer = better comparable)
 *   size_band        (15%)  total_units / scale similarity
 *   amenities        (10%)  Jaccard of amenities arrays
 */

const haversineKm = (lat1, lng1, lat2, lng2) => {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null || Number.isNaN(Number(v)))) return null;
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLng = toRad(Number(lng2) - Number(lng1));
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const DEFAULT_WEIGHTS = Object.freeze({
  distance:    0.35,
  asset_class: 0.20,
  bhk_config:  0.10,
  vintage:     0.10,
  size_band:   0.15,
  amenities:   0.10,
});

// Distance saturates at ~10 km for residential. Tweak per asset class:
// retail/office tolerate larger radii; hospitality even larger.
const DISTANCE_SATURATION_KM = {
  residential_apartments: 8,
  villas: 10,
  plotted_development: 8,
  commercial_office: 15,
  retail: 20,
  industrial_warehousing: 25,
  hospitality: 30,
  mixed_use: 12,
  redevelopment: 8,
  default: 10,
};

const VINTAGE_TOLERANCE_YEARS = 6; // beyond this delta, score = 0

const normalizeAssetClass = (value) => {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  // Loose mapping so "residential" matches "residential_apartments", etc.
  if (/^residential|apartment|condo/.test(s)) return 'residential_apartments';
  if (/^villa/.test(s)) return 'villas';
  if (/^plot/.test(s)) return 'plotted_development';
  if (/office|commercial/.test(s)) return 'commercial_office';
  if (/retail|mall/.test(s)) return 'retail';
  if (/industrial|warehous/.test(s)) return 'industrial_warehousing';
  if (/hotel|hospitality|resort/.test(s)) return 'hospitality';
  if (/mixed/.test(s)) return 'mixed_use';
  if (/raw[_ ]?land|land[_ ]?bank/.test(s)) return 'plotted_development';
  if (/redevelop/.test(s)) return 'redevelopment';
  return s;
};

const parseBhk = (value) => {
  if (!value) return new Set();
  const out = new Set();
  String(value)
    .toLowerCase()
    .replace(/bhk|bedroom/gi, '')
    .split(/[,/+&]|\sand\s|\s+/)
    .forEach((piece) => {
      const num = piece.match(/(\d+(\.\d+)?)/);
      if (num) out.add(Math.round(Number(num[1])));
    });
  return out;
};

const parseAmenities = (value) => {
  if (!value) return new Set();
  if (Array.isArray(value)) {
    return new Set(value.map((v) => String(v).trim().toLowerCase()).filter(Boolean));
  }
  return new Set(
    String(value)
      .split(/[,;|]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const distanceFactor = (subject, comp, assetClass) => {
  const km = haversineKm(subject.lat, subject.lng, comp.lat, comp.lng);
  if (km == null) return { score: null, distance_km: null };
  const sat = DISTANCE_SATURATION_KM[assetClass] || DISTANCE_SATURATION_KM.default;
  const score = Math.max(0, 1 - km / sat);
  return { score: Math.round(score * 1000) / 1000, distance_km: Math.round(km * 100) / 100 };
};

const assetClassFactor = (subject, comp) => {
  const a = normalizeAssetClass(subject.asset_class);
  const b = normalizeAssetClass(comp.project_type);
  if (!a || !b) return { score: null };
  return { score: a === b ? 1 : 0 };
};

const bhkFactor = (subject, comp) => {
  const a = parseBhk(subject.bhk_config);
  const b = parseBhk(comp.bhk_config);
  if (a.size === 0 || b.size === 0) return { score: null };
  const overlap = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return { score: union ? overlap / union : 0 };
};

const vintageFactor = (subject, comp) => {
  const a = numberOrNull(subject.launch_year);
  const b = numberOrNull(comp.launch_year);
  if (a == null || b == null) return { score: null };
  const delta = Math.abs(a - b);
  return { score: Math.max(0, 1 - delta / VINTAGE_TOLERANCE_YEARS) };
};

const sizeBandFactor = (subject, comp) => {
  const a = numberOrNull(subject.total_units);
  const b = numberOrNull(comp.total_units);
  if (a == null || b == null || a === 0 || b === 0) return { score: null };
  // Symmetric ratio: 1 when equal, decays toward 0 as one is much larger.
  const ratio = Math.min(a, b) / Math.max(a, b);
  return { score: ratio };
};

const amenitiesFactor = (subject, comp) => {
  const a = parseAmenities(subject.amenities);
  const b = parseAmenities(comp.amenities);
  if (a.size === 0 || b.size === 0) return { score: null };
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return { score: union ? intersection / union : 0 };
};

const weightedAverage = (factorScores, weights) => {
  let total = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(weights)) {
    const score = factorScores[key]?.score;
    if (score == null) continue;
    total += score * w;
    weight += w;
  }
  if (weight === 0) return null;
  return total / weight;
};

/**
 * Score one comp against a subject.
 * Each side is a flat object — no DB lookups, no I/O.
 *
 * subject: {
 *   lat, lng, asset_class, bhk_config, launch_year,
 *   total_units, amenities,
 *   target_rate_per_sqft (optional, used for rate_delta)
 * }
 * comp: {
 *   lat, lng, project_type, bhk_config, launch_year,
 *   total_units, amenities,
 *   rate_per_sqft
 * }
 */
const scoreComp = (subject, comp, options = {}) => {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const assetClass = normalizeAssetClass(subject.asset_class) || 'default';

  const factors = {
    distance:    distanceFactor(subject, comp, assetClass),
    asset_class: assetClassFactor(subject, comp),
    bhk_config:  bhkFactor(subject, comp),
    vintage:     vintageFactor(subject, comp),
    size_band:   sizeBandFactor(subject, comp),
    amenities:   amenitiesFactor(subject, comp),
  };

  const overall = weightedAverage(factors, weights);

  // Rate delta — comp.rate_per_sqft − subject.target_rate_per_sqft, expressed
  // as a percentage of the subject benchmark. Positive = comp is pricier.
  let rateDelta = null;
  const compRate = numberOrNull(comp.rate_per_sqft);
  const subjectRate = numberOrNull(subject.target_rate_per_sqft);
  if (compRate != null && subjectRate != null && subjectRate !== 0) {
    rateDelta = (compRate - subjectRate) / subjectRate;
  }

  return {
    overall_score: overall != null ? Math.round(overall * 1000) / 1000 : null,
    factors,
    weights,
    rate_delta_pct: rateDelta != null ? Math.round(rateDelta * 1000) / 10 : null,
    distance_km: factors.distance?.distance_km ?? null,
  };
};

/**
 * Score many comps against a subject and rank by overall_score (desc).
 * Drops candidates with `null` overall (not enough data for any factor).
 */
const rankComps = (subject, comps, options = {}) => {
  const enriched = comps.map((comp) => ({
    comp,
    similarity: scoreComp(subject, comp, options),
  }));
  return enriched
    .filter((x) => x.similarity.overall_score != null)
    .sort((a, b) => (b.similarity.overall_score || 0) - (a.similarity.overall_score || 0));
};

module.exports = {
  scoreComp,
  rankComps,
  haversineKm,
  DEFAULT_WEIGHTS,
  DISTANCE_SATURATION_KM,
  // Exposed for tests / fine-grained UIs:
  _internals: {
    distanceFactor,
    assetClassFactor,
    bhkFactor,
    vintageFactor,
    sizeBandFactor,
    amenitiesFactor,
    normalizeAssetClass,
  },
};
