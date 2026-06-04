// Persistent banner shown across the authenticated dashboard whenever the
// signed-in user has not yet verified their email. Hidden once the backend
// reports email_verified_at = NOT NULL.
//
// Status is fetched once per session and refreshed after a successful resend.
// This is intentionally polling-light: verification is a rare action, and a
// stale banner for one extra navigation is harmless.

import { useEffect, useState } from 'react';
import { Mail, X, Loader2, CheckCircle2 } from 'lucide-react';
import { authAPI } from '../../services/api';

const DISMISS_KEY = 'redip.verify_banner_dismissed_at';
const DISMISS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const isDismissed = () => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const stamp = Number(raw);
    return Number.isFinite(stamp) && Date.now() - stamp < DISMISS_TTL_MS;
  } catch {
    return false;
  }
};

const markDismissed = () => {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage may be disabled (private mode); banner just keeps showing.
  }
};

export default function EmailVerificationBanner() {
  const [status, setStatus] = useState(null); // null | { verified, email }
  const [dismissed, setDismissed] = useState(isDismissed());
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent | error
  const [resendError, setResendError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authAPI.verifyEmailStatus();
        if (cancelled) return;
        setStatus(res?.data?.data || null);
      } catch {
        if (cancelled) return;
        setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.verified || dismissed) return null;

  const handleResend = async () => {
    setResendState('sending');
    setResendError('');
    try {
      await authAPI.verifyEmailRequest();
      setResendState('sent');
    } catch (err) {
      setResendState('error');
      setResendError(
        err?.response?.data?.message ||
          'Could not send the verification email. Please try again in a moment.'
      );
    }
  };

  const handleDismiss = () => {
    markDismissed();
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="border-b px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3 text-sm"
      style={{
        backgroundColor: 'rgba(194, 65, 12, 0.08)',
        borderColor: 'rgba(194, 65, 12, 0.25)',
        color: 'var(--color-text-primary)',
      }}
    >
      <Mail size={16} className="text-[#c2410c] shrink-0" aria-hidden="true" />
      <p className="flex-1 min-w-[12rem]">
        Verify your email{status.email ? ` (${status.email})` : ''} so we can reach you
        for grievance and account-recovery notices.
      </p>

      {resendState === 'sent' ? (
        <span className="inline-flex items-center gap-1.5 text-data-positive">
          <CheckCircle2 size={14} aria-hidden="true" />
          Verification email sent — check your inbox.
        </span>
      ) : resendState === 'error' ? (
        <span className="text-data-negative text-xs">{resendError}</span>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={resendState === 'sending'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#c2410c] text-white text-xs font-medium hover:bg-[#9a3412] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
        >
          {resendState === 'sending' && (
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          )}
          {resendState === 'sending' ? 'Sending…' : 'Send verification email'}
        </button>
      )}

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
