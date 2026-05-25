/**
 * Mirror of `backend/src/utils/dealStructureMatrix.js`. Keep in lockstep —
 * change one, change both, run the parity test
 * (`backend/tests/dealStructureMatrix.parity.test.js`).
 *
 * Why a mirror instead of a shared package: the operator's established
 * pure-JS + parity-test pattern (see `parcelBuildability.js`) avoids the
 * monorepo overhead while making drift impossible. Backend is CommonJS;
 * this file is ESM; the parity test strips `export ` keywords and evals
 * the source under a CommonJS shim, then runs identical fixtures through
 * both and asserts the matrices are identical.
 *
 * If the matrix grows beyond ~300 LOC consider promoting to a shared
 * `packages/deal-structure-matrix` workspace — until then the mirror is
 * the simplest thing that works.
 */

export const ASSET_CLASSES = [
  'residential_apartments',
  'plotted_development',
  'villas',
  'commercial_office',
  'retail',
  'industrial_warehousing',
  'hospitality',
  'mixed_use',
  'raw_land',
  'redevelopment',
];

export const DEAL_STRUCTURES = [
  'outright',
  'jv',
  'jda',
  'revenue_share',
  'area_share',
  'profit_share',
  'ground_lease',
  'hybrid',
];

export const INVALID_PAIRS = {
  'hospitality:area_share':
    'Hotel keys cannot be sliced by area between landowner and developer. Consider revenue_share or profit_share instead.',
  'plotted_development:ground_lease':
    'Plots are sold freehold to end buyers — a ground lease arrangement is upside-down here. Consider outright or jda.',
  'villas:ground_lease':
    'Villas are sold freehold to end buyers — a ground lease arrangement is upside-down. Consider outright or jda.',
  'redevelopment:ground_lease':
    'Redevelopment cannot run on a ground lease — existing owners hold the freehold and would be ground-leasing land they already own. Consider jda or area_share with corpus.',
};

export const STRUCTURE_APPROVALS = {
  outright: [],
  jv: [
    {
      approval_type: 'corporate',
      name: 'JV Agreement (registered with sub-registrar where applicable)',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'SPV / Joint-venture company incorporation certificate (RoC)',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'Board resolutions of both parties authorizing the JV',
      is_required: true,
    },
  ],
  jda: [
    {
      approval_type: 'corporate',
      name: 'JDA executed and registered (Karnataka Stamp Act §5(g-c) compliant)',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'Landowner Power of Attorney (irrevocable, registered)',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'Mortgage-permission clause in JDA (developer construction-debt eligibility)',
      is_required: false,
    },
  ],
  revenue_share: [
    {
      approval_type: 'corporate',
      name: 'Revenue-share agreement (registered) with escrow waterfall',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'Escrow account opened with bank letter',
      is_required: true,
    },
  ],
  area_share: [
    {
      approval_type: 'corporate',
      name: 'Area-share allocation deed (tower-wise / floor-wise split)',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'Partition deed draft (post-completion allocation)',
      is_required: false,
    },
  ],
  profit_share: [
    {
      approval_type: 'corporate',
      name: 'Profit-share agreement (registered)',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'Annual audit-rights clause (Big-4 auditor agreed)',
      is_required: true,
    },
  ],
  ground_lease: [
    {
      approval_type: 'corporate',
      name: 'Ground lease deed (90 / 99 year, registered)',
      is_required: true,
    },
    {
      approval_type: 'corporate',
      name: 'Mortgage-permission clause for LRD eligibility',
      is_required: false,
    },
    {
      approval_type: 'corporate',
      name: 'Ground rent escalation schedule (CPI / fixed step-up agreed)',
      is_required: true,
    },
  ],
  hybrid: [
    {
      approval_type: 'corporate',
      name: 'Master agreement defining hybrid structure (regd. where applicable)',
      is_required: true,
    },
  ],
};

export const ASSET_CLASS_STRUCTURE_OVERLAYS = {
  redevelopment: {
    _always: [
      {
        approval_type: 'corporate',
        name: 'Society / existing-owner consent (≥66% per Karnataka norms)',
        is_required: true,
      },
      {
        approval_type: 'corporate',
        name: 'Corpus agreement with existing owners',
        is_required: true,
      },
    ],
  },
  hospitality: {
    _always: [
      {
        approval_type: 'corporate',
        name: 'Hotel operator agreement (HMA / franchise / lease) — operator scope and term',
        is_required: true,
      },
    ],
  },
};

export const STRUCTURE_REQUIRED_DOCTYPES = {
  outright: [],
  jv: ['jv_agreement', 'spv_incorporation_certificate', 'board_resolution'],
  jda: ['jda_draft', 'jda_signed', 'landowner_power_of_attorney'],
  revenue_share: ['revenue_share_agreement', 'escrow_account_letter'],
  area_share: ['area_share_deed', 'partition_deed_draft'],
  profit_share: ['profit_share_agreement'],
  ground_lease: ['ground_lease_deed', 'mortgage_permission_letter'],
  hybrid: ['master_agreement'],
};

