import { QueryClient, QueryCache } from '@tanstack/react-query';
import { Sentry } from './sentry';

// The app-wide react-query client, owned here (not in main.jsx) so non-React
// modules can reach it — most importantly the auth store, which must clear the
// cache at the auth boundary: cached rows are TENANT data, and logout / login
// / workspace-switch must never let one account (or one workspace) be served
// another's rows as "fresh" from memory.

// Resilient first-open policy. The dashboard fires ~10 independent queries in
// parallel at mount; on a Vercel serverless cold start (or a brief network
// blip) the first wave can hit a not-yet-warm function and fail with a 5xx /
// timeout / network error. With the old `retry: 1`, a single transient failure
// froze that widget into a "no data" state until a manual full-page reload —
// the exact "I have to refresh" symptom. We retry TRANSIENT failures with
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

export const queryClient = new QueryClient({
  // Fires once per query AFTER the retry policy is exhausted — the exact
  // "a widget gave up and went empty" moment #941's retry work couldn't see.
  // Auth outcomes (401/403) are expected states, not faults; everything else
  // goes to Sentry tagged with the query key so the failing endpoint is
  // identifiable. captureException is a safe no-op before initSentry() runs
  // (dev / tests).
  queryCache: new QueryCache({
    onError: (error, query) => {
      const status = error?.response?.status;
      if (status === 401 || status === 403) return;
      Sentry.captureException(error, {
        tags: { source: 'react-query', queryKey: String(query?.queryKey?.[0] ?? 'unknown') },
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Keep cached rows in memory well beyond staleTime so a >5-min detour
      // (open a deal, wander off, come back) still finds warm dashboard/workspace
      // caches instead of a cold refetch. gcTime must exceed staleTime or a
      // still-fresh query can be garbage-collected the moment it goes unused.
      gcTime: 30 * 60 * 1000,
      retry: (failureCount, error) => isTransientError(error) && failureCount < 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

// Empty the entire cache. Call ONLY at auth boundaries (logout, successful
// sign-in) — inside the app prefer targeted invalidation. `clear()` (vs
// `invalidateQueries`) guarantees the next account/workspace starts from
// skeletons and network truth, never from the previous tenant's rows.
export const clearQueryCache = () => {
  queryClient.clear();
};
