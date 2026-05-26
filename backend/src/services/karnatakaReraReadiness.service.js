'use strict';

/**
 * Karnataka RERA Readiness Pack — Phase 3 / Pillar 4.
 *
 * For a residential / plotted / mixed-use deal where Karnataka RERA
 * registration is required (per K-RERA Act 2016 + Rules 2017), composes a
 * READINESS PACK — a structured map of what K-RERA requires, what the deal
 * already has, what's missing, and an overall completeness score.
 *
 * **Honest scope (CLAUDE.md hard rule)**: this is an *organisation aid*
 * for the operator's CA / architect / lawyer. It NEVER asserts:
 *   • "the deal is RERA-compliant"
 *   • "the registration will be approved"
 *   • "RERA Form-B is valid"
 * Only: "X of Y required items have verified evidence". The legal /
 * statutory determination stays with the human professional.
 *
 * Source-of-truth model:
 *   • Approvals  — existing `approval_items` rows (rera_karnataka, fire_noc,
 *                  bwssb, bescom, etc.). Highest-weight evidence; carries
 *                  is_validated + reference_number.
 *   • Documents  — existing `documents` rows. Lower-weight evidence;
 *                  presence-only unless a sibling approval is_validated.
 *   • Extracted fields — future hook: when extraction surfaces fields like
 *                  `promoter_pan`, `escrow_bank_account`, they fill in
 *                  the corresponding readiness items.
 *
 * Pure compute over already-loaded service slices. No DB writes; only one
 * DB read (the existing approval_items + documents the workspace already
 * loads — composed via the workspace endpoint, no duplicate queries).
 *
 * Empty states honest:
 *   • non-applicable asset class  → { applicable: false, reason: '...' }
 *   • no approvals / no documents → still returns the full bucket list with
 *                                    every item in `missing` state — the UI
 *                                    can render the checklist as a guide
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Applicability — which asset classes need K-RERA project registration
// ─────────────────────────────────────────────────────────────────────────────

const APPLICABLE_ASSET_CLASSES = new Set([
  'residential_apartments',
  'plotted_development',
  'villas',
  'mixed_use',
  'redevelopment',
]);

const NON_APPLICABLE_LABEL = {
  commercial_office:      'Commercial office projects are outside K-RERA project-level registration.',
  retail:                 'Retail projects are outside K-RERA project-level registration.',
  industrial_warehousing: 'Industrial / warehousing projects are outside K-RERA project-level registration.',
  hospitality:            'Hospitality (hotels) is outside K-RERA project-level registration.',
  raw_land:               'Raw land (no built development) does not trigger K-RERA registration.',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Evidence-status model — 5-tier weighted scoring
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

// ─────────────────────────────────────────────────────────────────────────────
//  The readiness checklist — 7 buckets, ~30 items
//
//  Each item carries:
//    - id            : stable key for the UI / export / tests
//    - label         : human-readable label
//    - description   : 1-line context for the operator
//    - weight        : 1-5 — drives the completeness score; statutory items
//                      weigh more than nice-to-have items
//    - detect        : { approvalTypes: [...],   // match against approval_items
//                        approvalNamePatterns:   // case-insensitive regex
//                        docNamePatterns:        // case-insensitive regex
//                        docCategories:          // exact match against doc_category
//                        extractedFields:        // future hook
//                      }
//    - recommended_action : what the operator should do if MISSING
// ─────────────────────────────────────────────────────────────────────────────

const READINESS_BUCKETS = [
  {
    id: 'application_declaration',
    label: 'Application & Declaration',
    description: 'K-RERA portal application forms and promoter declaration.',
    items: [
      {
        id: 'form_a_application',
        label: 'Form-A (Application for registration)',
        description: 'Submitted to the K-RERA online portal.',
        weight: 5,
        detect: {
          docNamePatterns: [/form[\s-]*a\b/i, /rera.*application/i],
        },
        recommended_action:
          'Prepare Form-A on the K-RERA portal (rera.karnataka.gov.in). The portal generates the form from the project schedule + promoter details.',
      },
      {
        id: 'form_b_declaration',
        label: 'Form-B (Promoter declaration)',
        description: 'Declaration of project details, schedule, and promoter undertaking.',
        weight: 5,
        detect: {
          docNamePatterns: [/form[\s-]*b\b/i, /promoter.*declaration/i],
        },
        recommended_action:
          'Draft Form-B with the CA — declaration of the promoter undertaking. Stamp paper + notarisation required.',
      },
      {
        id: 'project_affidavit',
        label: 'Project affidavit on stamp paper',
        description: 'Notarised affidavit of the promoter to be filed alongside Form-B.',
        weight: 3,
        detect: {
          docNamePatterns: [/affidavit/i],
        },
        recommended_action: 'Have your lawyer prepare the notarised affidavit. Karnataka stamp paper.',
      },
    ],
  },
  {
    id: 'title_ownership',
    label: 'Title & Ownership',
    description: 'Title chain, encumbrance, mutation, conversion status.',
    items: [
      {
        id: 'title_deed',
        label: 'Authenticated title deed',
        description: 'Registered sale deed or grant establishing the promoter\'s title.',
        weight: 5,
        detect: {
          docNamePatterns: [/title.*deed/i, /sale.*deed/i, /\bgift.*deed\b/i, /\bgrant\b/i],
          docCategories: ['title_deed', 'sale_deed'],
        },
        recommended_action: 'Upload the registered title deed (PDF). Required for K-RERA Form-B.',
      },
      {
        id: 'encumbrance_certificate',
        label: 'Encumbrance Certificate (EC)',
        description: '30-year EC from sub-registrar showing no encumbrances.',
        weight: 5,
        detect: {
          docNamePatterns: [/encumbrance/i, /\bec\b/i],
          docCategories: ['encumbrance_certificate', 'ec'],
        },
        recommended_action:
          'Obtain a 30-year EC from the sub-registrar (Form 15) — required to show clear title for K-RERA.',
      },
      {
        id: 'khata_certificate',
        label: 'Khata Certificate & Extract',
        description: 'BBMP / BMRDA / Panchayat khata in the promoter\'s name.',
        weight: 4,
        detect: {
          approvalTypes: ['khata'],
          approvalNamePatterns: [/khata/i],
          docNamePatterns: [/khata/i],
        },
        recommended_action: 'Apply for Khata transfer to the promoter at BBMP / BMRDA office.',
      },
      {
        id: 'mutation_records',
        label: 'Mutation records (RTC / Pahani)',
        description: 'Revenue records confirming mutation of ownership.',
        weight: 3,
        detect: {
          docNamePatterns: [/mutation/i, /\brtc\b/i, /\bpahani\b/i],
          docCategories: ['mutation_records', 'rtc'],
        },
        recommended_action:
          'Pull mutation extract from the village accountant / tahsildar (Form 11E for revenue land).',
      },
      {
        id: 'dc_conversion',
        label: 'DC Conversion Order (Agri → Non-Agri)',
        description: 'Required when the land was agricultural before development.',
        weight: 4,
        detect: {
          approvalTypes: ['conversion'],
          approvalNamePatterns: [/dc.*conversion/i, /agricultural.*non.*agricultural/i],
          docNamePatterns: [/dc.*conversion/i, /conversion.*order/i],
        },
        recommended_action:
          'If the parcel was agricultural, obtain the DC conversion order from the Deputy Commissioner.',
      },
    ],
  },
  {
    id: 'plan_approvals',
    label: 'Plan & Approvals',
    description: 'Sanctioned plan, commencement certificate, statutory NOCs.',
    items: [
      {
        id: 'sanctioned_building_plan',
        label: 'Sanctioned building plan (BBMP / BDA / BMRDA / BMICAPA)',
        description: 'Approved plan with seal of the planning authority.',
        weight: 5,
        detect: {
          approvalTypes: ['building_plan'],
          approvalNamePatterns: [/sanctioned.*plan/i, /building.*plan/i, /layout.*plan/i],
          docNamePatterns: [/sanctioned.*plan/i, /building.*plan/i, /approved.*plan/i],
        },
        recommended_action:
          'Submit the building plan to BBMP / BDA / BMRDA / BMICAPA and obtain the sanction seal.',
      },
      {
        id: 'commencement_certificate',
        label: 'Building Commencement Certificate (BCC)',
        description: 'Issued by the planning authority post sanctioned plan.',
        weight: 4,
        detect: {
          approvalTypes: ['building_plan'],
          approvalNamePatterns: [/commencement.*certificate/i, /\bbcc\b/i, /\bcc\b/i],
          docNamePatterns: [/commencement.*certificate/i, /\bbcc\b/i],
        },
        recommended_action:
          'Apply for BCC at the planning authority after the sanctioned plan + paying scrutiny fees.',
      },
      {
        id: 'cdp_zoning_certificate',
        label: 'CDP / Master Plan Zoning Certificate',
        description: 'Confirms the parcel is zoned for the proposed use.',
        weight: 3,
        detect: {
          approvalTypes: ['planning'],
          approvalNamePatterns: [/cdp/i, /master.*plan.*zoning/i, /zoning.*certificate/i],
          docNamePatterns: [/cdp/i, /zoning.*certificate/i],
        },
        recommended_action: 'Get the CDP / master-plan zoning certificate from BDA / BBMP.',
      },
      {
        id: 'fire_noc',
        label: 'Fire NOC (Karnataka Fire & Emergency Services)',
        description: 'Required for residential / mixed-use buildings.',
        weight: 4,
        detect: {
          approvalTypes: ['fire_noc'],
          approvalNamePatterns: [/fire.*noc/i, /fire.*emergency/i],
          docNamePatterns: [/fire.*noc/i],
        },
        recommended_action: 'Apply at Karnataka Fire & Emergency Services. NOC valid until expiry on the cert.',
      },
      {
        id: 'environment_clearance',
        label: 'Environment Clearance (if > 20,000 sqm built-up)',
        description: 'KSPCB / SEIAA clearance for larger projects.',
        weight: 3,
        detect: {
          approvalTypes: ['environment'],
          approvalNamePatterns: [/environment.*clearance/i, /\bec\b/i, /kspcb/i],
          docNamePatterns: [/environment.*clearance/i, /kspcb/i, /\bcfe\b/i, /seiaa/i],
        },
        recommended_action:
          'If built-up area exceeds 20,000 sqm, apply for Environment Clearance via SEIAA (Karnataka).',
      },
      {
        id: 'water_noc',
        label: 'BWSSB / Panchayat Water Connection NOC',
        description: 'Confirms water supply provisioning for the project.',
        weight: 3,
        detect: {
          approvalTypes: ['water_sewage', 'water'],
          approvalNamePatterns: [/bwssb.*water/i, /water.*noc/i, /water.*connection/i],
          docNamePatterns: [/bwssb.*water/i, /water.*noc/i],
        },
        recommended_action: 'Apply to BWSSB (BBMP limits) or Gram Panchayat (BMRDA limits) for water connection NOC.',
      },
      {
        id: 'sewage_noc',
        label: 'BWSSB Sewage Connection NOC',
        description: 'Sewage / sewerage provisioning NOC.',
        weight: 2,
        detect: {
          approvalTypes: ['water_sewage', 'sewage'],
          approvalNamePatterns: [/bwssb.*sewage/i, /sewage.*noc/i, /sewerage/i],
          docNamePatterns: [/sewage.*noc/i, /sewerage/i],
        },
        recommended_action: 'Apply to BWSSB for sewage NOC.',
      },
      {
        id: 'power_noc',
        label: 'BESCOM Power Connection / NOC',
        description: 'Power supply provisioning NOC from BESCOM.',
        weight: 3,
        detect: {
          approvalTypes: ['power'],
          approvalNamePatterns: [/bescom.*power/i, /power.*noc/i, /power.*connection/i],
          docNamePatterns: [/bescom.*power/i, /power.*noc/i],
        },
        recommended_action: 'Apply to BESCOM for the power-connection NOC.',
      },
    ],
  },
  {
    id: 'project_specs',
    label: 'Project Specifications',
    description: 'Carpet area, schedule, amenities — RERA-defined disclosures.',
    items: [
      {
        id: 'layout_with_specs',
        label: 'Layout plan with apartment / plot specifications',
        description: 'Showing each unit\'s carpet area (RERA-defined, not super built-up).',
        weight: 4,
        detect: {
          docNamePatterns: [/layout.*plan/i, /unit.*specification/i, /apartment.*specification/i],
          docCategories: ['layout_plan', 'unit_specifications'],
        },
        recommended_action:
          'Have the architect prepare a layout plan with carpet-area-per-unit breakdown.',
      },
      {
        id: 'amenities_list',
        label: 'Amenities list with sizes',
        description: 'Common areas, amenities (clubhouse, gym, parking, etc.) with sqft.',
        weight: 2,
        detect: {
          docNamePatterns: [/amenit/i, /common.*areas/i],
        },
        recommended_action: 'Draft an amenities list with sqft. Goes into Form-B.',
      },
      {
        id: 'project_schedule',
        label: 'Project schedule (start + completion dates)',
        description: 'Proposed commencement + handover dates declared in Form-B.',
        weight: 4,
        detect: {
          docNamePatterns: [/project.*schedule/i, /completion.*schedule/i, /\bgantt\b/i],
        },
        recommended_action:
          'Lock the start + handover dates with the architect / engineer. RERA holds the promoter to these dates.',
      },
    ],
  },
  {
    id: 'promoter_identity',
    label: 'Promoter Identity',
    description: 'Promoter PAN, GST, board resolution — statutory identifiers.',
    items: [
      {
        id: 'promoter_pan',
        label: 'Promoter PAN',
        description: 'PAN of the promoting entity (individual / partnership / LLP / Pvt Ltd).',
        weight: 5,
        detect: {
          docNamePatterns: [/promoter.*pan/i, /\bpan.*card/i],
          extractedFields: ['promoter_pan'],
        },
        recommended_action: 'Upload the promoter\'s PAN card. Required for Form-B.',
      },
      {
        id: 'promoter_gst',
        label: 'Promoter GST registration',
        description: 'GST registration certificate of the promoting entity.',
        weight: 4,
        detect: {
          docNamePatterns: [/\bgst\b/i, /goods.*services.*tax/i],
          extractedFields: ['promoter_gst', 'gstin'],
        },
        recommended_action: 'Upload the GST registration certificate.',
      },
      {
        id: 'authorized_signatory_pan',
        label: 'Authorized signatory PAN',
        description: 'PAN of the authorized signatory (for company promoters).',
        weight: 2,
        detect: {
          docNamePatterns: [/authorized.*signatory/i, /director.*pan/i],
        },
        recommended_action: 'Upload PAN of the authorized signatory (Director / Partner).',
      },
      {
        id: 'board_resolution',
        label: 'Board resolution authorizing the project (company promoters)',
        description: 'Required when the promoter is a company.',
        weight: 3,
        detect: {
          docNamePatterns: [/board.*resolution/i, /\bbr\b/i],
        },
        recommended_action:
          'Pass a board resolution authorising the project + signatory; upload signed minutes.',
      },
    ],
  },
  {
    id: 'escrow_finance',
    label: 'Escrow & Project Finance',
    description: 'RERA-mandated 70% escrow + project bank account.',
    items: [
      {
        id: 'rera_escrow_account',
        label: '70% Escrow Bank Account opening letter',
        description: 'RERA-mandated escrow where 70% of receivables must flow.',
        weight: 5,
        detect: {
          docNamePatterns: [/escrow/i, /rera.*account/i, /70.*account/i],
          extractedFields: ['escrow_bank_account', 'escrow_account_number'],
        },
        recommended_action:
          'Open an escrow bank account at a scheduled bank (with the bank letter naming the RERA project) — non-negotiable for K-RERA.',
      },
      {
        id: 'project_bank_account',
        label: 'Project bank account details (collection account)',
        description: 'Account where the 30% non-escrow share is held.',
        weight: 3,
        detect: {
          docNamePatterns: [/project.*account/i, /collection.*account/i],
          extractedFields: ['project_bank_account'],
        },
        recommended_action: 'Open a separate project bank account; share the IFSC + account number in Form-B.',
      },
    ],
  },
  {
    id: 'professional_certificates',
    label: 'Professional Certificates',
    description: 'Architect, Engineer, CA appointment letters and certificates.',
    items: [
      {
        id: 'architect_appointment',
        label: 'Architect appointment letter (COA-registered)',
        description: 'Council of Architecture-registered architect appointed to the project.',
        weight: 3,
        detect: {
          docNamePatterns: [/architect.*appoint/i, /architect.*letter/i, /\bcoa\b/i],
        },
        recommended_action: 'Appoint a COA-registered architect; upload the appointment letter.',
      },
      {
        id: 'engineer_appointment',
        label: 'Engineer appointment letter',
        description: 'Structural engineer appointed for the project.',
        weight: 3,
        detect: {
          docNamePatterns: [/engineer.*appoint/i, /engineer.*letter/i, /structural.*engineer/i],
        },
        recommended_action: 'Appoint a structural engineer; upload the appointment letter.',
      },
      {
        id: 'ca_appointment',
        label: 'Chartered Accountant appointment letter',
        description: 'CA appointed for the project — handles Form-3 quarterly attestation.',
        weight: 3,
        detect: {
          docNamePatterns: [/\bca\b.*appoint/i, /chartered.*accountant/i],
        },
        recommended_action: 'Appoint a CA; CA attests the Form-3 receivables certificate every quarter.',
      },
    ],
  },
];

// Build a flat item index for fast lookups by id.
const ITEM_INDEX = (() => {
  const idx = new Map();
  for (const bucket of READINESS_BUCKETS) {
    for (const item of bucket.items) {
      idx.set(item.id, { bucket_id: bucket.id, ...item });
    }
  }
  return idx;
})();

// ─────────────────────────────────────────────────────────────────────────────
//  Detection — pure functions mapping (approvals, documents, extractedFields)
//  to an item's evidence status.
// ─────────────────────────────────────────────────────────────────────────────

const matchesAnyPattern = (text, patterns) => {
  if (!text || !patterns || patterns.length === 0) return false;
  return patterns.some((re) => re.test(text));
};

const matchesAnyValue = (value, candidates) => {
  if (!value || !candidates || candidates.length === 0) return false;
  return candidates.some((c) => String(c).toLowerCase() === String(value).toLowerCase());
};

/**
 * For one readiness item, find the best matching approval row (if any) and
 * return the matched approval — caller decides the resulting status.
 */
