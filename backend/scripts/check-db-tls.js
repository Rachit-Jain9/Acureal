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
 *   node backend/scripts/check-db-tls.js                       # reads DATABASE_URL
 *   node backend/scripts/check-db-tls.js <host> [port]         # explicit target
 *   node backend/scripts/check-db-tls.js <host> <port> --chain # print the chain
 *   node backend/scripts/check-db-tls.js <host> <port> --ca <file>
 *
 * `--ca` is the one that matters before flipping DATABASE_SSL_MODE. Supabase
 * signs the pooler with a PRIVATE CA, so verify-full only works if the right
 * root is supplied — and the only safe place to obtain it is the authenticated
 * dashboard, out of band from the connection being authenticated. Point this at
 * the downloaded file and it answers, before anything is deployed, whether that
 * exact certificate makes the exact production host verify. Trusting a CA the
 * server itself handed us would defeat the purpose; this proves the one you
 * fetched yourself is the right one.
 *
 * `--chain` prints the presented chain with SHA-256 fingerprints, so the
 * downloaded file can be matched against what production actually serves.
 *
 * Exit code 0 = the certificate validates (verify-full is safe to enable).
 * Exit code 1 = it does not, and the reason is printed.
 * READ-ONLY: it opens a socket, inspects the certificate, and disconnects
 * before sending a startup message. It never authenticates and never queries.
 */

const fs = require('fs');
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

// Walk `issuerCertificate` to the self-signed root, collecting each link.
// Node terminates the walk by making the root point at itself.
const describeChain = (leaf) => {
  const out = [];
  let node = leaf;
  const seen = new Set();
  while (node && node.fingerprint256 && !seen.has(node.fingerprint256)) {
    seen.add(node.fingerprint256);
    out.push({
      subject: node.subject?.CN || node.subject?.O || '(unnamed)',
      issuer: node.issuer?.CN || node.issuer?.O || '(unnamed)',
      fingerprint256: node.fingerprint256,
      validTo: node.valid_to,
      selfSigned: node.fingerprint256 === node.issuerCertificate?.fingerprint256,
    });
    node = node.issuerCertificate;
  }
  return out;
};

const negotiate = (host, port, ca) => new Promise((resolve, reject) => {
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
      // Always complete the handshake so the certificate can be REPORTED rather
      // than merely rejected. `authorized` still tells us what a strict client
      // would have decided — and when a --ca is supplied, it decides against
      // that CA, which is exactly the question being asked.
      rejectUnauthorized: false,
      ...(ca ? { ca } : {}),
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
        chain: describeChain(cert),
      });
      secured.end();
    });
    secured.once('error', fail);
  });
});

const main = async () => {
  const argv = process.argv.slice(2);
  const wantChain = argv.includes('--chain');
  const caIdx = argv.indexOf('--ca');
  const caPath = caIdx >= 0 ? argv[caIdx + 1] : null;
  // Guard the `caIdx + 1` skip on --ca actually being present: with caIdx = -1
  // it evaluates to 0 and silently swallows the host argument.
  const caValueIdx = caIdx >= 0 ? caIdx + 1 : -1;
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== caValueIdx);

  const target = positional[0]
    ? { host: positional[0], port: Number(positional[1]) || 5432 }
    : targetFromEnv();

  if (!target) {
    console.error('No target. Pass a host, or set DATABASE_URL.');
    process.exit(2);
  }

  let ca = null;
  if (caPath) {
    if (!fs.existsSync(caPath)) {
      console.error(`[check-db-tls] CA file not found: ${caPath}`);
      process.exit(2);
    }
    ca = fs.readFileSync(caPath, 'utf8');
    if (!ca.includes('BEGIN CERTIFICATE')) {
      console.error(`[check-db-tls] ${caPath} does not look like a PEM certificate.`);
      process.exit(2);
    }
  }

  console.log(`[check-db-tls] ${target.host}:${target.port}${ca ? `  (against CA ${caPath})` : ''}`);

  let result;
  try {
    result = await negotiate(target.host, target.port, ca);
  } catch (err) {
    console.error(`[check-db-tls] FAILED before the certificate could be read: ${err.message}`);
    process.exit(1);
  }

  console.log(`  protocol   ${result.protocol}`);
  console.log(`  subject    ${result.subject || '(none)'}`);
  console.log(`  issuer     ${result.issuer || '(none)'}`);
  console.log(`  altNames   ${result.altNames || '(none)'}`);
  console.log(`  expires    ${result.validTo || '(unknown)'}`);

  if (wantChain) {
    console.log('\n  presented chain (leaf first):');
    for (const [i, link] of result.chain.entries()) {
      console.log(`    [${i}] ${link.subject}`);
      console.log(`        issued by  ${link.issuer}${link.selfSigned ? '  (self-signed root)' : ''}`);
      console.log(`        sha256     ${link.fingerprint256}`);
      console.log(`        expires    ${link.validTo}`);
    }
    console.log('\n  Match the root fingerprint above against the certificate downloaded from');
    console.log('  the Supabase dashboard before trusting it. A CA is only meaningful when it');
    console.log('  is obtained out of band from the connection it is meant to authenticate.');
  }

  if (result.authorized) {
    console.log(ca
      ? '\n  VERIFIED against the supplied CA — chain and hostname both check out.'
      : '\n  VERIFIED — the chain and hostname both validate against the system trust store.');
    console.log('  DATABASE_SSL_MODE=verify-full is safe to enable for this host'
      + (ca ? ' with this CA in DATABASE_CA_CERT.' : '.'));
    process.exit(0);
  }

  console.log(`\n  NOT VERIFIED — ${result.authorizationError}`);
  if (ca) {
    console.log('  The supplied CA does not validate this host. Re-download it from');
    console.log('  Supabase → Settings → Database → SSL Configuration, and confirm the root');
    console.log('  fingerprint matches `--chain` output before using it.');
  } else {
    console.log('  Enabling DATABASE_SSL_MODE=verify-full would break every connection.');
    console.log('  Supabase signs the pooler with a PRIVATE CA, so this is expected here —');
    console.log('  download the CA from the dashboard and re-run with --ca <file>.');
  }
  process.exit(1);
};

main();
