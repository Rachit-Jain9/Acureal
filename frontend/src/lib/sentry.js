// Acureal error monitoring (Sentry, EU data residency — operator's choice).
//
// The Sentry SDK (~30 KB gz) is DYNAMICALLY imported inside initSentry() so it
// never sits on the first-paint critical path — it loads as its own async chunk
// after the app mounts, and only in the deployed production build. Callers report
// through the lazy `Sentry` facade exported below.
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
let _capture = null; // the loaded sentryCapture fn, once initialised (prod only)

// Initialise once, and ONLY in the deployed build — never in local dev or unit
// tests. That keeps the console clean and reserves the free-tier quota for real
// production errors from real users.
export function initSentry() {
  if (started || !import.meta.env.PROD || !DSN) return;
  started = true;
  import('./sentryImpl')
    .then((m) => {
      _capture = m.sentryCapture;
      m.sentryInit({
        dsn: DSN,
        environment: import.meta.env.MODE,
        // Injected from the git SHA at build time (vite.config.js). Lets Sentry
        // tell you WHICH deploy first introduced an error.
        release: typeof __APP_RELEASE__ !== 'undefined' ? __APP_RELEASE__ : undefined,
        // Errors are the priority; sample a slice of performance traces so we
        // still get slow-pageload signal without blowing the free tier.
        tracesSampleRate: 0.1,
        // Privacy-first (EU storage): do NOT attach IP address, cookies, or
        // request bodies. Deal data must never leave to a third party by default.
        sendDefaultPii: false,
        ignoreErrors: IGNORE_ERRORS,
      });
    })
    .catch(() => { /* monitoring is best-effort — never break the app for it */ });
}

// Lazy facade so callers (ErrorBoundary, react-query onError) can report an error
// without statically importing the SDK. A safe no-op until the dynamic import in
// initSentry() resolves (dev/tests never load it).
export const Sentry = {
  captureException: (error, context) => {
    if (_capture) _capture(error, context);
  },
};
