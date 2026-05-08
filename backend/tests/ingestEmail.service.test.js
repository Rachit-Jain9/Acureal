'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../src/config/storage', () => ({
  uploadFile: jest.fn(),
}));

const crypto = require('crypto');
const { query } = require('../src/config/database');
const { uploadFile } = require('../src/config/storage');
const ingest = require('../src/services/ingestEmail.service');

const ORG_ID = '00000000-0000-0000-0000-000000000001';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEFAULT_INGEST_ORGANIZATION_ID = ORG_ID;
  delete process.env.INGEST_WEBHOOK_HMAC_KEY;
  delete process.env.INGEST_WEBHOOK_BASIC_USER;
  delete process.env.INGEST_WEBHOOK_BASIC_PASS;
});

// ──────────────────────────────────────────────────────────────────────────
// Auth verification
// ──────────────────────────────────────────────────────────────────────────

describe('verifyHmacSignature', () => {
  test('returns true for matching signature', () => {
    const key = 'shared-secret';
    const body = '{"a":1}';
    const sig = 'sha256=' + crypto.createHmac('sha256', key).update(body).digest('hex');
    expect(ingest.verifyHmacSignature(body, sig, key)).toBe(true);
  });

  test('returns false for tampered body', () => {
    const key = 'shared-secret';
    const body = '{"a":1}';
    const sig = 'sha256=' + crypto.createHmac('sha256', key).update(body).digest('hex');
    expect(ingest.verifyHmacSignature('{"a":2}', sig, key)).toBe(false);
  });

  test('returns false when key or signature missing', () => {
    expect(ingest.verifyHmacSignature('body', null, 'k')).toBe(false);
    expect(ingest.verifyHmacSignature('body', 'sha256=abc', null)).toBe(false);
  });
});

describe('verifyBasicAuth', () => {
  test('returns true for matching user:pass', () => {
    const header = 'Basic ' + Buffer.from('user1:pw1', 'utf8').toString('base64');
    expect(ingest.verifyBasicAuth(header, 'user1', 'pw1')).toBe(true);
  });

  test('returns false for wrong password', () => {
    const header = 'Basic ' + Buffer.from('user1:wrong', 'utf8').toString('base64');
    expect(ingest.verifyBasicAuth(header, 'user1', 'right')).toBe(false);
  });

  test('returns false for missing or non-basic header', () => {
    expect(ingest.verifyBasicAuth(null, 'u', 'p')).toBe(false);
    expect(ingest.verifyBasicAuth('Bearer abc', 'u', 'p')).toBe(false);
  });
});

