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

// ── Computation reference ───────────────────────────────────────────────────
// The quotable id an export / IC memo stamps. Two properties matter and are
// pinned here: it is CONTENT-ADDRESSED (identical computations → identical ref,
// any changed figure → different ref), and it never overclaims what it covers.

describe('audit.formatComputationRef', () => {
  test('formats engine · 12-hex · date', () => {
    expect(audit.formatComputationRef({
      engineVersion: 'kernel-v2',
      outputsHash: 'f393b4a12e54b6d3f24ce608a0e707ec0501e916b74f135c05b113e899b5ace0',
      computedAt: '2026-07-18T07:04:49.144Z',
    })).toBe('kernel-v2 · f393b4a12e54 · 2026-07-18');
  });

  test('returns null without an outputs hash — never invents a reference', () => {
    expect(audit.formatComputationRef({ engineVersion: 'kernel-v2', outputsHash: null, computedAt: '2026-07-18' })).toBeNull();
  });
});

describe('verifyChain.latest_computation', () => {
  test('is content-addressed: identical outputs → identical ref', async () => {
    const mk = (id, created_at) => signedRow({
      id, inputs: { x: 1 }, outputs: { irr_pct: 18 }, created_at,
    });
    query.mockResolvedValueOnce({ rows: [mk('a', '2026-01-01T00:00:00.000Z')] });
    const first = await audit.verifyChain('d1', { replayLatest: false });
    query.mockResolvedValueOnce({ rows: [mk('b', '2026-01-01T00:00:00.000Z')] });
    const second = await audit.verifyChain('d1', { replayLatest: false });

    expect(first.latest_computation.ref).toBe(second.latest_computation.ref);
    expect(first.latest_computation.ref).toMatch(/^kernel-v2 · [0-9a-f]{12} · 2026-01-01$/);
  });

  test('changing an output changes the ref', async () => {
    query.mockResolvedValueOnce({ rows: [signedRow({ id: 'a', inputs: { x: 1 }, outputs: { irr_pct: 18 } })] });
    const a = await audit.verifyChain('d1', { replayLatest: false });
    query.mockResolvedValueOnce({ rows: [signedRow({ id: 'b', inputs: { x: 1 }, outputs: { irr_pct: 19 } })] });
    const b = await audit.verifyChain('d1', { replayLatest: false });

    expect(a.latest_computation.ref).not.toBe(b.latest_computation.ref);
  });

  test('tracks the LATEST computation, not the first', async () => {
    const rows = [
      signedRow({ id: 'old', inputs: { x: 1 }, outputs: { irr_pct: 18 }, created_at: '2026-01-01T00:00:00.000Z' }),
      signedRow({ id: 'new', inputs: { x: 2 }, outputs: { irr_pct: 22 }, created_at: '2026-03-09T00:00:00.000Z' }),
    ];
    query.mockResolvedValueOnce({ rows });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    expect(r.latest_computation.event_id).toBe('new');
    expect(r.latest_computation.ref).toContain('2026-03-09');
  });

  test('is null for a deal that has never been calculated', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    expect(r.latest_computation).toBeNull();
  });

  test('ignores non-computation events when picking the reference', async () => {
    const rows = [
      signedRow({ id: 'calc', inputs: { x: 1 }, outputs: { irr_pct: 18 }, created_at: '2026-01-01T00:00:00.000Z' }),
      signedRow({ id: 'exp', inputs: {}, outputs: {}, event_type: 'export_snapshot', created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    query.mockResolvedValueOnce({ rows });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    // An export is not a computation — it must never become the reference.
    expect(r.latest_computation.event_id).toBe('calc');
  });

  // HONESTY PIN: sensitivity_matrix is written OUTSIDE calculate_and_save, so a
  // tornado on screen can post-date the referenced computation. Copy built on
  // this reference must be able to say so.
  test('flags when the sensitivity run post-dates the referenced computation', async () => {
    const rows = [
      signedRow({ id: 'calc', inputs: { x: 1 }, outputs: { irr_pct: 18 }, created_at: '2026-01-01T00:00:00.000Z' }),
      signedRow({ id: 'sens', inputs: { x: 1 }, outputs: {}, event_type: 'sensitivity_run', created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    query.mockResolvedValueOnce({ rows });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    expect(r.latest_computation.sensitivity_may_be_newer).toBe(true);
  });

  test('does NOT flag when the sensitivity run predates the computation', async () => {
    const rows = [
      signedRow({ id: 'sens', inputs: { x: 1 }, outputs: {}, event_type: 'sensitivity_run', created_at: '2026-01-01T00:00:00.000Z' }),
      signedRow({ id: 'calc', inputs: { x: 1 }, outputs: { irr_pct: 18 }, created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    query.mockResolvedValueOnce({ rows });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    expect(r.latest_computation.sensitivity_may_be_newer).toBe(false);
  });

  test('signed reflects key availability rather than being hardcoded', async () => {
    query.mockResolvedValueOnce({ rows: [signedRow({ id: 'a', inputs: { x: 1 }, outputs: { irr_pct: 18 } })] });
    const r = await audit.verifyChain('d1', { replayLatest: false });
    expect(r.latest_computation.signed).toBe(r.key_available);
  });
});

// ── export_snapshot recording ───────────────────────────────────────────────
// 'export_snapshot' has been an allowed event type with a wired UI label and no
// producer since it was introduced. These pin the two properties that make
// recording it safe on a GET path.

describe('audit.recordExportSnapshot', () => {
  test('records the format and the referenced computation', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] });
    await audit.recordExportSnapshot({
      dealId: 'd1',
      format: 'docx',
      computationRef: {
        ref: 'kernel-v2 · abc123abc123 · 2026-07-18',
        event_id: 'src-evt',
        engine_version: 'kernel-v2',
        outputs_hash: 'abc123abc123',
      },
    });
    const params = query.mock.calls[0][1];
    const flat = JSON.stringify(params);
    expect(flat).toContain('export_snapshot');
    expect(flat).toContain('docx');
    expect(flat).toContain('src-evt');
  });

  test('FAIL-OPEN: a database error never propagates to the caller', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    // An audit write must never be the reason a user cannot download a report.
    await expect(audit.recordExportSnapshot({
      dealId: 'd1', format: 'xlsx', computationRef: null,
    })).resolves.toBeNull();
  });

  test('an export of a never-calculated deal is logged honestly, not skipped', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'evt-2' }] });
    await audit.recordExportSnapshot({ dealId: 'd1', format: 'pptx', computationRef: null });
    // metadata is the last bound param, stored as a JSON string per column.
    const params = query.mock.calls[0][1];
    const metadata = JSON.parse(params[params.length - 1]);
    expect(metadata).toMatchObject({ format: 'pptx', stamped: false });
  });

  test('missing dealId or format is a no-op, not a throw', async () => {
    await expect(audit.recordExportSnapshot({ format: 'docx' })).resolves.toBeNull();
    await expect(audit.recordExportSnapshot({ dealId: 'd1' })).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
