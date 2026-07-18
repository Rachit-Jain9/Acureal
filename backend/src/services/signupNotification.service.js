'use strict';

/**
 * New-signup operator notification.
 *
 * REDIP registration is open to everyone (the invite gate was removed in
 * PR #507). Until now nothing told the operator when someone actually joined —
 * the only signup email went to the NEW USER (verify-your-email), never to us.
 * This service closes that gap: on every fresh account it emails the platform
 * operator(s) a short "someone just signed up" digest with whatever profile
 * detail the person volunteered.
 *
 * Design rules:
 *   - BEST-EFFORT. The caller dispatches this fire-and-forget (setImmediate)
 *     AFTER the signup transaction commits. It must NEVER throw into the
 *     signup path — a failed operator email must not break a real user's
 *     registration. All failures are swallowed + logged here.
 *   - Recipients come from the platform-admin allowlist (PLATFORM_ADMIN_EMAILS,
 *     same source of truth as platformOrg.js). No allowlist → no-op.
 *   - Delivery rides the existing Resend mailer. If Resend isn't configured
 *     the mailer throws (prod) / logs (dev); either way we swallow it. The
 *     in-app "Signups" admin page is the always-works channel; email is the
 *     nice-to-have push on top.
 *   - No secrets, no tokens. This is a plain informational digest.
 */

const { sendMail } = require('../lib/mailer');
const { getPlatformAdminEmails } = require('../utils/platformOrg');
const log = require('../lib/logger').child({ module: 'signup_notification' });

// Basic HTML-escape so a hostile display name / company can't inject markup
// into the operator's inbox.
const esc = (value) => {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const dash = (value) => {
  const v = value === undefined || value === null ? '' : String(value).trim();
  return v || '—';
};

const methodLabel = (method) => {
  if (method === 'google') return 'Google sign-in';
  return 'Email + password';
};

const renderSignupEmail = ({ name, email, phone, company, jobTitle, city, method, workspace }) => {
  const rows = [
    ['Name', dash(name)],
    ['Email', dash(email)],
    ['Phone', dash(phone)],
    ['Company', dash(company)],
    ['Role', dash(jobTitle)],
    ['City', dash(city)],
    ['Workspace', dash(workspace)],
    ['Signed up via', methodLabel(method)],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 14px 6px 0; color:#6b7280; font-size:13px; white-space:nowrap; vertical-align:top;">${esc(label)}</td>
        <td style="padding:6px 0; color:#111827; font-size:13px; font-weight:600;">${esc(value)}</td>
      </tr>`,
    )
    .join('');

  const html = `
    <div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
      <p style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; margin: 0 0 6px;">REDIP · New signup</p>
      <h1 style="font-size: 18px; margin: 0 0 16px;">${esc(dash(name))} just created an account</h1>
      <table style="border-collapse: collapse; width: 100%;">${tableRows}</table>
      <p style="font-size: 12px; color: #9ca3af; margin-top: 28px;">
        You're getting this because you're a REDIP platform operator. See everyone who has
        joined on the <strong>Signups</strong> page under Admin in the app.
      </p>
    </div>
  `;

  const text = [
    'REDIP — New signup',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'See all signups on the Signups page under Admin in the app.',
  ].join('\n');

  return { html, text };
};

/**
 * Notify the platform operator(s) that a new user signed up. Best-effort:
 * resolves to { delivered, provider } on success, or { delivered: false }
 * on any failure — never throws.
 *
 * @param {Object} signup
 * @param {string} signup.name
 * @param {string} signup.email
 * @param {string} [signup.phone]
 * @param {string} [signup.company]
 * @param {string} [signup.jobTitle]
 * @param {string} [signup.city]
 * @param {string} [signup.method]     'email' | 'google'
 * @param {string} [signup.workspace]  workspace/org name, if known
 */
const sendNewSignupNotification = async (signup = {}) => {
  try {
    const recipients = getPlatformAdminEmails();
    if (!recipients || recipients.length === 0) {
      log.warn('signup_notification_no_recipients');
      return { delivered: false, reason: 'no_recipients' };
    }

    const { html, text } = renderSignupEmail(signup);
    const subjectName = (signup.name && String(signup.name).trim()) || signup.email || 'Someone';

    const result = await sendMail({
      to: recipients,
      subject: `New REDIP signup — ${subjectName}`,
      html,
      text,
    });

    log.info('signup_notification_sent', {
      provider: result.provider,
      messageId: result.id,
      recipientCount: recipients.length,
      method: signup.method || 'email',
    });
    return { delivered: true, provider: result.provider };
  } catch (error) {
    // Swallow — an operator-notification failure must never surface to the
    // user who just signed up. The in-app Signups page still has the record.
    log.warn('signup_notification_failed', { error: error.message });
    return { delivered: false, reason: 'send_failed' };
  }
};

module.exports = {
  sendNewSignupNotification,
  renderSignupEmail,
};
