'use strict';

/**
 * The database transport posture.
 *
 * Production has always connected with `ssl: { rejectUnauthorized: false }` —
 * encrypted, but the server's certificate never authenticated, so the client
 * completes a handshake with whatever answers on that host and port. These
 * tests pin the switch that makes verification available as an env edit with an
 * instant revert, rather than a deploy that has to be rolled back under
 * pressure if the certificate chain turns out not to validate.
 *
 * The default MUST remain unchanged behaviour: merging the switch may not alter
 * how production connects until someone deliberately opts in.
 */

const { resolveSslMode, resolveSslConfig, isVerifyingServerIdentity, MODES } =
  require('../src/config/databaseSsl');

const env = (overrides) => ({ NODE_ENV: 'production', ...overrides });

describe('default behaviour is unchanged', () => {
  test('production with no setting still encrypts without verifying', () => {
    expect(resolveSslConfig(env({}))).toEqual({ rejectUnauthorized: false });
    expect(resolveSslMode(env({})).mode).toBe(MODES.RELAXED);
  });

  test('non-production still disables TLS entirely', () => {
    // Local Postgres generally has no TLS listener at all; requiring it would
    // break every developer machine.
    expect(resolveSslConfig({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveSslConfig({ NODE_ENV: 'test' })).toBe(false);
  });
});

describe('verify-full authenticates the server', () => {
  test('rejects an unauthenticated certificate', () => {
    // rejectUnauthorized:true validates the chain, and because no custom
    // checkServerIdentity is supplied Node also verifies the hostname — which
    // together is what "verify-full" means.
    expect(resolveSslConfig(env({ DATABASE_SSL_MODE: 'verify-full' })))
      .toEqual({ rejectUnauthorized: true });
    expect(isVerifyingServerIdentity(env({ DATABASE_SSL_MODE: 'verify-full' }))).toBe(true);
  });

  test('attaches a custom CA only when one is actually supplied', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    expect(resolveSslConfig(env({ DATABASE_SSL_MODE: 'verify-full', DATABASE_CA_CERT: pem })))
      .toEqual({ rejectUnauthorized: true, ca: pem });
  });

  test('an empty CA is omitted, not passed through', () => {
    // Passing `ca: ''` REPLACES Node's trust store with an empty one, so every
    // connection fails with a self-signed-certificate error — a failure that
    // reads like a certificate problem rather than the config typo it is.
    for (const blank of ['', '   ', '\n']) {
      expect(resolveSslConfig(env({ DATABASE_SSL_MODE: 'verify-full', DATABASE_CA_CERT: blank })))
        .toEqual({ rejectUnauthorized: true });
    }
  });

  test('is case- and whitespace-insensitive, as a pasted env value will be', () => {
    for (const value of ['VERIFY-FULL', ' verify-full ', 'Verify-Full']) {
      expect(isVerifyingServerIdentity(env({ DATABASE_SSL_MODE: value }))).toBe(true);
    }
  });
});

describe('a PEM that lost its newlines in transit still works', () => {
  // A certificate is multi-line, and the journey from a downloaded .crt into a
  // hosting dashboard does not always preserve that: some UIs and shell exports
  // turn each real newline into the two characters \ and n. OpenSSL then
  // rejects the blob — and because this path only runs once verify-full is
  // already on, the first symptom is every connection failing at cold start.
  const pem = ['-----BEGIN CERTIFICATE-----', 'MIIByjCCAXOgAwIBAgIU', '-----END CERTIFICATE-----'].join('\n');
  const escaped = pem.split('\n').join('\\n');

  test('the escaped form is genuinely different, so the test is not vacuous', () => {
    expect(escaped).not.toBe(pem);
    expect(escaped).toContain('\\n');
    expect(escaped).not.toContain('\n');
  });

  test('literal backslash-n is normalised back to real newlines', () => {
    expect(resolveSslConfig(env({ DATABASE_SSL_MODE: 'verify-full', DATABASE_CA_CERT: escaped })).ca)
      .toBe(pem);
  });

  test('literal backslash-r-backslash-n is normalised too', () => {
    const crlf = pem.split('\n').join('\\r\\n');
    expect(resolveSslConfig(env({ DATABASE_SSL_MODE: 'verify-full', DATABASE_CA_CERT: crlf })).ca)
      .toBe(pem);
  });

  test('a correctly-pasted PEM is left exactly alone', () => {
    expect(resolveSslConfig(env({ DATABASE_SSL_MODE: 'verify-full', DATABASE_CA_CERT: pem })).ca)
      .toBe(pem);
  });
});

describe('a typo never silently changes the posture', () => {
  test.each(['verify_full', 'verifyfull', 'full', 'true', 'on', 'require'])(
    '%s is rejected and falls back to the production default',
    (bad) => {
      const resolved = resolveSslMode(env({ DATABASE_SSL_MODE: bad }));
      expect(resolved.invalid).toBe(true);
      expect(resolved.mode).toBe(MODES.RELAXED);
      // Critically: it does NOT silently harden either. A misspelt value that
      // accidentally enabled verification would take the site down on deploy.
      expect(resolveSslConfig(env({ DATABASE_SSL_MODE: bad }))).toEqual({ rejectUnauthorized: false });
    },
  );

  test('the invalid value is reported so it can be corrected', () => {
    expect(resolveSslMode(env({ DATABASE_SSL_MODE: 'verify_full' })).requested).toBe('verify_full');
  });
});

describe('disable is available for a local Postgres without TLS', () => {
  test('explicit disable turns TLS off even in production', () => {
    expect(resolveSslConfig(env({ DATABASE_SSL_MODE: 'disable' }))).toBe(false);
  });
});

describe('the pool actually consumes the resolver', () => {
  test('database.js builds its ssl option from resolveSslConfig', () => {
    // Guards against the resolver existing but the pool still carrying its own
    // inline literal — the whole point is one place to change.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'database.js'), 'utf8');
    expect(src).toMatch(/ssl:\s*resolveSslConfig\(process\.env\)/);
    expect(src).not.toMatch(/ssl:\s*process\.env\.NODE_ENV === 'production'/);
  });
});
