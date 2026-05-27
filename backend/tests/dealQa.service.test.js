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
  getProviderAvailability: jest.fn(() => ({ claude: true, gpt_compatible: true })),
}));
jest.mock('../src/services/ai/aiRouter', () => ({
  runAIWithSchema: jest.fn(),
  runClaudeReasoning: jest.fn(),
}));
// P7-PR1 (Q&A v2) — the dealQa service now fans out a parallel lite-mode
// `getDealWorkspace(dealId, {lite:true})` call to expand the citation
// surface. In unit-test isolation we don't want that to touch the DB
// (which fires N service queries through the composer) — the workspace
// path is exercised by the dedicated dealWorkspace.service.test. Mock it
// to a minimal payload that has no slices, so the existing tests assert
// the V1 behaviour unchanged. Tests that exercise V2 slice citations
// override this per-test via `dealWorkspaceService.getDealWorkspace.mockResolvedValueOnce`.
jest.mock('../src/services/dealWorkspace.service', () => ({
  getDealWorkspace: jest.fn().mockResolvedValue(null),
}));

const { query } = require('../src/config/database');
const embeddings = require('../src/services/embeddings.service');
const aiRouter = require('../src/services/ai/aiRouter');
const dealWorkspaceService = require('../src/services/dealWorkspace.service');
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

  // Synthetic citations let the model ground a claim in a non-document
  // source (deal_snapshot / risk_flags / comps / financials) when no
  // document chunks have been retrieved. This is the common case for
  // sourcing-stage deals before any documents are uploaded.
  test('accepts synthetic citation ids (deal_snapshot / risk_flags / comps / financials)', () => {
    const result = dealQa.validateCitations(
      [
        { embedding_id: 'deal_snapshot', excerpt: 'IRR 22.4%' },
        { embedding_id: 'risk_flags', excerpt: 'EC mismatch' },
        { embedding_id: 'comps', excerpt: 'Whitefield comps INR 8500/sqft' },
        { embedding_id: 'financials', excerpt: 'Total cost INR 42 Cr' },
      ],
      [], // no retrieved chunks — pure synthetic case
    );
    expect(result.valid).toBe(true);
    expect(result.invalid_ids).toEqual([]);
  });

  test('mixes synthetic + document citations cleanly', () => {
    const result = dealQa.validateCitations(
      [
        { embedding_id: 'deal_snapshot', excerpt: 'IRR' },
        { embedding_id: 'a', excerpt: 'doc text' },
      ],
      [makeChunk('a')],
    );
    expect(result.valid).toBe(true);
  });

  test('still rejects unknown ids when mixed with synthetic ones', () => {
    const result = dealQa.validateCitations(
      [
        { embedding_id: 'deal_snapshot', excerpt: 'IRR' },
        { embedding_id: 'phantom-xyz', excerpt: 'wrong' },
      ],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.invalid_ids).toEqual(['phantom-xyz']);
  });

  // P7-PR1 — V2 expanded synthetic citation surface. The validator must
  // accept every workspace slice id so the model can ground a claim in
  // ic_readiness / micro_market / best_use / etc. without falling back
  // to the vague "deal_snapshot" tag.
  test('V2 — accepts every expanded workspace-slice citation id', () => {
    const expandedIds = [
      'ic_readiness',
      'karnataka_rera_readiness',
      'micro_market',
      'best_use',
      'deal_structure_recommender',
      'capital_stack_optimizer',
      'promoter_profile',
      'dd_checklist',
      'approvals',
      'recommendations',
      'deal_doctor',
      'waterfall',
    ];
    const result = dealQa.validateCitations(
      expandedIds.map((id) => ({ embedding_id: id, excerpt: `from ${id}` })),
      [], // no retrieved chunks — pure synthetic V2 case
    );
    expect(result.valid).toBe(true);
    expect(result.invalid_ids).toEqual([]);
  });

  test('V2 — rejects close-but-typoed slice ids (defends against model drift)', () => {
    const result = dealQa.validateCitations(
      [
        { embedding_id: 'ic_readiness', excerpt: 'ok' },
        { embedding_id: 'ic_readinesss', excerpt: 'typo' },              // double-s
        { embedding_id: 'micromarket', excerpt: 'missing-underscore' },  // no underscore
        { embedding_id: 'deal-doctor', excerpt: 'dash' },                // dash not underscore
      ],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.invalid_ids.sort()).toEqual(['deal-doctor', 'ic_readinesss', 'micromarket']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// V2 — workspace slice composition + citation hydration
// ──────────────────────────────────────────────────────────────────────────

describe('V2 — workspace slice expansion', () => {
  test('hydrateCitations gives every V2 slice id a friendly display label', () => {
    const cases = [
      ['ic_readiness',               'IC Readiness Pack'],
      ['karnataka_rera_readiness',   'K-RERA Readiness Pack'],
      ['micro_market',               'Micro-Market Briefing'],
      ['best_use',                   'Best Use Simulator'],
      ['deal_structure_recommender', 'Deal-Structure Recommender'],
      ['capital_stack_optimizer',    'Capital-Stack Optimizer'],
      ['promoter_profile',           'Promoter Profile'],
      ['dd_checklist',               'DD checklist'],
      ['approvals',                  'Required approvals'],
      ['recommendations',            'Recommendation Engine'],
      ['deal_doctor',                'Deal Doctor findings'],
      ['waterfall',                  'Waterfall (JDA/JV)'],
    ];
    for (const [sliceId, expectedLabel] of cases) {
      const hydrated = dealQa.hydrateCitations(
        [{ embedding_id: sliceId, excerpt: 'something', why_relevant: 'because' }],
        [],
      );
      expect(hydrated[0].kind).toBe('synthetic');
      expect(hydrated[0].document_name).toBe(expectedLabel);
      expect(hydrated[0].embedding_id).toBe(sliceId);
    }
  });

  test('hydrateCitations preserves chunk_text + similarity for document citations alongside V2 synthetic ones', () => {
    const hydrated = dealQa.hydrateCitations(
      [
        { embedding_id: 'doc-chunk-1', excerpt: 'd1' },
        { embedding_id: 'ic_readiness', excerpt: 'IC tier' },
      ],
      [makeChunk('doc-chunk-1', 'doc-1', 0.91)],
    );
    expect(hydrated).toHaveLength(2);
    expect(hydrated[0].similarity).toBe(0.91);
    expect(hydrated[0].document_name).toBe('doc-1.pdf');
    expect(hydrated[1].kind).toBe('synthetic');
    expect(hydrated[1].document_name).toBe('IC Readiness Pack');
  });

  test('buildPromptPayload omits the slices key when no workspace data is available (V1 backwards-compat)', () => {
    const payload = dealQa.buildPromptPayload({
      question: 'What is the IRR?',
      context: {
        deal: { id: 'd1', irr_pct: 18.5 },
        risks: [],
        comps: [],
        chunks: [],
        slices: null,
      },
    });
    expect(payload.slices).toBeUndefined();
    expect(payload.deal_snapshot).toMatchObject({ id: 'd1' });
  });

  test('buildPromptPayload omits the slices key when slices is an empty object', () => {
    const payload = dealQa.buildPromptPayload({
      question: 'Q',
      context: { deal: { id: 'd1' }, risks: [], comps: [], chunks: [], slices: {} },
    });
    expect(payload.slices).toBeUndefined();
  });

  test('buildPromptPayload includes the slices payload when workspace data is hydrated', () => {
    const slices = {
      ic_readiness: { score: 58, tier: 'pre_ic', pillars: [], top_gaps: [{ label: 'Land schedule incomplete', severity: 'high', pillar: 'financial' }] },
      promoter_profile: { promoter_name: 'Acme Builders', posture: 'unverified', signals: [] },
    };
    const payload = dealQa.buildPromptPayload({
      question: 'Why is this Pre-IC?',
      context: { deal: { id: 'd1' }, risks: [], comps: [], chunks: [], slices },
    });
    expect(payload.slices).toEqual(slices);
    expect(payload.slices.ic_readiness.top_gaps[0].label).toBe('Land schedule incomplete');
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
        kind: 'document',
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

  test('synthetic citations get a friendly display label + kind=synthetic', () => {
    const out = dealQa.hydrateCitations(
      [
        { embedding_id: 'deal_snapshot', excerpt: 'IRR is 22.4%', why_relevant: 'IRR claim' },
        { embedding_id: 'risk_flags',    excerpt: 'EC mismatch open' },
      ],
      [],
    );
    expect(out[0].kind).toBe('synthetic');
    expect(out[0].document_name).toBe('Deal snapshot');
    expect(out[0].excerpt).toBe('IRR is 22.4%');
    expect(out[0].chunk_text).toBeNull();
    expect(out[1].document_name).toBe('Open risk flags');
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
