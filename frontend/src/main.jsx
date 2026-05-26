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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
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
