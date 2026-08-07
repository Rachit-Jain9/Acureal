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
const { LIVE_DEAL_STAGES } = require('../constants/domain');
const log = require('../lib/logger').child({ module: 'deal_visits' });

// Re-opens within this window are the same sitting; the watermark holds.
const SESSION_GAP_MINUTES = 30;

// Portfolio strip caps. Five rows is a glance; more is a list to work through,
// which is what the four signal sections below it already are.
const PORTFOLIO_ROW_LIMIT = 5;

const isMissingTable = (err) => err?.code === '42P01';

/**
 * ONE definition of "what counts as news on a deal".
 *
 * Two callers need these predicates against different anchors: the per-deal
 * banner measures one deal against a bound parameter, while the portfolio
 * rollup measures every watched deal against its own watermark column. Writing
 * the eight subqueries twice is how the two surfaces drift, and a portfolio
 * strip that disagrees with the banner on the same deal is worse than no strip
 * — the user cannot tell which one is lying.
 *
 * So each slice is a function of (dealExpr, sinceExpr) returning SQL. Both
 * expressions are code-controlled literals — a bound placeholder like `$1` or a
 * column reference like `v.last_visited_at` — never user input, so there is no
 * injection surface here.
 *
 * The slice list mirrors the workspace cache's VERSIONED_DEAL_TABLES — the
 * repo's verified answer to "what can change on a deal" — restricted to slices
 * a user experiences as news. Counts only; no AI, no ranking.
 */
const CHANGE_SLICES = Object.freeze([
  { key: 'documents_added', sql: (deal, since) => `(SELECT count(*) FROM public.documents d WHERE d.deal_id = ${deal} AND d.deleted_at IS NULL AND d.created_at > ${since})` },
  { key: 'extractions_completed', sql: (deal, since) => `(SELECT count(*) FROM public.document_extractions de WHERE de.deal_id = ${deal} AND de.extraction_status IN ('completed','partial') AND de.updated_at > ${since})` },
  { key: 'risks_added', sql: (deal, since) => `(SELECT count(*) FROM public.risk_flags rf WHERE rf.deal_id = ${deal} AND rf.created_at > ${since})` },
  { key: 'risks_updated', sql: (deal, since) => `(SELECT count(*) FROM public.risk_flags rf WHERE rf.deal_id = ${deal} AND rf.updated_at > ${since} AND rf.created_at <= ${since})` },
  { key: 'dd_updated', sql: (deal, since) => `(SELECT count(*) FROM public.dd_items dd WHERE dd.deal_id = ${deal} AND dd.updated_at > ${since})` },
  { key: 'approvals_updated', sql: (deal, since) => `(SELECT count(*) FROM public.approval_items ap WHERE ap.deal_id = ${deal} AND ap.updated_at > ${since})` },
  { key: 'financials_updated', sql: (deal, since) => `(SELECT count(*) FROM public.financials f WHERE f.deal_id = ${deal} AND f.updated_at > ${since})` },
  { key: 'activities_added', sql: (deal, since) => `(SELECT count(*) FROM public.activities a WHERE a.deal_id = ${deal} AND a.created_at > ${since})` },
]);

const sliceSelectList = (deal, since) =>
  CHANGE_SLICES.map((s) => `${s.sql(deal, since)} AS ${s.key}`).join(',\n         ');

// Coerce the eight counts off a row, and total them. Postgres count() returns
// bigint, which node-postgres hands back as a string.
const readSlices = (row = {}) => {
  const changes = {};
  for (const slice of CHANGE_SLICES) changes[slice.key] = Number(row[slice.key]) || 0;
  return { changes, total: Object.values(changes).reduce((s, n) => s + n, 0) };
};

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
 * Deterministic per-slice change counts for ONE deal since `since`, in one
 * round-trip. Anchored to a bound parameter because the caller has already
 * stamped a visit and is measuring against the ROTATED watermark.
 */
