'use strict';

/**
 * Domain-event sink for the deal timeline.
 *
 * Subscribes to every meaningful event published on `eventBus` and writes a
 * matching row into the `activities` table so the deal timeline becomes a
 * truthful audit log without each individual mutation having to remember to
 * call `logActivity()`.
 *
 * Why this lives as a separate sink rather than inline in each service:
 *   - One place to tune copy / icon-tone / type mapping when it changes.
 *   - One place to silence an event class if it becomes too noisy.
 *   - Failures don't break the originating mutation (eventBus swallows them).
 *
 * Activity types come from `ACTIVITY_TYPES` in constants/domain.js. Where the
 * domain enum doesn't have an exact match, we use the closest fit and stash
 * the precise event name in the description so a power user can still grep.
 */

const { query } = require('../config/database');
const { EVENTS, subscribe } = require('../lib/eventBus');
const { ACTIVITY_TYPES } = require('../constants/domain');
const log = require('../lib/logger').child({ module: 'deal.events' });

// Insert directly rather than going through activity.service.logActivity:
// - logActivity does its own deal-visibility check via current_organization_id(),
//   which fires under whatever request context the originating call ran in.
//   That's exactly what we want here — same RLS scope, no privilege escalation.
// - Because this sink bypasses the activity service's validation, writeActivity
//   below enforces ACTIVITY_TYPES itself. (An earlier version of this comment
//   claimed "we use only validated values below" while a handler emitted
//   'document_upload' — a value the DB enum never had. Every document upload
//   from 2026-07-17 to 2026-08-01 lost its timeline row to that 22P02.)
const writeActivity = async ({
  dealId,
  type,
  description,
  performedBy = null,
  isImportant = false,
  status = 'completed',
  priority = 'low',
}) => {
  if (!dealId || !type || !description) return null;

  // Derive the completion columns in JS rather than with SQL CASE expressions.
  //
  // This is not a style choice — the CASE form was BROKEN from the day it
  // shipped (2026-03-27 → 2026-07-17), and silently: it wrote
  //     VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7,
  //             CASE WHEN $6 = 'completed' THEN NOW() ELSE NULL END,
  //             CASE WHEN $6 = 'completed' THEN $4 ELSE NULL END)
  // `$4` sits in the `performed_by` slot, so Postgres deduces uuid — but it
  // ALSO appears inside a CASE whose arms are `$4` and `NULL`, i.e. both
  // untyped. With no typed arm to anchor on, Postgres resolves that CASE to
  // `text` and deduces `$4::text`, which contradicts the uuid. Every call
  // therefore died at PARSE time with `42P08 inconsistent types deduced for
  // parameter $4` — reproduced verbatim against the production database.
  //
  // Because the write is fail-soft (see the catch below), the originating
  // mutation still succeeded and nobody noticed: the deal timeline simply
  // never gained a single automatic row. All ELEVEN event types this sink
  // subscribes to — stage changes, approvals, risk flags, DD items, uploads,
  // extractions, financial scenarios — were lost. CLAUDE.md calls that audit
  // trail "non-negotiable for investor-grade reporting".
  //
  // Computing these in JS mirrors what activity.service.logActivity already
  // does (see its `completedAt` / `completedBy`), removes the parameter reuse
  // entirely, and leaves every placeholder in exactly one type context.
  const isCompleted = status === 'completed';
  const completedAt = isCompleted ? new Date() : null;
  const completedBy = isCompleted ? performedBy : null;

  // activities.activity_type is a CLOSED Postgres enum. A value outside it
  // fails at bind time (22P02) and the audit row is lost — the exact way
  // document uploads vanished from timelines for two weeks. Coerce to
  // 'note' so the row always lands, and log at ERROR so the drift still
  // reaches the production dashboard instead of hiding behind the coercion.
  let safeType = type;
  if (!ACTIVITY_TYPES.includes(safeType)) {
    log.error('auto_activity_unknown_type_coerced', {
      deal_id: dealId,
      emitted_type: safeType,
    });
    safeType = 'note';
  }

  try {
    const result = await query(
      `INSERT INTO activities (
         deal_id, activity_type, description, performed_by, activity_date,
         is_important, status, priority, completed_at, completed_by
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        dealId,
        safeType,
        description.length > 1000 ? description.slice(0, 997) + '...' : description,
        performedBy,
        isImportant,
        status,
        priority,
        completedAt,
        completedBy,
      ]
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    // Fail-soft is deliberate: a timeline row must never break the mutation
    // that triggered it. But log at ERROR — a permanently-failing audit write
    // is exactly the thing that must reach the error dashboard, not sit in
    // warnings where it hid for four months.
    log.error('auto_activity_write_failed', err, {
      deal_id: dealId,
      type,
    });
    return null;
  }
};

const trim = (value, max = 240) => {
  if (value == null) return '';
  const str = String(value);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};

const handlers = [
  [
    EVENTS.DEAL_STAGE_CHANGED,
    async ({ dealId, fromStage, toStage, userId }) => {
      await writeActivity({
        dealId,
        type: 'note',
        description: `Stage changed: ${trim(fromStage) || 'unset'} → ${trim(toStage)}`,
        performedBy: userId,
        isImportant: true,
        priority: 'medium',
      });
    },
  ],
  [
    EVENTS.DEAL_CREATED,
    async ({ dealId, dealName, userId }) => {
      await writeActivity({
        dealId,
        type: 'note',
        description: `Deal created: ${trim(dealName) || 'New deal'}`,
        performedBy: userId,
        isImportant: false,
        priority: 'low',
      });
    },
  ],
  [
    EVENTS.DEAL_ARCHIVED,
    async ({ dealId, userId, reason }) => {
      await writeActivity({
        dealId,
        type: 'note',
        description: `Deal archived${reason ? `: ${trim(reason)}` : ''}`,
        performedBy: userId,
        isImportant: true,
        priority: 'medium',
      });
    },
  ],
  [
    EVENTS.DOCUMENT_UPLOADED,
    async ({ dealId, documentName, documentCategory, userId }) => {
      if (!dealId) return;
      await writeActivity({
        dealId,
        // 'note' like every other system-generated row — the enum has no
        // 'document_upload' member and never did; emitting one cost every
        // upload its timeline row (22P02, 2026-07-17 → 2026-08-01). The
        // specifics live in the description, per this file's own contract.
        type: 'note',
        description: `Document uploaded: ${trim(documentName)}${documentCategory ? ` (${documentCategory})` : ''}`,
        performedBy: userId,
        priority: 'low',
      });
    },
  ],
  [
    EVENTS.DOCUMENT_EXTRACTED,
    async ({ dealId, documentName, docType, userId }) => {
      if (!dealId) return;
      await writeActivity({
        dealId,
        type: 'note',
        description: `Document extracted (${trim(docType) || 'unknown type'}): ${trim(documentName)}`,
        performedBy: userId,
        priority: 'low',
      });
    },
  ],
  [
    EVENTS.DD_ITEM_STATUS_CHANGED,
    async ({ dealId, itemName, status, severity, userId }) => {
      if (!dealId) return;
      await writeActivity({
        dealId,
        type: 'note',
        description: `DD item ${trim(status)}: ${trim(itemName)}`,
        performedBy: userId,
        isImportant: severity === 'deal_breaker' || severity === 'buildability_blocker',
        priority: severity === 'deal_breaker' ? 'high' : 'medium',
      });
    },
  ],
  [
    EVENTS.APPROVAL_STATUS_CHANGED,
    async ({ dealId, approvalName, status, userId }) => {
      if (!dealId) return;
      await writeActivity({
        dealId,
        type: 'note',
        description: `Approval ${trim(status)}: ${trim(approvalName)}`,
        performedBy: userId,
        priority: 'medium',
      });
    },
  ],
  [
    EVENTS.RISK_FLAG_STATUS_CHANGED,
    async ({ dealId, title, severity, status, userId }) => {
      if (!dealId) return;
      await writeActivity({
        dealId,
        type: 'note',
        description: `Risk ${trim(severity) || ''} ${trim(status)}: ${trim(title)}`,
        performedBy: userId,
        isImportant: severity === 'critical' || severity === 'high',
        priority: severity === 'critical' ? 'high' : 'medium',
      });
    },
  ],
  [
    EVENTS.PARCEL_INTELLIGENCE_REFRESHED,
    async ({ dealId, propertyId, userId, summary }) => {
      // A property may be linked to multiple deals (rare, but possible during
      // co-investment or comparison). Fan the activity row out to each.
      const dealIds = [];
      if (dealId) {
        dealIds.push(dealId);
      } else if (propertyId) {
        try {
          const r = await query(
            `SELECT id FROM deals
             WHERE property_id = $1
               AND organization_id = current_organization_id()
               AND is_archived = FALSE
               AND stage <> 'dead'`,
            [propertyId]
          );
          for (const row of r.rows) dealIds.push(row.id);
        } catch (err) {
          log.warn('parcel_refresh_deal_lookup_failed', { property_id: propertyId, error: err.message });
        }
      }
      for (const id of dealIds) {
        await writeActivity({
          dealId: id,
          type: 'note',
          description: `Parcel intelligence refreshed${summary ? `: ${trim(summary)}` : ''}`,
          performedBy: userId,
          priority: 'low',
        });
      }
    },
  ],
  [
    EVENTS.EVIDENCE_LINKED,
    async ({ dealId, ownerKind, linkKind, userId }) => {
      if (!dealId) return;
      // Was: "Evidence linked (document → dd_item)" — readable to
      // engineers, opaque to investors reading the timeline. Translate
      // into plain English so the audit trail tells a story.
      const KIND_LABEL = {
        document: 'a document',
        manual_verification: 'a manual verification',
        external_url: 'an external reference',
        evidence_source: 'a source document',
        evidence_fact: 'an extracted fact',
      };
      const OWNER_LABEL = {
        dd_item: 'a DD item',
        approval: 'an approval',
        risk_flag: 'a risk flag',
        comp: 'a comparable',
        financial_scenario: 'a financial scenario',
        parcel_intelligence: 'the parcel record',
        deal_note: 'a deal note',
        guidance_value: 'a guidance value',
      };
      const kind = KIND_LABEL[linkKind] || 'evidence';
      const owner = OWNER_LABEL[ownerKind] || 'an item on this deal';
      await writeActivity({
        dealId,
        type: 'note',
        description: `Linked ${kind} to ${owner}`,
        performedBy: userId,
        priority: 'low',
      });
    },
  ],
  [
    EVENTS.FINANCIAL_SCENARIO_SAVED,
    async ({ dealId, scenarioName, userId }) => {
      if (!dealId) return;
      await writeActivity({
        dealId,
        type: 'note',
        description: `Financial scenario saved: ${trim(scenarioName) || 'Scenario'}`,
        performedBy: userId,
        priority: 'low',
      });
    },
  ],
];

let registered = false;
let unsubscribers = [];

const register = () => {
  if (registered) return;
  registered = true;
  unsubscribers = handlers.map(([eventName, handler]) =>
    subscribe(eventName, handler)
  );
  log.info('deal_event_sink_registered', { event_count: handlers.length });
};

const unregister = () => {
  // Mostly used in tests so the bus is reset between specs.
  unsubscribers.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      log.warn('deal_event_sink_unregister_failed', { error: err.message });
    }
  });
  unsubscribers = [];
  registered = false;
};

module.exports = {
  register,
  unregister,
  // Exposed for tests and dashboards.
  _handlers: handlers,
  _writeActivity: writeActivity,
};
