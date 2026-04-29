'use strict';

/**
 * P8 — i18n-ready message keys for parcel intelligence narratives.
 *
 * Why a keyed table instead of inline strings:
 *   - Hindi/Kannada UI is on the roadmap. Pulling messages out of the math
 *     functions is the prerequisite for swapping them via a translation file.
 *   - Tests can assert on the key, not the English wording. A copy tweak no
 *     longer breaks regression tests.
 *   - Documentation: the table below is the canonical list of every parcel
 *     intelligence narrative the user can see.
 *
 * Today the resolver always returns English. When i18n lands, swap the
 * resolveMessage() implementation to walk a locale-aware dictionary.
 */

const MESSAGES = {
  // Buildability messages — keyed by status + source
  'buildability.status.reference_match.global':
    'FAR is matched to an approved reference rule. Buildable area is a screening estimate after available setback deductions.',
  'buildability.status.reference_match.with_additional':
    'Base FAR is reference-matched. Additional/TDR FAR remains pending authority and project-specific verification. Buildable area is a screening estimate after available setback deductions.',
  'buildability.missing_input.land_area':
    'Land area is required before buildable area can be calculated.',
  'buildability.missing_rule.with_user_fsi':
    'Only a user-provided FSI is available. Match an approved FAR matrix rule before using this as reference buildability.',
  'buildability.missing_rule.no_user_fsi':
    'No approved FAR matrix rule matched this parcel.',

  // Selection failures
  'far_rule.no_match':
    'No approved FAR matrix rule matches this parcel within the configured plot-area and road-width bands.',
  'far_rule.land_area_missing':
    'Land area is required before a FAR rule can be selected.',
  'far_rule.road_width_missing':
    'Road width is required before a FAR rule can be selected.',

  // K-GIS messages
  'kgis.not_requested':
    'K-GIS reference lookup has not been run for this parcel.',
  'kgis.cached':
    'Cached K-GIS reference context. Treat geometry as reference only.',

  // OSM road-width messages (T6)
  'osm.not_requested':
    'OSM road-width inference has not been run for this parcel.',
  'osm.matched':
    'OSM-inferred road context. Treat as reference only — verify on site.',
  'osm.no_road_nearby':
    'No highways found near the parcel centroid in OpenStreetMap.',

  // Verdict next-action messages
  'verdict.next.upload_authority':
    'Upload an authority document or assign a reviewed zone to lift the verdict.',
};

const resolveMessage = (key, fallback = '') => MESSAGES[key] || fallback;

module.exports = {
  MESSAGES,
  resolveMessage,
};
