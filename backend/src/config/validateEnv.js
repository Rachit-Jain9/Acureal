'use strict';

/**
 * Boot-time environment validation. Fails closed in production: if a
 * critical secret is missing or still set to a placeholder value, the
 * process refuses to start (locally) or the serverless module throws on
 * cold start (Vercel) so the request 500s rather than running without a
 * signing secret.
 *
 * Called once from server.js immediately after loadEnv. Skipped under
 * NODE_ENV=test so the suite controls its own environment.
 */

// Both lists are DERIVED from the environment manifest rather than restated
// here. The manifest records what every variable is for, who may see it, and
// how badly it is needed; keeping a second copy of "which ones are required"
// beside it is exactly the kind of drift that lets a variable be critical in
// one file and forgotten in another.
const { criticalVars, recommendedVars } = require('./envManifest');

const asCheck = (entry) => ({ key: entry.name, why: entry.why });

// Secrets the app cannot run safely without. A missing/placeholder value
// here is a hard error in production.
const CRITICAL = criticalVars().map(asCheck);

// Vars that degrade a feature when absent but do not warrant a hard stop. The
// `why` on each manifest entry is what gets printed, so the warning an operator
// reads mid-incident is the same sentence a reviewer reads in the manifest.
const RECOMMENDED = recommendedVars().map(asCheck);

// Recognizable key prefixes per AI provider — used for a boot-time sanity
// check so a wrong / corrupted key is caught here, not as a runtime 401.
const AI_KEY_FORMATS = [
  { key: 'ANTHROPIC_API_KEY', prefix: 'sk-ant-', label: 'an Anthropic key' },
  { key: 'OPENAI_API_KEY', prefix: 'sk-', label: 'an OpenAI key' },
  { key: 'GEMINI_API_KEY', prefix: 'AIza', label: 'a Google AI Studio key' },
];

