'use strict';

/**
 * Comp-reliance service — Workstream C1 (the data-network seed).
 *
 * Records which verified comparables an analyst relies on when underwriting a
 * deal. Two outputs from one toggle:
 *
 *   1. Durable operational state in `deal_comp_reliance` — "these are the
 *      comps this deal's underwriting rests on" (presence = relied-on).
 *   2. A values-free `comp_reliance` learning signal appended to
 *      `improvement_signals` via learningSignals.service — the compounding
 *      ground truth a future learned comp-ranker needs.
 *
 * Org-scoped throughout: the table's RLS confines reads/writes to the
 * caller's organisation, and every write first checks the deal + comp belong
 * to that organisation. No AI — pure state capture.
 *
 * Migration-tolerant: until 20260610 is applied, the list degrades to empty
 * (the Comps tab never 500s) and the toggle surfaces a clear 503.
 */

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const learningSignals = require('./learningSignals.service');
const log = require('../lib/logger').child({ module: 'compReliance.service' });

const PG_UNDEFINED_TABLE = '42P01';
const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

/**
 * Return the comp_ids the deal has been marked as relying on. Org-scoped via
 * the table's RLS. Migration-tolerant — an unapplied migration yields [].
 */
const listReliedCompIds = async (dealId) => {
  try {
    const result = await query(
      `SELECT comp_id
         FROM public.deal_comp_reliance
        WHERE deal_id = $1
          AND organization_id = current_organization_id()`,
      [dealId]
    );
    return result.rows.map((r) => r.comp_id);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
};

/**
 * Mark (or unmark) a comp as relied-on for a deal. Idempotent: marking an
 * already-relied comp, or unmarking one that is not, is a no-op on the state
 * table. Every call appends a comp_reliance learning signal regardless.
 *
 * @returns {{ deal_id, comp_id, relied }}
 */
const setReliance = async ({
  dealId,
  compId,
  relied,
  actorId = null,
  similarityScore = null,
  similarityRank = null,
  rateDeltaPct = null,
} = {}) => {
  // The deal must belong to the caller's organisation. The returned
  // organization_id is also what the learning signal is attributed to.
  let dealRow;
  try {
    dealRow = await query(
      `SELECT organization_id FROM public.deals
        WHERE id = $1 AND organization_id = current_organization_id()
        LIMIT 1`,
      [dealId]
    );
  } catch (err) {
    if (isMissingTable(err)) throw createError('Deal not found.', 404);
    throw err;
  }
  if (!dealRow.rows[0]) throw createError('Deal not found.', 404);
  const organizationId = dealRow.rows[0].organization_id;

  // The comp must be visible to the caller's organisation.
  const compRow = await query(
    `SELECT 1 FROM public.comps
      WHERE id = $1 AND organization_id = current_organization_id()
      LIMIT 1`,
    [compId]
  );
  if (!compRow.rows[0]) throw createError('Comparable not found.', 404);

  const wantRelied = relied === true;

  try {
    if (wantRelied) {
      await query(
        `INSERT INTO public.deal_comp_reliance (deal_id, comp_id, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (deal_id, comp_id) DO NOTHING`,
        [dealId, compId, actorId || null]
      );
    } else {
      await query(
        `DELETE FROM public.deal_comp_reliance
          WHERE deal_id = $1 AND comp_id = $2
            AND organization_id = current_organization_id()`,
        [dealId, compId]
      );
    }
  } catch (err) {
    if (isMissingTable(err)) {
      log.error('deal_comp_reliance table missing — apply migration 20260610', err);
      throw createError(
        'Comp reliance tracking is not yet available. Please try again shortly.',
        503
      );
    }
    throw err;
  }

  // Append the learning signal — never throws, never blocks the toggle.
  await learningSignals.recordCompRelianceSignal({
    organizationId,
    dealId,
    compId,
    relied: wantRelied,
    similarityScore,
    similarityRank,
    rateDeltaPct,
    userId: actorId,
  });

  return { deal_id: dealId, comp_id: compId, relied: wantRelied };
};

module.exports = {
  listReliedCompIds,
  setReliance,
};
