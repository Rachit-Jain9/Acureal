'use strict';

// All deterministic helpers — no DB, no LLM. Mock everything so we can
// exercise the citation validator, hydrator, hash, schema in isolation.
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/embeddings.service', () => ({ searchSimilar: jest.fn() }));
jest.mock('../src/services/numericalVerifier.service', () => ({
  snapshotFromDealAnalysisInput: jest.fn(() => ({ irr_pct: null, total_revenue_cr: null, total_cost_cr: null, land_area_acres: null })),
  verifyDealAnalysis: jest.fn(() => ({ drifts: [], verifiedAt: '2026-05-09T00:00:00Z' })),
}));
jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ claude: true })),
}));
jest.mock('../src/services/ai/aiRouter', () => ({
  runAIWithSchema: jest.fn(),
  runClaudeReasoning: jest.fn(),
}));

const { query } = require('../src/config/database');
const embeddings = require('../src/services/embeddings.service');
const aiRouter = require('../src/services/ai/aiRouter');
const dealQa = require('../src/services/dealQa.service');

// Postgres "undefined_table" SQLSTATE — Q&A hits this when the
// 20260518_deal_qa_history migration hasn't been applied yet.
const makeMissingTableError = () => {
  const err = new Error('relation "deal_qa_history" does not exist');
  err.code = '42P01';
  return err;
};

beforeEach(() => {
  jest.clearAllMocks();
});

const makeChunk = (id, document_id = `doc-${id}`, similarity = 0.8) => ({
  embedding_id: id,
  document_id,
  document_name: `${document_id}.pdf`,
  page_number: 3,
  similarity,
  chunk_text: `Excerpt text for ${id}`,
  source_kind: 'document_chunk',
});

// ──────────────────────────────────────────────────────────────────────────
// Citation validator — the single most-important guardrail
// ──────────────────────────────────────────────────────────────────────────

