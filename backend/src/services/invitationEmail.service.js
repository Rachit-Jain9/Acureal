'use strict';

/**
 * Workspace invitation emails.
 *
 * This is the piece that never existed. `organization_invitations` has had a
 * token column since the multi-tenancy work, `POST /api/organization/invitations`
 * has been creating rows, and the Team page has been toasting "Invitation sent"
 * — while `sendMail` was imported by exactly three services, none of them this
 * one. No invitation email has ever left this system. The token was returned in
 * the HTTP response to the inviting admin's browser and dropped on the floor.
 *
 * Two audiences, per the operator spec:
 *
 *   Case A — the recipient already has an Acureal account. They are added to
 *     the workspace directly (no token can help them: invitation tokens are
 *     consumable only at registration), so this is a NOTIFICATION, not a
 *     request. It must not pretend they have something to accept.
 *   Case B — no account yet. This carries the one-shot link, and is the only
 *     path where a token exists at all.
 *
 * Tone follows the two existing templates (verification, reset): plain, short,
 * no marketing. The one concession to Case B is a single clause explaining what
 * Acureal is, because the recipient may never have heard of it.
 */

const { sendMail } = require('../lib/mailer');
const { createError } = require('../middleware/errorHandler');
const log = require('../lib/logger').child({ module: 'invitation_email' });

const isDeployed = () => process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

// Same fail-closed contract as the verification and reset link builders: on a
// deploy with no APP_BASE_URL the send would SUCCEED and the link would be
// dead, which is the worst possible failure — nothing errors, nothing is
// logged, and the invitation simply never works.
const buildAppUrl = (path, params = {}) => {
  if (isDeployed() && !process.env.APP_BASE_URL) {
    throw new Error(
      `APP_BASE_URL is not configured — refusing to send an invitation email whose link would point at localhost.`
    );
  }
  const base = process.env.APP_BASE_URL || 'http://localhost:5173';
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return url.toString();
};

const esc = (value) => String(value || '').replace(/[<>]/g, '');

const shell = (bodyHtml) => `
  <div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
    ${bodyHtml}
  </div>
`;

const cta = (href, label) => `
  <p style="margin: 24px 0;">
    <a href="${href}"
       style="display: inline-block; padding: 10px 18px; background: #1E6FD0; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
      ${label}
    </a>
  </p>
  <p style="font-size: 13px; color: #6b7280;">
    If the button doesn't work, paste this URL into your browser:<br/>
    <span style="word-break: break-all;">${href}</span>
  </p>
`;

const securityFooter = `
  <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
    If you weren't expecting this invitation, you can safely ignore this email —
    no access is granted until you act on it.
  </p>
`;

/** Case A — already has an account; they have been added, not asked. */
const renderExistingUserEmail = ({ inviterName, inviterEmail, organizationName, recipientName }) => {
  const who = `${esc(inviterName)} (${esc(inviterEmail)})`;
  const org = esc(organizationName);
  const hello = recipientName ? `Hi ${esc(recipientName)},` : 'Hi,';
  const url = buildAppUrl('/dashboard/deals');

  const html = shell(`
    <h1 style="font-size: 18px; margin-bottom: 16px;">You've been added to ${org}</h1>
    <p>${hello}</p>
    <p>${who} added you to the workspace <strong>${org}</strong> on Acureal.
       It's already available in your account — nothing to accept.</p>
    ${cta(url, 'Open workspace')}
    ${securityFooter}
  `);
  const text = `You've been added to ${organizationName}\n\n${hello}\n\n${inviterName} (${inviterEmail}) added you to the workspace "${organizationName}" on Acureal. It is already available in your account — nothing to accept.\n\nOpen it here:\n${url}\n\nIf you weren't expecting this, you can ignore this email.`;
  return { subject: `${inviterName} added you to ${organizationName}`, html, text };
};

/** Case B — no account yet; this carries the one-shot link. */
const renderNewUserEmail = ({ inviterName, inviterEmail, organizationName, rawToken, expiresAt }) => {
  const who = `${esc(inviterName)} (${esc(inviterEmail)})`;
  const org = esc(organizationName);
  const url = buildAppUrl('/invite', { token: rawToken });
  const expiryNote = expiresAt
    ? `This invitation expires on ${new Date(expiresAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      })}.`
    : '';

  const html = shell(`
    <h1 style="font-size: 18px; margin-bottom: 16px;">${who.split(' (')[0]} invited you to ${org}</h1>
    <p>Hi,</p>
    <p>${who} has invited you to join the workspace <strong>${org}</strong> on
       Acureal — a platform for real-estate deal intelligence.</p>
    <p>You'll be guided through a short sign-up. Once that's done you'll have
       access to the shared workspace.</p>
    ${cta(url, 'Create account & join')}
    ${expiryNote ? `<p style="font-size: 13px; color: #6b7280;">${expiryNote}</p>` : ''}
    ${securityFooter}
  `);
  const text = `${inviterName} invited you to ${organizationName}\n\nHi,\n\n${inviterName} (${inviterEmail}) has invited you to join the workspace "${organizationName}" on Acureal — a platform for real-estate deal intelligence.\n\nOpen this link to create your account and join:\n${url}\n\n${expiryNote}\n\nIf you weren't expecting this invitation, you can ignore this email.`;
  return { subject: `${inviterName} invited you to join ${organizationName} on Acureal`, html, text };
};

/**
 * Send an invitation email. Throws a 502 on provider failure so the caller can
 * decide — the invite ROUTE dispatches this in the background, so a mail outage
 * never fails the request that created the invitation.
 *
 * `rawToken` is present only for Case B and is NEVER logged.
 */
const sendInvitationEmail = async ({
  to,
  hasAccount,
  recipientName = null,
  inviterName,
  inviterEmail,
  organizationName,
  rawToken = null,
  expiresAt = null,
}) => {
  if (!to) throw createError('Recipient email required to send an invitation.', 400);

  const { subject, html, text } = hasAccount
    ? renderExistingUserEmail({ inviterName, inviterEmail, organizationName, recipientName })
    : renderNewUserEmail({ inviterName, inviterEmail, organizationName, rawToken, expiresAt });

  try {
    const result = await sendMail({ to, subject, html, text });
    log.info('invitation_email_dispatched', {
      provider: result.provider,
      messageId: result.id,
      hasAccount,
    });
    return { delivered: true, provider: result.provider, messageId: result.id };
  } catch (error) {
    log.error('invitation_email_failed', error, { hasAccount });
    throw createError('We could not send the invitation email. Please try again in a moment.', 502);
  }
};

module.exports = {
  sendInvitationEmail,
  renderExistingUserEmail,
  renderNewUserEmail,
  buildAppUrl,
};
