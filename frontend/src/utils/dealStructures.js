/**
 * Deal-structure taxonomy — frontend single source of truth.
 *
 * Keys MUST match `backend/src/constants/domain.js` `DEAL_STRUCTURES`
 * exactly. Validator `body('dealStructure').isIn(DEAL_STRUCTURES)` will
 * reject any value not in that list, so frontend submitting a key not in
 * this file would be rejected by the API at create time.
 *
 * Pre-NX59 this list was duplicated as a local `DEAL_STRUCTURE_LABELS`
 * constant in `DealsPage.jsx` (create form) AND `DealDetailPage.jsx`
 * (edit form). Centralizing here removes the drift risk.
 *
 * The key set is contracted against `backend/src/constants/domain.js`
 * `DEAL_STRUCTURES` and `@redip/real-estate-ontology`'s `deal_structure`
 * by `__tests__/dealStructures.contract.test.js` — the three sources
 * cannot silently drift. The ontology was reconciled to this 8-key list
 * per the operator decision of 2026-05-22 (ontology v1.1.0).
 */
export const DEAL_STRUCTURE_CONFIG = [
  { value: 'outright',      label: 'Outright Purchase' },
  { value: 'jv',            label: 'JV (Joint Venture)' },
  { value: 'jda',           label: 'JDA (Development Agreement)' },
  { value: 'revenue_share', label: 'Revenue Share' },
  { value: 'area_share',    label: 'Area Share' },
  { value: 'profit_share',  label: 'Profit Share' },
  { value: 'ground_lease',  label: 'Ground Lease' },
  { value: 'hybrid',        label: 'Hybrid' },
];

export const DEAL_STRUCTURES = DEAL_STRUCTURE_CONFIG.map((entry) => entry.value);

export const DEAL_STRUCTURE_LABELS = Object.fromEntries(
  DEAL_STRUCTURE_CONFIG.map((entry) => [entry.value, entry.label]),
);

/**
 * Compact-label variant for table cells / chips where space is tight.
 * Falls back to the full label when no compact alternative exists.
 */
export const DEAL_STRUCTURE_LABELS_COMPACT = {
  outright:      'Outright',
  jv:            'JV',
  jda:           'JDA',
  revenue_share: 'Rev Share',
  area_share:    'Area Share',
  profit_share:  'Profit Share',
  ground_lease:  'Ground Lease',
  hybrid:        'Hybrid',
};
