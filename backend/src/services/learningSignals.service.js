'use strict';

/**
 * Learning-signal service — the writer for the Phase 5 "learning loop".
 *
 * Appends, into public.improvement_signals (Layer-5 telemetry), the feedback
 * REDIP already generates as it is worked but does not otherwise keep as a
 * learning signal. Today two signal types flow through here:
 *
 *   - `comp_reliance`            — an analyst marked / unmarked a comp as
 *                                  relied-on for a deal (Workstream C1).
 *   - `extraction_field_verdict` — an operator applied an AI-extracted field
 *                                  to a deal, accepting or overriding the AI's
 *                                  value (Workstream C, the extraction-quality
 *                                  system).
 *
 * (`extraction_field_review` is a historical signal type, kept in the DB CHECK
 * but no longer written — the extraction-quality system superseded it.)
 *
 * Each signal's durable operational state and read-model live with its owning
 * service (compReliance.service / extractionVerdicts.service); this file is
 * purely the values-free Layer-5 append.
 *
 * Hard rules (mirror docs/DATA_GOVERNANCE.md and the Phase 5 guardrails):
 *   - Values-free. A signal stores field/entity KEYS, doc type, provider,
 *     a verdict and a confidence score — never field VALUES, never PII.
 *   - Consent-gated. user_id is attached only when the acting user holds the
 *     `product_improvement` consent; otherwise the row is anonymous.
 *   - Fire-and-forget. Signal capture must NEVER break the host workflow.
 *     Every public function swallows its own errors and is migration-tolerant.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'learningSignals.service' });
const consentService = require('./consent.service');

const PG_UNDEFINED_TABLE = '42P01';

// Every signal type the improvement_signals CHECK constraint permits. Mirrors
// the DB constraint maintained by migrations 20260608 / 20260610 / 20260611.
const SIGNAL_TYPES = Object.freeze([
  'extraction_field_review', // historical — no longer written
  'comp_reliance',
  'extraction_field_verdict',
]);
// Consent purpose that gates user-attributed signal capture.
const LEARNING_CONSENT_PURPOSE = 'product_improvement';

const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

/**
 * Resolve the user id to attribute a signal to: the given user only if they
 * hold the product_improvement consent, otherwise null (a fully-anonymous
 * aggregate row). Never throws — a consent-check failure resolves to null.
 */
const resolveConsentedUserId = async (userId) => {
  if (!userId) return null;
  try {
    const consented = await consentService.hasConsent(userId, LEARNING_CONSENT_PURPOSE);
    return consented ? userId : null;
  } catch {
    return null;
  }
};

/**
 * Capture a comp-reliance signal — Workstream C1, the data-network seed.
 *
 * Appends ONE values-free row recording that an analyst marked (or unmarked)
 * a comp as relied-upon for a deal, alongside the deterministic scorer's
 * verdict at that moment. This is the ground truth a future learned
 * comp-ranker needs: "the analyst relied on a comp the scorer ranked Nth".
 *
 * `detail` carries org-internal references (deal_id, comp_id) and the
 * scorer's numeric outputs — no document field values, no PII — so it stays
 * within the values-free posture of improvement_signals.
 *
 * Never throws — returns 1 on write, 0 on any failure — so the reliance
 * toggle is never broken by telemetry capture.
 *
 * @param {object} input
 * @param {string} input.organizationId  the deal's organisation.
 * @param {string} input.dealId          the deal the comp was relied on for.
 * @param {string} input.compId          the comp marked / unmarked.
 * @param {boolean} input.relied         true = marked relied-on, false = unmarked.
 * @param {number|null} input.similarityScore  scorer composite [0,1] at toggle time.
 * @param {number|null} input.similarityRank   the comp's rank in the ranked list.
 * @param {number|null} input.rateDeltaPct     comp rate vs subject benchmark, signed %.
 * @param {string|null} input.userId     the acting user (consent-gated).
 */
