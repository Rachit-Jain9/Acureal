import { Component, Fragment } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // `resetKey` is bumped every time the user clicks "Try again". The
    // children render inside a Fragment keyed by `resetKey`, so a bump
    // forces React to unmount the failing subtree and mount a fresh
    // instance — the only reliable way to recover from a render that
    // crashed against a stale prop or one-off race condition.
    //
    // Without this, clicking "Try again" only flips `hasError` back to
    // false and renders the SAME children with the SAME state that caused
    // the original throw — so the boundary just catches the same error
    // again and the user is stuck. The previous behaviour was effectively
    // a no-op; users had to use the browser's hard refresh to recover.
    this.state = { hasError: false, error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      resetKey: prev.resetKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || 'An unexpected error occurred.';
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-5 p-8 text-center">
          <div className="rounded-full bg-red-50 p-4 ring-1 ring-red-100">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-content-primary">Something went wrong on this page</h2>
            <p className="mt-1 text-sm text-content-secondary max-w-sm">{message}</p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 rounded-lg bg-bg-secondary px-4 py-2 text-sm font-medium text-content-secondary hover:bg-bg-secondary"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      );
    }
    // Keyed Fragment forces the subtree to unmount + remount when
    // `resetKey` changes, giving fresh component state on retry.
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

export default ErrorBoundary;
