#!/usr/bin/env node
'use strict';

/**
 * Answers one question before anyone flips DATABASE_SSL_MODE=verify-full:
 * does the database host actually present a certificate that validates?
 *
 * WHY THIS EXISTS. Certificate verification either works or takes the whole
 * site down — there is no partial failure, and the failure happens at cold
 * start, on every request, at once. Flipping the env var to find out is the
 * wrong way to learn the answer.
 *
 * WHY IT NEEDS NO CREDENTIALS. Postgres negotiates TLS before authentication:
 * the client sends an 8-byte SSLRequest, the server replies with a single 'S',
 * and the TLS handshake happens on the same socket. The certificate is
 * therefore fully inspectable without a username, a password, or a database
 * name — so this is safe to run against production, and safe to run from a
 * laptop.
 *
 * USAGE
 *   node backend/scripts/check-db-tls.js                    # reads DATABASE_URL
 *   node backend/scripts/check-db-tls.js <host> [port]      # explicit target
 *
 * Exit code 0 = the certificate validates against the trust store (verify-full
 * is safe to enable). Exit code 1 = it does not, and the reason is printed.
 * READ-ONLY: it opens a socket, inspects the certificate, and disconnects
 * before sending a startup message. It never authenticates and never queries.
 */

const net = require('net');
const tls = require('tls');

const SSL_REQUEST = (() => {
  const buf = Buffer.alloc(8);
  buf.writeInt32BE(8, 0);          // message length
  buf.writeInt32BE(80877103, 4);   // magic: 1234 << 16 | 5679
  return buf;
})();

const targetFromEnv = () => {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return { host: url.hostname, port: Number(url.port) || 5432 };
  } catch {
    return null;
  }
};

const negotiate = (host, port) => new Promise((resolve, reject) => {
  const socket = net.connect({ host, port });
  const fail = (err) => { socket.destroy(); reject(err); };

  socket.setTimeout(10_000, () => fail(new Error(`timed out connecting to ${host}:${port}`)));
  socket.once('error', fail);

  socket.once('connect', () => socket.write(SSL_REQUEST));

  socket.once('data', (reply) => {
    if (reply[0] !== 0x53) { // 'S'
      return fail(new Error(
        `server refused TLS (replied '${String.fromCharCode(reply[0])}'). `
        + 'This host does not support an encrypted connection at all.',
      ));
    }
    // Upgrade in place. `rejectUnauthorized: false` so the handshake always
    // completes and we can REPORT on the certificate rather than just throwing;
    // `authorized` tells us what a strict client would have decided.
    const secured = tls.connect({
      socket,
      servername: host,
      rejectUnauthorized: false,
    }, () => {
      const cert = secured.getPeerCertificate(true) || {};
      resolve({
        authorized: secured.authorized,
        authorizationError: secured.authorizationError ? String(secured.authorizationError) : null,
        protocol: secured.getProtocol(),
        subject: cert.subject?.CN || null,
        issuer: cert.issuer?.CN || cert.issuer?.O || null,
        altNames: cert.subjectaltname || null,
        validTo: cert.valid_to || null,
      });
      secured.end();
    });
    secured.once('error', fail);
  });
});

const main = async () => {
  const [argHost, argPort] = process.argv.slice(2);
  const target = argHost
    ? { host: argHost, port: Number(argPort) || 5432 }
    : targetFromEnv();

  if (!target) {
    console.error('No target. Pass a host, or set DATABASE_URL.');
    process.exit(2);
  }

  console.log(`[check-db-tls] ${target.host}:${target.port}`);

  let result;
  try {
    result = await negotiate(target.host, target.port);
  } catch (err) {
    console.error(`[check-db-tls] FAILED before the certificate could be read: ${err.message}`);
    process.exit(1);
  }

  console.log(`  protocol   ${result.protocol}`);
  console.log(`  subject    ${result.subject || '(none)'}`);
  console.log(`  issuer     ${result.issuer || '(none)'}`);
  console.log(`  altNames   ${result.altNames || '(none)'}`);
  console.log(`  expires    ${result.validTo || '(unknown)'}`);

  if (result.authorized) {
    console.log('\n  VERIFIED — the chain and hostname both validate against the trust store.');
    console.log('  DATABASE_SSL_MODE=verify-full is safe to enable for this host.');
    process.exit(0);
  }

  console.log(`\n  NOT VERIFIED — ${result.authorizationError}`);
  console.log('  Enabling DATABASE_SSL_MODE=verify-full against this host would break every');
  console.log('  connection. Supply the provider CA via DATABASE_CA_CERT and re-run, or stay');
  console.log('  on "relaxed" until the chain is resolved.');
  process.exit(1);
};

main();
