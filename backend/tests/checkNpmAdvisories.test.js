'use strict';

/**
 * Tests for scripts/check-npm-advisories.js — the dependency-advisory gate.
 *
 * This gate can WAIVE a high/critical advisory, which makes it the one place
 * in CI that is allowed to say "ship anyway". A waiver path that has never been
 * exercised by a test is a hole waiting to happen: watching it pass in CI
 * proves only that it passes, never that it FAILS when it should.
 *
 * The load-bearing claim of every waiver is "no patched version exists". These
 * tests pin the machinery that re-checks that claim on every run, so a fix
 * landing upstream in September is caught in September rather than at the
 * expiry date in November — and so that nobody can quietly keep a waiver alive
 * past the point where it has become a false statement.
 */

const path = require('path');

const {
  assessFixState,
  blockingAdvisories,
  ghsaFromUrl,
  WAIVERS,
} = require(path.join('..', '..', 'scripts', 'check-npm-advisories.js'));

describe('assessFixState — is the waiver\'s "no fix exists" premise still true?', () => {
  // The real image-size waiver: npm's only offer is a four-major downgrade of
  // the parent, which would delete PPTX export rather than fix anything.
  const imageSizeWaiver = {
    package: 'image-size',
    noFixState: { name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true },
  };

  test('the recorded destructive offer is not a fix — premise holds', () => {
    expect(assessFixState(imageSizeWaiver, {
      name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true,
    })).toBe('none');
  });

  test('no remediation at all is not a fix', () => {
    expect(assessFixState(imageSizeWaiver, false)).toBe('none');
    expect(assessFixState(imageSizeWaiver, undefined)).toBe('none');
  });

  test('an in-place fix (true) invalidates the waiver', () => {
    expect(assessFixState(imageSizeWaiver, true)).toBe('available');
  });

  // The case this whole mechanism exists for: image-size publishes 2.0.3.
  test('a fix landing ON the waived package invalidates the waiver', () => {
    expect(assessFixState(imageSizeWaiver, {
      name: 'image-size', version: '2.0.3', isSemVerMajor: false,
    })).toBe('available');
  });

  // pptxgenjs 4.0.2 dropping or bumping the dep — non-destructive, so real.
  test('a NON-major parent bump is a real fix', () => {
    expect(assessFixState(imageSizeWaiver, {
      name: 'pptxgenjs', version: '4.0.2', isSemVerMajor: false,
    })).toBe('available');
  });

  test('a different destructive offer is reported as changed, not fatal', () => {
    expect(assessFixState(imageSizeWaiver, {
      name: 'pptxgenjs', version: '2.0.0', isSemVerMajor: true,
    })).toBe('changed');
  });

  test('a waiver with no recorded state still flags a destructive offer as changed', () => {
    expect(assessFixState({ package: 'image-size' }, {
      name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true,
    })).toBe('changed');
  });
});

describe('WAIVERS — every entry must carry its own proof', () => {
  test('there are no undocumented waivers', () => {
    for (const [key, w] of WAIVERS) {
      expect(key).toMatch(/^[a-z]+:GHSA-[0-9a-z-]+$/i);
      expect(typeof w.package).toBe('string');
      expect(w.reason && w.reason.length).toBeGreaterThan(40);
      expect(w.evidence && w.evidence.length).toBeGreaterThan(20);
      // An expiry is mandatory and must be a real ISO date — a waiver without
      // one is a permanent exemption wearing a disguise.
      expect(w.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(w.expires))).toBe(false);
    }
  });

  // Not "is it in the future" — that would fail the build on the very day the
  // gate is supposed to fail loudly with its own explanatory message. This
  // asserts nobody has parked a waiver decades out to avoid the conversation.
  test('no waiver is parked further than a year out', () => {
    const oneYearOut = new Date(Date.now() + 366 * 24 * 3600 * 1000)
      .toISOString().slice(0, 10);
    for (const [key, w] of WAIVERS) {
      expect(`${key} expires ${w.expires}`)
        .toBe(w.expires <= oneYearOut ? `${key} expires ${w.expires}` : 'PARKED TOO FAR OUT');
    }
  });
});

describe('blockingAdvisories — flattening npm\'s nested via graph', () => {
  test('keys on GHSA id and carries fixAvailable through', () => {
    const report = {
      vulnerabilities: {
        'image-size': {
          severity: 'high',
          fixAvailable: { name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true },
          via: [{
            name: 'image-size',
            severity: 'high',
            title: 'ICNS parser DoS',
            url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
          }],
        },
        // The same advisory resurfacing under the parent must not double-count.
        pptxgenjs: {
          severity: 'high',
          fixAvailable: { name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true },
          via: ['image-size'],
        },
      },
    };
    const out = blockingAdvisories(report);
    expect(out.size).toBe(1);
    const adv = out.get('GHSA-w3rx-r6r6-pgpr');
    expect(adv.package).toBe('image-size');
    expect(adv.fixAvailable).toEqual({ name: 'pptxgenjs', version: '1.1.5', isSemVerMajor: true });
  });

  test('moderate advisories never block', () => {
    const report = {
      vulnerabilities: {
        uuid: {
          severity: 'moderate',
          via: [{ name: 'uuid', severity: 'moderate', title: 'bounds', url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq' }],
        },
      },
    };
    expect(blockingAdvisories(report).size).toBe(0);
  });
});

describe('ghsaFromUrl', () => {
  test('extracts the id, and tolerates junk', () => {
    expect(ghsaFromUrl('https://github.com/advisories/GHSA-w3rx-r6r6-pgpr')).toBe('GHSA-w3rx-r6r6-pgpr');
    expect(ghsaFromUrl('nope')).toBeNull();
    expect(ghsaFromUrl(undefined)).toBeNull();
  });
});