const findApprovalEvidence = (item, approvals) => {
  if (!Array.isArray(approvals)) return null;
  const { approvalTypes = [], approvalNamePatterns = [] } = item.detect || {};
  if (approvalTypes.length === 0 && approvalNamePatterns.length === 0) return null;

  for (const a of approvals) {
    const typeMatch = matchesAnyValue(a.approval_type, approvalTypes);
    const nameMatch = matchesAnyPattern(a.name, approvalNamePatterns);
    if (typeMatch || nameMatch) return a;
  }
  return null;
};

/**
 * For one readiness item, find any document with a matching name or category.
 */
const findDocumentEvidence = (item, documents) => {
  if (!Array.isArray(documents)) return null;
  const { docNamePatterns = [], docCategories = [] } = item.detect || {};
  if (docNamePatterns.length === 0 && docCategories.length === 0) return null;

  for (const d of documents) {
    const nameMatch = matchesAnyPattern(d.name || d.file_name || d.original_name, docNamePatterns);
    const catMatch = matchesAnyValue(d.doc_category || d.category, docCategories);
    if (nameMatch || catMatch) return d;
  }
  return null;
};

/**
 * For one readiness item, find any extracted field match.
 * `extractedFields` is a flat object: { field_key: { value, confidence }, ... }.
 */
