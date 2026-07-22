'use strict';

/**
 * Backend mirror of `packages/financial-kernel/src/config/india.ts`.
 *
 * Single source of truth for India/Bengaluru regulatory and unit
 * constants used by Node code. Re-exports the kernel's `INDIA_CONFIG`
 * so the JS engine, landPricing utils, and any route-level logic read
 * the same values as the TS kernel — no more duplicated `43560` or
 * `0.05` scattered across the codebase.
 *
 * Loaded lazily to survive the `dist/` directory being missing (first
 * install, CI, failed kernel build). If the kernel isn't built yet the
 * module falls back to the baked-in values so legacy tests still run.
 */

let _india = null;

function _load() {
  if (_india) return _india;
  try {
    const mod = require('../../../packages/financial-kernel/dist/config/india');
    if (mod && mod.INDIA_CONFIG) {
      _india = mod.INDIA_CONFIG;
      return _india;
    }
  } catch (_err) {
    // Fallback only — keep in sync with kernel/config/india.ts
  }
  _india = Object.freeze({
    SQFT_PER_ACRE: 43_560,
    CRORE: 1e7,
    STAMP_DUTY_RATE: 0.05,
    // Karnataka doubled registration 1% → 2% in Aug 2025 (combined 6.6% → 7.6%);
    // plotted works GST 12% → 18% after the Sept-2025 GST rationalization.
    KARNATAKA_STAMP_REG_RATE: 0.076,
    REGISTRATION_RATE: 0.02,
    GST_CONSTRUCTION_STANDARD: 0.18,
    GST_CONSTRUCTION_PLOTTED: 0.18,
    GST_LAND_PARCEL: 0.0,
    PROPERTY_TAX_PCT_OF_REVENUE: 0.02,
    BUILDING_INSURANCE_PCT_OF_REVENUE: 0.01,
    CARPET_RATIO: 0.7,
    DEFAULT_LOADING_FACTOR: 0.15,
  });
  return _india;
}

const INDIA_CONFIG = _load();

const SQFT_PER_ACRE = INDIA_CONFIG.SQFT_PER_ACRE;
const CRORE = INDIA_CONFIG.CRORE;
const STAMP_DUTY_RATE = INDIA_CONFIG.STAMP_DUTY_RATE;
const KARNATAKA_STAMP_REG_RATE = INDIA_CONFIG.KARNATAKA_STAMP_REG_RATE;
const REGISTRATION_RATE = INDIA_CONFIG.REGISTRATION_RATE;
const GST_CONSTRUCTION_STANDARD = INDIA_CONFIG.GST_CONSTRUCTION_STANDARD;
const GST_CONSTRUCTION_PLOTTED = INDIA_CONFIG.GST_CONSTRUCTION_PLOTTED;
const GST_LAND_PARCEL = INDIA_CONFIG.GST_LAND_PARCEL;

const sqftToAcres = (sqft) => sqft / SQFT_PER_ACRE;
const acresToSqft = (acres) => acres * SQFT_PER_ACRE;
const rupeesToCrore = (inr) => inr / CRORE;

module.exports = {
  INDIA_CONFIG,
  SQFT_PER_ACRE,
  CRORE,
  STAMP_DUTY_RATE,
  KARNATAKA_STAMP_REG_RATE,
  REGISTRATION_RATE,
  GST_CONSTRUCTION_STANDARD,
  GST_CONSTRUCTION_PLOTTED,
  GST_LAND_PARCEL,
  sqftToAcres,
  acresToSqft,
  rupeesToCrore,
};
