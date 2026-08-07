'use strict';

const {
  normalizeEmailDomain,
  isPublicEmailDomain,
  isGoogleMailAddress,
  PUBLIC_EMAIL_PROVIDERS,
} = require('../src/utils/emailDomain');

describe('emailDomain.isGoogleMailAddress', () => {
  // Marks the one provider family whose canonical form is MANY-to-one, which
  // is what decides whether a canonical address may be treated as naming a
  // single account (auth.service.js clearLoginAttempts).
  test.each([
    ['a.b@gmail.com', true],
    ['a.b@GoogleMail.com', true],
    ['  A.B@gmail.com  ', true],
    ['a.b@acme-realty.in', false],
    ['a.b@outlook.com', false],
    ['a.b@gmail.com.attacker.tld', false],
    ['gmail.com', false],
    ['', false],
    [null, false],
  ])('isGoogleMailAddress(%s) → %s', (input, expected) => {
    expect(isGoogleMailAddress(input)).toBe(expected);
  });
});

describe('emailDomain.normalizeEmailDomain', () => {
  test('extracts the domain from an email, lower-cased', () => {
    expect(normalizeEmailDomain('Asha@Acme-Realty.IN')).toBe('acme-realty.in');
  });

  test('accepts a bare domain', () => {
    expect(normalizeEmailDomain('acme.in')).toBe('acme.in');
  });

  test('strips a leading @ and a trailing FQDN dot', () => {
    expect(normalizeEmailDomain('@corp.com.')).toBe('corp.com');
  });

  test('uses the part after the LAST @', () => {
    expect(normalizeEmailDomain('weird@local@corp.com')).toBe('corp.com');
  });

  test('returns null for empty / dotless / missing input', () => {
    expect(normalizeEmailDomain('')).toBeNull();
    expect(normalizeEmailDomain(null)).toBeNull();
    expect(normalizeEmailDomain('localhost')).toBeNull();
    expect(normalizeEmailDomain('user@')).toBeNull();
  });
});

describe('emailDomain.isPublicEmailDomain', () => {
  test('flags common consumer providers (incl. India-first)', () => {
    ['gmail.com', 'outlook.com', 'yahoo.co.in', 'rediffmail.com', 'proton.me'].forEach((d) => {
      expect(isPublicEmailDomain(d)).toBe(true);
    });
  });

  test('accepts a full email, not just a domain', () => {
    expect(isPublicEmailDomain('someone@gmail.com')).toBe(true);
  });

  test('does NOT flag a corporate domain', () => {
    expect(isPublicEmailDomain('acme-realty.in')).toBe(false);
    expect(isPublicEmailDomain('cfo@brookfield.com')).toBe(false);
  });

  test('handles junk input without throwing', () => {
    expect(isPublicEmailDomain('')).toBe(false);
    expect(isPublicEmailDomain(null)).toBe(false);
  });

  test('the provider denylist is non-trivial', () => {
    expect(PUBLIC_EMAIL_PROVIDERS.size).toBeGreaterThan(20);
  });
});
