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
//   • Gemini message-string patterns (fallback for SDK-wrapped errors that
//     don't expose `.status` directly — e.g., "RESOURCE_EXHAUSTED",
//     "UNAVAILABLE", "high demand", or an HTTP code embedded in the message)
// Explicitly returns false for:
//   • 4xx other than 429 (auth, bad request, content policy → bug, retry won't help)
//   • Permission denied / Invalid argument message patterns
//   • undefined / null (unknown shape; default to safe)
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNREFUSED']);

// Message-string patterns that Gemini and other providers emit when the
// underlying transport hiccups but the structured `.status` / `.code` props
// are missing. Order: 5xx HTTP codes embedded in the message, transient
// service-state strings, fetch-level network words.
const TRANSIENT_MESSAGE_PATTERNS = [
  /\b(429|500|502|503|504)\b/,
  /high demand/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /resource[_\s]exhausted/i,
  /\bunavailable\b/i,
  /fetch failed/i,
  /timed out after/i,
  // No trailing \b — codes like ECONNRESET are one word, "econn" matches
  // the prefix and there's no separator before "RESET".
  /\b(econn|etimedout|enetdown|eai_again|enotfound)/i,
];

// Message-string patterns that look transient but are actually permanent —
// caller error or auth problem. These short-circuit the retry decision so a
// 4xx that happens to mention a 5xx-ish word doesn't get retried.
const PERMANENT_MESSAGE_PATTERNS = [
  /\b40[0-9]\b/,                   // 4xx HTTP codes
  /permission denied/i,
  /invalid (?:argument|request)/i,
  /not found/i,
  /authentication/i,
  /unauthorized/i,
];

const messageMatches = (msg, patterns) => {
  if (typeof msg !== 'string' || !msg) return false;
  return patterns.some((re) => re.test(msg));
};

const isRetriableProviderError = (err) => {
  if (!err) return false;
  // Anthropic SDK exposes `.status`; Google SDK exposes `.status` on
  // GoogleGenerativeAIFetchError. Also support the older `.statusCode` and
  // axios-style `.response.status`.
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
  // Fallback: parse the message string. Lets us catch SDK-wrapped errors
  // where the structured props were lost in translation. Permanent patterns
  // win over transient ones — a "400 Invalid argument" should not retry
  // even though "400" technically matches no transient pattern. (We list 4xx
  // explicitly in the permanent set for safety.)
  const msg = err.message || '';
  if (messageMatches(msg, PERMANENT_MESSAGE_PATTERNS)) return false;
  if (messageMatches(msg, TRANSIENT_MESSAGE_PATTERNS)) return true;
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
