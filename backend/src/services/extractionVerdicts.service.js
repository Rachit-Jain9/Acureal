'use strict';

/**
 * Extraction-verdict service — Workstream C (the standing extraction-quality
 * system).
 *
 * When an operator reviews AI-extracted document fields and applies them to a
 * deal, this service records — per field — whether they used the AI's value
 * unchanged (`accepted`) or corrected it (`overridden`). Two outputs from one
 * apply, mirroring the comp-reliance pattern (compReliance.service):
 *
 *   1. Durable operational state in `extraction_field_verdicts` — the current
 *      human verdict on each applied extracted field (upserted per
 *      extraction + canonical field).
 *   2. A values-free `extraction_field_verdict` learning signal appended to
 *      `improvement_signals` via learningSignals.service — the append-only
 *      event log behind the standing accuracy metric.
 *
 * Hard rules:
 *   - Fire-and-forget. recordVerdictsForApply() must NEVER throw — it runs on
 *     the apply-extractions write path, and telemetry can never break a real
 *     write. Every failure is swallowed and returns 0.
 *   - Migration-tolerant. Until 20260611 is applied it no-ops cleanly.
 *   - Values-free. Neither the table nor the signal stores a field VALUE —
 *     only the canonical field KEY and metadata. The values live on
 *     document_extractions and the deal itself.
 *   - Deterministic. The accepted/overridden verdict is a pure value
 *     comparison through the ontology's coercion — no AI, no heuristics.
 */

const { query } = require('../config/database');
const ontology = require('../../../packages/real-estate-ontology/src');
const learningSignals = require('./learningSignals.service');
const log = require('../lib/logger').child({ module: 'extractionVerdicts.service' });

const PG_UNDEFINED_TABLE = '42P01';
const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

/**
 * Compare two ontology-coerced values. A relative epsilon is used for numbers
 * because coerced acres→sqft / ₹→₹Cr values carry rounding — an exact `===`
 * would mis-flag an unchanged numeric field as overridden.
 */
const valuesMatch = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) <= 1e-6 * Math.max(1, Math.abs(na), Math.abs(nb));
  }
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
};

/**
 * Classify one applied field. `appliedValue` is already ontology-coerced — it
 * is exactly what apply-extractions wrote to the deal. The AI's raw value is
 * run through the SAME coercion so the two are compared in canonical units
 * (so "5 acres" kept as "217800 sqft" reads as accepted, not overridden).
 *
 * @returns {'accepted'|'overridden'}
 */
const classifyVerdict = (canonicalField, aiRawValue, appliedValue) => {
  const aiCoerced = ontology.validateAndCoerce(canonicalField, aiRawValue);
  // The AI value could not even be coerced (missing / unparseable) — the
  // operator necessarily supplied a usable value, so this is an override.
  if (!aiCoerced.ok) return 'overridden';
  return valuesMatch(aiCoerced.value, appliedValue) ? 'accepted' : 'overridden';
};

/**
 * Record verdicts for a completed apply-extractions write. Called fire-and-
 * forget from dealApplyExtractions.service after the transaction commits —
 * never throws, never blocks the apply.
 *
 * @param {object} input
 * @param {string} input.dealId               the deal the fields were applied to.
 * @param {string|null} input.organizationId  the deal's organisation (for the signal).
 * @param {Array} input.applied               the `applied` array from
 *                                            applyExtractionsToDeal — each item
 *                                            carries canonical_field, value
 *                                            (coerced), source_extraction_id,
 *                                            source_field.
 * @param {string|null} input.userId          the acting operator.
 * @returns {Promise<number>}  count of verdicts recorded (0 on any failure).
 */