export const STRUCTURE_RISK_PRESETS = {
  outright: { elevated: [], notes: 'Cleanest title and capital path; risk concentrated in price and approvals.' },
  jv: {
    elevated: ['financial', 'title_ownership'],
    notes: 'SPV / capital-call discipline + dual-party title chain create incremental risk on both axes.',
  },
  jda: {
    elevated: ['title_ownership', 'financial'],
    notes: 'Landowner consent, JDA mortgage permission, and revenue-share clause hygiene drive the risk profile.',
  },
  revenue_share: {
    elevated: ['financial'],
    notes: 'Escrow waterfall and absorption-rate sensitivity are the dominant failure modes.',
  },
  area_share: {
    elevated: ['title_ownership', 'physical_technical'],
    notes: 'Area-allocation deed + partition mechanics create both title and execution risk.',
  },
  profit_share: {
    elevated: ['financial'],
    notes: 'Audit rights, cost discipline, and the absence of a Big-4 audit clause materially shift risk.',
  },
  ground_lease: {
    elevated: ['financial'],
    notes: 'Ground rent escalation and interest-rate sensitivity dominate; LRD eligibility hinges on mortgage permission.',
  },
  hybrid: {
    elevated: ['title_ownership', 'financial'],
    notes: 'Compound structures require explicit master-agreement scope; risk profile is the union of the legs.',
  },
};

export const ASSET_CLASS_RISK_BUMPS = {
  hospitality: ['market'],
  redevelopment: ['title_ownership', 'physical_technical'],
  raw_land: ['approvals_regulatory', 'market'],
};

export const STRUCTURE_SIGNAL_HINTS = {
  outright: ['land_cost_share_of_gdv', 'price_vs_comp_band'],
  jv: ['capital_call_concentration', 'spv_governance_clarity'],
  jda: [
    'jda_mortgage_permission_present',
    'landowner_share_band',
    'jda_milestone_obligation_clarity',
  ],
  revenue_share: ['absorption_realism', 'escrow_waterfall_present'],
  area_share: ['area_allocation_clarity', 'partition_mechanics_clarity'],
  profit_share: ['audit_rights_clarity', 'cost_overrun_protection'],
  ground_lease: [
    'lrd_eligibility_via_mortgage_permission',
    'ground_rent_escalation_schedule',
    'wale_band_for_lrd',
  ],
  hybrid: ['hybrid_master_agreement_scope_clarity'],
};

const pairKey = (assetClass, dealStructure) => `${assetClass}:${dealStructure}`;

export const isValidPair = (assetClass, dealStructure) => {
  if (!assetClass || !dealStructure) return { valid: true };
  const reason = INVALID_PAIRS[pairKey(assetClass, dealStructure)];
  if (reason) return { valid: false, reason };
  return { valid: true };
};

export const getAdditionalApprovals = (assetClass, dealStructure) => {
  const out = [];
  const assetOverlay = ASSET_CLASS_STRUCTURE_OVERLAYS[assetClass];
  if (assetOverlay && assetOverlay._always) {
    out.push(...assetOverlay._always);
  }
  if (dealStructure && STRUCTURE_APPROVALS[dealStructure]) {
    out.push(...STRUCTURE_APPROVALS[dealStructure]);
  }
  return out;
};

export const getRequiredDoctypes = (assetClass, dealStructure) => {
  if (!dealStructure) return [];
  return STRUCTURE_REQUIRED_DOCTYPES[dealStructure] || [];
};

export const getRiskPreset = (assetClass, dealStructure) => {
  const structurePreset =
    (dealStructure && STRUCTURE_RISK_PRESETS[dealStructure]) ||
    { elevated: [], notes: null };
  const assetBumps = ASSET_CLASS_RISK_BUMPS[assetClass] || [];
  const elevated = Array.from(new Set([...structurePreset.elevated, ...assetBumps]));
  return { elevated, notes: structurePreset.notes };
};

export const getSignalHints = (assetClass, dealStructure) => {
  if (!dealStructure) return [];
  return STRUCTURE_SIGNAL_HINTS[dealStructure] || [];
};

export const getPairBehavior = (assetClass, dealStructure) => ({
  valid: isValidPair(assetClass, dealStructure),
  additionalApprovals: getAdditionalApprovals(assetClass, dealStructure),
  requiredDoctypes: getRequiredDoctypes(assetClass, dealStructure),
  riskPreset: getRiskPreset(assetClass, dealStructure),
  signalHints: getSignalHints(assetClass, dealStructure),
});
