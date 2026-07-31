'use strict';

/**
 * Post-response background work that actually survives on serverless.
 *
 * Why this exists
 * ---------------
 * A bare `promise.catch(...)` after `res.json()` is NOT a background job on
 * Vercel. Once the response is flushed the platform is free to freeze or
 * reclaim the instance, so unawaited work may never run — and because the
 * pattern swallows its own errors, that looks identical to success. Vercel's
 * `waitUntil` is the supported way to say "keep this instance alive until this
 * settles".
 *
 * The idiom lived inline in masterplan.routes.js. Two other call sites needed
 * it, so it lives here once, with the failure handling those copies lacked.
 *
 * Behaviour
 * ---------
 *   • On Vercel: registered with `waitUntil` — the instance stays warm.
 *   • Elsewhere (local, tests): left unawaited; Node drains the event loop.
 *   • Rejections are ALWAYS logged and reported to Sentry with a stable
 *     fingerprint per task name. Background work has no request to fail, so
 *     without explicit capture a broken job is completely invisible — the
 *     exact shape of failure that let the document index sit empty while
 *     every upload reported success.
 *
 * Request context (AsyncLocalStorage) propagates into the promise, so DB calls
 * inside the task still resolve the tenant for RLS — provided the promise is
 * CREATED inside the request scope. Create it at the call site, not in here.
 */

const log = require('./logger').child({ module: 'background_task' });
const { Sentry, isEnabled } = require('./sentry');

// Resolved once at module load. Absent outside Vercel, which is expected.
let waitUntil = null;
try {
  // eslint-disable-next-line global-require
  ({ waitUntil } = require('@vercel/functions'));
} catch {
  // Not installed / not on Vercel — the unawaited fallback below is correct.
}

/**
 * Run an already-created promise as post-response background work.
 *
 * @param {string}  name    Stable identifier, used for logs + Sentry grouping.
 * @param {Promise} promise Work already in flight (create it in request scope).
 * @param {object} [context] Extra structured fields for the failure log.
 * @returns {Promise} the same promise, already guarded — safe to ignore.
 */
const runInBackground = (name, promise, context = {}) => {
  if (!promise || typeof promise.then !== 'function') {
    log.warn('background_task_not_a_promise', { task: name });
    return Promise.resolve();
  }

  const guarded = promise.catch((err) => {
    log.error('background_task_failed', err, { task: name, ...context });
    if (isEnabled()) {
      Sentry.captureException(err, {
        tags: { subsystem: 'background_task', task: name },
        // One issue per task type rather than one per occurrence.
        fingerprint: ['background-task', name],
        extra: context,
      });
    }
    // Swallowed deliberately: the response has already been sent, so there is
    // nobody left to reject to. The log + Sentry capture above ARE the report.
  });

  if (typeof waitUntil === 'function') {
    try {
      waitUntil(guarded);
    } catch {
      // waitUntil can throw if called outside a request scope; the promise is
      // already running and guarded, so let it finish unawaited.
    }
  }

  return guarded;
};

// True when post-response work is guaranteed to be kept alive. Callers that
// must not lose the work (rather than merely preferring not to) can use this
// to decide to await inline instead.
const isBackgroundDurable = () => typeof waitUntil === 'function';

module.exports = { runInBackground, isBackgroundDurable };
