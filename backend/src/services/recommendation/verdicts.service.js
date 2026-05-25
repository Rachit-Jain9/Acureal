'use strict';

/**
 * Recommendation verdict store (PR-C).
 *
 * When an operator dismisses, snoozes, or marks-acted-on a recommendation
 * card, the verdict lands here as the durable operational state. The
 * workspace endpoint reads it to hide cards on subsequent loads.
 *
 * Companion writer in `learningSignals.service.recordRecommendationVerdictSignal()`
 * appends the values-free Layer-5 telemetry row so the data flywheel records
 * which rules operators consistently dismiss.
 *
 * Snooze model (mirror of the migration):
 *   • `verdict = 'snoozed'` + `snooze_until` (absolute time) → hidden while
 *     NOW() < snooze_until.
 *   • `verdict = 'snoozed'` + `snooze_until_snapshot_change = true` → hidden
 *     only while the deal's active snapshot_hash matches the one stored at
 *     the moment of snooze. Edit an input → snapshot changes → card re-surfaces.
 *
 * Migration-tolerant: every method swallows `42P01` and returns a safe
 * fallback so the absence of the migration never breaks the workspace.
 */

const { query } = require('../../config/database');
const log = require('../../lib/logger').child({ module: 'recommendation.verdicts' });

const PG_UNDEFINED_TABLE = '42P01';

const VALID_VERDICTS = new Set(['acted', 'dismissed', 'snoozed']);

const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

/**
 * Upsert one operator verdict on a recommendation rule for a deal. Returns
 * the row inserted/updated, or `null` if the table is missing.
 *
 * @param {object} input
 * @param {string} input.organizationId
 * @param {string} input.dealId
 * @param {string} input.ruleId            stable rule.id from recommendationRules.js
 * @param {string} input.verdict           one of 'acted' | 'dismissed' | 'snoozed'
 * @param {string?} input.reason           short free-text (≤500 chars) — optional
 * @param {string?} input.snoozeUntil      ISO timestamp; required when verdict='snoozed'
 *                                         and snoozeUntilSnapshotChange is false
 * @param {boolean?} input.snoozeUntilSnapshotChange  true ⇒ hide until snapshot changes
 * @param {string?} input.snoozedAtSnapshotHash       the snapshot_hash at snooze time
 * @param {string?} input.userId           the acting operator
 */
const upsertVerdict = async ({
  organizationId,
  dealId,
  ruleId,
  verdict,
  reason = null,
  snoozeUntil = null,
  snoozeUntilSnapshotChange = false,
  snoozedAtSnapshotHash = null,
  userId = null,
}) => {
  if (!dealId || !ruleId || !VALID_VERDICTS.has(verdict)) return null;
  try {
    const trimmedReason = reason && typeof reason === 'string' ? reason.slice(0, 500) : null;
    const result = await query(
      `INSERT INTO deal_recommendation_verdicts
         (organization_id, deal_id, rule_id, verdict, reason,
          snooze_until, snooze_until_snapshot_change, snoozed_at_snapshot_hash,
          created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (deal_id, rule_id) DO UPDATE
         SET verdict = EXCLUDED.verdict,
             reason = EXCLUDED.reason,
             snooze_until = EXCLUDED.snooze_until,
             snooze_until_snapshot_change = EXCLUDED.snooze_until_snapshot_change,
             snoozed_at_snapshot_hash = EXCLUDED.snoozed_at_snapshot_hash,
             updated_at = NOW()
       RETURNING *`,
      [
        organizationId,
        dealId,
        ruleId,
        verdict,
        trimmedReason,
        snoozeUntil,
        Boolean(snoozeUntilSnapshotChange),
        snoozedAtSnapshotHash,
        userId,
      ],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) {
      log.warn('verdicts_table_missing_migration', { migration: '20260615' });
      return null;
    }
    log.warn('upsert_verdict_failed', { error: err.message, deal_id: dealId, rule_id: ruleId });
    return null;
  }
};

/**
 * Return ACTIVE verdicts for a deal: dismissed + unexpired-snoozed. Acted
 * verdicts are NOT returned (they mean "I addressed this" — the card should
 * still render so the operator can verify the work).
 *
 * Snapshot-change snoozes are filtered IN unless the current snapshot_hash
 * matches the one stored at snooze time; once the snapshot changes (i.e. the
 * deal state has materially shifted), the snooze expires and the card
 * re-surfaces.
 */
const getActiveByDeal = async (dealId, { currentSnapshotHash = null } = {}) => {
  if (!dealId) return [];
  try {
    const result = await query(
      `SELECT deal_id, rule_id, verdict, reason, snooze_until,
              snooze_until_snapshot_change, snoozed_at_snapshot_hash,
              created_by, updated_at
         FROM deal_recommendation_verdicts
        WHERE deal_id = $1
          AND organization_id = current_organization_id()
          AND verdict IN ('dismissed', 'snoozed')`,
      [dealId],
    );
    const now = Date.now();
    return result.rows.filter((row) => {
      if (row.verdict === 'dismissed') return true;
      // snoozed
      if (row.snooze_until_snapshot_change === true) {
        // active iff the snooze-time snapshot still matches the current one
        return Boolean(currentSnapshotHash) && row.snoozed_at_snapshot_hash === currentSnapshotHash;
      }
      if (row.snooze_until) {
        return new Date(row.snooze_until).getTime() > now;
      }
      return false;
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    log.warn('get_active_verdicts_failed', { error: err.message, deal_id: dealId });
    return [];
  }
};

/**
 * Filter the recommendation cards down to the ones still visible (no active
 * dismiss/snooze verdict). The hidden cards are returned alongside the visible
 * ones with their verdict attached so the UI can render a "show dismissed"
 * affordance.
 */
const applyVerdictsToCards = (cards, activeVerdicts) => {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { visible: [], hidden: [] };
  }
  if (!Array.isArray(activeVerdicts) || activeVerdicts.length === 0) {
    return { visible: cards, hidden: [] };
  }
  const byRuleId = new Map();
  for (const v of activeVerdicts) byRuleId.set(v.rule_id, v);
  const visible = [];
  const hidden = [];
  for (const card of cards) {
    const verdict = byRuleId.get(card.id);
    if (verdict) {
      hidden.push({
        ...card,
        verdict: {
          kind: verdict.verdict,
          reason: verdict.reason,
          snooze_until: verdict.snooze_until,
          snooze_until_snapshot_change: verdict.snooze_until_snapshot_change,
          updated_at: verdict.updated_at,
        },
      });
    } else {
      visible.push(card);
    }
  }
  return { visible, hidden };
};

module.exports = {
  VALID_VERDICTS,
  upsertVerdict,
  getActiveByDeal,
  applyVerdictsToCards,
};
