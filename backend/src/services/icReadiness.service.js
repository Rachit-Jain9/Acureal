'use strict';

/**
 * IC Readiness Pack — Phase 3 / Pillar 5.
 *
 * Companion to the K-RERA Readiness Pack (Pillar 4):
 *
 *   • K-RERA Readiness  → filing readiness (Karnataka RERA project registration)
 *   • IC Readiness      → Investment Committee handoff readiness
 *
 * For every deal — regardless of asset class — composes a 7-bucket
 * inventory of what an IC reviewer needs to see:
 *
 *   1. Financial Underwriting  — kernel ran, IRR/DSCR present, scenarios + sensitivity stressed
 *   2. Title & Legal           — title deed, EC, mutation/Khata, conversion, JDA/PoA if applicable
 *   3. Statutory Approvals     — required approvals available + K-RERA pack score ≥ 50% (residential)
 *   4. Market & Comps          — micro-market briefing, comp count, Best Use top score
 *   5. Promoter & Execution    — track record recorded, K-RERA linkage, on-time delivery
 *   6. Risk & Diagnosis        — Risk Radar posture, Deal Doctor critical findings, DD score
 *   7. Document Hygiene        — required document categories present
 *
 * Pure compute over **already-loaded workspace slices** — no extra DB
 * round-trips. The composer takes a single `ctx` object and runs each
 * item's `detect()` against it. Same five-tier evidence model + completeness
 * scoring as Pillar 4 (verified 1.0 > uploaded 0.75 > available 0.5 >
 * pending 0.25 > missing 0).
 *
 * **CLAUDE.md hard rule respected**: never asserts "IC will approve" or
 * "the deal is investment-grade". Only "X of Y IC-readiness items have
 * verified evidence". The IC decision rests with the human committee;
 * this is an organisation aid for the deal team's pre-IC prep.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Evidence-status model — 5-tier weighted scoring (same as Pillar 4)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_WEIGHT = Object.freeze({
  verified: 1.0,
  uploaded: 0.75,
  available: 0.5,
  pending:  0.25,
  missing:  0.0,
});

const STATUS_LABEL = Object.freeze({
  verified:  'Verified',
  uploaded:  'Uploaded',
  available: 'Available',
  pending:   'Pending',
  missing:   'Missing',
});

// Asset classes that need K-RERA project registration — used to gate the
// K-RERA-related items.
const RERA_APPLICABLE_CLASSES = new Set([
  'residential_apartments',
  'plotted_development',
  'villas',
  'mixed_use',
  'redevelopment',
]);

// ─────────────────────────────────────────────────────────────────────────────
//  Pure helpers used by detect functions
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const docCountByPattern = (documents, patterns) => {
  if (!Array.isArray(documents) || documents.length === 0) return 0;
  return documents.filter((d) =>
    patterns.some((re) => re.test(d.name || d.file_name || d.original_name || ''))
  ).length;
};

const approvalsByType = (approvals, typesOrNames) => {
  if (!Array.isArray(approvals)) return [];
  return approvals.filter((a) =>
    typesOrNames.some(
      (m) =>
        m instanceof RegExp
          ? m.test(a.name || '')
          : String(a.approval_type || '').toLowerCase() === String(m).toLowerCase(),
    ),
  );
};

const approvalTier = (approval) => {
  if (!approval) return 'missing';
  if (approval.is_validated) return 'verified';
  if (approval.is_uploaded) return 'uploaded';
  if (approval.is_available) return 'available';
  return 'pending';
};

// Combine multiple status tiers into the best (highest) one.
const bestTier = (tiers) => {
  if (!tiers || tiers.length === 0) return 'missing';
  const order = ['missing', 'pending', 'available', 'uploaded', 'verified'];
  return tiers.reduce((best, t) => {
    return order.indexOf(t) > order.indexOf(best) ? t : best;
  }, 'missing');
};

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket: Financial Underwriting (weight 22)
//
//  An IC reviewer needs the kernel to have run + KPIs visible + the deal
//  team to have stressed scenarios + sensitivity. Land + construction cost
//  must be broken out (single "totalCr" is opaque for IC).
// ─────────────────────────────────────────────────────────────────────────────

const FINANCIAL_ITEMS = [
  {
    id: 'kernel_ran',
    label: 'Financial kernel computed',
    description: 'Kernel ran end-to-end on this deal\'s inputs.',
    weight: 5,
    detect: ({ financial }) => {
      const summary = financial?.summary;
      if (!summary) return { status: 'missing', evidence_label: 'No financial run on file' };
      const mp = summary.model_params || {};
      const hasCosts = mp.costs && num(mp.costs.totalCr) > 0;
      const hasRevenue = mp.revenue && num(mp.revenue.totalRevenueCr) > 0;
      if (hasCosts && hasRevenue) {
        return { status: 'verified', evidence_label: 'Kernel costs + revenue present', source: 'kernel' };
      }
      if (hasCosts || hasRevenue) {
        return { status: 'uploaded', evidence_label: 'Partial kernel output', source: 'kernel' };
      }
      return { status: 'missing', evidence_label: 'No kernel output' };
    },
    recommended_action: 'Run the financial model on the Financial tab. The Save button persists the full kernel output.',
  },
  {
    id: 'irr_present',
    label: 'IRR computed',
    description: 'Headline IRR from the kernel for the base case.',
    weight: 4,
    detect: ({ financial }) => {
      const irr = num(financial?.summary?.irr_pct) ?? num(financial?.summary?.model_params?.kpis?.irr);
      if (irr == null) return { status: 'missing', evidence_label: 'IRR not computed' };
      return {
        status: 'verified',
        source: 'kernel',
        evidence_label: `IRR ${irr.toFixed(2)}%`,
      };
    },
    recommended_action: 'Recompute the financial model — the kernel emits IRR by default once all inputs are filled.',
  },
  {
    id: 'dscr_present',
    label: 'DSCR computed',
    description: 'Stabilised debt-service coverage ratio (kernel-computed).',
    weight: 4,
    detect: ({ financial }) => {
      const kpis = financial?.summary?.model_params?.kpis || {};
      const dscr = num(kpis.dscr) ?? num(kpis.extras?.dscr);
      if (dscr == null) return { status: 'missing', evidence_label: 'DSCR not computed' };
      return {
        status: 'verified',
        source: 'kernel',
        evidence_label: `DSCR ${dscr.toFixed(2)}×`,
      };
    },
    recommended_action: 'Set the debt assumptions on the Financial tab (debt %, rate, tenor) — DSCR computes from those.',
  },
  {
    id: 'scenarios_run',
    label: 'Scenarios stressed (base / bull / bear)',
    description: 'Operator has run all three scenario multiplier sets.',
    weight: 3,
    detect: ({ financial }) => {
      const scenarios = financial?.scenarios;
      if (!scenarios) return { status: 'missing', evidence_label: 'No scenarios on file' };
      const keys = ['base', 'bull', 'bear'];
      const have = keys.filter((k) => scenarios[k] && (num(scenarios[k].irr_pct) != null || num(scenarios[k].kpis?.irr) != null));
      if (have.length === 3) return { status: 'verified', source: 'scenarios', evidence_label: '3 of 3 scenarios run' };
      if (have.length > 0) return { status: 'uploaded', source: 'scenarios', evidence_label: `${have.length} of 3 scenarios run` };
      return { status: 'missing', evidence_label: 'Scenarios not run' };
    },
    recommended_action: 'Open the Financial tab and click Save — the kernel runs all three scenarios on save.',
  },
  {
    id: 'sensitivity_run',
    label: 'Sensitivity (tornado) stressed',
    description: 'Tornado run over the critical input variables.',
    weight: 3,
    detect: ({ financial }) => {
      const summary = financial?.summary;
      const mp = summary?.model_params || {};
      const sensitivity = mp.sensitivity || summary?.sensitivity;
      if (!sensitivity) return { status: 'missing', evidence_label: 'No sensitivity run' };
      return {
        status: 'verified',
        source: 'sensitivity',
        evidence_label: 'Tornado on file',
      };
    },
    recommended_action: 'On the Financial tab, run the Sensitivity tornado — at minimum, stress price, cost, and duration.',
  },
  {
    id: 'land_cost_isolated',
    label: 'Land cost broken out',
    description: 'Land cost separable from construction cost (IC scrutinises the land / construction split).',
    weight: 2,
    detect: ({ financial }) => {
      const land = num(financial?.summary?.model_params?.costs?.landCr) ?? num(financial?.summary?.land_cost_cr);
      if (land == null || land <= 0) return { status: 'missing', evidence_label: 'Land cost not isolated' };
      return {
        status: 'verified',
        source: 'kernel',
        evidence_label: `Land ₹${land.toFixed(2)} Cr`,
      };
    },
    recommended_action: 'Enter the land cost in Crore on the Financial tab — separate from total project cost.',
  },
  {
    id: 'construction_cost_isolated',
    label: 'Construction cost broken out',
    description: 'Construction cost per sqft + total construction Cr.',
    weight: 1,
    detect: ({ financial }) => {
      const cons = num(financial?.summary?.model_params?.costs?.constructionCr);
      const perSqft = num(financial?.summary?.construction_cost_per_sqft);
      if ((cons == null || cons <= 0) && (perSqft == null || perSqft <= 0)) {
        return { status: 'missing', evidence_label: 'Construction cost not isolated' };
      }
      return {
        status: 'verified',
        source: 'kernel',
        evidence_label: cons ? `Construction ₹${cons.toFixed(2)} Cr` : `₹${perSqft}/sf`,
      };
    },
    recommended_action: 'Enter the construction cost per sqft on the Financial tab — common Bengaluru bands: residential ₹3,500 / office ₹4,500.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket: Title & Legal (weight 18)
// ─────────────────────────────────────────────────────────────────────────────

const TITLE_ITEMS = [
  {
    id: 'title_deed',
    label: 'Title deed uploaded',
    description: 'Registered sale deed / grant establishing the promoter\'s title.',
    weight: 5,
    detect: ({ documents }) => {
      const n = docCountByPattern(documents, [
        /title.*deed/i, /sale.*deed/i, /gift.*deed/i, /\bgrant\b/i,
      ]);
      if (n > 0) return { status: 'uploaded', source: 'document', evidence_label: `${n} title-deed doc${n > 1 ? 's' : ''}` };
      return { status: 'missing' };
    },
    recommended_action: 'Upload the registered title deed (PDF) on the Documents tab.',
  },
  {
    id: 'encumbrance_certificate',
    label: 'Encumbrance Certificate (EC) on file',
    description: '30-year EC from sub-registrar showing no encumbrances.',
    weight: 5,
    detect: ({ documents }) => {
      const n = docCountByPattern(documents, [/encumbrance/i, /^ec[_\s]/i, /[_\s]ec\b/i]);
      if (n > 0) return { status: 'uploaded', source: 'document', evidence_label: `${n} EC doc${n > 1 ? 's' : ''}` };
      return { status: 'missing' };
    },
    recommended_action: 'Obtain a 30-year EC from the sub-registrar (Form 15) and upload to Documents.',
  },
  {
    id: 'khata_or_mutation',
    label: 'Khata Certificate or Mutation records',
    description: 'BBMP / BMRDA Khata in promoter\'s name or RTC / Pahani mutation extract.',
    weight: 4,
    detect: ({ approvals, documents }) => {
      const approvalMatches = approvalsByType(approvals, ['khata', /khata/i, /mutation/i]);
      if (approvalMatches.length > 0) {
        const tier = bestTier(approvalMatches.map(approvalTier));
        return { status: tier, source: 'approval', evidence_label: approvalMatches[0].name };
      }
      const n = docCountByPattern(documents, [/khata/i, /mutation/i, /\brtc\b/i, /pahani/i]);
      if (n > 0) return { status: 'uploaded', source: 'document', evidence_label: `${n} khata / mutation doc${n > 1 ? 's' : ''}` };
      return { status: 'missing' };
    },
    recommended_action: 'Apply for Khata transfer at BBMP/BMRDA or pull mutation extract (Form 11E) from the village accountant.',
  },
  {
    id: 'conversion_order',
    label: 'DC Conversion Order (if agricultural)',
    description: 'Required only when the parcel was agricultural; not a blocker otherwise.',
    weight: 2,
    detect: ({ approvals, documents }) => {
      const approvalMatches = approvalsByType(approvals, ['conversion', /dc.*conversion/i, /agricultural.*non.*agricultural/i]);
      if (approvalMatches.length > 0) {
        return { status: approvalTier(approvalMatches[0]), source: 'approval', evidence_label: approvalMatches[0].name };
      }
      const n = docCountByPattern(documents, [/dc.*conversion/i, /conversion.*order/i]);
      if (n > 0) return { status: 'uploaded', source: 'document', evidence_label: 'DC conversion document on file' };
      return { status: 'missing' };
    },
    recommended_action: 'If the parcel was agricultural, obtain the DC conversion order from the Deputy Commissioner. If freehold non-agricultural, this item is not applicable.',
  },
  {
    id: 'jda_or_poa_registered',
    label: 'JDA / PoA registered (if applicable)',
    description: 'Required for JDA / JV deal structures only.',
    weight: 2,
    detect: ({ deal, approvals, documents }) => {
      const ds = deal?.deal_structure || '';
      const isJDA = /jda|joint.*development/i.test(ds);
      const isJV = /^jv$/i.test(ds);
      if (!isJDA && !isJV) {
        return { status: 'verified', source: 'deal_structure', evidence_label: 'Not applicable for this structure' };
      }
      const approvalMatches = approvalsByType(approvals, [/jda/i, /\bpower.*of.*attorney\b/i, /\bpoa\b/i]);
      if (approvalMatches.length > 0) {
        return { status: approvalTier(approvalMatches[0]), source: 'approval', evidence_label: approvalMatches[0].name };
      }
      const n = docCountByPattern(documents, [/jda/i, /\bpoa\b/i, /power.*of.*attorney/i]);
      if (n > 0) return { status: 'uploaded', source: 'document', evidence_label: `${n} JDA / PoA doc${n > 1 ? 's' : ''}` };
      return { status: 'missing' };
    },
    recommended_action: 'For JDA / JV structures, the JDA + landowner PoA must be registered. Upload the registered copies to Documents.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket: Statutory Approvals (weight 15)
// ─────────────────────────────────────────────────────────────────────────────

const APPROVALS_ITEMS = [
  {
    id: 'required_approvals_baseline',
    label: 'Required approvals at least Available',
    description: 'Every approval flagged Required has at least the Available checkbox ticked.',
    weight: 5,
    detect: ({ approvals }) => {
      if (!Array.isArray(approvals) || approvals.length === 0) {
        return { status: 'missing', evidence_label: 'No approvals seeded' };
      }
      const required = approvals.filter((a) => a.is_required);
      if (required.length === 0) {
        return { status: 'verified', source: 'approval', evidence_label: 'No required approvals for this asset class' };
      }
      const availableCount = required.filter((a) => a.is_available || a.is_uploaded || a.is_validated).length;
      if (availableCount === required.length) {
        return { status: 'verified', source: 'approval', evidence_label: `${required.length} of ${required.length} required approvals Available+` };
      }
      if (availableCount >= required.length * 0.75) {
        return { status: 'uploaded', source: 'approval', evidence_label: `${availableCount} of ${required.length} required approvals Available+` };
      }
      if (availableCount > 0) {
        return { status: 'pending', source: 'approval', evidence_label: `${availableCount} of ${required.length} required approvals Available+` };
      }
      return { status: 'missing', evidence_label: `0 of ${required.length} required approvals Available+` };
    },
    recommended_action: 'On the DD & Approvals tab, walk through every required approval and mark each as at least Available once you have a path to it.',
  },
  {
    id: 'rera_readiness_threshold',
    label: 'K-RERA Readiness ≥ 50% (residential)',
    description: 'Only applicable for residential / plotted / villas / mixed-use / redevelopment.',
    weight: 5,
    detect: ({ deal, rera_readiness }) => {
      const ac = deal?.asset_class;
      if (!ac || !RERA_APPLICABLE_CLASSES.has(ac)) {
        return { status: 'verified', source: 'asset_class', evidence_label: 'K-RERA not applicable for this asset class' };
      }
      const pct = num(rera_readiness?.overall?.completeness_pct);
      if (pct == null) return { status: 'missing', evidence_label: 'K-RERA Readiness Pack not composed' };
      if (pct >= 75) return { status: 'verified', source: 'rera', evidence_label: `K-RERA Readiness ${pct}%` };
      if (pct >= 50) return { status: 'uploaded', source: 'rera', evidence_label: `K-RERA Readiness ${pct}%` };
      if (pct >= 25) return { status: 'pending', source: 'rera', evidence_label: `K-RERA Readiness ${pct}% — below IC threshold` };
      return { status: 'missing', evidence_label: `K-RERA Readiness ${pct}%` };
    },
    recommended_action: 'Open the K-RERA Readiness Pack on the DD tab and walk through the gaps. Bring readiness above 50% before IC.',
  },
  {
    id: 'fire_noc',
    label: 'Fire NOC (KFES)',
    description: 'Karnataka Fire & Emergency Services NOC for residential / commercial buildings.',
    weight: 2,
    detect: ({ approvals }) => {
      const matches = approvalsByType(approvals, ['fire_noc', /fire.*noc/i, /fire.*emergency/i]);
      if (matches.length === 0) return { status: 'missing' };
      return {
        status: approvalTier(matches[0]),
        source: 'approval',
        evidence_label: matches[0].name,
      };
    },
    recommended_action: 'Apply at Karnataka Fire & Emergency Services. Update the approval row when issued.',
  },
  {
    id: 'sanctioned_plan',
    label: 'Sanctioned building plan',
    description: 'BBMP / BDA / BMRDA / BMICAPA / Panchayat-sanctioned plan.',
    weight: 2,
    detect: ({ approvals }) => {
      const matches = approvalsByType(approvals, ['building_plan', /sanctioned.*plan/i, /building.*plan/i, /layout.*plan/i]);
      if (matches.length === 0) return { status: 'missing' };
      return {
        status: approvalTier(matches[0]),
        source: 'approval',
        evidence_label: matches[0].name,
      };
    },
    recommended_action: 'Submit the building plan to the planning authority. Update Approvals once sanctioned.',
  },
  {
    id: 'commencement_certificate',
    label: 'Building Commencement Certificate (BCC)',
    description: 'BCC issued by the planning authority after the sanctioned plan.',
    weight: 1,
    detect: ({ approvals }) => {
      const matches = approvalsByType(approvals, [/commencement.*certificate/i, /\bbcc\b/i]);
      if (matches.length === 0) return { status: 'missing' };
      return {
        status: approvalTier(matches[0]),
        source: 'approval',
        evidence_label: matches[0].name,
      };
    },
    recommended_action: 'Apply for BCC at the planning authority after the sanctioned plan + scrutiny fees.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket: Market & Comps (weight 12)
// ─────────────────────────────────────────────────────────────────────────────

const MARKET_ITEMS = [
  {
    id: 'micro_market_briefing',
    label: 'Micro-market briefing available',
    description: 'Parcel classified into one of 20 seeded Bengaluru micro-markets with benchmarks on file.',
    weight: 4,
    detect: ({ micro_market }) => {
      const locality = micro_market?.locality;
      if (!locality) return { status: 'missing', evidence_label: 'Parcel outside seeded markets or no coordinates' };
      const benchCount = (micro_market.benchmarks || []).length;
      if (benchCount >= 4) return { status: 'verified', source: 'micro_market', evidence_label: `${locality.name} · ${benchCount} benchmarks` };
      if (benchCount >= 1) return { status: 'uploaded', source: 'micro_market', evidence_label: `${locality.name} · ${benchCount} benchmark${benchCount > 1 ? 's' : ''}` };
      return { status: 'pending', source: 'micro_market', evidence_label: `${locality.name} (no benchmarks yet)` };
    },
    recommended_action: 'Set the parcel coordinates on the Parcel/Site tab. If outside seeded markets, manually enter benchmarks on Market Intelligence.',
  },
  {
    id: 'comps_validated',
    label: 'At least 3 verified comps',
    description: 'Comps within reasonable proximity / similarity to anchor the price band.',
    weight: 3,
    detect: ({ comps_count }) => {
      const n = Number(comps_count) || 0;
      if (n >= 5) return { status: 'verified', source: 'comps', evidence_label: `${n} verified comps on file` };
      if (n >= 3) return { status: 'uploaded', source: 'comps', evidence_label: `${n} verified comps` };
      if (n >= 1) return { status: 'pending', source: 'comps', evidence_label: `${n} comp on file — IC asks for ≥3` };
      return { status: 'missing', evidence_label: 'No verified comps' };
    },
    recommended_action: 'On the Market/Comps tab, add at least 3 verified comps within 5 km matching the deal\'s asset class.',
  },
  {
    id: 'best_use_score',
    label: 'Best Use Simulator: chosen asset class ranked',
    description: 'The deal\'s chosen asset class scored ≥50 in the Best Use Simulator for this micro-market.',
    weight: 3,
    detect: ({ deal, best_use }) => {
      const ac = deal?.asset_class;
      if (!ac) return { status: 'missing', evidence_label: 'No asset class set' };
      const scores = best_use?.scores || [];
      const entry = scores.find((s) => s.asset_class === ac);
      if (!entry) return { status: 'missing', evidence_label: 'Best Use Simulator empty or outside seeded markets' };
      if (entry.score >= 75) return { status: 'verified', source: 'best_use', evidence_label: `${entry.label} ${entry.score} / 100 (${entry.verdict})` };
      if (entry.score >= 55) return { status: 'uploaded', source: 'best_use', evidence_label: `${entry.label} ${entry.score} / 100 (${entry.verdict})` };
      if (entry.score >= 35) return { status: 'pending', source: 'best_use', evidence_label: `${entry.label} ${entry.score} / 100 — below IC threshold` };
      return { status: 'pending', source: 'best_use', evidence_label: `${entry.label} ${entry.score} / 100 — significantly below IC threshold` };
    },
    recommended_action: 'Check the Best Use Simulator on the Overview tab. If the chosen asset class scores low, IC will ask why this asset class for this parcel.',
  },
  {
    id: 'no_oversupply_flag',
    label: 'No oversupply red flag',
    description: 'Absorption pressure for the chosen asset class in this micro-market is below 1.15.',
    weight: 2,
    detect: ({ deal, micro_market }) => {
      const ac = deal?.asset_class;
      if (!ac || !micro_market?.benchmarks) return { status: 'pending', evidence_label: 'No micro-market data to check oversupply' };
      const absPressure = micro_market.benchmarks.find((b) => b.asset_class === ac && b.metric_kind === 'absorption_pressure');
      if (!absPressure) return { status: 'pending', evidence_label: 'No absorption-pressure benchmark for this asset class' };
      const pressure = num(absPressure.p50);
      if (pressure == null) return { status: 'pending', evidence_label: 'Absorption pressure not populated' };
      if (pressure <= 1.0) return { status: 'verified', source: 'micro_market', evidence_label: `Absorption pressure ${pressure} (favorable)` };
      if (pressure <= 1.15) return { status: 'uploaded', source: 'micro_market', evidence_label: `Absorption pressure ${pressure} (balanced)` };
      return { status: 'pending', source: 'micro_market', evidence_label: `Absorption pressure ${pressure} — oversupply risk` };
    },
    recommended_action: 'If absorption pressure is > 1.15, prepare the IC narrative on how the deal absorbs in an oversupplied market (pricing, positioning, phasing).',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket: Promoter & Execution (weight 12)
// ─────────────────────────────────────────────────────────────────────────────

const PROMOTER_ITEMS = [
  {
    id: 'promoter_recorded',
    label: 'Promoter track record recorded',
    description: 'The promoter / builder track record card is populated with verified findings.',
    weight: 4,
    detect: ({ promoter }) => {
      if (!promoter?.profile?.promoter_name) return { status: 'missing', evidence_label: 'Promoter not recorded' };
      return {
        status: 'uploaded',
        source: 'promoter_profile',
        evidence_label: promoter.profile.promoter_name,
      };
    },
    recommended_action: 'Open the Promoter & Execution card on the Risk tab and fill in the verified findings (entity type, projects delivered, RERA standing).',
  },
  {
    id: 'promoter_not_flagged',
    label: 'Promoter posture not flagged',
    description: 'Deterministic promoter assessment posture is cleared or unverified — not flagged.',
    weight: 4,
    detect: ({ promoter }) => {
      const posture = promoter?.assessment?.posture;
      if (!posture) return { status: 'missing', evidence_label: 'No posture computed' };
      if (posture === 'cleared') return { status: 'verified', source: 'promoter_profile', evidence_label: 'Posture: cleared' };
      if (posture === 'unverified') return { status: 'pending', source: 'promoter_profile', evidence_label: 'Posture: unverified (verify before IC)' };
      return { status: 'missing', source: 'promoter_profile', evidence_label: 'Posture: flagged' };
    },
    recommended_action: 'On the Promoter card, record delivery history + RERA standing. Flagged posture is an IC blocker — resolve before IC.',
  },
  {
    id: 'krera_linkage',
    label: 'K-RERA promoter linkage (if applicable)',
    description: 'Promoter cross-linked to a public K-RERA record (only meaningful when K-RERA tables are populated).',
    weight: 2,
    detect: ({ deal, promoter }) => {
      const ac = deal?.asset_class;
      if (!ac || !RERA_APPLICABLE_CLASSES.has(ac)) {
        return { status: 'verified', source: 'asset_class', evidence_label: 'K-RERA not applicable for this asset class' };
      }
      const linked = promoter?.rera?.linked?.promoter_name;
      const candidatesCount = (promoter?.rera?.candidates || []).length;
      if (linked) return { status: 'verified', source: 'krera', evidence_label: `Linked to ${linked}` };
      if (candidatesCount > 0) return { status: 'pending', source: 'krera', evidence_label: `${candidatesCount} K-RERA candidate${candidatesCount > 1 ? 's' : ''} not yet linked` };
      return { status: 'pending', source: 'krera', evidence_label: 'No K-RERA candidates (tables may be empty)' };
    },
    recommended_action: 'On the Promoter card, confirm one of the K-RERA candidates as the canonical match (or mark "manual entry").',
  },
  {
    id: 'on_time_delivery',
    label: 'On-time delivery rate ≥ 60%',
    description: 'Of completed projects, at least 60% delivered on or near the proposed date.',
    weight: 2,
    detect: ({ promoter }) => {
      const summary = promoter?.assessment?.summary;
      if (!summary || summary.delivered_total === 0 || summary.delivered_total == null) {
        return { status: 'missing', evidence_label: 'No delivery history recorded' };
      }
      const pct = num(summary.on_time_pct);
      if (pct == null) return { status: 'missing', evidence_label: 'On-time % not computed' };
      if (pct >= 80) return { status: 'verified', source: 'promoter_profile', evidence_label: `${pct}% of ${summary.delivered_total} on time` };
      if (pct >= 60) return { status: 'uploaded', source: 'promoter_profile', evidence_label: `${pct}% of ${summary.delivered_total} on time` };
      return { status: 'pending', source: 'promoter_profile', evidence_label: `${pct}% of ${summary.delivered_total} on time — below 60% IC threshold` };
    },
    recommended_action: 'On the Promoter card, accurately record the on-time / delayed split. IC asks for the delivery track record by name.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket: Risk & Diagnosis (weight 11)
// ─────────────────────────────────────────────────────────────────────────────

const RISK_ITEMS = [
  {
    id: 'risk_radar_posture',
    label: 'Risk Radar overall posture',
    description: 'Composite risk posture across all six failure modes.',
    weight: 3,
    detect: ({ risk }) => {
      // Two defects lived here. (1) The docstring promises a flat numeric
      // `risk.score`, but the real caller passes getRiskScore()'s OBJECT, so
      // `num()` returned null and the shape was never actually read. (2) With
      // no register at all, `flagged` computes 0 and that fell straight into
      // the `verified` branch — an untouched risk register scoring green.
      const raw = risk?.score;
      const score = num(raw) ?? num(raw?.score);
      const totalFlags = num(raw?.total);          // every row, incl. resolved
      const flagged = num(risk?.flagged_count)
        ?? num(raw?.open_count)
        ?? (Array.isArray(risk?.categories)
          ? risk.categories.filter((c) => c.posture === 'flagged').length
          : null);

      if (score == null || flagged == null) {
        return { status: 'missing', evidence_label: 'Risk Radar not computed' };
      }
      if (totalFlags === 0) {
        // ABSENCE IS NOT CLEARANCE. `missing` (weight 0) rather than a new
        // tier, so this routes into `gaps` as work still to do.
        return {
          status: 'missing',
          source: 'risk_radar',
          evidence_label: 'Risk register empty — no risk assessment recorded',
        };
      }
      if (flagged === 0) return { status: 'verified', source: 'risk_radar', evidence_label: `Risk score ${score} · no flagged categories` };
      if (flagged <= 2) return { status: 'uploaded', source: 'risk_radar', evidence_label: `Risk score ${score} · ${flagged} flagged categor${flagged === 1 ? 'y' : 'ies'}` };
      return { status: 'pending', source: 'risk_radar', evidence_label: `Risk score ${score} · ${flagged} flagged categories — heavy lift for IC` };
    },
    recommended_action: 'Open the Risk tab. Resolve flagged categories one by one — IC will ask about each one.',
  },
  {
    id: 'deal_doctor_critical',
    label: 'No critical Deal Doctor findings',
    description: 'Diagnostic findings rated Critical / Inconsistent / Below benchmark by severity.',
    weight: 3,
    detect: ({ deal_doctor }) => {
      // "No findings" is only good news if the engine had something to look at.
      // With zero signals it has diagnosed nothing, which is not a clean bill.
      if (!deal_doctor || !num(deal_doctor.signal_count)) {
        return { status: 'missing', evidence_label: 'Deal Doctor has no signals to diagnose yet' };
      }
      const findings = deal_doctor?.findings || [];
      if (findings.length === 0) {
        return { status: 'verified', source: 'deal_doctor', evidence_label: 'No findings' };
      }
      const critical = findings.filter((f) => f.severity === 5 || f.severity === 'critical').length;
      const high = findings.filter((f) => f.severity === 4 || f.severity === 'high').length;
      if (critical === 0 && high === 0) return { status: 'verified', source: 'deal_doctor', evidence_label: `${findings.length} finding${findings.length > 1 ? 's' : ''}, none critical` };
      if (critical === 0) return { status: 'uploaded', source: 'deal_doctor', evidence_label: `${findings.length} finding${findings.length > 1 ? 's' : ''}, ${high} high (no critical)` };
      return { status: 'pending', source: 'deal_doctor', evidence_label: `${critical} critical finding${critical > 1 ? 's' : ''}` };
    },
    recommended_action: 'Open the Deal Doctor on the Risk tab. Resolve critical findings before IC — IC sees this list directly.',
  },
  {
    id: 'cross_doc_inconsistencies',
    label: 'Cross-document inconsistencies resolved',
    description: 'No open cross-document inconsistency findings on the Deal Doctor.',
    weight: 2,
    detect: ({ deal_doctor }) => {
      // Cross-document consistency cannot be "resolved" before any documents
      // have been cross-checked. Same absence-vs-clearance distinction.
      if (!deal_doctor || !num(deal_doctor.signal_count)) {
        return { status: 'missing', evidence_label: 'No documents cross-checked yet' };
      }
      const findings = deal_doctor?.findings || [];
      const inconsistencies = findings.filter((f) =>
        /cross.*document.*inconsisten/i.test(f.label || '') ||
        f.rule_id === 'cross-document-inconsistencies'
      );
      if (inconsistencies.length === 0) {
        return { status: 'verified', source: 'deal_doctor', evidence_label: 'No open inconsistencies' };
      }
      return { status: 'pending', source: 'deal_doctor', evidence_label: `${inconsistencies.length} open inconsistenc${inconsistencies.length === 1 ? 'y' : 'ies'}` };
    },
    recommended_action: 'Open the inconsistency finding on the Deal Doctor. Resolve each one — IC will trip on document-vs-document mismatches.',
  },
  {
    id: 'dd_score',
    label: 'DD score ≥ 60%',
    description: 'At least 60% of required DD items completed.',
    weight: 3,
    detect: ({ dd }) => {
      const score = num(dd?.score?.score);
      if (score == null) return { status: 'missing', evidence_label: 'DD score not computed' };
      if (score >= 80) return { status: 'verified', source: 'dd', evidence_label: `DD ${score}% complete` };
      if (score >= 60) return { status: 'uploaded', source: 'dd', evidence_label: `DD ${score}% complete` };
      if (score >= 30) return { status: 'pending', source: 'dd', evidence_label: `DD ${score}% complete — below IC threshold` };
      return { status: 'missing', source: 'dd', evidence_label: `DD ${score}% — early stage` };
    },
    recommended_action: 'On the DD tab, work through the required DD items. IC asks for ≥ 60% completion + zero open deal-breakers.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket: Document Hygiene (weight 10)
// ─────────────────────────────────────────────────────────────────────────────

const HYGIENE_ITEMS = [
  {
    id: 'title_docs_present',
    label: 'Title documents present',
    description: 'Title deed + EC + Khata / mutation uploaded under documents.',
    weight: 3,
    detect: ({ documents }) => {
      const n = docCountByPattern(documents, [
        /title.*deed/i, /sale.*deed/i, /encumbrance/i, /khata/i, /mutation/i,
      ]);
      if (n >= 3) return { status: 'verified', source: 'documents', evidence_label: `${n} title-related documents` };
      if (n >= 1) return { status: 'uploaded', source: 'documents', evidence_label: `${n} title document${n > 1 ? 's' : ''}` };
      return { status: 'missing', evidence_label: 'No title documents uploaded' };
    },
    recommended_action: 'Upload all available title-chain documents on the Documents tab — title deed, EC, Khata, mutation extract.',
  },
  {
    id: 'plan_approval_docs',
    label: 'Plan + approval documents',
    description: 'Sanctioned plan, fire NOC, CC, BWSSB / BESCOM NOCs.',
    weight: 3,
    detect: ({ documents }) => {
      const n = docCountByPattern(documents, [
        /sanctioned.*plan/i, /building.*plan/i, /commencement/i,
        /fire.*noc/i, /bwssb/i, /bescom/i,
      ]);
      if (n >= 3) return { status: 'verified', source: 'documents', evidence_label: `${n} plan / NOC docs` };
      if (n >= 1) return { status: 'uploaded', source: 'documents', evidence_label: `${n} plan / NOC doc${n > 1 ? 's' : ''}` };
      return { status: 'missing' };
    },
    recommended_action: 'Upload the sanctioned plan + every available NOC on the Documents tab.',
  },
  {
    id: 'financial_docs',
    label: 'Financial documents',
    description: 'Bank statements / MOU / term sheet / LOI / financial projections.',
    weight: 2,
    detect: ({ documents }) => {
      const n = docCountByPattern(documents, [
        /\bmou\b/i, /term.*sheet/i, /\bloi\b/i, /letter.*of.*intent/i,
        /bank.*statement/i, /projection/i, /\bagreement\b/i,
      ]);
      if (n >= 2) return { status: 'verified', source: 'documents', evidence_label: `${n} financial-flow docs` };
      if (n >= 1) return { status: 'uploaded', source: 'documents', evidence_label: `${n} financial doc${n > 1 ? 's' : ''}` };
      return { status: 'missing' };
    },
    recommended_action: 'Upload the LOI / MOU / term sheet + recent bank statements that support the financial model.',
  },
  {
    id: 'promoter_identity_docs',
    label: 'Promoter identity (PAN / GST)',
    description: 'Promoter\'s PAN, GST registration, authorized signatory PAN.',
    weight: 2,
    detect: ({ documents }) => {
      const n = docCountByPattern(documents, [
        /\bpan\b/i, /\bgst\b/i, /\bgstin\b/i, /authorized.*signatory/i, /board.*resolution/i,
      ]);
      if (n >= 2) return { status: 'verified', source: 'documents', evidence_label: `${n} identity docs` };
      if (n >= 1) return { status: 'uploaded', source: 'documents', evidence_label: `${n} identity doc${n > 1 ? 's' : ''}` };
      return { status: 'missing' };
    },
    recommended_action: 'Upload the promoter\'s PAN + GST + authorized signatory PAN — required for IC + RERA filing.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Bucket assembly
// ─────────────────────────────────────────────────────────────────────────────

const BUCKETS = [
  {
    id: 'financial_underwriting',
    label: 'Financial Underwriting',
    description: 'Kernel ran, KPIs visible, scenarios + sensitivity stressed.',
    items: FINANCIAL_ITEMS,
  },
  {
    id: 'title_legal',
    label: 'Title & Legal',
    description: 'Title chain, encumbrance, mutation, conversion, structural deeds.',
    items: TITLE_ITEMS,
  },
  {
    id: 'statutory_approvals',
    label: 'Statutory Approvals',
    description: 'Required approvals available + K-RERA threshold (residential).',
    items: APPROVALS_ITEMS,
  },
  {
    id: 'market_comps',
    label: 'Market & Comps',
    description: 'Micro-market briefing, comp count, Best Use score.',
    items: MARKET_ITEMS,
  },
  {
    id: 'promoter_execution',
    label: 'Promoter & Execution',
    description: 'Track record recorded + on-time delivery + K-RERA linkage.',
    items: PROMOTER_ITEMS,
  },
  {
    id: 'risk_diagnosis',
    label: 'Risk & Diagnosis',
    description: 'Risk Radar posture, Deal Doctor critical findings, DD completion.',
    items: RISK_ITEMS,
  },
  {
    id: 'document_hygiene',
    label: 'Document Hygiene',
    description: 'Required document categories uploaded to the Documents tab.',
    items: HYGIENE_ITEMS,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Composer
// ─────────────────────────────────────────────────────────────────────────────

const computeBucketSummary = (bucketItems) => {
  let totalWeight = 0;
  let scoredWeight = 0;
  const byStatus = { verified: 0, uploaded: 0, available: 0, pending: 0, missing: 0 };

  for (const it of bucketItems) {
    totalWeight += it.weight;
    scoredWeight += it.weight * STATUS_WEIGHT[it.evidence.status];
    byStatus[it.evidence.status] = (byStatus[it.evidence.status] || 0) + 1;
  }

  const pct = totalWeight > 0 ? Math.round((scoredWeight / totalWeight) * 100) : 0;
  let bucketStatus;
  if (pct >= 75) bucketStatus = 'complete';
  else if (pct >= 35) bucketStatus = 'partial';
  else bucketStatus = 'missing';

  return {
    completeness_pct: pct,
    bucket_status: bucketStatus,
    by_status: byStatus,
    total_items: bucketItems.length,
  };
};

/**
 * Public API — compose the full IC readiness pack.
 *
 * Args (a single ctx object):
 *   - deal              — { id, name, asset_class, deal_structure, ... }
 *   - financial         — { summary, scenarios } (workspace.financial)
 *   - documents         — array of document rows (flat, not by-category)
 *   - approvals         — array of approval_item rows
 *   - micro_market      — { locality, benchmarks, demand_signals } (workspace.micro_market)
 *   - best_use          — { scores } (workspace.best_use)
 *   - rera_readiness    — workspace.karnataka_rera_readiness
 *   - dd                — { items, score } (workspace.dd)
 *   - risk              — { score, flagged_count, categories } (workspace.riskScore)
 *   - deal_doctor       — { findings, groups } (workspace.deal_doctor)
 *   - promoter          — { profile, assessment, rera } (workspace.promoter or fetched)
 *   - comps_count       — integer (count of verified comps; caller provides)
 *
 * Returns:
 *   {
 *     applicable, asset_class, deal_name, overall, buckets, gaps, disclaimer
 *   }
 *
 * Always applicable (every deal needs IC readiness regardless of asset class).
 */
