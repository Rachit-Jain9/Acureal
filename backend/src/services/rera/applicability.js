'use strict';

/**
 * applicability — the conservative K-RERA applicability engine.
 *
 * Returns a tri-state (plus a not-mapped state) with a human-readable
 * `rule_trace` so the operator sees *why*:
 *   - in_scope      : registration appears required (threshold crossed / registered)
 *   - likely_exempt : below thresholds, or nothing being sold, or operated-not-sold
 *   - uncertain     : inputs missing — conservatively treated as potentially in-scope
 *   - na            : asset class not mapped to a K-RERA project type
 *
 * HARD RULE (operator vision doc): never mark a project exempt merely because
 * the asset class is "commercial", "lease" or "redevelopment". Exemption needs
 * a positive signal — below-threshold size OR an explicit "nothing is being
 * sold". Statutory test: > 500 sq m OR > 8 units/plots (each phase counts).
 */

const { ASSET_CLASS_RERA_NATURE } = require('../../constants/reraRequirementCatalog');

const THRESHOLD_SQM = 500;
const THRESHOLD_UNITS = 8;

const assessApplicability = (ctx = {}) => {
  const { assetClass, landAreaSqm, unitOrPlotCount, saleIntent, reraNumber } = ctx;
  const nature = ASSET_CLASS_RERA_NATURE[assetClass] || null;
  const trace = [];
  const signals = {
    nature,
    area_over_threshold: null,
    units_over_threshold: null,
    sale_intent: typeof saleIntent === 'boolean' ? saleIntent : null,
    already_registered: !!reraNumber,
  };

  // Threshold signals (tri-valued — unknown stays unknown, never "below").
  let areaOver = null;
  if (Number.isFinite(Number(landAreaSqm))) {
    areaOver = Number(landAreaSqm) > THRESHOLD_SQM;
    signals.area_over_threshold = areaOver;
    trace.push({ text: `land area ${Math.round(Number(landAreaSqm))} sqm ${areaOver ? '>' : '≤'} ${THRESHOLD_SQM} sqm`, result: areaOver });
  } else {
    trace.push({ text: `land area not set (threshold ${THRESHOLD_SQM} sqm)`, result: null });
  }

  let unitsOver = null;
  if (Number.isFinite(Number(unitOrPlotCount))) {
    unitsOver = Number(unitOrPlotCount) > THRESHOLD_UNITS;
    signals.units_over_threshold = unitsOver;
    trace.push({ text: `${Number(unitOrPlotCount)} units/plots ${unitsOver ? '>' : '≤'} ${THRESHOLD_UNITS}`, result: unitsOver });
  } else {
    trace.push({ text: `unit/plot count not set (threshold ${THRESHOLD_UNITS})`, result: null });
  }

  const thresholdCrossed =
    areaOver === true || unitsOver === true ? true
      : areaOver === false && unitsOver === false ? false
        : null;

  // Asset class not mapped → cannot assess; not a recognised K-RERA project type.
  if (!nature) {
    return {
      status: 'na',
      reason: `Asset class "${assetClass || 'unknown'}" does not map to a K-RERA project type — set the asset class to assess readiness.`,
      rule_trace: trace,
      signals,
    };
  }

  // Already registered → in-scope; the pack becomes a verification guide.
  if (reraNumber) {
    trace.push({ text: `RERA registration number on file (${reraNumber})`, result: true });
    return {
      status: 'in_scope',
      reason: `This project already carries a RERA registration number (${reraNumber}). The checklist doubles as a verification and post-registration guide.`,
      rule_trace: trace,
      signals,
    };
  }

  // Nothing being sold → likely outside RERA (but advise structure review).
  if (saleIntent === false) {
    trace.push({ text: 'nothing is being sold, booked, marketed or allotted', result: true });
    return {
      status: 'likely_exempt',
      reason: 'Nothing is being sold, booked, marketed or allotted — K-RERA project registration is likely not triggered. A structure review is still advised before relying on this.',
      rule_trace: trace,
      signals,
    };
  }

  // Hospitality / raw land are operated or held, not unit-sold → exempt by nature
  // unless sale-intent is explicitly affirmed.
  if (nature === 'rarely' && saleIntent !== true) {
    return {
      status: 'likely_exempt',
      reason: assetClass === 'raw_land'
        ? 'Raw land held or sold as-is does not normally trigger K-RERA project registration. If plots/units are being sold, set "units being sold" to revisit.'
        : 'Hospitality (operated, not unit-sold) does not normally trigger K-RERA project registration. If units are being strata-sold, set "units being sold" to revisit.',
      rule_trace: trace,
      signals,
    };
  }

  // Threshold crossed → in scope.
  if (thresholdCrossed === true) {
    const why = [areaOver ? `land area exceeds ${THRESHOLD_SQM} sqm` : null, unitsOver ? `more than ${THRESHOLD_UNITS} units/plots` : null].filter(Boolean).join(' and ');
    return {
      status: 'in_scope',
      reason: `Likely K-RERA in-scope — ${why}. Registration is required before any marketing, booking or sale.`,
      rule_trace: trace,
      signals,
    };
  }

  // Both thresholds known and below → likely exempt (phase aggregation caveat).
  if (thresholdCrossed === false) {
    return {
      status: 'likely_exempt',
      reason: `Below both statutory thresholds (≤ ${THRESHOLD_SQM} sqm and ≤ ${THRESHOLD_UNITS} units/plots) — likely exempt. Confirm phase aggregation (each phase counts toward the threshold) before relying on the exemption.`,
      rule_trace: trace,
      signals,
    };
  }

  // Inputs missing → uncertain, conservatively shown as a guide.
  const needs = [];
  if (signals.area_over_threshold === null) needs.push('land area');
  if (signals.units_over_threshold === null) needs.push('unit/plot count');
  if (nature === 'conditional' && saleIntent !== true) needs.push('whether units are being sold');
  return {
    status: 'uncertain',
    reason: `Cannot determine K-RERA applicability yet — set ${needs.join(', ')} on this deal. Conservatively treated as potentially in-scope, so the checklist is shown as a guide.`,
    rule_trace: trace,
    signals,
  };
};

module.exports = { assessApplicability, THRESHOLD_SQM, THRESHOLD_UNITS };
