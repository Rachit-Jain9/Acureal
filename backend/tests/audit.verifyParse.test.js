const audit = require('../src/services/audit.service');

// Regression guard: verifyEvent / replayEvent must honor their documented
// "never throws on verify failure" contract even when the stored audit JSON is
// itself damaged (interrupted write, DB corruption, a manual edit). Previously
// an unguarded JSON.parse bubbled a SyntaxError as an opaque 500 from the
// audit-verify endpoint — the one place that exists to prove tamper-evidence.
describe('audit verify/replay — corrupt stored JSON (no-throw contract)', () => {
  test('verifyEvent returns a clean failure (no throw) on unparseable inputs_json', () => {
    const event = {
      inputs_json: '{not valid json',
      outputs_json: '{}',
      inputs_hash: 'x', outputs_hash: 'y', signature: 'z', engine_version: 'kernel-v2',
    };
    let result;
    expect(() => { result = audit.verifyEvent(event); }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.checks.inputsHashMatches).toBe(false);
    expect(result.error).toMatch(/unparseable/i);
  });

  test('verifyEvent returns a clean failure on unparseable outputs_json', () => {
    const event = {
      inputs_json: '{}',
      outputs_json: 'not json at all',
      inputs_hash: 'x', outputs_hash: 'y', signature: 'z', engine_version: 'kernel-v2',
    };
    let result;
    expect(() => { result = audit.verifyEvent(event); }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unparseable/i);
  });

  test('replayEvent returns a clean failure (no throw) on unparseable inputs_json', () => {
    const event = { inputs_json: '<<corrupt>>', outputs_json: '{}', outputs_hash: 'y' };
    let result;
    expect(() => { result = audit.replayEvent(event); }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unparseable_payload');
  });

  test('verifyEvent passes an already-parsed object through without throwing', () => {
    const event = {
      inputs_json: { a: 1 },
      outputs_json: { b: 2 },
      inputs_hash: 'mismatch', outputs_hash: 'mismatch', signature: 'bad', engine_version: 'kernel-v2',
    };
    let result;
    expect(() => { result = audit.verifyEvent(event); }).not.toThrow();
    // Hashes won't match the bogus stored values, but this is NOT the parse-error
    // path — it computed real hashes and compared them.
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(false);
  });
});
