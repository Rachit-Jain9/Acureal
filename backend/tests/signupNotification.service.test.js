'use strict';

/**
 * Tests for the new-signup operator notification (open-beta growth visibility).
 *
 * Contract:
 *   - Emails every platform-admin recipient a digest of the new account.
 *   - No recipients → no-op, no send, never throws.
 *   - A mailer failure (e.g. Resend unconfigured) is swallowed — a broken
 *     operator email must NEVER break the real user's signup.
 *   - Hostile display name / company can't inject HTML into the operator inbox.
 */

const mockLog = {
  trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
};
jest.mock('../src/lib/logger', () => ({ child: () => mockLog }));

jest.mock('../src/lib/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/utils/platformOrg', () => ({ getPlatformAdminEmails: jest.fn() }));

const { sendMail } = require('../src/lib/mailer');
const { getPlatformAdminEmails } = require('../src/utils/platformOrg');
const {
  sendNewSignupNotification,
  renderSignupEmail,
} = require('../src/services/signupNotification.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendNewSignupNotification', () => {
  test('emails all platform admins with the new account digest', async () => {
    getPlatformAdminEmails.mockReturnValue(['ops@acureal.in', 'founder@acureal.in']);
    sendMail.mockResolvedValue({ provider: 'resend', id: 'msg_1' });

    const result = await sendNewSignupNotification({
      name: 'Asha Rao',
      email: 'asha@acme.com',
      phone: '9876543210',
      company: 'Acme Realty',
      jobTitle: 'Investment Manager',
      city: 'Bengaluru',
      method: 'email',
      workspace: 'Acme Realty',
    });

    expect(result).toEqual({ delivered: true, provider: 'resend' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const msg = sendMail.mock.calls[0][0];
    expect(msg.to).toEqual(['ops@acureal.in', 'founder@acureal.in']);
    expect(msg.subject).toContain('Asha Rao');
    // Body carries the volunteered profile detail.
    expect(msg.text).toContain('Acme Realty');
    expect(msg.text).toContain('Investment Manager');
    expect(msg.text).toContain('Bengaluru');
    expect(msg.html).toContain('asha@acme.com');
  });

  test('no-ops when there are no platform-admin recipients', async () => {
    getPlatformAdminEmails.mockReturnValue([]);

    const result = await sendNewSignupNotification({ name: 'Nobody', email: 'x@y.com' });

    expect(result).toEqual({ delivered: false, reason: 'no_recipients' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('swallows a mailer failure and never throws into the signup path', async () => {
    getPlatformAdminEmails.mockReturnValue(['ops@acureal.in']);
    sendMail.mockRejectedValue(new Error('Email provider is not configured.'));

    const result = await sendNewSignupNotification({ name: 'Asha', email: 'asha@acme.com' });

    expect(result).toEqual({ delivered: false, reason: 'send_failed' });
    expect(mockLog.warn).toHaveBeenCalledWith(
      'signup_notification_failed',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  test('labels the sign-up method (Google vs email)', async () => {
    getPlatformAdminEmails.mockReturnValue(['ops@acureal.in']);
    sendMail.mockResolvedValue({ provider: 'resend', id: 'm' });

    await sendNewSignupNotification({ name: 'G User', email: 'g@x.com', method: 'google' });
    expect(sendMail.mock.calls[0][0].text).toContain('Google sign-in');
  });
});

describe('renderSignupEmail', () => {
  test('HTML-escapes hostile display name / company', () => {
    const { html } = renderSignupEmail({
      name: '<script>alert(1)</script>',
      email: 'evil@x.com',
      company: 'A & B "Ltd" <b>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  test('renders a dash for missing optional fields', () => {
    const { text } = renderSignupEmail({ name: 'Solo', email: 's@x.com' });
    expect(text).toContain('Company: —');
    expect(text).toContain('City: —');
  });
});
