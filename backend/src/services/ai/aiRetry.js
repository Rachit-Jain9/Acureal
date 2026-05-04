'use strict';

/**
 * AI provider retry helper with exponential backoff + jitter.
 *
 * Provider 5xxs, transient timeouts, and network blips are common enough
 * that re-running the same call once or twice frequently succeeds. Until
 * now `aiRouter.runAI` ran the request exactly once and propagated the
 * first error — which meant a single Gemini hiccup blew up an entire
 * extraction batch.
 *
 * Retry policy (defaults):
 *   • 3 attempts total (1 initial + 2 retries)
 *   • Base 250ms backoff, doubling each attempt, capped at 4s
 *   • ±25% jitter on each delay so concurrent retries don't pile up
 *   • Only retry on transient signals — never on 4xx, never on parse errors
 *
 * `isRetriableProviderError` is conservative on purpose: when in doubt,
 * we DO NOT retry. That keeps us from quietly burning credits on a prompt
 * the model is going to refuse anyway. False negatives cost the user one
 * failure they could ignore; false positives cost real money.
 */

const log = require('../../lib/logger').child({ module: 'ai.retry' });

const DEFAULT_RETRY_OPTIONS = {
  attempts: 3,
  baseMs: 250,
  maxMs: 4000,
  jitter: 0.25,
};

// Provider error classifier. Returns true for transient signals only.
//   • Status codes >= 500 (server-side hiccup, retry)
//   • Status 429 (rate-limited; provider tells us to wait → retry with backoff)
//   • Network-level codes: ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN
//   • Node TimeoutError name
// Explicitly returns false for:
//   • 4xx other than 429 (auth, bad request, content policy → bug, retry won't help)
//   • undefined / null (unknown shape; default to safe)
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNREFUSED']);

const isRetriableProviderError = (err) => {
  if (!err) return false;
  // Anthropic SDK exposes `.status`; Google SDK exposes `.statusCode`/`.code`.
  const status =
    err.status ?? err.statusCode ?? (typeof err.response?.status === 'number' ? err.response.status : null);
  if (typeof status === 'number') {
    if (status >= 500) return true;   // 5xx → retry
    if (status === 429) return true;  // rate-limited → retry with backoff
    return false;                     // any other 4xx → bug, do not retry
  }
  // Network-level signals
  const code = err.code || err.errno || null;
  if (typeof code === 'string' && NETWORK_CODES.has(code.toUpperCase())) return true;
  if (err.name === 'TimeoutError') return true;
  // Aborted fetches surface as DOMException name=AbortError — those are typically
  // intentional (caller bailed). Don't retry.
  if (err.name === 'AbortError') return false;
  // Default: don't retry an unknown shape. Better one extra failure than a
  // runaway loop on a permanent error.
  return false;
};

const computeDelay = ({ attempt, baseMs, maxMs, jitter }) => {
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  const j = jitter > 0 ? exp * jitter * (Math.random() * 2 - 1) : 0;
  return Math.max(0, Math.round(exp + j));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with retry. Returns the function's resolved value on success.
 * Throws the LAST error if all attempts fail.
 *
 * @param {Function} fn         async function to invoke; receives `{ attempt }`
 * @param {Object=}  options    { attempts, baseMs, maxMs, jitter, isRetriable, onRetry }
 *                              `isRetriable(err)` defaults to `isRetriableProviderError`.
 *                              `onRetry({ err, attempt, delayMs })` is invoked before the
 *                              backoff; useful for telemetry.
 */
const withRetry = async (fn, options = {}) => {
  const cfg = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const isRetriable = options.isRetriable || isRetriableProviderError;
  let lastErr = null;

  for (let attempt = 1; attempt <= cfg.attempts; attempt += 1) {
    try {
      return await fn({ attempt });
    } catch (err) {
      lastErr = err;
      const isLast = attempt >= cfg.attempts;
      if (isLast || !isRetriable(err)) {
        throw err;
      }
      const delayMs = computeDelay({
        attempt,
        baseMs: cfg.baseMs,
        maxMs: cfg.maxMs,
        jitter: cfg.jitter,
      });
      if (typeof options.onRetry === 'function') {
        try {
          options.onRetry({ err, attempt, delayMs });
        } catch (hookErr) {
          log.warn('retry_hook_threw', { error: hookErr.message });
        }
      } else {
        log.info('ai_call_retrying', {
          attempt,
          next_delay_ms: delayMs,
          error_code: err.code || err.name || null,
          error_status: err.status || err.statusCode || null,
        });
      }
      await sleep(delayMs);
    }
  }
  // Defensive — loop above always either returns or throws, but TS-style
  // exhaustiveness doesn't apply here so keep an explicit throw.
  throw lastErr;
};

module.exports = {
  withRetry,
  isRetriableProviderError,
  computeDelay,
  DEFAULT_RETRY_OPTIONS,
};
