'use strict';

/**
 * Immutable document-access audit sink.
 *
 * Subscribes to EVENTS.DOCUMENT_ACCESSED — published by document.service on
 * signed-URL issuance + byte-stream download, and by masterplan.service on
 * regulatory source-PDF download — and writes one append-only row into
 * `document_access_log`.
 *
 * Why a dedicated sink + table rather than the deal timeline:
 *   - activities.activity_type is a CLOSED enum (ACTIVITY_TYPES in
 *     constants/domain.js) that does not include document access. Routing
 *     downloads through activity.service.logActivity would be rejected by
 *     that validation; inserting raw would pollute the investor-facing deal
 *     timeline with routine reads. (dealEvents.service owns the timeline.)
 *   - A download is a security / compliance access record, not a deal
 *     mutation, so it gets its own append-only home (mirrors deal_audit_log).
 *
 * Guardrails (mirror dealAuditLog.service):
 *
 *   1. **Fail-open.** A failed audit insert logs + returns null; it never
 *      throws and never blocks the download that produced it. The event bus
 *      already swallows handler errors, so this is belt-and-suspenders.
 *
 *   2. **Missing-table tolerant.** Until the operator runs the migration the
 *      INSERT raises 42P01 (undefined_table); we downgrade to a single
 *      warning rather than spamming the logs on every download.
 *
 *   3. **Org context.** The handler runs inside the originating request's
 *      AsyncLocalStorage scope (publish is called synchronously in-request,
 *      exactly like DOCUMENT_UPLOADED), so config/database.applyRequestContext
 *      sets app.current_organization_id on the connection and the RLS
 *      WITH CHECK passes — the same mechanism the dealEvents sink relies on.
 *      We ALSO pass organization_id explicitly from the payload so the stored
 *      value is authoritative and not dependent on a DB function.
 *
 * Tests: documentAccessLog.sink.test.js
 */

const { EVENTS, subscribe } = require('../lib/eventBus');
const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'documentAccessLog.sink' });

// Closed vocabularies. Free-form VARCHAR at the DB layer; normalised here so
// an unexpected value can never land an un-mappable string in the audit trail.
const VALID_ACTIONS = new Set(['signed_url', 'download']);
const VALID_KINDS = new Set(['deal_document', 'masterplan_source']);

const IP_MAX = 100; // generous: IPv6 + a couple of forwarded hops
const UA_MAX = 1000;

let warnedMissingTable = false;

/**
 * Persist one document-access audit row. Fail-open: never throws. Returns the
 * inserted row id on success, null on any failure (including the
 * migration-not-applied case). Exported for direct unit testing.
 */
const writeAccessRow = async (payload = {}) => {
  const {
    documentId,
    organizationId = null,
    userId = null,
    action,
    documentKind = 'deal_document',
    documentName = null,
    dealId = null,
    ip = null,
    userAgent = null,
    metadata = {},
  } = payload || {};

  // Minimum viable audit row: we must know which document and what action.
  if (!documentId || !action) {
    log.warn('document_access_log_skipped_incomplete', {
      has_document: Boolean(documentId),
      has_action: Boolean(action),
    });
    return null;
  }

  const safeAction = VALID_ACTIONS.has(action) ? action : 'download';
  const safeKind = VALID_KINDS.has(documentKind) ? documentKind : 'deal_document';

  try {
    const result = await query(
      `INSERT INTO document_access_log (
         organization_id, document_id, document_kind, document_name,
         deal_id, user_id, action, ip_address, user_agent, metadata
       ) VALUES (
         COALESCE($1, current_organization_id()),
         $2, $3, $4, $5, $6, $7, $8, $9, $10
       )
       RETURNING id`,
      [
        organizationId || null,
        documentId,
        safeKind,
        documentName,
        dealId,
        userId,
        safeAction,
        ip ? String(ip).slice(0, IP_MAX) : null,
        userAgent ? String(userAgent).slice(0, UA_MAX) : null,
        JSON.stringify(metadata || {}),
      ],
    );
    return result?.rows?.[0]?.id || null;
  } catch (err) {
    if (err && err.code === '42P01') {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        log.warn('document_access_log_table_missing', {
          message:
            'document_access_log table not found — run the migration. '
            + 'Access events are not persisted until then.',
        });
      }
      return null;
    }
    // Any other DB error: log + return null. A download must NEVER fail
    // because its audit insert blew up — the access already happened.
    log.warn('document_access_log_write_failed', {
      error: err.message,
      document_id: documentId,
      action: safeAction,
    });
    return null;
  }
};

let registered = false;
let unsubscribe = null;

const register = () => {
  if (registered) return;
  registered = true;
  unsubscribe = subscribe(EVENTS.DOCUMENT_ACCESSED, writeAccessRow);
  log.info('document_access_log_sink_registered');
};

const unregister = () => {
  // Mostly used in tests so the bus is reset between specs.
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch {
      /* swallow — already detached */
    }
    unsubscribe = null;
  }
  registered = false;
};

module.exports = {
  register,
  unregister,
  // Exported for tests.
  writeAccessRow,
  VALID_ACTIONS,
  VALID_KINDS,
};
