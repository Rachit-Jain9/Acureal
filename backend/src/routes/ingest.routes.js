'use strict';

/**
 * Inbound webhook routes — provider-driven email ingestion for the
 * comps_review_queue.
 *
 * Routes:
 *   POST /api/ingest/email/postmark — Postmark inbound webhook. Payload
 *     is the standard Postmark Inbound Stream JSON (see
 *     https://postmarkapp.com/developer/user-guide/inbound/parse-an-email).
 *
 *   GET  /api/ingest/health — small ping that confirms the route is
 *     mounted and configured. Returns 200 + which auth modes are
 *     enabled. Does NOT return secrets.
 *
 * Auth: webhook routes do their OWN auth via HMAC or Basic header — no
 * `authenticate` middleware (Postmark cannot present a JWT). All other
 * routes that touch the queue go through `extraction.routes.js` /
 * `compsReviewQueue.routes.js` which DO require the standard auth.
 */

const express = require('express');
const ingestService = require('../services/ingestEmail.service');
const log = require('../lib/logger').child({ module: 'ingest_routes' });

const router = express.Router();

// Capture the raw body bytes for HMAC verification. Express's default
// `json()` parser discards the raw bytes after parsing, so we install a
// route-scoped parser that retains them. The verify callback runs before
// JSON parsing and pins the raw text on `req.rawBody`.
const RAW_BODY_LIMIT = '20mb'; // accommodates Postmark inbound (≤25 MB total)
const jsonWithRawBody = express.json({
  limit: RAW_BODY_LIMIT,
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});

/**
 * GET /api/ingest/health
 * Returns whether each auth mode is configured. Useful for ops dashboards
 * and to test webhook reachability before pointing Postmark at it.
 */
router.get('/health', (_req, res) => {
  const hasHmac = Boolean(process.env.INGEST_WEBHOOK_HMAC_KEY);
  const hasBasic = Boolean(
    process.env.INGEST_WEBHOOK_BASIC_USER && process.env.INGEST_WEBHOOK_BASIC_PASS,
  );
  const hasOrg = Boolean(process.env.DEFAULT_INGEST_ORGANIZATION_ID);
  res.json({
    success: true,
    data: {
      auth_modes: {
        hmac: hasHmac,
        basic: hasBasic,
      },
      organization_routing: hasOrg ? 'default_env' : 'missing',
      ready: (hasHmac || hasBasic) && hasOrg,
    },
  });
});

/**
 * POST /api/ingest/email/postmark
 * Inbound webhook from Postmark. Verifies auth, parses the payload,
 * persists attachments to storage, and inserts queue rows.
 *
 * Returns 200 + summary on success (Postmark won't retry).
 * Returns 401 on auth failure (Postmark won't retry — security).
 * Returns 5xx on storage / DB failure (Postmark WILL retry).
 */
router.post('/email/postmark', jsonWithRawBody, async (req, res, next) => {
  try {
    ingestService.verifyWebhookAuth({
      rawBody: req.rawBody,
      headers: req.headers,
    });

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid Postmark payload — expected JSON object.',
      });
    }

    const summary = await ingestService.ingestPostmarkPayload(req.body);

    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    if (err && err.statusCode === 401) {
      log.warn('ingest_webhook_auth_failed', {
        ip: req.ip,
        ua: req.headers['user-agent'],
      });
      return res.status(401).json({ success: false, message: err.message });
    }
    return next(err);
  }
});

module.exports = router;
