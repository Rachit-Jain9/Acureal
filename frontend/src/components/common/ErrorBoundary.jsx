import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
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
    return this.props.children;
  }
}

export default ErrorBoundary;
