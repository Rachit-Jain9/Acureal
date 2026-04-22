/**
 * Audit service — unit suite.
 *
 * What is locked here:
 *   - stableStringify produces identical output regardless of key order.
 *   - sha256 of semantically-equal inputs is identical.
 *   - signEvent is deterministic for a given (inputs, outputs, engine, key)
 *     tuple, and changes if ANY of those change.
 *   - recordEvent inserts one row with the correct hashes + signature.
 *   - verifyEvent passes for a freshly-recorded event and fails cleanly when
 *     any signed field is tampered with.
 *   - replayEvent re-runs the kernel and confirms output-hash equality for a
 *     real residential deal; replay ≠ verify (either can pass while the
 *     other fails under key rotation / tamper scenarios).
 *
 * Run: `cd backend && npm test -- audit.service`
 */

'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');

// Stable HMAC key for deterministic signature assertions below.
process.env.DEAL_EVENTS_HMAC_KEY = 'audit-test-key-0123456789abcdef';

const auditService = require('../src/services/audit.service');
const {
  stableStringify,
  sha256,
  hashInputs,
  hashOutputs,
  signEvent,
} = auditService._internal;

// ── Stable stringify ─────────────────────────────────────────────────────────

describe('stableStringify', () => {
  test('key order does not matter', () => {
    const a = { a: 1, b: 2, c: { d: 3, e: 4 } };
    const b = { c: { e: 4, d: 3 }, b: 2, a: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  test('array order does matter', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  test('undefined is dropped like JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  test('NaN / Infinity become null', () => {
    expect(stableStringify({ a: NaN })).toBe('{"a":null}');
    expect(stableStringify({ a: Infinity })).toBe('{"a":null}');
  });

  test('throws on circular ref', () => {
    const o = {};
    o.self = o;
    expect(() => stableStringify(o)).toThrow(/circular/i);
  });
});

// ── Hashing ──────────────────────────────────────────────────────────────────

describe('sha256 / hashInputs / hashOutputs', () => {
  test('hash is stable across key order', () => {
    const a = { irr: 0.185, npv: 128.46, areas: { gross: 125000, saleable: 100000 } };
    const b = { areas: { saleable: 100000, gross: 125000 }, npv: 128.46, irr: 0.185 };
    expect(hashOutputs(a)).toBe(hashOutputs(b));
  });

  test('hash flips on value change', () => {
    const a = { irr: 0.185 };
    const b = { irr: 0.186 };
    expect(hashOutputs(a)).not.toBe(hashOutputs(b));
  });

  test('sha256 output is 64 hex chars', () => {
    const hex = sha256('hello');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── HMAC signature ───────────────────────────────────────────────────────────

describe('signEvent', () => {
  const baseArgs = {
    inputsHash: 'a'.repeat(64),
    outputsHash: 'b'.repeat(64),
    engineVersion: 'kernel-v2',
  };

  test('is deterministic for the same tuple', () => {
    expect(signEvent(baseArgs)).toBe(signEvent(baseArgs));
  });

  test('changes when inputs hash changes', () => {
    const other = { ...baseArgs, inputsHash: 'c'.repeat(64) };
    expect(signEvent(other)).not.toBe(signEvent(baseArgs));
  });

  test('changes when outputs hash changes', () => {
    const other = { ...baseArgs, outputsHash: 'c'.repeat(64) };
    expect(signEvent(other)).not.toBe(signEvent(baseArgs));
  });

  test('changes when engine version changes', () => {
    const other = { ...baseArgs, engineVersion: 'kernel-v3' };
    expect(signEvent(other)).not.toBe(signEvent(baseArgs));
  });

  test('signature is 64 hex chars', () => {
    expect(signEvent(baseArgs)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── recordEvent: DB interaction ──────────────────────────────────────────────

describe('recordEvent', () => {
  beforeEach(() => {
    query.mockReset();
  });

  test('inserts a single row with correct hashes + signature', async () => {
    const dealId = '11111111-1111-1111-1111-111111111111';
    const inputs = { plotAreaSqft: 50000, fsi: 2.5, landCostCr: 30 };
    const outputs = { kpis: { irr: 0.185, npv: 128.46 }, engineVersion: 'kernel-v2' };

    query.mockResolvedValueOnce({
      rows: [{
        id: 'evt-1',
        deal_id: dealId,
        organization_id: 'org-1',
        actor_id: 'user-1',
        event_type: 'calculate_and_save',
        engine_version: 'kernel-v2',
        asset_class: 'residential_apartments',
        inputs_hash: hashInputs(inputs),
        outputs_hash: hashOutputs(outputs),
        signature: signEvent({
          inputsHash: hashInputs(inputs),
          outputsHash: hashOutputs(outputs),
          engineVersion: 'kernel-v2',
        }),
        metadata: {},
        created_at: new Date(),
      }],
    });

    const row = await auditService.recordEvent({
      dealId,
      eventType: 'calculate_and_save',
      engineVersion: 'kernel-v2',
      assetClass: 'residential_apartments',
      inputs,
      outputs,
      actorId: 'user-1',
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO deal_events/);
    expect(params[0]).toBe(dealId);                 // deal_id
    expect(params[1]).toBe('user-1');               // actor_id
    expect(params[2]).toBe('calculate_and_save');   // event_type
    expect(params[3]).toBe('kernel-v2');            // engine_version
    expect(params[4]).toBe('residential_apartments'); // asset_class
    expect(params[5]).toMatch(/^[0-9a-f]{64}$/);    // inputs_hash
    expect(params[6]).toMatch(/^[0-9a-f]{64}$/);    // outputs_hash
    expect(params[7]).toMatch(/^[0-9a-f]{64}$/);    // signature
    expect(row.id).toBe('evt-1');
  });

  test('rejects unsupported event type', async () => {
    await expect(auditService.recordEvent({
      dealId: 'x',
      eventType: 'nope',
      engineVersion: 'kernel-v2',
      inputs: {},
      outputs: {},
    })).rejects.toThrow(/unsupported eventType/);
  });

  test('rejects missing dealId', async () => {
    await expect(auditService.recordEvent({
      eventType: 'calculate_and_save',
      engineVersion: 'kernel-v2',
      inputs: {},
      outputs: {},
    })).rejects.toThrow(/dealId/);
  });

  test('rejects non-object inputs', async () => {
    await expect(auditService.recordEvent({
      dealId: 'x',
      eventType: 'calculate_and_save',
      engineVersion: 'kernel-v2',
      inputs: 'not-an-object',
      outputs: {},
    })).rejects.toThrow(/inputs must be an object/);
  });
});

// ── verifyEvent ──────────────────────────────────────────────────────────────

describe('verifyEvent', () => {
  const buildFreshEvent = () => {
    const inputs = { plotAreaSqft: 50000, fsi: 2.5 };
    const outputs = { kpis: { irr: 0.185 } };
    const inputs_hash = hashInputs(inputs);
    const outputs_hash = hashOutputs(outputs);
    return {
      inputs_json: inputs,
      outputs_json: outputs,
      inputs_hash,
      outputs_hash,
      engine_version: 'kernel-v2',
      signature: signEvent({ inputsHash: inputs_hash, outputsHash: outputs_hash, engineVersion: 'kernel-v2' }),
    };
  };

  test('passes for a fresh, untampered event', () => {
    const event = buildFreshEvent();
    const result = auditService.verifyEvent(event);
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual({
      inputsHashMatches: true,
      outputsHashMatches: true,
      signatureMatches: true,
    });
  });

  test('fails cleanly when inputs_json is tampered', () => {
    const event = buildFreshEvent();
    event.inputs_json = { ...event.inputs_json, plotAreaSqft: 99999 };
    const result = auditService.verifyEvent(event);
    expect(result.ok).toBe(false);
    expect(result.checks.inputsHashMatches).toBe(false);
    // hashes disagree → signature can still be valid-against-old-hashes
    expect(result.checks.signatureMatches).toBe(true);
  });

  test('fails when outputs_json is tampered', () => {
    const event = buildFreshEvent();
    event.outputs_json = { kpis: { irr: 999 } };
    const result = auditService.verifyEvent(event);
    expect(result.ok).toBe(false);
    expect(result.checks.outputsHashMatches).toBe(false);
  });

  test('fails when stored signature is tampered', () => {
    const event = buildFreshEvent();
    event.signature = '0'.repeat(64);
    const result = auditService.verifyEvent(event);
    expect(result.ok).toBe(false);
    expect(result.checks.signatureMatches).toBe(false);
  });

  test('fails when engine_version is tampered', () => {
    const event = buildFreshEvent();
    event.engine_version = 'kernel-v3';
    const result = auditService.verifyEvent(event);
    expect(result.ok).toBe(false);
    expect(result.checks.signatureMatches).toBe(false);
  });
});

// ── replayEvent: end-to-end kernel round-trip ────────────────────────────────

describe('replayEvent', () => {
  test('replay of a residential calc produces an identical output hash', () => {
    // eslint-disable-next-line global-require
    const { computeFullFinancials } = require('../src/engines/kernel.service');

    const inputs = {
      assetClass: 'residential_apartments',
      plotAreaSqft: 50_000,
      fsi: 2.5,
      loadingFactor: 0.15,
      constructionCostPerSqft: 3_500,
      sellingRatePerSqft: 9_500,
      landCostCr: 30,
      projectDurationMonths: 36,
      discountRatePct: 14,
      developerMarginPct: 20,
      contingencyPct: 5,
      architectFeePct: 2,
      pmcFeePct: 1.5,
      marketingCostPct: 4,
      approvalCostCr: 2,
      debtLTV: 0,
      skipSensitivity: true,
      skipGraph: true,
    };
    const computed = computeFullFinancials(inputs);
    const outputs = auditService.flattenOutputsForAudit(computed);
    const inputsHash = hashInputs(inputs);
    const outputsHash = hashOutputs(outputs);

    const event = {
      inputs_json: inputs,
      outputs_json: outputs,
      inputs_hash: inputsHash,
      outputs_hash: outputsHash,
      engine_version: computed.engineVersion || 'kernel-v2',
      signature: signEvent({
        inputsHash,
        outputsHash,
        engineVersion: computed.engineVersion || 'kernel-v2',
      }),
    };

    const verify = auditService.verifyEvent(event);
    expect(verify.ok).toBe(true);

    const replay = auditService.replayEvent(event);
    expect(replay.ok).toBe(true);
    expect(replay.replayOutputsHash).toBe(replay.originalOutputsHash);
  });
});
