'use strict';

/**
 * Karnataka RERA project-registration fee schedule — Phase 4 / V1.
 *
 * A single, versioned source of truth for the registration-fee estimate. The
 * figures are the published Karnataka Real Estate (Regulation and Development)
 * Rules, 2017 fee categories (per the K-RERA portal FAQ). They are an
 * **estimate** surfaced with a visible disclaimer + `last_verified` date —
 * never presented as an authoritative fee. Fees are levied on the project
 * LAND area (sq m).
 *
 * To update after a notification: bump `version`, set `effective_from` +
 * `notification_ref`, refresh `last_verified`, and adjust the rates/caps.
 * Nothing else in the engine hardcodes a fee.
 */

const RERA_FEE_SCHEDULE = Object.freeze({
  version: '2017.1',
  effective_from: '2017-07-10', // Karnataka RERD Rules 2017 notification
  notification_ref:
    'Karnataka Real Estate (Regulation and Development) Rules, 2017 — fee categories per the K-RERA portal FAQ',
  last_verified: '2026-06-04',
  source_url: 'https://rera.karnataka.gov.in/',
  disclaimer:
    'Estimate only, computed from the published Karnataka Rules 2017 fee categories. ' +
    'Fees may be revised by notification and mixed-use categorisation can be nuanced — ' +
    'verify the current rate on rera.karnataka.gov.in before payment.',
  // rate_low applies up to threshold_sqm; rate_high applies above it.
  categories: Object.freeze({
    group_housing: Object.freeze({
      label: 'Group housing / residential apartments',
      rate_low_inr_per_sqm: 5,
      rate_high_inr_per_sqm: 10,
      threshold_sqm: 1000,
      cap_inr: 500000,
    }),
    plotted: Object.freeze({
      label: 'Plotted development',
      rate_low_inr_per_sqm: 5,
      rate_high_inr_per_sqm: 5,
      threshold_sqm: 1000,
      cap_inr: 200000,
    }),
    commercial: Object.freeze({
      label: 'Commercial',
      rate_low_inr_per_sqm: 20,
      rate_high_inr_per_sqm: 25,
      threshold_sqm: 1000,
      cap_inr: 1000000,
    }),
    mixed: Object.freeze({
      label: 'Mixed development',
      rate_low_inr_per_sqm: 10,
      rate_high_inr_per_sqm: 15,
      threshold_sqm: 1000,
      cap_inr: 700000,
    }),
  }),
});

// Maps an Acureal asset_class onto a fee category. Asset classes that are not
// project-registration unit sales (hospitality, raw_land) have no category.
const ASSET_CLASS_FEE_CATEGORY = Object.freeze({
  residential_apartments: 'group_housing',
  villas: 'group_housing',
  redevelopment: 'group_housing',
  plotted_development: 'plotted',
  mixed_use: 'mixed',
  commercial_office: 'commercial',
  retail: 'commercial',
  industrial_warehousing: 'commercial',
});

module.exports = { RERA_FEE_SCHEDULE, ASSET_CLASS_FEE_CATEGORY };
