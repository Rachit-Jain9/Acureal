'use strict';

/**
 * Pure helpers + constants shared across the parcelIntelligence modules.
 *
 * All exports here are dependency-free or only depend on other exports
 * from this same file — no DB calls, no other service imports. This keeps
 * the import graph clean: every concern module imports `_helpers`, and
 * `_helpers` imports nothing of ours.
 *
 * Extracted from the original parcelIntelligenceAdmin.service.js (1,801 LOC)
 * as part of the Bet 3 god-service decomposition. The shim at
 * services/parcelIntelligenceAdmin.service.js re-exports the public-facing
 * names so existing routes/tests don't change.
 */

const { createError } = require('../../middleware/errorHandler');

// ── Constants ──────────────────────────────────────────────────────────────

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_review']);
const REVIEW_TYPES = new Set(['evidence_source', 'evidence_fact', 'guidance_value', 'far_rule']);
const AUTHORITY_INPUT_KINDS = new Set(['property_fact', 'guidance_value', 'far_rule']);
const SQFT_PER_ACRE = 43560;
const METERS_PER_FOOT = 0.3048;

const PROPERTY_PROMOTION_LABELS = {
  survey_number: 'Survey number',
  pid: 'PID',
  khata_no: 'Khata no.',
  owner_name: 'Owner name',
  land_area_sqft: 'Land area',
  road_width_mtrs: 'Road width',
};

const MANUAL_PROPERTY_FACTS = new Set([
  'survey_number',
  'pid',
  'khata_no',
  'owner_name',
  'land_area_sqft',
  'land_area_acres',
  'road_width_mtrs',
  'road_width_ft',
]);

// ── Validators ─────────────────────────────────────────────────────────────

const textOrNull = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => textOrNull(item))
      .filter(Boolean)
      .join(', ') || null;
  }
  if (typeof value === 'object') return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
};

const requireText = (value, label, max = 500) => {
  const normalized = textOrNull(value);
  if (!normalized) throw createError(`${label} is required.`, 400);
  return normalized.slice(0, max);
};

const requireNumber = (value, label) => {
  const numeric = numberOrNull(value);
  if (numeric === null) throw createError(`${label} must be a number.`, 400);
  return numeric;
};

const optionalNumber = (value) => numberOrNull(value);

const toJsonValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) || typeof value === 'object') return value;
  const numeric = numberOrNull(value);
  if (numeric !== null && String(value).trim().match(/^-?[\d,]+(\.\d+)?$/)) return numeric;
  return String(value).trim();
};

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
};

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

// ── Promotion helpers ──────────────────────────────────────────────────────

const buildPromotionUpdate = (factKey, factValue) => {
  const key = String(factKey || '').toLowerCase();

  if (['survey_number', 'survey_numbers', 'survey_no', 'sy_no'].includes(key)) {
    const value = textOrNull(factValue);
    return value ? { field: 'survey_number', value, updates: { survey_number: value } } : null;
  }

  if (['pid', 'pid_number'].includes(key)) {
    const value = textOrNull(factValue);
    return value ? { field: 'pid', value, updates: { pid: value } } : null;
  }

  if (['khata_number', 'khata_no'].includes(key)) {
    const value = textOrNull(factValue);
    return value ? { field: 'khata_no', value, updates: { khata_no: value } } : null;
  }

  if (key === 'owner_name') {
    const value = textOrNull(factValue);
    return value ? { field: 'owner_name', value, updates: { owner_name: value } } : null;
  }

  if (['land_area_sqft', 'area_sqft', 'total_area_sqft', 'total_land_area_sqft', 'site_area_sqft', 'plot_area_sqft'].includes(key)) {
    const value = numberOrNull(factValue);
    return value
      ? {
          field: 'land_area_sqft',
          value: round(value),
          updates: {
            land_area_sqft: round(value),
            land_area_input_value: round(value),
            land_area_input_unit: 'sqft',
          },
        }
      : null;
  }

  if (['land_area_acres', 'area_acres', 'total_area_acres', 'total_land_area_acres', 'plot_area_acres'].includes(key)) {
    const value = numberOrNull(factValue);
    return value
      ? {
          field: 'land_area_sqft',
          value: round(value * SQFT_PER_ACRE),
          updates: {
            land_area_sqft: round(value * SQFT_PER_ACRE),
            land_area_input_value: value,
            land_area_input_unit: 'acre',
          },
        }
      : null;
  }

  if (['road_width_m', 'road_width_mtrs', 'abutting_road_width_m'].includes(key)) {
    const value = numberOrNull(factValue);
    return value ? { field: 'road_width_mtrs', value: round(value, 3), updates: { road_width_mtrs: round(value, 3) } } : null;
  }

  if (key === 'road_width_ft') {
    const value = numberOrNull(factValue);
    return value ? { field: 'road_width_mtrs', value: round(value * METERS_PER_FOOT, 3), updates: { road_width_mtrs: round(value * METERS_PER_FOOT, 3) } } : null;
  }

  return null;
};

