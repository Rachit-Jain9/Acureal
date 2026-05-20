'use strict';

/**
 * Learning-signal service — Phase 5.1 of the plan ("the learning loop").
 *
 * Records the feedback REDIP already generates but does not yet keep as
 * learning signal, into public.improvement_signals (Layer-5 telemetry).
 * The first signal type is `extraction_field_review`: one row per field of a
 * reviewed AI extraction, recording whether the field was corrected. From
 * that, getExtractionAccuracy() computes a real per-field accuracy metric.
 *
 * Hard rules (mirror docs/DATA_GOVERNANCE.md and the Phase 5 guardrails):
 *   - Values-free. A signal stores field KEYS, doc type, provider, a
 *     was-corrected boolean and a confidence score — never field VALUES.
 *   - Consent-gated. user_id is attached only when the acting user holds the
 *     `product_improvement` consent; otherwise the row is anonymous.
 *   - Fire-and-forget. Signal capture must NEVER break the host workflow
 *     (applying extraction corrections). Every public function swallows its
 *     own errors and is migration-tolerant.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'learningSignals.service' });
const consentService = require('./consent.service');

const PG_UNDEFINED_TABLE = '42P01';

const SIGNAL_TYPES = Object.freeze(['extraction_field_review']);
// Consent purpose that gates user-attributed signal capture.
const LEARNING_CONSENT_PURPOSE = 'product_improvement';

const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

/**
 * Capture extraction-review signals: one row per field of a reviewed
 * extraction, recording whether the human corrected it. Written as a single
 * batched INSERT so it is one round-trip — cheap enough to await on the
 * correction-save path without adding perceptible latency.
 *
 * Never throws — returns the count written, or 0 on any failure — so it is
 * safe to call from the apply-corrections flow.
 *
 * @param {object} input
 * @param {object} input.extraction  the document_extractions row (post-correction):
 *                                   organization_id, doc_type, provider,
 *                                   structured_fields, confidence_scores.
 * @param {object} input.corrections the { field: value } map the user submitted.
 * @param {string} input.userId      the reviewing user.
 */
const recordExtractionReviewSignals = async ({ extraction, corrections, userId } = {}) => {
  try {
    if (!extraction || typeof extraction !== 'object') return 0;

    const aiFields =
      extraction.structured_fields && typeof extraction.structured_fields === 'object'
        ? extraction.structured_fields
        : {};
    const correctionMap = corrections && typeof corrections === 'object' ? corrections : {};
    const confidence =
      extraction.confidence_scores && typeof extraction.confidence_scores === 'object'
        ? extraction.confidence_scores
        : {};

    // Field universe = everything the AI extracted ∪ everything the human
    // touched. A field the human added that the AI missed counts as corrected.
    const fieldKeys = new Set([...Object.keys(aiFields), ...Object.keys(correctionMap)]);
    // `_overall` is a synthetic confidence rollup, not a real extracted field.
    fieldKeys.delete('_overall');
    if (fieldKeys.size === 0) return 0;

    // One consent check for the whole batch — attach the user only if they
    // have granted product_improvement; otherwise the rows are anonymous.
    let resolvedUserId = null;
    if (userId) {
      try {
        const consented = await consentService.hasConsent(userId, LEARNING_CONSENT_PURPOSE);
        resolvedUserId = consented ? userId : null;
      } catch {
        resolvedUserId = null;
      }
    }

    const organizationId = extraction.organization_id || null;
    const docType = extraction.doc_type || 'unknown';
    const aiProvider = extraction.provider || 'unknown';

    // Values-free metadata only — field KEYS, never field values.
    const details = [...fieldKeys].map((field) => {
      const rawConfidence = Number(confidence[field]);
      return {
        doc_type: docType,
        ai_provider: aiProvider,
        field_key: String(field).slice(0, 120),
        was_corrected: Object.prototype.hasOwnProperty.call(correctionMap, field),
        ai_confidence: Number.isFinite(rawConfidence) ? rawConfidence : null,
      };
    });

    // Single round-trip: expand the JSON array of detail objects into rows.
    await query(
      `INSERT INTO public.improvement_signals (organization_id, user_id, signal_type, detail)
       SELECT $1, $2, 'extraction_field_review', elem
         FROM jsonb_array_elements($3::jsonb) AS elem`,
      [organizationId, resolvedUserId, JSON.stringify(details)]
    );
    return details.length;
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('improvement_signals table missing — apply migration 20260608');
    } else {
      log.warn('extraction_review_signal_capture_failed', { error: err.message });
    }
    return 0;
  }
};

/**
 * Extraction-accuracy read model (Phase 5.2 seed). Aggregates the
 * extraction_field_review signals over a trailing window into a per-(doc_type,
 * field) correction rate plus an overall rollup. Org-scoped via
 * current_organization_id(). Soft-fails to a safe empty shape — a quality
 * dashboard is never worth a 500.
 */
const getExtractionAccuracy = async ({ days = 90 } = {}) => {
  const windowDays = Math.min(Math.max(Number(days) || 90, 1), 365);
  const empty = {
    available: false,
    window_days: windowDays,
    overall: { reviewed: 0, corrected: 0, accuracy_pct: null },
    by_field: [],
    generated_at: new Date().toISOString(),
  };
  try {
    const result = await query(
      `SELECT detail->>'doc_type'  AS doc_type,
              detail->>'field_key' AS field_key,
              COUNT(*)::int AS reviewed,
              COUNT(*) FILTER (WHERE (detail->>'was_corrected')::boolean)::int AS corrected
         FROM public.improvement_signals
        WHERE signal_type = 'extraction_field_review'
          AND created_at > NOW() - ($1 || ' days')::interval
          AND organization_id = current_organization_id()
        GROUP BY 1, 2
        ORDER BY corrected DESC, reviewed DESC
        LIMIT 100`,
      [windowDays]
    );

    let totalReviewed = 0;
    let totalCorrected = 0;
    const byField = result.rows.map((r) => {
      const reviewed = r.reviewed || 0;
      const corrected = r.corrected || 0;
      totalReviewed += reviewed;
      totalCorrected += corrected;
      return {
        doc_type: r.doc_type || 'unknown',
        field_key: r.field_key || 'unknown',
        reviewed,
        corrected,
        accuracy_pct:
          reviewed > 0 ? Math.round(((reviewed - corrected) / reviewed) * 1000) / 10 : null,
      };
    });

    return {
      available: true,
      window_days: windowDays,
      overall: {
        reviewed: totalReviewed,
        corrected: totalCorrected,
        accuracy_pct:
          totalReviewed > 0
            ? Math.round(((totalReviewed - totalCorrected) / totalReviewed) * 1000) / 10
            : null,
      },
      by_field: byField,
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    if (!isMissingTable(err)) {
      log.warn('extraction_accuracy_query_failed', { error: err.message });
    }
    return empty;
  }
};

module.exports = {
  SIGNAL_TYPES,
  recordExtractionReviewSignals,
  getExtractionAccuracy,
};