const recordVerdictsForApply = async ({
  dealId,
  organizationId = null,
  applied,
  userId = null,
} = {}) => {
  try {
    if (!Array.isArray(applied) || applied.length === 0) return 0;

    // Only fields with a traceable AI source can be classified — without the
    // source extraction + raw key there is no AI value to compare against.
    const traceable = applied.filter(
      (a) => a && a.source_extraction_id && a.source_field && a.canonical_field,
    );
    if (traceable.length === 0) return 0;

    // One round-trip: fetch the source extractions (org-scoped via RLS) so we
    // have the AI's raw value, doc type, provider and per-field confidence.
    const extractionIds = [...new Set(traceable.map((a) => a.source_extraction_id))];
    const extResult = await query(
      `SELECT id, doc_type, provider, structured_fields, confidence_scores
         FROM public.document_extractions
        WHERE id = ANY($1::uuid[])
          AND organization_id = current_organization_id()`,
      [extractionIds],
    );
    const extById = new Map(extResult.rows.map((r) => [r.id, r]));

    // Build one verdict per traceable applied field, de-duplicated on
    // (extraction, canonical field) so the upsert never affects a row twice.
    const verdictByKey = new Map();
    for (const item of traceable) {
      const ext = extById.get(item.source_extraction_id);
      if (!ext) continue; // extraction not visible / deleted — skip honestly.

      const aiFields =
        ext.structured_fields && typeof ext.structured_fields === 'object'
          ? ext.structured_fields
          : {};
      const confidence =
        ext.confidence_scores && typeof ext.confidence_scores === 'object'
          ? ext.confidence_scores
          : {};
      const rawConf = Number(confidence[item.source_field]);

      verdictByKey.set(`${item.source_extraction_id}::${item.canonical_field}`, {
        extraction_id: item.source_extraction_id,
        canonical_field: String(item.canonical_field).slice(0, 120),
        source_field: String(item.source_field).slice(0, 200),
        doc_type: ext.doc_type || 'unknown',
        ai_provider: ext.provider || 'unknown',
        ai_confidence: Number.isFinite(rawConf) ? rawConf : null,
        verdict: classifyVerdict(item.canonical_field, aiFields[item.source_field], item.value),
      });
    }
    const verdicts = [...verdictByKey.values()];
    if (verdicts.length === 0) return 0;

    // Upsert the durable operational state — one batched INSERT expanding the
    // JSON array into rows; the latest verdict wins per (extraction, field).
    await query(
      `INSERT INTO public.extraction_field_verdicts
         (extraction_id, deal_id, canonical_field, source_field,
          doc_type, ai_provider, ai_confidence, verdict, created_by)
       SELECT (elem->>'extraction_id')::uuid, $1::uuid,
              elem->>'canonical_field', elem->>'source_field',
              elem->>'doc_type', elem->>'ai_provider',
              NULLIF(elem->>'ai_confidence', '')::numeric,
              elem->>'verdict', $2::uuid
         FROM jsonb_array_elements($3::jsonb) AS elem
       ON CONFLICT (extraction_id, canonical_field) DO UPDATE
         SET verdict       = EXCLUDED.verdict,
             source_field  = EXCLUDED.source_field,
             doc_type      = EXCLUDED.doc_type,
             ai_provider   = EXCLUDED.ai_provider,
             ai_confidence = EXCLUDED.ai_confidence,
             updated_at    = NOW()`,
      [dealId || null, userId || null, JSON.stringify(verdicts)],
    );

    // Append the values-free Layer-5 learning signals — never throws.
    await learningSignals.recordExtractionVerdictSignals({
      organizationId,
      dealId,
      verdicts,
      userId,
    });

    return verdicts.length;
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('extraction_field_verdicts table missing — apply migration 20260611');
    } else {
      log.warn('extraction_verdict_capture_failed', { error: err.message });
    }
    return 0;
  }
};

/**
 * Extraction-accuracy read model — the standing quality metric. Aggregates
 * `extraction_field_verdicts` over a trailing window into a per-(doc_type,
 * canonical_field) acceptance rate plus an overall rollup. Org-scoped via
 * current_organization_id(). Soft-fails to a safe empty shape — a quality
 * dashboard is never worth a 500.
 *
 * The response shape is kept stable for the ExtractionQualityWidget:
 *   { available, window_days, overall:{reviewed,corrected,accuracy_pct},
 *     by_field:[{doc_type,field_key,reviewed,corrected,accuracy_pct}],
 *     generated_at }
 * where, for the verdict system, `reviewed` = fields applied and `corrected`
 * = fields the operator overrode.
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
      `SELECT doc_type,
              canonical_field,
              COUNT(*)::int AS reviewed,
              COUNT(*) FILTER (WHERE verdict = 'overridden')::int AS corrected
         FROM public.extraction_field_verdicts
        WHERE created_at > NOW() - ($1 || ' days')::interval
          AND organization_id = current_organization_id()
        GROUP BY 1, 2
        ORDER BY corrected DESC, reviewed DESC
        LIMIT 100`,
      [windowDays],
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
        field_key: r.canonical_field || 'unknown',
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
  recordVerdictsForApply,
  getExtractionAccuracy,
  // exported for unit tests
  __internal: { classifyVerdict, valuesMatch },
};
