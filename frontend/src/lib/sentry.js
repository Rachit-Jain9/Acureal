import * as Sentry from '@sentry/react';

// REDIP error monitoring (Sentry, EU data residency — operator's choice).
//
// A Sentry DSN is a PUBLIC identifier: it only permits SENDING events to the
// project, never reading them, so it is safe in client code and in the repo.
// The env override (`VITE_SENTRY_DSN`) lets the operator rotate or disable it
// without a code change.
const DSN =
  import.meta.env.VITE_SENTRY_DSN
  || 'https://714e379f1714a00bf2b43bdc983aa4f3@o4511700238270464.ingest.de.sentry.io/4511700254916688';

// Errors we deliberately drop as pure noise — reporting them would only burn
// quota and bury real signal:
//   • browser-extension message-channel chatter (not our code)
//   • stale-chunk load failures (ErrorBoundary + main.jsx already auto-reload)
//   • the benign ResizeObserver loop warning
const IGNORE_ERRORS = [
  /message channel closed before a response was received/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading (CSS )?chunk \d+ failed/i,
  /ResizeObserver loop/i,
];

let started = false;

// Initialise once, and ONLY in the deployed build — never in local dev or unit
// tests. That keeps the console clean and reserves the free-tier quota for real
// production errors from real users.
export function initSentry() {
  if (started || !import.meta.env.PROD || !DSN) return;
  started = true;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    // Injected from the git SHA at build time (vite.config.js). Lets Sentry
    // tell you WHICH deploy first introduced an error.
    release: typeof __APP_RELEASE__ !== 'undefined' ? __APP_RELEASE__ : undefined,
    // Errors are the priority; sample a slice of performance traces so we still
    // get slow-pageload signal without blowing the free tier.
    tracesSampleRate: 0.1,
    // Privacy-first (EU storage): do NOT attach IP address, cookies, or request
    // bodies. Deal data must never leave to a third party by default.
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
  });
}

export { Sentry };
