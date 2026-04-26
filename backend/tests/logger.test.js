'use strict';

/**
 * Unit tests for the lightweight structured logger.
 *
 * The logger lives at src/lib/logger.js. We previously had a recursion bug
 * where `module.exports.child = (bindings) => rootLogger.child(bindings)`
 * accidentally shadowed the real method and looped. These tests pin that
 * regression and verify request-context correlation works end-to-end.
 */

const path = require('path');

describe('lib/logger', () => {
  let logger;
  let runWithRequestContext;
  let originalLog;
  let originalError;
  let captured;

  beforeEach(() => {
    // Force pretty=off and a deterministic level so output shape is stable.
    process.env.LOG_FORMAT = 'json';
    process.env.LOG_LEVEL = 'trace';
    // Reset modules so a fresh logger picks up the env changes.
    jest.resetModules();
    logger = require('../src/lib/logger');
    // Re-require requestContext from the SAME module graph as the logger.
    // Otherwise AsyncLocalStorage instances diverge and request_id won't
    // propagate from `runWithRequestContext` into the logger's reads.
    ({ runWithRequestContext } = require('../src/lib/requestContext'));

    captured = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (...args) => captured.push({ stream: 'log', args });
    console.error = (...args) => captured.push({ stream: 'error', args });
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    delete process.env.LOG_FORMAT;
    delete process.env.LOG_LEVEL;
  });

  test('child() returns a logger that does not recurse', () => {
    // The original bug: calling child() on the exported singleton looped
    // forever, exhausting the call stack before printing anything.
    const child = logger.child({ module: 'test' });
    expect(typeof child.info).toBe('function');
    expect(() => child.info('hello world')).not.toThrow();

    // And nested children also work without recursion.
    const grandchild = child.child({ sub: 'a' });
    expect(() => grandchild.info('nested')).not.toThrow();
  });

  test('writes JSON in json format with module + msg', () => {
    const child = logger.child({ module: 'parcel' });
    child.info('refresh_done', { property_id: 'p1' });

    expect(captured).toHaveLength(1);
    const line = JSON.parse(captured[0].args[0]);
    expect(line.level).toBe('info');
    expect(line.module).toBe('parcel');
    expect(line.msg).toBe('refresh_done');
    expect(line.ctx.property_id).toBe('p1');
  });

  test('error() handles Error objects without losing the stack', () => {
    const err = new Error('kaboom');
    err.code = 'EBOOM';
    logger.error('failed', err, { hint: 'retry' });

    expect(captured).toHaveLength(1);
    const line = JSON.parse(captured[0].args[0]);
    expect(line.level).toBe('error');
    expect(line.ctx.error.message).toBe('kaboom');
    expect(line.ctx.error.code).toBe('EBOOM');
    expect(line.ctx.error.stack).toContain('kaboom');
    expect(line.ctx.hint).toBe('retry');
  });

  test('automatically includes request_id from AsyncLocalStorage', (done) => {
    runWithRequestContext({ requestId: 'req-123', userId: 'u-1' }, () => {
      logger.info('hello');
      const line = JSON.parse(captured[0].args[0]);
      expect(line.request_id).toBe('req-123');
      expect(line.user_id).toBe('u-1');
      done();
    });
  });

  test('respects LOG_LEVEL gating', () => {
    // Use jest.isolateModules so the env mutation only affects this require.
    process.env.LOG_LEVEL = 'warn';
    jest.isolateModules(() => {
      const gated = require('../src/lib/logger');
      gated.info('should be filtered');
      gated.warn('should appear');
    });
    // Reset back to 'trace' for the rest of the suite.
    process.env.LOG_LEVEL = 'trace';

    expect(captured).toHaveLength(1);
    const line = JSON.parse(captured[0].args[0]);
    expect(line.level).toBe('warn');
  });

  test('does not consult LOG_FORMAT once cached at module load', () => {
    // Realistic workflow: format is decided at import time, switching the env
    // mid-process should not retroactively change the writer.
    const child = logger.child({ module: 'cache' });
    process.env.LOG_FORMAT = 'pretty';
    child.info('still json');
    const line = JSON.parse(captured[0].args[0]);
    expect(line.level).toBe('info');
  });

  test('logger module path is stable (regression: src/lib/logger.js)', () => {
    expect(require.resolve('../src/lib/logger')).toBe(
      path.resolve(__dirname, '..', 'src', 'lib', 'logger.js')
    );
  });
});
