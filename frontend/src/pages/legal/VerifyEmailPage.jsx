// Public email-verification confirmation page. Lifts the `token` query param
// from the link in the verification email, posts it to /api/auth/verify-email/
// confirm, and renders a success / failure state. No authentication required —
// users may verify before logging back in on a fresh browser.

import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { authAPI } from '../../services/api';
import usePublicLightTheme from '../../hooks/usePublicLightTheme';

const STATUSES = {
  pending: 'pending',
  success: 'success',
  error: 'error',
};

export default function VerifyEmailPage() {
  usePublicLightTheme();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [status, setStatus] = useState(token ? STATUSES.pending : STATUSES.error);
  const [message, setMessage] = useState(
    token ? '' : 'No verification token was provided in the link.'
  );
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authAPI.verifyEmailConfirm(token);
        if (cancelled) return;
        setStatus(STATUSES.success);
        setEmail(res?.data?.data?.email || '');
        setMessage('');
      } catch (err) {
        if (cancelled) return;
        setStatus(STATUSES.error);
        const apiMessage =
          err?.response?.data?.message ||
          'This verification link is invalid or has expired. Sign in and request a fresh link.';
        setMessage(apiMessage);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const isPending = status === STATUSES.pending;
  const isSuccess = status === STATUSES.success;
  const isError = status === STATUSES.error;

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded px-2 py-1"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <span className="font-serif text-lg font-semibold text-stone-900">
            REDIP<span className="text-[#c2410c]">.</span>
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <section className="bg-white rounded-sm border border-stone-200 shadow-sm p-8">
          {isPending && (
            <div className="flex flex-col items-center text-center">
              <Loader2
                className="text-stone-400 animate-spin motion-reduce:animate-none"
                size={36}
              />
              <h1 className="font-serif text-xl font-semibold text-stone-900 mt-4">
                Verifying your email
              </h1>
              <p className="text-sm text-stone-600 mt-2">One moment.</p>
            </div>
          )}

          {isSuccess && (
            <div className="flex flex-col items-center text-center">
              <CheckCircle2 className="text-emerald-600" size={36} />
              <h1 className="font-serif text-xl font-semibold text-stone-900 mt-4">
                Email verified
              </h1>
              <p className="text-sm text-stone-600 mt-2 max-w-sm">
                {email
                  ? `${email} is now confirmed as your REDIP account email.`
                  : 'Your REDIP account email is now confirmed.'}
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#c2410c] text-white text-sm font-medium hover:bg-[#9a3412] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
              >
                Continue to sign in
              </Link>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center text-center">
              <AlertTriangle className="text-rose-600" size={36} />
              <h1 className="font-serif text-xl font-semibold text-stone-900 mt-4">
                Could not verify
              </h1>
              <p className="text-sm text-stone-600 mt-2 max-w-md">{message}</p>
              <div className="mt-6 flex flex-col sm:flex-row gap-2">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#c2410c] text-white text-sm font-medium hover:bg-[#9a3412] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
                >
                  Sign in
                </Link>
                <Link
                  to="/"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-stone-300 text-stone-700 text-sm font-medium hover:bg-stone-50 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40"
                >
                  Home
                </Link>
              </div>
              <p className="text-xs text-stone-500 mt-6 max-w-md">
                After signing in, the dashboard banner has a "Resend verification
                email" button.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
