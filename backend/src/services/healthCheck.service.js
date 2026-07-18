'use strict';

/**
 * Liveness watchdog — the one thing that watches everything else.
 *
 * WHY THIS EXISTS. REDIP's most expensive incidents have not been crashes —
 * they have been SILENCE. Three separate critical paths ran dead for weeks
 * before anyone noticed, because nothing was watching them:
 *   • the Gemini default model was retired by Google and every narration /
 *     export-insight call 404'd for ~a week (1,500+ error rows) — surfaced
 *     only when an operator happened to read the AI-usage dashboard;
 *   • the deal audit trail silently stopped recording for ~4 months;
 *   • a data-erasure query threw on every run for months.
 * In each case the app kept returning 200s. The failure mode is not a 500 —
 * it is a subsystem quietly doing nothing while the rest of the app looks fine.
 *
 * WHAT THIS DOES. One scheduled pass (hourly Vercel cron) inspects the health
 * of every subsystem that has failed silently before, and raises a
 * fingerprinted Sentry alert per unhealthy subsystem. The same checks back the
 * operator-facing System Health page (on-demand, no alerts). This converts
 * "we find out when a human hits the bug" into "we detect our own degradation
 * automatically" — the strongest possible answer to the institutional-grade
 * reliability question.
 *
 * DESIGN NOTES.
 *  • UNSCOPED by design. Under a Vercel cron there is no tenant context, so
 *    `current_organization_id()` is NULL and any `WHERE organization_id =
 *    current_organization_id()` filter matches nothing. These checks query
 *    ACROSS ALL ORGS on purpose — mirroring retentionSweep / parcelCacheSweep,
 *    NOT the per-org dashboard services. Aggregate counts only; no tenant data.
 *  • Every check is wrapped in its own try/catch and returns a plain object —
 *    a check NEVER throws. A failing check degrades to status 'unknown' and is
 *    reported, so a broken watchdog can't take down the cron (or hide behind a
 *    500 the way the very failures it hunts for do).
 *  • Sentry only auto-reports >=500 responses; this endpoint returns 200 while
 *    a subsystem is quietly dead, so alerting MUST be explicit. Each alert
 *    carries a stable `fingerprint` so an hourly-recurring condition collapses
 *    into a single Sentry issue instead of 24 new ones per day.
 *  • The tenant-isolation canary clears the org context in its OWN transaction
 *    (via getClient), so it tests the real fail-closed contract regardless of
 *    who invoked the watchdog (cron or an authenticated operator).
 */

const { query, getClient } = require('../config/database');
const { Sentry, isEnabled } = require('../lib/sentry');
const log = require('../lib/logger').child({ module: 'health.watchdog' });

// Windows / thresholds — env-overridable so an enterprise contract can tune
// them without a deploy. The window is deliberately wider than the cron
// interval (hourly) so a genuinely quiet hour never false-alarms.
const WINDOW_HOURS = Number(process.env.LIVENESS_WINDOW_HOURS || 3);
const AI_ERROR_SHARE_THRESHOLD = Number(process.env.LIVENESS_AI_ERROR_THRESHOLD || 0.5);
const AI_MIN_SAMPLE = Number(process.env.LIVENESS_AI_MIN_SAMPLE || 5);
const STUCK_EXTRACTION_MINUTES = Number(process.env.LIVENESS_STUCK_EXTRACTION_MINUTES || 15);

const HEALTHY = 'healthy';
const UNHEALTHY = 'unhealthy';
const UNKNOWN = 'unknown';

const CHECK_LABELS = {
  ai_providers: 'AI providers',
  audit_trail: 'Audit trail',
  extractions: 'Document extractions',
  tenant_isolation: 'Tenant isolation',
};

