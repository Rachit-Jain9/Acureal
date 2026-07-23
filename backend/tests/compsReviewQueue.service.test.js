'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../src/services/extraction.service', () => ({
  extractStoredFileFields: jest.fn(),
}));
jest.mock('../src/config/storage', () => ({
  uploadFile: jest.fn(),
  fetchStoredFile: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const extraction = require('../src/services/extraction.service');
const { uploadFile, fetchStoredFile } = require('../src/config/storage');
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

// ──────────────────────────────────────────────────────────────────────────
// manualUpload — analyst-driven path (no email needed)
// ──────────────────────────────────────────────────────────────────────────

describe('manualUpload', () => {
  const ORG = '00000000-0000-0000-0000-000000000abc';
  const USER = '00000000-0000-0000-0000-000000000def';

  test('rejects empty buffer', async () => {
    await expect(
      queue.manualUpload({
        buffer: Buffer.alloc(0),
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        organizationId: ORG,
        userId: USER,
      })
    ).rejects.toThrow(/empty/);
  });

  test('rejects missing organizationId', async () => {
    await expect(
      queue.manualUpload({
        buffer: Buffer.from('x'),
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        userId: USER,
      })
    ).rejects.toThrow(/Organization context/);
  });

  test('rejects disallowed MIME type', async () => {
    await expect(
      queue.manualUpload({
        buffer: Buffer.from('x'),
        fileName: 'evil.exe',
        mimeType: 'application/x-msdownload',
        organizationId: ORG,
        userId: USER,
      })
    ).rejects.toThrow(/Unsupported file type/);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('happy path: uploads, inserts row, returns deduplicated=false', async () => {
    uploadFile.mockResolvedValueOnce({ url: 'https://blob/path.pdf', isBlob: true });
    query.mockResolvedValueOnce({
      rows: [{ id: 'q-new', status: 'pending_extraction' }],
    });

    const buffer = Buffer.from('hello-pdf-bytes');
    const result = await queue.manualUpload({
      buffer,
      fileName: 'JLL-Q1.pdf',
      mimeType: 'application/pdf',
      organizationId: ORG,
      userId: USER,
      metadata: { sender: 'analyst@jll.com', subject: 'Q1 office' },
    });

    expect(result.deduplicated).toBe(false);
    expect(result.row.id).toBe('q-new');

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [bufArg, nameArg, mimeArg, , orgArg] = uploadFile.mock.calls[0];
    expect(bufArg).toBe(buffer);
    expect(nameArg).toBe('JLL-Q1.pdf');
    expect(mimeArg).toBe('application/pdf');
    expect(orgArg).toBe(ORG);

    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0];
    expect(params[0]).toBe(ORG);
    const sourceMeta = JSON.parse(params[1]);
    expect(sourceMeta.uploaded_by_user_id).toBe(USER);
    expect(sourceMeta.attachment_name).toBe('JLL-Q1.pdf');
    expect(sourceMeta.sender).toBe('analyst@jll.com');
    expect(sourceMeta.subject).toBe('Q1 office');
    expect(params[2]).toBe('https://blob/path.pdf');
    expect(params[3]).toBe('application/pdf');
    expect(params[4]).toBe(buffer.length);
    expect(params[5]).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });

  test('treats 23505 as dedupe and surfaces existing row', async () => {
    uploadFile.mockResolvedValueOnce({ url: 'https://blob/path.pdf', isBlob: true });
    const dupErr = Object.assign(new Error('duplicate'), { code: '23505' });
    query
      .mockRejectedValueOnce(dupErr) // INSERT throws 23505
      .mockResolvedValueOnce({ rows: [{ id: 'q-existing', status: 'pending_review' }] }); // lookup

    const result = await queue.manualUpload({
      buffer: Buffer.from('dup-bytes'),
      fileName: 'r.pdf',
      mimeType: 'application/pdf',
      organizationId: ORG,
      userId: USER,
    });

    expect(result.deduplicated).toBe(true);
    expect(result.row.id).toBe('q-existing');
  });

  test('storage failure surfaces clearly without inserting a row', async () => {
    uploadFile.mockRejectedValueOnce(new Error('S3 down'));

    await expect(
      queue.manualUpload({
        buffer: Buffer.from('x'),
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        organizationId: ORG,
        userId: USER,
      })
    ).rejects.toThrow(/Storage upload failed/);
    expect(query).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// bulkApprove / bulkReject — multi-row aggregation
// ──────────────────────────────────────────────────────────────────────────

describe('bulkApprove', () => {
  test('rejects empty array with 400', async () => {
    await expect(queue.bulkApprove([], 'u')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects non-array with 400', async () => {
    await expect(queue.bulkApprove('not-an-array', 'u')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('caps at 50 ids per request', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    await expect(queue.bulkApprove(ids, 'u')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('de-duplicates ids', async () => {
    // Two duplicate ids → only one approveAndCommit call.
    query
      .mockResolvedValueOnce({ rows: [] }); // getQueueRow returns nothing → 404 path
    const result = await queue.bulkApprove(['id-1', 'id-1'], 'u');
    expect(result.requested).toBe(1);
  });

  test('aggregates per-id successes and failures into one response', async () => {
    // First id: getQueueRow returns pending_review → transaction succeeds.
    // Second id: getQueueRow returns committed → throws (409).
    query
      .mockResolvedValueOnce({ rows: [{
        id: 'good',
        status: 'pending_review',
        organization_id: 'org',
        structured_payload: {
          comps: [{ project_name: 'Comp A', city: 'Bengaluru', rate_per_sqft: 8500 }],
        },
        reviewer_edits: {},
      }] })
      // bad row in 'committed' state
      .mockResolvedValueOnce({ rows: [{
        id: 'bad',
        status: 'committed',
        organization_id: 'org',
      }] });
    transaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'comp-1' }] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return cb(client);
    });

    const result = await queue.bulkApprove(['good', 'bad'], 'user-1');
    expect(result.requested).toBe(2);
    expect(result.succeeded_count).toBe(1);
    expect(result.failed_count).toBe(1);
    expect(result.succeeded[0]).toMatchObject({ id: 'good', committed_count: 1 });
    expect(result.failed[0]).toMatchObject({ id: 'bad' });
    expect(result.failed[0].error).toMatch(/Cannot approve/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// listQueue — assignedToMe filter + assignee hydration
// ──────────────────────────────────────────────────────────────────────────

describe('listQueue assignedToMe filter', () => {
  test('does NOT add assigned_to filter when assignedToMe=false', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // count
      .mockResolvedValueOnce({ rows: [] });              // rows
    await queue.listQueue({ status: 'pending_review', assignedToMe: false, currentUserId: 'u-1' });
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).not.toMatch(/assigned_to = /);
  });

  test('adds assigned_to predicate when assignedToMe=true and userId is supplied', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    await queue.listQueue({ status: 'pending_review', assignedToMe: true, currentUserId: 'u-99' });
    const countSql = query.mock.calls[0][0];
    const countParams = query.mock.calls[0][1];
    expect(countSql).toMatch(/assigned_to = /);
    expect(countParams).toContain('u-99');
  });

  test('ignores assignedToMe when no currentUserId is supplied', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    await queue.listQueue({ assignedToMe: true });
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).not.toMatch(/assigned_to = /);
  });

  test('hydrates assignee {id,name,email} on rows that have assigned_to', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r-1', status: 'pending_review', assigned_to: 'u-1' }] })
      // bulk users lookup
      .mockResolvedValueOnce({ rows: [{ id: 'u-1', name: 'Rachit', email: 'r@x.io' }] });
    const result = await queue.listQueue({});
    expect(result.data[0].assignee).toEqual({ id: 'u-1', name: 'Rachit', email: 'r@x.io' });
  });

  test('falls back to legacy projection when assignment columns are missing (migration not applied)', async () => {
    // First SELECT throws 42703 (undefined_column); legacy retry path runs.
    query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // count
      .mockRejectedValueOnce(Object.assign(new Error('column "assigned_to" does not exist'), { code: '42703' }))
      // legacy fallback path: count again, then legacy SELECT
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r-1', status: 'pending_review' }, { id: 'r-2', status: 'pending_review' }] });

    const result = await queue.listQueue({});
    expect(result.pagination.total).toBe(2);
    expect(result.data).toHaveLength(2);
    // Assignee field absent on legacy projection.
    expect(result.data[0]).not.toHaveProperty('assignee');
  });
});

describe('bulkReassign', () => {
  test('rejects empty array with 400', async () => {
    await expect(queue.bulkReassign([], 'user-1', 'actor-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('caps at 50 ids per request', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    await expect(queue.bulkReassign(ids, 'user-1', 'actor-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects with 400 when target user is not in the org', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // target user lookup miss
    await expect(
      queue.bulkReassign(['r-1'], 'phantom-user', 'actor-1'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('happy path: UPDATE returns succeeded rows; missing ids land in failed[]', async () => {
    // First call: target user lookup → exists.
    // Second call: UPDATE returns one row (r-1) of two requested.
    query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', name: 'Rachit', email: 'r@x.io' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r-1', status: 'pending_review', assigned_to: 'user-1' }] });

    const result = await queue.bulkReassign(['r-1', 'r-2'], 'user-1', 'actor-1');
    expect(result.requested).toBe(2);
    expect(result.succeeded_count).toBe(1);
    expect(result.failed_count).toBe(1);
    expect(result.target_user_id).toBe('user-1');
    expect(result.succeeded[0]).toMatchObject({ id: 'r-1', assigned_to: 'user-1' });
    expect(result.failed[0]).toMatchObject({ id: 'r-2' });
  });

  test('null target = unassign; skips the user lookup round-trip', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'r-1', status: 'pending_review', assigned_to: null }],
    });
    const result = await queue.bulkReassign(['r-1'], null, 'actor-1');
    expect(result.target_user_id).toBeNull();
    expect(result.succeeded_count).toBe(1);
    // Only one query — the user-lookup was skipped because target is null.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('surfaces 503 with operator instructions when assignment column is missing', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }); // user lookup ok
    const err = Object.assign(new Error('column "assigned_to" does not exist'), { code: '42703' });
    query.mockRejectedValueOnce(err); // UPDATE fails

    await expect(
      queue.bulkReassign(['r-1'], 'user-1', 'actor-1'),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'queue_assignment_column_missing',
      message: expect.stringMatching(/comps_review_queue assignment migration/i),
    });
  });
});

describe('bulkReject', () => {
  test('rejects empty array with 400', async () => {
    await expect(queue.bulkReject([], 'reason', 'u')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects ids one by one and aggregates results', async () => {
    // First id: pending_review → reject UPDATE returns row.
    // Second id: committed → throws.
    query
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending_review', organization_id: 'org' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'rejected' }] }) // UPDATE result
      .mockResolvedValueOnce({ rows: [{ id: 'r2', status: 'committed', organization_id: 'org' }] });

    const result = await queue.bulkReject(['r1', 'r2'], 'duplicate batch', 'user-1');
    expect(result.succeeded_count).toBe(1);
    expect(result.failed_count).toBe(1);
    expect(result.succeeded[0]).toMatchObject({ id: 'r1', status: 'rejected' });
    expect(result.failed[0].error).toMatch(/already committed/);
  });

  test('treats null reason as no-reason (passes null through to single-row reject)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'pending_review', organization_id: 'org' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'rejected' }] });

    const result = await queue.bulkReject(['r1'], null, 'user-1');
    expect(result.succeeded_count).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// streamRawDoc — guarded source-document proxy (nosniff + attachment, SSRF)
//
// Regression for the 2026-05-30 red-team finding: the reviewer UI embedded
// the raw Vercel Blob URL inline (<iframe>/<img>), bypassing the
// "served as attachment, never inline" guarantee. The bytes must now flow
// through fetchStoredFile (the storage-host SSRF allow-list) and be served
// with X-Content-Type-Options: nosniff + Content-Disposition: attachment.
// ──────────────────────────────────────────────────────────────────────────

describe('streamRawDoc', () => {
  const makeRes = () => ({ setHeader: jest.fn(), destroy: jest.fn() });
  const makeStream = () => ({ on: jest.fn(), pipe: jest.fn() });

  test('throws 404 when the queue row is missing', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(queue.streamRawDoc('missing', makeRes())).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchStoredFile).not.toHaveBeenCalled();
  });

  test('throws 404 when the row has no attachment (body-only ingest)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'r1', organization_id: 'o', raw_doc_url: null }],
    });
    await expect(queue.streamRawDoc('r1', makeRes())).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchStoredFile).not.toHaveBeenCalled();
  });

  test('streams as a nosniff attachment (never inline) and pipes the body', async () => {
    const blobUrl = 'https://abc.public.blob.vercel-storage.com/comps-queue/x.pdf';
    query.mockResolvedValueOnce({
      rows: [{
        id: 'r1',
        organization_id: 'o',
        raw_doc_url: blobUrl,
        raw_doc_mime: 'application/pdf',
        source_meta: { attachment_name: 'JLL Q1.pdf' },
      }],
    });
    const stream = makeStream();
    fetchStoredFile.mockResolvedValueOnce({
      stream,
      contentType: 'application/pdf',
      contentLength: '4096',
      etag: 'W/"abc"',
    });
    const res = makeRes();

    await queue.streamRawDoc('r1', res);

    // Bytes fetched only through the SSRF-guarded helper, never the raw URL.
    expect(fetchStoredFile).toHaveBeenCalledWith(blobUrl, 3600);

    const headers = Object.fromEntries(res.setHeader.mock.calls);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toMatch(/^attachment;/);
    // Filename sanitized (spaces → underscore) before it lands in the header.
    expect(headers['Content-Disposition']).toContain('JLL_Q1.pdf');
    expect(headers['Content-Length']).toBe('4096');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  test('surfaces a 500 (not the storage internals) when fetchStoredFile refuses a non-storage URL', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'r1',
        organization_id: 'o',
        raw_doc_url: 'https://attacker.example/evil.pdf',
        raw_doc_mime: 'application/pdf',
        source_meta: {},
      }],
    });
    // The SSRF allow-list in fetchStoredFile throws for non-storage URLs.
    fetchStoredFile.mockRejectedValueOnce(new Error('Refusing to fetch a non-storage URL.'));
    const res = makeRes();

    await expect(queue.streamRawDoc('r1', res)).rejects.toMatchObject({ statusCode: 500 });
    // Failed before any header/stream — nothing leaked to the response.
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Drain reclaim — orphaned 'extracting' rows
// ──────────────────────────────────────────────────────────────────────────

describe('drain reclaims rows orphaned mid-extraction', () => {
  // processQueueRow flips a row to 'extracting' before calling the extractor.
  // If the serverless instance dies in that window the row was previously
  // stranded forever: the drain selected only 'pending_extraction', and no
  // reaper existed for this table. A stale-'extracting' row must be re-picked.
  test('processPendingBatch also selects stale extracting rows', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await queue.processPendingBatch({ limit: 5 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/status = 'pending_extraction'/);
    expect(sql).toMatch(/status = 'extracting'/);
    expect(sql).toMatch(/updated_at < NOW\(\)/);
    // Staleness window rides as a bound parameter, never interpolated.
    expect(params).toContain('15');
  });

  test('the org picker also sees orgs whose only rows are stale extracting', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await queue.processPendingBatchAcrossOrgs({ limitPerOrg: 5 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/status = 'pending_extraction'/);
    expect(sql).toMatch(/status = 'extracting'/);
    expect(params).toContain('15');
  });

  test('a FRESH extracting row is not reclaimed (no racing a live run)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await queue.processPendingBatch({ limit: 5 });

    const [sql] = query.mock.calls[0];
    // The reclaim must be time-bounded, never a bare status match that would
    // pick up a row an active invocation is still working on.
    expect(sql).not.toMatch(/OR\s+status = 'extracting'\s*\)/);
    expect(sql).toMatch(/status = 'extracting' AND updated_at </);
  });
});
