'use strict';

/**
 * @redip/real-estate-ontology — single source of truth for REDIP's
 * real-estate taxonomies + extraction field mappings + unit conversions.
 *
 * Why a separate package: same shape consumed by backend (Node CommonJS
 * via require), frontend (Vite ES-module via static JSON import), tests,
 * and exports. Versioning the JSON in one place prevents drift between
 * extraction.service (writes), apply-extractions.service (validates),
 * exports/xlsx/v2/buildWorkbook (renders), and the deal form UI (selects).
 *
 * Per the 2026-05-15 strategic review (docs/STRATEGIC_REVIEW_2026_05_15.md
 * §III.2), the ontology is the FIRST-CLASS artifact that anchors document
 * ingestion. Without it, every extraction → deal mapping is one-off code.
 *
 * Versioning: every breaking change bumps the JSON file (v1.json → v2.json)
 * and adds a new exported loader. Old callers stay on v1 until migrated.
 */

const ontologyV1 = require('./v1.json');

// ── Asset class ────────────────────────────────────────────────────────

const getAssetClasses = () => ontologyV1.asset_class.values;
const getAssetClassKeys = () => ontologyV1.asset_class.values.map((v) => v.key);
const getAssetClass = (key) => ontologyV1.asset_class.values.find((v) => v.key === key) || null;
const getAssetClassFamily = (key) => {
  const ac = getAssetClass(key);
  return ac ? ac.family : null;
};

// ── Deal structure ─────────────────────────────────────────────────────

const getDealStructures = () => ontologyV1.deal_structure.values;
const getDealStructureKeys = () => ontologyV1.deal_structure.values.map((v) => v.key);

// ── Exit strategy (family-conditional) ─────────────────────────────────

const getExitStrategies = (family) => {
  if (!family) return [];
  return ontologyV1.exit_strategy.by_family[family] || [];
};
const getExitStrategyKeys = (family) => getExitStrategies(family).map((v) => v.key);

// ── Zoning ─────────────────────────────────────────────────────────────

const getZoningValues = () => ontologyV1.zoning.values;

// ── Ownership type ─────────────────────────────────────────────────────

const getOwnershipTypes = () => ontologyV1.ownership_type.values;
const getOwnershipTypeKeys = () => ontologyV1.ownership_type.values.map((v) => v.key);

// ── Area unit conversion ───────────────────────────────────────────────

const AREA_UNITS = ontologyV1.area.units;

const toSqft = (value, unit) => {
  if (value == null || Number.isNaN(Number(value))) return null;
  const unitDef = AREA_UNITS[String(unit || '').toLowerCase()];
  if (!unitDef) {
    throw new Error(`Unknown area unit "${unit}". Known: ${Object.keys(AREA_UNITS).join(', ')}`);
  }
  return Number(value) * unitDef.to_sqft_factor;
};

const sqftFromAcres = (acres) => toSqft(acres, 'acre');

const acresFromSqft = (sqft) => {
  if (sqft == null || Number.isNaN(Number(sqft))) return null;
  return Number(sqft) / ontologyV1.pricing.constants.sqft_per_acre;
};

// ── Pricing unit conversion ────────────────────────────────────────────

const PRICING_CONSTANTS = ontologyV1.pricing.constants;

const inrToCr = (inr) => {
  if (inr == null || Number.isNaN(Number(inr))) return null;
  return Number(inr) / PRICING_CONSTANTS.inr_per_cr;
};

const crToInr = (cr) => {
  if (cr == null || Number.isNaN(Number(cr))) return null;
  return Number(cr) * PRICING_CONSTANTS.inr_per_cr;
};

const inrToLakh = (inr) => {
  if (inr == null || Number.isNaN(Number(inr))) return null;
  return Number(inr) / PRICING_CONSTANTS.inr_per_lakh;
};

// ── Extraction field map ───────────────────────────────────────────────

const getExtractionFieldMap = () => ontologyV1.extraction_field_map.fields;
const getExtractionField = (key) => ontologyV1.extraction_field_map.fields[key] || null;
const getExtractionFieldKeys = () => Object.keys(ontologyV1.extraction_field_map.fields);

/**
 * Resolve the named transform on a raw extracted value. Returns the
 * canonical-units value for storage. If no transform is defined, the
 * value is returned as-is. If the transform key is unknown, throws.
 */
