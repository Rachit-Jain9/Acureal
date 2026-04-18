'use strict';

/**
 * Supabase-backed monitoring + rollout persistence for the financial
 * kernel's Phase-4 investor-intelligence pipeline.
 *
 * Three concerns, one module:
 *   recordMonitoringEvent(event)          — append-only anomaly / variance /
 *                                            reconciliation log rows.
 *   upsertCohortDecision(decision)        — durable record of what cohort
 *                                            a deal landed in for
 *                                            DEBT_ENGINE_V2, so rollout
 *                                            is replayable from history.
 *   persistInvestorPackageSnapshot(snap)  — full package JSON + input hash
 *                                            for golden-file reconciliation.
 *
 * When Supabase is not configured (local dev without env), every function
 * is a no-op that returns `{ persisted: false, reason }`. Callers should
 * never block on a monitoring write failing — log-and-continue only.
 */

const { getSupabaseClient, isSupabaseConfigured } = require('../lib/supabase');

const SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

const clampSeverity = (s) => (SEVERITIES.has(s) ? s : 'info');

const _safe = async (fn, label) => {
  if (!isSupabaseConfigured()) return { persisted: false, reason: 'supabase_not_configured' };
  try {
    return await fn();
  } catch (err) {
    console.warn(`[monitoring.supabase] ${label} failed: ${err.message}`);
    return { persisted: false, reason: err.message };
  }
};

/**
 * Append a monitoring event. All fields optional except `event`.
 * Event names use snake_case and should stay stable so dashboards/alerts
 * can be built on them. Payload is free-form JSON.
 */
const recordMonitoringEvent = async ({
  organizationId = null,
  dealId = null,
  source = 'backend',
  event,
  severity = 'info',
  engineVersion = null,
  payload = {},
} = {}) => {
  if (!event) return { persisted: false, reason: 'event_required' };
  return _safe(async () => {
    const sb = getSupabaseClient();
    const { error } = await sb.from('monitoring_logs').insert({
      organization_id: organizationId,
      deal_id: dealId,
      source,
      event,
      severity: clampSeverity(severity),
      engine_version: engineVersion,
      payload,
    });
    if (error) throw error;
    return { persisted: true };
  }, `recordMonitoringEvent(${event})`);
};

/**
 * Upsert a feature-flag cohort row. `subjectId` is usually the deal
 * UUID. `cohort` ∈ {v1-legacy, v2-ts, v2-python}.
 */
const upsertCohortDecision = async ({
  flagKey = 'DEBT_ENGINE_V2',
  subjectKind = 'deal',
  subjectId,
  cohort,
  rolloutPct = 0,
  bucket = null,
  killSwitch = false,
  engineVersion = null,
  reason = null,
  payload = {},
} = {}) => {
  if (!subjectId || !cohort) return { persisted: false, reason: 'subject_id_and_cohort_required' };
  return _safe(async () => {
    const sb = getSupabaseClient();
    const { error } = await sb.from('feature_flag_cohorts').upsert({
      flag_key: flagKey,
      subject_kind: subjectKind,
      subject_id: subjectId,
      cohort,
      rollout_pct: rolloutPct,
      bucket,
      kill_switch: killSwitch,
      engine_version: engineVersion,
      reason,
      payload,
    }, { onConflict: 'flag_key,subject_kind,subject_id' });
    if (error) throw error;
    return { persisted: true };
  }, `upsertCohortDecision(${subjectId})`);
};

/**
 * Persist a full investor-package snapshot for golden-file reconciliation.
 * `inputHash` is a caller-computed SHA-256 of the request body — lets us
 * detect drift between identical inputs across engine versions.
 */
const persistInvestorPackageSnapshot = async ({
  organizationId = null,
  dealId,
  engineVersion,
  source = 'ts',
  inputHash = null,
  body,
} = {}) => {
  if (!dealId || !engineVersion || !body) return { persisted: false, reason: 'missing_required_fields' };
  return _safe(async () => {
    const sb = getSupabaseClient();
    const { error } = await sb.from('investor_package_snapshots').insert({
      organization_id: organizationId,
      deal_id: dealId,
      engine_version: engineVersion,
      source,
      input_hash: inputHash,
      body,
    });
    if (error) throw error;
    return { persisted: true };
  }, `persistInvestorPackageSnapshot(${dealId})`);
};

module.exports = {
  recordMonitoringEvent,
  upsertCohortDecision,
  persistInvestorPackageSnapshot,
};
