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
const { query } = require('../config/database');

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

/**
 * Upserts the deterministic payload for (deal_id, current org). organization_id
 * is filled by the DB from current_organization_id() so it always matches the
 * RLS context. Fire-and-forget: a failed write never affects the response.
 */
async function write(dealId, versionKey, payload) {
  if (!isEnabled() || !dealId || !versionKey || !payload) return;
  try {
    await query(
      `INSERT INTO deal_workspace_cache (deal_id, organization_id, version_key, payload, computed_at)
       VALUES ($1, current_organization_id(), $2, $3::jsonb, NOW())
       ON CONFLICT (deal_id, organization_id)
       DO UPDATE SET version_key = EXCLUDED.version_key,
                     payload     = EXCLUDED.payload,
                     computed_at = EXCLUDED.computed_at`,
      [dealId, versionKey, JSON.stringify(payload)],
    );
  } catch {
    // fire-and-forget
  }
}

module.exports = {
  computeVersionKey,
  read,
  write,
  VERSIONED_DEAL_TABLES,
  DEFAULT_TTL_MS,
};
