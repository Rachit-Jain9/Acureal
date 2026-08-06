jest.mock('../src/lib/mailer', () => ({
  sendMail: jest.fn(),
  isProviderConfigured: jest.fn(() => false),
  redactEmail: jest.fn((a) => `redacted:${a}`),
}));

const mailer = require('../src/lib/mailer');
const svc = require('../src/services/invitationEmail.service');

const BASE = {
  inviterName: 'Rachit Jain',
  inviterEmail: 'rachit.jain@acureal.in',
  organizationName: 'Default Workspace',
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});
afterAll(() => { process.env = { ...ORIGINAL_ENV }; });

describe('invitationEmail — Case B (no account yet)', () => {
  test('carries the one-shot token in an /invite link', async () => {
    mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });

    await svc.sendInvitationEmail({
      ...BASE,
      to: 'new@example.com',
      hasAccount: false,
      rawToken: 'tok_abc123456789',
      expiresAt: '2026-08-24T00:00:00Z',
    });

    const call = mailer.sendMail.mock.calls[0][0];
    expect(call.to).toBe('new@example.com');
    expect(call.subject).toMatch(/invited you to join Default Workspace/i);
    expect(call.html).toContain('/invite?token=tok_abc123456789');
    expect(call.text).toContain('/invite?token=tok_abc123456789');
    // Names both the workspace and who invited them — an unexplained
    // "create an account" mail reads as phishing.
    expect(call.html).toContain('Default Workspace');
    expect(call.html).toContain('rachit.jain@acureal.in');
  });

  test('explains what Acureal is — the recipient may never have heard of it', async () => {
    mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });
    await svc.sendInvitationEmail({
      ...BASE, to: 'new@example.com', hasAccount: false, rawToken: 'tok_abc123456789',
    });
    expect(mailer.sendMail.mock.calls[0][0].html).toMatch(/real-estate deal intelligence/i);
  });
});

describe('invitationEmail — Case A (already has an account)', () => {
  test('is a notification, with no token and nothing to accept', async () => {
    mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });

    await svc.sendInvitationEmail({
      ...BASE,
      to: 'bharath@acureal.in',
      hasAccount: true,
      recipientName: 'Bharath',
    });

    const call = mailer.sendMail.mock.calls[0][0];
    expect(call.subject).toMatch(/added you to Default Workspace/i);
    expect(call.html).toMatch(/nothing to accept/i);
    // An existing user cannot consume an invitation token (they are consumable
    // only at registration), so shipping one would be a dead link.
    expect(call.html).not.toContain('/invite?token=');
    expect(call.text).not.toContain('/invite?token=');
  });
});

describe('invitationEmail — link building', () => {
  test('fails CLOSED on a deploy with no APP_BASE_URL', async () => {
    delete process.env.APP_BASE_URL;
    process.env.VERCEL = '1';

    await expect(
      svc.sendInvitationEmail({
        ...BASE, to: 'new@example.com', hasAccount: false, rawToken: 'tok_abc123456789',
      })
    ).rejects.toThrow(/APP_BASE_URL/);
    // A well-formed email with a dead localhost link is worse than no email.
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  test('uses the configured origin when deployed', async () => {
    process.env.VERCEL = '1';
    process.env.APP_BASE_URL = 'https://acureal.in';
    mailer.sendMail.mockResolvedValueOnce({ provider: 'resend', id: 'x' });

    await svc.sendInvitationEmail({
      ...BASE, to: 'new@example.com', hasAccount: false, rawToken: 'tok_abc123456789',
    });

    const call = mailer.sendMail.mock.calls[0][0];
    expect(call.html).toContain('https://acureal.in/invite?token=');
    expect(call.html).not.toContain('localhost');
    expect(call.text).not.toContain('localhost');
  });
});

describe('invitationEmail — failure handling', () => {
  test('translates a provider failure into a 502', async () => {
    mailer.sendMail.mockRejectedValueOnce(new Error('Resend 500'));
    await expect(
      svc.sendInvitationEmail({
        ...BASE, to: 'new@example.com', hasAccount: false, rawToken: 'tok_abc123456789',
      })
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  test('sanitises angle brackets out of injected names', async () => {
    mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });
    await svc.sendInvitationEmail({
      ...BASE,
      inviterName: 'Evil <script>alert(1)</script>',
      to: 'new@example.com',
      hasAccount: false,
      rawToken: 'tok_abc123456789',
    });
    expect(mailer.sendMail.mock.calls[0][0].html).not.toContain('<script>');
  });
});
