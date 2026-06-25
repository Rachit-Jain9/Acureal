import { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { authAPI } from '../../services/api';
import useAuthStore from '../../store/authStore';
import { toast } from './Toast';

// Account closure card — DPDP §8(7) self-service erasure scheduling.
// Two-step flow:
//   1. User clicks "Close my account"
//   2. Confirmation modal opens. User must type CLOSE to enable the
//      destructive button. (Standard pattern used by GitHub, Stripe, etc.
//      for irreversible actions.)
// On confirm: posts to /auth/me/close-account, the backend revokes refresh
// tokens + clears cookies, and the SPA forces a logout.
export default function CloseAccountCard() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const logout = useAuthStore((s) => s.logout);

  const canConfirm = confirmText.trim() === 'CLOSE';

  const handleClose = async () => {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    try {
      await authAPI.closeAccount();
      toast.success('Account closed. You will be redirected to the login page.');
      // The backend has already cleared cookies. Force the SPA to drop
      // local state and route to /login.
      setTimeout(() => logout(), 1200);
    } catch (err) {
      toast.error(
        err.response?.data?.message || 'Could not close the account. Please try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline p-6">
        <h3 className="text-base font-semibold text-data-negative mb-1 flex items-center gap-2">
          <AlertTriangle size={18} />
          Close My Account
        </h3>
        <p className="text-xs text-content-secondary mb-4 max-w-2xl">
          Closing your account immediately logs you out of every device and prevents future sign-ins.
          Your personal data (name, email, phone) is anonymized 90 days later, in line with REDIP's
          Privacy Policy §7 and the Digital Personal Data Protection Act 2023 §8(7). Deal records
          attributable to your past activity are retained as evidence but stripped of your identifying
          fields. <strong>This cannot be reversed by self-service after the 90-day window.</strong>
        </p>
        <button
          type="button"
          onClick={() => { setOpen(true); setConfirmText(''); }}
          className="text-sm font-medium text-data-negative hover:text-data-negative border border-hairline hover:border-hairline-strong rounded-lg px-4 py-2 transition-colors"
        >
          Close my account
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-account-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
        >
          <div className="bg-bg-elevated border border-hairline-strong rounded-editorial shadow-elevated max-w-md w-full p-6 relative">
            <button
              type="button"
              onClick={() => !submitting && setOpen(false)}
              className="absolute top-3 right-3 text-content-muted hover:text-content-primary"
              aria-label="Cancel"
            >
              <X size={18} />
            </button>
            <h4 id="close-account-title" className="font-display text-lg font-semibold text-content-primary mb-2 flex items-center gap-2">
              <AlertTriangle size={18} className="text-data-negative" />
              Confirm account closure
            </h4>
            <p className="text-sm text-content-secondary mb-4">
              This logs you out everywhere, blocks future sign-ins, and schedules anonymization of your
              personal data after 90 days. Type <code className="bg-bg-secondary px-1.5 py-0.5 rounded text-data-negative font-mono">CLOSE</code> below
              to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type CLOSE"
              autoComplete="off"
              autoFocus
              disabled={submitting}
              className="w-full px-3 py-2 border border-hairline-strong rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400/40 mb-5"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={!canConfirm || submitting}
                className="text-sm font-medium text-content-inverse bg-data-negative hover:bg-data-negative disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 flex items-center gap-1.5 transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Closing…' : 'Close account permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
