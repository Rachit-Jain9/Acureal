import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { isChunkLoadError } from './components/common/ErrorBoundary';
import './index.css';

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

// Resilient first-open policy. The dashboard fires ~10 independent queries in
// parallel at mount; on a Vercel serverless cold start (or a brief network
// blip) the first wave can hit a not-yet-warm function and fail with a 5xx /
// timeout / network error. With the old `retry: 1`, a single transient failure
// froze that widget into a "no data" state until a manual full-page reload —
// the exact "I have to refresh" symptom. We now retry TRANSIENT failures with
// bounded exponential backoff so they self-heal, while never retrying auth /
// client 4xx (the axios interceptor already owns 401 refresh+replay; 403/404/
// 422 won't improve on retry). `refetchOnWindowFocus` stays false globally so
// the expensive AI-narrated deal-workspace read isn't re-run on every tab
// focus; `refetchOnReconnect` is on so a dropped-then-restored connection
// recovers on its own.
const isTransientError = (error) => {
  const status = error?.response?.status;
  if (status == null) return true; // network error / timeout — no response
  if (status >= 500) return true; // server error — likely a cold/overloaded fn
  if (status === 408 || status === 429) return true; // timeout / rate-limit
  return false; // 4xx (incl. 401/403/404/422) — don't retry
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: (failureCount, error) => isTransientError(error) && failureCount < 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