const TRANSFORMS = {
  acres_to_sqft: (v) => sqftFromAcres(v),
  inr_to_cr: (v) => inrToCr(v),
  inr_lakh_to_cr: (v) => (v == null ? null : Number(v) / 100), // 100 lakh = 1 cr
  identity: (v) => v,
};

const applyTransform = (transformKey, value) => {
  if (!transformKey) return value;
  const fn = TRANSFORMS[transformKey];
  if (!fn) {
    throw new Error(`Unknown ontology transform "${transformKey}". Known: ${Object.keys(TRANSFORMS).join(', ')}`);
  }
  return fn(value);
};

/**
 * Validate + coerce a value against an extraction field's spec.
 * Returns { ok: true, value: <coerced> } on success,
 * or { ok: false, error: <reason> } on failure.
 *
 * Performs:
 *   1. Value type coercion (string ↔ number)
 *   2. Numeric range check (min / max)
 *   3. String length check (max_length)
 *   4. Transform application (if defined)
 *
 * NOTE: enum validation (e.g., ownership_type must be one of 6 keys) is
 * NOT enforced here — extraction often surfaces verbatim text the operator
 * normalizes before approving. The apply-extractions endpoint can layer
 * enum coercion on top if needed.
 */
const validateAndCoerce = (canonicalKey, rawValue) => {
  const spec = getExtractionField(canonicalKey);
  if (!spec) {
    return { ok: false, error: `Unknown canonical field "${canonicalKey}"` };
  }
  if (rawValue == null || rawValue === '') {
    return { ok: false, error: 'Value is null or empty' };
  }

  let value = rawValue;

  // Type coercion
  if (spec.value_type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
    if (!Number.isFinite(n)) {
      return { ok: false, error: `Could not coerce "${rawValue}" to number` };
    }
    value = n;
  } else if (spec.value_type === 'string') {
    value = String(value).trim();
    if (value.length === 0) {
      return { ok: false, error: 'Empty string after trim' };
    }
  }

  // Range checks (numbers)
  if (spec.value_type === 'number') {
    if (spec.min != null && value < spec.min) {
      return { ok: false, error: `Value ${value} below min ${spec.min}` };
    }
    if (spec.max != null && value > spec.max) {
      return { ok: false, error: `Value ${value} above max ${spec.max}` };
    }
  }

  // Length check (strings)
  if (spec.value_type === 'string' && spec.max_length != null && value.length > spec.max_length) {
    return { ok: false, error: `String length ${value.length} exceeds max ${spec.max_length}` };
  }

  // Transform (e.g., acres_to_sqft, inr_to_cr)
  let coerced = value;
  if (spec.transform) {
    try {
      coerced = applyTransform(spec.transform, value);
    } catch (err) {
      return { ok: false, error: `Transform "${spec.transform}" failed: ${err.message}` };
    }
  }

  return { ok: true, value: coerced, original_value: value, transform: spec.transform || null };
};

// ── Confidence bands ───────────────────────────────────────────────────

const getConfidenceBand = (rawConfidence) => {
  // Explicitly reject null / undefined — Number(null) silently coerces
  // to 0 which would otherwise land in the 'low' band (0.0–0.50) and
  // mislead the caller into thinking the model had a 0% confidence
  // signal when it actually had no signal at all.
  if (rawConfidence == null) return null;
  const n = Number(rawConfidence);
  if (!Number.isFinite(n)) return null;
  for (const band of ontologyV1.confidence_bands.bands) {
    if (n >= band.min && n <= band.max) return band;
  }
  return null;
};

// ── Version + introspection ────────────────────────────────────────────

const getOntologyVersion = () => ontologyV1.ontology_version;
const getRawOntology = () => ontologyV1;

module.exports = {
  // Taxonomies
  getAssetClasses,
  getAssetClassKeys,
  getAssetClass,
  getAssetClassFamily,
  getDealStructures,
  getDealStructureKeys,
  getExitStrategies,
  getExitStrategyKeys,
  getZoningValues,
  getOwnershipTypes,
  getOwnershipTypeKeys,

  // Unit conversions
  toSqft,
  sqftFromAcres,
  acresFromSqft,
  inrToCr,
  crToInr,
  inrToLakh,

  // Extraction field map
  getExtractionFieldMap,
  getExtractionField,
  getExtractionFieldKeys,
  applyTransform,
  validateAndCoerce,

  // Confidence
  getConfidenceBand,

  // Versioning + introspection
  getOntologyVersion,
  getRawOntology,
};
