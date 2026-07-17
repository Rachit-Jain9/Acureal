'use strict';

/**
 * Server-side cache for the DETERMINISTIC (lite) deal-workspace payload.
 *
 * See database/migrations/20260629_deal_workspace_cache.sql for the full
 * correctness model. In short:
 *
 *   • The cache is checked only AFTER getDealWorkspace has authorised the caller
 *     (getDealById runs first), so a cache hit can never bypass visibility.
 *   • A cheap `version_key` — count(*) + max(updated_at) across every per-deal
 *     input table + the deal row — is recomputed on every read. Any per-deal
 *     edit changes the key → cache miss → recompute. So an edit is ALWAYS
 *     reflected immediately; the cache can only serve a payload whose
 *     deterministic inputs are current.
 *   • A short TTL bounds staleness from the two non-per-deal inputs (verified
 *     comps + per-org team-feedback ranking), neither of which is a legal/title/
 *     RERA conclusion.
 *
 * Every function is fault-tolerant: any error (most importantly the table being
 * absent before the migration is applied) resolves to a cache miss, so the
 * caller simply recomputes — identical to the pre-cache behaviour.
 */

const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const log = require('../lib/logger').child({ module: 'dealWorkspaceCache' });

// Per-deal tables that (a) feed the deterministic workspace payload and (b)
// carry an `updated_at` we can fingerprint. count(*) catches inserts/deletes;
// max(updated_at) catches edits (each of these has an updated_at trigger).
// Source: information_schema audit on project niamgjbxxgmmffggumvj, 2026-06-04.
// Global inputs (verified comps, per-org team feedback) are intentionally NOT
// here — they are not per-deal and are bounded by the TTL instead.
const VERSIONED_DEAL_TABLES = Object.freeze([
  'financials',
  'financial_scenarios',
  'waterfall_distributions',
  'dd_items',
  'risk_flags',
  'approval_items',
  'documents',
  'document_extractions',
  'deal_promoter_profiles',
  'deal_recommendation_verdicts',
  // Deal Registers parent only — every record mutation recomputes the parent
  // summary in the same transaction, bumping deal_registers.updated_at, so
  // the parent row alone fingerprints all six record tables. (Until the
  // 20260726 migration is applied, the missing table makes computeVersionKey
  // return null → cache bypassed, workspace still correct.)
  'deal_registers',
]);

const DEFAULT_TTL_MS = 120_000; // 2 minutes

function isEnabled() {
  // Default ON. The operator can disable without a code revert by setting
  // DEAL_WORKSPACE_CACHE_ENABLED=false (mirrors RECOMMENDATION_NARRATOR_ENABLED).
  return process.env.DEAL_WORKSPACE_CACHE_ENABLED !== 'false';
}

