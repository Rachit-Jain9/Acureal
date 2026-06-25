import { create } from 'zustand';
import { useEffect, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// Monotonic id source. `Date.now()` collides when two toasts fire in the same
// millisecond (e.g. several validation errors at once) — duplicate React keys
// and `removeToast` then drops BOTH. A counter guarantees unique ids.
let toastSeq = 0;

export const useToastStore = create((set) => ({
  toasts: [],
  addToast: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { id: ++toastSeq, ...toast }],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

export const toast = {
  success: (message) => useToastStore.getState().addToast({ type: 'success', message }),
  error: (message) => useToastStore.getState().addToast({ type: 'error', message }),
  info: (message) => useToastStore.getState().addToast({ type: 'info', message }),
  warning: (message) => useToastStore.getState().addToast({ type: 'warning', message }),
};

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const colors = {
  success: 'bg-pos-soft border-hairline text-data-positive',
  error: 'bg-neg-soft border-hairline text-data-negative',
  info: 'bg-accent-soft border-hairline text-accent',
  warning: 'bg-premium-soft border-hairline text-premium',
};

const TOAST_EXIT_MS = 200; // keep in sync with .redip-toast-out in index.css

function ToastItem({ toast: t, onRemove }) {
  const Icon = icons[t.type] || Info;
  const isError = t.type === 'error';
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);

  // Play the exit animation, then unmount. Under reduced motion, remove at once.
  const dismiss = useCallback(() => {
    if (reduced) { onRemove(t.id); return; }
    setLeaving(true);
    setTimeout(() => onRemove(t.id), TOAST_EXIT_MS);
  }, [reduced, onRemove, t.id]);

  useEffect(() => {
    const timer = setTimeout(dismiss, 4000);
    return () => clearTimeout(timer);
  }, [dismiss]);

  // Errors get role="alert" + aria-live="assertive" so screen readers
  // interrupt; everything else is "status"/"polite" per WAI-ARIA APG.
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${colors[t.type]} ${leaving ? 'redip-toast-out' : 'redip-toast-in'}`}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="text-sm flex-1">{t.message}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-accent/50 rounded"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 space-y-2 max-w-sm"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={removeToast} />
      ))}
    </div>
  );
}
