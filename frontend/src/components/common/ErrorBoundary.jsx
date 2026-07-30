import { Component, Fragment } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Sentry } from '../../lib/sentry'; // lazy facade — keeps the SDK off first paint

// Detect "stale chunk" errors that happen after a deploy lands new bundle
// hashes but the user's HTML still references the old ones. The dynamic
// import then 404s. Vite + Vercel + lazy-loaded routes hit this regularly.
//
// Recovery is mechanical: a single full reload fetches the fresh index.html
// with the new chunk hashes, and subsequent dynamic imports succeed.
//
// We match against the well-known error messages browsers throw for these
// failures. Strings tested:
//   • Chrome:  "Failed to fetch dynamically imported module: …"
//   • Safari:  "Importing a module script failed."
//   • Firefox: "error loading dynamically imported module: …"
//   • Vite generic: "Loading chunk N failed."
//   • Vite CSS:     "Loading CSS chunk N failed."
const isChunkLoadError = (error) => {
  if (!error) return false;
  // ChunkLoadError is the named class some bundlers (Webpack-style) throw.
  if (error.name === 'ChunkLoadError') return true;
  const message = String(error.message || error || '');
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /Loading CSS chunk \d+ failed/i.test(message) ||
    /dynamically imported module/i.test(message)
  );
};

// SessionStorage guards a reload-loop: if the page reloads AND the error
// recurs in the same tab session, we stop auto-reloading and show the
// regular ErrorBoundary UI so the user can act. The flag is per-tab via
// sessionStorage, so a fresh tab gets a fresh budget.
const RELOAD_GUARD_KEY = '__redip_chunk_reload_attempted__';

const safeSession = {
  get: (k) => {
    try { return window.sessionStorage.getItem(k); } catch { return null; }
  },
  set: (k, v) => {
    try { window.sessionStorage.setItem(k, v); } catch { /* private mode */ }
  },
  remove: (k) => {
    try { window.sessionStorage.removeItem(k); } catch { /* private mode */ }
  },
};

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // `resetKey` is bumped every time the user clicks "Try again". The
    // children render inside a Fragment keyed by `resetKey`, so a bump
    // forces React to unmount the failing subtree and mount a fresh
    // instance — the only reliable way to recover from a render that
    // crashed against a stale prop or one-off race condition.
    this.state = {
      hasError: false,
      error: null,
      resetKey: 0,
      chunkReloading: false,
    };
  }

  static getDerivedStateFromError(error) {
    const isChunk = isChunkLoadError(error);
    // If this is a chunk-load error AND we haven't already attempted an
    // auto-reload in this tab session, kick off a reload. Otherwise fall
    // through to the regular error UI.
    if (isChunk && !safeSession.get(RELOAD_GUARD_KEY)) {
      return { hasError: true, error, chunkReloading: true };
    }
    return { hasError: true, error, chunkReloading: false };
  }

  componentDidCatch(error, info) {
    const isChunk = isChunkLoadError(error);
    console.error('[ErrorBoundary]', isChunk ? '[chunk-load]' : '', error, info?.componentStack);
    // Report genuine render crashes to Sentry (no-op until init'd in prod).
    // Chunk-load errors are benign + auto-recovered by the reload below, so we
    // skip them to keep the error feed signal-rich.
    if (!isChunk) {
      Sentry.captureException(error, {
        contexts: { react: { componentStack: info?.componentStack } },
      });
    }
    if (isChunk && !safeSession.get(RELOAD_GUARD_KEY)) {
      // Set the guard BEFORE reloading so the next page-load knows we've
      // already tried once. Small delay lets the UI paint the reload
      // message before the navigation tears down React.
      safeSession.set(RELOAD_GUARD_KEY, String(Date.now()));
      window.setTimeout(() => {
        try { window.location.reload(); } catch { /* edge: about: tabs */ }
      }, 400);
    }
  }

  componentDidMount() {
    // First successful mount after a chunk-reload — clear the guard so the
    // next deploy gets its own auto-reload budget.
    if (!this.state.hasError) {
      safeSession.remove(RELOAD_GUARD_KEY);
    }
  }

  handleReset = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      chunkReloading: false,
      resetKey: prev.resetKey + 1,
    }));
  };

  handleHardReload = () => {
    safeSession.remove(RELOAD_GUARD_KEY);
    try { window.location.reload(); } catch { /* edge */ }
  };

  render() {
    if (this.state.hasError) {
      // Chunk-load auto-reload path — show a brief "Loading the latest
      // version" pane while the page reload navigates the user away.
      // 400 ms later they're on the fresh HTML with the new chunk hashes.
      if (this.state.chunkReloading) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-5 p-8 text-center">
            <div className="rounded-full bg-bg-secondary p-4">
              <RefreshCw size={24} className="text-content-secondary animate-spin" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-content-primary">Loading the latest version…</h2>
              <p className="mt-1 text-sm text-content-secondary max-w-sm">
                A newer version of Acureal was deployed since you opened this tab. Refreshing
                automatically — you'll be back in a second.
              </p>
            </div>
          </div>
        );
      }

      const message = this.state.error?.message || 'An unexpected error occurred.';
      const isChunk = isChunkLoadError(this.state.error);
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-5 p-8 text-center">
          <div className="rounded-full bg-neg-soft p-4 ring-1 ring-hairline">
            <AlertTriangle size={28} className="text-data-negative" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-content-primary">
              {isChunk ? 'Refresh needed' : 'Something went wrong on this page'}
            </h2>
            <p className="mt-1 text-sm text-content-secondary max-w-sm">
              {isChunk
                ? 'A newer version of Acureal is deployed and your tab needs to refresh to pick it up.'
                : message}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 rounded-lg bg-bg-secondary px-4 py-2 text-sm font-medium text-content-secondary hover:brightness-95"
            >
              <RefreshCw size={14} />
              Try again
            </button>
            {isChunk && (
              <button
                type="button"
                onClick={this.handleHardReload}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-content-inverse hover:bg-accent-hover"
              >
                <RefreshCw size={14} />
                Refresh page
              </button>
            )}
          </div>
        </div>
      );
    }
    // Keyed Fragment forces the subtree to unmount + remount when
    // `resetKey` changes, giving fresh component state on retry.
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

// Exported for unit tests + for anyone needing to detect chunk-load errors
// elsewhere (e.g. global onerror handlers in main.jsx).
export { isChunkLoadError };

export default ErrorBoundary;
