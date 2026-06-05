'use strict';

/**
 * Tiny in-process event bus for domain events.
 *
 * Why not Node's built-in EventEmitter?
 *   - We need *async* handlers that don't crash the request when one fails.
 *   - We want a small, opinionated surface (publish, subscribe, list) rather
 *     than the full Emitter API.
 *   - Test isolation: `clearAllSubscribers()` lets tests reset the bus.
 *
 * Events are intentionally fire-and-forget from the publisher's perspective.
 * Handlers are awaited in `Promise.all` so they all run, but a failure in one
 * handler is logged (with request_id correlation) and does NOT propagate to
 * the publisher. This keeps the rule "logging the activity must never break
 * the operation that produced it."
 *
 * Event payload contract:
 *   {
 *     dealId?:  uuid,
 *     userId?:  uuid,
 *     orgId?:   uuid,
 *     ...freeform domain fields
 *   }
 *
 * Subscribers receive the full payload plus the event name and an
 * `emittedAt` timestamp.
 */

const log = require('./logger').child({ module: 'event.bus' });

const subscribers = new Map();

const subscribe = (eventName, handler) => {
  if (typeof eventName !== 'string' || !eventName) {
    throw new Error('eventBus.subscribe: eventName must be a non-empty string.');
  }
  if (typeof handler !== 'function') {
    throw new Error('eventBus.subscribe: handler must be a function.');
  }
  if (!subscribers.has(eventName)) {
    subscribers.set(eventName, new Set());
  }
  subscribers.get(eventName).add(handler);
  return () => {
    const set = subscribers.get(eventName);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) subscribers.delete(eventName);
  };
};

const publish = async (eventName, payload = {}) => {
  const handlers = subscribers.get(eventName);
  if (!handlers || handlers.size === 0) return { delivered: 0 };

  const enriched = {
    ...payload,
    event: eventName,
    emittedAt: new Date().toISOString(),
  };

  const results = await Promise.all(
    Array.from(handlers).map(async (handler) => {
      try {
        await handler(enriched);
        return { ok: true };
      } catch (err) {
        log.warn('event_handler_failed', {
          event: eventName,
          handler: handler.name || 'anonymous',
          error: err.message,
        });
        return { ok: false, error: err.message };
      }
    })
  );

  const delivered = results.filter((r) => r.ok).length;
  return { delivered, failed: handlers.size - delivered };
};

const list = () => {
  const out = {};
  for (const [name, set] of subscribers.entries()) {
    out[name] = set.size;
  }
  return out;
};

const clearAllSubscribers = () => {
  subscribers.clear();
};

// ────────────────────────────────────────────────────────────────────────────
// Canonical event names — keep these stable. Adding a new one is fine; renaming
// or repurposing is a breaking change for any downstream subscriber, including
// future external integrations.
// ────────────────────────────────────────────────────────────────────────────

const EVENTS = Object.freeze({
  DEAL_STAGE_CHANGED:        'deal.stage_changed',
  DEAL_CREATED:              'deal.created',
  DEAL_ARCHIVED:             'deal.archived',
  DOCUMENT_UPLOADED:         'document.uploaded',
  DOCUMENT_EXTRACTED:        'document.extracted',
  DOCUMENT_ACCESSED:         'document.accessed',
  DD_ITEM_STATUS_CHANGED:    'dd_item.status_changed',
  APPROVAL_STATUS_CHANGED:   'approval.status_changed',
  SIGNOFF_STATUS_CHANGED:    'signoff.status_changed',
  RISK_FLAG_STATUS_CHANGED:  'risk_flag.status_changed',
  PARCEL_INTELLIGENCE_REFRESHED: 'parcel_intelligence.refreshed',
  EVIDENCE_LINKED:           'evidence.linked',
  FINANCIAL_SCENARIO_SAVED:  'financial_scenario.saved',
});

module.exports = {
  EVENTS,
  subscribe,
  publish,
  list,
  clearAllSubscribers,
};