describe('validateCitations', () => {
  test('passes when every citation references a real chunk', () => {
    const chunks = [makeChunk('a'), makeChunk('b')];
    const result = dealQa.validateCitations(
      [{ embedding_id: 'a', excerpt: 'x' }, { embedding_id: 'b', excerpt: 'y' }],
      chunks,
    );
    expect(result.valid).toBe(true);
    expect(result.invalid_ids).toEqual([]);
  });

  test('fails when a citation references a hallucinated chunk id', () => {
    const result = dealQa.validateCitations(
      [{ embedding_id: 'a', excerpt: 'x' }, { embedding_id: 'fake-id', excerpt: 'y' }],
      [makeChunk('a')],
    );
    expect(result.valid).toBe(false);
    expect(result.invalid_ids).toEqual(['fake-id']);
  });

  test('reports all invalid ids, not just the first', () => {
    const result = dealQa.validateCitations(
      [{ embedding_id: 'fake-1', excerpt: 'x' }, { embedding_id: 'fake-2', excerpt: 'y' }],
      [makeChunk('a')],
    );
    expect(result.invalid_ids).toEqual(['fake-1', 'fake-2']);
  });

  test('passes vacuously when citations array is empty', () => {
    // Schema enforces >= 1 citation; this is just defensive.
    expect(dealQa.validateCitations([], [makeChunk('a')]).valid).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Hydrator — adds doc name + page + similarity to model citations
// ──────────────────────────────────────────────────────────────────────────

describe('hydrateCitations', () => {
  test('attaches metadata from the matching retrieved chunk', () => {
    const chunks = [makeChunk('a', 'doc-1', 0.92)];
    const out = dealQa.hydrateCitations(
      [{ embedding_id: 'a', excerpt: 'foo', why_relevant: 'because' }],
      chunks,
    );
    expect(out).toEqual([
      {
        embedding_id: 'a',
        document_id: 'doc-1',
        document_name: 'doc-1.pdf',
        page_number: 3,
        similarity: 0.92,
        excerpt: 'foo',
        why_relevant: 'because',
        chunk_text: 'Excerpt text for a',
      },
    ]);
  });

  test('preserves model excerpt even if chunk_text is longer', () => {
    const chunks = [makeChunk('a')];
    const out = dealQa.hydrateCitations(
      [{ embedding_id: 'a', excerpt: 'short slice from chunk' }],
      chunks,
    );
    expect(out[0].excerpt).toBe('short slice from chunk');
    expect(out[0].chunk_text).toBe('Excerpt text for a');
  });

  test('null-fills metadata when chunk lookup misses (defensive)', () => {
    const out = dealQa.hydrateCitations(
      [{ embedding_id: 'phantom', excerpt: 'x' }],
      [],
    );
    expect(out[0].document_id).toBeNull();
    expect(out[0].document_name).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Snapshot hash — for short-circuit on identical re-asks
// ──────────────────────────────────────────────────────────────────────────

describe('computeSnapshotHash', () => {
  test('identical inputs → identical hash', () => {
    const h1 = dealQa.computeSnapshotHash({ question: 'What is the IRR?', chunks: [makeChunk('a'), makeChunk('b')] });
    const h2 = dealQa.computeSnapshotHash({ question: 'What is the IRR?', chunks: [makeChunk('a'), makeChunk('b')] });
    expect(h1).toBe(h2);
  });

  test('case + whitespace insensitive on the question', () => {
    const h1 = dealQa.computeSnapshotHash({ question: 'WHAT IS THE IRR?', chunks: [makeChunk('a')] });
    const h2 = dealQa.computeSnapshotHash({ question: '  what is the irr?  ', chunks: [makeChunk('a')] });
    expect(h1).toBe(h2);
  });

  test('chunk order independent', () => {
    const a = makeChunk('a');
    const b = makeChunk('b');
    const h1 = dealQa.computeSnapshotHash({ question: 'q', chunks: [a, b] });
    const h2 = dealQa.computeSnapshotHash({ question: 'q', chunks: [b, a] });
    expect(h1).toBe(h2);
  });

  test('different questions → different hashes', () => {
    const h1 = dealQa.computeSnapshotHash({ question: 'q1', chunks: [makeChunk('a')] });
    const h2 = dealQa.computeSnapshotHash({ question: 'q2', chunks: [makeChunk('a')] });
    expect(h1).not.toBe(h2);
  });

  test('different chunk sets → different hashes', () => {
    const h1 = dealQa.computeSnapshotHash({ question: 'q', chunks: [makeChunk('a')] });
    const h2 = dealQa.computeSnapshotHash({ question: 'q', chunks: [makeChunk('a'), makeChunk('b')] });
    expect(h1).not.toBe(h2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// AnswerSchema — Zod contract for LLM output
// ──────────────────────────────────────────────────────────────────────────

describe('AnswerSchema', () => {
  test('accepts a well-formed answer with one citation', () => {
    const result = dealQa.AnswerSchema.safeParse({
      answer: 'The deal IRR is 18.5%.',
      citations: [{ embedding_id: 'a', excerpt: 'IRR is 18.5%' }],
      confidence: 'high',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty citations array (mandatory >= 1)', () => {
    const result = dealQa.AnswerSchema.safeParse({
      answer: 'something',
      citations: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects a citation missing embedding_id', () => {
    const result = dealQa.AnswerSchema.safeParse({
      answer: 'something',
      citations: [{ excerpt: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  test('rejects an out-of-enum confidence', () => {
    const result = dealQa.AnswerSchema.safeParse({
      answer: 'something',
      citations: [{ embedding_id: 'a', excerpt: 'x' }],
      confidence: 'extreme',
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// askQuestion — input validation + happy path orchestration (mocked)
// ──────────────────────────────────────────────────────────────────────────

describe('askQuestion — input validation', () => {
  test('rejects empty question with 400', async () => {
    await expect(
      dealQa.askQuestion({ dealId: 'd1', question: '   ' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects > MAX_QUESTION_LENGTH with 400', async () => {
    const huge = 'x'.repeat(dealQa.MAX_QUESTION_LENGTH + 1);
    await expect(
      dealQa.askQuestion({ dealId: 'd1', question: huge }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('returns cached row when an identical question + chunks exists', async () => {
    // Mock chain:
    //   1. fetchDealSnapshot → returns a deal
    //   2. assembleContext queries (deal/risk/comps already covered, but
    //      embeddings.searchSimilar returns chunks)
    //   3. cache lookup hits
    embeddings.searchSimilar.mockResolvedValueOnce([makeChunk('a')]);
    query
      .mockResolvedValueOnce({ rows: [{ id: 'd1', name: 'Plot 22' }] }) // fetchDealSnapshot
      .mockResolvedValueOnce({ rows: [] }) // fetchRiskSummary
      .mockResolvedValueOnce({ rows: [] }) // fetchTopComps
      // documents lookup for hydration
      .mockResolvedValueOnce({ rows: [{ id: 'doc-a', name: 'doc-a.pdf' }] })
      // cache check
      .mockResolvedValueOnce({ rows: [{ id: 'cached-row', question: 'q', answer: 'cached answer' }] });

    const out = await dealQa.askQuestion({
      dealId: 'd1',
      question: 'What is the IRR?',
      organizationId: 'org-1',
    });
    expect(out.cache_hit).toBe(true);
    expect(out.answer).toBe('cached answer');
    expect(aiRouter.runAIWithSchema).not.toHaveBeenCalled();
  });

  test('rejects + persists when Claude returns a hallucinated citation id', async () => {
    embeddings.searchSimilar.mockResolvedValueOnce([makeChunk('a')]);
    query
      .mockResolvedValueOnce({ rows: [{ id: 'd1', name: 'Plot 22' }] }) // deal snapshot
      .mockResolvedValueOnce({ rows: [] }) // risks
      .mockResolvedValueOnce({ rows: [] }) // comps
      .mockResolvedValueOnce({ rows: [{ id: 'doc-a', name: 'doc-a.pdf' }] }) // doc meta
      .mockResolvedValueOnce({ rows: [] }) // cache miss
      .mockResolvedValueOnce({ rows: [{ id: 'fail-row', status: 'failed', failure_reason: 'Hallucinated citation ids: phantom' }] }); // INSERT
    aiRouter.runAIWithSchema.mockResolvedValueOnce({
      result: {
        answer: 'something',
        citations: [{ embedding_id: 'phantom', excerpt: 'x' }],
      },
      callId: 'call-1',
    });

    await expect(
      dealQa.askQuestion({
        dealId: 'd1',
        question: 'q',
        organizationId: 'org-1',
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Migration not yet applied — graceful 503 with operator instructions
// ──────────────────────────────────────────────────────────────────────────

describe('askQuestion — missing migration handling', () => {
  test('returns 503 with apply-migration message when cache lookup hits 42P01', async () => {
    embeddings.searchSimilar.mockResolvedValueOnce([makeChunk('a')]);
    query
      .mockResolvedValueOnce({ rows: [{ id: 'd1', name: 'Plot 22' }] })  // deal snapshot
      .mockResolvedValueOnce({ rows: [] })                               // risks
      .mockResolvedValueOnce({ rows: [] })                               // comps
      .mockResolvedValueOnce({ rows: [{ id: 'doc-a', name: 'doc-a.pdf' }] }) // doc meta
      .mockRejectedValueOnce(makeMissingTableError());                   // cache check fails

    await expect(
      dealQa.askQuestion({ dealId: 'd1', question: 'q', organizationId: 'org-1' }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringMatching(/deal_qa_history migration/i),
    });
  });

  test('returns 503 when INSERT fails with 42P01', async () => {
    embeddings.searchSimilar.mockResolvedValueOnce([makeChunk('a')]);
    query
      .mockResolvedValueOnce({ rows: [{ id: 'd1', name: 'Plot 22' }] })  // deal snapshot
      .mockResolvedValueOnce({ rows: [] })                               // risks
      .mockResolvedValueOnce({ rows: [] })                               // comps
      .mockResolvedValueOnce({ rows: [{ id: 'doc-a', name: 'doc-a.pdf' }] }) // doc meta
      .mockResolvedValueOnce({ rows: [] })                               // cache miss
      .mockRejectedValueOnce(makeMissingTableError());                   // INSERT fails
    aiRouter.runAIWithSchema.mockResolvedValueOnce({
      result: { answer: 'ok', citations: [{ embedding_id: 'a', excerpt: 'x' }] },
      callId: 'call-1',
    });

    await expect(
      dealQa.askQuestion({ dealId: 'd1', question: 'q', organizationId: 'org-1' }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringMatching(/deal_qa_history migration/i),
    });
  });

  test('listHistory fails open — returns [] when table is missing', async () => {
    query.mockRejectedValueOnce(makeMissingTableError());
    const rows = await dealQa.listHistory('d1');
    expect(rows).toEqual([]);
  });
});