describe('verifyWebhookAuth', () => {
  test('HMAC path succeeds when key + signature match', () => {
    process.env.INGEST_WEBHOOK_HMAC_KEY = 'k';
    const body = '{"x":1}';
    const sig = 'sha256=' + crypto.createHmac('sha256', 'k').update(body).digest('hex');
    expect(
      ingest.verifyWebhookAuth({
        rawBody: body,
        headers: { 'x-webhook-signature': sig },
      }),
    ).toBe('hmac');
  });

  test('HMAC mismatch throws 401 (does not fall through to Basic)', () => {
    process.env.INGEST_WEBHOOK_HMAC_KEY = 'k';
    process.env.INGEST_WEBHOOK_BASIC_USER = 'u';
    process.env.INGEST_WEBHOOK_BASIC_PASS = 'p';
    expect(() =>
      ingest.verifyWebhookAuth({
        rawBody: '{}',
        headers: {
          'x-webhook-signature': 'sha256=deadbeef',
          authorization: 'Basic ' + Buffer.from('u:p').toString('base64'),
        },
      }),
    ).toThrow(/HMAC signature/);
  });

  test('Basic path succeeds when HMAC is not configured', () => {
    process.env.INGEST_WEBHOOK_BASIC_USER = 'u';
    process.env.INGEST_WEBHOOK_BASIC_PASS = 'p';
    expect(
      ingest.verifyWebhookAuth({
        rawBody: '{}',
        headers: { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') },
      }),
    ).toBe('basic');
  });

  test('throws 401 when no auth modes are configured', () => {
    expect(() => ingest.verifyWebhookAuth({ rawBody: '{}', headers: {} })).toThrow(
      /Webhook auth failed/,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Source classification + parsing
// ──────────────────────────────────────────────────────────────────────────

describe('extractEmailDomain', () => {
  test('handles bare address', () => {
    expect(ingest.extractEmailDomain('analyst@cw.com')).toBe('cw.com');
  });
  test('handles RFC name address form', () => {
    expect(ingest.extractEmailDomain('Anu Bose <anu@jll.com>')).toBe('jll.com');
  });
  test('lowercases and trims', () => {
    expect(ingest.extractEmailDomain('User <USER@JLL.CO.IN>')).toBe('jll.co.in');
  });
  test('returns empty on garbage', () => {
    expect(ingest.extractEmailDomain('not-an-email')).toBe('');
    expect(ingest.extractEmailDomain(null)).toBe('');
  });
});

describe('inferSourceFromEmail', () => {
  test('CW sender → email_ipc_report', () => {
    expect(ingest.inferSourceFromEmail({ from: 'analyst@cw.com', subject: 'Q1 deck' })).toBe(
      'email_ipc_report',
    );
  });

  test('JLL India sub-domain → email_ipc_report', () => {
    expect(
      ingest.inferSourceFromEmail({
        from: 'analyst@bengaluru.jll.co.in',
        subject: 'office stock update',
      }),
    ).toBe('email_ipc_report');
  });

  test('subject with "rate" keyword → email_broker_quote', () => {
    expect(
      ingest.inferSourceFromEmail({
        from: 'broker@rebound.in',
        subject: 'Whitefield rate sheet — May 2026',
      }),
    ).toBe('email_broker_quote');
  });

  test('non-IPC, no keyword → email_other', () => {
    expect(
      ingest.inferSourceFromEmail({ from: 'random@company.com', subject: 'hi' }),
    ).toBe('email_other');
  });
});

describe('resolveOrganizationId', () => {
  test('returns DEFAULT_INGEST_ORGANIZATION_ID', () => {
    expect(ingest.resolveOrganizationId({})).toBe(ORG_ID);
  });

  test('throws when env not set', () => {
    delete process.env.DEFAULT_INGEST_ORGANIZATION_ID;
    expect(() => ingest.resolveOrganizationId({})).toThrow(
      /DEFAULT_INGEST_ORGANIZATION_ID/,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Full payload ingestion — end-to-end mock
// ──────────────────────────────────────────────────────────────────────────

function makePostmarkPayload({ attachments = [], from = 'broker@rebound.in', subject = 'rates' } = {}) {
  return {
    From: from,
    FromName: 'Test Broker',
    Subject: subject,
    MessageID: 'msg-test-001',
    Date: '2026-05-08T10:00:00+05:30',
    TextBody: 'See attached.',
    Attachments: attachments,
  };
}

describe('ingestPostmarkPayload', () => {
  test('with one PDF attachment: uploads + inserts one queue row, accepted=1', async () => {
    uploadFile.mockResolvedValueOnce({ url: 'https://blob/comps-queue/1/file.pdf', isBlob: true });
    query.mockResolvedValueOnce({ rows: [{ id: 'q-1' }] });

    const pdfBytes = Buffer.from('hello-pdf');
    const payload = makePostmarkPayload({
      attachments: [
        {
          Name: 'rates.pdf',
          ContentType: 'application/pdf',
          ContentLength: pdfBytes.length,
          Content: pdfBytes.toString('base64'),
        },
      ],
    });

    const summary = await ingest.ingestPostmarkPayload(payload);

    expect(summary.accepted).toBe(1);
    expect(summary.deduplicated).toBe(0);
    expect(summary.rejected).toBe(0);
    expect(summary.queue_ids).toEqual(['q-1']);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    // Confirm the org id and source were passed to the INSERT.
    const [, params] = query.mock.calls[0];
    expect(params[0]).toBe(ORG_ID);
    expect(params[1]).toBe('email_broker_quote'); // subject "rates"
  });

  test('rejects disallowed mime types without uploading', async () => {
    const payload = makePostmarkPayload({
      attachments: [
        {
          Name: 'evil.exe',
          ContentType: 'application/x-msdownload',
          ContentLength: 10,
          Content: Buffer.from('xxx').toString('base64'),
        },
      ],
    });

    const summary = await ingest.ingestPostmarkPayload(payload);

    expect(summary.accepted).toBe(0);
    expect(summary.rejected).toBe(1);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('with no attachments: still inserts a body-only row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'q-body' }] });

    const summary = await ingest.ingestPostmarkPayload(
      makePostmarkPayload({ attachments: [] }),
    );

    expect(summary.accepted).toBe(1);
    expect(summary.queue_ids).toEqual(['q-body']);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('treats a 23505 unique violation as a dedupe, not an error', async () => {
    uploadFile.mockResolvedValueOnce({ url: 'https://blob/x.pdf', isBlob: true });
    const dupErr = Object.assign(new Error('duplicate'), { code: '23505' });
    // First call (insert) throws; second call (lookup) returns the existing row.
    query.mockRejectedValueOnce(dupErr);
    query.mockResolvedValueOnce({ rows: [{ id: 'existing-1' }] });

    const pdfBytes = Buffer.from('dup-pdf');
    const summary = await ingest.ingestPostmarkPayload(
      makePostmarkPayload({
        attachments: [
          {
            Name: 'r.pdf',
            ContentType: 'application/pdf',
            ContentLength: pdfBytes.length,
            Content: pdfBytes.toString('base64'),
          },
        ],
      }),
    );

    expect(summary.accepted).toBe(0);
    expect(summary.deduplicated).toBe(1);
    expect(summary.queue_ids).toEqual(['existing-1']);
  });
});
