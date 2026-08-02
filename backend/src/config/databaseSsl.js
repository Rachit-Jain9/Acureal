'use strict';

/**
 * How the Postgres connection verifies the server it is talking to.
 *
 * THE PROBLEM. Production has always connected with
 * `ssl: { rejectUnauthorized: false }`. The traffic is encrypted, but the
 * server's certificate is never authenticated — the client will complete a TLS
 * handshake with whatever answers on that host and port, including an attacker
 * positioned between Vercel and Supabase. For a platform whose entire product
 * is the provenance of financial and legal facts, "we encrypted it, we just
 * didn't check who we sent it to" is the wrong posture.
 *
 * WHY IT WAS LEFT. Deliberately not bundled with the M1 role flip (2026-07-28)
 * so that change's blast radius stayed isolated — a TLS misconfiguration and an
 * RLS misconfiguration failing on the same deploy would be indistinguishable.
 * The flip has been stable since, so the reason for deferral has expired.
 *
 * WHY A SWITCH RATHER THAN A FLIP. Certificate verification either works or
 * takes the whole site down — there is no partial failure. `DATABASE_SSL_MODE`
 * makes the change an env edit with an instant revert, exactly like the
 * RLS_ENFORCED kill-switch used for the role flip, instead of a deploy that has
 * to be rolled back under pressure. Default is unchanged behaviour, so merging
 * this file changes nothing until someone opts in.
 *
 *   DATABASE_SSL_MODE unset | 'relaxed'  → current behaviour (encrypt, do not verify)
 *   DATABASE_SSL_MODE = 'verify-full'    → verify the chain AND the hostname
 *   DATABASE_SSL_MODE = 'disable'        → no TLS at all (local Postgres only)
 *
 * `rejectUnauthorized: true` is genuine verify-full for node-postgres: it
 * validates the chain and, because no custom `checkServerIdentity` is supplied,
 * Node also verifies the hostname.
 *
 * ⚠ DATABASE_CA_CERT IS REQUIRED HERE, NOT OPTIONAL. Measured 2026-08-02 against
 * `aws-1-ap-south-1.pooler.supabase.com:6543` with
 * `node backend/scripts/check-db-tls.js`: the pooler presents
 * `CN=*.pooler.supabase.com` issued by **"Supabase Intermediate 2021 CA"** — a
 * PRIVATE root that is not in Node's trust store. A strict client rejects it
 * with SELF_SIGNED_CERT_IN_CHAIN. So setting `verify-full` WITHOUT supplying
 * Supabase's CA would fail every connection at cold start and take the whole
 * site down. Download the CA from the Supabase dashboard
 * (Settings → Database → SSL Configuration) into `DATABASE_CA_CERT`, re-run the
 * script to confirm it verifies, and only then flip the mode.
 */

const RELAXED = 'relaxed';
const VERIFY_FULL = 'verify-full';
const DISABLE = 'disable';

const VALID_MODES = new Set([RELAXED, VERIFY_FULL, DISABLE]);

/**
 * Resolve the effective mode. Anything unrecognised falls back to the current
 * production behaviour rather than guessing — a typo in an env var must never
 * silently harden or weaken the connection.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ mode: string, requested: string|null, invalid: boolean }}
 */
const resolveSslMode = (env = process.env) => {
  const raw = (env.DATABASE_SSL_MODE || '').trim().toLowerCase();
  const isProduction = env.NODE_ENV === 'production';

  if (!raw) {
    // Outside production the pooler is not in play and local Postgres usually
    // has no TLS at all — preserve the historical `ssl: false`.
    return { mode: isProduction ? RELAXED : DISABLE, requested: null, invalid: false };
  }
  if (!VALID_MODES.has(raw)) {
    return { mode: isProduction ? RELAXED : DISABLE, requested: raw, invalid: true };
  }
  return { mode: raw, requested: raw, invalid: false };
};

/**
 * Build the `ssl` option for `new Pool(...)`.
 *
 * @returns {false | { rejectUnauthorized: boolean, ca?: string }}
 */
const resolveSslConfig = (env = process.env) => {
  const { mode } = resolveSslMode(env);

  if (mode === DISABLE) return false;
  if (mode === RELAXED) return { rejectUnauthorized: false };

  // A PEM is multi-line, and the journey from a downloaded .crt into a hosting
  // dashboard does not always preserve that. Some UIs and shell exports turn
  // real newlines into the two characters \ and n; OpenSSL then rejects the
  // blob and — because this only runs when verify-full is already on — the
  // first symptom is every connection failing at cold start. Normalising here
  // costs nothing and removes an entire class of 2am incident.
  const ca = (env.DATABASE_CA_CERT || '')
    .replace(/\\r\\n|\\n/g, '\n')
    .trim();

  // Only attach a CA when one is actually supplied. Passing `ca: undefined`
  // is harmless, but passing `ca: ''` REPLACES Node's trust store with an empty
  // one and every connection fails with a self-signed-certificate error — a
  // failure that reads like a certificate problem rather than a config typo.
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
};

/** True when the connection authenticates the server it talks to. */
const isVerifyingServerIdentity = (env = process.env) => resolveSslMode(env).mode === VERIFY_FULL;

module.exports = {
  resolveSslMode,
  resolveSslConfig,
  isVerifyingServerIdentity,
  MODES: { RELAXED, VERIFY_FULL, DISABLE },
};
