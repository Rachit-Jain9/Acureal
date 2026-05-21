'use strict';

/**
 * Tests for compReliance.service — Workstream C1.
 *
 * The database layer and the learning-signal service are mocked; the mock
 * `query` dispatches by inspecting the SQL so a full setReliance() flow
 * (deal check → comp check → insert/delete) can be exercised.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/learningSignals.service', () => ({
  recordCompRelianceSignal: jest.fn(),
}));

const { query } = require('../src/config/database');
const learningSignals = require('../src/services/learningSignals.service');
const compReliance = require('../src/services/compReliance.service');

const undefinedTable = () => {
  const e = new Error('relation "x" does not exist');
  e.code = '42P01';
  return e;
};

// Default happy-path SQL dispatcher: deal + comp exist, writes succeed.
const happyPathDispatcher = (sql) => {
  if (sql.includes('FROM public.deals')) {
    return Promise.resolve({ rows: [{ organization_id: 'org-1' }] });
  }
  if (sql.includes('FROM public.comps')) {
    return Promise.resolve({ rows: [{ ok: 1 }] });
  }
  if (sql.includes('INTO public.deal_comp_reliance')) return Promise.resolve({ rows: [] });
  if (sql.includes('DELETE FROM public.deal_comp_reliance')) return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [] });
};

beforeEach(() => {
  query.mockReset();
  learningSignals.recordCompRelianceSignal.mockReset();
  learningSignals.recordCompRelianceSignal.mockResolvedValue(1);
});

describe('listReliedCompIds', () => {
  it('returns the comp ids the deal relies on', async () => {
    query.mockResolvedValue({ rows: [{ comp_id: 'c1' }, { comp_id: 'c2' }] });
    const ids = await compReliance.listReliedCompIds('deal-1');
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('degrades to an empty list when the table is missing', async () => {
    query.mockRejectedValue(undefinedTable());
    const ids = await compReliance.listReliedCompIds('deal-1');
    expect(ids).toEqual([]);
  });

  it('rethrows a non-migration error', async () => {
    query.mockRejectedValue(new Error('connection reset'));
    await expect(compReliance.listReliedCompIds('deal-1')).rejects.toThrow('connection reset');
  });
});

describe('setReliance — marking a comp relied-on', () => {
  it('inserts the reliance row and emits a learning signal', async () => {
    query.mockImplementation(happyPathDispatcher);

    const result = await compReliance.setReliance({
      dealId: 'deal-1',
      compId: 'comp-9',
      relied: true,
      actorId: 'user-7',
      similarityScore: 0.82,
      similarityRank: 3,
      rateDeltaPct: -4.1,
    });

    expect(result).toEqual({ deal_id: 'deal-1', comp_id: 'comp-9', relied: true });

    const insertCall = query.mock.calls.find((c) => c[0].includes('INTO public.deal_comp_reliance'));
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toMatch(/ON CONFLICT/i);

    expect(learningSignals.recordCompRelianceSignal).toHaveBeenCalledTimes(1);
    expect(learningSignals.recordCompRelianceSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        dealId: 'deal-1',
        compId: 'comp-9',
        relied: true,
        similarityScore: 0.82,
        similarityRank: 3,
        rateDeltaPct: -4.1,
        userId: 'user-7',
      }),
    );
  });

  it('deletes the reliance row when unmarking', async () => {
    query.mockImplementation(happyPathDispatcher);

    const result = await compReliance.setReliance({
      dealId: 'deal-1',
      compId: 'comp-9',
      relied: false,
      actorId: 'user-7',
    });

    expect(result.relied).toBe(false);
    const deleteCall = query.mock.calls.find((c) => c[0].includes('DELETE FROM public.deal_comp_reliance'));
    expect(deleteCall).toBeDefined();
    expect(learningSignals.recordCompRelianceSignal).toHaveBeenCalledWith(
      expect.objectContaining({ relied: false }),
    );
  });
});

describe('setReliance — guards', () => {
  it('throws 404 when the deal is not in the caller org', async () => {
    query.mockImplementation((sql) => {
      if (sql.includes('FROM public.deals')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await expect(
      compReliance.setReliance({ dealId: 'deal-x', compId: 'comp-9', relied: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(learningSignals.recordCompRelianceSignal).not.toHaveBeenCalled();
  });

  it('throws 404 when the comp is not visible to the caller org', async () => {
    query.mockImplementation((sql) => {
      if (sql.includes('FROM public.deals')) {
        return Promise.resolve({ rows: [{ organization_id: 'org-1' }] });
      }
      if (sql.includes('FROM public.comps')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await expect(
      compReliance.setReliance({ dealId: 'deal-1', compId: 'comp-x', relied: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 503 when the reliance table is missing', async () => {
    query.mockImplementation((sql) => {
      if (sql.includes('FROM public.deals')) {
        return Promise.resolve({ rows: [{ organization_id: 'org-1' }] });
      }
      if (sql.includes('FROM public.comps')) return Promise.resolve({ rows: [{ ok: 1 }] });
      if (sql.includes('INTO public.deal_comp_reliance')) return Promise.reject(undefinedTable());
      return Promise.resolve({ rows: [] });
    });

    await expect(
      compReliance.setReliance({ dealId: 'deal-1', compId: 'comp-9', relied: true }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