const composeReadiness = (ctx = {}) => {
  const dealName = ctx.deal?.name || null;
  const assetClass = ctx.deal?.asset_class || null;

  // Run every item's detect against the ctx
  const buckets = BUCKETS.map((bucket) => {
    const items = bucket.items.map((item) => {
      let evidence;
      try {
        evidence = item.detect(ctx);
      } catch {
        evidence = { status: 'missing', evidence_label: 'detect failed' };
      }
      // Normalise the evidence shape
      if (!evidence || !evidence.status) evidence = { status: 'missing' };
      return {
        id: item.id,
        label: item.label,
        description: item.description,
        weight: item.weight,
        evidence,
        status_label: STATUS_LABEL[evidence.status],
        recommended_action:
          evidence.status === 'missing' || evidence.status === 'pending' ? item.recommended_action : null,
      };
    });
    const summary = computeBucketSummary(items);
    return { id: bucket.id, label: bucket.label, description: bucket.description, items, ...summary };
  });

  // Roll up overall score
  let totalWeight = 0;
  let scoredWeight = 0;
  const byStatus = { verified: 0, uploaded: 0, available: 0, pending: 0, missing: 0 };
  for (const b of buckets) {
    for (const it of b.items) {
      totalWeight += it.weight;
      scoredWeight += it.weight * STATUS_WEIGHT[it.evidence.status];
      byStatus[it.evidence.status] += 1;
    }
  }
  const overallPct = totalWeight > 0 ? Math.round((scoredWeight / totalWeight) * 100) : 0;

  let readinessTier;
  if (overallPct >= 75) readinessTier = 'ic_ready';
  else if (overallPct >= 55) readinessTier = 'pre_ic';
  else if (overallPct >= 35) readinessTier = 'diligence';
  else readinessTier = 'early';

  // Gaps: missing + pending sorted by weight desc
  const gaps = [];
  for (const b of buckets) {
    for (const it of b.items) {
      if (it.evidence.status === 'missing' || it.evidence.status === 'pending') {
        gaps.push({
          bucket_id: b.id,
          bucket_label: b.label,
          item_id: it.id,
          item_label: it.label,
          weight: it.weight,
          status: it.evidence.status,
          recommended_action: it.recommended_action,
          severity: it.weight >= 5 ? 'critical' : it.weight >= 4 ? 'high' : it.weight >= 3 ? 'medium' : 'low',
        });
      }
    }
  }
  gaps.sort((a, b) => b.weight - a.weight);

  return {
    applicable: true, // Every deal has IC readiness — no asset-class gate
    asset_class: assetClass,
    deal_name: dealName,
    overall: {
      completeness_pct: overallPct,
      readiness_tier: readinessTier,
      by_status: byStatus,
      total_items: buckets.reduce((sum, b) => sum + b.items.length, 0),
      total_weight: totalWeight,
    },
    buckets,
    gaps,
    disclaimer:
      'This is an organisation aid for the deal team\'s pre-IC preparation. ' +
      'It does NOT represent an Investment Committee approval — only an inventory ' +
      'of the items an IC reviewer typically expects. The investment decision rests ' +
      'with the IC; this surface is for the deal team\'s readiness check.',
  };
};

module.exports = {
  composeReadiness,
  STATUS_WEIGHT,
  STATUS_LABEL,
  BUCKETS,
  RERA_APPLICABLE_CLASSES,
  // Sub-helpers exported for tests
  computeBucketSummary,
  docCountByPattern,
  approvalsByType,
  approvalTier,
  bestTier,
};
