'use strict';

/**
 * Recommendation Engine — persistence layer (append-only audit log).
 *
 * Writes one row to `deal_recommendation_runs` per (deal, snapshot_hash)
 * pair. The unique constraint on (deal_id, snapshot_hash) makes repeat calls
 * against the same snapshot no-ops — the persistence layer NEVER mutates an
 * existing row; that's enforced at the RLS layer too.
 *
 * Migration-tolerant: if the table doesn't exist yet (pre-deploy, the
 * migration hasn't been applied), the recordRun() call swallows the error
 * and logs a warning. The recommendation engine still works without
 * persistence — the audit trail just doesn't fill in until the operator
 * applies the migration.
 */

const { query } = require('../../config/database');
const log = require('../../lib/logger').child({ module: 'recommendation.persistence' });
const { getRequestContext } = require('../../lib/requestContext');

const PG_UNDEFINED_TABLE = '42P01';
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Append one recommendation-engine run.
 *
 * @returns {Promise<{ id: string|null, deduped: boolean }>}
 *   - id:      the inserted row's id, or null when the table is missing
 *   - deduped: true when the (deal, snapshot_hash) already had a row
 */
const recordRun = async ({
  dealId,
  snapshotHash,
  signalCount,
  recommendations,
  signals,
  narratorStatus = 'skipped',
  narratorMeta = null,
  latencyMs = null,
}) => {
  if (!dealId || !snapshotHash) return { id: null, deduped: false };

  const ctx = getRequestContext();
  const organizationId = ctx?.organizationId || null;
  const userId = ctx?.userId || null;

  try {
    const result = await query(
      `INSERT INTO deal_recommendation_runs
         (organization_id, deal_id, snapshot_hash, signal_count,
          recommendations, signals, narrator_status, narrator_meta,
          latency_ms, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10)
       ON CONFLICT (deal_id, snapshot_hash) DO NOTHING
       RETURNING id`,
      [
        organizationId,
        dealId,
        snapshotHash,
        signalCount,
        JSON.stringify(recommendations || []),
        JSON.stringify(signals || []),
        narratorStatus,
        narratorMeta ? JSON.stringify(narratorMeta) : null,
        latencyMs,
        userId,
      ],
    );
    if (result.rows.length === 0) return { id: null, deduped: true };
    return { id: result.rows[0].id, deduped: false };
  } catch (err) {
    if (err && (err.code === PG_UNDEFINED_TABLE || err.code === PG_UNIQUE_VIOLATION)) {
      // Either the migration hasn't been applied yet, or a concurrent run
      // raced to insert the same snapshot. Both are non-fatal — the engine
      // still returns recommendations to the user.
      if (err.code === PG_UNDEFINED_TABLE) {
        log.warn('deal_recommendation_runs_missing_table', { deal_id: dealId });
      }
      return { id: null, deduped: err.code === PG_UNIQUE_VIOLATION };
    }
    log.warn('recommendation_run_persist_failed', { error: err.message, deal_id: dealId });
    return { id: null, deduped: false };
  }
};

/**
 * Get the most recent run for a deal (by created_at). Used by the workspace
 * read-model to return the persisted recommendation set without re-evaluating
 * — useful when the workspace payload is cached.
 */
const getLatestRun = async (dealId) => {
  if (!dealId) return null;
  try {
    const result = await query(
      `SELECT id, snapshot_hash, signal_count, recommendations, signals,
              narrator_status, narrator_meta, latency_ms, created_at
         FROM deal_recommendation_runs
        WHERE deal_id = $1
          AND organization_id = current_organization_id()
        ORDER BY created_at DESC
        LIMIT 1`,
      [dealId],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err && err.code === PG_UNDEFINED_TABLE) return null;
    log.warn('recommendation_run_read_failed', { error: err.message, deal_id: dealId });
    return null;
  }
};

module.exports = {
  recordRun,
  getLatestRun,
};
