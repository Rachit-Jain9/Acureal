'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const legalService = require('../src/services/legal.service');

describe('legal.service.sha256Hex', () => {
  test('produces the canonical SHA-256 hex of the input', () => {
    expect(legalService.sha256Hex('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
  });

  test('utf-8 multibyte input is digested by bytes, not codepoints', () => {
    const a = legalService.sha256Hex('हेलो'); // Hindi
    const b = legalService.sha256Hex('हेलो');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe('legal.service.getCurrentLegalDocument', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null when no current row exists', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await legalService.getCurrentLegalDocument('terms_of_service');
    expect(result).toBeNull();
  });

  test('returns mapped document when current row exists', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          kind: 'terms_of_service',
          version: 'v1',
          effective_at: '2026-05-04T00:00:00Z',
          body_md: '# T&C',
          content_sha256: 'abc',
          is_current: true,
          created_at: '2026-05-04T00:00:00Z',
        },
      ],
      rowCount: 1,
    });
    const doc = await legalService.getCurrentLegalDocument('terms_of_service');
    expect(doc).toMatchObject({
      id: 7,
      kind: 'terms_of_service',
      version: 'v1',
      content_sha256: 'abc',
      is_current: true,
    });
  });

  test('rejects unsupported kinds', async () => {
    await expect(legalService.getCurrentLegalDocument('not_a_kind')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('legal.service.recordAcceptance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws when documentIds is missing or empty', async () => {
    await expect(
      legalService.recordAcceptance({ userId: 'u1', documentIds: [] })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      legalService.recordAcceptance({ userId: 'u1', documentIds: null })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('inserts then refreshes user shortcut columns via the pooled query fn', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    await legalService.recordAcceptance({
      userId: 'user-1',
      documentIds: [10, 11],
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO public\.user_legal_acceptances/);
    expect(query.mock.calls[0][1]).toEqual(['user-1', '203.0.113.42', 'Mozilla/5.0', [10, 11]]);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE public\.users/);
    expect(query.mock.calls[1][1]).toEqual(['user-1']);
  });

  test('uses the supplied client (transaction) when provided', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await legalService.recordAcceptance(
      { userId: 'user-2', documentIds: [42] },
      client
    );
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('legal.service.resolveSignupAcceptance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws 400 when either version is missing', async () => {
    await expect(
      legalService.resolveSignupAcceptance({ acceptedTermsVersion: 'v1' })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      legalService.resolveSignupAcceptance({ acceptedPrivacyVersion: 'v1' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 503 when no current document is published', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      legalService.resolveSignupAcceptance({
        acceptedTermsVersion: 'v1',
        acceptedPrivacyVersion: 'v1',
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  test('throws 409 when the published version moved between page-load and submit', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          kind: 'terms_of_service',
          version: 'v2',
          effective_at: '2026-05-04T00:00:00Z',
          body_md: 'x',
          content_sha256: 'a',
          is_current: true,
          created_at: '2026-05-04T00:00:00Z',
        },
        {
          id: 2,
          kind: 'privacy_policy',
          version: 'v1',
          effective_at: '2026-05-04T00:00:00Z',
          body_md: 'x',
          content_sha256: 'b',
          is_current: true,
          created_at: '2026-05-04T00:00:00Z',
        },
      ],
      rowCount: 2,
    });

    await expect(
      legalService.resolveSignupAcceptance({
        acceptedTermsVersion: 'v1',
        acceptedPrivacyVersion: 'v1',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('returns the [tos.id, privacy.id] tuple on a current match', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          kind: 'terms_of_service',
          version: 'v1',
          effective_at: '2026-05-04T00:00:00Z',
          body_md: 'x',
          content_sha256: 'a',
          is_current: true,
          created_at: '2026-05-04T00:00:00Z',
        },
        {
          id: 22,
          kind: 'privacy_policy',
          version: 'v1',
          effective_at: '2026-05-04T00:00:00Z',
          body_md: 'x',
          content_sha256: 'b',
          is_current: true,
          created_at: '2026-05-04T00:00:00Z',
        },
      ],
      rowCount: 2,
    });

    const ids = await legalService.resolveSignupAcceptance({
      acceptedTermsVersion: 'v1',
      acceptedPrivacyVersion: 'v1',
    });
    expect(ids).toEqual([11, 22]);
  });
});

describe('legal.service.publishLegalDocument', () => {
  beforeEach(() => jest.clearAllMocks());

  test('flips prior current to false and upserts the new version', async () => {
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // unset prior current
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 99,
            kind: 'terms_of_service',
            version: 'v2',
            effective_at: '2026-05-04T00:00:00Z',
            body_md: '# new body',
            content_sha256: legalService.sha256Hex('# new body'),
            is_current: true,
            created_at: '2026-05-04T00:00:00Z',
          },
        ],
      });

    transaction.mockImplementation((fn) => fn(client));

    const doc = await legalService.publishLegalDocument({
      kind: 'terms_of_service',
      version: 'v2',
      effectiveAt: '2026-05-04T00:00:00Z',
      bodyMd: '# new body',
    });

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0][0]).toMatch(/UPDATE public\.legal_documents/);
    expect(client.query.mock.calls[1][0]).toMatch(/INSERT INTO public\.legal_documents/);
    expect(doc).toMatchObject({ id: 99, version: 'v2', is_current: true });
    expect(doc.content_sha256).toBe(legalService.sha256Hex('# new body'));
  });

  test('rejects unsupported kinds before opening a transaction', async () => {
    await expect(
      legalService.publishLegalDocument({
        kind: 'not_a_kind',
        version: 'v1',
        effectiveAt: new Date(),
        bodyMd: 'x',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
