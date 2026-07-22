import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { isChunkLoadError } from './components/common/ErrorBoundary';
import { initSentry } from './lib/sentry';
import { queryClient } from './lib/queryClient';
import './index.css';

// Start error monitoring, but OFF the first-paint critical path: initSentry()
// dynamically imports the ~30 KB Sentry SDK, so we kick it off once the browser
// is idle after mount rather than competing with the app's own initial code.
// No-op in dev / tests (only runs in the deployed production build); the global
// chunk-error handlers below cover the brief pre-init window.
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(() => initSentry(), { timeout: 3000 });
} else {
  window.setTimeout(() => initSentry(), 1);
}

// ─── Stale-chunk auto-recovery (global handler) ──────────────────────────────
// The React ErrorBoundary catches stale-chunk errors that surface during a
// React render. But some chunk-load failures fire BEFORE the failing
// component re-renders — e.g. an event handler that triggers `React.lazy`
// rejects its promise asynchronously, and the rejection arrives as an
// `unhandledrejection` on `window`. We catch those here so the user still
// gets a single auto-reload instead of a silent dead state.
//
// Same per-tab-session guard as ErrorBoundary (RELOAD_GUARD_KEY) — checked
// inline here to keep main.jsx free of imports from sessionStorage helpers.
const RELOAD_GUARD_KEY = '__redip_chunk_reload_attempted__';
const tryReadGuard = () => {
  try { return window.sessionStorage.getItem(RELOAD_GUARD_KEY); } catch { return null; }
};
const trySetGuard = () => {
  try { window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch { /* */ }
};

const maybeReloadOnChunkError = (error) => {
  if (!isChunkLoadError(error)) return;
  if (tryReadGuard()) return; // already attempted this session
  trySetGuard();
  console.warn('[stale-chunk] reloading to fetch the latest deploy…');
  window.setTimeout(() => {
    try { window.location.reload(); } catch { /* */ }
  }, 400);
};

window.addEventListener('unhandledrejection', (event) => {
  maybeReloadOnChunkError(event.reason);
});

window.addEventListener('error', (event) => {
  // `event.error` carries the underlying Error for runtime exceptions;
  // for resource-loading failures (e.g. <script src=...> 404) it's null and
  // we read the message from event.message instead.
  maybeReloadOnChunkError(event.error || { message: event.message });
});
// ─────────────────────────────────────────────────────────────────────────────

// The QueryClient itself (retry policy, Sentry wiring, and the auth-boundary
// clear) lives in lib/queryClient.js so non-React modules — the auth store —
// can clear tenant data from the cache at logout / sign-in.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
