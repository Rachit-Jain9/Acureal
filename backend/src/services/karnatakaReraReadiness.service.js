'use strict';

/**
 * Karnataka RERA Readiness — Phase 4 orchestrator.
 *
 * Composes a deterministic READINESS PACK for a deal: an evidence-backed map of
 * what K-RERA project registration requires, what the deal already has, the
 * fatal blockers, an estimated registration fee, the applicability assessment,
 * and where the deal sits on the pre-registration → registration →
 * post-registration milestone band.
 *
 * **Honest scope (CLAUDE.md hard rule)**: an *organisation aid* for the
 * operator's CA / architect / lawyer. It NEVER asserts "the deal is
 * RERA-compliant", "registration will be approved" or "Form-B is valid". Only:
 * "X of Y required items have verified evidence; here is what is missing". The
 * statutory determination stays with the human professional. No LLM touches
 * applicability, scoring, fee math, blockers or gaps.
 *
 * The regulatory ontology lives in `constants/reraRequirementCatalog.js`
 * (declarative). Applicability, fee and requirement selection are pure modules
 * under `services/rera/`. This file orchestrates them and scores the result
 * against the deal's approvals + documents + extracted fields.
 */

const { assessApplicability } = require('./rera/applicability');
const { estimateRegistrationFee } = require('./rera/feeEstimator');
const { composeRequirements } = require('./rera/requirementComposer');
const {
  RERA_BUCKETS,
  RERA_REQUIREMENTS,
  CONDITIONAL_NOC_NOTES,
} = require('../constants/reraRequirementCatalog');

// ─────────────────────────────────────────────────────────────────────────────
//  Evidence-status model — 5-tier weighted scoring (unchanged from Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_WEIGHT = Object.freeze({
  verified: 1.0,
  uploaded: 0.75,
  available: 0.5,
  pending: 0.25,
  missing: 0.0,
});

const STATUS_LABEL = Object.freeze({
  verified: 'Verified',
  uploaded: 'Uploaded',
  available: 'Available',
  pending: 'Pending',
  missing: 'Missing',
});

// Score below which a blocked project's score is capped, so a high document
// count can never mask a fatal gap (operator: "95 should be impossible if a
// commencement certificate is missing").
const BLOCK_CAP_PCT = 40;

// ─────────────────────────────────────────────────────────────────────────────
//  Detection — pure functions mapping (approvals, documents, extractedFields)
//  to an item's evidence status. (Unchanged from Phase 3 — reused as-is.)
// ─────────────────────────────────────────────────────────────────────────────

const matchesAnyPattern = (text, patterns) => {
  if (!text || !patterns || patterns.length === 0) return false;
  return patterns.some((re) => re.test(text));
};

const matchesAnyValue = (value, candidates) => {
  if (!value || !candidates || candidates.length === 0) return false;
  return candidates.some((c) => String(c).toLowerCase() === String(value).toLowerCase());
};

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

const computeItemEvidence = (item, { approvals, documents, extractedFields }) => {
  const approval = findApprovalEvidence(item, approvals);
  const document = findDocumentEvidence(item, documents);
  const extracted = findExtractedFieldEvidence(item, extractedFields);

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

  if (document) {
    return {
      status: 'uploaded',
      source: 'document',
      evidence_ref: `document:${document.id}`,
      evidence_label: document.name || document.file_name || document.original_name,
      document_id: document.id,
    };
  }

  return { status: 'missing', source: null, evidence_ref: null, evidence_label: null };
};

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

// ─────────────────────────────────────────────────────────────────────────────
//  Tier + milestone helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

const tierFromPct = (pct) => {
  if (pct >= 75) return 'filing_ready';
  if (pct >= 50) return 'mostly_ready';
  if (pct >= 25) return 'partial';
  return 'early';
};

const severityForWeight = (w) => (w >= 5 ? 'critical' : w >= 4 ? 'high' : w >= 3 ? 'medium' : 'low');

const CORE_APPROVAL_IDS = new Set(['sanctioned_building_plan', 'layout_approval', 'commencement_certificate']);

/**
 * Deterministic milestone band — derived from current signals only (no
 * persistence). pre_registration → registration → post_registration.
 */
const deriveMilestone = (ctx, scoredItems) => {
  if (ctx.reraNumber) {
    return {
      phase: 'post_registration',
      derived_from: `RERA registration number on file (${ctx.reraNumber}).`,
    };
  }
  const hasCoreApproval = scoredItems.some(
    (it) => CORE_APPROVAL_IDS.has(it.id) && it.evidence.status !== 'missing',
  );
  if (hasCoreApproval) {
    return {
      phase: 'registration',
      derived_from: 'Core plan / layout approval is on file — preparing the registration filing.',
    };
  }
  return {
    phase: 'pre_registration',
    derived_from: 'No registration number and no core plan approval on file yet.',
  };
};

const DISCLAIMER =
  'This is an organisation aid for the operator\'s CA / architect / lawyer. ' +
  'It does NOT represent a Karnataka RERA compliance verdict — only an inventory of ' +
  'documents and fields the deal team can verify against K-RERA Act 2016 + Rules 2017. ' +
  'The registration fee is an estimate from the published Karnataka Rules 2017 schedule — ' +
  'verify the current figure on the K-RERA portal.';