const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * Check 1 — AI provider error share.
 * Catches a retired / renamed model in ~1h instead of the week the July outage
 * actually ran. Error share = (error + timeout) / (success + error + timeout +
 * cache_hit) per model over the window — matching aiHealth.service's denominator
 * convention (cost_capped / skipped are REDIP's own throttle decisions, not
 * provider outcomes, so they're excluded). A min-sample guard stops a single
 * failed call flipping a low-volume model to 100%.
 */
const checkAiErrorShare = async () => {
  try {
    const { rows } = await query(
      `SELECT provider, model,
              COUNT(*) FILTER (WHERE status IN ('success','error','timeout','cache_hit')) AS provider_calls,
              COUNT(*) FILTER (WHERE status IN ('error','timeout'))                       AS failures
         FROM ai_call_logs
        WHERE created_at >= NOW() - ($1 || ' hours')::interval
        GROUP BY provider, model
       HAVING COUNT(*) FILTER (WHERE status IN ('success','error','timeout','cache_hit')) >= $2
        ORDER BY failures DESC`,
      [WINDOW_HOURS, AI_MIN_SAMPLE],
    );
    const models = rows.map((r) => {
      const calls = Number(r.provider_calls) || 0;
      const failures = Number(r.failures) || 0;
      return {
        provider: r.provider,
        model: r.model,
        calls,
        failures,
        error_share: calls > 0 ? Math.round((failures / calls) * 1000) / 1000 : 0,
      };
    });
    const offenders = models.filter((m) => m.error_share >= AI_ERROR_SHARE_THRESHOLD);
    return {
      status: offenders.length ? UNHEALTHY : HEALTHY,
      window_hours: WINDOW_HOURS,
      threshold: AI_ERROR_SHARE_THRESHOLD,
      models_checked: models.length,
      offenders,
      detail: offenders.length
        ? offenders
          .map((o) => `${o.provider}/${o.model} ${pct(o.error_share)} errors (${o.failures}/${o.calls})`)
          .join('; ')
        : models.length
          ? 'All AI models within the error threshold.'
          : `No AI calls with a >=${AI_MIN_SAMPLE}-call sample in the last ${WINDOW_HOURS}h.`,
    };
  } catch (error) {
    log.warn('ai_error_share_check_failed', { error: error.message });
    return { status: UNKNOWN, error: error.message };
  }
};

/**
 * Check 2 — audit-write liveness.
 * The audit trail was once dead for ~4 months undetected because recordAudit
 * fails OPEN (the mutation succeeds, the audit insert silently no-ops). Detect
 * "deals changed but nothing was audited" by cross-checking audit writes
 * against two independent activity signals in the same window.
 */
const checkAuditWrites = async () => {
  try {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*) FROM deal_audit_log WHERE created_at >= NOW() - ($1 || ' hours')::interval) AS audit_writes,
         (SELECT COUNT(*) FROM deal_events    WHERE created_at >= NOW() - ($1 || ' hours')::interval) AS event_writes,
         (SELECT COUNT(*) FROM activities     WHERE created_at >= NOW() - ($1 || ' hours')::interval) AS activity_writes,
         (SELECT COUNT(*) FROM deals
           WHERE updated_at >= NOW() - ($1 || ' hours')::interval
             AND updated_at > created_at)                                                             AS deal_mutations`,
      [WINDOW_HOURS],
    );
    const r = rows[0] || {};
    const auditWrites = Number(r.audit_writes) || 0;
    const eventWrites = Number(r.event_writes) || 0;
    const activityWrites = Number(r.activity_writes) || 0;
    const dealMutations = Number(r.deal_mutations) || 0;

    // If deals were mutated (or activity logged) but NOTHING was audited across
    // either audit lane, the trail is broken — exactly the "dead for months"
    // signature. A truly quiet window (no mutations) is healthy, not suspicious.
    const expectedAudit = activityWrites > 0 || dealMutations > 0;
    const broken = expectedAudit && auditWrites === 0 && eventWrites === 0;
    return {
      status: broken ? UNHEALTHY : HEALTHY,
      window_hours: WINDOW_HOURS,
      audit_writes: auditWrites,
      event_writes: eventWrites,
      activity_writes: activityWrites,
      deal_mutations: dealMutations,
      detail: broken
        ? `${dealMutations} deal mutation(s) + ${activityWrites} activity row(s) in ${WINDOW_HOURS}h but ZERO audit writes — the audit trail has stopped recording.`
        : expectedAudit
          ? `Audit trail recording normally (${auditWrites} lifecycle + ${eventWrites} signed rows).`
          : 'No deal activity in the window; nothing to audit.',
    };
  } catch (error) {
    log.warn('audit_write_check_failed', { error: error.message });
    return { status: UNKNOWN, error: error.message };
  }
};

/**
 * Check 3 — stuck extractions.
 * Extraction runs synchronously inside the request, capped at 300s by Vercel.
 * If the function is killed mid-run the row is orphaned in 'processing' forever.
 * The in-process reaper only fires lazily when someone opens that org's deal, so
 * an org nobody visits never gets swept. Detect (don't fix — the reaper owns the
 * fix) rows stuck well beyond the function budget across all orgs.
 */
const checkStuckExtractions = async () => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS stuck
         FROM document_extractions
        WHERE extraction_status = 'processing'
          AND COALESCE(extraction_started_at, created_at) < NOW() - ($1 || ' minutes')::interval`,
      [STUCK_EXTRACTION_MINUTES],
    );
    const stuck = Number(rows[0] && rows[0].stuck) || 0;
    return {
      status: stuck > 0 ? UNHEALTHY : HEALTHY,
      stuck,
      threshold_minutes: STUCK_EXTRACTION_MINUTES,
      detail: stuck > 0
        ? `${stuck} extraction(s) stuck in 'processing' beyond ${STUCK_EXTRACTION_MINUTES}m (function budget is 300s) — likely orphaned by a mid-run instance death.`
        : 'No stuck extractions.',
    };
  } catch (error) {
    log.warn('stuck_extraction_check_failed', { error: error.message });
    return { status: UNKNOWN, error: error.message };
  }
};