const getChangesSince = async (dealId, since) => {
  if (!dealId || !since) return null;
  try {
    const result = await query(
      `SELECT ${sliceSelectList('$1', '$2')}`,
      [dealId, since],
    );
    const { changes, total } = readSlices(result.rows[0] || {});
    return { since, total, changes };
  } catch (err) {
    if (isMissingTable(err)) return null;
    log.warn('deal_changes_since_failed', { deal_id: dealId, error: err.message });
    return null;
  }
};

/**
 * The portfolio answer to the same question: which of MY deals moved since I
 * last opened them.
 *
 * Anchored to `last_visited_at`, NOT the rotated `previous_visited_at` the
 * per-deal banner uses. The distinction is the whole correctness argument:
 * opening a deal stamps a visit, so the banner must look one watermark back or
 * it would always report nothing. Nothing stamps a visit at portfolio level —
 * the dashboard is not a deal — so the last recorded look IS the honest
 * baseline, and a deal stops appearing here precisely because you opened it.
 * The loop closes itself.
 *
 * Deals never opened are excluded from the rows — "since you looked" is
 * undefined when you never did — and surfaced only as a count, so a new user
 * gets an accurate "9 not yet opened" rather than nine rows of noise.
 *
 * One statement, portfolio-sized (tens of deals), no N+1. Uses
 * `deal_user_visits_user_org_idx`, which was created for this read.
 */
const getPortfolioChangesSinceVisit = async () => {
  const { userId, organizationId } = getRequestContext();
  if (!userId || !organizationId) return null;
  try {
    const result = await query(
      `WITH moved AS (
         SELECT v.deal_id, d.name, d.stage, v.last_visited_at,
                ${sliceSelectList('v.deal_id', 'v.last_visited_at')}
           FROM public.deal_user_visits v
           JOIN public.deals d ON d.id = v.deal_id
          WHERE v.user_id = $1
            AND v.organization_id = $2
            AND d.is_archived = FALSE
            AND d.stage = ANY($3::deal_stage[])
       ), ranked AS (
         SELECT *, (${CHANGE_SLICES.map((s) => s.key).join(' + ')}) AS total
           FROM moved
       )
       SELECT
         (SELECT count(*)::int
            FROM public.deals d2
           WHERE d2.organization_id = $2
             AND d2.is_archived = FALSE
             AND d2.stage = ANY($3::deal_stage[])
             AND NOT EXISTS (
               SELECT 1 FROM public.deal_user_visits v2
                WHERE v2.deal_id = d2.id AND v2.user_id = $1)) AS never_opened,
         COALESCE((
           SELECT json_agg(row_to_json(r))
             FROM (SELECT * FROM ranked
                    WHERE total > 0
                    -- Risk arrivals outrank volume: one new risk matters more
                    -- than six activity lines. Then most-changed, then the deal
                    -- you have neglected longest.
                    ORDER BY risks_added DESC, total DESC, last_visited_at ASC
                    LIMIT ${PORTFOLIO_ROW_LIMIT}) r), '[]'::json) AS rows`,
      [userId, organizationId, LIVE_DEAL_STAGES],
    );
    const row = result.rows[0] || {};
    const deals = (row.rows || []).map((r) => {
      const { changes, total } = readSlices(r);
      return {
        deal_id: r.deal_id,
        name: r.name,
        stage: r.stage,
        last_visited_at: r.last_visited_at,
        total,
        changes,
      };
    });
    return {
      deals,
      moved_count: deals.length,
      never_opened: Number(row.never_opened) || 0,
    };
  } catch (err) {
    if (isMissingTable(err)) return null;
    // Degrade to null, never an empty strip: an empty strip reads as "nothing
    // moved", which is a claim we cannot make if the query failed.
    log.warn('portfolio_changes_since_visit_failed', { error: err.message, code: err?.code || null });
    return null;
  }
};

module.exports = {
  recordVisit,
  getChangesSince,
  getPortfolioChangesSinceVisit,
  SESSION_GAP_MINUTES,
  PORTFOLIO_ROW_LIMIT,
  CHANGE_SLICES,
};
