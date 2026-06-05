'use strict';

/**
 * complianceContext — assembles the single normalized context object that the
 * whole K-RERA engine (applicability, composer, fee) is a pure function of.
 *
 * This is the seam every future pillar plugs into (mismatch engine, compliance
 * calendar, promoter vault): give them more inputs here and they flow through
 * without touching the engine's call shape.
 *
 * Pure: no DB, no AI. Derives land area in sq m from the deal's existing
 * extent fields (reusing landPricing.normalizeAreaSqft), and a joint-development
 * flag from the deal structure / type / JV split.
 */

const { normalizeAreaSqft } = require('../../utils/landPricing');
const { SQFT_PER_ACRE } = require('../../config/india');

const SQFT_PER_SQM = 10.76391041671;

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Derive project land area in sq m from the deal's extent fields (+ property fallback). */
const deriveLandAreaSqm = (deal) => {
  if (!deal) return null;
  let sqft = normalizeAreaSqft(deal.land_extent_input_value, deal.land_extent_input_unit);
  if (!sqft) sqft = toNum(deal.land_area_sqft);
  if (!sqft) {
    const acres = toNum(deal.land_area_acres);
    if (acres) sqft = acres * SQFT_PER_ACRE;
  }
  if (!sqft || sqft <= 0) return null;
  return Math.round((sqft / SQFT_PER_SQM) * 100) / 100;
};

/** A deal is a joint development when its structure/type or JV split says so. */
const deriveIsJoint = (deal) => {
  if (!deal) return false;
  const ds = String(deal.deal_structure || '').toLowerCase();
  const dt = String(deal.deal_type || '').toLowerCase();
  if (/jda|joint|jv|development[_\s-]*agreement/.test(ds)) return true;
  if (dt === 'jv' || dt === 'da') return true;
  const dev = toNum(deal.jv_split_developer_pct);
  const lo = toNum(deal.jv_split_landowner_pct);
  if ((dev && dev > 0 && dev < 100) || (lo && lo > 0 && lo < 100)) return true;
  return false;
};

/**
 * buildReraContext(deal, { approvals, documents, extractedFields }) → context.
 * Tolerates a missing/partial deal — every field degrades to null/empty.
 */
const buildReraContext = (deal, { approvals = [], documents = [], extractedFields = {} } = {}) => {
  const reraInputs = (deal && deal.rera_inputs && typeof deal.rera_inputs === 'object') ? deal.rera_inputs : {};
  const reraNumber = (deal && (deal.rera_number || deal.rera_registration_number)) || null;
  return {
    assetClass: (deal && deal.asset_class) || null,
    dealStructure: (deal && deal.deal_structure) || null,
    dealType: (deal && deal.deal_type) || null,
    isJoint: deriveIsJoint(deal),
    landAreaSqm: deriveLandAreaSqm(deal),
    unitOrPlotCount: toNum(reraInputs.unit_or_plot_count),
    saleIntent: typeof reraInputs.sale_intent === 'boolean' ? reraInputs.sale_intent : null,
    completionDate: reraInputs.completion_date || null,
    reraNumber,
    reraExpiryDate: (deal && deal.rera_expiry_date) || null,
    feeOverrides: reraInputs.fee_overrides || null,
    dealName: (deal && deal.name) || null,
    approvals: Array.isArray(approvals) ? approvals : [],
    documents: Array.isArray(documents) ? documents : [],
    extractedFields: extractedFields && typeof extractedFields === 'object' ? extractedFields : {},
  };
};

module.exports = { buildReraContext, deriveLandAreaSqm, deriveIsJoint, SQFT_PER_SQM };
