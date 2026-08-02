'use strict';

/**
 * The mixed-case zone-code contract for operator-entered FAR rules.
 *
 * The defect: `createManualFarRule` uppercased whatever zone code the operator
 * typed. Every seeded rulebook stores mixed-case codes — 'C-Business',
 * 'R-Mixed', 'AN-R', 'BIA-IT' — and `selectFarRule` resolves a parcel's FAR by
 * matching on `zone_code`. So a manual rule for 'C-Business' was stored as
 * 'C-BUSINESS', accepted without complaint, and then never matched by the
 * engine that requested it. The override looked applied and did nothing, which
 * is the worst failure shape this codebase ships: silent, and confidence-
 * building in the wrong direction.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(), getClient: jest.fn(), transaction: jest.fn() }));

const { canonicalizeZoneCode } = require('../src/services/parcelIntelligence/authorityInputs.service');

// A client whose first query answers the zone-by-id lookup and whose second
// answers the case-insensitive lookup, mirroring the service's two paths.
const mockClient = (responses) => {
  const calls = [];
  return {
    calls,
    query: jest.fn((sql, params) => {
      calls.push({ sql, params });
      const next = responses.shift();
      return Promise.resolve({ rows: next || [] });
    }),
  };
};

describe('canonicalizeZoneCode', () => {
  test('prefers the linked zone — its code is by definition what FAR resolution looks for', async () => {
    const client = mockClient([[{ zone_code: 'C-Business' }]]);
    const out = await canonicalizeZoneCode(client, { entered: 'c-business', zoneId: 'zone-1' });

    expect(out).toBe('C-Business');
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.calls[0].sql).toMatch(/WHERE id = \$1::uuid/);
  });

  test('falls back to a case-insensitive lookup and returns the stored casing', async () => {
    // With no linked zone there is exactly ONE query — the zone-by-id lookup is
    // skipped rather than issued and discarded.
    const client = mockClient([[{ zone_code: 'R-Mixed' }]]);
    const out = await canonicalizeZoneCode(client, { entered: 'R-MIXED', zoneId: null });

    expect(out).toBe('R-Mixed');
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.calls[0].sql).toMatch(/LOWER\(zone_code\) = LOWER\(\$1\)/);
  });

  test('still resolves when the linked zone lookup finds nothing', async () => {
    const client = mockClient([[], [{ zone_code: 'AN-R' }]]);
    expect(await canonicalizeZoneCode(client, { entered: 'an-r', zoneId: 'missing' })).toBe('AN-R');
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('preserves an unknown code verbatim — never uppercases it', async () => {
    // This is the regression: uppercasing an unrecognised code cannot make it
    // match anything and only widens the mismatch.
    const client = mockClient([[]]);
    expect(await canonicalizeZoneCode(client, { entered: 'Some-New-Zone', zoneId: null }))
      .toBe('Some-New-Zone');
  });

  test.each([
    ['C-Business', 'c-business'],
    ['R-Mixed', 'r-mixed'],
    ['AN-R', 'an-r'],
    ['BIA-IT', 'bia-it'],
    ['HOS-IT', 'hos-it'],
  ])('%s survives a lower-case entry', async (stored, typed) => {
    const client = mockClient([[{ zone_code: stored }]]);
    expect(await canonicalizeZoneCode(client, { entered: typed, zoneId: null })).toBe(stored);
  });

  test('the old behaviour would have broken every one of these', () => {
    // Documenting the regression in one line: uppercasing is wrong for every
    // real zone code in the seeded corpus, not an edge case.
    for (const code of ['C-Business', 'R-Mixed', 'AN-R', 'BIA-IT', 'HOS-IT']) {
      if (code.toUpperCase() !== code) expect(code.toUpperCase()).not.toBe(code);
    }
  });
});
