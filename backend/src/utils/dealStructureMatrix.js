'use strict';

/**
 * (asset_class, deal_structure) behavior matrix — REDIP Pending review §5.1.
 *
 * The deal page used to be "static labels". Picking `residential_apartments + jda`
 * looked the same as `residential_apartments + outright`: same form, same
 * checklist, same approvals, same radar. The headline gap from the external
 * review.
 *
 * This module is the **service-layer routing matrix**. The kernel keeps its
 * single dimension (asset_class — that's where the financial math lives); the
 * matrix wraps the kernel with structure-aware behavior at every other surface:
 *
 *   • approvals.service.seedForDeal → base asset-class approvals + matrix add-ons
 *   • riskRadar.service              → matrix preset bumps initial postures
 *   • recommendation/signalExtractors → matrix flags signal kinds as relevant
 *   • deal-create form               → matrix `isValidPair` blocks the four
 *                                       structurally incoherent combinations
 *
 * Pure data + lookup. No DB calls, no AI. Identical to
 * `frontend/src/utils/dealStructureMatrix.js`; the parity test enforces lockstep.
 *
 * Permissive by default — block only what is structurally meaningless. The four
 * blocked combinations (see `INVALID_PAIRS`) are blocked because the deal
 * literally cannot work:
 *
 *   • hospitality + area_share        → hotel keys can't be sliced by area
 *                                       between landowner & developer
 *   • plotted_development + ground_lease → plots are sold to end buyers; the
 *                                          freehold is transferred, so a
 *                                          ground lease arrangement is upside
 *                                          down
 *   • villas + ground_lease           → same; villas are sold freehold
 *   • redevelopment + ground_lease    → existing owners can't be ground-leased
 *                                       on land they already own
 *
 * Everything else is allowed — including the genuinely uncommon combinations
 * (e.g. `hospitality + jda`, `plotted_development + jda`) — the matrix
 * surfaces them with `notes`, and the operator's judgement decides whether
 * to proceed.
 */

