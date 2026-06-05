'use strict';

/**
 * groundTruthChecks — deterministic parcel-identity reconciliation: the deal's
 * RECORDED parcel fields (operator-entered, on `deals`/`properties`) vs the
 * values EXTRACTED from the uploaded documents. Lower false-positive than a pure
 * cross-document check because one side is the operator's recorded truth.
 *
 * Conservative by design (CLAUDE.md "nothing false / noisy"):
 *   • Only khata-number + owner-name are reconciled. Survey number is skipped:
 *     a single deal legitimately spans multiple survey numbers, so a bare
 *     "differs" comparison is false-positive-prone.
 *   • Findings are deterministic, categorised `title` (a legal lane → flagged
 *     for human / legal verification, never an AI verdict).
 *
 * Same Finding shape as `inconsistencyDetector`, so `rera/consistency` can merge
 * + shape ground-truth and cross-document findings uniformly. Reuses
 * `nameSimilarity` from the detector.
 */

const { nameSimilarity } = require('../inconsistencyDetector.service');

const NAME_MATCH_THRESHOLD = 0.6;
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normId = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

// field_map[key] may be `{ value, confidence, ... }` or a bare value.
const extractedValue = (fieldMap, key) => {
  const f = fieldMap && fieldMap[key];
  if (f == null) return null;
  const v = typeof f === 'object' ? f.value : f;
  return v != null && String(v).trim() !== '' ? String(v).trim() : null;
};

const compareGroundTruth = (deal, fieldMap) => {
  const findings = [];
  if (!deal || !fieldMap || typeof fieldMap !== 'object') return findings;

  // ── Khata number — recorded vs extracted ────────────────────────────────────
  const recKhata = deal.khata_no;
  const extKhata = extractedValue(fieldMap, 'khata_number');
  if (recKhata && extKhata && normId(recKhata) && normId(extKhata) && normId(recKhata) !== normId(extKhata)) {
    findings.push({
      pair_key: `gt_khata:${normId(recKhata)}:${normId(extKhata)}`,
      category: 'title',
      severity: 'medium',
      title: 'Khata number on file differs from the document',
      description:
        `The deal records khata "${recKhata}", but an uploaded document shows khata "${extKhata}". ` +
        'Confirm the document is for this parcel and that the khata has been transferred to the current owner.',
      mitigation:
        "Reconcile the khata number against the BBMP / BMRDA record. If the khata is still in a prior owner's name, complete the khata transfer before relying on it.",
      evidence: [
        { doc_type: 'deal_record', field: 'khata_no', value: recKhata },
        { doc_type: 'extracted', field: 'khata_number', value: extKhata },
      ],
    });
  }

  // ── Owner name — recorded vs extracted (current-owner records: khata / RTC) ──
  const recOwner = deal.owner_name;
  const extOwner = extractedValue(fieldMap, 'owner_name');
  if (recOwner && extOwner && normName(recOwner) && normName(extOwner)) {
    const sim = nameSimilarity(recOwner, extOwner);
    if (sim < NAME_MATCH_THRESHOLD) {
      findings.push({
        pair_key: `gt_owner:${normName(recOwner)}:${normName(extOwner)}`,
        category: 'title',
        severity: sim < 0.2 ? 'high' : 'medium',
        title: 'Owner on file differs from the document',
        description:
          `The deal records the owner as "${recOwner}", but an uploaded document names "${extOwner}" ` +
          `(name similarity ${(sim * 100).toFixed(0)}%). A divergence can mean a pending khata transfer or a ` +
          "title-chain step that isn't on file.",
        mitigation:
          'Verify the current owner against the latest khata / RTC and the registered title chain; reconcile any pending transfer.',
        evidence: [
          { doc_type: 'deal_record', field: 'owner_name', value: recOwner },
          { doc_type: 'extracted', field: 'owner_name', value: extOwner },
        ],
      });
    }
  }

  return findings;
};

module.exports = { compareGroundTruth, extractedValue };
