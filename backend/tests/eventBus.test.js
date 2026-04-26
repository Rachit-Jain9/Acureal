'use strict';

const { EVENTS, subscribe, publish, list, clearAllSubscribers } = require('../src/lib/eventBus');

describe('lib/eventBus', () => {
  beforeEach(() => clearAllSubscribers());

  test('subscribers receive published events with enriched payload', async () => {
    const received = [];
    subscribe(EVENTS.DEAL_CREATED, (payload) => received.push(payload));

    await publish(EVENTS.DEAL_CREATED, { dealId: 'd1' });

    expect(received).toHaveLength(1);
    expect(received[0].dealId).toBe('d1');
    expect(received[0].event).toBe(EVENTS.DEAL_CREATED);
    expect(typeof received[0].emittedAt).toBe('string');
  });

  test('multiple subscribers all run, even if one throws', async () => {
    const calls = [];
    subscribe(EVENTS.DD_ITEM_STATUS_CHANGED, () => calls.push('first'));
    subscribe(EVENTS.DD_ITEM_STATUS_CHANGED, () => {
      calls.push('boom');
      throw new Error('handler exploded');
    });
    subscribe(EVENTS.DD_ITEM_STATUS_CHANGED, () => calls.push('third'));

    const result = await publish(EVENTS.DD_ITEM_STATUS_CHANGED, { dealId: 'd1' });

    expect(calls).toEqual(['first', 'boom', 'third']);
    expect(result.delivered).toBe(2); // 2 of 3 succeeded
    expect(result.failed).toBe(1);
  });

  test('publish on an event with no subscribers is a no-op', async () => {
    const result = await publish('no.such.event', {});
    expect(result.delivered).toBe(0);
  });

  test('unsubscribe removes the handler', async () => {
    const seen = [];
    const unsubscribe = subscribe(EVENTS.DEAL_CREATED, (p) => seen.push(p.dealId));
    await publish(EVENTS.DEAL_CREATED, { dealId: 'd1' });
    unsubscribe();
    await publish(EVENTS.DEAL_CREATED, { dealId: 'd2' });
    expect(seen).toEqual(['d1']);
  });

  test('list() returns counts per event name', () => {
    subscribe(EVENTS.DEAL_CREATED, () => {});
    subscribe(EVENTS.DEAL_CREATED, () => {});
    subscribe(EVENTS.DEAL_STAGE_CHANGED, () => {});

    const summary = list();
    expect(summary[EVENTS.DEAL_CREATED]).toBe(2);
    expect(summary[EVENTS.DEAL_STAGE_CHANGED]).toBe(1);
  });

  test('subscribe rejects invalid input', () => {
    expect(() => subscribe('', () => {})).toThrow();
    expect(() => subscribe('x', null)).toThrow();
  });

  test('canonical event name catalog is frozen', () => {
    expect(Object.isFrozen(EVENTS)).toBe(true);
    expect(EVENTS.DEAL_STAGE_CHANGED).toBe('deal.stage_changed');
  });
});