// A value is a placeholder if it is empty, carries a copy-me marker from
// .env.example, or is a bracketed token. getJwtSecret() only catches
// "your_" — this also catches the "replace-with-..." form .env.example uses.
const PLACEHOLDER = /(^\s*$)|your[-_]|replace[-_]?with|change[-_]?me|^\[/i;

const isPlaceholder = (value) => !value || PLACEHOLDER.test(String(value));

// Production OR any Vercel deployment (preview included) is held to the
// strict standard — a preview missing a signing secret is just as broken.
const isStrict = () => process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const validateEnv = ({ exitOnFailure = true } = {}) => {
  // Tests own their environment — never validate or abort under jest.
  if (process.env.NODE_ENV === 'test') {
    return { ok: true, errors: [], warnings: [], skipped: true };
  }

  const errors = [];
  const warnings = [];

  for (const { key, why } of CRITICAL) {
    if (isPlaceholder(process.env[key])) {
      errors.push(`${key} is missing or still a placeholder (needed for ${why}).`);
    }
  }

  for (const { key, why } of RECOMMENDED) {
    if (isPlaceholder(process.env[key])) {
      warnings.push(`${key} is not set — ${why} will be unavailable.`);
    }
  }

  // Document storage needs at least one provider wired.
  const hasBlob = !isPlaceholder(process.env.BLOB_READ_WRITE_TOKEN);
  const hasSupabaseStorage =
    !isPlaceholder(process.env.SUPABASE_URL) &&
    (!isPlaceholder(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
      !isPlaceholder(process.env.SUPABASE_KEY));
  if (!hasBlob && !hasSupabaseStorage) {
    warnings.push(
      'No document storage configured — set BLOB_READ_WRITE_TOKEN or Supabase storage credentials.'
    );
  }

  // A present-but-short signing secret is weak even when non-placeholder.
  for (const key of ['JWT_SECRET', 'DEAL_EVENTS_HMAC_KEY']) {
    const value = process.env[key];
    if (value && !isPlaceholder(value) && value.length < 16) {
      warnings.push(`${key} is shorter than 16 characters — use a longer random value.`);
    }
  }

  // AI provider keys have recognizable prefixes. A present-but-malformed key
  // (wrong key pasted, surrounding quotes, truncated, stray whitespace) only
  // surfaces much later as a cryptic 401 at call time — catch the obvious
  // cases at boot instead.
  for (const { key, prefix, label } of AI_KEY_FORMATS) {
    const raw = process.env[key];
    if (!raw || isPlaceholder(raw)) continue;
    if (raw !== raw.trim()) {
      warnings.push(`${key} has leading/trailing whitespace — it is trimmed before use, but fix the stored value.`);
    }
    if (!raw.trim().startsWith(prefix)) {
      warnings.push(`${key} does not look like ${label} (expected it to start with "${prefix}") — the provider will reject it with a 401.`);
    }
  }

  // Database transport posture. `relaxed` encrypts but never authenticates the
  // server's certificate, so the client will happily complete a handshake with
  // anything answering on that host — including something between Vercel and
  // Supabase. Surfacing it at boot keeps it from becoming invisible again.
  const { resolveSslMode, MODES } = require('./databaseSsl');
  const ssl = resolveSslMode(process.env);
  if (ssl.invalid) {
    warnings.push(
      `DATABASE_SSL_MODE is "${ssl.requested}", which is not a recognised mode `
      + `(${Object.values(MODES).join(' | ')}) — falling back to "${ssl.mode}". `
      + 'A typo here must never silently change how the database connection is verified.',
    );
  }
  if (isStrict() && ssl.mode === MODES.RELAXED) {
    warnings.push(
      'DATABASE_SSL_MODE is not "verify-full" — the database connection is encrypted '
      + 'but the server certificate is NOT authenticated. Enabling it requires '
      + 'DATABASE_CA_CERT (Supabase signs the pooler with a private CA); verify with '
      + '`node backend/scripts/check-db-tls.js` before flipping.',
    );
  }
  if (ssl.mode === MODES.VERIFY_FULL && isPlaceholder(process.env.DATABASE_CA_CERT)) {
    // Measured: the Supabase pooler chains to "Supabase Intermediate 2021 CA",
    // which is not in Node's trust store. verify-full without that CA rejects
    // EVERY connection at cold start. Loud at boot beats SELF_SIGNED_CERT_IN_CHAIN
    // on every request. Not fatal, because a provider that later moves to a
    // public root would make this configuration correct.
    warnings.push(
      'DATABASE_SSL_MODE=verify-full is set but DATABASE_CA_CERT is empty. If this database '
      + 'is signed by a private CA (Supabase is), every connection will fail with '
      + 'SELF_SIGNED_CERT_IN_CHAIN. Run `node backend/scripts/check-db-tls.js` to confirm '
      + 'before deploying, or set DATABASE_SSL_MODE back to "relaxed".',
    );
  }

  // PLATFORM_ORG_ID is optional (the email lookup is a real fallback), but a
  // present-and-malformed pin silently degrades platform comps/benchmarks to
  // the legacy path — surface it at boot like the AI-key format checks.
  const platformOrgPin = process.env.PLATFORM_ORG_ID;
  if (platformOrgPin && !isPlaceholder(platformOrgPin)) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(platformOrgPin.trim())) {
      warnings.push('PLATFORM_ORG_ID is set but is not a UUID — the platform-org pin is ignored and the email lookup is used instead.');
    }
  }

  for (const warning of warnings) {
    console.warn(`[Acureal env] WARNING: ${warning}`);
  }

  if (errors.length > 0) {
    const banner = [
      '[Acureal env] FATAL: required environment is not configured.',
      ...errors.map((e) => `  - ${e}`),
      'Set these in backend/.env (local) or Vercel environment variables (production).',
    ].join('\n');

    if (isStrict()) {
      // Fail closed. Locally this crashes the process before it listens;
      // on Vercel the serverless module throws on cold start so the
      // request 500s instead of serving without a signing secret.
      console.error(banner);
      if (exitOnFailure && !process.env.VERCEL) {
        process.exit(1);
      }
      throw new Error('Acureal startup aborted: missing critical environment variables.');
    }

    // Development — loud, but never block local iteration.
    console.warn(banner);
  }

  return { ok: errors.length === 0, errors, warnings, skipped: false };
};

module.exports = { validateEnv, isPlaceholder, CRITICAL, RECOMMENDED };
