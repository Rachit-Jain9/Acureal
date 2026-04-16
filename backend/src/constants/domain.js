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

const DEAL_STRUCTURES = [
  'outright',
  'jv',
  'jda',
  'revenue_share',
  'area_share',
  'profit_share',
  'ground_lease',
  'hybrid',
];

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
};
