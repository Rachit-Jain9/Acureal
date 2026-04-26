'use strict';

/**
 * Lightweight structured logger.
 *
 * Why a hand-rolled logger and not pino?
 *   - No new dependency to ship through Vercel + supabase + vitest matrix.
 *   - Output format is JSON in production (machine-readable, ingest-friendly)
 *     and human-friendly in development.
 *   - Auto-merges request context (request_id, user_id, organization_id, role)
 *     from AsyncLocalStorage so callers do not have to thread it manually.
 *
 * Usage:
 *   const log = require('../lib/logger').child({ module: 'parcel.intelligence' });
 *   log.info('refreshed', { propertyId, durationMs });
 *   log.warn('low_confidence', { score });
 *   log.error('kgis_failed', err, { propertyId });
 *
 * Configuration:
 *   LOG_LEVEL  trace | debug | info | warn | error  (default: info)
 *   LOG_FORMAT json | pretty                         (default: pretty in dev, json elsewhere)
 *
 * The logger is also a no-op-friendly drop-in for tests: NODE_ENV=test silences
 * everything below `warn` to keep CI output clean.
 */

const { getRequestContext } = require('./requestContext');

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 99 };

const resolveLevel = () => {
  const envLevel = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (envLevel && LEVELS[envLevel] !== undefined) return LEVELS[envLevel];
  if (process.env.NODE_ENV === 'test') return LEVELS.warn;
  if (process.env.NODE_ENV === 'production') return LEVELS.info;
  return LEVELS.debug;
};

const resolveFormat = () => {
  const fmt = String(process.env.LOG_FORMAT || '').toLowerCase();
  if (fmt === 'json' || fmt === 'pretty') return fmt;
  return process.env.NODE_ENV === 'production' || process.env.VERCEL ? 'json' : 'pretty';
};

const PROD_FORMAT = resolveFormat();
const ACTIVE_LEVEL = resolveLevel();

const PRETTY_COLORS = {
  trace: '\x1b[90m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

const safeSerialize = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.code ? { code: value.code } : {}),
      ...(value.statusCode ? { statusCode: value.statusCode } : {}),
    };
  }
  return value;
};

const writeLine = (level, msg, ctx, bindings) => {
  if (LEVELS[level] < ACTIVE_LEVEL) return;

  const requestCtx = getRequestContext();
  const merged = {
    level,
    time: new Date().toISOString(),
    msg: typeof msg === 'string' ? msg : JSON.stringify(msg),
    ...(requestCtx?.requestId ? { request_id: requestCtx.requestId } : {}),
    ...(requestCtx?.userId ? { user_id: requestCtx.userId } : {}),
    ...(requestCtx?.organizationId ? { organization_id: requestCtx.organizationId } : {}),
    ...(requestCtx?.role ? { role: requestCtx.role } : {}),
    ...bindings,
    ...(ctx ? { ctx: safeSerialize(ctx) } : {}),
  };

  if (PROD_FORMAT === 'json') {
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : console.log)(JSON.stringify(merged));
    return;
  }

  const color = PRETTY_COLORS[level] || '';
  const tag = `${color}[${level.toUpperCase()}]${RESET}`;
  const requestSuffix = requestCtx?.requestId ? ` req=${requestCtx.requestId}` : '';
  const moduleTag = bindings?.module ? ` (${bindings.module})` : '';
  const tail = ctx ? ` ${JSON.stringify(safeSerialize(ctx))}` : '';
  const printer = level === 'error' ? console.error : console.log;
  // eslint-disable-next-line no-console
  printer(`${merged.time} ${tag}${moduleTag}${requestSuffix} ${merged.msg}${tail}`);
};

const buildLogger = (bindings = {}) => ({
  trace: (msg, ctx) => writeLine('trace', msg, ctx, bindings),
  debug: (msg, ctx) => writeLine('debug', msg, ctx, bindings),
  info: (msg, ctx) => writeLine('info', msg, ctx, bindings),
  warn: (msg, ctx) => writeLine('warn', msg, ctx, bindings),
  error: (msg, errOrCtx, maybeCtx) => {
    if (errOrCtx instanceof Error) {
      writeLine('error', msg, { ...(maybeCtx || {}), error: safeSerialize(errOrCtx) }, bindings);
    } else {
      writeLine('error', msg, errOrCtx, bindings);
    }
  },
  child: (extraBindings = {}) => buildLogger({ ...bindings, ...extraBindings }),
});

const rootLogger = buildLogger();

// Important: do NOT reassign `module.exports.child` here. The child method
// already lives on `rootLogger` (returned by buildLogger), and rebinding it
// to call `rootLogger.child(...)` again creates infinite recursion when
// someone does `require('./logger').child(...)`.
module.exports = rootLogger;
module.exports.LEVELS = LEVELS;
