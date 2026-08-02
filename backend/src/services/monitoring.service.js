'use strict';

/**
 * Monitoring + provenance for the financial kernel.
 *
 *   recordMonitoringEvent(event)          — append-only log for anomalies,
 *                                            variance alerts, reconciliation
 *                                            runs and engine-decision traces.
 *   persistInvestorPackageSnapshot(snap)  — full package JSON + input hash, for
 *                                            golden-file reconciliation.
 *
 * WHY THIS WAS REWRITTEN (2026-08-02). It was `monitoring.supabase.js` and
 * wrote through `supabase-js`, which means through PostgREST — Acureal's second
 * door into the database. Two consequences, neither of them intended:
 *
 *   1. Those writes authenticated as `service_role`, which BYPASSES RLS. So
 *      every row landed unscoped by the tenant boundary that governs every
 *      other write in the system. Nothing leaked (only the service itself
 *      writes here), but the rows were never covered by the wall that is
 *      supposed to be absolute.
 *   2. It was one of only two things keeping the `public` schema on the
 *      PostgREST surface at all. Moving it to the normal pool is what lets that
 *      surface be closed structurally rather than only revoked.
 *
 * `query()` opens a transaction, stamps `app.current_organization_id` /
 * `app.current_user_id` with SET LOCAL, and runs the statement on the same
 * backend — so these rows are now tenant-scoped like everything else.
 *
 * FAIL-SOFT, DELIBERATELY. Monitoring must never take down the thing it
 * monitors: every function returns `{ persisted, reason }` and never throws.
 * Callers should hand the promise to `runInBackground` rather than dropping it
 * — a bare `.catch(() => {})` after `res.json()` is not a background job on
 * serverless, it is a coin flip.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'monitoring' });

// Mirrors the `monitoring_severity` enum. An unknown value would fail the
// insert on a type error, so it is clamped rather than passed through.
const SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);
const clampSeverity = (s) => (SEVERITIES.has(s) ? s : 'info');

const _safe = async (fn, label) => {
  try {
    return await fn();
  } catch (err) {
    log.warn('monitoring_write_failed', { label, error: err.message });
    return { persisted: false, reason: err.message };
  }
};

/**
 * Append a monitoring event. All fields optional except `event`.
 * Event names are snake_case and should stay stable — dashboards key off them.
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
    const { rows } = await query(
      `INSERT INTO monitoring_logs
         (organization_id, deal_id, source, event, severity, engine_version, payload)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::monitoring_severity, $6, $7::jsonb)
       RETURNING id`,
      [
        organizationId,
        dealId,
        source,
        event,
        clampSeverity(severity),
        engineVersion,
        JSON.stringify(payload ?? {}),
      ],
    );
    return { persisted: true, id: rows[0]?.id || null };
  }, `recordMonitoringEvent(${event})`);
};

/**
 * Persist a full investor-package snapshot for golden-file reconciliation.
 * `inputHash` is a caller-computed SHA-256 of the request body, so drift
 * between identical inputs across engine runtimes is detectable.
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
  if (!dealId || !engineVersion || !body) {
    return { persisted: false, reason: 'missing_required_fields' };
  }

  return _safe(async () => {
    const { rows } = await query(
      `INSERT INTO investor_package_snapshots
         (organization_id, deal_id, engine_version, source, input_hash, body)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [organizationId, dealId, engineVersion, source, inputHash, JSON.stringify(body)],
    );
    return { persisted: true, id: rows[0]?.id || null };
  }, `persistInvestorPackageSnapshot(${dealId})`);
};

/**
 * Deprecated no-op. Cohorts were removed when the debt engine became
 * unconditional. Retained so a pre-existing caller cannot throw mid-deploy, and
 * returns a clear sentinel so it is visible if one ever fires.
 */
const upsertCohortDecision = async () => ({
  persisted: false,
  reason: 'cohort_persistence_removed',
});

module.exports = {
  recordMonitoringEvent,
  persistInvestorPackageSnapshot,
  upsertCohortDecision,
  // Exported for tests.
  clampSeverity,
};