// ─────────────────────────────────────────────────────────────────────────────
//  Public API — compose the readiness pack from a deal context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * composeReadiness(ctx) — `ctx` is the object produced by
 * `services/rera/complianceContext.buildReraContext`, but stays backward
 * compatible with the legacy flat shape `{ assetClass, approvals, documents,
 * extractedFields, dealName }` (extra fields default to null/empty).
 *
 * Returns (additive over the Phase-3 shape):
 *   { applicable, applicability, reason_if_not, asset_class, deal_name,
 *     overall, buckets, gaps, fee_estimate, milestone, conditional_notes,
 *     disclaimer }
 */
const composeReadiness = (ctx = {}) => {
  const {
    assetClass = null,
    approvals = [],
    documents = [],
    extractedFields = {},
    dealName = null,
    feeOverrides = null,
    landAreaSqm = null,
  } = ctx;

  const applicability = assessApplicability(ctx);
  const milestoneCtxBase = { reraNumber: ctx.reraNumber || null };

  // Not applicable (likely exempt / not a K-RERA project type) — honest empty
  // state. Keep the Phase-3 contract: applicable:false, buckets:[], gaps:[].
  if (applicability.status === 'likely_exempt' || applicability.status === 'na') {
    return {
      applicable: false,
      applicability,
      reason_if_not: applicability.reason,
      asset_class: assetClass || null,
      deal_name: dealName,
      overall: null,
      buckets: [],
      gaps: [],
      fee_estimate: null,
      milestone: deriveMilestone(milestoneCtxBase, []),
      conditional_notes: [],
      disclaimer: DISCLAIMER,
    };
  }

  // Applicable (in_scope / uncertain) — compose + score the requirement set.
  const detectCtx = { approvals, documents, extractedFields };
  const composed = composeRequirements(ctx);

  const flatScored = [];
  const buckets = composed.map((bucket) => {
    const items = bucket.items.map((item) => {
      const evidence = computeItemEvidence(item, detectCtx);
      const scored = {
        id: item.id,
        label: item.label,
        description: item.description,
        weight: item.weight,
        is_blocker: !!item.is_blocker,
        official_source: item.official_source || null,
        evidence,
        status_label: STATUS_LABEL[evidence.status],
        recommended_action:
          evidence.status === 'missing' || evidence.status === 'pending'
            ? item.recommended_action
            : null,
      };
      flatScored.push(scored);
      return scored;
    });
    const summary = computeBucketSummary(items);
    return { id: bucket.id, label: bucket.label, description: bucket.description, items, ...summary };
  });

  // Overall roll-up.
  let totalWeight = 0;
  let scoredWeight = 0;
  const byStatus = { verified: 0, uploaded: 0, available: 0, pending: 0, missing: 0 };
  for (const it of flatScored) {
    totalWeight += it.weight;
    scoredWeight += it.weight * STATUS_WEIGHT[it.evidence.status];
    byStatus[it.evidence.status] += 1;
  }
  const rawPct = totalWeight > 0 ? Math.round((scoredWeight / totalWeight) * 100) : 0;

  // Fatal blockers — blocker items without at least uploaded/available evidence.
  const blockers = flatScored
    .filter((it) => it.is_blocker && (it.evidence.status === 'missing' || it.evidence.status === 'pending'))
    .map((it) => ({ item_id: it.id, item_label: it.label, status: it.evidence.status }));
  const isBlocked = blockers.length > 0;
  const completenessPct = isBlocked ? Math.min(rawPct, BLOCK_CAP_PCT) : rawPct;
  const readinessTier = isBlocked && rawPct > BLOCK_CAP_PCT ? 'blocked' : tierFromPct(completenessPct);

  // Gaps — missing / pending, sorted by weight desc (blockers flagged, not reordered).
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
          is_blocker: it.is_blocker,
          recommended_action: it.recommended_action,
          severity: it.is_blocker ? 'critical' : severityForWeight(it.weight),
        });
      }
    }
  }
  gaps.sort((a, b) => b.weight - a.weight);

  const feeEstimate = estimateRegistrationFee({ assetClass, landAreaSqm, feeOverrides });

  return {
    applicable: true,
    applicability,
    reason_if_not: null,
    asset_class: assetClass,
    deal_name: dealName,
    overall: {
      completeness_pct: completenessPct,
      raw_completeness_pct: rawPct,
      readiness_tier: readinessTier,
      is_blocked: isBlocked,
      blockers,
      by_status: byStatus,
      total_items: flatScored.length,
      total_weight: totalWeight,
    },
    buckets,
    gaps,
    fee_estimate: feeEstimate,
    milestone: deriveMilestone(ctx, flatScored),
    conditional_notes: CONDITIONAL_NOC_NOTES,
    disclaimer: DISCLAIMER,
  };
};

// Full grouped catalog (every requirement, unfiltered) — exported for the
// structural test and any label lookups. composeRequirements filters this per
// deal; this is the complete set.
const READINESS_BUCKETS = (() => {
  const byBucket = new Map();
  for (const it of RERA_REQUIREMENTS) {
    if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, []);
    byBucket.get(it.bucket).push(it);
  }
  const out = [];
  for (const meta of RERA_BUCKETS) {
    const items = byBucket.get(meta.id);
    if (items && items.length) out.push({ ...meta, items });
  }
  return out;
})();

module.exports = {
  // Public
  composeReadiness,
  // Constants — exported for tests + the export builder + UI labels
  STATUS_WEIGHT,
  STATUS_LABEL,
  READINESS_BUCKETS,
  BLOCK_CAP_PCT,
  // Sub-fns exported for unit tests (unchanged behaviour)
  computeItemEvidence,
  computeBucketSummary,
  findApprovalEvidence,
  findDocumentEvidence,
  findExtractedFieldEvidence,
  tierFromPct,
};