/**
 * Check 4 — tenant-isolation fail-closed canary.
 * The app connects as a role that BYPASSES RLS, so the app-layer predicate
 * `organization_id = current_organization_id()` is the only real tenant wall
 * today. That wall's contract is: with NO org context, every org-scoped read
 * returns ZERO rows. This canary forces the no-context condition in its own
 * transaction (independent of the caller) and asserts the contract holds — the
 * single most valuable canary available before the DB role is hardened (M1).
 * It also surfaces the current DB posture (superuser / bypassrls) so that when
 * the role IS eventually swapped, the change becomes visible here.
 */
const checkTenantIsolation = async () => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Force the "unauthenticated / cron" condition regardless of who called us.
    // SET LOCAL inside this txn — the pooler-safe pattern (see config/database).
    await client.query(
      `SELECT set_config('app.current_user_id', '', true),
              set_config('app.current_organization_id', '', true)`,
    );
    const { rows } = await client.query(
      `SELECT
         current_user                                              AS db_role,
         current_setting('is_superuser')                           AS is_superuser,
         (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls,
         current_organization_id() IS NULL                         AS ctx_is_null,
         (SELECT COUNT(*)::int FROM deals
           WHERE organization_id = current_organization_id())      AS scoped_visible_deals`,
    );
    await client.query('COMMIT');

    const r = rows[0] || {};
    const ctxIsNull = r.ctx_is_null === true;
    const scopedVisible = Number(r.scoped_visible_deals) || 0;
    const bypassesRls = r.bypasses_rls === true;
    const failClosed = ctxIsNull && scopedVisible === 0;

    return {
      status: failClosed ? HEALTHY : UNHEALTHY,
      fail_closed: failClosed,
      ctx_is_null: ctxIsNull,
      scoped_visible_deals: scopedVisible,
      db_role: r.db_role,
      is_superuser: r.is_superuser === 'on' || r.is_superuser === true,
      bypasses_rls: bypassesRls,
      detail: failClosed
        ? (bypassesRls
          ? 'Tenant boundary holds at the app layer. Note: the DB role still bypasses RLS, so isolation is defence-in-depth in code, not yet enforced by Postgres (M1).'
          : 'Tenant boundary holds AND the DB role no longer bypasses RLS — Postgres now enforces isolation.')
        : `FAIL-CLOSED BROKEN: with no org context, ${scopedVisible} deal(s) were visible (ctx_is_null=${ctxIsNull}). The app-layer tenant boundary is not holding.`,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    log.warn('tenant_isolation_check_failed', { error: error.message });
    return { status: UNKNOWN, error: error.message };
  } finally {
    client.release();
  }
};

/**
 * Run every check, optionally raising a Sentry alert per unhealthy subsystem.
 * @param {{ raiseAlerts?: boolean }} opts  raiseAlerts=true only for the cron —
 *   a human viewing the System Health page must NOT mint Sentry issues.
 */
const runHealthCheck = async ({ raiseAlerts = false } = {}) => {
  const start = Date.now();
  const [ai, audit, extractions, tenant] = await Promise.all([
    checkAiErrorShare(),
    checkAuditWrites(),
    checkStuckExtractions(),
    checkTenantIsolation(),
  ]);
  const checks = {
    ai_providers: ai,
    audit_trail: audit,
    extractions,
    tenant_isolation: tenant,
  };

  const unhealthy = Object.entries(checks).filter(([, c]) => c.status === UNHEALTHY);
  const unknown = Object.entries(checks).filter(([, c]) => c.status === UNKNOWN);
  const overall = unhealthy.length ? UNHEALTHY : HEALTHY;

  let alertsRaised = 0;
  if (raiseAlerts && isEnabled()) {
    for (const [key, c] of unhealthy) {
      Sentry.captureMessage(
        `[liveness] ${CHECK_LABELS[key] || key} unhealthy — ${c.detail || ''}`.trim(),
        {
          level: 'error',
          tags: { watchdog: 'liveness', subsystem: key },
          extra: c,
          fingerprint: ['liveness', key], // collapse hourly repeats into one issue
        },
      );
      alertsRaised += 1;
    }
  }

  const summary = {
    overall,
    checks,
    unhealthy_count: unhealthy.length,
    unknown_count: unknown.length,
    window_hours: WINDOW_HOURS,
    alerts_raised: alertsRaised,
    duration_ms: Date.now() - start,
    generated_at: new Date().toISOString(),
  };
  (overall === UNHEALTHY ? log.warn : log.info)('liveness_check', {
    overall,
    unhealthy: unhealthy.map(([k]) => k),
    unknown: unknown.map(([k]) => k),
    duration_ms: summary.duration_ms,
  });
  return summary;
};

module.exports = {
  runHealthCheck,
  // Exported for unit tests / future reuse.
  checkAiErrorShare,
  checkAuditWrites,
  checkStuckExtractions,
  checkTenantIsolation,
  CHECK_LABELS,
};
