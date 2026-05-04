jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

const { query } = require('../src/config/database');
const aiArtifacts = require('../src/services/aiArtifacts.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aiArtifacts.computeSnapshotHash', () => {
  test('returns null for null/undefined', () => {
    expect(aiArtifacts.computeSnapshotHash(null)).toBeNull();
    expect(aiArtifacts.computeSnapshotHash(undefined)).toBeNull();
  });

  test('produces a stable 64-char hex sha256', () => {
    const hash = aiArtifacts.computeSnapshotHash({ a: 1, b: 2 });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('key order does NOT change the hash (canonical sort)', () => {
    const a = aiArtifacts.computeSnapshotHash({ a: 1, b: 2, c: { x: 1, y: 2 } });
    const b = aiArtifacts.computeSnapshotHash({ c: { y: 2, x: 1 }, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  test('value change flips the hash', () => {
    const a = aiArtifacts.computeSnapshotHash({ value: 1 });
    const b = aiArtifacts.computeSnapshotHash({ value: 2 });
    expect(a).not.toBe(b);
  });

  test('array element order DOES change the hash (positional)', () => {
    const a = aiArtifacts.computeSnapshotHash([1, 2, 3]);
    const b = aiArtifacts.computeSnapshotHash([3, 2, 1]);
    expect(a).not.toBe(b);
  });
});

describe('aiArtifacts.isMissingTableError', () => {
  test('matches Postgres SQLSTATE 42P01', () => {
    expect(aiArtifacts.isMissingTableError({ code: '42P01' })).toBe(true);
  });

  test('matches relation-does-not-exist message', () => {
    expect(
      aiArtifacts.isMissingTableError(new Error('relation "ai_artifacts" does not exist')),
    ).toBe(true);
  });

  test('does NOT match unrelated errors', () => {
    expect(aiArtifacts.isMissingTableError(new Error('Connection timeout'))).toBe(false);
    expect(aiArtifacts.isMissingTableError({ code: '23505' })).toBe(false);
  });
});

describe('aiArtifacts.getLatestArtifact', () => {
  test('returns the row when query succeeds', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'a-1', deal_id: 'd-1', artifact_type: 'deal_analysis', content_md: 'hello' }],
    });
    const row = await aiArtifacts.getLatestArtifact({ dealId: 'd-1', artifactType: 'deal_analysis' });
    expect(row.id).toBe('a-1');
    expect(row.content_md).toBe('hello');
  });

  test('returns null on missing table (fail-open)', async () => {
    const err = new Error('relation "public.ai_artifacts" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const row = await aiArtifacts.getLatestArtifact({ dealId: 'd-1', artifactType: 'deal_analysis' });
    expect(row).toBeNull();
  });

  test('returns null on transient query error (fail-open)', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const row = await aiArtifacts.getLatestArtifact({ dealId: 'd-1', artifactType: 'deal_analysis' });
    expect(row).toBeNull();
  });

  test('rejects unknown artifact_type without hitting the DB', async () => {
    const row = await aiArtifacts.getLatestArtifact({ dealId: 'd-1', artifactType: 'bogus_type' });
    expect(row).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('passes snapshotHash through to the SQL when provided', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await aiArtifacts.getLatestArtifact({
      dealId: 'd-1',
      artifactType: 'deal_analysis',
      snapshotHash: 'abc123',
    });
    expect(query.mock.calls[0][1]).toEqual(['d-1', 'deal_analysis', 'abc123']);
  });
});

describe('aiArtifacts.saveArtifact', () => {
  test('inserts and returns the new id', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'new-id', generated_at: '2026-05-04T00:00:00Z' }],
    });
    const out = await aiArtifacts.saveArtifact({
      organizationId: 'org-1',
      dealId: 'd-1',
      artifactType: 'deal_analysis',
      contentMd: 'memo body',
      snapshotHash: 'abc',
      generatedByCallId: 'call-1',
    });
    expect(out.id).toBe('new-id');
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO public\.ai_artifacts/);
  });

  test('returns null on missing table (fail-open)', async () => {
    const err = new Error('relation "public.ai_artifacts" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const out = await aiArtifacts.saveArtifact({
      organizationId: 'org-1',
      dealId: 'd-1',
      artifactType: 'deal_analysis',
      contentMd: 'memo',
    });
    expect(out).toBeNull();
  });

  test('refuses unsupported artifact types', async () => {
    const out = await aiArtifacts.saveArtifact({
      organizationId: 'org-1',
      dealId: 'd-1',
      artifactType: 'bogus',
      contentMd: 'x',
    });
    expect(out).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('refuses missing organizationId / contentMd', async () => {
    expect(
      await aiArtifacts.saveArtifact({ artifactType: 'deal_analysis', contentMd: 'x' }),
    ).toBeNull();
    expect(
      await aiArtifacts.saveArtifact({ organizationId: 'o', artifactType: 'deal_analysis' }),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
