/**
 * Zoning taxonomy — frontend single source of truth.
 *
 * Keys MUST match the Postgres `zoning_type` enum and
 * `backend/src/constants/domain.js` `ZONING_TYPES` exactly. The API
 * validator (`property.routes.js`, `body('zoning').isIn(ZONING_TYPES)`)
 * rejects any value outside that set, and the DB write fails on anything
 * the enum does not contain.
 *
 * The key set is contracted against `domain.js` `ZONING_TYPES` and
 * `@redip/real-estate-ontology`'s `zoning.values` by
 * `__tests__/zoning.contract.test.js` — the three sources cannot
 * silently drift.
 *
 * This is the coarse property-classification taxonomy. The detailed
 * Karnataka RMP 2031 zone codes (R1/R2, Public & Semi-Public, etc.) are
 * a separate, richer dataset held in `master_plan_zones` — not this enum.
 */
export const ZONING_CONFIG = [
  { value: 'residential',  label: 'Residential' },
  { value: 'commercial',   label: 'Commercial' },
  { value: 'mixed_use',    label: 'Mixed Use' },
  { value: 'industrial',   label: 'Industrial' },
  { value: 'agricultural', label: 'Agricultural' },
];

export const ZONING_TYPES = ZONING_CONFIG.map((entry) => entry.value);

export const ZONING_LABELS = Object.fromEntries(
  ZONING_CONFIG.map((entry) => [entry.value, entry.label]),
);
