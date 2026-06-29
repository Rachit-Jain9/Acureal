/**
 * Deal Audit Log service — append-only mutation log for deal lifecycle.
 *
 * Sibling to `audit.service.js` (financial computations on `deal_events`).
 * Where that table is HMAC-signed and replay-verifiable, this one is
 * unsigned: it answers "what changed on this deal, when, by whom" for
 * stage transitions, archive / restore, reassignments, deletions, and
 * bulk operations.
 *
 * Design rules (per CLAUDE.md):
 *
 *   1. **Fail-open**. `recordAudit()` swallows DB errors and returns
 *      null after a console.warn. An audit failure must NEVER roll
 *      back the underlying mutation. The financial events table is the
 *      cryptographic record — this one is the human-readable timeline.
 *
 *   2. **Idempotent migration**. The matching migration uses
 *      `CREATE TABLE IF NOT EXISTS` + `DROP POLICY IF EXISTS`, so this
 *      service can land before the table is applied; calls just no-op
 *      until the operator runs the migration. We detect the missing
 *      table via Postgres error code 42P01 and downgrade to a single
 *      one-time warning rather than spamming logs.
 *
 *   3. **Append-only via RLS**. No update / delete API. The DB enforces
 *      it; the service exposes only `recordAudit` + reads.
 */

'use strict';

const { query } = require('../config/database');

// Known event types. Free-form at the DB layer (VARCHAR), enforced here
// so the AuditTab UI can reliably map to a label / tone without a
// runaway list of one-off strings.
const SUPPORTED_EVENT_TYPES = new Set([
  // Single-deal lifecycle
  'stage_changed',
  'archived',
  'restored',
  'deleted',
  'reassigned',
  'updated',
  // Bulk wrappers — one row per affected deal so the deal-level
  // timeline still tells the analyst what happened to THIS deal.
  // metadata.bulk_id ties them together for "show me everything
  // that moved in this batch" cross-deal queries.
  'bulk_archived',
  'bulk_reassigned',
  'bulk_stage_changed',
  'bulk_deleted',
  // Deal child-entity mutations (audit-trail completeness — soft-delete + audit).
  // One row per create / update / soft-delete so the Audit tab shows the full
  // lifecycle of a deal's risk flags, approvals, DD items, and documents.
  'risk_flag_created', 'risk_flag_updated', 'risk_flag_deleted',
  'approval_created', 'approval_updated', 'approval_deleted',
  'dd_item_created', 'dd_item_updated', 'dd_item_deleted',
  'document_deleted', 'document_purged',
  // Yield Studio — saved study + uploaded parcel boundary (one row per save /
  // delete / upload so the Audit tab shows the lifecycle of a deal's site study).
  'yield_study_saved', 'yield_study_deleted',
  'parcel_boundary_uploaded', 'parcel_boundary_deleted',
]);

// Postgres error codes we treat as "feature gracefully unavailable"
// rather than hard errors. 42P01 = undefined_table (migration not yet
// applied). 42703 = undefined_column (would mean a future schema drift
// we want to log but not block on).
const SOFT_ERROR_CODES = new Set(['42P01', '42703']);

let warnedAboutMissingTable = false;
const warnSoft = (err, context) => {
  if (err?.code === '42P01' && warnedAboutMissingTable) return;
  if (err?.code === '42P01') warnedAboutMissingTable = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[dealAuditLog.service] ${context}: ${err.message || err} ` +
    `(code=${err.code || 'unknown'}). Audit row not written; mutation continues.`,
  );
};

/**
 * Persist a mutation audit row. Fail-open: never throws, returns the
 * inserted row on success, null on failure (including the migration-not-
 * applied case).
 *
 * Required:
 *   - dealId        UUID of the deal that was mutated
 *   - eventType     one of SUPPORTED_EVENT_TYPES
 *
 * Optional:
 *   - actorId       UUID of the user who did it (null = system)
 *   - before        object captured BEFORE the mutation
 *   - after         object captured AFTER the mutation
 *   - metadata      free-form supplemental context (bulk_id, reason, etc.)
 */
const recordAudit = async ({
  dealId,
  eventType,
  actorId = null,
  before = {},
  after = {},
  metadata = {},
} = {}) => {
  if (!dealId) {
    // eslint-disable-next-line no-console
    console.warn('[dealAuditLog.service] recordAudit: dealId is required; skipping');
    return null;
  }
  if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[dealAuditLog.service] recordAudit: unsupported eventType "${eventType}"; skipping`,
    );
    return null;
  }

  try {
    const result = await query(
      `INSERT INTO deal_audit_log (
         deal_id, organization_id, actor_id,
         event_type,
         before_json, after_json, metadata
       ) VALUES (
         $1,
         (SELECT organization_id FROM deals WHERE id = $1),
         $2,
         $3,
         $4, $5, $6
       )
       RETURNING id, deal_id, organization_id, actor_id, event_type,
                 before_json, after_json, metadata, created_at`,
      [
        dealId,
        actorId,
        eventType,
        JSON.stringify(before || {}),
        JSON.stringify(after || {}),
        JSON.stringify(metadata || {}),
      ],
    );
    // Defensive: a partial mock or oddly-shaped DB driver could return
    // undefined / no rows. The audit row is best-effort, so missing
    // RETURNING data isn't worth a warn — just hand back null.
    return result?.rows?.[0] ?? null;
  } catch (err) {
    if (err && SOFT_ERROR_CODES.has(err.code)) {
      warnSoft(err, `recordAudit(${eventType})`);
      return null;
    }
    // Any other DB error: log + return null. A mutation must never be
    // blocked because the audit insert blew up. Silent data loss is
    // bad, but a stuck UI is worse — and the underlying mutation
    // already succeeded by the time this is called.
    // eslint-disable-next-line no-console
    console.warn(
      `[dealAuditLog.service] recordAudit(${eventType}) failed: ${err.message || err}`,
    );
    return null;
  }
};

/**
 * List the mutation audit rows for a deal, newest first. The caller is
 * responsible for the deal-visibility check; this service just reads
 * `deal_audit_log` directly. The financial.service `listDealEvents`
 * already gates on `getFinancials(dealId)` so callers go through that.
 */
const listForDeal = async (dealId, { limit = 50 } = {}) => {
  const clampedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  try {
    const result = await query(
      `SELECT id, deal_id, organization_id, actor_id,
              event_type, before_json, after_json, metadata, created_at
         FROM deal_audit_log
        WHERE deal_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [dealId, clampedLimit],
    );
    return result.rows;
  } catch (err) {
    if (err && SOFT_ERROR_CODES.has(err.code)) {
      warnSoft(err, 'listForDeal');
      return [];
    }
    throw err;
  }
};

module.exports = {
  recordAudit,
  listForDeal,
  SUPPORTED_EVENT_TYPES,
};