const findExtractedFieldEvidence = (item, extractedFields) => {
  if (!extractedFields || typeof extractedFields !== 'object') return null;
  const { extractedFields: keys = [] } = item.detect || {};
  if (keys.length === 0) return null;

  for (const key of keys) {
    if (extractedFields[key] && extractedFields[key].value != null && extractedFields[key].value !== '') {
      return { key, ...extractedFields[key] };
    }
  }
  return null;
};

/**
 * Combine the three evidence sources into a single status per item. Order
 * of precedence: approval > extracted field > document. Status tier comes
 * from the approval row's flags when an approval exists; otherwise the
 * fallback follows.
 */
const computeItemEvidence = (item, { approvals, documents, extractedFields }) => {
  const approval = findApprovalEvidence(item, approvals);
  const document = findDocumentEvidence(item, documents);
  const extracted = findExtractedFieldEvidence(item, extractedFields);

  // Approval evidence is the highest signal — carries explicit
  // is_required / is_available / is_uploaded / is_validated flags.
  if (approval) {
    let status;
    if (approval.is_validated) status = 'verified';
    else if (approval.is_uploaded) status = 'uploaded';
    else if (approval.is_available) status = 'available';
    else status = 'pending';
    return {
      status,
      source: 'approval',
      evidence_ref: `approval:${approval.id}`,
      evidence_label: approval.name,
      reference_number: approval.reference_number || null,
      document_id: approval.document_id || null,
      issued_date: approval.issued_date || null,
      expiry_date: approval.expiry_date || null,
    };
  }

  // Extracted-field evidence — typed signal but no statutory bond.
  if (extracted) {
    const conf = Number(extracted.confidence);
    const status = Number.isFinite(conf) && conf >= 0.7 ? 'verified' : 'uploaded';
    return {
      status,
      source: 'extracted_field',
      evidence_ref: `extracted:${extracted.key}`,
      evidence_label: `Extracted: ${extracted.key}`,
      extracted_value: extracted.value,
      extracted_confidence: Number.isFinite(conf) ? conf : null,
    };
  }

  // Document evidence — presence only.
  if (document) {
    return {
      status: 'uploaded',
      source: 'document',
      evidence_ref: `document:${document.id}`,
      evidence_label: document.name || document.file_name || document.original_name,
      document_id: document.id,
    };
  }

  // Nothing matched — missing.
  return { status: 'missing', source: null, evidence_ref: null, evidence_label: null };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Composer — compose the readiness pack
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
 * Public API — for a deal's (assetClass, approvals, documents,
 * extractedFields), compose the full readiness pack.
 *
 * Args: { assetClass, approvals, documents, extractedFields, dealName }
 * Returns: { applicable, reason_if_not, overall, buckets, gaps }
 */
