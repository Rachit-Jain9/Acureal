'use strict';

/**
 * rera/consistency — surfaces the deterministic cross-document inconsistency
 * findings (seller/EC owner mismatch, area drift, FSI conflict, RERA gap,
 * consideration drift) in the K-RERA cockpit, co-located with the readiness
 * checklist — the operator's vision "Title & Parcel Consistency / Mismatch
 * Dashboard".
 *
 * REUSES the existing `inconsistencyDetector` (pure deterministic comparators,
 * zero LLM, no persistence here). This module only fetches + shapes the
 * findings for the cockpit — it does NOT re-implement detection.
 *
 * CLAUDE.md legal-lane rule respected: only the DETERMINISTIC findings are
 * surfaced (each flagged for human / legal verification via its own mitigation
 * text). The AI-narrated `risk_brief` is never surfaced here.
 */

const inconsistencyDetector = require('../inconsistencyDetector.service');
const extractionService = require('../extraction.service');
const { compareGroundTruth } = require('./groundTruthChecks');
const log = require('../../lib/logger').child({ module: 'reraConsistency' });

const SEVERITY_RANK = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });

const EMPTY_SUMMARY = () => ({ total: 0, critical: 0, high: 0, medium: 0, low: 0 });

/**
 * Pure shaper — sorts findings by severity and rolls up a count summary.
 */
const shapeConsistency = (findings) => {
  const list = (Array.isArray(findings) ? findings : []).map((f) => ({
    pair_key: f.pair_key || null,
    category: f.category || null,
    severity: f.severity || 'low',
    title: f.title || '',
    description: f.description || '',
    mitigation: f.mitigation || null,
    evidence: Array.isArray(f.evidence) ? f.evidence : [],
  }));
  list.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  const summary = EMPTY_SUMMARY();
  summary.total = list.length;
  for (const f of list) {
    if (summary[f.severity] != null) summary[f.severity] += 1;
  }
  return { findings: list, summary };
};

/**
 * Fetch + shape the deal's consistency findings for the cockpit:
 *   • cross-document findings — reuses the existing deterministic
 *     `inconsistencyDetector.runAllComparators` (no DB writes, no re-implementation);
 *   • ground-truth findings — the deal's RECORDED khata / owner vs the values
 *     extracted from documents (`compareGroundTruth`), when `deal` is supplied.
 *
 * One read of the deal's extractions feeds both. Degrades to an honest
 * "unavailable" state on any error (e.g. extractions table absent), never
 * throwing into the workspace build.
 */
const composeReraConsistency = async (dealId, deal = null) => {
  try {
    const { extractions, field_map } = await extractionService.getDealExtractions(dealId);
    const detectorFindings = inconsistencyDetector.runAllComparators(extractions);
    const groundTruthFindings = deal ? compareGroundTruth(deal, field_map) : [];

    // Merge + dedupe by pair_key (both sources are deterministic).
    const seen = new Set();
    const merged = [...detectorFindings, ...groundTruthFindings].filter((f) => {
      const k = f && f.pair_key ? f.pair_key : null;
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return {
      ...shapeConsistency(merged),
      available: true,
      extractions_count: (extractions && extractions.length) || 0,
    };
  } catch (err) {
    log.warn('rera_consistency_failed', { dealId, error: err.message });
    return { findings: [], summary: EMPTY_SUMMARY(), available: false, extractions_count: 0 };
  }
};

module.exports = { composeReraConsistency, shapeConsistency, SEVERITY_RANK };
