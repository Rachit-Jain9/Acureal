'use strict';

/**
 * Auto-detect cross-document inconsistencies on every successful extraction.
 *
 * Subscribes to `EVENTS.DOCUMENT_EXTRACTED` (published by extraction.service
 * the moment Gemini finishes a doc). Pulls the deal id off the event payload
 * and runs `inconsistencyDetector.detectAndPersist(dealId)` fire-and-forget —
 * findings land as risk_flags (source='ai_detector'), the Deal Doctor
 * surfaces them via the `cross_document_inconsistencies` signal on next
 * workspace load, and the Risk Radar picks them up.
 *
 * Three guardrails:
 *
 *   1. **Org context restore.** The event-bus fires async, outside the
 *      original HTTP request, so the AsyncLocalStorage request context is
 *      empty. The detector + risk_service rely on tenant scoping via
 *      `current_organization_id()` — so we look up the org from the deal
 *      row and run the detector inside `runWithRequestContext`, which makes
 *      every tenant-scoped `query()` SET LOCAL the org per-transaction
 *      (see database.js). Without this the org-scoped writes match nothing.
 *
 *   2. **Debounce per (deal, 90s window).** When the operator uploads N docs
 *      in quick succession the detector would re-run N times on roughly the
 *      same input. Debouncing collapses bursts to one detector pass at the
 *      end of the window — same final-state findings, 1/N AI cost.
 *
 *   3. **Fail-open.** A failed detector run logs + moves on. Never throws.
 *      The extraction itself is already persisted by the time we get the
 *      event; whether the detector succeeded is a separate concern.
 *
 * Tests: `inconsistencyDetectorSink.test.js`.
 */

const { EVENTS, subscribe } = require('../lib/eventBus');
const { query } = require('../config/database');
const { runWithRequestContext } = require('../lib/requestContext');
const log = require('../lib/logger').child({ module: 'inconsistencyDetector.sink' });

// Lazy-required so a test that mocks the detector doesn't import it
// transitively through this file's top-level chain.
const getDetector = () => require('./inconsistencyDetector.service');

const DEBOUNCE_MS = 90 * 1000;

// In-process debounce map: deal_id → { timer, latestUserId, latestEventTs }.
// Multi-process deploys would need a Redis-backed debounce, but at REDIP's
// current scale (single Vercel function instance per request) in-memory is
// the right complexity.
const pending = new Map();

const resolveOrg = async (dealId) => {
  if (!dealId) return null;
  try {
    const res = await query(
      'SELECT organization_id, name FROM deals WHERE id = $1 LIMIT 1',
      [dealId],
    );
    return res.rows[0] || null;
  } catch (err) {
    log.warn('inconsistency_sink_org_lookup_failed', { deal_id: dealId, error: err.message });
    return null;
  }
};

const runDetectorScoped = async ({ dealId, userId, organizationId, dealName }) => {
  if (!dealId || !organizationId) return;
  try {
    // Establish the org context the tenant-scoped queries in the detector +
    // risk_service expect. Every query() SET LOCALs the ALS context inside its
    // own transaction (post-#951), so a manual BEGIN/set_config/COMMIT here
    // would be a no-op — the request context is the real carrier.
    await runWithRequestContext(
      { organizationId: String(organizationId), userId: userId || null },
      () => getDetector().detectAndPersist(dealId, { userId, dealName, organizationId }),
    );
    log.info('inconsistency_sink_run_completed', { deal_id: dealId });
  } catch (err) {
    log.warn('inconsistency_sink_run_failed', { deal_id: dealId, error: err.message });
  }
};

const scheduleRun = ({ dealId, userId }) => {
  if (!dealId) return;
  const existing = pending.get(dealId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.latestUserId = userId || existing.latestUserId;
    existing.latestEventTs = Date.now();
  }
  const slot = {
    latestUserId: userId || (existing?.latestUserId ?? null),
    latestEventTs: Date.now(),
    timer: null,
  };
  slot.timer = setTimeout(async () => {
    try {
      pending.delete(dealId);
      const dealRow = await resolveOrg(dealId);
      if (!dealRow || !dealRow.organization_id) {
        log.info('inconsistency_sink_skipped_no_org', { deal_id: dealId });
        return;
      }
      await runDetectorScoped({
        dealId,
        userId: slot.latestUserId,
        organizationId: dealRow.organization_id,
        dealName: dealRow.name || null,
      });
    } catch (err) {
      // Detached debounce callback: an unhandled rejection here would be an
      // uncaught background error. Keep the "never throws" contract explicit.
      log.warn('inconsistency_sink_debounce_error', { deal_id: dealId, error: err.message });
    }
  }, DEBOUNCE_MS);
  pending.set(dealId, slot);
};

let registered = false;
let unsubscribe = null;

const register = () => {
  if (registered) return;
  registered = true;
  unsubscribe = subscribe(EVENTS.DOCUMENT_EXTRACTED, (payload) => {
    if (!payload || !payload.dealId) return; // doc uploaded with no deal — nothing to detect across
    if (payload.status === 'failed') return; // failed extractions have nothing to compare
    scheduleRun({ dealId: payload.dealId, userId: payload.userId || null });
  });
  log.info('inconsistency_detector_sink_registered');
};

const unregister = () => {
  if (unsubscribe) {
    try { unsubscribe(); } catch { /* swallow */ }
    unsubscribe = null;
  }
  for (const slot of pending.values()) {
    clearTimeout(slot.timer);
  }
  pending.clear();
  registered = false;
};

module.exports = {
  register,
  unregister,
  // Exported for tests
  DEBOUNCE_MS,
  scheduleRun,
  _pendingSize: () => pending.size,
};
