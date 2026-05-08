'use strict';

/**
 * Email-driven comp ingestion service.
 *
 * Receives webhook payloads from inbound email providers (Postmark today,
 * SES in the future) and turns them into rows on `comps_review_queue`.
 * The queue rows then sit in `pending_extraction` status until the
 * extraction worker (PR 3 of this Tier-0 sequence) picks them up, runs
 * Gemini, and flips them to `pending_review` for human approval.
 *
 * Why webhook-driven and not IMAP polling:
 *   • Postmark/SES inbound webhooks are push-based — no cron, no polling
 *     latency, no missed messages on cold starts.
 *   • Vercel-serverless friendly — every request is short-lived.
 *
 * Webhook auth — two paths supported:
 *   1. HMAC-SHA256 in `X-Webhook-Signature: sha256=<hex>` header, keyed by
 *      env `INGEST_WEBHOOK_HMAC_KEY`. Preferred — provider-agnostic and
 *      replay-resistant if the body is fully signed.
 *   2. HTTP Basic Auth via `INGEST_WEBHOOK_BASIC_USER` /
 *      `INGEST_WEBHOOK_BASIC_PASS` — simpler to set up in Postmark's
 *      free tier, used as a fallback when no HMAC header is present.
 *
 * Org routing:
 *   Single-tenant for MVP. Resolves to env `DEFAULT_INGEST_ORGANIZATION_ID`.
 *   Later: parse `MailboxHash` from Postmark payload (the bit after `+` in
 *   `ingest+<orgcode>@redip.app`) and look up via an `ingest_email_routing`
 *   table — stub left as a TODO comment near `resolveOrganizationId`.
 *
 * Security & privacy:
 *   • Webhook payloads are NEVER logged in full (PII in email bodies).
 *     Only metadata: from, subject, message_id, attachment count, sha256s.
 *   • Attachment bytes are uploaded to private storage immediately; the
 *     queue row holds a storage pointer, not the bytes.
 *   • Email body text is stored in `source_meta.body_text` truncated to
 *     8 KB so it can be shown in the reviewer UI without exfiltrating
 *     long threads. Full bodies live only in the email attachment file
 *     when there is one.
 *
 * Dedupe:
 *   Postmark retries on non-2xx response (and occasionally on 2xx). We
 *   dedupe by (organization_id, raw_doc_sha256) at the queue layer — the
 *   migration enforces a partial unique index, so the second insert
 *   throws 23505 and we treat that as "already ingested" rather than an
 *   error.
 */

const crypto = require('crypto');
const { query } = require('../config/database');
const { uploadFile } = require('../config/storage');
const { runWithRequestContext } = require('../lib/requestContext');
const log = require('../lib/logger').child({ module: 'ingestEmail' });

// 25 MB attachment cap — Postmark's documented inbound max is 35 MB total
// per email but Vercel serverless body limit is 4.5 MB by default and we
// run at 10 MB. Bigger files belong on a presigned-upload path (manual
// upload UI) rather than the webhook.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// Truncate stored email body so the queue row doesn't bloat. Reviewers
// see the original via the source link if they need more.
const MAX_BODY_PREVIEW_BYTES = 8 * 1024;

// Allowed MIME types for attachments. Anything else is recorded in the
// queue row's source_meta but NOT uploaded to storage — keeps malware /
// ZIP-bomb risk off the backend file system.
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

// Sender-domain heuristic for source classification. Domains added here
// auto-route to `email_ipc_report`; everything else falls through to
// the broker/other classifier in `inferSourceFromEmail`.
const IPC_SENDER_DOMAINS = new Set([
  'cushwake.com',
  'cw.com',
  'cushmanwakefield.com',
  'jll.com',
  'jll.co.in',
  'knightfrank.com',
  'knightfrank.co.in',
  'colliers.com',
  'cbre.com',
  'cbre.co.in',
  'savills.com',
  'anarock.com',
  'jllindia.com',
]);

const BROKER_QUOTE_KEYWORDS = [
  'quote',
  'rate',
  'rates',
  'rate card',
  'comp',
  'comps',
  'pricing',
  'rate sheet',
  'price list',
  'asking',
];

// ──────────────────────────────────────────────────────────────────────────
// Webhook auth verification
// ──────────────────────────────────────────────────────────────────────────

