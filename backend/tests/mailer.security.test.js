'use strict';

/**
 * Regression tests for the mailer security hardening (2026-05-30):
 *   - In production WITHOUT a provider, sendMail must FAIL CLOSED and must NOT
 *     log the email body (which carries the verification/reset link + token).
 *   - Recipient addresses are redacted in logs (DPDP data-minimisation).
 */

const mockLog = {
  trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
};
jest.mock('../src/lib/logger', () => ({ child: () => mockLog }));

const { sendMail, redactEmail } = require('../src/lib/mailer');

describe('redactEmail', () => {
  test('keeps first char + domain, never the full local part', () => {
    expect(redactEmail('alice@example.com')).toBe('a***@example.com');
    expect(redactEmail(['a@x.com', 'b@y.com'])).toEqual(['a***@x.com', 'b***@y.com']);
    expect(redactEmail('not-an-email')).toBe('redacted');
    expect(redactEmail(undefined)).toBe('redacted');
  });
});

describe('sendMail — provider not configured', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.VERCEL;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  test('fails CLOSED in production and never logs the link/token', async () => {
    process.env.VERCEL = '1';
    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Verify', html: '<a>https://x/verify?token=SUPERSECRET</a>' }),
    ).rejects.toThrow(/not configured/i);

    // The dev "log the body" path must NOT have run...
    expect(mockLog.info).not.toHaveBeenCalled();
    // ...and the error log must not contain the secret token or the body.
    const errCalls = JSON.stringify(mockLog.error.mock.calls);
    expect(errCalls).toContain('mail_provider_not_configured');
    expect(errCalls).not.toContain('SUPERSECRET');
  });

  test('in dev, logs a REDACTED recipient (not the raw address) and returns the console provider', async () => {
    // NODE_ENV is 'test' (not production) and VERCEL is unset → dev path.
    const res = await sendMail({ to: 'alice@example.com', subject: 'Verify', html: '<a>x</a>' });
    expect(res).toEqual({ provider: 'console', id: null });
    expect(mockLog.info).toHaveBeenCalledTimes(1);
    const [event, meta] = mockLog.info.mock.calls[0];
    expect(event).toBe('mail_not_sent_dev_mode');
    expect(meta.to).toBe('a***@example.com');
    expect(meta.to).not.toContain('alice@example.com');
  });
});