function ttlMs() {
  const v = Number(process.env.DEAL_WORKSPACE_CACHE_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_MS;
}

/**
 * Cheap freshness fingerprint of every per-deal input table + the deal row.
 * Strictly cheaper than the full assembly: indexed count/max aggregates in a
 * single round-trip. Returns null on any error (→ caller cannot validate cache
 * → recompute). The table list is a hard-coded allowlist, never user input.
 */
async function computeVersionKey(dealId) {
  if (!isEnabled() || !dealId) return null;
  try {
    const parts = VERSIONED_DEAL_TABLES.map(
      (t) =>
        `(SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '-') FROM ${t} WHERE deal_id = $1)`,
    );
    parts.push(`(SELECT coalesce(updated_at::text, '-') FROM deals WHERE id = $1)`);
    const sql = `SELECT concat_ws('|', ${parts.join(', ')}) AS vk`;
    const res = await query(sql, [dealId]);
    const raw = res && res.rows && res.rows[0] ? res.rows[0].vk : null;
    if (!raw) return null;
    // Hash to keep the stored key compact + opaque.
    return crypto.createHash('sha1').update(raw).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Returns the cached deterministic payload for (deal_id, current org) when it
 * exists, its version_key matches, and it is within the TTL. RLS scopes the row
 * to the caller's org automatically. Any error → null (cache miss).
 */
async function read(dealId, versionKey) {
  if (!isEnabled() || !dealId || !versionKey) return null;
  try {
    const res = await query(
      `SELECT payload, computed_at
         FROM deal_workspace_cache
        WHERE deal_id = $1 AND version_key = $2`,
      [dealId, versionKey],
    );
    const row = res && res.rows && res.rows[0] ? res.rows[0] : null;
    if (!row) return null;
    const ageMs = Date.now() - new Date(row.computed_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > ttlMs()) return null; // TTL backstop
    return row.payload;
  } catch {
    return null; // table absent / any error → recompute
  }
}

// The cache write is OPTIONAL work. It must never queue behind a lock: if the
// row is busy, the right answer is to skip this write and let the next reader
// recompute — not to wait. These bound the write's transaction so it fails
// fast instead of burning the caller's request time.
//
// Sizing: production `statement_timeout` is 2 MINUTES and the largest observed
// payload is 239 KB (125 KB avg), which inserts in single-digit milliseconds.
// A 2-minute timeout on this INSERT was therefore never about payload size —
// it could only ever be lock wait. 500 ms is ~50× the honest write cost.
const WRITE_LOCK_TIMEOUT_MS = 500;
const WRITE_STATEMENT_TIMEOUT_MS = 3000;

/**
 * Upserts the deterministic payload for (deal_id, current org). organization_id
 * is filled by the DB from current_organization_id() so it always matches the
 * RLS context.
 *
 * Errors are swallowed — a failed cache write must never affect the response.
 * But the CALL IS AWAITED by the caller (see dealWorkspace.service): on Vercel
 * an un-awaited promise is not "backgrounded", it is ORPHANED. The instance
 * freezes the moment the response is sent, and `query()` wraps every statement
 * in BEGIN→…→COMMIT, so a frozen instance strands an open transaction holding
 * this row's ON CONFLICT lock. Because the row is keyed per (deal, ORG) — not
 * per user — every teammate viewing that deal then blocks on it, and their
 * upsert is cancelled by `statement_timeout`. The INSERT named in those
 * production errors was the VICTIM of a previous request's orphaned lock, not
 * the cause. Awaiting guarantees COMMIT/ROLLBACK inside the invocation; the
 * SET LOCALs guarantee we never become the thing that blocks someone else.
 */
async function write(dealId, versionKey, payload) {
  if (!isEnabled() || !dealId || !versionKey || !payload) return;
  try {
    // Routed through transaction() rather than query() so the SET LOCALs land
    // on the SAME connection as the INSERT. SET LOCAL is required (not plain
    // SET): the Supabase pooler runs in transaction mode, so session-level
    // settings would not reliably carry — the same invariant that governs the
    // tenant context in database.js. Deliberately NOT changing the shared
    // query() helper, which every call in the app funnels through.
    await transaction(async (client) => {
      await client.query(`SET LOCAL lock_timeout = '${WRITE_LOCK_TIMEOUT_MS}ms'`);
      await client.query(`SET LOCAL statement_timeout = '${WRITE_STATEMENT_TIMEOUT_MS}ms'`);
      await client.query(
        `INSERT INTO deal_workspace_cache (deal_id, organization_id, version_key, payload, computed_at)
         VALUES ($1, current_organization_id(), $2, $3::jsonb, NOW())
         ON CONFLICT (deal_id, organization_id)
         DO UPDATE SET version_key = EXCLUDED.version_key,
                       payload     = EXCLUDED.payload,
                       computed_at = EXCLUDED.computed_at`,
        [dealId, versionKey, JSON.stringify(payload)],
      );
    });
  } catch (err) {
    // Swallowed by design, but logged with a distinguishable code: before this,
    // every cache failure was indistinguishable from "table not migrated yet"
    // and surfaced only as a raw console.error from the db layer.
    log.warn('deal_workspace_cache_write_skipped', {
      deal_id: dealId,
      reason: err?.code === '55P03' ? 'row_locked_by_another_request' : (err?.message || 'unknown'),
      pg_code: err?.code || null,
    });
  }
}

module.exports = {
  computeVersionKey,
  read,
  write,
  VERSIONED_DEAL_TABLES,
  DEFAULT_TTL_MS,
};
