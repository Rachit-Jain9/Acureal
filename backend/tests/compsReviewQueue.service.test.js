'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../src/services/extraction.service', () => ({
  extractStoredFileFields: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const extraction = require('../src/services/extraction.service');
const queue = require('../src/services/compsReviewQueue.service');

beforeEach(() => {
  jest.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// normalizeProjectType — deterministic asset-class mapping
// ──────────────────────────────────────────────────────────────────────────

describe('normalizeProjectType', () => {
  test('residential signals map to residential', () => {
    expect(queue.normalizeProjectType('residential', null)).toBe('residential');
    expect(queue.normalizeProjectType('apartment', null)).toBe('residential');
    expect(queue.normalizeProjectType(null, 'villa')).toBe('residential');
    expect(queue.normalizeProjectType('plotted development', null)).toBe('residential');
    expect(queue.normalizeProjectType(null, 'builder floor')).toBe('residential');
  });

  test('commercial signals map to commercial', () => {
    expect(queue.normalizeProjectType('office', null)).toBe('commercial');
    expect(queue.normalizeProjectType(null, 'retail mall')).toBe('commercial');
    expect(queue.normalizeProjectType('warehouse', null)).toBe('commercial');
    expect(queue.normalizeProjectType('hospitality', null)).toBe('commercial');
    expect(queue.normalizeProjectType(null, 'data centre')).toBe('commercial');
  });

  test('mixed-use signals map to mixed_use', () => {
    expect(queue.normalizeProjectType('mixed-use', null)).toBe('mixed_use');
    expect(queue.normalizeProjectType(null, 'mixed use development')).toBe('mixed_use');
  });

  test('blank or unknown defaults to residential', () => {
    expect(queue.normalizeProjectType(null, null)).toBe('residential');
    expect(queue.normalizeProjectType('', '')).toBe('residential');
    expect(queue.normalizeProjectType('xyzzy', 'frobnicate')).toBe('residential');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// mapToCompsRow — payload → comps schema
// ──────────────────────────────────────────────────────────────────────────

describe('mapToCompsRow', () => {
  const ORG = '00000000-0000-0000-0000-000000000123';

  test('maps a complete comp to comps row shape', () => {
    const { row, missing } = queue.mapToCompsRow(
      {
        project_name: 'Provident Park Square',
        developer: 'Provident Housing',
        city: 'Bengaluru',
        locality: 'Kanakapura Road',
        rate_per_sqft: 7800,
        super_builtup_area_sqft: 1340,
        carpet_area_sqft: 1100,
        total_units: 280,
        launch_year: 2025,
        possession_year: 2027,
        rera_number: 'PRM/KA/RERA/abc',
        amenities: ['Pool', 'Gym'],
        asset_class: 'residential',
      },
      ORG
    );
    expect(missing).toEqual([]);
    expect(row.organization_id).toBe(ORG);
    expect(row.project_type).toBe('residential');
    expect(row.rate_per_sqft).toBe(7800);
    expect(row.amenities).toEqual(['Pool', 'Gym']);
  });

  test('reports required fields when missing', () => {
    const { row, missing } = queue.mapToCompsRow(
      { developer: 'X' }, // no project_name, city, rate_per_sqft
      ORG
    );
    expect(row).toBeNull();
    expect(missing).toEqual(['project_name', 'city', 'rate_per_sqft']);
  });

  test('rejects negative rate', () => {
    const { row, missing } = queue.mapToCompsRow(
      { project_name: 'X', city: 'Y', rate_per_sqft: -100 },
      ORG
    );
    expect(row).toBeNull();
    expect(missing).toContain('rate_per_sqft');
  });

  test('parses numeric strings (Indian rupee comma format trimmed)', () => {
    const { row } = queue.mapToCompsRow(
      { project_name: 'X', city: 'Y', rate_per_sqft: '7,800' },
      ORG
    );
    expect(row.rate_per_sqft).toBe(7800);
  });

  test('coerces unrealistic year to null', () => {
    const { row } = queue.mapToCompsRow(
      { project_name: 'X', city: 'Y', rate_per_sqft: 1000, launch_year: 1800 },
      ORG
    );
    expect(row.launch_year).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildCommitCandidates — payload precedence
// ──────────────────────────────────────────────────────────────────────────

describe('buildCommitCandidates', () => {
  test('reviewer_edits.comps wins when present', () => {
    const cands = queue.buildCommitCandidates({
      reviewer_edits: { comps: [{ project_name: 'Edited' }] },
      structured_payload: { comps: [{ project_name: 'Original' }, { project_name: 'B' }] },
    });
    expect(cands).toHaveLength(1);
    expect(cands[0].project_name).toBe('Edited');
  });

  test('falls back to structured_payload.comps when reviewer_edits is empty', () => {
    const cands = queue.buildCommitCandidates({
      reviewer_edits: {},
      structured_payload: { comps: [{ project_name: 'A' }, { project_name: 'B' }] },
    });
    expect(cands).toHaveLength(2);
  });

  test('synthesizes single-comp from broker_quote-shape payload', () => {
    const cands = queue.buildCommitCandidates({
      structured_payload: {
        property_address: 'Plot 21, Whitefield',
        asking_price_per_sqft: 9500,
        total_area_sqft: 5400,
      },
    });
    expect(cands).toHaveLength(1);
    expect(cands[0].project_name).toBe('Plot 21, Whitefield');
    expect(cands[0].rate_per_sqft).toBe(9500);
  });

  test('returns empty array when payload has nothing usable', () => {
    expect(queue.buildCommitCandidates({})).toEqual([]);
    expect(queue.buildCommitCandidates({ structured_payload: { unknown: 'x' } })).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// processQueueRow — extraction wiring
// ──────────────────────────────────────────────────────────────────────────

describe('processQueueRow', () => {
  test('skips already-processed rows', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending_review', organization_id: 'o' }] });
    const r = await queue.processQueueRow('r1');
    expect(r.reason).toBe('already_processed');
    expect(extraction.extractStoredFileFields).not.toHaveBeenCalled();
  });

  test('skips terminal rows', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'committed', organization_id: 'o' }] });
    const r = await queue.processQueueRow('r1');
    expect(r.reason).toBe('terminal');
    expect(extraction.extractStoredFileFields).not.toHaveBeenCalled();
  });

  test('body-only rows transition to pending_review without extraction', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'r1', status: 'pending_extraction', organization_id: 'o', raw_doc_url: null }],
      })
      .mockResolvedValueOnce({ rows: [] }); // transitionStatus update
    const r = await queue.processQueueRow('r1');
    expect(r.reason).toBe('body_only');
    expect(extraction.extractStoredFileFields).not.toHaveBeenCalled();
  });

  test('runs extraction with source-mapped doctype + transitions to pending_review', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'r1',
            status: 'pending_extraction',
            organization_id: 'o',
            raw_doc_url: 'https://blob/x.pdf',
            raw_doc_mime: 'application/pdf',
            source: 'email_ipc_report',
            source_meta: { attachment_name: 'q1.pdf', subject: 'Q1', from: 'a@jll.com' },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // transitionStatus → extracting
      .mockResolvedValueOnce({ rows: [] }); // transitionStatus → pending_review
    extraction.extractStoredFileFields.mockResolvedValueOnce({
      docType: 'ipc_report',
      structuredFields: { comps: [{ project_name: 'P', rate_per_sqft: 9000 }] },
      confidenceScores: { _overall: 0.85 },
    });

    const r = await queue.processQueueRow('r1');

    expect(r.status).toBe('pending_review');
    expect(r.confidence_overall).toBe(0.85);
    expect(extraction.extractStoredFileFields).toHaveBeenCalledTimes(1);
    const callArgs = extraction.extractStoredFileFields.mock.calls[0][0];
    expect(callArgs.options.docType).toBe('ipc_report'); // mapped from source
  });

  test('failure transitions to failed status and surfaces message', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'r1',
            status: 'pending_extraction',
            organization_id: 'o',
            raw_doc_url: 'https://blob/x.pdf',
            raw_doc_mime: 'application/pdf',
            source: 'email_broker_quote',
            source_meta: {},
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // transition → extracting
      .mockResolvedValueOnce({ rows: [] }); // transition → failed
    extraction.extractStoredFileFields.mockRejectedValueOnce(new Error('Gemini blew up'));

    const r = await queue.processQueueRow('r1');
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Gemini blew up/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// approveAndCommit — transactional insert into comps + queue update
// ──────────────────────────────────────────────────────────────────────────

describe('approveAndCommit', () => {
  test('throws when row not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(queue.approveAndCommit('missing', 'u')).rejects.toThrow(/not found/);
  });

  test('throws when status is not pending_review', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'r1', status: 'committed', organization_id: 'o' }],
    });
    await expect(queue.approveAndCommit('r1', 'u')).rejects.toThrow(/Cannot approve/);
  });

  test('throws when payload has no candidates', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'r1', status: 'pending_review', organization_id: 'o', structured_payload: {} }],
    });
    await expect(queue.approveAndCommit('r1', 'u')).rejects.toThrow(/empty/);
  });

  test('inserts each valid comp + updates queue + returns summary', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'r1',
          status: 'pending_review',
          organization_id: 'org-1',
          structured_payload: {
            comps: [
              { project_name: 'Good', city: 'Bengaluru', rate_per_sqft: 7800 },
              { project_name: 'Bad' /* missing city + rate */ },
            ],
          },
          reviewer_edits: {},
        },
      ],
    });
    transaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'comp-1' }] }) // first INSERT
          .mockResolvedValueOnce({ rows: [] }), // queue UPDATE
      };
      return cb(client);
    });

    const result = await queue.approveAndCommit('r1', 'user-1');
    expect(result.committed_count).toBe(1);
    expect(result.skipped_count).toBe(1);
    expect(result.comp_ids).toEqual(['comp-1']);
    expect(result.skipped_reasons[0].missing).toEqual(
      expect.arrayContaining(['city', 'rate_per_sqft'])
    );
  });

  test('rolls back when all candidates are rejected (422)', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'r1',
          status: 'pending_review',
          organization_id: 'org-1',
          structured_payload: {
            comps: [{ project_name: 'Bad' /* missing required */ }],
          },
        },
      ],
    });
    transaction.mockImplementationOnce(async (cb) => {
      const client = { query: jest.fn() };
      return cb(client);
    });

    await expect(queue.approveAndCommit('r1', 'u')).rejects.toThrow(/were rejected/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// reject — terminal transition
// ──────────────────────────────────────────────────────────────────────────

describe('reject', () => {
  test('throws when committed', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'committed', organization_id: 'o' }] });
    await expect(queue.reject('r1', 'reason', 'u')).rejects.toThrow(/already committed/);
  });

  test('updates row with reason + reviewer', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending_review', organization_id: 'o' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'rejected', rejection_reason: 'low quality' }] });
    const updated = await queue.reject('r1', 'low quality', 'user-1');
    expect(updated.status).toBe('rejected');
    expect(updated.rejection_reason).toBe('low quality');
  });
});