const getCurrentPropertyValue = (currentValues = {}, field) => currentValues?.[field] ?? null;

const normalizePromotionValue = (value) => {
  if (typeof value === 'number') return String(round(value, 3));
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
};

const buildPromotionMetadata = (row) => {
  if (row.type !== 'evidence_fact') return null;

  const promotion = buildPromotionUpdate(row.title, row.payload?.fact_value);
  if (!promotion) {
    return { supported: false, promotable: false, reason: 'unsupported_fact' };
  }

  const propertyId = row.payload?.property_id || null;
  if (!propertyId) {
    return {
      supported: true,
      promotable: false,
      reason: 'no_linked_property',
      field: promotion.field,
      label: PROPERTY_PROMOTION_LABELS[promotion.field],
      value: promotion.value,
    };
  }

  const currentValue = getCurrentPropertyValue(row.payload?.current_property_values, promotion.field);
  const approvalRequired = row.review_status !== 'approved';
  const alreadyPopulated = hasValue(currentValue);

  return {
    supported: true,
    promotable: !approvalRequired && !alreadyPopulated,
    reason: approvalRequired ? 'approval_required' : alreadyPopulated ? 'already_populated' : null,
    field: promotion.field,
    label: PROPERTY_PROMOTION_LABELS[promotion.field],
    value: promotion.value,
    current_value: currentValue,
    property_id: propertyId,
    property_name: row.payload?.property_name || null,
    deal_id: row.payload?.deal_id || null,
  };
};

const attachPromotionMetadata = (row) => ({
  ...row,
  promotion: buildPromotionMetadata(row),
});

// ── Queue normalizers ──────────────────────────────────────────────────────

const clampLimit = (value, fallback = 50, max = 200) => {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, max);
};

const normalizeStatus = (status = 'pending') => {
  if (status === 'all') return 'all';
  if (!REVIEW_STATUSES.has(status)) return 'pending';
  return status;
};

const normalizeType = (type = 'all') => (REVIEW_TYPES.has(type) ? type : 'all');

const normalizeSearch = (value) => {
  const text = textOrNull(value);
  return text ? text.slice(0, 120) : null;
};

module.exports = {
  // constants
  REVIEW_STATUSES,
  REVIEW_TYPES,
  AUTHORITY_INPUT_KINDS,
  SQFT_PER_ACRE,
  METERS_PER_FOOT,
  PROPERTY_PROMOTION_LABELS,
  MANUAL_PROPERTY_FACTS,
  // validators
  textOrNull,
  numberOrNull,
  requireText,
  requireNumber,
  optionalNumber,
  toJsonValue,
  round,
  hasValue,
  // promotion
  buildPromotionUpdate,
  getCurrentPropertyValue,
  normalizePromotionValue,
  buildPromotionMetadata,
  attachPromotionMetadata,
  // queue normalizers
  clampLimit,
  normalizeStatus,
  normalizeType,
  normalizeSearch,
};
