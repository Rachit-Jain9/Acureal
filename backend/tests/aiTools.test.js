jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/services/embeddings.service', () => ({
  searchSimilar: jest.fn(),
}));

const { query } = require('../src/config/database');
const embeddings = require('../src/services/embeddings.service');
const tools = require('../src/services/ai/tools');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aiTools — registry shape', () => {
  test('exports the canonical tool set', () => {
    expect(tools.TOOL_NAMES).toEqual(expect.arrayContaining(['getDeal', 'searchComps', 'searchEvidence']));
  });

  test('listTools returns name + description + permission per tool', () => {
    const list = tools.listTools();
    expect(list.length).toBe(tools.TOOL_NAMES.length);
    expect(list[0]).toHaveProperty('name');
    expect(list[0]).toHaveProperty('description');
    expect(list[0]).toHaveProperty('permission');
  });

  test('listTools filters by permission', () => {
    const reads = tools.listTools({ permission: 'read' });
    expect(reads.length).toBe(3);
    expect(tools.listTools({ permission: 'draft' })).toEqual([]);
  });

  test('getTool returns the registered tool or null', () => {
    expect(tools.getTool('getDeal')?.name).toBe('getDeal');
    expect(tools.getTool('does_not_exist')).toBeNull();
  });
});

describe('aiTools — permission gate', () => {
  test('isPermissionAllowed: read is the floor; everything ≤ requested level', () => {
    expect(tools.isPermissionAllowed('read', 'read')).toBe(true);
    expect(tools.isPermissionAllowed('read', 'compute')).toBe(true);
    expect(tools.isPermissionAllowed('compute', 'read')).toBe(false);
    expect(tools.isPermissionAllowed('draft', 'compute')).toBe(false);
    expect(tools.isPermissionAllowed('approval-required', 'draft')).toBe(false);
  });

  test('invokeTool rejects when tool permission > runner ceiling', async () => {
    // No tools currently above 'read', so simulate by adding one ad-hoc.
    tools.TOOLS.__test_compute__ = {
      name: '__test_compute__',
      description: 'test',
      permission: 'compute',
      inputSchema: tools.TOOLS.getDeal.inputSchema,
      handler: async () => 'ok',
    };
    try {
      await expect(
        tools.invokeTool('__test_compute__', { dealId: '00000000-0000-0000-0000-000000000000' }, { maxPermission: 'read' }),
      ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' });
    } finally {
      delete tools.TOOLS.__test_compute__;
    }
  });
});

describe('aiTools — invokeTool', () => {
  test('unknown tool throws UNKNOWN_TOOL', async () => {
    await expect(tools.invokeTool('nope', {})).rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
  });

  test('zod validation rejects bad input', async () => {
    await expect(tools.invokeTool('getDeal', { dealId: 'not-a-uuid' })).rejects.toBeTruthy();
  });

  test('getDeal: returns the row when query succeeds', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'd-1', name: 'Sarjapur Land', stage: 'underwriting', open_risks: 2 }],
    });
    const out = await tools.invokeTool('getDeal', { dealId: 'a1b2c3d4-e5f6-4789-9abc-def012345678' });
    expect(out.name).toBe('Sarjapur Land');
    expect(out.open_risks).toBe(2);
  });

  test('searchComps: passes city + assetClass filters', async () => {
    query.mockResolvedValueOnce({ rows: [{ project_name: 'X' }] });
    const out = await tools.invokeTool('searchComps', { city: 'Bengaluru', assetClass: 'residential', limit: 5 });
    expect(out).toEqual([{ project_name: 'X' }]);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/asset_class = \$2/);
  });

  test('searchComps: limit clamped to 25 by zod', async () => {
    await expect(
      tools.invokeTool('searchComps', { city: 'Bengaluru', limit: 9999 }),
    ).rejects.toBeTruthy();
  });

  test('searchEvidence: forwards to embeddings.searchSimilar', async () => {
    embeddings.searchSimilar.mockResolvedValueOnce([{ id: 'r-1', similarity: 0.9 }]);
    const out = await tools.invokeTool('searchEvidence', { query: 'encumbrance clause', k: 5 });
    expect(out).toEqual([{ id: 'r-1', similarity: 0.9 }]);
    expect(embeddings.searchSimilar).toHaveBeenCalledWith({
      query: 'encumbrance clause',
      k: 5,
      documentId: null,
    });
  });
});
