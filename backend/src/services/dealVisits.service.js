'use strict';

/**
 * Deal visit watermarks — "what changed since you last looked".
 *
 * Every activity surface in the product measures from FIXED windows (risk
 * created in the last 7 days, deals stale for 14). None of them know what
 * THIS user has already seen, so returning after three days looks identical
 * to returning after three minutes — the single biggest reason a daily tool
 * fails to become a habit. One (user, deal) row fixes the primitive.
 *
 * Two deliberate design points, both learned from this codebase's own scars:
 *
 *   1. Visits are recorded by an EXPLICIT route, never inside the workspace
 *      composer. The composer declares "no write path" (its cache write is a
 *      documented production incident), and the dashboard PREFETCHES the lite
 *      workspace on hover — recording there would clear a user's own "what's
 *      new" the moment they moused over the deals list.
 *
 *   2. The answer is measured against the PREVIOUS visit, not the current
 *      one. The current visit is stamped the instant the page opens; by the
 *      time anything queries "since last_visited_at", the honest answer would
 *      always be "nothing". Rapid re-opens inside 30 minutes are one reading
 *      session — they refresh the timestamp without rotating the watermark,
 *      so tab-hopping cannot eat your own news.
 *
 * Migration-tolerant: every entry point degrades to null/empty until the
 * 20260801_deal_user_visits migration is applied (Postgres 42P01), so this
 * ships ahead of the operator's migration run.
 */

const { query } = require('../config/database');
const { getRequestContext } = require('../lib/requestContext');
const log = require('../lib/logger').child({ module: 'deal_visits' });

// Re-opens within this window are the same sitting; the watermark holds.
const SESSION_GAP_MINUTES = 30;

const isMissingTable = (err) => err?.code === '42P01';

/**
 * Record a visit and return the watermark to measure novelty against.
 * @returns {Promise<{ since: string|null, first_visit: boolean }|null>}
 *          null = table not migrated yet (feature dark, not broken).
 */
const recordVisit = async (dealId) => {
  const { userId, organizationId } = getRequestContext();
  if (!userId || !organizationId || !dealId) return null;
  try {
    const result = await query(
      `INSERT INTO public.deal_user_visits (user_id, deal_id, organization_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, deal_id) DO UPDATE SET
         previous_visited_at = CASE
           WHEN public.deal_user_visits.last_visited_at
                < NOW() - make_interval(mins => $4)
             THEN public.deal_user_visits.last_visited_at
           ELSE public.deal_user_visits.previous_visited_at
         END,
         last_visited_at = NOW(),
         visit_count = public.deal_user_visits.visit_count + 1
       RETURNING previous_visited_at`,
      [userId, dealId, organizationId, SESSION_GAP_MINUTES],
    );
    const previous = result.rows[0]?.previous_visited_at || null;
    return { since: previous, first_visit: previous === null };
  } catch (err) {
    if (isMissingTable(err)) return null;
    // A failed watermark must never fail a deal open.
    log.warn('deal_visit_record_failed', { deal_id: dealId, error: err.message });
    return null;
  }
};

/**
 * Deterministic per-slice change counts since `since`, in ONE round-trip.
 * The slice list mirrors the workspace cache's VERSIONED_DEAL_TABLES —
 * the repo's verified answer to "what can change on a deal" — restricted to
 * slices a user experiences as news. Counts only; no AI, no ranking.
 */
const getChangesSince = async (dealId, since) => {
  if (!dealId || !since) return null;
  try {
    const result = await query(
      `SELECT
         (SELECT count(*) FROM public.documents d
           WHERE d.deal_id = $1 AND d.deleted_at IS NULL AND d.created_at > $2) AS documents_added,
         (SELECT count(*) FROM public.document_extractions de
           WHERE de.deal_id = $1 AND de.extraction_status IN ('completed','partial')
             AND de.updated_at > $2) AS extractions_completed,
         (SELECT count(*) FROM public.risk_flags rf
           WHERE rf.deal_id = $1 AND rf.created_at > $2) AS risks_added,
         (SELECT count(*) FROM public.risk_flags rf
           WHERE rf.deal_id = $1 AND rf.updated_at > $2 AND rf.created_at <= $2) AS risks_updated,
         (SELECT count(*) FROM public.dd_items dd
           WHERE dd.deal_id = $1 AND dd.updated_at > $2) AS dd_updated,
         (SELECT count(*) FROM public.approval_items ap
           WHERE ap.deal_id = $1 AND ap.updated_at > $2) AS approvals_updated,
         (SELECT count(*) FROM public.financials f
           WHERE f.deal_id = $1 AND f.updated_at > $2) AS financials_updated,
         (SELECT count(*) FROM public.activities a
           WHERE a.deal_id = $1 AND a.created_at > $2) AS activities_added`,
      [dealId, since],
    );
    const row = result.rows[0] || {};
    const changes = {
      documents_added: Number(row.documents_added) || 0,
      extractions_completed: Number(row.extractions_completed) || 0,
      risks_added: Number(row.risks_added) || 0,
      risks_updated: Number(row.risks_updated) || 0,
      dd_updated: Number(row.dd_updated) || 0,
      approvals_updated: Number(row.approvals_updated) || 0,
      financials_updated: Number(row.financials_updated) || 0,
      activities_added: Number(row.activities_added) || 0,
    };
    const total = Object.values(changes).reduce((s, n) => s + n, 0);
    return { since, total, changes };
  } catch (err) {
    if (isMissingTable(err)) return null;
    log.warn('deal_changes_since_failed', { deal_id: dealId, error: err.message });
    return null;
  }
};

module.exports = { recordVisit, getChangesSince, SESSION_GAP_MINUTES };
