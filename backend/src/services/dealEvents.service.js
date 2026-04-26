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
const log = require('../lib/logger').child({ module: 'deal.events' });

// Insert directly rather than going through activity.service.logActivity:
// - logActivity does its own deal-visibility check via current_organization_id(),
//   which fires under whatever request context the originating call ran in.
//   That's exactly what we want here — same RLS scope, no privilege escalation.
// - The activity service validates the activity_type against ACTIVITY_TYPES.
//   We use only validated values below.
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
  try {
    const result = await query(
      `INSERT INTO activities (
         deal_id, activity_type, description, performed_by, activity_date,
         is_important, status, priority, completed_at, completed_by
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7,
               CASE WHEN $6 = 'completed' THEN NOW() ELSE NULL END,
               CASE WHEN $6 = 'completed' THEN $4 ELSE NULL END)
       RETURNING id`,
      [
        dealId,
        type,
        description.length > 1000 ? description.slice(0, 997) + '...' : description,
        performedBy,
        isImportant,
        status,
        priority,
      ]
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    log.warn('auto_activity_write_failed', {
      error: err.message,
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
        type: 'document_upload',
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
      await writeActivity({
        dealId,
        type: 'note',
        description: `Evidence linked (${trim(linkKind)} → ${trim(ownerKind)})`,
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
};
