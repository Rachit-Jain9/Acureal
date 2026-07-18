jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
  return { child };
});

const { query } = require('../src/config/database');
const svc = require('../src/services/evidenceLinks.service');

const mockRow = (o) => query.mockResolvedValueOnce({ rows: [o] });

beforeEach(() => jest.clearAllMocks());

describe('evidenceLinks.summariseForOwner — "verified" means HUMAN-verified', () => {
  test('an approved regulatory source → verified', async () => {
    mockRow({ source_count: 2, manual_count: 0, max_confidence: 0.72, avg_confidence: 0.6, human_approved: true });
    const s = await svc.summariseForOwner('dd_item', 'owner-1');
    expect(s.bucket).toBe('verified');
    expect(s.human_approved).toBe(true);
  });

  test('a manual verification link → verified even with zero AI sources (no longer downgraded)', async () => {
    mockRow({ source_count: 0, manual_count: 1, max_confidence: null, avg_confidence: null, human_approved: true });
    const s = await svc.summariseForOwner('risk_flag', 'owner-2');
    expect(s.bucket).toBe('verified');
  });

  test('REGRESSION: a high-confidence AI source that is still PENDING review → inferred, never verified', async () => {
    mockRow({ source_count: 1, manual_count: 0, max_confidence: 0.95, avg_confidence: 0.95, human_approved: false });
    const s = await svc.summariseForOwner('comp', 'owner-3');
    expect(s.bucket).toBe('inferred');
    expect(s.human_approved).toBe(false);
  });

  test('no links at all → needs_verification', async () => {
    mockRow({ source_count: 0, manual_count: 0, max_confidence: null, avg_confidence: null, human_approved: null });
    const s = await svc.summariseForOwner('dd_item', 'owner-4');
    expect(s.bucket).toBe('needs_verification');
  });

  test('the gate is human review, not a confidence threshold', async () => {
    mockRow({ source_count: 0, manual_count: 0, max_confidence: null, avg_confidence: null, human_approved: false });
    await svc.summariseForOwner('dd_item', 'owner-5');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/review_status = 'approved'/);
    expect(sql).toMatch(/manual_verification/);
    expect(sql).toMatch(/human_approved/);
    // The old `confidence >= 0.8` promotion must be gone.
    expect(sql).not.toMatch(/0\.8/);
  });
});
