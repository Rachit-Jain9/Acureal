/**
 * Security & incident event register service.
 *
 * Sibling to dealAuditLog.service.js. Where that logs deal lifecycle
 * mutations, this logs cross-cutting security incidents — account
 * lockouts, AI cost-cap breaches, suspected breaches, vendor incidents —
 * and tracks each through the CERT-In / DPDP notification workflow.
 *
 * Design rules (per CLAUDE.md + the dealAuditLog precedent):
 *
 *   1. **Fail-open writes.** recordEvent() swallows DB errors and returns
 *      null after a warning. Recording a security event must NEVER break
 *      or roll back the operation that triggered it.
 *
 *   2. **Migration-tolerant.** Detects Postgres 42P01 (undefined_table)
 *      and downgrades to a one-time warning, so detective controls can
 *      call recordEvent() before the operator applies the migration.
 *
 *   3. **Org-scoped reads in SQL.** The backend role bypasses RLS, so the
 *      read queries scope to the caller's organization explicitly; the
 *      table's RLS policy is defense-in-depth for any other path.
 */

'use strict';

const { query } = require('../config/database');

const SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const STATUSES = Object.freeze([
  'open', 'investigating', 'contained', 'resolved', 'reported', 'false_positive',
]);

// 42P01 = undefined_table (migration not yet applied).
// 42703 = undefined_column (future schema drift — log, don't block).
const SOFT_ERROR_CODES = new Set(['42P01', '42703']);

let warnedAboutMissingTable = false;
const warnSoft = (err, context) => {
  if (err?.code === '42P01' && warnedAboutMissingTable) return;
  if (err?.code === '42P01') warnedAboutMissingTable = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[securityEvents.service] ${context}: ${err.message || err} (code=${err.code || 'unknown'}).`,
  );
};

/**
 * Record a security event. Fail-open: never throws, returns the inserted
 * row on success or null on any failure (including migration-not-applied).
 *
 * Required: eventType, summary.
 * Optional: organizationId (null = platform-wide), severity, detail, actorId.
 */
const recordEvent = async ({
  organizationId = null,
  eventType,
  severity = 'low',
  summary,
  detail = {},
  actorId = null,
} = {}) => {
  if (!eventType || !summary) {
    // eslint-disable-next-line no-console
    console.warn('[securityEvents.service] recordEvent: eventType and summary are required; skipping');
    return null;
  }
  const safeSeverity = SEVERITIES.includes(severity) ? severity : 'low';

  try {
    const result = await query(
      `INSERT INTO public.security_events
         (organization_id, event_type, severity, summary, detail, actor_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [organizationId, eventType, safeSeverity, summary, JSON.stringify(detail || {}), actorId],
    );
    return result?.rows?.[0] ?? null;
  } catch (err) {
    if (err && SOFT_ERROR_CODES.has(err.code)) {
      warnSoft(err, `recordEvent(${eventType})`);
      return null;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[securityEvents.service] recordEvent(${eventType}) failed: ${err.message || err}`,
    );
    return null;
  }
};

/**
 * List security events visible to an organization (its own + platform-wide),
 * newest first. Optional status / severity filters. Limit clamped 1–500.
 */
const listEvents = async ({
  organizationId = null,
  status = null,
  severity = null,
  limit = 100,
} = {}) => {
  const clampedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const conditions = ['(organization_id = $1 OR organization_id IS NULL)'];
  const params = [organizationId];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    conditions.push(`severity = $${params.length}`);
  }
  params.push(clampedLimit);

  try {
    const result = await query(
      `SELECT * FROM public.security_events
        WHERE ${conditions.join(' AND ')}
        ORDER BY detected_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  } catch (err) {
    if (err && SOFT_ERROR_CODES.has(err.code)) {
      warnSoft(err, 'listEvents');
      return [];
    }
    throw err;
  }
};

/** Fetch one event, scoped to the org (or platform-wide). */
const getEvent = async (id, organizationId = null) => {
  try {
    const result = await query(
      `SELECT * FROM public.security_events
        WHERE id = $1 AND (organization_id = $2 OR organization_id IS NULL)
        LIMIT 1`,
      [id, organizationId],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err && SOFT_ERROR_CODES.has(err.code)) {
      warnSoft(err, 'getEvent');
      return null;
    }
    throw err;
  }
};

/**
 * Update an event's triage state. Only status / severity / summary are
 * directly settable. The regulatory-clock columns are stamped to NOW()
 * when their flag is passed truthy (cert_in_reported_at, dpdp_board_reported_at,
 * data_principals_notified_at). status='resolved' also stamps resolved_at.
 * An empty/unrecognised patch is a no-op that returns the current row.
 */
const updateEvent = async (id, organizationId, patch = {}) => {
  const sets = [];
  const params = [];

  if (patch.status !== undefined && STATUSES.includes(patch.status)) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
    if (patch.status === 'resolved') {
      sets.push('resolved_at = NOW()');
    }
  }
  if (patch.severity !== undefined && SEVERITIES.includes(patch.severity)) {
    params.push(patch.severity);
    sets.push(`severity = $${params.length}`);
  }
  if (typeof patch.summary === 'string' && patch.summary.trim()) {
    params.push(patch.summary.trim());
    sets.push(`summary = $${params.length}`);
  }
  for (const col of ['cert_in_reported_at', 'dpdp_board_reported_at', 'data_principals_notified_at']) {
    if (patch[col]) {
      sets.push(`${col} = NOW()`);
    }
  }

  if (sets.length === 0) {
    return getEvent(id, organizationId);
  }
  sets.push('updated_at = NOW()');

  params.push(id);
  const idParam = params.length;
  params.push(organizationId);
  const orgParam = params.length;

  try {
    const result = await query(
      `UPDATE public.security_events
          SET ${sets.join(', ')}
        WHERE id = $${idParam}
          AND (organization_id = $${orgParam} OR organization_id IS NULL)
        RETURNING *`,
      params,
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err && SOFT_ERROR_CODES.has(err.code)) {
      warnSoft(err, 'updateEvent');
      return null;
    }
    throw err;
  }
};

module.exports = {
  recordEvent,
  listEvents,
  getEvent,
  updateEvent,
  SEVERITIES,
  STATUSES,
};
