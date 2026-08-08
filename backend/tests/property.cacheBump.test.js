'use strict';

/**
 * A parcel edit must invalidate the deterministic workspace cache.
 *
 * `dealWorkspaceCache` fingerprints `deals.updated_at` to decide whether a
 * cached payload is current. `properties` is deliberately NOT part of that
 * fingerprint — adding a join to the hot per-request path for a twice-a-month
 * event is the wrong trade. The consequence was that editing a parcel changed
 * nothing the cache could see, even though micro-market, nearby comps,
 * best-use and IC readiness are all keyed on the parcel's coordinates and
 * area: the deal page repainted PRE-EDIT intelligence for up to the 120-second
 * TTL, and Deal Q&A answered from it.
 *
 * Touching the parent deal's `updated_at` moves the fingerprint the cache
 * already reads. These tests pin that it happens on all three write paths, and
 * — just as importantly — that a failure to bump can never lose the user's edit.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/utils/geocode', () => ({ geocodeAddress: jest.fn() }));

const { query } = require('../src/config/database');
const { geocodeAddress } = require('../src/utils/geocode');
const propertyService = require('../src/services/property.service');

const PROPERTY_ID = 'prop-uuid-1';
const stubProperty = {
  id: PROPERTY_ID,
  organization_id: 'org-1',
  name: 'Test Property',
  city: 'Bengaluru',
  address: '1 Test Road, Whitefield',
};

const bumpCalls = () =>
  query.mock.calls.filter(([sql]) => /UPDATE deals SET updated_at/i.test(String(sql)));

beforeEach(() => {
  jest.resetAllMocks();
  query.mockImplementation((sql) => {
    const text = String(sql);
    if (/UPDATE deals SET updated_at/i.test(text)) return Promise.resolve({ rowCount: 1, rows: [] });
    if (/^\s*SELECT/i.test(text)) return Promise.resolve({ rows: [stubProperty], rowCount: 1 });
    return Promise.resolve({ rows: [stubProperty], rowCount: 1 });
  });
});

describe('parcel writes bump the parent deal so the workspace cache invalidates', () => {
  test('updateProperty bumps, keyed on property_id', async () => {
    await propertyService.updateProperty(PROPERTY_ID, { name: 'Renamed' }, 'user-1');
    const bumps = bumpCalls();
    expect(bumps).toHaveLength(1);
    expect(bumps[0][1]).toEqual([PROPERTY_ID]);
    expect(String(bumps[0][0])).toMatch(/WHERE property_id = \$1/);
  });

  test('geocodePropertyAddress bumps — coordinates drive every geo slice', async () => {
    geocodeAddress.mockResolvedValue({
      found: true, lat: 12.97, lng: 77.75, status: 'ok', confidence: 'high', message: null,
    });
    await propertyService.geocodePropertyAddress(PROPERTY_ID);
    expect(bumpCalls()).toHaveLength(1);
    expect(bumpCalls()[0][1]).toEqual([PROPERTY_ID]);
  });

  // A geocode that fails records the attempt but does not move the parcel, so
  // there is nothing for the cache to have gone stale on.
  test('a FAILED geocode does not bump', async () => {
    geocodeAddress.mockResolvedValue({ found: false, status: 'zero_results', message: 'No match.' });
    await expect(propertyService.geocodePropertyAddress(PROPERTY_ID)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(bumpCalls()).toHaveLength(0);
  });

  test('applyAutoDerivedContext bumps', async () => {
    await propertyService.applyAutoDerivedContext(
      PROPERTY_ID,
      { picks: { ward_no: '150' }, derivedSource: 'bbmp' },
      'user-1',
    );
    expect(bumpCalls()).toHaveLength(1);
  });

  // The whole point of best-effort: a cache-invalidation failure costs at most
  // one stale TTL window, whereas a thrown error would lose the user's edit.
  test('a failing bump never fails the mutation it follows', async () => {
    query.mockImplementation((sql) => {
      const text = String(sql);
      if (/UPDATE deals SET updated_at/i.test(text)) {
        return Promise.reject(new Error('deadlock detected'));
      }
      return Promise.resolve({ rows: [stubProperty], rowCount: 1 });
    });

    await expect(
      propertyService.updateProperty(PROPERTY_ID, { name: 'Renamed' }, 'user-1'),
    ).resolves.toMatchObject({ id: PROPERTY_ID });
  });

  // A 404 must short-circuit before the bump — bumping for a property that was
  // not updated would invalidate a cache for no reason.
  test('a property that does not exist is not bumped', async () => {
    query.mockImplementation((sql) => {
      const text = String(sql);
      if (/UPDATE deals SET updated_at/i.test(text)) return Promise.resolve({ rowCount: 1, rows: [] });
      if (/^\s*UPDATE properties/i.test(text)) return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [stubProperty], rowCount: 1 });
    });

    await expect(
      propertyService.updateProperty(PROPERTY_ID, { name: 'Renamed' }, 'user-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(bumpCalls()).toHaveLength(0);
  });
});
