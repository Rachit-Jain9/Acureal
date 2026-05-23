'use strict';

/**
 * Pins the human-readable copy on the EVIDENCE_LINKED activity row.
 *
 * The handler in dealEvents.service.js converts `{linkKind, ownerKind}`
 * from the event payload into a plain-English description that lands on
 * the deal's Activity timeline. This test makes sure the translation
 * doesn't regress to the engineer-y "Evidence linked (document → dd_item)"
 * shorthand it had before.
 */

const dbCfg = require('../src/config/database');
jest.spyOn(dbCfg, 'query').mockResolvedValue({ rows: [] });

const { EVENTS, publish, clearAllSubscribers } = require('../src/lib/eventBus');
const dealEvents = require('../src/services/dealEvents.service');

const findInsert = (calls) =>
  calls.find(([sql]) => /INSERT INTO activities/i.test(String(sql)));

beforeAll(() => dealEvents.register());
afterAll(() => dealEvents.unregister());

beforeEach(() => {
  dbCfg.query.mockClear();
});

describe('EVIDENCE_LINKED → activity description', () => {
  test('a document linked to a DD item reads "Linked a document to a DD item"', async () => {
    await publish(EVENTS.EVIDENCE_LINKED, {
      dealId: 'd1',
      ownerKind: 'dd_item',
      linkKind: 'document',
      userId: 'u1',
    });
    const insert = findInsert(dbCfg.query.mock.calls);
    expect(insert).toBeTruthy();
    // The description is the 3rd parameter the insert passes
    // (deal_id, type, description, …).
    expect(insert[1][2]).toBe('Linked a document to a DD item');
  });

  test('a manual verification on a risk flag reads naturally', async () => {
    await publish(EVENTS.EVIDENCE_LINKED, {
      dealId: 'd1',
      ownerKind: 'risk_flag',
      linkKind: 'manual_verification',
      userId: 'u1',
    });
    const insert = findInsert(dbCfg.query.mock.calls);
    expect(insert[1][2]).toBe('Linked a manual verification to a risk flag');
  });

  test('an external URL to a comparable reads naturally', async () => {
    await publish(EVENTS.EVIDENCE_LINKED, {
      dealId: 'd1',
      ownerKind: 'comp',
      linkKind: 'external_url',
      userId: 'u1',
    });
    const insert = findInsert(dbCfg.query.mock.calls);
    expect(insert[1][2]).toBe('Linked an external reference to a comparable');
  });

  test('unknown kinds fall back to generic but readable copy', async () => {
    await publish(EVENTS.EVIDENCE_LINKED, {
      dealId: 'd1',
      ownerKind: 'never_seen',
      linkKind: 'also_unknown',
      userId: 'u1',
    });
    const insert = findInsert(dbCfg.query.mock.calls);
    expect(insert[1][2]).toBe('Linked evidence to an item on this deal');
  });

  test('no activity is written when the deal id is missing', async () => {
    // Some owner kinds (guidance_value, parcel_intelligence) don't sit
    // inside a single deal, so the resolver returns null. The handler
    // must short-circuit instead of writing a deal-less audit row.
    await publish(EVENTS.EVIDENCE_LINKED, {
      dealId: null,
      ownerKind: 'guidance_value',
      linkKind: 'document',
      userId: 'u1',
    });
    expect(findInsert(dbCfg.query.mock.calls)).toBeFalsy();
  });
});

afterEach(() => {
  // Drain any in-flight subscriber rejections that the event-bus swallows
  // so they don't bleed across tests.
  clearAllSubscribers();
  dealEvents.unregister();
  dealEvents.register();
});