/**
 * Constant-time compare two strings. Returns false if lengths differ
 * (which is itself non-constant-time but only on length, not content).
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify HMAC-SHA256 of the raw request body against the signature
 * header. Header format: `sha256=<lowercase-hex>` (matches GitHub /
 * Stripe convention). Returns true iff the header matches.
 */
function verifyHmacSignature(rawBody, signatureHeader, hmacKey) {
  if (!signatureHeader || !hmacKey) return false;
  const expectedHex = crypto
    .createHmac('sha256', hmacKey)
    .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
    .digest('hex');
  const expected = `sha256=${expectedHex}`;
  return safeEqual(expected, signatureHeader.trim());
}

/**
 * Verify HTTP Basic auth header. Returns true iff the decoded
 * user:pass matches env credentials.
 */
function verifyBasicAuth(authHeader, expectedUser, expectedPass) {
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;
  if (!expectedUser || !expectedPass) return false;
  const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
  const sepIdx = decoded.indexOf(':');
  if (sepIdx < 0) return false;
  const user = decoded.slice(0, sepIdx);
  const pass = decoded.slice(sepIdx + 1);
  return safeEqual(user, expectedUser) && safeEqual(pass, expectedPass);
}

/**
 * Validate an inbound webhook request. Tries HMAC first (preferred),
 * falls back to Basic auth. Throws if neither path verifies.
 *
 * Returns the auth method that succeeded, for telemetry.
 */
function verifyWebhookAuth({ rawBody, headers }) {
  const hmacKey = process.env.INGEST_WEBHOOK_HMAC_KEY;
  const signatureHeader =
    headers['x-webhook-signature'] || headers['X-Webhook-Signature'] || null;

  if (hmacKey && signatureHeader) {
    if (verifyHmacSignature(rawBody, signatureHeader, hmacKey)) {
      return 'hmac';
    }
    // HMAC was attempted but failed — do not fall through to Basic. A
    // signed-but-wrong request is more likely an attacker than a misconfig.
    const err = new Error('Webhook HMAC signature mismatch.');
    err.statusCode = 401;
    throw err;
  }

  const basicUser = process.env.INGEST_WEBHOOK_BASIC_USER;
  const basicPass = process.env.INGEST_WEBHOOK_BASIC_PASS;
  const authHeader = headers.authorization || headers.Authorization || null;
  if (basicUser && basicPass && authHeader) {
    if (verifyBasicAuth(authHeader, basicUser, basicPass)) {
      return 'basic';
    }
  }

  const err = new Error('Webhook auth failed: provide X-Webhook-Signature or Basic auth.');
  err.statusCode = 401;
  throw err;
}

// ──────────────────────────────────────────────────────────────────────────
// Postmark inbound payload parsing
// ──────────────────────────────────────────────────────────────────────────

/**
 * Extract the lowercased domain from an email address string. Handles
 * both `name@domain.com` and `Display Name <name@domain.com>` forms.
 * Returns empty string if no domain is parseable.
 */
function extractEmailDomain(addressString) {
  if (!addressString || typeof addressString !== 'string') return '';
  const match = addressString.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  if (!match) return '';
  const [, addr] = match;
  const at = addr.lastIndexOf('@');
  return at < 0 ? '' : addr.slice(at + 1).toLowerCase().trim();
}

/**
 * Decide which `source` enum value to use based on sender + subject.
 *   • IPC firms (CW / JLL / KF / Colliers / CBRE / etc.) → email_ipc_report
 *   • Subject contains broker-quote keywords            → email_broker_quote
 *   • Otherwise                                         → email_other
 */
function inferSourceFromEmail({ from, subject }) {
  const domain = extractEmailDomain(from);
  if (IPC_SENDER_DOMAINS.has(domain)) {
    return 'email_ipc_report';
  }
  // Match sub-domains too: jll.co.in, india.cw.com, etc.
  for (const ipcDomain of IPC_SENDER_DOMAINS) {
    if (domain.endsWith('.' + ipcDomain)) {
      return 'email_ipc_report';
    }
  }

  const subjectLower = (subject || '').toLowerCase();
  for (const keyword of BROKER_QUOTE_KEYWORDS) {
    if (subjectLower.includes(keyword)) {
      return 'email_broker_quote';
    }
  }

  return 'email_other';
}

