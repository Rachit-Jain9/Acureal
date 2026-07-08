'use strict';

const Sentry = require('@sentry/node');

// Backend error monitoring. Same public Sentry project as the frontend (EU data
// residency). The DSN only permits SENDING events, so the committed fallback is
// safe; `SENTRY_DSN` in the environment overrides it (rotate/disable without a
// code change).
const DSN =
  process.env.SENTRY_DSN
  || 'https://714e379f1714a00bf2b43bdc983aa4f3@o4511700238270464.ingest.de.sentry.io/4511700254916688';

let enabled = false;

// Initialise once, ONLY in the deployed runtime (Vercel or NODE_ENV=production)
// — never under tests. Must be called before Express/pg are required so the
// SDK's auto-instrumentation can attach (server.js does this at the top).
function initSentry() {
  if (enabled) return true;
  const isDeployed = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
  if (!isDeployed || !DSN) return false;
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    release: process.env.VERCEL_GIT_COMMIT_SHA
      ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
      : undefined,
    // Errors are the priority; sample a slice of traces for slow-request signal
    // while staying within the free tier.
    tracesSampleRate: 0.1,
    // Privacy-first (EU storage): no IP / cookies / request bodies attached.
    // Deal data must never leave to a third party by default.
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

function isEnabled() {
  return enabled;
}

module.exports = { Sentry, initSentry, isEnabled };
