'use strict';

/**
 * Unit tests for evidenceLinks.service.listDependents (E2-PR1).
 *
 * Covers the reverse-traversal pure logic: input validation, column-mapping
 * per source kind, grouping output, and the comp special-case (returns
 * empty + note since comps aren't directly indexed in evidence_links).
 *
 * SQL behaviour itself is exercised through the route integration tests in
 * a follow-up; the focus here is the service's contract.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const svc = require('../src/services/evidenceLinks.service');

beforeEach(() => jest.clearAllMocks());

describe('listDependents — input validation', () => {
  test('throws 400 for unsupported source kind', async () => {
    await expect(svc.listDependents('risk_flag', 'some-uuid'))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Unsupported source kind/) });
  });

  test('throws 400 when sourceId is missing', async () => {
    await expect(svc.listDependents('document', null))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.listDependents('document', ''))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.listDependents('document', undefined))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('listDependents — comp special case', () => {
  test('returns empty + supported=false + note for comp source kind without querying', async () => {
    const out = await svc.listDependents('comp', 'comp-uuid-1');
    expect(query).not.toHaveBeenCalled();
    expect(out).toEqual({
      owners: [],
      grouped: {},
      supported: false,
      note: expect.stringMatching(/comp_reliance/i),
    });
  });
});

describe('listDependents — document source', () => {
  test('passes through to SQL with document_id filter and returns shaped owners', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          link_id: 'link-1', owner_kind: 'dd_item', owner_id: 'dd-1',
          owner_label: 'Title chain verified', deal_id: 'deal-a', deal_name: 'Whitefield Heights',
          confidence_score: 0.92, verified_at: '2026-05-20T00:00:00Z', link_created_at: '2026-05-20T00:00:00Z',
        },
        {
          link_id: 'link-2', owner_kind: 'approval', owner_id: 'ap-1',
          owner_label: 'BBMP plan sanction', deal_id: 'deal-a', deal_name: 'Whitefield Heights',
          confidence_score: 0.85, verified_at: null, link_created_at: '2026-05-21T00:00:00Z',
        },
        {
          link_id: 'link-3', owner_kind: 'dd_item', owner_id: 'dd-2',
          owner_label: 'EC verified', deal_id: 'deal-b', deal_name: 'Jakkur',
          confidence_score: null, verified_at: null, link_created_at: '2026-05-19T00:00:00Z',
        },
      ],
    });
    const out = await svc.listDependents('document', 'doc-uuid-99');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/el\.document_id = \$1/);
    expect(sql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(params).toEqual(['doc-uuid-99']);

    expect(out.supported).toBe(true);
    expect(out.note).toBeNull();
    expect(out.owners).toHaveLength(3);
    expect(out.owners[0]).toMatchObject({
      link_id: 'link-1', owner_kind: 'dd_item', owner_label: 'Title chain verified', confidence_score: 0.92,
    });
    expect(out.owners[2].confidence_score).toBeNull();
    expect(out.grouped).toEqual({ dd_item: 2, approval: 1 });
  });

  test('coerces confidence_score from string to number', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        link_id: 'l', owner_kind: 'dd_item', owner_id: 'o', owner_label: 'x', deal_id: 'd', deal_name: 'D',
        confidence_score: '0.77', verified_at: null, link_created_at: null,
      }],
    });
    const out = await svc.listDependents('document', 'doc-1');
    expect(out.owners[0].confidence_score).toBe(0.77);
  });

  test('empty result returns empty owners + empty grouped + supported=true', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await svc.listDependents('document', 'doc-orphan');
    expect(out).toEqual({ owners: [], grouped: {}, supported: true, note: null });
  });
});

describe('listDependents — evidence_source / evidence_fact source kinds', () => {
  test('evidence_source source kind targets evidence_source_id column', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listDependents('evidence_source', 'src-uuid-1');
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/el\.evidence_source_id = \$1/);
  });

  test('evidence_fact source kind targets evidence_fact_id column', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listDependents('evidence_fact', 'fact-uuid-1');
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/el\.evidence_fact_id = \$1/);
  });
});
