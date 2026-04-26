'use strict';

/**
 * Assigns a request_id to every incoming request.
 *
 * - Honors an existing X-Request-Id header (so a frontend / load-balancer trace
 *   id propagates end-to-end).
 * - Otherwise generates a stable, log-friendly id (12 base36 chars + ms suffix).
 * - Echoes the id back as X-Request-Id so a client can correlate logs.
 * - Stashes the id (and a `start` timestamp) into the AsyncLocalStorage request
 *   context so every downstream log line auto-tags itself.
 *
 * Mounted before auth so anonymous failures (401, CORS, rate limit) still get
 * a request id in the logs.
 */

const { setRequestContext } = require('../lib/requestContext');
const log = require('../lib/logger').child({ module: 'http' });

const MAX_HEADER_LEN = 64;
const SAFE_RE = /^[A-Za-z0-9_\-:.+/=]+$/;

const generateRequestId = () => {
  // 12 chars of base36 entropy + ms timestamp ≈ 50 bits; collision-free for
  // any realistic burst, short enough to read in a terminal.
  const rand = Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  return `${rand}-${Date.now().toString(36)}`;
};

const requestIdMiddleware = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const safeIncoming = incoming
    && typeof incoming === 'string'
    && incoming.length <= MAX_HEADER_LEN
    && SAFE_RE.test(incoming)
    ? incoming
    : null;

  const requestId = safeIncoming || generateRequestId();
  req.id = requestId;

  res.setHeader('x-request-id', requestId);
  setRequestContext({ requestId, start: Date.now() });

  next();
};

const requestLoggingMiddleware = (req, res, next) => {
  // Skip noise for health probes — Vercel and uptime checks hammer these.
  if (req.path === '/api/health' || req.path === '/api/health/' || req.path === '/api/health/detailed') {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const tone = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[tone]('http_request', {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: durationMs,
    });
  });

  next();
};

module.exports = {
  requestIdMiddleware,
  requestLoggingMiddleware,
  generateRequestId,
};
