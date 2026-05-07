jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

// Embeddings now route through aiRouter so cost lands in ai_call_logs.
// Mock the router at the module boundary the service imports from.
jest.mock('../src/services/ai/aiRouter', () => ({
  runOpenAIEmbedding: jest.fn(),
}));

const { query } = require('../src/config/database');
const { runOpenAIEmbedding } = require('../src/services/ai/aiRouter');
const embeddings = require('../src/services/embeddings.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('embeddings.chunkText', () => {
  test('returns [] for empty/non-string input', () => {
    expect(embeddings.chunkText('')).toEqual([]);
    expect(embeddings.chunkText('   \n  ')).toEqual([]);
    expect(embeddings.chunkText(null)).toEqual([]);
    expect(embeddings.chunkText(42)).toEqual([]);
  });

  test('splits paragraph-aligned text into one chunk per paragraph', () => {
    const out = embeddings.chunkText('First paragraph.\n\nSecond paragraph.\n\nThird.');
    expect(out).toEqual(['First paragraph.', 'Second paragraph.', 'Third.']);
  });

  test('windows over a long single paragraph with overlap', () => {
    const long = 'a'.repeat(2400);
    const out = embeddings.chunkText(long, { size: 1000, overlap: 100 });
    expect(out.length).toBeGreaterThanOrEqual(2);
    // Each chunk capped at requested size
    expect(out.every((c) => c.length <= 1000)).toBe(true);
  });
});

describe('embeddings.embed', () => {
  test('returns embeddings + model + dimensions', async () => {
    runOpenAIEmbedding.mockResolvedValueOnce({
      result: [[0.1, 0.2, 0.3]],
      dimensions: 3,
    });
    const out = await embeddings.embed('hello');
    expect(out.embeddings).toEqual([[0.1, 0.2, 0.3]]);
    expect(out.dimensions).toBe(3);
    expect(out.model).toMatch(/text-embedding/);
  });
});

describe('embeddings.storeChunks', () => {
  test('inserts rows with vector literals + returns count', async () => {
    query.mockResolvedValueOnce({ rowCount: 2 });
    const out = await embeddings.storeChunks({
      organizationId: 'org-1',
      documentId: 'doc-1',
      chunks: ['hello', 'world'],
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
      model: 'text-embedding-3-small',
      sourceKind: 'document_chunk',
    });
    expect(out.rows_inserted).toBe(2);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO public\.document_embeddings/);
    expect(sql).toMatch(/UNNEST/);
    // Embeddings serialized as pgvector literal `[a,b,c]`
    const params = query.mock.calls[0][1];
    expect(params[4]).toEqual(['[0.1,0.2]', '[0.3,0.4]']);
  });

  test('throws when chunks/embeddings lengths mismatch', async () => {
    await expect(embeddings.storeChunks({
      organizationId: 'org-1',
      chunks: ['a', 'b'],
      embeddings: [[0.1]],
      model: 'm',
      sourceKind: 'document_chunk',
    })).rejects.toThrow(/length must match/);
  });

  test('returns zero on empty input without hitting DB', async () => {
    const out = await embeddings.storeChunks({
      organizationId: 'org-1',
      chunks: [],
      embeddings: [],
      model: 'm',
      sourceKind: 'document_chunk',
    });
    expect(out.rows_inserted).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('embeddings.indexDocumentText', () => {
  test('chunks → embeds → stores end-to-end', async () => {
    runOpenAIEmbedding.mockResolvedValueOnce({
      result: [[0.1, 0.2], [0.3, 0.4]],
      dimensions: 2,
    });
    query.mockResolvedValueOnce({ rowCount: 2 });

    const out = await embeddings.indexDocumentText({
      organizationId: 'org-1',
      documentId: 'doc-1',
      text: 'First paragraph.\n\nSecond paragraph.',
    });
    expect(out.rows_inserted).toBe(2);
  });

  test('skips when text is empty', async () => {
    const out = await embeddings.indexDocumentText({
      organizationId: 'org-1',
      documentId: 'doc-1',
      text: '   ',
    });
    expect(out.skipped).toBe(true);
    expect(runOpenAIEmbedding).not.toHaveBeenCalled();
  });

  test('fail-open on provider error — returns error in result, never throws', async () => {
    runOpenAIEmbedding.mockRejectedValueOnce(new Error('OpenAI 503'));
    const out = await embeddings.indexDocumentText({
      organizationId: 'org-1',
      documentId: 'doc-1',
      text: 'some text content',
    });
    expect(out.rows_inserted).toBe(0);
    expect(out.error).toMatch(/503/);
  });
});

describe('embeddings.searchSimilar', () => {
  test('returns scored rows from cosine search', async () => {
    runOpenAIEmbedding.mockResolvedValueOnce({
      result: [[0.5, 0.5]],
      dimensions: 2,
    });
    query.mockResolvedValueOnce({
      rows: [
        { id: 'a', chunk_text: 'match', similarity: 0.92 },
        { id: 'b', chunk_text: 'next',  similarity: 0.71 },
      ],
    });
    const out = await embeddings.searchSimilar({ query: 'find encumbrance clauses' });
    expect(out.length).toBe(2);
    expect(out[0].similarity).toBeGreaterThan(out[1].similarity);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/<=>/); // cosine distance operator
    expect(sql).toMatch(/ORDER BY embedding/);
  });

  test('returns [] for empty query', async () => {
    expect(await embeddings.searchSimilar({ query: '' })).toEqual([]);
    expect(runOpenAIEmbedding).not.toHaveBeenCalled();
  });

  test('passes documentId + sourceKind filters into the WHERE clause', async () => {
    runOpenAIEmbedding.mockResolvedValueOnce({ result: [[0.1]], dimensions: 1 });
    query.mockResolvedValueOnce({ rows: [] });
    await embeddings.searchSimilar({
      query: 'x',
      documentId: 'doc-99',
      sourceKind: 'evidence_fact',
    });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/document_id = \$3/);
    expect(sql).toMatch(/source_kind = \$4/);
  });

  test('fail-open on provider error → returns []', async () => {
    runOpenAIEmbedding.mockRejectedValueOnce(new Error('OpenAI down'));
    const out = await embeddings.searchSimilar({ query: 'x' });
    expect(out).toEqual([]);
  });
});
