'use strict';

/**
 * feeEstimator — deterministic Karnataka RERA registration-fee estimate.
 *
 * Pure function of (assetClass, landAreaSqm, feeOverrides). No AI, no DB. The
 * rates live in the versioned `reraFeeSchedule` constant; this module only
 * applies them and honours a manual override (recorded, not hidden). Every
 * result carries the schedule version + `last_verified` + disclaimer so the UI
 * and DOCX can label it an estimate.
 */

const { RERA_FEE_SCHEDULE, ASSET_CLASS_FEE_CATEGORY } = require('../../constants/reraFeeSchedule');

const round = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : null);

const provenance = () => ({
  version: RERA_FEE_SCHEDULE.version,
  effective_from: RERA_FEE_SCHEDULE.effective_from,
  notification_ref: RERA_FEE_SCHEDULE.notification_ref,
  last_verified: RERA_FEE_SCHEDULE.last_verified,
  source_url: RERA_FEE_SCHEDULE.source_url,
  disclaimer: RERA_FEE_SCHEDULE.disclaimer,
});

/**
 * @param {object} args
 * @param {string} [args.assetClass]
 * @param {number} [args.landAreaSqm]
 * @param {object} [args.feeOverrides] - { category?, amount_inr?, note? }
 * @returns {object} fee estimate with provenance
 */
const estimateRegistrationFee = ({ assetClass, landAreaSqm, feeOverrides } = {}) => {
  const base = { ...provenance(), is_overridden: false };

  // Manual override wins — recorded explicitly, disclaimer preserved.
  if (feeOverrides && Number.isFinite(Number(feeOverrides.amount_inr))) {
    return {
      ...base,
      is_overridden: true,
      category: feeOverrides.category || ASSET_CLASS_FEE_CATEGORY[assetClass] || null,
      category_label: null,
      land_area_sqm: round(landAreaSqm),
      rate_applied_inr_per_sqm: null,
      gross_inr: null,
      cap_inr: null,
      capped: false,
      fee_inr: round(feeOverrides.amount_inr),
      note: feeOverrides.note || 'Manual override entered by the deal team.',
    };
  }

  const category = (feeOverrides && feeOverrides.category) || ASSET_CLASS_FEE_CATEGORY[assetClass] || null;
  const cfg = category ? RERA_FEE_SCHEDULE.categories[category] : null;

  if (!cfg) {
    return {
      ...base,
      category: null,
      category_label: null,
      land_area_sqm: round(landAreaSqm),
      rate_applied_inr_per_sqm: null,
      gross_inr: null,
      cap_inr: null,
      capped: false,
      fee_inr: null,
      reason: assetClass
        ? `No standard K-RERA project-registration fee category for "${assetClass}".`
        : 'Asset class not set.',
    };
  }

  if (!Number.isFinite(Number(landAreaSqm)) || Number(landAreaSqm) <= 0) {
    return {
      ...base,
      category,
      category_label: cfg.label,
      land_area_sqm: null,
      rate_applied_inr_per_sqm: null,
      gross_inr: null,
      cap_inr: cfg.cap_inr,
      capped: false,
      fee_inr: null,
      reason: 'Land area not set — enter the project land area to estimate the fee.',
    };
  }

  const area = Number(landAreaSqm);
  const rate = area > cfg.threshold_sqm ? cfg.rate_high_inr_per_sqm : cfg.rate_low_inr_per_sqm;
  const gross = area * rate;
  const capped = gross > cfg.cap_inr;
  const fee = capped ? cfg.cap_inr : gross;

  return {
    ...base,
    category,
    category_label: cfg.label,
    land_area_sqm: round(area),
    rate_applied_inr_per_sqm: rate,
    gross_inr: round(gross),
    cap_inr: cfg.cap_inr,
    capped,
    fee_inr: round(fee),
  };
};

module.exports = { estimateRegistrationFee };
