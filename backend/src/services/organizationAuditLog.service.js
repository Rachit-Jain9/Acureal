'use strict';

// Append-only audit trail for ORGANIZATION-level changes — membership role
// changes, join-request decisions, and domain claims. Distinct from
// deal_audit_log (deal-scoped, requires a deal_id) and deal_events (HMAC-signed
// financial computations); neither fits people/domain mutations that have no
// deal. CLAUDE.md mandates an immutable trail for material membership/approval
// changes, so every such mutation calls recordAudit().
//
// Fail-open by design (mirrors dealAuditLog.service): an audit write must NEVER
// roll back or fail the underlying mutation — errors are swallowed and logged.
// A missing table/column (migration not yet applied) degrades to a silent
// no-op, so the feature is safe to deploy before the migration lands.

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'organizationAuditLog.service' });

const SUPPORTED_EVENT_TYPES = new Set([
  'member_role_changed',
  'member_deactivated',
  'member_reactivated',
  'member_invited',
  'member_domain_joined',
  'join_request_approved',
  'join_request_rejected',
  'domain_claim_added',
  'domain_claim_removed',
  'domain_verified',
  'domain_policy_changed',
]);

// 42P01 undefined_table / 42703 undefined_column — the migration has not been
// applied yet. Treat as a no-op (deploy-before-migrate safety), not an error.
const SOFT_ERROR_CODES = new Set(['42P01', '42703']);

const recordAudit = async (
  {
    organizationId,
    eventType,
    actorId = null,
    targetUserId = null,
    before = {},
    after = {},
    metadata = {},
  } = {},
  client = null,
) => {
  if (!organizationId) {
    log.warn('record_audit_missing_org', { eventType });
    return null;
  }
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    log.warn('record_audit_bad_event_type', { eventType });
    return null;
  }

  const exec = client ? client.query.bind(client) : query;

  try {
    const result = await exec(
      `INSERT INTO organization_audit_log
         (organization_id, actor_id, target_user_id, event_type, before_json, after_json, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, organization_id, actor_id, target_user_id, event_type,
                 before_json, after_json, metadata, created_at`,
      [
        organizationId,
        actorId,
        targetUserId,
        eventType,
        JSON.stringify(before || {}),
        JSON.stringify(after || {}),
        JSON.stringify(metadata || {}),
      ],
    );
    return (result && result.rows && result.rows[0]) || null;
  } catch (error) {
    if (error && SOFT_ERROR_CODES.has(error.code)) {
      return null;
    }
    log.warn('record_audit_failed', { eventType, error: error.message });
    return null;
  }
};

// Org-scoped, most-recent-first audit feed for the Team page. Joins actor +
// target user identities so the UI can render "Asha changed Ravi's role" without
// a second round-trip. Capped to keep the payload bounded.
const listOrganizationAudit = async (organizationId, { limit = 100 } = {}) => {
  const cappedLimit = Math.min(Number(limit) || 100, 500);
  const result = await query(
    `SELECT a.id, a.event_type, a.actor_id, a.target_user_id,
            a.before_json, a.after_json, a.metadata, a.created_at,
            actor.name  AS actor_name,  actor.email  AS actor_email,
            target.name AS target_name, target.email AS target_email
       FROM organization_audit_log a
       LEFT JOIN users actor  ON actor.id  = a.actor_id
       LEFT JOIN users target ON target.id = a.target_user_id
      WHERE a.organization_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2`,
    [organizationId, cappedLimit],
  );
  return result.rows;
};

module.exports = {
  recordAudit,
  listOrganizationAudit,
  SUPPORTED_EVENT_TYPES,
};