const ASSET_CLASSES = [
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

// Structurally incoherent pairs. Block at deal-create time with a precise reason.
const INVALID_PAIRS = {
  'hospitality:area_share':
    'Hotel keys cannot be sliced by area between landowner and developer. Consider revenue_share or profit_share instead.',
  'plotted_development:ground_lease':
    'Plots are sold freehold to end buyers — a ground lease arrangement is upside-down here. Consider outright or jda.',
  'villas:ground_lease':
    'Villas are sold freehold to end buyers — a ground lease arrangement is upside-down. Consider outright or jda.',
  'redevelopment:ground_lease':
    'Redevelopment cannot run on a ground lease — existing owners hold the freehold and would be ground-leasing land they already own. Consider jda or area_share with corpus.',
};

// ──────────────────────────────────────────────────────────────────────────────
// Structure-specific approval add-ons. These are added on top of the base
// asset-class approvals already seeded by `approvals.service.seedForDeal`.
// is_required is the conservative default — operator can lift if not relevant.
// ──────────────────────────────────────────────────────────────────────────────

const STRUCTURE_APPROVALS = {
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

// Asset-class-specific overlays. Some asset classes have additional structure
// considerations on top of the structure-default add-ons — e.g. redevelopment
// always needs society / owner consent regardless of structure.
const ASSET_CLASS_STRUCTURE_OVERLAYS = {
  redevelopment: {
    // Karnataka norm: >=66% existing-owner consent for redevelopment.
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

// ──────────────────────────────────────────────────────────────────────────────
// Required document doctypes per structure. The DD checklist + document
// requirements expand based on these.
// ──────────────────────────────────────────────────────────────────────────────

const STRUCTURE_REQUIRED_DOCTYPES = {
  outright: [],
  jv: ['jv_agreement', 'spv_incorporation_certificate', 'board_resolution'],
  jda: ['jda_draft', 'jda_signed', 'landowner_power_of_attorney'],
  revenue_share: ['revenue_share_agreement', 'escrow_account_letter'],
  area_share: ['area_share_deed', 'partition_deed_draft'],
  profit_share: ['profit_share_agreement'],
  ground_lease: ['ground_lease_deed', 'mortgage_permission_letter'],
  hybrid: ['master_agreement'],
};

// ──────────────────────────────────────────────────────────────────────────────
// Risk-radar presets per structure. These are *initial* posture bumps applied
// when the deal has no flags / DD items / approvals yet, so the radar shows
// the structurally-elevated failure modes from day one instead of starting at
// "all unverified". As real DD evidence accrues the deterministic radar
// signals take over — these presets only colour the empty state.
//
// Values are the failure-mode keys from `riskRadar.service` RADAR_CATEGORIES.
// ──────────────────────────────────────────────────────────────────────────────

const STRUCTURE_RISK_PRESETS = {
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

// Asset-class-specific risk bumps that apply regardless of structure.
const ASSET_CLASS_RISK_BUMPS = {
  hospitality: ['market'], // operator-dependent revenue, RevPAR cyclicality
  redevelopment: ['title_ownership', 'physical_technical'], // existing-owner consent + demolition
  raw_land: ['approvals_regulatory', 'market'], // long approval path; speculative exit
};

// ──────────────────────────────────────────────────────────────────────────────
// Signal hints — for the Recommendation Engine. Names match the signal kinds
// emitted by `signalExtractors.js`. This is a forward-compatibility hook —
// extractors check the deal's (class, structure) against this list to decide
// which signals to emit (vs noise-suppress for irrelevant pairs).
// ──────────────────────────────────────────────────────────────────────────────

const STRUCTURE_SIGNAL_HINTS = {
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

// ──────────────────────────────────────────────────────────────────────────────
// Public lookups
// ──────────────────────────────────────────────────────────────────────────────

const pairKey = (assetClass, dealStructure) => `${assetClass}:${dealStructure}`;

/**
 * Is the (assetClass, dealStructure) combination structurally meaningful?
 * Returns { valid: true } or { valid: false, reason: string }.
 *
 * Unknown asset classes or deal structures pass validity (the validator at the
 * API boundary catches those separately — we only block the four genuinely
 * incoherent combinations).
 */
const isValidPair = (assetClass, dealStructure) => {
  if (!assetClass || !dealStructure) return { valid: true };
  const reason = INVALID_PAIRS[pairKey(assetClass, dealStructure)];
  if (reason) return { valid: false, reason };
  return { valid: true };
};

/**
 * Approval add-ons for the (assetClass, dealStructure) pair. Returns an array
 * of `{ approval_type, name, is_required }` templates that the seed function
 * should add on top of the base asset-class approvals.
 */
const getAdditionalApprovals = (assetClass, dealStructure) => {
  const out = [];
  // Asset-class overlays that always apply.
  const assetOverlay = ASSET_CLASS_STRUCTURE_OVERLAYS[assetClass];
  if (assetOverlay && assetOverlay._always) {
    out.push(...assetOverlay._always);
  }
  // Structure-specific add-ons.
  if (dealStructure && STRUCTURE_APPROVALS[dealStructure]) {
    out.push(...STRUCTURE_APPROVALS[dealStructure]);
  }
  return out;
};

/**
 * Required document doctypes for the (assetClass, dealStructure) pair. Used by
 * the document-checklist surface to expand the required-doctypes list.
 */
const getRequiredDoctypes = (assetClass, dealStructure) => {
  if (!dealStructure) return [];
  return STRUCTURE_REQUIRED_DOCTYPES[dealStructure] || [];
};

/**
 * Risk-radar preset for the (assetClass, dealStructure) pair. Returns the
 * elevated failure-mode keys + a one-line note. Used by `riskRadar.service`
 * to colour the empty-state posture.
 */
const getRiskPreset = (assetClass, dealStructure) => {
  const structurePreset =
    (dealStructure && STRUCTURE_RISK_PRESETS[dealStructure]) ||
    { elevated: [], notes: null };
  const assetBumps = ASSET_CLASS_RISK_BUMPS[assetClass] || [];
  // Union, deduped.
  const elevated = Array.from(new Set([...structurePreset.elevated, ...assetBumps]));
  return { elevated, notes: structurePreset.notes };
};

/**
 * Signal hints for the (assetClass, dealStructure) pair. Used by the
 * Recommendation Engine signal extractors to decide which signals to emit
 * (vs noise-suppress for irrelevant pairs).
 */
const getSignalHints = (assetClass, dealStructure) => {
  if (!dealStructure) return [];
  return STRUCTURE_SIGNAL_HINTS[dealStructure] || [];
};

/**
 * Full per-pair behavior bundle — convenience wrapper for the workspace
 * read-model. Returns null inputs as `{}` so callers don't have to null-check.
 */
const getPairBehavior = (assetClass, dealStructure) => ({
  valid: isValidPair(assetClass, dealStructure),
  additionalApprovals: getAdditionalApprovals(assetClass, dealStructure),
  requiredDoctypes: getRequiredDoctypes(assetClass, dealStructure),
  riskPreset: getRiskPreset(assetClass, dealStructure),
  signalHints: getSignalHints(assetClass, dealStructure),
});

module.exports = {
  ASSET_CLASSES,
  DEAL_STRUCTURES,
  INVALID_PAIRS,
  STRUCTURE_APPROVALS,
  STRUCTURE_REQUIRED_DOCTYPES,
  STRUCTURE_RISK_PRESETS,
  STRUCTURE_SIGNAL_HINTS,
  ASSET_CLASS_STRUCTURE_OVERLAYS,
  ASSET_CLASS_RISK_BUMPS,
  isValidPair,
  getAdditionalApprovals,
  getRequiredDoctypes,
  getRiskPreset,
  getSignalHints,
  getPairBehavior,
};