/**
 * Resolve which organization an inbound email belongs to. MVP: returns the
 * default single-tenant org from env. Future hook: look up routing by
 * MailboxHash (`ingest+<orgcode>@…`).
 */
function resolveOrganizationId(payload) {
  // TODO(multitenant): when more orgs onboard, parse payload.MailboxHash
  // and look up `ingest_email_routing` table here.
  void payload;
  const orgId = process.env.DEFAULT_INGEST_ORGANIZATION_ID;
  if (!orgId) {
    const err = new Error('DEFAULT_INGEST_ORGANIZATION_ID is not configured.');
    err.statusCode = 500;
    throw err;
  }
  return orgId;
}

// ──────────────────────────────────────────────────────────────────────────
// Storage upload
// ──────────────────────────────────────────────────────────────────────────

function sanitizeFileName(name) {
  return (name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

/**
 * Upload a single attachment buffer to storage. Reuses the same
 * `uploadFile` helper used by document.service so deletion / signed
 * URLs work uniformly. The pseudo-deal-id pathing keeps Postmark
 * uploads grouped under a synthetic `comps-queue` namespace.
 */
async function persistAttachmentBytes({
  organizationId,
  buffer,
  fileName,
  mimeType,
  messageId,
}) {
  // Reuse uploadFile's `dealId` arg as a path key — for ingest, we use
  // a synthetic `comps-queue/<msg_id>` so attachments group under their
  // source email rather than colliding under a real deal.
  const safeName = sanitizeFileName(fileName);
  const pathKey = `comps-queue-${(messageId || crypto.randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)}`;
  const result = await uploadFile(buffer, safeName, mimeType, pathKey, organizationId);
  return result.url;
}

// ──────────────────────────────────────────────────────────────────────────
// Queue insert
// ──────────────────────────────────────────────────────────────────────────

/**
 * Insert a row into comps_review_queue. Returns { row, deduplicated }.
 * On 23505 (partial unique constraint hit), returns the existing row
 * with deduplicated=true rather than throwing.
 */
async function insertQueueRow({
  organizationId,
  source,
  sourceMeta,
  rawDocUrl,
  rawDocMime,
  rawDocSizeBytes,
  rawDocSha256,
  emailThreadId,
}) {
  try {
    const result = await query(
      `INSERT INTO comps_review_queue
         (organization_id, source, source_meta, raw_doc_url, raw_doc_mime,
          raw_doc_size_bytes, raw_doc_sha256, status, email_thread_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_extraction', $8)
       RETURNING *`,
      [
        organizationId,
        source,
        JSON.stringify(sourceMeta || {}),
        rawDocUrl || null,
        rawDocMime || null,
        rawDocSizeBytes || null,
        rawDocSha256 || null,
        emailThreadId || null,
      ],
    );
    return { row: result.rows[0], deduplicated: false };
  } catch (err) {
    if (err && err.code === '23505' && rawDocSha256) {
      // Same byte-identical attachment was already ingested for this org.
      // Return the existing row so the caller can surface it without
      // failing the webhook (Postmark would retry on non-2xx).
      const existing = await query(
        `SELECT * FROM comps_review_queue
          WHERE organization_id = $1 AND raw_doc_sha256 = $2
          LIMIT 1`,
        [organizationId, rawDocSha256],
      );
      return { row: existing.rows[0], deduplicated: true };
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main entrypoint
// ──────────────────────────────────────────────────────────────────────────

/**
 * Ingest a parsed Postmark inbound payload. Persists each attachment as
 * a separate queue row (so per-attachment extraction runs independently),
 * or one body-only row if no attachments are present.
 *
 * Returns a summary: { accepted, deduplicated, rejected, queue_ids }.
 */
async function ingestPostmarkPayload(payload) {
  const organizationId = resolveOrganizationId(payload);

  // Run all DB inserts inside a request context so RLS reads the right org.
  return runWithRequestContext({ organizationId, userId: null }, async () => {
    const messageId = payload.MessageID || payload.messageID || null;
    const from = payload.From || payload.from || '';
    const fromName = payload.FromName || payload.fromName || '';
    const subject = payload.Subject || payload.subject || '';
    const receivedAt = payload.Date || payload.date || new Date().toISOString();
    const textBody = payload.TextBody || payload.textBody || '';
    const htmlBody = payload.HtmlBody || payload.htmlBody || '';
    const inReplyTo = payload.Headers
      ? (payload.Headers.find((h) => /^in-reply-to$/i.test(h.Name))?.Value || null)
      : null;

    const source = inferSourceFromEmail({ from, subject });
    const baseMeta = {
      message_id: messageId,
      from,
      from_name: fromName,
      subject,
      received_at: receivedAt,
      // Truncate body so we don't bloat the queue table with long
      // forwarded threads. Full content lives on the attachment file
      // when there is one.
      body_preview: (textBody || htmlBody || '').slice(0, MAX_BODY_PREVIEW_BYTES),
      in_reply_to: inReplyTo,
    };

    const attachments = Array.isArray(payload.Attachments) ? payload.Attachments : [];
    const summary = { accepted: 0, deduplicated: 0, rejected: 0, queue_ids: [] };

    // No attachments: store a body-only queue row. Some brokers paste
    // rates inline. Skipping these would lose data.
    if (attachments.length === 0) {
      const { row, deduplicated } = await insertQueueRow({
        organizationId,
        source,
        sourceMeta: { ...baseMeta, attachment_count: 0 },
        emailThreadId: messageId,
      });
      if (deduplicated) summary.deduplicated += 1; else summary.accepted += 1;
      summary.queue_ids.push(row.id);
      return summary;
    }

    for (const att of attachments) {
      const fileName = att.Name || att.name || 'attachment';
      const mimeType = att.ContentType || att.contentType || 'application/octet-stream';
      const contentLength = att.ContentLength || att.contentLength || 0;
      const contentB64 = att.Content || att.content || '';

      if (!ALLOWED_ATTACHMENT_MIMES.has(mimeType)) {
        log.info('ingest_attachment_rejected_mime', { mimeType, fileName });
        summary.rejected += 1;
        continue;
      }
      if (!contentB64) {
        log.info('ingest_attachment_empty', { fileName });
        summary.rejected += 1;
        continue;
      }

      const buffer = Buffer.from(contentB64, 'base64');
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        log.info('ingest_attachment_too_large', { fileName, sizeBytes: buffer.length });
        summary.rejected += 1;
        continue;
      }

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      // Upload first; if dedupe hits we still want the bytes available
      // for the existing queue row reference.
      let storageUrl = null;
      try {
        storageUrl = await persistAttachmentBytes({
          organizationId,
          buffer,
          fileName,
          mimeType,
          messageId,
        });
      } catch (uploadErr) {
        log.warn('ingest_attachment_storage_failed', {
          fileName,
          error: uploadErr.message,
        });
        summary.rejected += 1;
        continue;
      }

      const { row, deduplicated } = await insertQueueRow({
        organizationId,
        source,
        sourceMeta: {
          ...baseMeta,
          attachment_count: attachments.length,
          attachment_name: fileName,
          attachment_index: attachments.indexOf(att),
          attachment_content_length_reported: contentLength,
        },
        rawDocUrl: storageUrl,
        rawDocMime: mimeType,
        rawDocSizeBytes: buffer.length,
        rawDocSha256: sha256,
        emailThreadId: inReplyTo || messageId,
      });

      if (deduplicated) summary.deduplicated += 1; else summary.accepted += 1;
      summary.queue_ids.push(row.id);
    }

    log.info('ingest_postmark_summary', {
      organization_id: organizationId,
      source,
      from_domain: extractEmailDomain(from),
      ...summary,
    });

    return summary;
  });
}

module.exports = {
  // Auth
  verifyHmacSignature,
  verifyBasicAuth,
  verifyWebhookAuth,
  // Parsing
  extractEmailDomain,
  inferSourceFromEmail,
  resolveOrganizationId,
  // Main flow
  ingestPostmarkPayload,
  // Constants — exported for tests
  ALLOWED_ATTACHMENT_MIMES,
  MAX_ATTACHMENT_BYTES,
  IPC_SENDER_DOMAINS,
  BROKER_QUOTE_KEYWORDS,
};
