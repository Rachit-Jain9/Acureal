'use strict';

/**
 * Supabase-backed monitoring + provenance for the financial kernel.
 *
 * Two concerns, one module:
 *   recordMonitoringEvent(event)          — append-only event log for
 *                                            anomalies, variance alerts,
 *                                            reconciliation runs, and
 *                                            engine-decision traces.
 *   persistInvestorPackageSnapshot(snap)  — full package JSON + input
 *                                            hash for golden-file
 *                                            reconciliation.
 *
 * Cohort tracking was removed when the debt engine became unconditional;
 * the `investor_package_snapshots` rows already carry `engine_version`
 * for auditability, and there is no rollout/cohort assignment to persist
 * anymore. A legacy-compat `upsertCohortDecision` is retained below
 * (no-op alias) so pre-existing callers don't blow up mid-deploy.
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
 * Persist a full investor-package snapshot for golden-file reconciliation.
 * `inputHash` is a caller-computed SHA-256 of the request body — lets us
 * detect drift between identical inputs across engine runtimes.
 *
 * `engineVersion` ∈ {inline, python, safe-mode}.
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

/**
 * Deprecated no-op. Cohorts were removed with the rollout. Retained so
 * any pre-existing caller does not throw mid-deploy; returns a clear
 * sentinel so the operator can see it fired during a rolling rollout.
 */
const upsertCohortDecision = async () => ({
  persisted: false,
  reason: 'cohort_persistence_removed',
});

module.exports = {
  recordMonitoringEvent,
  persistInvestorPackageSnapshot,
  upsertCohortDecision,
};
