jest.mock('../src/config/database', () => ({ query: jest.fn() }));
// Keep replay deterministic + cheap — the chain's core is the signature check;
// replay is a bonus "does it still reproduce" pass.
jest.mock('../src/engines/kernel.service', () => ({
  computeFullFinancials: jest.fn(() => ({
    kpis: { irr_pct: 20 }, costs: {}, revenue: {}, areas: {}, engineVersion: 'kernel-v2',
  })),
}));

const { query } = require('../src/config/database');
const audit = require('../src/services/audit.service');
const { sha256, signEvent } = audit._internal;

// Build a genuinely-signed row exactly the way recordEvent does, so verifyChain
// exercises the real crypto path (not a stub). Uses the dev fallback HMAC key
// consistently for sign + verify under NODE_ENV=test.
const signedRow = ({
  id, inputs, outputs, engineVersion = 'kernel-v2',
  event_type = 'calculate_and_save', created_at = '2026-01-01T00:00:00.000Z',
}) => {
  const inputs_hash = sha256(inputs);
  const outputs_hash = sha256(outputs);
  return {
    id, deal_id: 'd1', actor_id: null, event_type, engine_version: engineVersion, asset_class: null,
    inputs_hash, outputs_hash,
    signature: signEvent({ inputsHash: inputs_hash, outputsHash: outputs_hash, engineVersion }),
    inputs_json: inputs, outputs_json: outputs, created_at,
  };
};

beforeEach(() => jest.clearAllMocks());

describe('audit.verifyChain', () => {
  test('all events verify → all_verified true, with counts, span, and engine versions', async () => {
    const rows = [
      signedRow({ id: 'a', inputs: { x: 1 }, outputs: { irr_pct: 18 }, created_at: '2026-01-01T00:00:00.000Z' }),
      signedRow({ id: 'b', inputs: { x: 2 }, outputs: { irr_pct: 20 }, created_at: '2026-01-05T00:00:00.000Z' }),
    ];
    query.mockResolvedValueOnce({ rows });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    expect(r.total_events).toBe(2);
    expect(r.verified).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.all_verified).toBe(true);
    expect(r.key_available).toBe(true);
    expect(r.engine_versions).toEqual(['kernel-v2']);
    expect(r.first_at).toBe('2026-01-01T00:00:00.000Z');
    expect(r.last_at).toBe('2026-01-05T00:00:00.000Z');
    expect(r.events).toHaveLength(2);
    expect(r.events.every((e) => e.ok)).toBe(true);
  });

  test('TAMPERED outputs_json flips only that event to failed (all_verified false)', async () => {
    const good = signedRow({ id: 'a', inputs: { x: 1 }, outputs: { irr_pct: 18 } });
    // Mutate the stored payload AFTER signing — exactly what a tamper looks like.
    const tampered = { ...signedRow({ id: 'b', inputs: { x: 2 }, outputs: { irr_pct: 20 } }), outputs_json: { irr_pct: 999 } };
    query.mockResolvedValueOnce({ rows: [good, tampered] });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    expect(r.total_events).toBe(2);
    expect(r.verified).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.all_verified).toBe(false);
    const bad = r.events.find((e) => e.id === 'b');
    expect(bad.ok).toBe(false);
    expect(bad.checks.outputsHashMatches).toBe(false);
    // The signature over the (unchanged) stored hashes still checks out — it's
    // the content-hash mismatch that catches the tamper.
    expect(bad.checks.signatureMatches).toBe(true);
  });

  test('empty deal → nothing to verify, all_verified false, no replay, never throws', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = await audit.verifyChain('d1', { replayLatest: true });
    expect(r.total_events).toBe(0);
    expect(r.all_verified).toBe(false);
    expect(r.replay).toBeNull();
  });

  test('replay picks the latest REPLAYABLE event (skips export/graph snapshots)', async () => {
    const rows = [
      signedRow({ id: 'a', inputs: { x: 1 }, outputs: { irr_pct: 18 }, created_at: '2026-01-01T00:00:00.000Z' }),
      signedRow({ id: 'b', inputs: { x: 2 }, outputs: { irr_pct: 20 }, event_type: 'export_snapshot', created_at: '2026-01-05T00:00:00.000Z' }),
    ];
    query.mockResolvedValueOnce({ rows });
    const r = await audit.verifyChain('d1', { replayLatest: true });
    expect(r.replay).not.toBeNull();
    expect(r.replay.attempted).toBe(true);
    expect(r.replay.event_id).toBe('a'); // the calculate_and_save, not the export
  });

  test('loads events chronologically for the deal', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await audit.verifyChain('deal-xyz', { replayLatest: false });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/FROM deal_events/);
    expect(sql).toMatch(/ORDER BY created_at ASC/);
    expect(query.mock.calls[0][1]).toEqual(['deal-xyz']);
  });
});
