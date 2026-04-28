'use strict';

// Parcel red-flag rule registry.
//
// Each rule is a pure function over the composed parcel snapshot inputs that
// `composeParcelIntelligence` already passes around: { property, zone,
// buildability, guidance, kgis, landeed }. A rule decides whether it fires and
// produces the per-call detail string. Severity, label, and a stable id live
// on the registry entry — they're metadata, not per-call computation.
//
// Why a registry: today the rules live as inline `if`s inside the orchestrator
// and aren't named, testable, or listable. After this extraction, the panel's
// "red flags" array is unchanged byte-for-byte (parity-tested), but every rule
// is a pure function with a stable id we can document, expose on /status, and
// eventually let admins toggle per-org without touching the orchestrator.
//
// Adding a rule = appending to PARCEL_RED_FLAG_REGISTRY. The runtime output
// shape is `[{ severity, label, detail }]` and is intentionally minimal — the
// id stays on the registry so callers that don't need it (the panel) aren't
// forced to learn it. Admins discover the full ruleset via /api/parcel-
// intelligence/status.

const { toNumber } = require('../utils/parcelBuildability');

const SEVERITY = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

const PARCEL_RED_FLAG_REGISTRY = Object.freeze([
  {
    id: 'planning_zone_not_assigned',
    severity: SEVERITY.HIGH,
    label: 'Planning zone not assigned',
    description:
      'The property has no reviewed RMP zone linked. FAR matrix lookup and buildability are not authoritative until a zone is assigned.',
    predicate: ({ zone } = {}) => !zone?.zone_code,
    detailFor: () => 'Assign a reviewed RMP zone before relying on FAR/buildability output.',
  },
  {
    id: 'land_area_missing',
    severity: SEVERITY.HIGH,
    label: 'Land area missing',
    description:
      'Land area in sqft (or acres) is required for any FAR rule selection or buildable area computation.',
    predicate: ({ property } = {}) => !toNumber(property?.land_area_sqft),
    detailFor: () => 'Buildability cannot be calculated without land extent.',
  },
  {
    id: 'road_width_missing',
    severity: SEVERITY.MEDIUM,
    label: 'Road width missing',
    description:
      'Abutting road width drives the FAR matrix band. Without it, the rule selection falls back to the lowest band.',
    predicate: ({ property } = {}) => toNumber(property?.road_width_mtrs) === null,
    detailFor: () => 'FAR matrix matching needs abutting road width.',
  },
  {
    id: 'buildability_needs_verification',
    severity: SEVERITY.MEDIUM,
    label: 'Buildability pending verification',
    description:
      'The buildability engine produced a screening estimate but flagged inputs or rule status as needing manual verification.',
    predicate: ({ buildability } = {}) => buildability?.status === 'needs_verification',
    detailFor: ({ buildability } = {}) => buildability?.message,
  },
  {
    id: 'setback_inputs_partial',
    severity: SEVERITY.MEDIUM,
    label: 'Setback inputs are partial',
    description:
      'Front, rear, and side setback rules — or plot frontage and depth — are not fully populated, so the screening buildable area applies only the available subset.',
    predicate: ({ buildability } = {}) =>
      buildability?.values?.setback_input_status === 'partial',
    detailFor: () =>
      'The screening buildable area applies available setback rules, but plot frontage/depth and full side/rear setback rules should be verified.',
  },
  {
    id: 'guidance_not_matched',
    severity: SEVERITY.MEDIUM,
    label: 'Guidance value not matched',
    description:
      'No approved IGR guidance row matched the property locality/road. Underwriting circle-rate inputs cannot be cross-checked.',
    predicate: ({ guidance } = {}) =>
      !['matched', 'low_confidence'].includes(guidance?.status),
    detailFor: ({ guidance } = {}) =>
      guidance?.message || 'Upload a guidance report or configure approved IGR rows.',
  },
  {
    id: 'guidance_low_confidence',
    severity: SEVERITY.MEDIUM,
    label: 'Low-confidence guidance match',
    description:
      'The matched IGR guidance row scored below the high-confidence threshold (e.g., trigram match against a partial locality string). Treat as a starting point, not a citation.',
    predicate: ({ guidance } = {}) => guidance?.status === 'low_confidence',
    detailFor: () => 'Analyst review is required before using this guidance value in IC material.',
  },
  {
    id: 'landeed_not_configured',
    severity: SEVERITY.LOW,
    label: 'Vendor guidance backup not configured',
    description:
      'The Landeed vendor adapter is not credentialled. Optional — IGR guidance is the primary source — but useful as a backstop.',
    predicate: ({ landeed } = {}) => landeed?.status === 'not_configured',
    detailFor: () =>
      'Landeed can remain disabled, but API credentials are required for vendor-backed guidance refresh.',
  },
  {
    id: 'kgis_not_refreshed',
    severity: SEVERITY.LOW,
    label: 'K-GIS not refreshed',
    description:
      'No cached K-GIS hierarchy/geometry for this parcel. Lat/lng-driven; running a refresh fills it.',
    predicate: ({ kgis } = {}) => kgis?.status === 'not_requested',
    detailFor: () =>
      'Run refresh when coordinates are available to cache reference hierarchy/survey context.',
  },
  {
    id: 'rmp_draft_or_reference',
    severity: SEVERITY.MEDIUM,
    label: 'RMP status is draft/reference',
    description:
      'The matched zone or FAR rule is sourced from a draft / reference plan version. Authority status must be verified before reliance.',
    predicate: ({ zone, buildability } = {}) =>
      zone?.plan_status === 'draft' || buildability?.rule?.plan_status === 'draft_reference',
    detailFor: () => 'Use as screening intelligence only until live authority status is verified.',
  },
  {
    id: 'snapshot_stale',
    severity: SEVERITY.LOW,
    label: 'Parcel snapshot is stale',
    description:
      'No parcel intelligence refresh has been run in the last 30 days. K-GIS hierarchy, guidance match, and buildability may not reflect current data.',
    predicate: ({ snapshot } = {}) => {
      const generatedAt = snapshot?.generated_at;
      if (!generatedAt) return false;
      return Date.now() - new Date(generatedAt).getTime() > 30 * 24 * 60 * 60 * 1000;
    },
    detailFor: ({ snapshot } = {}) => {
      const generatedAt = snapshot?.generated_at;
      if (!generatedAt) return 'Run a refresh to update K-GIS hierarchy, guidance match, and buildability.';
      const days = Math.floor((Date.now() - new Date(generatedAt).getTime()) / (1000 * 60 * 60 * 24));
      return `Last refresh was ${days} day${days === 1 ? '' : 's'} ago. Run a refresh to ensure K-GIS, guidance, and buildability are current.`;
    },
  },
]);

// Run every registered rule against the inputs. Returns the same
// `[{ severity, label, detail }]` shape that the panel renders today.
// Rules fire in registry-declaration order — that's the panel's display order.
const runParcelRedFlags = (inputs = {}) => {
  const flags = [];
  for (const rule of PARCEL_RED_FLAG_REGISTRY) {
    if (!rule.predicate(inputs)) continue;
    flags.push({
      severity: rule.severity,
      label: rule.label,
      detail: rule.detailFor(inputs),
    });
  }
  return flags;
};

// Public registry shape for /api/parcel-intelligence/status — strips the
// predicate/detailFor functions so the response is JSON-safe and admins see
// only the documented surface (id, severity, label, description).
const listRegistryDescriptors = () =>
  PARCEL_RED_FLAG_REGISTRY.map(({ id, severity, label, description }) => ({
    id,
    severity,
    label,
    description,
  }));

module.exports = {
  PARCEL_RED_FLAG_REGISTRY,
  SEVERITY,
  runParcelRedFlags,
  listRegistryDescriptors,
};
