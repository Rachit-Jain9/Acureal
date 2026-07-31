'use strict';

/**
 * Export audit ledger — the writer `export_events` never had.
 *
 * The table shipped 2026-05-17 and three docs describe it as "records every
 * export". It held zero rows: no code path ever inserted one, so nobody could
 * answer "who downloaded which investor package, when". CLAUDE.md calls the
 * audit trail non-negotiable; this middleware is the missing half of that
 * promise for exports.
 *
 * Design
 * ------
 * Instrument ONCE at the router, not in fifteen handlers. The middleware
 * watches the response: anything that leaves with a 2xx and a Content-
 * Disposition attachment IS an export, whatever handler produced it — new
 * export endpoints get audited by existing. Handlers that know more than the
 * response shows (AI usage, cost, variant) enrich via
 * `res.locals.exportAudit = { aiUsed, aiCostUsd, dealId, metadata }`.
 *
 * Correctness notes, each load-bearing:
 *   • Bytes are COUNTED from the chunks actually written, not read from
 *     Content-Length — several handlers stream without setting it.
 *   • The INSERT runs inside an explicitly re-entered request context.
 *     RLS (`WITH CHECK organization_id = current_organization_id()`) makes a
 *     context-less insert fail, and AsyncLocalStorage is not guaranteed to
 *     survive into a response 'finish' listener. Captured ids + explicit
 *     re-entry make it deterministic instead of usually-works.
 *   • Recording runs via runInBackground: it must never delay the download,
 *     and a failure must be LOUD (log + Sentry) — a silently broken audit
 *     trail is how this table stayed empty for ten weeks.
 *   • `format` is constrained by a DB CHECK to pptx|xlsx|docx|pdf|csv. An
 *     attachment outside that set (zip, json) is skipped with a warn rather
 *     than letting the constraint reject the row in the background, where
 *     the error would name no request.
 */

const { query } = require('../config/database');
const { runWithRequestContext, getRequestContext } = require('../lib/requestContext');
const { runInBackground } = require('../lib/backgroundTask');
const log = require('../lib/logger').child({ module: 'export_audit' });

const AUDITABLE_FORMATS = new Set(['pptx', 'xlsx', 'docx', 'pdf', 'csv']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPE_FORMATS = [
  ['presentationml', 'pptx'],
  ['spreadsheetml', 'xlsx'],
  ['wordprocessingml', 'docx'],
  ['application/pdf', 'pdf'],
  ['text/csv', 'csv'],
];

// Filename extension first (authoritative — it is what lands on the user's
// disk), content type as the fallback for handlers that set no filename.
const resolveFormat = (disposition, contentType) => {
  const fileMatch = /filename\*?=(?:UTF-8''|")?[^"]*\.([a-z0-9]+)"?\s*(?:;|$)/i.exec(disposition || '');
  if (fileMatch && AUDITABLE_FORMATS.has(fileMatch[1].toLowerCase())) {
    return fileMatch[1].toLowerCase();
  }
  const type = String(contentType || '').toLowerCase();
  const hit = CONTENT_TYPE_FORMATS.find(([needle]) => type.includes(needle));
  return hit ? hit[1] : null;
};

const asUuid = (value) => (typeof value === 'string' && UUID_RE.test(value) ? value : null);

const exportAudit = (req, res, next) => {
  const startedAt = Date.now();
  let bytes = 0;

  // Count what is genuinely written. write/end both accept (chunk, enc, cb)
  // in any of Express's calling shapes; only the chunk matters here.
  const origWrite = res.write;
  const origEnd = res.end;
  res.write = function countingWrite(chunk, ...rest) {
    if (chunk) bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    return origWrite.call(this, chunk, ...rest);
  };
  res.end = function countingEnd(chunk, ...rest) {
    if (chunk && typeof chunk !== 'function') {
      bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    }
    return origEnd.call(this, chunk, ...rest);
  };

  // Ambient ids captured NOW; user read lazily at finish (authenticate runs
  // after router-level middleware, so req.user does not exist yet here).
  const ambient = getRequestContext();

  res.on('finish', () => {
    try {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const disposition = res.getHeader('content-disposition');
      if (!disposition || !/attachment/i.test(String(disposition))) return;

      const organizationId = req.user?.organization_id || ambient.organizationId || null;
      if (!organizationId) {
        // RLS would reject the row anyway; a public unauthenticated export
        // (none exist today) would need its own decision, not a silent drop.
        log.warn('export_audit_no_tenant', { path: req.originalUrl });
        return;
      }

      const format = resolveFormat(String(disposition), res.getHeader('content-type'));
      if (!format) {
        log.warn('export_audit_unrecognised_format', {
          path: req.originalUrl,
          disposition: String(disposition).slice(0, 120),
        });
        return;
      }

      const enrichment = res.locals.exportAudit || {};
      const generationMs = Date.now() - startedAt;
      const dealId =
        asUuid(enrichment.dealId) || asUuid(req.params?.dealId) || asUuid(req.params?.id) || null;

      const context = {
        organizationId,
        userId: req.user?.id || ambient.userId || null,
        requestId: ambient.requestId || null,
      };

      // downloaded_at = now(): every current export streams inline, so
      // generation and download are the same observable event.
      runInBackground(
        'export_audit_record',
        runWithRequestContext(context, () =>
          query(
            `INSERT INTO export_events
               (organization_id, user_id, deal_id, format, ai_used, ai_cost_usd,
                generation_ms, byte_size, metadata, downloaded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())`,
            [
              organizationId,
              context.userId,
              dealId,
              format,
              enrichment.aiUsed === true,
              enrichment.aiCostUsd ?? null,
              generationMs,
              bytes || null,
              JSON.stringify({
                path: req.originalUrl.split('?')[0],
                ...(enrichment.metadata || {}),
              }),
            ],
          )),
        { path: req.originalUrl, format },
      );
    } catch (err) {
      // The download has already succeeded; never let accounting break it.
      log.error('export_audit_hook_failed', err, { path: req.originalUrl });
    }
  });

  next();
};

module.exports = { exportAudit, resolveFormat };
