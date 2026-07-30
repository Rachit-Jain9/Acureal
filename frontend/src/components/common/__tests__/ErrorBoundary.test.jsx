import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ErrorBoundary, { isChunkLoadError } from '../ErrorBoundary';

// A child component that throws on demand. Used to exercise the boundary's
// caught-error paths without setting up actual lazy imports.
function Boom({ message, name }) {
  const err = new Error(message);
  if (name) err.name = name;
  throw err;
}

const RELOAD_GUARD_KEY = '__redip_chunk_reload_attempted__';

beforeEach(() => {
  // Silence React's expected error log from the boundary tests so the
  // console output isn't drowned in red.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try { window.sessionStorage.clear(); } catch { /* private mode */ }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isChunkLoadError', () => {
  it('detects Chrome-style "Failed to fetch dynamically imported module"', () => {
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://...DealsPage-X.js'))
    ).toBe(true);
  });

  it('detects Safari-style "Importing a module script failed"', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('detects Firefox-style "error loading dynamically imported module"', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module: ...'))).toBe(true);
  });

  it('detects bundler ChunkLoadError name even with empty message', () => {
    const err = new Error('');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('detects Vite-style "Loading chunk N failed"', () => {
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);
  });

  it('detects "Loading CSS chunk N failed"', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk 7 failed.'))).toBe(true);
  });

  it('does not flag random runtime errors as chunk-load', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('foo is not a function'))).toBe(false);
  });

  it('null / undefined are safely false', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders the generic error UI for non-chunk runtime errors', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined" />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/Cannot read properties of undefined/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    // No "Refresh page" CTA for non-chunk errors
    expect(screen.queryByRole('button', { name: /Refresh page/i })).not.toBeInTheDocument();
  });

  it('shows the auto-reload pane on first chunk-load error in a session', () => {
    // Mock reload so we can verify it was called without actually reloading
    // the test runner. Vitest's window does not implement reload by default;
    // we replace it with a spy on the prototype.
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    vi.useFakeTimers();
    render(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: https://...DealsPage-X.js" />
      </ErrorBoundary>
    );
    // Auto-reload pane copy
    expect(screen.getByText(/Loading the latest version/i)).toBeInTheDocument();
    // Reload guard set in sessionStorage
    expect(window.sessionStorage.getItem(RELOAD_GUARD_KEY)).not.toBeNull();
    // Drain the 400 ms timer
    vi.advanceTimersByTime(500);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('shows the manual-refresh UI on a SECOND chunk-load error in the same session', () => {
    // Simulate the guard already being set (first reload was attempted)
    try { window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1700000000000'); } catch { /* */ }
    render(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: https://...DealsPage-X.js" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Refresh needed')).toBeInTheDocument();
    expect(screen.getByText(/newer version of Acureal is deployed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh page/i })).toBeInTheDocument();
  });

  it('clicking "Try again" resets the boundary so a recovered child renders', () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) {
        const err = new Error('flaky once');
        throw err;
      }
      return <div>recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
