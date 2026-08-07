'use strict';

/**
 * ai_artifacts persistence — caches AI-generated narrative outputs (deal
 * analysis, IC memo drafts, risk briefs) so subsequent fetches return the
 * stored artifact instead of regenerating.
 *
 * Cache key: (deal_id, artifact_type, snapshot_hash). The snapshot_hash is
 * computed by the caller from the input payload that produced the artifact;
 * any change in inputs → new hash → next fetch is a miss → regeneration.
 *
 * Fail-open contract: every DB operation is wrapped so a missing table or
 * a transient query error never blocks the surrounding workflow. The
 * generator (streamDealAnalysis et al.) treats persistence as best-effort —
 * if save fails, the live generation still reaches the user; if lookup
 * fails, the user just gets a fresh generation. This keeps the feature
 * deployable BEFORE the migration is applied to prod (operator action).
 */

const crypto = require('crypto');
const { query } = require('../config/database');
const { sanitizeAiProse } = require('../utils/aiLegalProseGuard');
const log = require('../lib/logger').child({ module: 'ai.artifacts' });

const SUPPORTED_ARTIFACT_TYPES = new Set([
  'deal_analysis',
  'ic_memo',
  'risk_brief',
]);

/**
 * The legal-four guard, applied HERE — at the one door every AI artifact goes
 * through — rather than in each generator.
 *
 * Placement is the control. Every one of these artifact types is AI narrative
 * that reaches a customer surface: `ic_memo` and `risk_brief` are both drawn
 * into the LP-facing tear-sheet PDF (dealTearSheet.fetchAiSynthesis prefers the
 * memo and falls back to the brief), and `deal_analysis` renders in the
 * workspace. Yet only some generators sanitised: dealQa, export.insights,
 * exportNarrative and dealBriefing called sanitizeAiProse, while icMemo applied
 * the stance-verb neutraliser alone and inconsistencyDetector persisted raw
 * model markdown. Guarding per-generator means every NEW generator is
 * unguarded until someone remembers; guarding the door means it cannot be.
 *
 * What that miss cost, in production, in 2026-08: IC memos telling an
 * investment committee "All required approvals have been received" for deals
 * whose records held ZERO approval rows. The model read an empty list as
 * all-clear (see the DD/approval instructions in icMemo's prompt) and nothing
 * downstream disagreed.
 *
 * Applied on READ as well as write. Ten artifacts were persisted before this
 * guard existed and the tear sheet still draws them; sanitising at the point of
 * use covers that history without rewriting stored rows — the artifact table is
 * a cache of what the model actually said, and silently editing it would
 * destroy the record of the drift. sanitizeAiProse is idempotent (the redaction
 * marker asserts nothing), so double application is safe by construction.
 */
const guardArtifactProse = (contentMd, { artifactType, dealId, phase }) => {
  if (typeof contentMd !== 'string' || contentMd.length === 0) return contentMd;
  const result = sanitizeAiProse(contentMd);
  if (result.flagged) {
    // Codes and counts only — never the offending prose. It is deal content.
    log.warn('ai_artifact_prose_guarded', {
      artifactType,
      dealId: dealId || null,
      phase,
      legalRemoved: result.legalRemoved,
      legalLanes: result.legalLanes,
      stanceRewritten: result.stanceRewritten,
    });
  }
  return result.text;
};

// Stable canonical-JSON hash for an arbitrary payload. Used as the
// `snapshot_hash` cache key. Sorts keys recursively so two semantically
// equivalent payloads with different key order produce identical hashes.
const canonicalStringify = (value) => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
};

const computeSnapshotHash = (payload) => {
  if (payload === null || payload === undefined) return null;
  return crypto.createHash('sha256').update(canonicalStringify(payload)).digest('hex');
};

const isMissingTableError = (err) => {
  const code = err?.code || err?.original?.code;
  // Postgres "undefined_table" SQLSTATE
  if (code === '42P01') return true;
  const msg = String(err?.message || '');
  return /relation .* does not exist/i.test(msg);
};

// Postgres "undefined_column" SQLSTATE (42703). Hit when a deploy goes
// out before the corresponding migration has been applied — saveArtifact
// references columns the live DB doesn't have yet. Treated like a
// missing-table error: log and no-op rather than blowing up the caller.
const isMissingColumnError = (err) => {
  const code = err?.code || err?.original?.code;
  if (code === '42703') return true;
  const msg = String(err?.message || '');
  return /column .* does not exist/i.test(msg);
};