const composeReadiness = ({
  assetClass,
  approvals = [],
  documents = [],
  extractedFields = {},
  dealName = null,
} = {}) => {
  if (!assetClass || !APPLICABLE_ASSET_CLASSES.has(assetClass)) {
    return {
      applicable: false,
      reason_if_not:
        NON_APPLICABLE_LABEL[assetClass] ||
        `Asset class "${assetClass || 'unknown'}" does not require K-RERA project registration.`,
      asset_class: assetClass || null,
      deal_name: dealName,
      overall: null,
      buckets: [],
      gaps: [],
    };
  }

  // Score every bucket / item.
  const ctx = { approvals, documents, extractedFields };
  const buckets = READINESS_BUCKETS.map((bucket) => {
    const items = bucket.items.map((item) => {
      const evidence = computeItemEvidence(item, ctx);
      return {
        id: item.id,
        label: item.label,
        description: item.description,
        weight: item.weight,
        evidence,
        status_label: STATUS_LABEL[evidence.status],
        recommended_action: evidence.status === 'missing' || evidence.status === 'pending'
          ? item.recommended_action
          : null,
      };
    });
    const summary = computeBucketSummary(items);
    return {
      id: bucket.id,
      label: bucket.label,
      description: bucket.description,
      items,
      ...summary,
    };
  });

  // Roll up an overall score.
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

  // Surface the top gaps — highest-weight missing items first, then pending.
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

  let readinessTier;
  if (overallPct >= 75) readinessTier = 'filing_ready';
  else if (overallPct >= 50) readinessTier = 'mostly_ready';
  else if (overallPct >= 25) readinessTier = 'partial';
  else readinessTier = 'early';

  return {
    applicable: true,
    reason_if_not: null,
    asset_class: assetClass,
    deal_name: dealName,
    overall: {
      completeness_pct: overallPct,
      readiness_tier: readinessTier,
      by_status: byStatus,
      total_items: Array.from(ITEM_INDEX.keys()).length,
      total_weight: totalWeight,
    },
    buckets,
    gaps,
    // Disclaimer surfaced in UI + export — CLAUDE.md "no legal verdicts".
    disclaimer:
      'This is an organisation aid for the operator\'s CA / architect / lawyer. ' +
      'It does NOT represent a Karnataka RERA compliance verdict — only an inventory of ' +
      'documents and fields the deal team can verify against K-RERA Act 2016 + Rules 2017.',
  };
};

module.exports = {
  // Public
  composeReadiness,
  // Constants — exported for tests + the export builder + UI labels
  APPLICABLE_ASSET_CLASSES,
  NON_APPLICABLE_LABEL,
  STATUS_WEIGHT,
  STATUS_LABEL,
  READINESS_BUCKETS,
  ITEM_INDEX,
  // Sub-fns exported for unit tests
  computeItemEvidence,
  computeBucketSummary,
  findApprovalEvidence,
  findDocumentEvidence,
  findExtractedFieldEvidence,
};
