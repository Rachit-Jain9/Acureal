const { ASSET_CLASSES } = require('./assetClasses');

const PROPERTY_TYPES = [
  'land',
  'residential',
  'commercial',
  'mixed_use',
  'industrial',
  'office',
  'retail',
  'hospitality',
];

const ZONING_TYPES = ['residential', 'commercial', 'mixed_use', 'industrial', 'agricultural'];

const DEAL_TYPES = ['acquisition', 'jv', 'da', 'outright'];

const DEAL_STAGES = [
  'sourced',
  'screening',
  'site_visit',
  'loi',
  'due_diligence',
  'underwriting',
  'ic_review',
  'negotiation',
  'active',
  'closed',
  'dead',
];

const LIVE_DEAL_STAGES = DEAL_STAGES.filter((stage) => !['closed', 'dead'].includes(stage));

const STAGE_TRANSITIONS = {
  sourced: ['screening', 'dead'],
  screening: ['site_visit', 'sourced', 'dead'],
  site_visit: ['loi', 'screening', 'dead'],
  loi: ['due_diligence', 'site_visit', 'dead'],
  due_diligence: ['underwriting', 'loi', 'dead'],
  underwriting: ['ic_review', 'due_diligence', 'dead'],
  ic_review: ['negotiation', 'underwriting', 'dead'],
  negotiation: ['active', 'ic_review', 'dead'],
  active: ['closed', 'negotiation', 'dead'],
  closed: [],
  dead: ['sourced', 'screening'],
};

const ACTIVITY_TYPES = ['call', 'site_visit', 'meeting', 'loi_sent', 'offer_received', 'email', 'note'];
const ACTIVITY_STATUSES = ['open', 'completed', 'cancelled'];
const ACTIVITY_PRIORITIES = ['low', 'medium', 'high'];

const LAND_PRICING_BASES = ['total_cr', 'per_sqft', 'per_acre'];
const AREA_UNITS = ['sqft', 'acre'];

const PROPERTY_TYPE_ALIASES = {
  land_parcel: 'land',
  plotted_land: 'land',
  plot: 'land',
  mixeduse: 'mixed_use',
  'mixed-use': 'mixed_use',
};

const AREA_UNIT_ALIASES = {
  sq_ft: 'sqft',
  sqfeet: 'sqft',
  square_feet: 'sqft',
  'square feet': 'sqft',
  acres: 'acre',
};

const LAND_PRICING_BASIS_ALIASES = {
  per_acres: 'per_acre',
  total: 'total_cr',
  per_square_foot: 'per_sqft',
  per_square_feet: 'per_sqft',
};

const normalizePropertyType = (value) => {
  if (!value) {
    return value;
  }

  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  return PROPERTY_TYPE_ALIASES[normalized] || normalized;
};

const normalizeAreaUnit = (value) => {
  if (!value) {
    return value;
  }

  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  return AREA_UNIT_ALIASES[normalized] || normalized;
};

const normalizeLandPricingBasis = (value) => {
  if (!value) {
    return value;
  }

  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  return LAND_PRICING_BASIS_ALIASES[normalized] || normalized;
};

const canTransitionStage = (fromStage, toStage) => {
  if (!fromStage || !toStage || fromStage === toStage) {
    return false;
  }

  const allowedTransitions = STAGE_TRANSITIONS[fromStage] || [];
  return allowedTransitions.includes(toStage);
};

// DEAL_STRUCTURES is derived from `@redip/real-estate-ontology` so the
// list stays in lockstep with the single source of truth that backs
// extraction, exports, and the UI. Anyone adding a new structure adds
// it to packages/real-estate-ontology/src/v1.json, and this constant
// (plus every place that imports it) picks it up automatically. The
// parity test in tests/ontology.parity.test.js locks the contract.
const { getDealStructureKeys } = require('../../../packages/real-estate-ontology/src');
const DEAL_STRUCTURES = getDealStructureKeys();

const DOC_TYPES = [
  'title_deed',
  'mother_deed',
  'sale_deed',
  'ec',
  'rtc_pahani',
  'mutation',
  'conversion_certificate',
  'khata',
  'layout_approval',
  'sanctioned_plan',
  'jda_jv',
  'broker_quote',
  'guidance_value_report',
  'igr_guidance_pdf',
  'bbmp_uav_pdf',
  'zoning_certificate',
  'e_khata',
  'rmp_table',
  'kgis_extract',
  'rent_roll',
  'other',
];

const DD_CATEGORIES = [
  'title_ownership',
  'land_classification',
  'seller_validity',
  'statutory',
  'financial_commercial',
  'project_specific',
  'physical_technical',
];

const DD_SEVERITIES = ['deal_breaker', 'buildability_blocker', 'commercial_blocker', 'secondary'];
const DD_STATUSES = ['pending', 'in_progress', 'completed', 'flagged', 'not_applicable'];

const APPROVAL_TYPES = [
  'planning',
  'conversion',
  'khata',
  'building_plan',
  'fire_noc',
  'water_sewage',
  'power',
  'airport_height',
  'environment',
  'pollution',
  'drainage_nala',
  'rera',
  'other',
];

const RISK_CATEGORIES = ['title', 'zoning', 'regulatory', 'financial', 'physical', 'market', 'legal'];
const RISK_SEVERITIES = ['critical', 'high', 'medium', 'low'];

// Professional sign-off board (deal_signoffs).
const SIGNOFF_ROLES = ['advocate', 'ca', 'architect', 'engineer', 'structural_engineer', 'banker', 'other'];
const SIGNOFF_STATUSES = ['not_started', 'requested', 'signed', 'rejected', 'expired'];

// The standard professional sign-offs an Indian RERA deal collects — used to
// seed a deal's board on demand. Each: { professional_role, scope, form_ref }.
const SIGNOFF_TEMPLATES = [
  { professional_role: 'advocate', scope: 'Title, encumbrance & litigation opinion', form_ref: null },
  { professional_role: 'ca', scope: 'Project cost + 70% escrow certificate', form_ref: 'Form-1' },
  { professional_role: 'architect', scope: 'Sanctioned plan & progress certificate', form_ref: 'Form-2' },
  { professional_role: 'engineer', scope: 'Cost & progress certificate', form_ref: 'Form-3' },
  { professional_role: 'structural_engineer', scope: 'Structural safety certificate', form_ref: null },
  { professional_role: 'banker', scope: 'RERA bank account confirmation / affidavit', form_ref: null },
];

module.exports = {
  PROPERTY_TYPES,
  ZONING_TYPES,
  DEAL_TYPES,
  DEAL_STAGES,
  LIVE_DEAL_STAGES,
  STAGE_TRANSITIONS,
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_PRIORITIES,
  LAND_PRICING_BASES,
  AREA_UNITS,
  normalizePropertyType,
  normalizeAreaUnit,
  normalizeLandPricingBasis,
  canTransitionStage,
  ASSET_CLASSES,
  DEAL_STRUCTURES,
  DOC_TYPES,
  DD_CATEGORIES,
  DD_SEVERITIES,
  DD_STATUSES,
  APPROVAL_TYPES,
  RISK_CATEGORIES,
  RISK_SEVERITIES,
  SIGNOFF_ROLES,
  SIGNOFF_STATUSES,
  SIGNOFF_TEMPLATES,
};