// SELECT the most recent artifact matching (deal_id, artifact_type). If
// `snapshotHash` is provided, only return a row with that exact hash —
// anything else is a "stale" miss from the caller's POV. If snapshotHash is
// omitted, return whatever's most recent regardless of inputs (used by the
// "show me whatever was last generated" UI surface).
const getLatestArtifact = async ({ dealId, artifactType, snapshotHash = null }) => {
  if (!dealId || !SUPPORTED_ARTIFACT_TYPES.has(artifactType)) return null;
  try {
    const sql = snapshotHash
      ? `SELECT id, deal_id, artifact_type, content_md, content_jsonb,
                snapshot_hash, generated_by_call_id, status,
                generated_at, approved_by, approved_at,
                numerical_drifts, verified_at
           FROM public.ai_artifacts
          WHERE deal_id = $1
            AND artifact_type = $2
            AND snapshot_hash = $3
          ORDER BY generated_at DESC
          LIMIT 1`
      : `SELECT id, deal_id, artifact_type, content_md, content_jsonb,
                snapshot_hash, generated_by_call_id, status,
                generated_at, approved_by, approved_at,
                numerical_drifts, verified_at
           FROM public.ai_artifacts
          WHERE deal_id = $1
            AND artifact_type = $2
          ORDER BY generated_at DESC
          LIMIT 1`;
    const params = snapshotHash ? [dealId, artifactType, snapshotHash] : [dealId, artifactType];
    const result = await query(sql, params);
    const row = result.rows[0] || null;
    if (!row) return null;
    // Re-guard on the way out: rows written before the guard reached this door
    // are still served to the workspace and drawn into the tear-sheet PDF.
    return { ...row, content_md: guardArtifactProse(row.content_md, { artifactType, dealId, phase: 'read' }) };
  } catch (err) {
    if (isMissingTableError(err) || isMissingColumnError(err)) {
      // Pre-migration deploy — either the table itself is missing or
      // the numerical_drifts / verified_at columns haven't been
      // applied yet. Feature degrades to "always regenerate". Logged
      // at info level so the operator sees a clear signal in Vercel
      // logs that a migration needs to be applied.
      log.info('ai_artifacts_lookup_skipped_schema_drift', {
        deal_id: dealId,
        artifact_type: artifactType,
        error: err.message,
      });
      return null;
    }
    log.warn('ai_artifacts_lookup_failed', { error: err.message, deal_id: dealId });
    return null;
  }
};

// Persist a generated artifact. Returns the new row's id, or null on any
// failure. Persistence failures NEVER bubble — the generator path must keep
// working even if the cache table is unavailable.
const saveArtifact = async ({
  organizationId,
  dealId,
  artifactType,
  contentMd,
  contentJsonb = null,
  snapshotHash = null,
  generatedByCallId = null,
  status = 'draft',
  // Tier-1 #3 — post-hoc numerical verifier output. Pass an array
  // (possibly empty) to record that verification ran. Pass null /
  // undefined to indicate the verifier has not run yet.
  numericalDrifts = undefined,
  verifiedAt = undefined,
}) => {
  if (!organizationId || !SUPPORTED_ARTIFACT_TYPES.has(artifactType) || !contentMd) return null;
  const guardedMd = guardArtifactProse(contentMd, { artifactType, dealId, phase: 'write' });
  try {
    const result = await query(
      `INSERT INTO public.ai_artifacts (
         organization_id, deal_id, artifact_type, content_md, content_jsonb,
         snapshot_hash, generated_by_call_id, status,
         numerical_drifts, verified_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
       RETURNING id, generated_at, numerical_drifts, verified_at`,
      [
        organizationId,
        dealId || null,
        artifactType,
        guardedMd,
        contentJsonb ? JSON.stringify(contentJsonb) : null,
        snapshotHash,
        generatedByCallId,
        status,
        numericalDrifts === undefined ? null : JSON.stringify(numericalDrifts),
        verifiedAt || null,
      ],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTableError(err) || isMissingColumnError(err)) {
      // Either the table itself is missing (pre-#180) or the
      // numerical_drifts / verified_at columns haven't been applied
      // yet (pre-#190). Persistence is best-effort — the live
      // narrative still reaches the user even if cache writes fail.
      log.info('ai_artifacts_save_skipped_schema_drift', {
        deal_id: dealId,
        artifact_type: artifactType,
        error: err.message,
      });
      return null;
    }
    log.warn('ai_artifacts_save_failed', { error: err.message, deal_id: dealId });
    return null;
  }
};

module.exports = {
  computeSnapshotHash,
  canonicalStringify,
  getLatestArtifact,
  saveArtifact,
  SUPPORTED_ARTIFACT_TYPES,
  // Exported for unit tests
  isMissingTableError,
};
