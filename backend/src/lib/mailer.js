'use strict';

/**
 * Thin transactional-email adapter.
 *
 * Why this exists:
 *   - Email verification + password reset both need to deliver one-shot links.
 *   - We do not want a hard dependency on a specific provider in the service
 *     layer; provider choice is an env decision that may change.
 *
 * Behaviour:
 *   - In test (NODE_ENV=test) and dev (no RESEND_API_KEY): writes the message
 *     to the structured logger and returns immediately. The verification link
 *     can be lifted from server logs to complete the flow end-to-end without
 *     any external dependency.
 *   - In production with RESEND_API_KEY set: posts to Resend's REST API
 *     (https://resend.com/docs/api-reference/emails/send-email). Resend is
 *     chosen because it (a) ships from India-friendly infrastructure with
 *     low latency for South Asian recipients, (b) has a generous free tier
 *     suitable for a solo-founder MVP, and (c) supports SPF/DKIM/DMARC
 *     out-of-the-box once the sender domain is verified.
 *   - On any provider error we throw — the calling service decides whether
 *     to retry or surface to the user. Verification flows MUST NOT silently
 *     swallow send failures; the user would be locked out of their own
 *     account.
 *
 * Operator setup (manual blocker, recorded in TODO_MANUAL.md):
 *   1. Sign up at https://resend.com (free tier covers MVP).
 *   2. Verify the sender domain (DNS records).
 *   3. Set Vercel env: RESEND_API_KEY, MAIL_FROM ("REDIP <noreply@your.domain>").
 *
 * Until that is done, the dev console-log path is the source of truth: every
 * verification link is logged at INFO level on the server, and operators can
 * forward it manually if needed.
 */

const log = require('./logger').child({ module: 'mailer' });

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const isProviderConfigured = () => Boolean(process.env.RESEND_API_KEY);

const getDefaultFrom = () =>
  process.env.MAIL_FROM || 'REDIP <noreply@redip.example>';

// Redact recipient email(s) for logs — keep enough to debug delivery without
// writing raw PII (DPDP data-minimisation; mirrors errorHandler's no-PII-in-logs
// stance). "alice@example.com" -> "a***@example.com".
const redactEmail = (addr) => {
  if (Array.isArray(addr)) return addr.map(redactEmail);
  if (typeof addr !== 'string' || !addr.includes('@')) return 'redacted';
  const [user, domain] = addr.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
};

/**
 * Send a transactional email.
 *
 * @param {Object} message
 * @param {string|string[]} message.to        Recipient email(s).
 * @param {string} message.subject            Subject line.
 * @param {string} message.html               HTML body.
 * @param {string} [message.text]             Plain-text body (optional).
 * @param {string} [message.from]             Override sender (default MAIL_FROM).
 * @returns {Promise<{ provider: string, id: string|null }>}
 */
const sendMail = async (message) => {
  const { to, subject, html, text, from } = message;

  if (!to || !subject || !html) {
    throw new Error('mailer.sendMail requires to, subject, and html');
  }

  const sender = from || getDefaultFrom();

  if (!isProviderConfigured()) {
    // SECURITY: fail CLOSED in production. The dev fallback below logs the full
    // body — which contains the verification / password-reset link and its live
    // one-time token. In prod (or any Vercel deploy) that would write account-
    // takeover tokens to logs / a log-drain. Without a provider we cannot
    // deliver, so throw; the caller surfaces a retry rather than leaking a token.
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      log.error('mail_provider_not_configured', new Error('Email provider not configured'), { subject });
      throw new Error('Email provider is not configured.');
    }
    // Dev / test ONLY (never reached in production): log the message — incl. the
    // link — so the flow can be completed by lifting it from the console without
    // a real provider. Recipient is redacted; the body is intentionally kept.
    log.info('mail_not_sent_dev_mode', {
      reason: 'RESEND_API_KEY not configured',
      to: redactEmail(to),
      from: sender,
      subject,
      preview: text || html,
    });
    return { provider: 'console', id: null };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>');
    log.error('mail_send_failed', new Error(`Resend ${response.status}`), {
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new Error(`Email provider responded with HTTP ${response.status}`);
  }

  const data = await response.json().catch(() => ({}));
  log.info('mail_sent', { provider: 'resend', id: data?.id || null, to: redactEmail(to), subject });
  return { provider: 'resend', id: data?.id || null };
};

module.exports = {
  sendMail,
  isProviderConfigured,
  redactEmail,
};
