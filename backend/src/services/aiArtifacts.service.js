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
const log = require('../lib/logger').child({ module: 'ai.artifacts' });

const SUPPORTED_ARTIFACT_TYPES = new Set([
  'deal_analysis',
  'ic_memo',
  'risk_brief',
  'parcel_narrative',
]);

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
                generated_at, approved_by, approved_at
           FROM public.ai_artifacts
          WHERE deal_id = $1
            AND artifact_type = $2
            AND snapshot_hash = $3
          ORDER BY generated_at DESC
          LIMIT 1`
      : `SELECT id, deal_id, artifact_type, content_md, content_jsonb,
                snapshot_hash, generated_by_call_id, status,
                generated_at, approved_by, approved_at
           FROM public.ai_artifacts
          WHERE deal_id = $1
            AND artifact_type = $2
          ORDER BY generated_at DESC
          LIMIT 1`;
    const params = snapshotHash ? [dealId, artifactType, snapshotHash] : [dealId, artifactType];
    const result = await query(sql, params);
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) {
      // Pre-migration deploy — feature degrades to "always regenerate".
      // Logged once at info level so the operator sees a clear signal in
      // Vercel logs that the table needs to be created.
      log.info('ai_artifacts_table_missing_fail_open', { deal_id: dealId, artifact_type: artifactType });
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
}) => {
  if (!organizationId || !SUPPORTED_ARTIFACT_TYPES.has(artifactType) || !contentMd) return null;
  try {
    const result = await query(
      `INSERT INTO public.ai_artifacts (
         organization_id, deal_id, artifact_type, content_md, content_jsonb,
         snapshot_hash, generated_by_call_id, status
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING id, generated_at`,
      [
        organizationId,
        dealId || null,
        artifactType,
        contentMd,
        contentJsonb ? JSON.stringify(contentJsonb) : null,
        snapshotHash,
        generatedByCallId,
        status,
      ],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) {
      log.info('ai_artifacts_save_skipped_table_missing', { deal_id: dealId, artifact_type: artifactType });
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