const recordCompRelianceSignal = async ({
  organizationId = null,
  dealId,
  compId,
  relied,
  similarityScore = null,
  similarityRank = null,
  rateDeltaPct = null,
  userId = null,
} = {}) => {
  try {
    if (!dealId || !compId) return 0;

    // Attach the user only with product_improvement consent; else anonymous.
    const resolvedUserId = await resolveConsentedUserId(userId);

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const detail = {
      deal_id: String(dealId),
      comp_id: String(compId),
      relied_on: relied === true,
      similarity_score: num(similarityScore),
      similarity_rank: num(similarityRank),
      rate_delta_pct: num(rateDeltaPct),
    };

    await query(
      `INSERT INTO public.improvement_signals (organization_id, user_id, signal_type, detail)
       VALUES ($1, $2, 'comp_reliance', $3::jsonb)`,
      [organizationId, resolvedUserId, JSON.stringify(detail)]
    );
    return 1;
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('improvement_signals table missing — apply migration 20260608');
    } else {
      log.warn('comp_reliance_signal_capture_failed', { error: err.message });
    }
    return 0;
  }
};

/**
 * Capture extraction-field-verdict signals — Workstream C, the standing
 * extraction-quality system.
 *
 * Appends one values-free row per applied extracted field, recording whether
 * the operator accepted the AI's value or overrode it. Written as a single
 * batched INSERT so it is one round-trip. The durable operational state and
 * the accuracy read-model live in extractionVerdicts.service; this is purely
 * the append-only Layer-5 event log.
 *
 * `detail` carries org-internal references (extraction_id, deal_id), the
 * canonical field KEY (a schema name, never a value), doc type, AI provider,
 * the AI's confidence, and the verdict — values-free throughout.
 *
 * Never throws — returns the count written, or 0 on any failure — so the
 * apply-extractions flow is never broken by telemetry capture.
 *
 * @param {object} input
 * @param {string|null} input.organizationId  the deal's organisation.
 * @param {string|null} input.dealId          the deal the fields were applied to.
 * @param {Array} input.verdicts              per-field verdict records, each
 *                                            { extraction_id, canonical_field,
 *                                              source_field, doc_type,
 *                                              ai_provider, ai_confidence,
 *                                              verdict }.
 * @param {string|null} input.userId          the acting operator (consent-gated).
 */
const recordExtractionVerdictSignals = async ({
  organizationId = null,
  dealId = null,
  verdicts,
  userId = null,
} = {}) => {
  try {
    if (!Array.isArray(verdicts) || verdicts.length === 0) return 0;

    // One consent check for the whole batch — attach the user only if they
    // have granted product_improvement; otherwise the rows are anonymous.
    const resolvedUserId = await resolveConsentedUserId(userId);

    // Values-free metadata only — field KEYS and org-internal refs, never
    // field values.
    const details = verdicts.map((v) => {
      const rawConfidence = Number(v.ai_confidence);
      return {
        extraction_id: v.extraction_id ? String(v.extraction_id) : null,
        deal_id: dealId ? String(dealId) : null,
        canonical_field: String(v.canonical_field || 'unknown').slice(0, 120),
        source_field: v.source_field ? String(v.source_field).slice(0, 200) : null,
        doc_type: v.doc_type || 'unknown',
        ai_provider: v.ai_provider || 'unknown',
        ai_confidence: Number.isFinite(rawConfidence) ? rawConfidence : null,
        verdict: v.verdict === 'overridden' ? 'overridden' : 'accepted',
      };
    });

    // Single round-trip: expand the JSON array of detail objects into rows.
    await query(
      `INSERT INTO public.improvement_signals (organization_id, user_id, signal_type, detail)
       SELECT $1, $2, 'extraction_field_verdict', elem
         FROM jsonb_array_elements($3::jsonb) AS elem`,
      [organizationId, resolvedUserId, JSON.stringify(details)]
    );
    return details.length;
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('improvement_signals table missing — apply migration 20260608');
    } else {
      log.warn('extraction_verdict_signal_capture_failed', { error: err.message });
    }
    return 0;
  }
};

module.exports = {
  SIGNAL_TYPES,
  recordCompRelianceSignal,
  recordExtractionVerdictSignals,
};
