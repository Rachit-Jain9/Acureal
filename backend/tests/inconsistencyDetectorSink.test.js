'use strict';

/**
 * Tests for the inconsistency-detector event sink (P1-PR4 / Workstream B3).
 *
 * The sink subscribes to DOCUMENT_EXTRACTED, debounces per-deal for 90s,
 * looks up the org for RLS context, and runs the detector. Tests use jest
 * fake timers to fast-forward through the debounce window without waiting.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/inconsistencyDetector.service', () => ({
  detectAndPersist: jest.fn(),
}));

const { EVENTS, publish } = require('../src/lib/eventBus');
const sink = require('../src/services/inconsistencyDetector.sink');
const db = require('../src/config/database');
const detector = require('../src/services/inconsistencyDetector.service');

beforeEach(() => {
  jest.useFakeTimers();
  sink.unregister();
  db.query.mockReset();
  detector.detectAndPersist.mockReset();
  // Default: any query (BEGIN/SET LOCAL/COMMIT/lookup) returns an empty
  // result. Specific lookups are overridden per test.
  db.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  sink.unregister();
  jest.useRealTimers();
});

describe('inconsistencyDetector sink registration', () => {
  test('subscribes to DOCUMENT_EXTRACTED on register', () => {
    sink.register();
    // No detector run yet — just registration.
    expect(detector.detectAndPersist).not.toHaveBeenCalled();
  });

  test('register is idempotent — calling twice does NOT double-subscribe', () => {
    sink.register();
    sink.register();
    sink.register();
    // Publish one event; we should see at most ONE scheduleRun (debounced
    // to one detector pass).
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed', userId: 'u-1' });
    expect(sink._pendingSize()).toBe(1);
  });

  test('unregister clears pending timers + the subscription', () => {
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed' });
    expect(sink._pendingSize()).toBe(1);
    sink.unregister();
    expect(sink._pendingSize()).toBe(0);
    // After unregister, new events are ignored.
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed' });
    expect(sink._pendingSize()).toBe(0);
  });
});

describe('inconsistencyDetector sink event handling', () => {
  test('skips events with no dealId', () => {
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: null, status: 'completed' });
    expect(sink._pendingSize()).toBe(0);
  });

  test('skips events with status=failed', () => {
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'failed' });
    expect(sink._pendingSize()).toBe(0);
  });

  test('schedules a debounced run on a completed extraction', () => {
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed', userId: 'u-1' });
    expect(sink._pendingSize()).toBe(1);
    // Before the debounce window expires the detector has NOT run.
    expect(detector.detectAndPersist).not.toHaveBeenCalled();
  });

  test('debounces a burst of N events into ONE detector run per deal', async () => {
    db.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT organization_id')) {
        return { rows: [{ organization_id: 'org-1', name: 'Whitefield Deal' }] };
      }
      return { rows: [] };
    });
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed', userId: 'u-1' });
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed', userId: 'u-2' });
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed', userId: 'u-3' });
    expect(sink._pendingSize()).toBe(1); // still one pending entry — debounced
    // Fast-forward past the debounce window.
    await jest.advanceTimersByTimeAsync(sink.DEBOUNCE_MS + 50);
    expect(detector.detectAndPersist).toHaveBeenCalledTimes(1);
    // Last user wins on debounce — u-3 is the operator attribution.
    expect(detector.detectAndPersist).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ userId: 'u-3', organizationId: 'org-1', dealName: 'Whitefield Deal' }),
    );
  });

  test('separate deals each get their own debounce slot', async () => {
    db.query.mockImplementation(async (sql, args) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT organization_id')) {
        const did = args[0];
        return { rows: [{ organization_id: `org-${did}`, name: `Deal ${did}` }] };
      }
      return { rows: [] };
    });
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-A', status: 'completed' });
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-B', status: 'completed' });
    expect(sink._pendingSize()).toBe(2);
    await jest.advanceTimersByTimeAsync(sink.DEBOUNCE_MS + 50);
    expect(detector.detectAndPersist).toHaveBeenCalledTimes(2);
  });

  test('detector failure does not throw — sink swallows + logs', async () => {
    db.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT organization_id')) {
        return { rows: [{ organization_id: 'org-1', name: 'D' }] };
      }
      return { rows: [] };
    });
    detector.detectAndPersist.mockRejectedValueOnce(new Error('boom'));
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-1', status: 'completed' });
    // Should not reject.
    await expect(jest.advanceTimersByTimeAsync(sink.DEBOUNCE_MS + 50)).resolves.not.toThrow();
  });

  test('skips the detector run when the deal has no org (deleted / RLS-invisible)', async () => {
    db.query.mockResolvedValue({ rows: [] }); // org lookup returns nothing
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-orphan', status: 'completed' });
    await jest.advanceTimersByTimeAsync(sink.DEBOUNCE_MS + 50);
    expect(detector.detectAndPersist).not.toHaveBeenCalled();
  });

  test('detector runs INSIDE a request context carrying the org (post-#951 tenant scoping)', async () => {
    // The event fires outside any HTTP request, so the ALS store is empty.
    // The sink must populate it — every tenant-scoped query() the detector
    // makes reads the org from this context (a manual BEGIN/set_config would
    // be a no-op since #951 runs each query in its own transaction).
    const { getRequestContext } = require('../src/lib/requestContext');
    let observed = null;
    detector.detectAndPersist.mockImplementationOnce(async () => {
      observed = getRequestContext();
      return { flags: [] };
    });
    db.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT organization_id')) {
        return { rows: [{ organization_id: 'org-77', name: 'Ctx Deal' }] };
      }
      return { rows: [] };
    });
    sink.register();
    publish(EVENTS.DOCUMENT_EXTRACTED, { dealId: 'deal-ctx', status: 'completed', userId: 'u-9' });
    await jest.advanceTimersByTimeAsync(sink.DEBOUNCE_MS + 50);
    expect(detector.detectAndPersist).toHaveBeenCalledTimes(1);
    expect(observed).toMatchObject({ organizationId: 'org-77', userId: 'u-9' });
  });
});
